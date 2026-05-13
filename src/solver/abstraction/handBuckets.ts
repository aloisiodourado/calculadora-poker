import { Card, Rank } from "@/engine/cards";
import { createDeck } from "@/engine/cards/Deck";
import type { DrawCount, BlockerBin } from "@/solver/game/types";

// ── Bucket layout ──────────────────────────────────────────────────────────────
//
// 30 buckets allocated hierarchically:
//   1. Primary dimension: draw count (how many cards are discarded)
//   2. Secondary dimension: quality percentile within each draw-count group
//
// Allocation per draw count (must sum to NUM_BUCKETS):
//   draw 0 (pat)  → 6  buckets  — critical to distinguish 75432 from 97632
//   draw 1        → 6  buckets  — high completion probability
//   draw 2        → 7  buckets  — most playable hands live here
//   draw 3        → 5  buckets  — mediocre hands
//   draw 4        → 3  buckets  — mostly junk
//   draw 5        → 3  buckets  — worst hands
//
// Within each group, bucket 0 = strongest (lowest cards), last = weakest.

export const NUM_BUCKETS = 30;

// draw-5 hands all score identically (nothing to keep) → 1 bucket is enough.
// The 2 freed buckets go to draw-4, which has real variation (1 kept card).
const DRAW_ALLOC = [6, 6, 7, 5, 5, 1] as const; // indexed by draw count 0-5

// Cumulative offsets: bucket = DRAW_OFFSET[drawCount] + localBucket
const DRAW_OFFSET = DRAW_ALLOC.reduce<number[]>((acc, _n, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + DRAW_ALLOC[i - 1]);
  return acc;
}, []);

// Bucket at which "standing pat from a drawing hand" is recorded.
// Represents a weak made low (T-low / J-low quality) — weakest pat bucket.
export const PAT_BUCKET_FOR_STANDING_PAT = DRAW_ALLOC[0] - 1; // = 5

// Sentinel bucket for D3-with-blockers standing pat as a bluff.
// These hands (e.g. 2-2-2-2-3) lose at showdown against any genuine low.
// Set to NUM_BUCKETS (= 30) — outside the real 0..29 range — so showdownPayoff
// can distinguish bluff-pats from genuine made lows.
export const BLUFF_PAT_BUCKET = NUM_BUCKETS; // = 30

// True for buckets where the player may choose between drawing and standing pat.
// Draw-1 (6-11) and draw-2 (12-18) can hold valid lows.
// Draw-3 (19-23) with strong blockers (blBin=2: 4+ rank-2/3 cards) can bluff-pat.
export function isDrawDecisionBucket(bucket: number, blBin: BlockerBin = 0): boolean {
  return (
    (bucket >= DRAW_OFFSET[1] && bucket < DRAW_OFFSET[1] + DRAW_ALLOC[1]) || // draw-1: 6-11
    (bucket >= DRAW_OFFSET[2] && bucket < DRAW_OFFSET[2] + DRAW_ALLOC[2]) || // draw-2: 12-18
    (blBin >= 2 && bucket >= DRAW_OFFSET[3] && bucket < DRAW_OFFSET[3] + DRAW_ALLOC[3]) // draw-3 + strong blockers: 19-23
  );
}

// ── Blocker bins ───────────────────────────────────────────────────────────────
//
// A "low blocker" is a card of rank 2 or 3 — the two ranks that appear in
// virtually every top-ranked low hand (7-5-4-3-2 and similar). Holding
// multiples removes them from the opponent's possible combos.
//
// Bins: 0 = 0-1 cards of rank ≤ 3  |  1 = 2-3  |  2 = 4-5 (e.g. 2-2-2-2-3)

export function blockerBinForHand(hand: Card[]): BlockerBin {
  const count = hand.filter((c) => c.rank <= Rank.Three).length;
  if (count >= 4) return 2;
  if (count >= 2) return 1;
  return 0;
}

// Per-bucket marginal distribution over BlockerBin (precomputed via Monte Carlo).
let _blockerDist: number[][] | null = null;

export function initBlockerDist(sampleSize = SAMPLE_SIZE): void {
  if (_blockerDist) return;
  const deck = createDeck();
  const counts = Array.from({ length: NUM_BUCKETS }, () => [0, 0, 0]);
  const totals = new Array(NUM_BUCKETS).fill(0);

  for (let i = 0; i < sampleSize; i++) {
    const hand = shuffle([...deck]).slice(0, 5);
    const b = handToBucket(hand);
    const bin = blockerBinForHand(hand);
    counts[b][bin]++;
    totals[b]++;
  }

  _blockerDist = counts.map((c, b) => {
    const total = totals[b];
    return total > 0 ? c.map((x) => x / total) : [1 / 3, 1 / 3, 1 / 3];
  });
}

// Samples a BlockerBin from the marginal distribution for this bucket.
// Used after a draw transition when specific cards are no longer tracked.
export function sampleBlockerBinForBucket(bucket: number): BlockerBin {
  if (!_blockerDist) initBlockerDist();
  const dist = _blockerDist![bucket];
  const r = Math.random();
  if (r < dist[0]) return 0;
  if (r < dist[0] + dist[1]) return 1;
  return 2;
}

const SAMPLE_SIZE = 100_000;

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Hand analysis ──────────────────────────────────────────────────────────────
//
// Returns:
//   drawCount — number of cards to discard (5 minus kept unique-low cards)
//   score     — quality within the draw group (higher = better cards kept)
//
// "Keepable" = at most ONE card per rank ≤ 9.
// Duplicates of a rank are discarded (you never keep a pair), but one copy
// of a paired rank IS kept — e.g. 2-2-3-4-K keeps one 2, one 3, one 4.
// Score uses inverse-rank so that lower cards produce higher scores.
//
// 2-7 lowball penalties applied AFTER base score:
//   Pat straight             : -1_000_000  (need to break 1 card)
//   Pat flush                : -2_000_000  (need to break 2+ cards)
//   Pat straight flush       : -3_000_000  (worst)
//   Draw-1 four-flush        :    -15_000  (~2-bucket drop within draw-1 range ~44k)
//   Draw-1 four-straight     :     -8_000  (~1-bucket drop)
//   Draw-2 three-flush       :     -1_000  (~1-bucket drop within draw-2 range ~5.5k)
//   Draw-2 three-straight    :     -1_000  (~1-bucket drop; straight-draw risk)
// These push bad hands toward the bottom of their draw-count group.
//
// Score formula uses HIGHEST-card-first weighting, matching 2-7 lowball evaluation:
// a 8-low always beats a 9-low regardless of lower cards, so the top card must
// carry the most weight (100_000). Ace (14) fills unused kept-card slots.

function isConsecutiveRanks(ranks: Rank[]): boolean {
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] !== ranks[i - 1] + 1) return false;
  }
  return true;
}

function allSameSuit(cards: Card[]): boolean {
  return cards.every(c => c.suit === cards[0].suit);
}

function handDrawInfo(hand: Card[]): { drawCount: number; score: number } {
  const seenRanks = new Set<Rank>();
  const kept: Card[] = [];
  for (const c of [...hand].sort((a, b) => a.rank - b.rank)) {
    if (c.rank <= Rank.Nine && !seenRanks.has(c.rank)) {
      kept.push(c);
      seenRanks.add(c.rank);
    }
  }

  // In 2-7 lowball, a player would never stand pat with a straight or flush.
  // Reclassify: remove the highest card(s) to simulate the optimal break.
  //   Pat flush or straight      → draw 1 (discard highest card)
  //   Pat straight flush         → draw 2 (discard two highest cards)
  if (kept.length === 5) {
    const ranks = kept.map(c => c.rank);
    const isStraight = isConsecutiveRanks(ranks);
    const isFlush    = allSameSuit(kept);
    if (isStraight && isFlush) {
      kept.splice(3); // discard top 2, keep lowest 3
    } else if (isStraight || isFlush) {
      kept.pop();     // discard top 1, keep lowest 4
    }
  }

  const drawCount = 5 - kept.length;
  const keptRanks = kept.map(c => c.rank);

  // Quality score: highest kept card carries the most weight (correct for 2-7 lowball).
  // Slots without a kept card use Rank.Ace (14) as a placeholder.
  // r[0] = lowest kept rank, r[4] = highest (or Ace if slot unused).
  const r = Array.from({ length: 5 }, (_, i) => keptRanks[i] ?? Rank.Ace);
  let score =
    (15 - r[4]) * 100_000 +   // highest card matters most in 2-7 lowball
    (15 - r[3]) *  10_000 +
    (15 - r[2]) *   1_000 +
    (15 - r[1]) *     100 +
    (15 - r[0]) *      10;

  // 2-7 lowball penalties for draw hands: 4-flushes/4-straights are undesirable.
  if (drawCount === 1) {
    const is4Flush    = allSameSuit(kept);
    const is4Straight = isConsecutiveRanks(keptRanks);
    if      (is4Flush && is4Straight) score -= 23_000;
    else if (is4Flush)                score -= 15_000;
    else if (is4Straight)             score -=  8_000;
  } else if (drawCount === 2) {
    const is3Flush    = allSameSuit(kept);
    const is3Straight = isConsecutiveRanks(keptRanks);
    if      (is3Flush && is3Straight) score -= 2_000;
    else if (is3Flush)                score -= 1_000;
    else if (is3Straight)             score -= 1_000;
  }

  return { drawCount, score };
}

// ── Distribution cache ─────────────────────────────────────────────────────────

// Per-draw-count sorted distributions (descending: best score first).
let _distByDraw: Map<number, number[]> | null = null;

// Precomputed thresholds loaded from exported JSON (avoids non-deterministic resampling).
// thresholds[d][b] = score at the start of local bucket b for draw count d (descending order).
let _thresholds: number[][] | null = null;

export function buildScoreDistribution(sampleSize = SAMPLE_SIZE): Map<number, number[]> {
  const deck = createDeck();
  const byDraw = new Map<number, number[]>();
  for (let d = 0; d <= 5; d++) byDraw.set(d, []);

  for (let i = 0; i < sampleSize; i++) {
    const hand = shuffle([...deck]).slice(0, 5);
    const { drawCount, score } = handDrawInfo(hand);
    byDraw.get(drawCount)!.push(score);
  }

  for (const [d, arr] of byDraw) {
    byDraw.set(d, arr.sort((a, b) => b - a));
  }

  return byDraw;
}

export function initBuckets(sampleSize?: number): void {
  if (_distByDraw) return;
  _distByDraw = buildScoreDistribution(sampleSize);
}

function getDistByDraw(): Map<number, number[]> {
  if (!_distByDraw) _distByDraw = buildScoreDistribution();
  return _distByDraw;
}

// Percentile within a descending sorted array (0 = best, 1 = worst).
function scoreToFraction(score: number, sortedDesc: number[]): number {
  let lo = 0;
  let hi = sortedDesc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedDesc[mid] > score) lo = mid + 1;
    else hi = mid;
  }
  return lo / sortedDesc.length;
}

// Returns the draw count implied by a bucket (the primary dimension of the
// bucket system). Used in CFR training so draws are always consistent with
// the sampled bucket, correctly correlating draw count with hand strength.
export function drawCountForBucket(bucket: number): DrawCount {
  for (let d = 0; d <= 5; d++) {
    if (bucket >= DRAW_OFFSET[d] && bucket < DRAW_OFFSET[d] + DRAW_ALLOC[d]) {
      return d as DrawCount;
    }
  }
  return 5 as DrawCount;
}

// ── Public API ─────────────────────────────────────────────────────────────────

// Load precomputed thresholds from an exported strategy JSON so that
// handToBucket produces identical buckets in the browser as during training.
// Must be called before any hand-to-bucket lookups when using loaded strategies.
export function initBucketsFromThresholds(thresholds: number[][]): void {
  _thresholds = thresholds;
}

// Extract bucket thresholds from the current distribution for saving in the JSON.
// thresholds[d][b] = sorted[b * segSize] for draw count d, local bucket b.
export function getBucketThresholdMatrix(): number[][] {
  const dist = getDistByDraw();
  return DRAW_ALLOC.map((alloc, d) => {
    const sorted = dist.get(d) ?? [];
    const segSize = Math.max(1, Math.floor(sorted.length / alloc));
    return Array.from({ length: alloc }, (_, b) => sorted[b * segSize] ?? 0);
  });
}

// Maps a 5-card hand to a bucket in [0, NUM_BUCKETS-1].
// Bucket 0 = best pat hand (e.g. 7-5-4-3-2 standing pat).
// Buckets increase within each draw-count group as quality decreases.
export function handToBucket(hand: Card[]): number {
  const { drawCount, score } = handDrawInfo(hand);
  const alloc = DRAW_ALLOC[drawCount];

  if (_thresholds) {
    // Deterministic path: binary search on saved thresholds (same structure as scoreToFraction).
    const thr = _thresholds[drawCount] ?? [];
    let lo = 0, hi = thr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (thr[mid] > score) lo = mid + 1;
      else hi = mid;
    }
    return DRAW_OFFSET[drawCount] + Math.min(alloc - 1, lo);
  }

  // Monte Carlo path (training / fallback).
  const dist = getDistByDraw();
  const sorted = dist.get(drawCount) ?? [];
  if (sorted.length === 0) return DRAW_OFFSET[drawCount];
  const fraction = scoreToFraction(score, sorted);
  const localBucket = Math.min(alloc - 1, Math.floor(fraction * alloc));
  return DRAW_OFFSET[drawCount] + localBucket;
}

// Score cutoffs at each bucket boundary (useful for debugging / export).
export function getBucketThresholds(): { drawCount: number; threshold: number }[] {
  const dist = getDistByDraw();
  const result: { drawCount: number; threshold: number }[] = [];

  for (let d = 0; d <= 5; d++) {
    const sorted = dist.get(d) ?? [];
    const alloc = DRAW_ALLOC[d];
    const segSize = Math.floor(sorted.length / alloc);
    for (let b = 0; b < alloc; b++) {
      result.push({ drawCount: d, threshold: sorted[b * segSize] ?? 0 });
    }
  }

  return result;
}

// Human-readable label for a bucket.
export function bucketLabel(bucket: number): string {
  for (let d = 0; d <= 5; d++) {
    const offset = DRAW_OFFSET[d];
    const alloc = DRAW_ALLOC[d];
    if (bucket >= offset && bucket < offset + alloc) {
      const local = bucket - offset;
      const drawLabel = d === 0 ? "pat" : `draw ${d}`;
      return `Bucket ${bucket} (${drawLabel}, ${local + 1}/${alloc})`;
    }
  }
  return `Bucket ${bucket}`;
}
