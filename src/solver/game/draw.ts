import { Card } from "@/engine/cards";
import { DeuceSevenEvaluator } from "@/engine/evaluators";
import { DrawCount } from "./types";

const evaluator = new DeuceSevenEvaluator();

// ── Draw decision helpers ──────────────────────────────────────────────────────

// Given a 5-card hand, return the indices to keep for a given draw count.
// Strategy: keep the best (5 - drawCount) cards by 2-7 lowball strength.
// Used when simulating draw outcomes during bucket transitions.
export function keepIndicesForDraw(hand: Card[], drawCount: DrawCount): number[] {
  if (drawCount === 0) return [0, 1, 2, 3, 4];
  if (drawCount === 5) return [];

  const keepCount = 5 - drawCount;

  // Score each subset of keepCount cards by how good a lowball draw it is.
  // Heuristic: prefer lower ranks, no pairs, no straights, no flushes.
  // For simplicity, evaluate all C(5, keepCount) subsets and pick the best partial hand.
  const indices = [0, 1, 2, 3, 4];
  const subsets = combinations(indices, keepCount);

  let bestSubset = subsets[0];
  let bestScore = subsetScore(hand, subsets[0]);

  for (let i = 1; i < subsets.length; i++) {
    const score = subsetScore(hand, subsets[i]);
    if (score > bestScore) {
      bestScore = score;
      bestSubset = subsets[i];
    }
  }

  return bestSubset;
}

// Lower score = better lowball partial hand.
// Score = sum of ranks (lower = better), penalise pairs/flushes/straights.
function subsetScore(hand: Card[], indices: number[]): number {
  const cards = indices.map((i) => hand[i]);
  const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);
  const suits = cards.map((c) => c.suit);

  let score = ranks.reduce((a, r) => a + r, 0); // prefer lower ranks

  // Pair/trips penalty
  const rankCounts = new Map<number, number>();
  for (const r of ranks) rankCounts.set(r, (rankCounts.get(r) ?? 0) + 1);
  for (const count of rankCounts.values()) {
    if (count >= 2) score += 100 * count;
  }

  // Flush penalty (only possible with 5 cards, but penalise 4+ same suit)
  const suitCounts = new Map<string, number>();
  for (const s of suits) suitCounts.set(String(s), (suitCounts.get(String(s)) ?? 0) + 1);
  for (const count of suitCounts.values()) {
    if (count >= 4) score += 50;
  }

  // Straight penalty
  if (ranks.length === 5 && isConsecutive(ranks)) score += 50;

  return -score; // negate so higher = better for max comparison
}

function isConsecutive(sortedRanks: number[]): boolean {
  for (let i = 1; i < sortedRanks.length; i++) {
    if (sortedRanks[i] - sortedRanks[i - 1] !== 1) return false;
  }
  return true;
}

// ── Draw count recommendation ──────────────────────────────────────────────────

// How many cards to discard given a 5-card hand, using a simple heuristic.
// Used to seed the initial draw strategy before CFR learns it.
export function recommendedDrawCount(hand: Card[]): DrawCount {
  const ranks = hand.map((c) => c.rank).sort((a, b) => a - b);

  // Check for pairs
  const rankCounts = new Map<number, number>();
  for (const r of ranks) rankCounts.set(r, (rankCounts.get(r) ?? 0) + 1);
  const maxCount = Math.max(...rankCounts.values());

  // Count "good" cards: rank ≤ 8 (Ace counts as high = bad)
  const goodCards = hand.filter((c) => c.rank <= 8).length;

  if (maxCount >= 2) {
    // Has a pair/trips: discard the duplicates + bad cards
    const uniqueGood = [...rankCounts.entries()]
      .filter(([r, cnt]) => r <= 8 && cnt === 1)
      .length;
    return Math.max(0, 5 - uniqueGood) as DrawCount;
  }

  // No pairs: discard cards ranked > 8
  return Math.min(5, 5 - goodCards) as DrawCount;
}

// ── Utility: combinations ──────────────────────────────────────────────────────

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k === arr.length) return [arr];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}
