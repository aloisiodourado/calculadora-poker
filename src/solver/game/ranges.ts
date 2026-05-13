import { NUM_BUCKETS } from "../abstraction/handBuckets";
import type { Position6Max } from "./types";

export const ALL_POSITIONS_6MAX: readonly Position6Max[] = [
  "UTG", "HJ", "CO", "BTN", "SB", "BB",
];

// Approximate opening range percentages for 6-max 2-7 Triple Draw.
// These reflect typical opening frequencies at each seat.
export const OPENING_PCT: Record<Position6Max, number> = {
  UTG: 0.15,
  HJ:  0.22,
  CO:  0.30,
  BTN: 0.45,
  SB:  0.35,
  BB:  0.60, // BB defends wide vs single raise
};

// ── Bucket layout (must mirror handBuckets.ts) ─────────────────────────────────
// DRAW_ALLOC = [6, 6, 7, 5, 5, 1] — pat, draw-1, draw-2, draw-3, draw-4, draw-5

const DRAW_ALLOC = [6, 6, 7, 5, 5, 1] as const;
const DRAW_OFFSET = DRAW_ALLOC.reduce<number[]>((acc, n, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + DRAW_ALLOC[i - 1]);
  return acc;
}, []);

// ── Group weights per position ─────────────────────────────────────────────────
//
// GROUP_WEIGHT[pos][drawCount] = relative probability that a player at `pos`
// holds a hand in that draw-count group.
//
// Reasoning:
//   UTG opens only premium hands → nearly all pat or strong draw-1
//   BTN opens ~45% → includes draw-2 freely, some draw-3
//   BB defends very wide → even weak draw-2 and some draw-3 stay in
//
// Indexed: [pat, draw-1, draw-2, draw-3, draw-4, draw-5]
export const GROUP_WEIGHT: Record<Position6Max, readonly number[]> = {
  UTG: [1.00, 0.75, 0.15, 0.02, 0.003, 0.001],
  HJ:  [1.00, 0.85, 0.28, 0.04, 0.008, 0.001],
  CO:  [1.00, 0.95, 0.48, 0.09, 0.018, 0.001],
  BTN: [1.00, 1.00, 0.78, 0.22, 0.045, 0.004],
  SB:  [1.00, 0.95, 0.62, 0.13, 0.025, 0.002],
  BB:  [1.00, 1.00, 1.00, 0.48, 0.140, 0.018],
};

// Within each draw-count group, the best bucket (local index 0) has full group
// weight; the worst bucket decays to this fraction of the group weight.
// Models that the strongest hands within a group are most likely to be played.
const WITHIN_GROUP_DECAY = 0.20;

function buildWeightsForPosition(pos: Position6Max): number[] {
  const weights = new Array<number>(NUM_BUCKETS).fill(0);
  const gw = GROUP_WEIGHT[pos];

  for (let d = 0; d <= 5; d++) {
    const alloc = DRAW_ALLOC[d];
    const offset = DRAW_OFFSET[d];
    const groupW = gw[d];

    for (let l = 0; l < alloc; l++) {
      // Linear decay within group: best bucket → groupW, worst → groupW × DECAY
      const localDecay =
        alloc === 1 ? 1.0 : 1 - (1 - WITHIN_GROUP_DECAY) * (l / (alloc - 1));
      weights[offset + l] = groupW * localDecay;
    }
  }

  const sum = weights.reduce((a, w) => a + w, 0);
  return weights.map((w) => w / sum);
}

// Pre-built and cached weight vectors: rangeWeights[pos][bucket] = probability
const _rangeWeights = new Map<Position6Max, number[]>();

export function getRangeWeights(pos: Position6Max): number[] {
  let w = _rangeWeights.get(pos);
  if (!w) {
    w = buildWeightsForPosition(pos);
    _rangeWeights.set(pos, w);
  }
  return w;
}

// Sample a bucket from the positional range distribution.
// Used in the training loop to bias bucket sampling toward realistic opening ranges.
export function sampleBucketForPosition(pos: Position6Max): number {
  const weights = getRangeWeights(pos);
  const r = Math.random();
  let cumsum = 0;
  for (let b = 0; b < weights.length; b++) {
    cumsum += weights[b];
    if (r <= cumsum) return b;
  }
  return weights.length - 1;
}

// Sample a uniformly random 6-max position.
export function samplePosition(): Position6Max {
  return ALL_POSITIONS_6MAX[
    Math.floor(Math.random() * ALL_POSITIONS_6MAX.length)
  ] as Position6Max;
}
