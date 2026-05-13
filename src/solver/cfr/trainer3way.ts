import type { Position6Max } from "../game/types";
import type { BlockerBin } from "../game/types";
import type { Position3Way } from "../game/types3way";
import type { SolverTables3Way } from "./cfr3way";
import { runIteration3Way } from "./cfr3way";
import { StrategyTable, DrawStrategyTable } from "../game/types";
import { averageStrategy, averageDrawStrategy } from "./strategy";
import { initBuckets, initBlockerDist, sampleBlockerBinForBucket, getBucketThresholdMatrix } from "../abstraction/handBuckets";
import { initTransitionMatrix, initBlockerTransition } from "../abstraction/bucketTransition";
import { samplePosition, ALL_POSITIONS_6MAX } from "../game/ranges";
import { sampleBucketConditioned, samplePreflopScenario, ALL_PREFLOP_SCENARIOS } from "../game/preflop";
import type { PreflopScenario } from "../game/preflop";

export type { SolverTables3Way };

// Bump when the 3-way infoset key format changes.
export const KEY_VERSION_3WAY = "3w-v2";

// ── Table management ───────────────────────────────────────────────────────────

export function createTables3Way(): SolverTables3Way {
  return {
    bet: new Map() as StrategyTable,
    draw: new Map() as DrawStrategyTable,
    iterations: 0,
  };
}

// Shared with the HU solver — call once before any training.
export function initSolver3Way(bucketSamples?: number, transitionSamples?: number): void {
  initBuckets(bucketSamples);
  initBlockerDist(bucketSamples);
  initTransitionMatrix(transitionSamples);
  initBlockerTransition(transitionSamples);
}

// ── Training options ───────────────────────────────────────────────────────────

export interface TrainingOptions3Way {
  onProgress?: (progress: { iterations: number; infosets: number; durationMs: number }) => void;
  progressEvery?: number;
  yieldEvery?: number;
  pos0?: Position6Max;
  pos1?: Position6Max;
  pos2?: Position6Max;
  preflopScenario?: PreflopScenario;
}

// ── Training loop ──────────────────────────────────────────────────────────────

export async function runIterations3Way(
  tables: SolverTables3Way,
  count: number,
  opts: TrainingOptions3Way = {},
): Promise<{ iterations: number; infosets: number; durationMs: number }> {
  const { onProgress, progressEvery = 10_000, yieldEvery = 5_000 } = opts;
  const start = Date.now();

  for (let i = 0; i < count; i++) {
    tables.iterations++;
    const t = tables.iterations;

    // Alternate traverser across all 3 players.
    const traverser = (t % 3) as Position3Way;

    const p0 = opts.pos0 ?? samplePosition();
    const p1 = opts.pos1 ?? samplePosition();
    const p2 = opts.pos2 ?? samplePosition();
    const scenario = opts.preflopScenario ?? samplePreflopScenario();

    const b0 = sampleBucketConditioned(p0, "pos0", scenario); // BTN
    const b1 = sampleBucketConditioned(p1, "pos1", scenario); // SB
    const b2 = sampleBucketConditioned(p2, "pos2", scenario); // BB — wider defender, free look in LP

    const bl0 = sampleBlockerBinForBucket(b0) as BlockerBin;
    const bl1 = sampleBlockerBinForBucket(b1) as BlockerBin;
    const bl2 = sampleBlockerBinForBucket(b2) as BlockerBin;

    runIteration3Way(traverser, b0, bl0, b1, bl1, b2, bl2, t, tables, p0, p1, p2, scenario);

    if (i % yieldEvery === 0 && i > 0) {
      await new Promise<void>(r => setTimeout(r, 0));
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

// ── Export ─────────────────────────────────────────────────────────────────────

const PROB_PRECISION = 4;

function roundProbs(probs: number[]): number[] {
  return probs.map(p => parseFloat(p.toFixed(PROB_PRECISION)));
}

export function exportTables3Way(
  tables: SolverTables3Way,
  trainingMeta?: { pos0?: Position6Max; pos1?: Position6Max; pos2?: Position6Max },
): {
  keyVersion: string;
  mode: "3way";
  iterations: number;
  bucketThresholds: number[][];
  positions6max: readonly string[];
  bet: [string, { actions: string[]; probs: number[] }][];
  draw: [string, number[]][];
} {
  const bet: [string, { actions: string[]; probs: number[] }][] = [];
  for (const [key, node] of tables.bet) {
    if (!node.strategySum.some(s => s > 0)) continue;
    bet.push([key, { actions: node.actions, probs: roundProbs(averageStrategy(node)) }]);
  }

  const draw: [string, number[]][] = [];
  for (const [key, node] of tables.draw) {
    draw.push([key, roundProbs(averageDrawStrategy(node))]);
  }

  return {
    keyVersion: KEY_VERSION_3WAY,
    mode: "3way",
    iterations: tables.iterations,
    bucketThresholds: getBucketThresholdMatrix(),
    positions6max: ALL_POSITIONS_6MAX,
    bet,
    draw,
  };
}
