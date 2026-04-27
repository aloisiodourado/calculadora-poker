import { Card, Rank } from "../cards";
import { HandEvaluation, HandEvaluator, HandRank } from "./types";

// Encodes a hand into a comparable number.
// Format: rank (2 digits) + up to 5 kicker ranks (2 digits each).
// Max rank value = 9, max card rank = 14 → fits safely in a JS number.
function encodeScore(handRank: HandRank, kickers: number[]): number {
  let score = handRank * 10_000_000_000;
  const multipliers = [100_000_000, 1_000_000, 10_000, 100, 1];
  for (let i = 0; i < kickers.length && i < 5; i++) {
    score += kickers[i] * multipliers[i];
  }
  return score;
}

function groupByRank(cards: Card[]): Map<Rank, Card[]> {
  const groups = new Map<Rank, Card[]>();
  for (const card of cards) {
    const group = groups.get(card.rank) ?? [];
    group.push(card);
    groups.set(card.rank, group);
  }
  return groups;
}

function isFlush(cards: Card[]): boolean {
  return cards.every((c) => c.suit === cards[0].suit);
}

// Returns the 5 cards forming a straight (high to low), or null.
// Handles A-2-3-4-5 (wheel).
function findStraight(cards: Card[]): Card[] | null {
  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  const deduped = sorted.filter(
    (c, i, arr) => i === 0 || c.rank !== arr[i - 1].rank
  );

  // Try normal straights from highest possible starting rank
  for (let i = 0; i <= deduped.length - 5; i++) {
    const slice = deduped.slice(i, i + 5);
    if (slice[0].rank - slice[4].rank === 4) return slice;
  }

  // Wheel: A-2-3-4-5
  const hasAce = deduped.find((c) => c.rank === Rank.Ace);
  if (hasAce) {
    const low = deduped.filter((c) =>
      [Rank.Two, Rank.Three, Rank.Four, Rank.Five].includes(c.rank)
    );
    if (low.length === 4) {
      return [...low.sort((a, b) => b.rank - a.rank), hasAce];
    }
  }

  return null;
}

export function evaluateHighHand(cards: Card[]): HandEvaluation {
  if (cards.length < 5) {
    throw new Error(`Need at least 5 cards, got ${cards.length}`);
  }

  // Generate all C(n,5) combinations and pick the best
  if (cards.length > 5) {
    return bestOfCombinations(cards, evaluateHighHand);
  }

  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  const groups = groupByRank(sorted);
  const counts = [...groups.values()].sort((a, b) => b.length - a.length || b[0].rank - a[0].rank);

  const flush = isFlush(sorted);
  const straight = findStraight(sorted);

  // Straight Flush
  if (flush && straight) {
    const isWheel = straight[0].rank === Rank.Five;
    const topRank = isWheel ? Rank.Five : straight[0].rank;
    return {
      rank: HandRank.StraightFlush,
      score: encodeScore(HandRank.StraightFlush, [topRank]),
      label: topRank === Rank.Ace ? "Royal Flush" : "Straight Flush",
      bestHand: straight,
    };
  }

  // Four of a Kind
  if (counts[0].length === 4) {
    const quad = counts[0];
    const kicker = sorted.find((c) => c.rank !== quad[0].rank)!;
    return {
      rank: HandRank.FourOfAKind,
      score: encodeScore(HandRank.FourOfAKind, [quad[0].rank, kicker.rank]),
      label: "Four of a Kind",
      bestHand: [...quad, kicker],
    };
  }

  // Full House
  if (counts[0].length === 3 && counts[1].length >= 2) {
    const trips = counts[0];
    const pair = counts[1].slice(0, 2);
    return {
      rank: HandRank.FullHouse,
      score: encodeScore(HandRank.FullHouse, [trips[0].rank, pair[0].rank]),
      label: "Full House",
      bestHand: [...trips, ...pair],
    };
  }

  // Flush
  if (flush) {
    const kickers = sorted.slice(0, 5).map((c) => c.rank);
    return {
      rank: HandRank.Flush,
      score: encodeScore(HandRank.Flush, kickers),
      label: "Flush",
      bestHand: sorted.slice(0, 5),
    };
  }

  // Straight
  if (straight) {
    const isWheel = straight[0].rank === Rank.Five;
    const topRank = isWheel ? Rank.Five : straight[0].rank;
    return {
      rank: HandRank.Straight,
      score: encodeScore(HandRank.Straight, [topRank]),
      label: "Straight",
      bestHand: straight,
    };
  }

  // Three of a Kind
  if (counts[0].length === 3) {
    const trips = counts[0];
    const kickers = sorted.filter((c) => c.rank !== trips[0].rank).slice(0, 2);
    return {
      rank: HandRank.ThreeOfAKind,
      score: encodeScore(HandRank.ThreeOfAKind, [trips[0].rank, ...kickers.map((c) => c.rank)]),
      label: "Three of a Kind",
      bestHand: [...trips, ...kickers],
    };
  }

  // Two Pair
  if (counts[0].length === 2 && counts[1].length === 2) {
    const highPair = counts[0].slice(0, 2);
    const lowPair = counts[1].slice(0, 2);
    const kicker = sorted.find(
      (c) => c.rank !== highPair[0].rank && c.rank !== lowPair[0].rank
    )!;
    return {
      rank: HandRank.TwoPair,
      score: encodeScore(HandRank.TwoPair, [highPair[0].rank, lowPair[0].rank, kicker.rank]),
      label: "Two Pair",
      bestHand: [...highPair, ...lowPair, kicker],
    };
  }

  // One Pair
  if (counts[0].length === 2) {
    const pair = counts[0].slice(0, 2);
    const kickers = sorted.filter((c) => c.rank !== pair[0].rank).slice(0, 3);
    return {
      rank: HandRank.OnePair,
      score: encodeScore(HandRank.OnePair, [pair[0].rank, ...kickers.map((c) => c.rank)]),
      label: "One Pair",
      bestHand: [...pair, ...kickers],
    };
  }

  // High Card
  const best5 = sorted.slice(0, 5);
  return {
    rank: HandRank.HighCard,
    score: encodeScore(HandRank.HighCard, best5.map((c) => c.rank)),
    label: "High Card",
    bestHand: best5,
  };
}

function combinations(cards: Card[], k: number): Card[][] {
  if (k === 0) return [[]];
  if (cards.length < k) return [];
  const [first, ...rest] = cards;
  return [
    ...combinations(rest, k - 1).map((combo) => [first, ...combo]),
    ...combinations(rest, k),
  ];
}

function bestOfCombinations(
  cards: Card[],
  evaluator: (cards: Card[]) => HandEvaluation
): HandEvaluation {
  return combinations(cards, 5).reduce<HandEvaluation | null>((best, combo) => {
    const eval_ = evaluator(combo);
    if (!best || eval_.score > best.score) return eval_;
    return best;
  }, null)!;
}

export class HighHandEvaluator implements HandEvaluator {
  evaluate(cards: Card[]): HandEvaluation {
    return evaluateHighHand(cards);
  }

  compare(a: HandEvaluation, b: HandEvaluation): number {
    return a.score - b.score;
  }
}
