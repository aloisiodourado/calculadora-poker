import { Card } from "@/engine/cards";
import { createDeck } from "@/engine/cards/Deck";
import { DeuceSevenEvaluator } from "@/engine/evaluators";

// Number of hand strength buckets per street.
// Bucket 0 = strongest hand, bucket NUM_BUCKETS-1 = weakest.
export const NUM_BUCKETS = 20;

const SAMPLE_SIZE = 100_000;

const evaluator = new DeuceSevenEvaluator();

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Reference distribution of hand scores, sorted descending.
// DeuceSevenEvaluator: score = MAX_SCORE - highHandScore,
// so higher score = stronger low hand.
// sortedDesc[0] = best possible hand's score.
let _sortedDesc: number[] | null = null;

export function buildScoreDistribution(sampleSize = SAMPLE_SIZE): number[] {
  const deck = createDeck();
  const scores: number[] = [];

  for (let i = 0; i < sampleSize; i++) {
    const hand = shuffle([...deck]).slice(0, 5);
    scores.push(evaluator.evaluate(hand).score);
  }

  return scores.sort((a, b) => b - a); // descending: best first
}

// Call once before using handToBucket (no-op if already initialized).
export function initBuckets(sampleSize?: number): void {
  if (_sortedDesc) return;
  _sortedDesc = buildScoreDistribution(sampleSize);
}

function getSortedDesc(): number[] {
  if (!_sortedDesc) _sortedDesc = buildScoreDistribution();
  return _sortedDesc;
}

// What fraction of sampled hands are BETTER than this score?
// Returns [0, 1): 0 = best possible hand, 1 = worst possible hand.
function scoreToFraction(score: number, sortedDesc: number[]): number {
  // Binary search in descending array: find the first index where sortedDesc[i] <= score.
  // All elements before that index have score > score (better hands).
  let lo = 0;
  let hi = sortedDesc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedDesc[mid] > score) lo = mid + 1;
    else hi = mid;
  }
  return lo / sortedDesc.length;
}

// Maps a complete 5-card hand to a bucket index in [0, NUM_BUCKETS-1].
// Bucket 0 = strongest (best 2-7 low hand).
// Bucket NUM_BUCKETS-1 = weakest.
export function handToBucket(hand: Card[]): number {
  const { score } = evaluator.evaluate(hand);
  const sorted = getSortedDesc();
  const fraction = scoreToFraction(score, sorted);
  return Math.min(NUM_BUCKETS - 1, Math.floor(fraction * NUM_BUCKETS));
}

// Score cutoff at each bucket boundary (useful for debugging / export).
// thresholds[b] = minimum score a hand needs to be in bucket b or better.
export function getBucketThresholds(): number[] {
  const sorted = getSortedDesc();
  const segSize = Math.floor(sorted.length / NUM_BUCKETS);
  return Array.from({ length: NUM_BUCKETS }, (_, b) => sorted[b * segSize]);
}

// Human-readable label for a bucket.
export function bucketLabel(bucket: number): string {
  if (bucket === 0) return `Bucket 0 (strongest)`;
  if (bucket === NUM_BUCKETS - 1) return `Bucket ${bucket} (weakest)`;
  return `Bucket ${bucket}`;
}
