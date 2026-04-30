import { Card, Rank } from "@/engine/cards";
import { createDeck } from "@/engine/cards/Deck";

// Number of hand strength buckets per street.
// Bucket 0 = strongest draw potential, bucket NUM_BUCKETS-1 = weakest.
export const NUM_BUCKETS = 20;

const SAMPLE_SIZE = 100_000;

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Draw-potential score ───────────────────────────────────────────────────────
//
// Instead of evaluating the full 5-card hand (which unfairly penalises pairs
// of high cards that will be discarded), we score by what the player is
// "drawing to": the unique low cards they would keep.
//
// Two hands that keep the same cards score identically.
// Examples:
//   KQ632  → keep 6-3-2 (draw 2)   → score based on [6,3,2]
//   TT632  → keep 6-3-2 (draw 2)   → same score ✓
//   75432  → keep 7-5-4-3-2        → much higher score (great hand)
//   AAKQ9  → keep nothing ≤ 8      → lowest score (terrible)
//
// HIGHER score = BETTER draw potential.
// The distribution is built from random hands, then used for percentile buckets.

// Cards worth keeping: unique rank, rank ≤ 9 (8-low and 9-low are strong hands).
// Pairs are excluded — you'd never keep a pair in 2-7 lowball.
function drawPotentialScore(hand: Card[]): number {
  // Count rank occurrences to detect pairs
  const rankCount = new Map<Rank, number>();
  for (const c of hand) rankCount.set(c.rank, (rankCount.get(c.rank) ?? 0) + 1);

  // Collect unique-rank, low cards (rank 2–9) — these are the keepable cards
  const kept = hand
    .filter((c) => c.rank <= Rank.Nine && rankCount.get(c.rank) === 1)
    .sort((a, b) => a.rank - b.rank); // ascending: lower rank = better

  // Build score: [numKept, invRank0, invRank1, invRank2, invRank3, invRank4]
  // treated as a lexicographic tuple, packed into a single number.
  // invRank = (15 - rank) so lower rank → higher value → higher score.
  const r = Array.from({ length: 5 }, (_, i) => kept[i]?.rank ?? Rank.Ace);
  return (
    kept.length * 1_000_000 +
    (15 - r[0]) * 100_000 +
    (15 - r[1]) * 10_000 +
    (15 - r[2]) * 1_000 +
    (15 - r[3]) * 100 +
    (15 - r[4]) * 10
  );
}

// ── Distribution cache ────────────────────────────────────────────────────────

// Reference distribution of draw-potential scores, sorted descending.
// sortedDesc[0] = highest score = strongest draw potential.
let _sortedDesc: number[] | null = null;

export function buildScoreDistribution(sampleSize = SAMPLE_SIZE): number[] {
  const deck = createDeck();
  const scores: number[] = [];

  for (let i = 0; i < sampleSize; i++) {
    const hand = shuffle([...deck]).slice(0, 5);
    scores.push(drawPotentialScore(hand));
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
  // Binary search in descending array: find first index where sortedDesc[i] <= score.
  // Count of elements before it = count of strictly better hands.
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
// Bucket 0 = strongest draw potential (e.g. 7-5-4-3-2 → 0).
// Bucket NUM_BUCKETS-1 = weakest (e.g. AA-KK-Q with no keepable low cards).
export function handToBucket(hand: Card[]): number {
  const score = drawPotentialScore(hand);
  const sorted = getSortedDesc();
  const fraction = scoreToFraction(score, sorted);
  return Math.min(NUM_BUCKETS - 1, Math.floor(fraction * NUM_BUCKETS));
}

// Score cutoff at each bucket boundary (useful for debugging / export).
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
