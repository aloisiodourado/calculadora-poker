/**
 * External-sampling MCCFR for 3-way (3-player) Fixed-Limit 2-7 Triple Draw.
 *
 * Conventions
 * ─────────────────────────────────────────────────────────────────────────────
 * - Positions: 0 = BTN, 1 = SB, 2 = BB.
 * - Return value: EV for the traverser in small-bet units.
 *   Positive = traverser gains, negative = traverser loses.
 *   Convention: winner of a pot earns +pot, losers "owe" -pot.
 * - Traverser alternates: each iteration one player is the traverser.
 * - External sampling: traverser enumerates actions; opponents sample one.
 * - Strategy/regret updates: traverser regrets updated at traverser nodes;
 *   strategy sums updated at ALL visited nodes (all 3 players).
 */

import type { Street, Position6Max, BetAction, DrawCount, BlockerBin } from "../game/types";
import type { Position3Way, BettingState3Way, SolverTables3Way } from "../game/types3way";
import { infoSetKey3Way, drawInfoSetKey3Way } from "../game/types3way";
import {
  validBetActions3Way,
  applyBetAction3Way,
  bettingDone3Way,
  nextActor3Way,
  activePlayers3Way,
  activeCount3Way,
  initialBettingState3Way,
  firstToAct3Way,
} from "../game/rules3way";
import { sampleNextBucket, sampleBlockerBinAfterDraw } from "../abstraction/bucketTransition";
import {
  drawCountForBucket,
  isDrawDecisionBucket,
  PAT_BUCKET_FOR_STANDING_PAT,
  BLUFF_PAT_BUCKET,
  NUM_BUCKETS,
} from "../abstraction/handBuckets";
import {
  currentStrategy,
  currentDrawStrategy,
  getOrCreateBetNode,
  getOrCreateDrawNode,
  sampleIdx,
} from "./strategy";

// ── Helpers ────────────────────────────────────────────────────────────────────

// Showdown payoff for the traverser.
// Among non-folded players, the one with the lowest bucket (best 2-7 low hand)
// wins the pot. Ties split as 0 (EV-neutral approximation).
// Bluff-pat bucket (≥ NUM_BUCKETS) always loses to genuine made hands.
function showdownPayoff3Way(
  b: [number, number, number],
  folded: [boolean, boolean, boolean],
  pot: number,
  traverser: Position3Way,
): number {
  const active = activePlayers3Way(folded);
  if (active.length === 0) return 0;
  if (active.length === 1) {
    return active[0] === traverser ? pot : -pot;
  }

  // Find the best (lowest) genuine bucket among active players.
  let bestBucket = Infinity;
  let bestCount = 0;
  let bestPlayer: Position3Way = active[0];

  for (const p of active) {
    const bucket = b[p] >= NUM_BUCKETS ? Infinity : b[p]; // bluff-pat = worst possible
    if (bucket < bestBucket) {
      bestBucket = bucket;
      bestCount = 1;
      bestPlayer = p;
    } else if (bucket === bestBucket) {
      bestCount++;
    }
  }

  if (bestCount > 1) return 0; // tie — approximate as 0

  return bestPlayer === traverser ? pot : -pot;
}

// ── 3-way CFR — betting phase ──────────────────────────────────────────────────

function cfrBet3Way(
  street: Street,
  bet: BettingState3Way,
  b: [number, number, number],
  bl: [BlockerBin, BlockerBin, BlockerBin],
  seq: string[],            // "pos:action" strings, e.g. ["0:bet","1:fold"]
  drawHist: DrawCount[][], // [round][player 0..2]
  carryPot: number,
  traverser: Position3Way,
  t: number,
  tables: SolverTables3Way,
  pos6max: [Position6Max, Position6Max, Position6Max],
  preflopScenario: string,
): number {
  // If only 1 player remains (others folded), they win the carried pot.
  if (activeCount3Way(bet.folded) <= 1) {
    const last = activePlayers3Way(bet.folded)[0];
    const pot = carryPot + bet.pot;
    return last === traverser ? pot : -pot;
  }

  const actor = nextActor3Way(bet);

  // Betting done but more than 1 player active → proceed to next phase.
  if (actor === null) {
    const streetPot = carryPot + bet.pot;
    return street === 3
      ? showdownPayoff3Way(b, bet.folded, streetPot, traverser)
      : cfrDraw3Way(street, bet.folded, b, bl, drawHist, seq, streetPot, traverser, t, tables, pos6max, preflopScenario);
  }

  const actions = validBetActions3Way(bet, street);

  // Build infoset key for the acting player (opponent draws = all other players).
  const key = infoSetKey3Way(
    street, actor, b[actor], bl[actor],
    drawHist, seq, pos6max, preflopScenario,
  );
  const node = getOrCreateBetNode(tables.bet, key, actions);
  const strat = currentStrategy(node);

  // ── Traverser node: enumerate all actions ───────────────────────────────────
  if (actor === traverser) {
    const vals: number[] = [];

    for (let ai = 0; ai < actions.length; ai++) {
      const action = actions[ai];
      const newBet = applyBetAction3Way(bet, actor, action, street);
      const newSeq = [...seq, `${actor}:${action}`];

      if (bettingDone3Way(newBet)) {
        const streetPot = carryPot + newBet.pot;
        if (activeCount3Way(newBet.folded) <= 1) {
          const last = activePlayers3Way(newBet.folded)[0];
          vals.push(last === traverser ? streetPot : -streetPot);
        } else {
          vals.push(
            street === 3
              ? showdownPayoff3Way(b, newBet.folded, streetPot, traverser)
              : cfrDraw3Way(street, newBet.folded, b, bl, drawHist, newSeq, streetPot, traverser, t, tables, pos6max, preflopScenario),
          );
        }
      } else {
        vals.push(cfrBet3Way(street, newBet, b, bl, newSeq, drawHist, carryPot, traverser, t, tables, pos6max, preflopScenario));
      }
    }

    const ev = strat.reduce((s, p, ai) => s + p * vals[ai], 0);

    // Linear CFR+ update (traverser maximises)
    for (let ai = 0; ai < actions.length; ai++) {
      const cfR = vals[ai] - ev; // traverser always wants to maximise EV
      node.regretSum[ai] = Math.max(0, node.regretSum[ai] + t * cfR);
      node.strategySum[ai] += t * strat[ai];
    }

    return ev;
  }

  // ── Opponent node: sample one action ────────────────────────────────────────
  const ai = sampleIdx(strat);
  const action = actions[ai];
  node.strategySum[ai] += t * strat[ai];

  const newBet = applyBetAction3Way(bet, actor, action, street);
  const newSeq = [...seq, `${actor}:${action}`];

  if (bettingDone3Way(newBet)) {
    const streetPot = carryPot + newBet.pot;
    if (activeCount3Way(newBet.folded) <= 1) {
      const last = activePlayers3Way(newBet.folded)[0];
      return last === traverser ? streetPot : -streetPot;
    }
    return street === 3
      ? showdownPayoff3Way(b, newBet.folded, streetPot, traverser)
      : cfrDraw3Way(street, newBet.folded, b, bl, drawHist, newSeq, streetPot, traverser, t, tables, pos6max, preflopScenario);
  }

  return cfrBet3Way(street, newBet, b, bl, newSeq, drawHist, carryPot, traverser, t, tables, pos6max, preflopScenario);
}

// ── 3-way CFR — draw phase ─────────────────────────────────────────────────────
//
// Called after betting completes on streets 0-2.
// Processes each active (non-folded) player's draw decision in order [1,2,0],
// then calls cfrBet3Way for the next street.
//
// External sampling: traverser enumerates draw/pat; opponents sample one.
// Opponents are processed FIRST (sampling their draws), then the traverser is
// enumerated, because the traverser's regret requires knowing all opponents' draws.

const DRAW_ORDER: readonly Position3Way[] = [1, 2, 0];

function cfrDraw3Way(
  doneStreet: Street,
  folded: [boolean, boolean, boolean],
  b: [number, number, number],
  bl: [BlockerBin, BlockerBin, BlockerBin],
  drawHist: DrawCount[][],
  bettingSeq: string[],
  pot: number,
  traverser: Position3Way,
  t: number,
  tables: SolverTables3Way,
  pos6max: [Position6Max, Position6Max, Position6Max],
  preflopScenario: string,
): number {
  const nextStreet = (doneStreet + 1) as Street;

  // Resolve draws for each active opponent first (sampling).
  const newB: [number, number, number] = [b[0], b[1], b[2]];
  const newBl: [BlockerBin, BlockerBin, BlockerBin] = [bl[0], bl[1], bl[2]];
  const drawCounts: [DrawCount, DrawCount, DrawCount] = [0, 0, 0];

  // Collect opponent draw actions that need their strategy sums updated.
  const oppStratUpdates: Array<{ ai: number; t: number; prob: number; key: string; numActions: number }> = [];

  for (const p of DRAW_ORDER) {
    if (folded[p] || p === traverser) continue;

    const pB = b[p];
    const pBl = bl[p];

    if (pB >= NUM_BUCKETS) {
      // Bluff-pat continues standing pat.
      newB[p] = BLUFF_PAT_BUCKET;
      drawCounts[p] = 0;
    } else if (isDrawDecisionBucket(pB, pBl)) {
      // Opponent decides: draw or pat.
      const oppOppDraws = drawHist.map(r => r[traverser]) as DrawCount[];
      const key = drawInfoSetKey3Way(doneStreet, p, pB, pBl, drawHist, bettingSeq, pos6max, preflopScenario);
      const node = getOrCreateDrawNode(tables.draw, key, 2);
      const pStrat = currentDrawStrategy(node);
      const ai = sampleIdx(pStrat);
      node.strategySum[ai] += t * pStrat[ai];

      if (ai === 1) {
        // Stand pat
        drawCounts[p] = 0;
        newB[p] = drawCountForBucket(pB) >= 3 ? BLUFF_PAT_BUCKET : PAT_BUCKET_FOR_STANDING_PAT;
        newBl[p] = pBl;
      } else {
        const dc = drawCountForBucket(pB);
        drawCounts[p] = dc;
        newB[p] = sampleNextBucket(pB, dc);
        newBl[p] = sampleBlockerBinAfterDraw(pB, pBl, dc);
      }
      void oppOppDraws; // used implicitly in key
    } else {
      // Deterministic draw.
      const dc = drawCountForBucket(pB);
      drawCounts[p] = dc;
      newB[p] = sampleNextBucket(pB, dc);
      newBl[p] = sampleBlockerBinAfterDraw(pB, pBl, dc);
    }
  }

  // Build the new draw history (with this round appended) once we know all draws.
  // We enumerate the traverser's draw options below; opponent draws are fixed.

  // ── Traverser's draw ─────────────────────────────────────────────────────────
  const travB = b[traverser];
  const travBl = bl[traverser];

  function makeNewHistAndContinue(
    travNewB: number,
    travNewBl: BlockerBin,
    travDc: DrawCount,
  ): number {
    const roundDraws: [DrawCount, DrawCount, DrawCount] = [drawCounts[0], drawCounts[1], drawCounts[2]];
    roundDraws[traverser] = travDc;
    const newHist: DrawCount[][] = [...drawHist, roundDraws];
    const nextB: [number, number, number] = [newB[0], newB[1], newB[2]];
    nextB[traverser] = travNewB;
    const nextBl: [BlockerBin, BlockerBin, BlockerBin] = [newBl[0], newBl[1], newBl[2]];
    nextBl[traverser] = travNewBl;
    const nextFolded: [boolean, boolean, boolean] = [folded[0], folded[1], folded[2]];
    return cfrBet3Way(
      nextStreet,
      { ...initialBettingState3Way(nextStreet), folded: nextFolded, pot: 0 },
      nextB,
      nextBl,
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

  if (folded[traverser]) {
    // Traverser already folded — no draw decision needed, just continue.
    return makeNewHistAndContinue(travB, travBl, 0);
  }

  if (travB >= NUM_BUCKETS) {
    return makeNewHistAndContinue(BLUFF_PAT_BUCKET, travBl, 0);
  }

  if (isDrawDecisionBucket(travB, travBl)) {
    const key = drawInfoSetKey3Way(doneStreet, traverser, travB, travBl, drawHist, bettingSeq, pos6max, preflopScenario);
    const travNode = getOrCreateDrawNode(tables.draw, key, 2);
    const travStrat = currentDrawStrategy(travNode);
    const vals: number[] = [];

    for (let ai = 0; ai < 2; ai++) {
      let travNewB: number;
      let travNewBl: BlockerBin;
      let travDc: DrawCount;

      if (ai === 1) {
        // Stand pat
        travDc = 0;
        travNewB = drawCountForBucket(travB) >= 3 ? BLUFF_PAT_BUCKET : PAT_BUCKET_FOR_STANDING_PAT;
        travNewBl = travBl;
      } else {
        travDc = drawCountForBucket(travB);
        travNewB = sampleNextBucket(travB, travDc);
        travNewBl = sampleBlockerBinAfterDraw(travB, travBl, travDc);
      }
      vals.push(makeNewHistAndContinue(travNewB, travNewBl, travDc));
    }

    const ev = travStrat.reduce((s, p, ai) => s + p * vals[ai], 0);
    for (let ai = 0; ai < 2; ai++) {
      const cfR = vals[ai] - ev;
      travNode.regretSum[ai] = Math.max(0, travNode.regretSum[ai] + t * cfR);
      travNode.strategySum[ai] += t * travStrat[ai];
    }
    return ev;
  }

  // Deterministic draw.
  const dc = drawCountForBucket(travB);
  return makeNewHistAndContinue(
    sampleNextBucket(travB, dc),
    sampleBlockerBinAfterDraw(travB, travBl, dc),
    dc,
  );
}

// ── Public entry point ─────────────────────────────────────────────────────────

export function runIteration3Way(
  traverser: Position3Way,
  b0: number, bl0: BlockerBin,
  b1: number, bl1: BlockerBin,
  b2: number, bl2: BlockerBin,
  t: number,
  tables: SolverTables3Way,
  pos0: Position6Max,
  pos1: Position6Max,
  pos2: Position6Max,
  preflopScenario: string,
): number {
  return cfrBet3Way(
    0,
    initialBettingState3Way(0),
    [b0, b1, b2],
    [bl0, bl1, bl2],
    [],
    [],
    0,
    traverser,
    t,
    tables,
    [pos0, pos1, pos2],
    preflopScenario,
  );
}

export type { SolverTables3Way };
