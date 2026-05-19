import { Card } from "../cards";
import { createDeck, removeCards } from "../cards/Deck";
import { parseStudRange, sampleStudHand, computeBranchWeights } from "../ranges/studRangeParser";
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

    // Pre-parse range patterns once (ranges apply only to stud, non-triple-draw)
    const parsedRanges = (input.playerRangePatterns ?? []).map(p =>
      p ? parseStudRange(p) : null
    );
    const hasRanges = !isTripleDraw && parsedRanges.some(r => r !== null);

    // Dead-card filtering: if a dead card is explicitly present in a player's hand
    // or as a fixed card in a range pattern, it belongs to that player — ignore the
    // dead-card flag for it. Only truly-orphan dead cards are removed from the deck.
    const explicitCardKeys = new Set<string>(
      hands.flat().map(c => `${c.rank}|${c.suit}`)
    );
    for (const range of parsedRanges) {
      if (!range) continue;
      for (const branch of range) {
        for (const c of branch.constraints) {
          if (c.rankFixed !== null && c.suitFixed !== null) {
            explicitCardKeys.add(`${c.rankFixed}|${c.suitFixed}`);
          }
        }
      }
    }
    const effectiveDeadCards = (input.deadCards ?? []).filter(
      c => !explicitCardKeys.has(`${c.rank}|${c.suit}`)
    );

    // knownCards: board + fixed hands + effective dead cards
    const knownCards = [...board, ...hands.flat(), ...effectiveDeadCards];

    // Pre-compute branch weights for each range player from the initial available deck.
    // This gives proportional (combo-count-weighted) branch sampling instead of uniform,
    // matching how PPT weights branches by the number of combos in each alternative.
    const initialDeck = removeCards(createDeck(), knownCards);
    const branchWeightsPerPlayer = parsedRanges.map(range =>
      range ? computeBranchWeights(range, initialDeck) : null
    );

    let successfulIterations = 0;

    for (let i = 0; i < iterations; i++) {
      const deck = shuffle(removeCards(createDeck(), knownCards));

      if (isTripleDraw) {
        const finalHands = this.simulateDrawRounds(
          hands,
          deck,
          input.drawRoundsLeft!,
          input.playerDrawStrategies,
          input.playerExplicitDiscards
        );
        this.runStandardIteration(finalHands, [], config, results);
        successfulIterations++;
      } else if (hasRanges) {
        // Sample each range player independently from the full deck, then reject
        // iterations where any two players share a card. This matches PPT's approach
        // and avoids the bias of sequential sampling (where P1 depletes the deck
        // before P3 can draw their constrained cards).
        const MAX_JOINT_RETRIES = 50;
        let resolved = false;

        for (let joint = 0; joint < MAX_JOINT_RETRIES; joint++) {
          // Sample each range player from the FULL deck independently
          const sampledPerPlayer: (Card[] | null)[] = parsedRanges.map((range, pi) => {
            if (!range) return null;
            return sampleStudHand(range, deck, 5, branchWeightsPerPlayer[pi] ?? undefined);
          });

          // Fail fast if any range player couldn't be sampled
          if (sampledPerPlayer.some((s, pi) => parsedRanges[pi] !== null && s === null)) continue;

          // Reject if any two players share a card
          const usedKeys = new Set<string>();
          let conflict = false;
          for (const cards of sampledPerPlayer) {
            if (!cards) continue;
            for (const c of cards) {
              const key = `${c.rank}|${c.suit}`;
              if (usedKeys.has(key)) { conflict = true; break; }
              usedKeys.add(key);
            }
            if (conflict) break;
          }
          if (conflict) continue;

          // No conflict — build work hands and remaining deck
          const workHands = hands.map(h => [...h]);
          let workDeck = deck;
          for (let pi = 0; pi < sampledPerPlayer.length; pi++) {
            const cards = sampledPerPlayer[pi];
            if (!cards) continue;
            workHands[pi] = cards;
            const keys = new Set(cards.map(c => `${c.rank}|${c.suit}`));
            workDeck = workDeck.filter(c => !keys.has(`${c.rank}|${c.suit}`));
          }

          resolved = true;
          successfulIterations++;
          const { completedHands, completedBoard } = completeHands(workHands, board, workDeck, config);
          if (isHiLo) {
            this.runHiLoIteration(completedHands, completedBoard, config, results);
          } else {
            this.runStandardIteration(completedHands, completedBoard, config, results);
          }
          break;
        }

        if (!resolved) continue; // all joint retry attempts exhausted
      } else {
        const { completedHands, completedBoard } = completeHands(hands, board, deck, config);
        if (isHiLo) {
          this.runHiLoIteration(completedHands, completedBoard, config, results);
        } else {
          this.runStandardIteration(completedHands, completedBoard, config, results);
        }
        successfulIterations++;
      }
    }

    const denom = successfulIterations > 0 ? successfulIterations : 1;
    for (const r of results) {
      r.equity = r.wins / denom;
    }

    return {
      results,
      iterationsRun: successfulIterations,
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
    playerStrategies?: DrawRoundStrategy[][],
    playerExplicitDiscards?: boolean[][]
  ): Card[][] {
    let ptr = 0;

    // Step 1: fill each hand, but leave room for explicit-discard slots.
    // Explicit discards are guaranteed draws in round 0, so we don't fill those
    // slots with random cards — we just count them as extra draws later.
    const hands = startingHands.map((hand, p) => {
      const numExplicit = playerExplicitDiscards?.[p]?.filter(Boolean).length ?? 0;
      const completed = [...hand];
      const target = 5 - numExplicit;
      while (completed.length < target && ptr < deck.length) {
        completed.push(deck[ptr++]);
      }
      return completed;
    });

    // e.g. drawRoundsLeft=2 → startIdx=1, uses strategies[1] and strategies[2]
    const startIdx = 3 - drawRoundsLeft;

    // Step 2: simulate each draw round
    for (let round = 0; round < drawRoundsLeft; round++) {
      const stratIdx = startIdx + round;

      for (let p = 0; p < hands.length; p++) {
        const strategy: DrawRoundStrategy = playerStrategies?.[p]?.[stratIdx] ?? {
          keepThreshold: DEFAULT_DRAW_THRESHOLDS[stratIdx],
        };

        const { keep } = applyDrawStrategy(hands[p], strategy);

        // In round 0, explicit discard slots are guaranteed extra draws
        const explicitCount = round === 0
          ? (playerExplicitDiscards?.[p]?.filter(Boolean).length ?? 0)
          : 0;

        const numDraw = (hands[p].length - keep.length) + explicitCount;
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
