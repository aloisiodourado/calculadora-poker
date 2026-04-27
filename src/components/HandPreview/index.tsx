"use client";

import { useMemo } from "react";
import { Card } from "@/engine/cards";
import { PokerVariant } from "@/engine/variants";
import { VariantConfig } from "@/engine/variants/types";
import { HighHandEvaluator } from "@/engine/evaluators/HighHandEvaluator";
import { AceToFiveLowEvaluator } from "@/engine/evaluators/AceToFiveLowEvaluator";
import { DeuceSevenEvaluator } from "@/engine/evaluators/DeuceSevenEvaluator";
import { evaluateBadugi, bestBadugiHand } from "@/engine/evaluators/BadugiEvaluator";
import { cn } from "@/lib/utils";

const hiEval = new HighHandEvaluator();
const a5Eval = new AceToFiveLowEvaluator();
const d7Eval = new DeuceSevenEvaluator();

const OMAHA_VARIANTS = [PokerVariant.OmahaHi, PokerVariant.OmahaHiLo];

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
}

export function HandPreview({ holeCards, boardCards, variant, config }: HandPreviewProps) {
  const label = useMemo(() => {
    const knownHole = holeCards.filter((c): c is Card => c !== null);
    const knownBoard = boardCards.filter((c): c is Card => c !== null);

    // Badugi: show effective hand size at all times
    if (config.evaluators[0] === "badugi") {
      if (knownHole.length === 0) return null;
      const effective = bestBadugiHand(knownHole);
      if (knownHole.length < 4) return `${effective.length}-card partial`;
      const ev = evaluateBadugi(knownHole);
      return ev.label;
    }

    // Omaha: need ≥2 hole + ≥3 board
    if (OMAHA_VARIANTS.includes(variant)) {
      return evaluateOmahaPreview(knownHole, knownBoard, config.evaluators[0] as "high" | "a5low");
    }

    // All other variants: need ≥5 cards total
    const all = [...knownHole, ...knownBoard];
    if (all.length < 5) return null;

    if (config.evaluators[0] === "high") return hiEval.evaluate(all).label;
    if (config.evaluators[0] === "a5low") return a5Eval.evaluate(all).label;
    if (config.evaluators[0] === "27low") return d7Eval.evaluate(all).label;
    return null;
  }, [holeCards, boardCards, variant, config]);

  if (!label) return null;

  return (
    <span className={cn(
      "text-[11px] font-medium px-2 py-0.5 rounded-full border",
      "bg-slate-50 border-slate-200 text-slate-600"
    )}>
      {label}
    </span>
  );
}
