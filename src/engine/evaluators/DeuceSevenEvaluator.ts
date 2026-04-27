import { Card, Rank } from "../cards";
import { HandEvaluation, HandEvaluator, HandRank } from "./types";
import { evaluateHighHand } from "./HighHandEvaluator";

// In 2-7 Lowball: Ace is always HIGH, flushes and straights count against you.
// Best possible hand: 2-3-4-5-7 offsuit.
// Lower high-hand score = better low hand, so we invert the high-hand score.

const MAX_SCORE = 100_000_000_000;

export function evaluateDeuceSevenLow(cards: Card[]): HandEvaluation {
  if (cards.length < 5) throw new Error(`Need at least 5 cards, got ${cards.length}`);

  if (cards.length > 5) {
    return bestDeuceSevenOfCombinations(cards);
  }

  // Evaluate as a high hand — straights and flushes count here
  const highEval = evaluateHighHand(cards);

  // Invert: lower high score = better low hand
  const score = MAX_SCORE - highEval.score;

  return {
    rank: highEval.rank,
    score,
    label: `2-7 Low: ${highEval.label}`,
    bestHand: highEval.bestHand,
  };
}

function combinations(cards: Card[], k: number): Card[][] {
  if (k === 0) return [[]];
  if (cards.length < k) return [];
  const [first, ...rest] = cards;
  return [
    ...combinations(rest, k - 1).map((c) => [first, ...c]),
    ...combinations(rest, k),
  ];
}

function bestDeuceSevenOfCombinations(cards: Card[]): HandEvaluation {
  // Best 2-7 low = highest inverted score = lowest high hand score
  return combinations(cards, 5).reduce<HandEvaluation | null>((best, combo) => {
    const eval_ = evaluateDeuceSevenLow(combo);
    if (!best || eval_.score > best.score) return eval_;
    return best;
  }, null)!;
}

export class DeuceSevenEvaluator implements HandEvaluator {
  evaluate(cards: Card[]): HandEvaluation {
    return evaluateDeuceSevenLow(cards);
  }

  compare(a: HandEvaluation, b: HandEvaluation): number {
    return a.score - b.score;
  }
}
