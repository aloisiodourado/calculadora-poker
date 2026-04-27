import { Card, Rank } from "../cards";
import { HandEvaluation, HandEvaluator, HandRank } from "./types";

// In A-5 Lowball: Ace is always low (value 1), flushes/straights don't count.
// Best possible hand: A-2-3-4-5 (the Wheel).
// Lower score = better hand, so we invert: score = MAX - sum_of_ranks_weighted.

const ACE_LOW = 1;
const MAX_SCORE = 100_000_000_000;

function rankValue(rank: Rank): number {
  return rank === Rank.Ace ? ACE_LOW : (rank as number);
}

// Encodes the 5-card low hand as a comparable number where LOWER = BETTER.
// We invert so that HandEvaluation.score follows the convention "higher = better".
function encodeScore(ranks: number[]): number {
  // ranks sorted high-to-low (worst card first for comparison)
  const sorted = [...ranks].sort((a, b) => b - a);
  let raw = 0;
  const mults = [100_000_000, 1_000_000, 10_000, 100, 1];
  for (let i = 0; i < sorted.length && i < 5; i++) {
    raw += sorted[i] * mults[i];
  }
  return MAX_SCORE - raw;
}

// Qualifying low hand: 5 unpaired cards all ≤ 8 (using ace-low values).
export function qualifiesLow(cards: Card[]): boolean {
  const values = cards.map((c) => rankValue(c.rank));
  if (new Set(values).size < 5) return false; // paired
  return values.every((v) => v <= 8);
}

function bestLowFive(cards: Card[]): Card[] | null {
  const values = cards.map((c) => ({ card: c, value: rankValue(c.rank) }));
  const sorted = values.sort((a, b) => a.value - b.value);

  // Remove pairs (keep one of each rank value)
  const deduped: typeof sorted = [];
  for (const item of sorted) {
    if (!deduped.some((d) => d.value === item.value)) {
      deduped.push(item);
    }
  }

  if (deduped.length < 5) return null;

  // The best 5 low cards = lowest 5 unpaired cards
  return deduped.slice(0, 5).map((d) => d.card);
}

export function evaluateAceToFiveLow(cards: Card[]): HandEvaluation {
  if (cards.length < 5) throw new Error(`Need at least 5 cards, got ${cards.length}`);

  if (cards.length > 5) {
    // Find the best (lowest) 5 unpaired cards
    const best = bestLowFive(cards);
    if (!best) {
      // All pairs — evaluate with worst possible
      return evaluateAceToFiveLow(cards.slice(0, 5));
    }
    return evaluateAceToFiveLow(best);
  }

  const values = cards.map((c) => rankValue(c.rank));
  const score = encodeScore(values);

  return {
    rank: HandRank.HighCard, // all low hands are "high card" category in this system
    score,
    label: `Low: ${[...values].sort((a, b) => b - a).join("-")}`,
    bestHand: cards,
  };
}

export class AceToFiveLowEvaluator implements HandEvaluator {
  evaluate(cards: Card[]): HandEvaluation {
    return evaluateAceToFiveLow(cards);
  }

  compare(a: HandEvaluation, b: HandEvaluation): number {
    return a.score - b.score;
  }
}
