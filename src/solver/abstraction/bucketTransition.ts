import { createDeck, removeCards } from "@/engine/cards/Deck";
import { Card } from "@/engine/cards";
import { DrawCount } from "../game/types";
import type { BlockerBin } from "../game/types";
import { NUM_BUCKETS, handToBucket, initBuckets, blockerBinForHand } from "./handBuckets";
import { keepIndicesForDraw } from "../game/draw";

// TransitionMatrix[fromBucket][drawCount][toBucket] = probability
export type TransitionMatrix = number[][][];

// Samples per bucket used when building the transition matrix.
// Higher = more accurate but slower to build.
const SAMPLES_PER_BUCKET = 500;

let _matrix: TransitionMatrix | null = null;

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Collect representative hands for each bucket by random sampling.
function sampleHandsPerBucket(samplesPerBucket: number): Card[][][] {
  const deck = createDeck();
  const bucketHands: Card[][][] = Array.from({ length: NUM_BUCKETS }, () => []);
  const target = samplesPerBucket;

  // Keep sampling until every bucket has enough hands.
  // In practice this terminates quickly — each bucket covers ~5% of hands.
  let attempts = 0;
  while (bucketHands.some((b) => b.length < target) && attempts < target * NUM_BUCKETS * 20) {
    const hand = shuffle([...deck]).slice(0, 5);
    const b = handToBucket(hand);
    if (bucketHands[b].length < target) bucketHands[b].push(hand);
    attempts++;
  }

  return bucketHands;
}

// Build the full transition matrix via Monte Carlo simulation.
// For each (fromBucket, drawCount), simulates SAMPLES_PER_BUCKET draws and
// records the resulting bucket distribution.
export function buildTransitionMatrix(samplesPerBucket = SAMPLES_PER_BUCKET): TransitionMatrix {
  initBuckets();

  const deck = createDeck();
  const bucketHands = sampleHandsPerBucket(samplesPerBucket);

  // Allocate counts matrix (will be normalized to probabilities)
  const matrix: TransitionMatrix = Array.from({ length: NUM_BUCKETS }, () =>
    Array.from({ length: 6 }, () => new Array(NUM_BUCKETS).fill(0))
  );

  for (let b = 0; b < NUM_BUCKETS; b++) {
    for (let drawCount = 0; drawCount <= 5; drawCount++) {
      const counts = matrix[b][drawCount];

      for (const hand of bucketHands[b]) {
        // Determine which cards to keep using the greedy keep heuristic
        const keepIdx = keepIndicesForDraw(hand, drawCount as DrawCount);
        const kept = keepIdx.map((i) => hand[i]);

        // Deal `drawCount` replacement cards from the remaining deck
        const remaining = removeCards(deck, kept);
        const drawn = shuffle([...remaining]).slice(0, drawCount);

        const newHand = [...kept, ...drawn];
        const newBucket = handToBucket(newHand);
        counts[newBucket]++;
      }

      // Normalise counts → probabilities
      const total = counts.reduce((s, c) => s + c, 0);
      if (total > 0) {
        for (let nb = 0; nb < NUM_BUCKETS; nb++) counts[nb] /= total;
      } else {
        // Fallback: uniform (should not happen with sufficient samples)
        for (let nb = 0; nb < NUM_BUCKETS; nb++) counts[nb] = 1 / NUM_BUCKETS;
      }
    }
  }

  return matrix;
}

// Initialise the transition matrix (idempotent).
export function initTransitionMatrix(samplesPerBucket?: number): void {
  if (_matrix) return;
  _matrix = buildTransitionMatrix(samplesPerBucket);
}

function getMatrix(): TransitionMatrix {
  if (!_matrix) _matrix = buildTransitionMatrix();
  return _matrix;
}

// Returns the full probability distribution over next-street buckets
// given the current bucket and how many cards will be drawn.
export function transitionDistribution(fromBucket: number, drawCount: DrawCount): number[] {
  return getMatrix()[fromBucket][drawCount];
}

// Samples a single next-street bucket from the transition distribution.
// Used in Monte Carlo CFR tree traversal.
export function sampleNextBucket(fromBucket: number, drawCount: DrawCount): number {
  const dist = transitionDistribution(fromBucket, drawCount);
  let cumulative = 0;
  const r = Math.random();
  for (let b = 0; b < dist.length; b++) {
    cumulative += dist[b];
    if (r < cumulative) return b;
  }
  return dist.length - 1;
}

// Serialise the matrix to a plain object for JSON export / caching.
export function exportMatrix(matrix: TransitionMatrix): number[][][] {
  return matrix;
}

export function importMatrix(data: number[][][]): TransitionMatrix {
  return data;
}

// ── Blocker transition matrix ──────────────────────────────────────────────────
//
// BlockerTransition[oldBucket][oldBl][drawCount] → [prob_bl0, prob_bl1, prob_bl2]
//
// More accurate than the marginal P(newBl | newBucket): if you held two 2s
// and kept one while drawing, your new blockerBin is correlated with the old one.

type BlockerTransitionMatrix = number[][][][]; // [bucket][oldBl][drawCount][newBl]

let _blockerTransition: BlockerTransitionMatrix | null = null;

export function initBlockerTransition(samplesPerBucket = SAMPLES_PER_BUCKET): void {
  if (_blockerTransition) return;

  const bucketHands = sampleHandsPerBucket(samplesPerBucket);
  const deck = createDeck();

  // counts[b][oldBl][dc][newBl]
  const counts: number[][][][] = Array.from({ length: NUM_BUCKETS }, () =>
    Array.from({ length: 3 }, () =>
      Array.from({ length: 6 }, () => [0, 0, 0])
    )
  );
  const totals: number[][][] = Array.from({ length: NUM_BUCKETS }, () =>
    Array.from({ length: 3 }, () => new Array(6).fill(0))
  );

  for (let b = 0; b < NUM_BUCKETS; b++) {
    for (const hand of bucketHands[b]) {
      const oldBl = blockerBinForHand(hand);

      for (let dc = 0; dc <= 5; dc++) {
        const keepIdx = keepIndicesForDraw(hand, dc as DrawCount);
        const kept = keepIdx.map((i) => hand[i]);
        const remaining = removeCards(deck, kept);
        const drawn = shuffle([...remaining]).slice(0, dc);
        const newHand = [...kept, ...drawn];
        const newBl = blockerBinForHand(newHand);

        counts[b][oldBl][dc][newBl]++;
        totals[b][oldBl][dc]++;
      }
    }
  }

  _blockerTransition = counts.map((bData, b) =>
    bData.map((blData, oldBl) =>
      blData.map((dcData, dc) => {
        const total = totals[b][oldBl][dc];
        if (total === 0) return [1 / 3, 1 / 3, 1 / 3];
        return dcData.map((c) => c / total);
      })
    )
  );
}

// Sample the new blockerBin after drawing drawCount cards, using the full
// transition matrix P(newBl | oldBucket, oldBl, drawCount).
// Falls back to marginal if transition matrix is not initialised.
export function sampleBlockerBinAfterDraw(
  oldBucket: number,
  oldBl: BlockerBin,
  drawCount: DrawCount,
): BlockerBin {
  if (!_blockerTransition) initBlockerTransition();
  const dist = _blockerTransition![oldBucket][oldBl][drawCount];
  const r = Math.random();
  if (r < dist[0]) return 0;
  if (r < dist[0] + dist[1]) return 1;
  return 2;
}
