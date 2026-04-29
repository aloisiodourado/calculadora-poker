import { Card } from "../cards";
import { createDeck, removeCards } from "../cards/Deck";
import {
  HighHandEvaluator,
  AceToFiveLowEvaluator,
  DeuceSevenEvaluator,
  BadugiEvaluator,
  HandEvaluation,
} from "../evaluators";
import { qualifiesLow } from "../evaluators/AceToFiveLowEvaluator";
import { getVariantConfig } from "../variants/config";
import { EvaluatorType, PokerVariant } from "../variants/types";
import { HandResult, SimulationInput, SimulationResult, SimulatorEngine } from "./types";
import { evaluateOmahaHand } from "./OmahaEvaluator";
import { applyDrawStrategy, DrawRoundStrategy, DEFAULT_DRAW_THRESHOLDS } from "./drawStrategy";

const evaluatorInstances = {
  high: new HighHandEvaluator(),
  a5low: new AceToFiveLowEvaluator(),
  "27low": new DeuceSevenEvaluator(),
  badugi: new BadugiEvaluator(),
};

function getEvaluatorInstance(type: EvaluatorType) {
  return evaluatorInstances[type];
}

// Complete unknown hole cards and board from the remaining deck
function completeHands(
  hands: Card[][],
  board: Card[],
  deck: Card[],
  config: ReturnType<typeof getVariantConfig>
): { completedHands: Card[][]; completedBoard: Card[] } {
  let remaining = [...deck];
  let ptr = 0;

  const completedBoard = [...board];
  while (completedBoard.length < config.communityCards) {
    completedBoard.push(remaining[ptr++]);
  }

  const completedHands = hands.map((hand) => {
    const completed = [...hand];
    while (completed.length < config.holeCards) {
      completed.push(remaining[ptr++]);
    }
    return completed;
  });

  return { completedHands, completedBoard };
}

function evaluateHand(
  holeCards: Card[],
  board: Card[],
  evalType: EvaluatorType,
  omahaRules: boolean
): HandEvaluation {
  if (omahaRules) {
    return evaluateOmahaHand(holeCards, board, evalType);
  }
  const allCards = [...holeCards, ...board];
  return getEvaluatorInstance(evalType).evaluate(allCards);
}

// For a single evaluator type, determine winners among players.
// Returns array of winner indices (multiple on tie).
function findWinners(evals: HandEvaluation[], evalType: EvaluatorType): number[] {
  const evaluator = getEvaluatorInstance(evalType);
  let best = evals[0];
  let winners = [0];

  for (let i = 1; i < evals.length; i++) {
    const cmp = evaluator.compare(evals[i], best);
    if (cmp > 0) {
      best = evals[i];
      winners = [i];
    } else if (cmp === 0) {
      winners.push(i);
    }
  }

  return winners;
}

export class MonteCarloSimulator implements SimulatorEngine {
  async simulate(input: SimulationInput): Promise<SimulationResult> {
    const start = Date.now();
    const { variant, hands, board, iterations } = input;
    const config = getVariantConfig(variant);
    const isHiLo = config.evaluators.length === 2;
    const isTripleDraw =
      variant === PokerVariant.TripleDraw27 &&
      input.drawRoundsLeft != null &&
      input.drawRoundsLeft > 0;

    const results: HandResult[] = hands.map((hand) => ({
      hand,
      equity: 0,
      wins: 0,
      ties: 0,
      losses: 0,
      hiWins: 0,
      loWins: 0,
      loQualified: 0,
    }));

    const knownCards = [...board, ...hands.flat()];

    for (let i = 0; i < iterations; i++) {
      const deck = shuffle(removeCards(createDeck(), knownCards));

      if (isTripleDraw) {
        const finalHands = this.simulateDrawRounds(
          hands,
          deck,
          input.drawRoundsLeft!,
          input.playerDrawStrategies
        );
        this.runStandardIteration(finalHands, [], config, results);
      } else {
        const { completedHands, completedBoard } = completeHands(
          hands, board, deck, config
        );
        if (isHiLo) {
          this.runHiLoIteration(completedHands, completedBoard, config, results);
        } else {
          this.runStandardIteration(completedHands, completedBoard, config, results);
        }
      }
    }

    for (const r of results) {
      r.equity = r.wins / iterations;
    }

    return {
      results,
      iterationsRun: iterations,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Simulate drawRoundsLeft draw rounds for all players.
   * Returns the final 5-card hands after all draws.
   */
  private simulateDrawRounds(
    startingHands: Card[][],
    deck: Card[],
    drawRoundsLeft: number,
    playerStrategies?: DrawRoundStrategy[][]
  ): Card[][] {
    // ptr walks sequentially through the shuffled deck
    let ptr = 0;

    // Step 1: fill each hand to 5 cards (in case some cards are unknown)
    const hands = startingHands.map((hand) => {
      const completed = [...hand];
      while (completed.length < 5 && ptr < deck.length) {
        completed.push(deck[ptr++]);
      }
      return completed;
    });

    // The first draw round index into the strategy array
    // e.g. drawRoundsLeft=2 → start at index 1 (use strategies[1] and strategies[2])
    const startIdx = 3 - drawRoundsLeft;

    // Step 2: simulate each draw round
    for (let round = 0; round < drawRoundsLeft; round++) {
      const stratIdx = startIdx + round;

      for (let p = 0; p < hands.length; p++) {
        const strategy: DrawRoundStrategy = playerStrategies?.[p]?.[stratIdx] ?? {
          keepThreshold: DEFAULT_DRAW_THRESHOLDS[stratIdx],
        };

        const { keep } = applyDrawStrategy(hands[p], strategy);
        const numDraw = 5 - keep.length;
        const drawn: Card[] = [];

        for (let d = 0; d < numDraw; d++) {
          if (ptr < deck.length) drawn.push(deck[ptr++]);
        }

        hands[p] = [...keep, ...drawn];
      }
    }

    return hands;
  }

  private runStandardIteration(
    hands: Card[][],
    board: Card[],
    config: ReturnType<typeof getVariantConfig>,
    results: HandResult[]
  ) {
    const evalType = config.evaluators[0];
    const evals = hands.map((h) => evaluateHand(h, board, evalType, config.omahaRules));
    const winners = findWinners(evals, evalType);

    for (let i = 0; i < results.length; i++) {
      if (winners.includes(i)) {
        results[i].wins += 1 / winners.length; // split equally on ties
      } else {
        results[i].losses++;
      }
    }
  }

  private runHiLoIteration(
    hands: Card[][],
    board: Card[],
    config: ReturnType<typeof getVariantConfig>,
    results: HandResult[]
  ) {
    const [hiType, loType] = config.evaluators;
    const hiEvals = hands.map((h) => evaluateHand(h, board, hiType, config.omahaRules));
    const loEvals = hands.map((h) => evaluateHand(h, board, loType, config.omahaRules));

    // Check which hands qualify for lo (8-or-better)
    const loQualified = loEvals.map((_, i) => {
      const holeCards = hands[i];
      const allCards = config.omahaRules
        ? [...holeCards, ...board]
        : holeCards;
      return qualifiesLow(allCards.slice(0, 5));
    });

    const hiWinners = findWinners(hiEvals, hiType);
    const qualifiedLoIndices = loEvals
      .map((_, i) => i)
      .filter((i) => loQualified[i]);

    let loWinners: number[] = [];
    if (qualifiedLoIndices.length > 0) {
      const qualifiedLoEvals = qualifiedLoIndices.map((i) => loEvals[i]);
      const localWinners = findWinners(qualifiedLoEvals, loType);
      loWinners = localWinners.map((local) => qualifiedLoIndices[local]);
    }

    // Equity = share of pot won
    // If no lo qualifier, hi takes the whole pot
    const hiShare = loWinners.length === 0 ? 1 : 0.5;
    const loShare = 0.5;

    for (let i = 0; i < results.length; i++) {
      if (loQualified[i]) results[i].loQualified++;

      let potShare = 0;
      if (hiWinners.includes(i)) {
        potShare += hiShare / hiWinners.length;
        results[i].hiWins++;
      }
      if (loWinners.includes(i)) {
        potShare += loShare / loWinners.length;
        results[i].loWins++;
      }

      if (potShare > 0) results[i].wins += potShare;
      else results[i].losses++;
    }
  }
}

// Utility to shuffle in place and return the array
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
