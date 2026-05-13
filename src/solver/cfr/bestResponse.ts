/**
 * Sampled best-response exploitability estimator for the 2-7 Triple Draw solver.
 *
 * Exploitability = (BR_P0 + BR_P1) / 2, where BR_Px is the EV gain that player x
 * would achieve by playing a best response against the opponent's average strategy.
 * At Nash equilibrium, exploitability = 0.
 *
 * This uses Monte Carlo sampling: for each sample, the best-response player
 * maximises EV at every decision node, while the opponent follows their average
 * strategy (weighted random).
 */

import {
  Street,
  Position,
  Position6Max,
  BetAction,
  DrawCount,
  BlockerBin,
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
import {
  drawCountForBucket,
  isDrawDecisionBucket,
  PAT_BUCKET_FOR_STANDING_PAT,
  BLUFF_PAT_BUCKET,
  NUM_BUCKETS,
  sampleBlockerBinForBucket,
} from "../abstraction/handBuckets";
import { averageStrategy, averageDrawStrategy } from "./strategy";
import { sampleBucketForPosition, samplePosition } from "../game/ranges";
import type { SolverTables } from "./cfr";

// ── Helpers ────────────────────────────────────────────────────────────────────

function bettingDone(seq: BetAction[], toCall: number): boolean {
  if (seq.length < 2 || toCall > 0) return false;
  const last = seq[seq.length - 1];
  return last === "check" || last === "call";
}

function showdownPayoff(b0: number, b1: number, pot: number): number {
  const b0bluff = b0 >= NUM_BUCKETS;
  const b1bluff = b1 >= NUM_BUCKETS;
  if (b0bluff && b1bluff) return 0;
  if (b0bluff) return -pot;
  if (b1bluff) return pot;
  if (b0 < b1) return pot;
  if (b1 < b0) return -pot;
  return 0;
}

function sampleIdx(probs: number[]): number {
  let r = Math.random();
  for (let i = 0; i < probs.length; i++) {
    r -= probs[i];
    if (r <= 0) return i;
  }
  return probs.length - 1;
}

// ── Best-response traversal ────────────────────────────────────────────────────

function brBet(
  street: Street,
  actor: Position,
  b: [number, number],
  bl: [BlockerBin, BlockerBin],
  bet: BettingState,
  seq: BetAction[],
  drawHist: DrawCount[][],
  carryPot: number,
  brPlayer: Position,
  pos6max: [Position6Max, Position6Max],
  tables: SolverTables,
  preflopScenario: string,
): number {
  const actions = validBetActions(bet, street);
  const oppIdx = (1 - actor) as Position;
  const oppDraws = drawHist.map((r) => r[oppIdx]);

  const keyArgs = {
    street,
    position: actor,
    myBucket: b[actor],
    myBlockerBin: bl[actor],
    opponentDrawHistory: oppDraws,
    bettingSequence: seq,
    villainPosition: pos6max[oppIdx],
    preflopScenario,
  };

  if (actor === brPlayer) {
    // Best-response player: take the action with maximum EV
    let best = -Infinity;
    for (const action of actions) {
      let val: number;
      if (action === "fold") {
        const pot = carryPot + bet.pot;
        val = actor === 0 ? -pot : pot;
      } else {
        const newBet = applyBetAction(bet, action, street);
        const newSeq = [...seq, action];
        if (bettingDone(newSeq, newBet.toCall)) {
          const streetPot = carryPot + newBet.pot;
          val = street === 3
            ? showdownPayoff(b[0], b[1], streetPot)
            : brDraw(street, b, bl, drawHist, newSeq, streetPot, brPlayer, pos6max, tables, preflopScenario);
        } else {
          val = brBet(street, oppIdx, b, bl, newBet, newSeq, drawHist, carryPot, brPlayer, pos6max, tables, preflopScenario);
        }
      }
      // Convert to brPlayer's perspective
      const brVal = brPlayer === 0 ? val : -val;
      if (brVal > best) best = brVal;
    }
    return brPlayer === 0 ? best : -best;
  }

  // Opponent: weighted average over their average strategy
  const node = tables.bet.get(infoSetKey(keyArgs));
  const strat = node ? averageStrategy(node) : actions.map(() => 1 / actions.length);

  let ev = 0;
  for (let ai = 0; ai < actions.length; ai++) {
    const action = actions[ai];
    let val: number;
    if (action === "fold") {
      const pot = carryPot + bet.pot;
      val = actor === 0 ? -pot : pot;
    } else {
      const newBet = applyBetAction(bet, action, street);
      const newSeq = [...seq, action];
      if (bettingDone(newSeq, newBet.toCall)) {
        const streetPot = carryPot + newBet.pot;
        val = street === 3
          ? showdownPayoff(b[0], b[1], streetPot)
          : brDraw(street, b, bl, drawHist, newSeq, streetPot, brPlayer, pos6max, tables, preflopScenario);
      } else {
        val = brBet(street, oppIdx, b, bl, newBet, newSeq, drawHist, carryPot, brPlayer, pos6max, tables, preflopScenario);
      }
    }
    ev += strat[ai] * val;
  }
  return ev;
}

function brDraw(
  doneStreet: Street,
  b: [number, number],
  bl: [BlockerBin, BlockerBin],
  drawHist: DrawCount[][],
  bettingSeq: BetAction[],
  pot: number,
  brPlayer: Position,
  pos6max: [Position6Max, Position6Max],
  tables: SolverTables,
  preflopScenario: string,
): number {
  const nextStreet = (doneStreet + 1) as Street;
  const opponent = (1 - brPlayer) as Position;

  // ── Opponent draws (sampled from their strategy or default) ──────────────────
  const oppB = b[opponent];
  const oppBl = bl[opponent];
  const oppDefaultDc = drawCountForBucket(oppB);
  const oppOppDraws = drawHist.map((r) => r[brPlayer]) as DrawCount[];

  let oppActualDc: DrawCount;
  let oppNewB: number;
  let oppNewBl: BlockerBin;

  if (oppB >= NUM_BUCKETS) {
    oppActualDc = 0;
    oppNewB = BLUFF_PAT_BUCKET;
    oppNewBl = oppBl;
  } else if (isDrawDecisionBucket(oppB, oppBl)) {
    const oppKey = drawInfoSetKey(doneStreet, opponent, oppB, oppBl, oppOppDraws, bettingSeq, pos6max[brPlayer], preflopScenario);
    const oppNode = tables.draw.get(oppKey);
    const oppStrat = oppNode ? averageDrawStrategy(oppNode) : [0.5, 0.5];
    const oppAi = sampleIdx(oppStrat);
    if (oppAi === 1) {
      oppActualDc = 0;
      oppNewB = drawCountForBucket(oppB) >= 3 ? BLUFF_PAT_BUCKET : PAT_BUCKET_FOR_STANDING_PAT;
      oppNewBl = oppBl;
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

  // ── BR player draws ────────────────────────────────────────────────────────
  const travB = b[brPlayer];
  const travBl = bl[brPlayer];
  const travDefaultDc = drawCountForBucket(travB);
  const travOppDraws = drawHist.map((r) => r[opponent]) as DrawCount[];

  if (travB >= NUM_BUCKETS) {
    const newB: [number, number] = brPlayer === 0 ? [BLUFF_PAT_BUCKET, oppNewB] : [oppNewB, BLUFF_PAT_BUCKET];
    const newBl: [BlockerBin, BlockerBin] = brPlayer === 0 ? [travBl, oppNewBl] : [oppNewBl, travBl];
    const newHist: DrawCount[][] = [...drawHist, brPlayer === 0 ? [0 as DrawCount, oppActualDc] : [oppActualDc, 0 as DrawCount]];
    return brBet(nextStreet, firstToAct(nextStreet), newB, newBl, initialBettingState(nextStreet), [], newHist, pot, brPlayer, pos6max, tables, preflopScenario);
  }

  if (isDrawDecisionBucket(travB, travBl)) {
    const travKey = drawInfoSetKey(doneStreet, brPlayer, travB, travBl, travOppDraws, bettingSeq, pos6max[opponent], preflopScenario);
    const travNode = tables.draw.get(travKey);
    const travStrat = travNode ? averageDrawStrategy(travNode) : [0.5, 0.5];

    // BR player: pick the best draw action
    let bestVal = -Infinity;
    for (let ai = 0; ai < 2; ai++) {
      let travActualDc: DrawCount;
      let travNewB: number;
      let travNewBl: BlockerBin;
      if (ai === 1) {
        travActualDc = 0;
        travNewB = drawCountForBucket(travB) >= 3 ? BLUFF_PAT_BUCKET : PAT_BUCKET_FOR_STANDING_PAT;
        travNewBl = travBl;
      } else {
        travActualDc = travDefaultDc;
        travNewB = sampleNextBucket(travB, travActualDc);
        travNewBl = sampleBlockerBinAfterDraw(travB, travBl, travActualDc);
      }
      const newB: [number, number] = brPlayer === 0 ? [travNewB, oppNewB] : [oppNewB, travNewB];
      const newBl: [BlockerBin, BlockerBin] = brPlayer === 0 ? [travNewBl, oppNewBl] : [oppNewBl, travNewBl];
      const newHist: DrawCount[][] = [...drawHist, brPlayer === 0 ? [travActualDc, oppActualDc] : [oppActualDc, travActualDc]];
      const val = brBet(nextStreet, firstToAct(nextStreet), newB, newBl, initialBettingState(nextStreet), [], newHist, pot, brPlayer, pos6max, tables, preflopScenario);
      const brVal = brPlayer === 0 ? val : -val;
      if (brVal > bestVal) bestVal = brVal;
    }
    void travStrat; // BR ignores current strategy — always maximises
    return brPlayer === 0 ? bestVal : -bestVal;
  }

  // Deterministic draw
  const travActualDc = travDefaultDc;
  const travNewB = sampleNextBucket(travB, travActualDc);
  const travNewBl = sampleBlockerBinAfterDraw(travB, travBl, travActualDc);
  const newB: [number, number] = brPlayer === 0 ? [travNewB, oppNewB] : [oppNewB, travNewB];
  const newBl: [BlockerBin, BlockerBin] = brPlayer === 0 ? [travNewBl, oppNewBl] : [oppNewBl, travNewBl];
  const newHist: DrawCount[][] = [...drawHist, brPlayer === 0 ? [travActualDc, oppActualDc] : [oppActualDc, travActualDc]];
  return brBet(nextStreet, firstToAct(nextStreet), newB, newBl, initialBettingState(nextStreet), [], newHist, pot, brPlayer, pos6max, tables, preflopScenario);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Estimate exploitability in small-bet units per hand.
 * Uses Monte Carlo best-response: for each sample, one player plays BR while
 * the other follows their average strategy.
 *
 * At Nash equilibrium, exploitability → 0.
 * A value of 0.1 means a best-responder gains ~0.1 SB/hand over the current strategy.
 */
export function estimateExploitability(
  tables: SolverTables,
  samples = 500,
  preflopScenario = "SR",
): number {
  let totalBR = 0;

  for (const brPlayer of [0, 1] as Position[]) {
    let sumEV = 0;

    for (let i = 0; i < samples; i++) {
      const p0 = samplePosition();
      const p1 = samplePosition();
      const b0 = sampleBucketForPosition(p0);
      const b1 = sampleBucketForPosition(p1);
      const bl0 = sampleBlockerBinForBucket(b0) as BlockerBin;
      const bl1 = sampleBlockerBinForBucket(b1) as BlockerBin;

      const ev = brBet(
        0, firstToAct(0),
        [b0, b1], [bl0, bl1],
        initialBettingState(0), [], [], 0,
        brPlayer, [p0, p1], tables, preflopScenario,
      );

      // Convert to brPlayer's EV (brBet returns P0-centric EV)
      sumEV += brPlayer === 0 ? ev : -ev;
    }

    // Average best-response EV for this player
    totalBR += sumEV / samples;
  }

  // Exploitability = average of both players' BR gains
  return totalBR / 2;
}
