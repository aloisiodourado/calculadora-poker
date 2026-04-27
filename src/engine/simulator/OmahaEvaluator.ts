import { Card } from "../cards";
import { HandEvaluation } from "../evaluators";
import { EvaluatorType } from "../variants/types";
import {
  HighHandEvaluator,
  AceToFiveLowEvaluator,
} from "../evaluators";

const hiEval = new HighHandEvaluator();
const loEval = new AceToFiveLowEvaluator();

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [
    ...combinations(rest, k - 1).map((c) => [first, ...c]),
    ...combinations(rest, k),
  ];
}

// Omaha rule: exactly 2 hole cards + exactly 3 community cards
export function evaluateOmahaHand(
  holeCards: Card[],
  board: Card[],
  evalType: EvaluatorType
): HandEvaluation {
  const holeCombos = combinations(holeCards, 2);
  const boardCombos = combinations(board, 3);

  let best: HandEvaluation | null = null;

  for (const hole of holeCombos) {
    for (const boardCombo of boardCombos) {
      const fiveCards = [...hole, ...boardCombo];
      let eval_: HandEvaluation;

      if (evalType === "high") {
        eval_ = hiEval.evaluate(fiveCards);
      } else {
        eval_ = loEval.evaluate(fiveCards);
      }

      if (!best || eval_.score > best.score) {
        best = eval_;
      }
    }
  }

  return best!;
}
