import {
  Street,
  Position,
  BetAction,
  DrawCount,
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
import { sampleNextBucket } from "../abstraction/bucketTransition";
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
  if (b0 < b1) return pot;   // lower bucket = stronger low hand
  if (b1 < b0) return -pot;
  return 0;                   // chop
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
  bet: BettingState,
  seq: BetAction[],
  drawHist: DrawCount[][],
  carryPot: number,
  traverser: Position,
  t: number,
  tables: SolverTables,
): number {
  const actions = validBetActions(bet, street);

  // Infoset: actor sees their own bucket + opponent's previous draw counts
  const oppIdx = (1 - actor) as Position;
  const oppDraws = drawHist.map((r) => r[oppIdx]);
  const key = infoSetKey({
    street,
    position: actor,
    myBucket: b[actor],
    opponentDrawHistory: oppDraws,
    bettingSequence: seq,
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
            : cfrDraw(street, b, drawHist, streetPot, traverser, t, tables),
        );
      } else {
        vals.push(cfrBet(street, nextActor, b, newBet, newSeq, drawHist, carryPot, traverser, t, tables));
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
      : cfrDraw(street, b, drawHist, streetPot, traverser, t, tables);
  }

  return cfrBet(street, nextActor, b, newBet, newSeq, drawHist, carryPot, traverser, t, tables);
}

// Handles draw decisions after street `doneStreet` completes.
//
// v1 approach: outcome sampling for draws.
// Both players' draw counts are sampled from their current strategy.
// This avoids the 6^3 branching that would arise from enumerating all
// draw combinations across 3 rounds. The betting strategy (the primary
// objective) is still learned correctly via external sampling.
// Draw strategy accumulates via strategySum but is not regret-updated
// (upgrade path: switch to external sampling for draws in v2).
function cfrDraw(
  doneStreet: Street,
  b: [number, number],
  drawHist: DrawCount[][],
  pot: number,
  traverser: Position,
  t: number,
  tables: SolverTables,
): number {
  const nextStreet = (doneStreet + 1) as Street;

  const dk0 = drawInfoSetKey(nextStreet, 0, b[0]);
  const dk1 = drawInfoSetKey(nextStreet, 1, b[1]);
  const n0 = getOrCreateDrawNode(tables.draw, dk0);
  const n1 = getOrCreateDrawNode(tables.draw, dk1);
  const s0 = currentDrawStrategy(n0);
  const s1 = currentDrawStrategy(n1);

  // Sample both draws from current strategies
  const dc0 = sampleIdx(s0) as DrawCount;
  const dc1 = sampleIdx(s1) as DrawCount;

  // Track which draw counts are being visited (used for average strategy)
  n0.strategySum[dc0] += t;
  n1.strategySum[dc1] += t;

  const newB0 = sampleNextBucket(b[0], dc0);
  const newB1 = sampleNextBucket(b[1], dc1);
  const newHist: DrawCount[][] = [...drawHist, [dc0, dc1]];

  return cfrBet(
    nextStreet,
    firstToAct(nextStreet),
    [newB0, newB1],
    initialBettingState(nextStreet),
    [],
    newHist,
    pot,
    traverser,
    t,
    tables,
  );
}

// ── Public entry point ─────────────────────────────────────────────────────────

// Run one external-sampling iteration for the given traverser and bucket pair.
// Returns the EV for player 0 from this iteration.
export function runIteration(
  traverser: Position,
  b0: number,
  b1: number,
  t: number,
  tables: SolverTables,
): number {
  return cfrBet(
    0,
    firstToAct(0),
    [b0, b1],
    initialBettingState(0),
    [],
    [],
    0,
    traverser,
    t,
    tables,
  );
}
