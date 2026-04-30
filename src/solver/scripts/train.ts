/**
 * Offline training script for the 2-7 Triple Draw Fixed-Limit GTO solver.
 *
 * Usage:
 *   npx tsx src/solver/scripts/train.ts [options]
 *
 * Options:
 *   --iterations <n>   Number of CFR iterations (default: 100_000)
 *   --out <path>       Output JSON file (default: solver-strategy.json)
 *   --buckets <n>      Hand sample size for bucket calibration (default: 100_000)
 *   --transitions <n>  Samples per bucket for transition matrix (default: 500)
 *   --resume <path>    Resume from a previous export JSON
 */

import fs from "node:fs";
import path from "node:path";
import { createTables, initSolver, runIterations, exportTables } from "../cfr/trainer";
import type { SolverTables } from "../cfr/trainer";

// ── Parse CLI args ──────────────────────────────────────────────────────────

function parseArgs(): {
  iterations: number;
  out: string;
  buckets: number;
  transitions: number;
  resume: string | null;
} {
  const args = process.argv.slice(2);
  const get = (flag: string, def: string): string => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
  };
  return {
    iterations: parseInt(get("--iterations", "100000"), 10),
    out: get("--out", "solver-strategy.json"),
    buckets: parseInt(get("--buckets", "100000"), 10),
    transitions: parseInt(get("--transitions", "500"), 10),
    resume: args.includes("--resume") ? get("--resume", "") : null,
  };
}

// ── Resume support ──────────────────────────────────────────────────────────

function loadResume(filePath: string, tables: SolverTables): void {
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw) as {
    iterations: number;
    bet: [string, { actions: string[]; probs: number[] }][];
    draw: [string, number[]][];
  };

  // Rebuild bet table from average strategy snapshot (regret sums are lost,
  // but strategySum is re-seeded so the average is warm-started)
  for (const [key, { actions, probs }] of data.bet) {
    tables.bet.set(key, {
      actions,
      regretSum: new Array(actions.length).fill(0),
      strategySum: probs.map((p) => p * data.iterations),
    });
  }

  // Rebuild draw table
  for (const [key, probs] of data.draw) {
    tables.draw.set(key, {
      strategySum: probs.map((p) => p * data.iterations),
    });
  }

  tables.iterations = data.iterations;
  console.log(`Resumed from ${filePath} (${data.iterations} iterations already done)`);
}

// ── Progress display ────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();
  console.log(`\n2-7 Triple Draw FL Solver`);
  console.log(`  Iterations : ${opts.iterations.toLocaleString()}`);
  console.log(`  Output     : ${opts.out}`);
  console.log(`  Buckets    : ${opts.buckets.toLocaleString()} samples`);
  console.log(`  Transitions: ${opts.transitions} samples/bucket`);
  if (opts.resume) console.log(`  Resume     : ${opts.resume}`);
  console.log();

  // Initialise shared pre-computation (buckets + transition matrix)
  process.stdout.write("Initialising buckets and transition matrix...");
  const initStart = Date.now();
  initSolver(opts.buckets, opts.transitions);
  console.log(` done (${formatMs(Date.now() - initStart)})\n`);

  // Create (or resume) tables
  const tables = createTables();
  if (opts.resume) loadResume(opts.resume, tables);

  const targetIterations = opts.iterations;
  const progressEvery = Math.max(1000, Math.floor(targetIterations / 20));
  const yieldEvery = 5_000;

  let lastReport = 0;
  const trainingStart = Date.now();

  console.log(`Training ${targetIterations.toLocaleString()} iterations...`);
  console.log(`${"Iter".padStart(10)}  ${"Infosets".padStart(10)}  ${"Elapsed".padStart(10)}  ${"Iter/s".padStart(10)}`);
  console.log("-".repeat(50));

  const result = await runIterations(tables, targetIterations, {
    progressEvery,
    yieldEvery,
    onProgress({ iterations, infosets, durationMs }) {
      const itersSinceReport = iterations - lastReport;
      const itersPerSec = itersSinceReport > 0
        ? Math.round(itersSinceReport / ((Date.now() - trainingStart - (lastReport === 0 ? 0 : 0)) / 1000))
        : 0;
      const elapsed = formatMs(Date.now() - trainingStart);
      const ips = Math.round(iterations / ((Date.now() - trainingStart) / 1000));
      console.log(
        `${iterations.toLocaleString().padStart(10)}  ${infosets.toLocaleString().padStart(10)}  ${elapsed.padStart(10)}  ${ips.toLocaleString().padStart(10)}/s`,
      );
      lastReport = iterations;
      void itersSinceReport; void itersPerSec; void durationMs;
    },
  });

  console.log("-".repeat(50));
  console.log(
    `\nDone: ${result.iterations.toLocaleString()} iterations, ` +
    `${result.infosets.toLocaleString()} infosets, ` +
    `${formatMs(result.durationMs)}\n`,
  );

  // Export to JSON
  const exported = exportTables(tables);
  const outPath = path.resolve(process.cwd(), opts.out);
  fs.writeFileSync(outPath, JSON.stringify(exported));

  const fileSizeKb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`Exported strategy to ${outPath} (${fileSizeKb} KB)`);
  console.log(`  Betting infosets: ${exported.bet.length.toLocaleString()}`);
  console.log(`  Draw infosets   : ${exported.draw.length.toLocaleString()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
