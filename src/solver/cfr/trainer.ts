import { Position } from "../game/types";
import { NUM_BUCKETS, initBuckets } from "../abstraction/handBuckets";
import { initTransitionMatrix } from "../abstraction/bucketTransition";
import { averageStrategy, averageDrawStrategy } from "./strategy";
import { runIteration } from "./cfr";
import type { SolverTables } from "./cfr";
import { StrategyTable, DrawStrategyTable } from "../game/types";

export type { SolverTables };

export interface TrainingProgress {
  iterations: number;
  infosets: number;
  durationMs: number;
}

export interface TrainingOptions {
  onProgress?: (progress: TrainingProgress) => void;
  progressEvery?: number; // report every N iterations (default 10_000)
  yieldEvery?: number;    // yield to event loop every N iterations (default 5_000)
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
  initTransitionMatrix(transitionSamples);
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

    // Sample a starting bucket pair uniformly
    const b0 = Math.floor(Math.random() * NUM_BUCKETS);
    const b1 = Math.floor(Math.random() * NUM_BUCKETS);

    runIteration(traverser, b0, b1, t, tables);

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

// Serialisable snapshot for export / caching.
export function exportTables(tables: SolverTables): {
  iterations: number;
  bet: [string, { actions: string[]; probs: number[] }][];
  draw: [string, number[]][];
} {
  return {
    iterations: tables.iterations,
    bet: [...extractBetStrategy(tables)],
    draw: [...extractDrawStrategy(tables)],
  };
}
