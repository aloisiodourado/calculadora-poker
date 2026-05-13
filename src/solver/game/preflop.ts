/**
 * Fase 2 — Preflop scenario modeling for 6-max 2-7 Triple Draw.
 *
 * A PreflopScenario encodes how both players arrived at the HU post-flop game.
 * It conditions both players' hand-bucket distributions AND appears in the
 * infoset key, allowing CFR to learn different strategies per scenario type.
 *
 * Scenarios:
 *   SR   — Single Raise: one player opened, the other called.
 *          Standard HU ranges apply (use base GROUP_WEIGHT from ranges.ts).
 *
 *   3B   — 3-Bet Pot: pos0 opened, pos1 re-raised (3-bet), pos0 called.
 *          pos0 has a "call-3-bet" range (tight); pos1 has a "3-bet" range (polarised/strong).
 *
 *   LP   — Limp Pot: pos0 limped (completed the blind), pos1 checked.
 *          pos0 has a wider/speculative range; post-flop is an unraised pot.
 *
 * Training samples scenarios with realistic frequencies; the UI lets the user
 * select the scenario that matches their current hand history.
 */

import { NUM_BUCKETS } from "../abstraction/handBuckets";
import type { Position6Max } from "./types";
import { GROUP_WEIGHT, ALL_POSITIONS_6MAX, OPENING_PCT } from "./ranges";

export type PreflopScenario = "SR" | "3B" | "LP";

export const ALL_PREFLOP_SCENARIOS: readonly PreflopScenario[] = ["SR", "3B", "LP"] as const;

// Human-readable labels for the UI
export const PREFLOP_SCENARIO_LABELS: Record<PreflopScenario, string> = {
  SR: "Single raise (padrão)",
  "3B": "3-bet pot (reraised)",
  LP: "Limp pot (sem raise)",
};

// Approximate frequency of each preflop scenario in 6-max HU play
const SCENARIO_FREQ: Record<PreflopScenario, number> = {
  SR: 0.65, // most common — one raise, called
  "3B": 0.25, // significant — 3-bet pots are common in 6-max
  LP: 0.10, // limping is less frequent
};

// ── Range conditioning multipliers ────────────────────────────────────────────
//
// For each scenario and player role (pos0 = structural SB/BTN, pos1 = structural BB),
// these multipliers scale the base GROUP_WEIGHT by draw-count group.
// group indices: [pat, d1, d2, d3, d4, d5]
//
// pos0 in SR: standard opener (base weights unchanged)
// pos0 in 3B: called a 3-bet → tight range (only strong hands call 3-bets)
// pos0 in LP: limped → includes hands too weak to open-raise but worth seeing a cheap flop
//
// pos1 in SR: BB defending a raise → wide range (all but weakest hands)
// pos1 in 3B: 3-bettor → semi-polar: strong hands + some bluffs
// pos1 in LP: BB checking / not raising → very wide (free flop)

const SCENARIO_MULT: Record<PreflopScenario, {
  pos0: readonly number[]; // multipliers for pos0's GROUP_WEIGHT (BTN/opener in HU; BTN in 3-way)
  pos1: readonly number[]; // multipliers for pos1's GROUP_WEIGHT (BB in HU; SB in 3-way)
  pos2: readonly number[]; // multipliers for pos2's GROUP_WEIGHT (BB in 3-way only)
}> = {
  SR: {
    pos0: [1.00, 1.00, 1.00, 1.00, 1.00, 1.00], // baseline (opener)
    pos1: [1.00, 1.00, 1.00, 1.00, 1.00, 1.00], // HU BB / 3-way SB: full baseline
    // 3-way BB SR: cheapest price to call, defends wider than SB — more d2/d3 speculative hands.
    pos2: [1.00, 1.00, 1.10, 0.65, 0.20, 0.04],
  },
  "3B": {
    pos0: [1.00, 0.80, 0.42, 0.08, 0.01, 0.005], // calling 3-bet: very tight
    pos1: [1.00, 0.78, 0.35, 0.06, 0.01, 0.003], // 3-betting / SB cold-calling 3B
    // 3-way BB in 3B pot: must cold-call multiple bets — tightest spot.
    pos2: [1.00, 0.70, 0.28, 0.03, 0.005, 0.001],
  },
  LP: {
    pos0: [0.40, 1.00, 1.20, 0.90, 0.40, 0.10], // limping: skips pats/strong d1
    pos1: [1.00, 1.00, 1.20, 1.10, 0.60, 0.15], // HU BB check / 3-way SB: wide
    // 3-way BB LP: completely free look — widest range of all roles.
    pos2: [1.00, 1.00, 1.30, 1.20, 0.80, 0.25],
  },
};

// ── Bucket layout (mirrors handBuckets.ts) ────────────────────────────────────

const DRAW_ALLOC = [6, 6, 7, 5, 5, 1] as const;
const DRAW_OFFSET = DRAW_ALLOC.reduce<number[]>((acc, _, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + DRAW_ALLOC[i - 1]);
  return acc;
}, []);

// ── Weight computation ─────────────────────────────────────────────────────────

const WITHIN_GROUP_DECAY = 0.20;

function buildConditionedWeights(
  pos: Position6Max,
  role: "pos0" | "pos1" | "pos2",
  scenario: PreflopScenario,
): number[] {
  const baseGW = GROUP_WEIGHT[pos];
  const mult = SCENARIO_MULT[scenario][role];
  const weights = new Array<number>(NUM_BUCKETS).fill(0);

  for (let d = 0; d <= 5; d++) {
    const alloc = DRAW_ALLOC[d];
    const offset = DRAW_OFFSET[d];
    const groupW = baseGW[d] * mult[d];

    for (let l = 0; l < alloc; l++) {
      const localDecay =
        alloc === 1 ? 1.0 : 1 - (1 - WITHIN_GROUP_DECAY) * (l / (alloc - 1));
      weights[offset + l] = groupW * localDecay;
    }
  }

  const sum = weights.reduce((a, w) => a + w, 0);
  return sum > 0 ? weights.map((w) => w / sum) : weights.map(() => 1 / NUM_BUCKETS);
}

// Pre-built conditioned weight cache
const _conditionedWeights = new Map<string, number[]>();

function cacheKey(pos: Position6Max, role: "pos0" | "pos1" | "pos2", scenario: PreflopScenario): string {
  return `${pos}:${role}:${scenario}`;
}

export function getConditionedWeights(
  pos: Position6Max,
  role: "pos0" | "pos1" | "pos2",
  scenario: PreflopScenario,
): number[] {
  const key = cacheKey(pos, role, scenario);
  let w = _conditionedWeights.get(key);
  if (!w) {
    w = buildConditionedWeights(pos, role, scenario);
    _conditionedWeights.set(key, w);
  }
  return w;
}

// Sample a bucket for a player given their position, structural role, and preflop scenario
export function sampleBucketConditioned(
  pos: Position6Max,
  role: "pos0" | "pos1" | "pos2",
  scenario: PreflopScenario,
): number {
  const weights = getConditionedWeights(pos, role, scenario);
  const r = Math.random();
  let cumsum = 0;
  for (let b = 0; b < weights.length; b++) {
    cumsum += weights[b];
    if (r <= cumsum) return b;
  }
  return weights.length - 1;
}

// Sample a preflop scenario according to realistic frequencies
export function samplePreflopScenario(): PreflopScenario {
  const r = Math.random();
  let cumsum = 0;
  for (const scenario of ALL_PREFLOP_SCENARIOS) {
    cumsum += SCENARIO_FREQ[scenario];
    if (r <= cumsum) return scenario;
  }
  return "SR";
}

// For export in JSON metadata
export { OPENING_PCT, ALL_POSITIONS_6MAX };
