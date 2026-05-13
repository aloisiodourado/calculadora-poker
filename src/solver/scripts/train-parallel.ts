/**
 * Parallel training orchestrator for the 2-7 Triple Draw FL solver.
 *
 * Splits the position combo list across N workers (default: logical CPU cores - 1),
 * runs each as a separate train.ts process, then merges the shard JSONs.
 *
 * Usage:
 *   npx tsx src/solver/scripts/train-parallel.ts [options]
 *
 * Options (passed through to train.ts):
 *   --iterations <n>    Iterations per combo (default: 500_000)
 *   --out <path>        Final merged output (default: public/solver-strategy.json)
 *   --buckets <n>       Bucket calibration samples (default: 100_000)
 *   --transitions <n>   Transition matrix samples (default: 500)
 *   --3way              Train 3-way game tree (default: HU)
 *   --preflop <SR|3B|LP> Fix preflop scenario
 *   --workers <n>       Number of parallel processes (default: logical CPUs - 1, min 1)
 *
 * Example — HU, 500k iters/combo, auto workers:
 *   npx tsx src/solver/scripts/train-parallel.ts --iterations 500000 --out public/solver-strategy.json
 *
 * Example — 3-way, 4 workers:
 *   npx tsx src/solver/scripts/train-parallel.ts --3way --iterations 100000 --workers 4 --out public/solver-strategy-3way.json
 */

import { spawn } from "node:child_process";
import { cpus } from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectComboFiles } from "./stream-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRAIN_SCRIPT = path.join(__dirname, "train.ts");
const MERGE_SCRIPT = path.join(__dirname, "merge.ts");

// ── Arg parsing ────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, def: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
  };

  const workers = Math.max(1, parseInt(get("--workers", String(Math.max(1, cpus().length - 1))), 10));
  const iterations = parseInt(get("--iterations", "500000"), 10);
  const out = get("--out", "public/solver-strategy.json");
  const buckets = get("--buckets", "100000");
  const transitions = get("--transitions", "500");
  const threeWay = args.includes("--3way");
  const preflop = args.includes("--preflop") ? get("--preflop", "") : null;

  return { workers, iterations, out, buckets, transitions, threeWay, preflop };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function totalCombos(threeWay: boolean): number {
  return threeWay ? 216 : 21;
}

function shardOut(baseOut: string, n: number): string {
  const ext = path.extname(baseOut);
  const base = baseOut.slice(0, -ext.length);
  return `${base}-shard${n}${ext}`;
}

function runProcess(args: string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", TRAIN_SCRIPT, ...args], {
      stdio: "pipe",
      env: process.env,
    });

    child.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(
        chunk.toString().split("\n").map(l => l ? `[${label}] ${l}` : "").join("\n"),
      );
    });

    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(
        chunk.toString().split("\n").map(l => l ? `[${label}] ${l}` : "").join("\n"),
      );
    });

    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(`Worker ${label} exited with code ${code}`));
    });
  });
}

function runMerge(shardFiles: string[], out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", MERGE_SCRIPT, "--out", out, ...shardFiles], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(`Merge exited with code ${code}`));
    });
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const total = totalCombos(opts.threeWay);
  const workers = Math.min(opts.workers, total); // no point spawning more than combos

  console.log(`\n2-7 Triple Draw FL Solver — Parallel Training`);
  console.log(`  Mode       : ${opts.threeWay ? "3-way (216 combos)" : "HU (21 combos)"}`);
  console.log(`  Workers    : ${workers}`);
  console.log(`  Iterations : ${opts.iterations.toLocaleString()} per combo`);
  console.log(`  Output     : ${opts.out}`);
  console.log();

  // Ensure output directory exists.
  const outDir = path.dirname(path.resolve(process.cwd(), opts.out));
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Build per-worker args.
  const shardFiles: string[] = [];
  const workerPromises: Promise<void>[] = [];

  for (let n = 1; n <= workers; n++) {
    const shardPath = shardOut(opts.out, n);
    shardFiles.push(shardPath);

    const workerArgs = [
      "--all-positions",
      "--iterations", String(opts.iterations),
      "--out", shardPath,
      "--buckets", opts.buckets,
      "--transitions", opts.transitions,
      "--slice", `${n}/${workers}`,
      ...(opts.threeWay ? ["--3way"] : []),
      ...(opts.preflop ? ["--preflop", opts.preflop] : []),
    ];

    workerPromises.push(runProcess(workerArgs, `W${n}/${workers}`));
  }

  console.log(`Starting ${workers} worker(s)…\n`);
  const start = Date.now();

  try {
    await Promise.all(workerPromises);
  } catch (err) {
    console.error("\nA worker failed:", err);
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`\nAll workers finished in ${elapsed}s. Merging…\n`);

  if (opts.threeWay) {
    // 3-way workers write per-combo files (not shard files) to avoid OOM.
    // Collect all combo files from every worker's combo dir and merge directly.
    const absShardFiles = shardFiles.map(f => path.resolve(process.cwd(), f));
    const comboFiles = collectComboFiles(absShardFiles);

    if (comboFiles.length === 0) {
      console.error("No combo files found in any combo dir. Workers may not have completed.");
      process.exit(1);
    }

    console.log(`Merging ${comboFiles.length} combo files (streaming)…`);
    await runMerge(comboFiles, opts.out);

    // No shard files to clean up (workers skip writing shards in --slice mode).
  } else {
    await runMerge(shardFiles, opts.out);

    // Clean up HU shard files.
    for (const f of shardFiles) {
      try { fs.unlinkSync(path.resolve(process.cwd(), f)); } catch {}
    }
  }

  console.log(`\nDone! Strategy saved to ${opts.out}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
