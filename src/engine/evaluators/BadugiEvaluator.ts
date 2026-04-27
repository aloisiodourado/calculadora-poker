import { Card, Rank, Suit } from "../cards";
import { HandEvaluation, HandEvaluator, HandRank } from "./types";

// Badugi rules:
// - 4 cards, one per suit, no pairs (by rank)
// - A hand with more valid cards beats one with fewer (4 > 3 > 2 > 1)
// - Among equal count, the lowest set of ranks wins
// - Ace is always low (value 1)

const ACE_LOW = 1;
const MAX_SCORE = 100_000_000_000;

function rankValue(rank: Rank): number {
  return rank === Rank.Ace ? ACE_LOW : (rank as number);
}

// Builds the best Badugi hand from the given cards.
// Returns the subset: max cards, one per suit, one per rank, lowest ranks possible.
export function bestBadugiHand(cards: Card[]): Card[] {
  // Sort by rank value ascending (prefer low ranks)
  const sorted = [...cards].sort((a, b) => rankValue(a.rank) - rankValue(b.rank));

  const usedSuits = new Set<Suit>();
  const usedRanks = new Set<number>();
  const selected: Card[] = [];

  for (const card of sorted) {
    const v = rankValue(card.rank);
    if (!usedSuits.has(card.suit) && !usedRanks.has(v)) {
      selected.push(card);
      usedSuits.add(card.suit);
      usedRanks.add(v);
    }
  }

  return selected;
}

function encodeScore(hand: Card[]): number {
  // Primary: number of cards (more = better)
  // Secondary: sum of rank values (lower = better) → invert
  const count = hand.length;
  const ranks = hand.map((c) => rankValue(c.rank)).sort((a, b) => b - a); // worst first

  let raw = 0;
  const mults = [1_000_000, 10_000, 100, 1];
  for (let i = 0; i < ranks.length && i < 4; i++) {
    raw += ranks[i] * mults[i];
  }

  return count * 100_000_000 + (100_000_000 - raw);
}

export function evaluateBadugi(cards: Card[]): HandEvaluation {
  if (cards.length < 1) throw new Error("Need at least 1 card");

  const bestHand = bestBadugiHand(cards);
  const score = encodeScore(bestHand);
  const count = bestHand.length;

  const label = count === 4 ? "Badugi" : `${count}-card Badugi`;

  return {
    rank: HandRank.HighCard, // Badugi has its own category system
    score,
    label,
    bestHand,
  };
}

export class BadugiEvaluator implements HandEvaluator {
  evaluate(cards: Card[]): HandEvaluation {
    return evaluateBadugi(cards);
  }

  compare(a: HandEvaluation, b: HandEvaluation): number {
    return a.score - b.score;
  }
}
