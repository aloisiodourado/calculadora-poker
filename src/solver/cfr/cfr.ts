import {
  Street,
  Position,
  Position6Max,
  BetAction,
  DrawCount,
  BlockerBin,
  StrategyTable,
  DrawStrategyTable,
  infoSetKey,
  drawInfoSetKey,
} from "../game/types";
import {
  BettingState,
  validBetActions,
  applyBetAction,
  firstToAct,
  initialBettingState,
} from "../game/rules";
import { sampleNextBucket, sampleBlockerBinAfterDraw } from "../abstraction/bucketTransition";
import { drawCountForBucket, isDrawDecisionBucket, PAT_BUCKET_FOR_STANDING_PAT, BLUFF_PAT_BUCKET, NUM_BUCKETS } from "../abstraction/handBuckets";
import {
  currentStrategy,
  currentDrawStrategy,
  getOrCreateBetNode,
  getOrCreateDrawNode,
  sampleIdx,
} from "./strategy";

export interface SolverTables {
  bet: StrategyTable;
  draw: DrawStrategyTable;
  iterations: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// Betting round ends when ≥2 actions taken, no outstanding call, and the
// last action closed the action (check or call).
function bettingDone(seq: BetAction[], toCall: number): boolean {
  if (seq.length < 2 || toCall > 0) return false;
  const last = seq[seq.length - 1];
  return last === "check" || last === "call";
}

// Terminal payoff for player 0.
// Positive = P0 wins the pot; negative = P1 wins.
function showdownPayoff(b0: number, b1: number, pot: number): number {
  // BLUFF_PAT_BUCKET (≥ NUM_BUCKETS) = D3-blocker bluff-pat: loses at showdown to any genuine hand.
  const b0bluff = b0 >= NUM_BUCKETS;
  const b1bluff = b1 >= NUM_BUCKETS;
  if (b0bluff && b1bluff) return 0; // both bluffing → chop (both lose equally)
  if (b0bluff) return -pot;         // P0's bluff failed: genuine hand wins
  if (b1bluff) return pot;          // P1's bluff failed: genuine hand wins
  if (b0 < b1) return pot;          // lower bucket = stronger low hand
  if (b1 < b0) return -pot;
  return 0;
}

// ── External Sampling MCCFR ────────────────────────────────────────────────────
//
// Alternates the "traverser" role between the two players each iteration.
// Traverser → enumerate all actions (low variance).
// Opponent  → sample one action from their current strategy.
// Chance    → sample one outcome (bucket transition).
//
// Updates use linear CFR+ weighting (× iteration number t), which
// improves convergence speed over vanilla CFR+.

// Returns EV for player 0.
function cfrBet(
  street: Street,
  actor: Position,
  b: [number, number],
  bl: [BlockerBin, BlockerBin],
  bet: BettingState,
  seq: BetAction[],
  drawHist: DrawCount[][],
  carryPot: number,
  traverser: Position,
  t: number,
  tables: SolverTables,
  pos6max: [Position6Max, Position6Max],
  preflopScenario: string,
): number {
  const actions = validBetActions(bet, street);

  // Infoset: actor sees own bucket, own blocker bin, opponent's draws, and villain's range (6-max position)
  const oppIdx = (1 - actor) as Position;
  const oppDraws = drawHist.map((r) => r[oppIdx]);
  const key = infoSetKey({
    street,
    position: actor,
    myBucket: b[actor],
    myBlockerBin: bl[actor],
    opponentDrawHistory: oppDraws,
    bettingSequence: seq,
    villainPosition: pos6max[oppIdx],
    preflopScenario,
  });

  const node = getOrCreateBetNode(tables.bet, key, actions);
  const strat = currentStrategy(node);
  const nextActor = oppIdx;

  // ── Traverser node: enumerate all actions ──────────────────────────────────
  if (actor === traverser) {
    const vals: number[] = [];

    for (let ai = 0; ai < actions.length; ai++) {
      const action = actions[ai];

      if (action === "fold") {
        // Folding actor loses the whole pot to the opponent
        const pot = carryPot + bet.pot;
        vals.push(actor === 0 ? -pot : pot);
        continue;
      }

      const newBet = applyBetAction(bet, action, street);
      const newSeq = [...seq, action];

      if (bettingDone(newSeq, newBet.toCall)) {
        const streetPot = carryPot + newBet.pot;
        vals.push(
          street === 3
            ? showdownPayoff(b[0], b[1], streetPot)
            : cfrDraw(street, b, bl, drawHist, newSeq, streetPot, traverser, t, tables, pos6max, preflopScenario),
        );
      } else {
        vals.push(cfrBet(street, nextActor, b, bl, newBet, newSeq, drawHist, carryPot, traverser, t, tables, pos6max, preflopScenario));
      }
    }

    const ev = strat.reduce((s, p, ai) => s + p * vals[ai], 0);

    // Linear CFR+ update
    for (let ai = 0; ai < actions.length; ai++) {
      // EV sign: P0 maximises, P1 minimises
      const cfR = actor === 0 ? vals[ai] - ev : ev - vals[ai];
      node.regretSum[ai] = Math.max(0, node.regretSum[ai] + t * cfR);
      node.strategySum[ai] += t * strat[ai];
    }

    return ev;
  }

  // ── Opponent node: sample one action ─────────────────────────────────────
  const ai = sampleIdx(strat);
  const action = actions[ai];

  // Accumulate opponent's average strategy regardless
  node.strategySum[ai] += t * strat[ai];

  if (action === "fold") {
    const pot = carryPot + bet.pot;
    return actor === 0 ? -pot : pot;
  }

  const newBet = applyBetAction(bet, action, street);
  const newSeq = [...seq, action];

  if (bettingDone(newSeq, newBet.toCall)) {
    const streetPot = carryPot + newBet.pot;
    return street === 3
      ? showdownPayoff(b[0], b[1], streetPot)
      : cfrDraw(street, b, bl, drawHist, newSeq, streetPot, traverser, t, tables, pos6max, preflopScenario);
  }

  return cfrBet(street, nextActor, b, bl, newBet, newSeq, drawHist, carryPot, traverser, t, tables, pos6max, preflopScenario);
}

// Handles draw decisions after street `doneStreet` completes.
//
// For draw-1 (buckets 6-11) and draw-2 (buckets 12-18) buckets, a CFR decision
// node is created with two actions:
//   Action 0: draw — draw the default number of cards for this bucket, transition via sampleNextBucket
//   Action 1: pat  — stand pat, transition to PAT_BUCKET_FOR_STANDING_PAT (weakest pat bucket)
//
// D3-blocker hands (blBin=2) that stand pat are assigned BLUFF_PAT_BUCKET (= 30),
// signalling they lose at showdown against any genuine made low.
//
// All other buckets remain deterministic.
function cfrDraw(
  doneStreet: Street,
  b: [number, number],
  bl: [BlockerBin, BlockerBin],
  drawHist: DrawCount[][],
  bettingSeq: BetAction[],
  pot: number,
  traverser: Position,
  t: number,
  tables: SolverTables,
  pos6max: [Position6Max, Position6Max],
  preflopScenario: string,
): number {
  const nextStreet = (doneStreet + 1) as Street;
  const opponent = (1 - traverser) as Position;

  // ── Opponent's draw (sampled) ──────────────────────────────────────────────
  const oppB = b[opponent];
  const oppBl = bl[opponent];
  const oppDefaultDc = drawCountForBucket(oppB);
  const oppOppDraws = drawHist.map((r) => r[traverser]) as DrawCount[];

  let oppActualDc: DrawCount;
  let oppNewB: number;
  let oppNewBl: BlockerBin;

  // Bluff-pat hands continue standing pat on all subsequent streets.
  if (oppB >= NUM_BUCKETS) {
    oppActualDc = 0;
    oppNewB = BLUFF_PAT_BUCKET;
    oppNewBl = oppBl;
  } else if (isDrawDecisionBucket(oppB, oppBl)) {
    const oppKey = drawInfoSetKey(doneStreet, opponent, oppB, oppBl, oppOppDraws, bettingSeq, pos6max[traverser], preflopScenario);
    const oppNode = getOrCreateDrawNode(tables.draw, oppKey, 2);
    const oppStrat = currentDrawStrategy(oppNode);
    const oppAi = sampleIdx(oppStrat);

    oppNode.strategySum[oppAi] += t * oppStrat[oppAi];

    if (oppAi === 1) {
      oppActualDc = 0;
      // D3-blocker standing pat = bluff (always loses at showdown to genuine lows).
      // D1/D2 standing pat = potentially genuine T-low/J-low.
      oppNewB = drawCountForBucket(oppB) >= 3 ? BLUFF_PAT_BUCKET : PAT_BUCKET_FOR_STANDING_PAT;
      oppNewBl = oppBl; // standing pat: blockers unchanged
    } else {
      oppActualDc = oppDefaultDc;
      oppNewB = sampleNextBucket(oppB, oppActualDc);
      oppNewBl = sampleBlockerBinAfterDraw(oppB, oppBl, oppActualDc);
    }
  } else {
    oppActualDc = oppDefaultDc;
    oppNewB = sampleNextBucket(oppB, oppActualDc);
    oppNewBl = sampleBlockerBinAfterDraw(oppB, oppBl, oppActualDc);
  }

  // ── Traverser's draw (enumerated or deterministic) ─────────────────────────
  const travB = b[traverser];
  const travBl = bl[traverser];
  const travDefaultDc = drawCountForBucket(travB);
  const travOppDraws = drawHist.map((r) => r[opponent]) as DrawCount[];

  // Bluff-pat hands must continue standing pat on all subsequent streets.
  if (travB >= NUM_BUCKETS) {
    const newB: [number, number] = traverser === 0 ? [BLUFF_PAT_BUCKET, oppNewB] : [oppNewB, BLUFF_PAT_BUCKET];
    const newBl: [BlockerBin, BlockerBin] = traverser === 0 ? [travBl, oppNewBl] : [oppNewBl, travBl];
    const newHist: DrawCount[][] = [...drawHist, traverser === 0 ? [0 as DrawCount, oppActualDc] : [oppActualDc, 0 as DrawCount]];
    return cfrBet(nextStreet, firstToAct(nextStreet), newB, newBl, initialBettingState(nextStreet), [], newHist, pot, traverser, t, tables, pos6max, preflopScenario);
  }

  if (isDrawDecisionBucket(travB, travBl)) {
    const travKey = drawInfoSetKey(doneStreet, traverser, travB, travBl, travOppDraws, bettingSeq, pos6max[opponent], preflopScenario);
    const travNode = getOrCreateDrawNode(tables.draw, travKey, 2);
    const travStrat = currentDrawStrategy(travNode);

    const vals: number[] = [];

    for (let ai = 0; ai < 2; ai++) {
      let travActualDc: DrawCount;
      let travNewB: number;
      let travNewBl: BlockerBin;

      if (ai === 1) {
        travActualDc = 0;
        // D3-blocker standing pat = bluff (always loses at showdown to genuine lows).
        // D1/D2 standing pat = potentially genuine T-low/J-low.
        travNewB = drawCountForBucket(travB) >= 3 ? BLUFF_PAT_BUCKET : PAT_BUCKET_FOR_STANDING_PAT;
        travNewBl = travBl;
      } else {
        travActualDc = travDefaultDc;
        travNewB = sampleNextBucket(travB, travActualDc);
        travNewBl = sampleBlockerBinAfterDraw(travB, travBl, travActualDc);
      }

      const newB: [number, number] =
        traverser === 0 ? [travNewB, oppNewB] : [oppNewB, travNewB];
      const newBl: [BlockerBin, BlockerBin] =
        traverser === 0 ? [travNewBl, oppNewBl] : [oppNewBl, travNewBl];
      const newHist: DrawCount[][] = [
        ...drawHist,
        traverser === 0
          ? [travActualDc, oppActualDc]
          : [oppActualDc, travActualDc],
      ];

      vals.push(
        cfrBet(
          nextStreet,
          firstToAct(nextStreet),
          newB,
          newBl,
          initialBettingState(nextStreet),
          [],
          newHist,
          pot,
          traverser,
          t,
          tables,
          pos6max,
          preflopScenario,
        ),
      );
    }

    const ev = travStrat.reduce((s, p, ai) => s + p * vals[ai], 0);

    for (let ai = 0; ai < 2; ai++) {
      const cfR = traverser === 0 ? vals[ai] - ev : ev - vals[ai];
      travNode.regretSum[ai] = Math.max(0, travNode.regretSum[ai] + t * cfR);
      travNode.strategySum[ai] += t * travStrat[ai];
    }

    return ev;
  }

  // Deterministic (non-decision bucket)
  const travActualDc = travDefaultDc;
  const travNewB = sampleNextBucket(travB, travActualDc);
  const travNewBl = sampleBlockerBinAfterDraw(travB, travBl, travActualDc);

  const newB: [number, number] =
    traverser === 0 ? [travNewB, oppNewB] : [oppNewB, travNewB];
  const newBl: [BlockerBin, BlockerBin] =
    traverser === 0 ? [travNewBl, oppNewBl] : [oppNewBl, travNewBl];
  const newHist: DrawCount[][] = [
    ...drawHist,
    traverser === 0
      ? [travActualDc, oppActualDc]
      : [oppActualDc, travActualDc],
  ];

  return cfrBet(
    nextStreet,
    firstToAct(nextStreet),
    newB,
    newBl,
    initialBettingState(nextStreet),
    [],
    newHist,
    pot,
    traverser,
    t,
    tables,
    pos6max,
    preflopScenario,
  );
}

// ── Public entry point ─────────────────────────────────────────────────────────

// Run one external-sampling iteration for the given traverser, bucket pair, blocker bins, and 6-max positions.
// Returns the EV for player 0 from this iteration.
export function runIteration(
  traverser: Position,
  b0: number,
  bl0: BlockerBin,
  b1: number,
  bl1: BlockerBin,
  t: number,
  tables: SolverTables,
  pos0: Position6Max,
  pos1: Position6Max,
  preflopScenario: string,
): number {
  return cfrBet(
    0,
    firstToAct(0),
    [b0, b1],
    [bl0, bl1],
    initialBettingState(0),
    [],
    [],
    0,
    traverser,
    t,
    tables,
    [pos0, pos1],
    preflopScenario,
  );
}
