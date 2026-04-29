"use client";

import { useMemo } from "react";
import { Card } from "@/engine/cards";
import { PokerVariant } from "@/engine/variants";
import { VariantConfig } from "@/engine/variants/types";
import { HighHandEvaluator } from "@/engine/evaluators/HighHandEvaluator";
import { AceToFiveLowEvaluator } from "@/engine/evaluators/AceToFiveLowEvaluator";
import { DeuceSevenEvaluator } from "@/engine/evaluators/DeuceSevenEvaluator";
import { HandRank } from "@/engine/evaluators/types";
import { evaluateBadugi, bestBadugiHand } from "@/engine/evaluators/BadugiEvaluator";
import { applyDrawStrategy } from "@/engine/simulator/drawStrategy";
import { DrawRoundStrategy } from "@/engine/simulator/types";
import { cn } from "@/lib/utils";

const hiEval = new HighHandEvaluator();
const a5Eval = new AceToFiveLowEvaluator();
const d7Eval = new DeuceSevenEvaluator();

const OMAHA_VARIANTS = [PokerVariant.OmahaHi, PokerVariant.OmahaHiLo];

// Top 10 hands in 2-7 lowball, ranks sorted descending.
const TOP_10_27: number[][] = [
  [7, 5, 4, 3, 2], // #1
  [7, 6, 4, 3, 2], // #2
  [7, 6, 5, 3, 2], // #3
  [7, 6, 5, 4, 2], // #4
  [8, 5, 4, 3, 2], // #5
  [8, 6, 4, 3, 2], // #6
  [8, 6, 5, 3, 2], // #7
  [8, 6, 5, 4, 2], // #8
  [8, 6, 5, 4, 3], // #9
  [8, 7, 4, 3, 2], // #10
];

const RANK_SHORT: Record<number, string> = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8",
  9: "9", 10: "T", 11: "J", 12: "Q", 13: "K", 14: "A",
};

function get27Label(knownHole: Card[], drawStrategy?: DrawRoundStrategy): string | null {
  if (knownHole.length === 0) return null;

  // Determine which known cards the strategy would keep.
  // Without a strategy, all known cards are treated as "kept".
  const effectiveKeep = drawStrategy
    ? applyDrawStrategy(knownHole, drawStrategy).keep
    : knownHole;

  const draws = 5 - effectiveKeep.length;

  if (draws > 0) {
    return `Discard ${draws}`;
  }

  // All 5 cards kept — evaluate the complete hand
  const ev = d7Eval.evaluate(effectiveKeep);

  if (ev.rank !== HandRank.HighCard) {
    // Pair, flush, straight, etc. — remove the "2-7 Low: " prefix from the evaluator label
    return ev.label.replace("2-7 Low: ", "");
  }

  const sorted = [...ev.bestHand].sort((a, b) => b.rank - a.rank);
  const r1 = RANK_SHORT[sorted[0].rank];
  const r2 = RANK_SHORT[sorted[1].rank];
  let label = `${r1}-${r2} High`;

  const sortedRanks = sorted.map((c) => c.rank);
  const rankIdx = TOP_10_27.findIndex((top) => top.every((r, i) => r === sortedRanks[i]));
  if (rankIdx !== -1) label += ` · #${rankIdx + 1}`;

  return label;
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [
    ...combinations(rest, k - 1).map((c) => [first, ...c]),
    ...combinations(rest, k),
  ];
}

function evaluateOmahaPreview(
  holeCards: Card[],
  boardCards: Card[],
  evalType: "high" | "a5low"
): string | null {
  if (holeCards.length < 2 || boardCards.length < 3) return null;
  const holeCombos = combinations(holeCards, 2);
  const boardCombos = combinations(boardCards, 3);

  let bestLabel: string | null = null;
  let bestScore = -Infinity;

  for (const hole of holeCombos) {
    for (const board of boardCombos) {
      const five = [...hole, ...board];
      const ev = evalType === "high" ? hiEval.evaluate(five) : a5Eval.evaluate(five);
      if (ev.score > bestScore) {
        bestScore = ev.score;
        bestLabel = ev.label;
      }
    }
  }
  return bestLabel;
}

interface HandPreviewProps {
  holeCards: (Card | null)[];
  boardCards: (Card | null)[];
  variant: PokerVariant;
  config: VariantConfig;
  drawStrategy?: DrawRoundStrategy;
}

export function HandPreview({ holeCards, boardCards, variant, config, drawStrategy }: HandPreviewProps) {
  const label = useMemo(() => {
    const knownHole = holeCards.filter((c): c is Card => c !== null);
    const knownBoard = boardCards.filter((c): c is Card => c !== null);

    if (config.evaluators[0] === "27low") {
      return get27Label(knownHole, drawStrategy);
    }

    if (config.evaluators[0] === "badugi") {
      if (knownHole.length === 0) return null;
      const effective = bestBadugiHand(knownHole);
      if (knownHole.length < 4) return `${effective.length}-card partial`;
      const ev = evaluateBadugi(knownHole);
      return ev.label;
    }

    if (OMAHA_VARIANTS.includes(variant)) {
      return evaluateOmahaPreview(knownHole, knownBoard, config.evaluators[0] as "high" | "a5low");
    }

    const all = [...knownHole, ...knownBoard];
    if (all.length < 5) return null;

    if (config.evaluators[0] === "high") return hiEval.evaluate(all).label;
    if (config.evaluators[0] === "a5low") return a5Eval.evaluate(all).label;
    return null;
  }, [holeCards, boardCards, variant, config, drawStrategy]);

  if (!label) return null;

  const isTop10 = label.includes("· #");

  return (
    <span className={cn(
      "text-[11px] font-medium px-2 py-0.5 rounded-full border",
      isTop10
        ? "bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-400"
        : "bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300"
    )}>
      {label}
    </span>
  );
}
