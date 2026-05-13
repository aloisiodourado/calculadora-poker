import { Position } from "../game/types";
import type { Position6Max } from "../game/types";
import { NUM_BUCKETS, initBuckets, initBlockerDist, sampleBlockerBinForBucket } from "../abstraction/handBuckets";
import { initTransitionMatrix, initBlockerTransition } from "../abstraction/bucketTransition";
import type { BlockerBin } from "../game/types";
import { averageStrategy, averageDrawStrategy } from "./strategy";
import { runIteration } from "./cfr";
import type { SolverTables } from "./cfr";
import { StrategyTable, DrawStrategyTable } from "../game/types";
import { getBucketThresholdMatrix } from "../abstraction/handBuckets";
import { sampleBucketForPosition, samplePosition, ALL_POSITIONS_6MAX } from "../game/ranges";
import { samplePreflopScenario, sampleBucketConditioned, ALL_PREFLOP_SCENARIOS } from "../game/preflop";
import type { PreflopScenario } from "../game/preflop";

export type { SolverTables };

// Increment when the infoset key format changes, making old JSONs incompatible.
const KEY_VERSION = "v7";

export interface TrainingProgress {
  iterations: number;
  infosets: number;
  durationMs: number;
}

export interface TrainingOptions {
  onProgress?: (progress: TrainingProgress) => void;
  progressEvery?: number; // report every N iterations (default 10_000)
  yieldEvery?: number;    // yield to event loop every N iterations (default 5_000)

  // Fix the 6-max positions for both players. If omitted, positions are sampled
  // uniformly each iteration, producing a general-purpose strategy across all matchups.
  pos0?: Position6Max;
  pos1?: Position6Max;

  // Fix the preflop scenario. If omitted, sampled from realistic frequencies (SR 65%, 3B 25%, LP 10%).
  preflopScenario?: PreflopScenario;
}

// ── Table management ───────────────────────────────────────────────────────────

export function createTables(): SolverTables {
  return {
    bet: new Map() as StrategyTable,
    draw: new Map() as DrawStrategyTable,
    iterations: 0,
  };
}

// Initialise all pre-computation (buckets + transition matrix).
// Call once before training.
export function initSolver(bucketSamples?: number, transitionSamples?: number): void {
  initBuckets(bucketSamples);
  initBlockerDist(bucketSamples);
  initTransitionMatrix(transitionSamples);
  initBlockerTransition(transitionSamples); // M2: full P(newBl | oldBucket, oldBl, drawCount)
}

// ── Training loop ──────────────────────────────────────────────────────────────

// Run `count` CFR+ iterations, alternating the traverser each time.
// Bucket pairs are sampled uniformly — each bucket covers ~1/NUM_BUCKETS of hands.
// Returns when all iterations complete.
export async function runIterations(
  tables: SolverTables,
  count: number,
  opts: TrainingOptions = {},
): Promise<TrainingProgress> {
  const { onProgress, progressEvery = 10_000, yieldEvery = 5_000 } = opts;
  const start = Date.now();

  for (let i = 0; i < count; i++) {
    tables.iterations++;
    const t = tables.iterations;

    // Alternate traversers
    const traverser = (t % 2 === 0 ? 0 : 1) as Position;

    // Sample 6-max positions: use fixed positions if provided, otherwise uniform random.
    const p0 = opts.pos0 ?? samplePosition();
    const p1 = opts.pos1 ?? samplePosition();

    // Sample preflop scenario (SR / 3B / LP) with realistic frequencies, or use fixed.
    const scenario = opts.preflopScenario ?? samplePreflopScenario();

    // Sample starting buckets conditioned on positional range AND preflop scenario.
    // E.g. in a 3B pot, weak draw-2/3 hands are less likely to have been played.
    const b0 = sampleBucketConditioned(p0, "pos0", scenario);
    const b1 = sampleBucketConditioned(p1, "pos1", scenario);
    const bl0 = sampleBlockerBinForBucket(b0) as BlockerBin;
    const bl1 = sampleBlockerBinForBucket(b1) as BlockerBin;

    runIteration(traverser, b0, bl0, b1, bl1, t, tables, p0, p1, scenario);

    // Yield periodically so the event loop can breathe (important in browser/worker)
    if (i % yieldEvery === 0 && i > 0) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }

    if (onProgress && i % progressEvery === 0 && i > 0) {
      onProgress({
        iterations: t,
        infosets: tables.bet.size + tables.draw.size,
        durationMs: Date.now() - start,
      });
    }
  }

  return {
    iterations: tables.iterations,
    infosets: tables.bet.size + tables.draw.size,
    durationMs: Date.now() - start,
  };
}

// ── Strategy extraction ────────────────────────────────────────────────────────

// Human-readable strategy summary: maps infoset key → action probabilities.
export function extractBetStrategy(
  tables: SolverTables,
): Map<string, { actions: string[]; probs: number[] }> {
  const result = new Map<string, { actions: string[]; probs: number[] }>();
  for (const [key, node] of tables.bet) {
    result.set(key, {
      actions: node.actions,
      probs: averageStrategy(node),
    });
  }
  return result;
}

export function extractDrawStrategy(
  tables: SolverTables,
): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const [key, node] of tables.draw) {
    result.set(key, averageDrawStrategy(node));
  }
  return result;
}

const PROB_PRECISION = 4; // decimal places — balances file size vs. strategy fidelity

function roundProbs(probs: number[]): number[] {
  return probs.map((p) => parseFloat(p.toFixed(PROB_PRECISION)));
}

// Serialisable snapshot for export / caching.
// Prunes only truly unvisited infosets (all strategySum === 0).
// Mixed strategies (e.g. 34% bet / 33% check / 33% fold) are valid GTO strategies
// and must NOT be pruned based on max-probability threshold.
export function exportTables(
  tables: SolverTables,
  trainingMeta?: { pos0?: Position6Max; pos1?: Position6Max },
): {
  keyVersion: string;
  iterations: number;
  bucketThresholds: number[][];
  positions6max: readonly string[];
  trainingPositions?: { pos0: string; pos1: string };
  bet: [string, { actions: string[]; probs: number[] }][];
  draw: [string, number[]][];
} {
  const bet: [string, { actions: string[]; probs: number[] }][] = [];
  for (const [key, node] of tables.bet) {
    if (!node.strategySum.some((s) => s > 0)) continue; // skip never-visited
    const probs = roundProbs(averageStrategy(node));
    bet.push([key, { actions: node.actions, probs }]);
  }

  const draw: [string, number[]][] = [];
  for (const [key, probs] of extractDrawStrategy(tables)) {
    draw.push([key, roundProbs(probs)]);
  }

  return {
    keyVersion: KEY_VERSION,
    iterations: tables.iterations,
    bucketThresholds: getBucketThresholdMatrix(),
    positions6max: ALL_POSITIONS_6MAX,
    ...(trainingMeta?.pos0 && trainingMeta.pos1
      ? { trainingPositions: { pos0: trainingMeta.pos0, pos1: trainingMeta.pos1 } }
      : {}),
    bet,
    draw,
  };
}
