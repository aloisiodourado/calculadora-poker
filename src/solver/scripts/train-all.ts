/**
 * Full training orchestrator — runs HU + 3-way simultaneously.
 *
 * Allocates workers proportionally to each mode's workload
 * (combos × iterations), so slower jobs get more cores.
 *
 * Usage:
 *   npx tsx src/solver/scripts/train-all.ts [options]
 *
 * Options:
 *   --workers <n>          Total worker budget (default: logical CPUs - 1, min 2)
 *   --iterations-hu <n>    Iterations per HU combo (default: 500_000)
 *   --iterations-3way <n>  Iterations per 3-way combo (default: 100_000)
 *   --out-hu <path>        HU output (default: public/solver-strategy.json)
 *   --out-3way <path>      3-way output (default: public/solver-strategy-3way.json)
 *   --buckets <n>          Bucket calibration samples (default: 100_000)
 *   --transitions <n>      Transition matrix samples (default: 500)
 *
 * Example:
 *   npx tsx src/solver/scripts/train-all.ts --workers 8
 */

import { spawn } from "node:child_process";
import { cpus } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARALLEL_SCRIPT = path.join(__dirname, "train-parallel.ts");

const HU_COMBOS    = 21;
const TWAY_COMBOS  = 216;

// ── Arg parsing ────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, def: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
  };

  const totalCpus   = Math.max(1, cpus().length - 1);
  const totalWorkers = Math.max(2, parseInt(get("--workers", String(totalCpus)), 10));
  const iterHu      = parseInt(get("--iterations-hu",   "500000"), 10);
  const iter3way    = parseInt(get("--iterations-3way", "100000"), 10);
  const outHu       = get("--out-hu",   "public/solver-strategy.json");
  const out3way     = get("--out-3way", "public/solver-strategy-3way.json");
  const buckets     = get("--buckets",    "100000");
  const transitions = get("--transitions", "500");

  return { totalWorkers, iterHu, iter3way, outHu, out3way, buckets, transitions };
}

// ── Worker allocation ──────────────────────────────────────────────────────────

function allocateWorkers(
  total: number,
  iterHu: number,
  iter3way: number,
): { hu: number; tway: number } {
  const workHu   = HU_COMBOS   * iterHu;
  const work3way = TWAY_COMBOS * iter3way;
  const totalWork = workHu + work3way;

  const raw3way = Math.round((work3way / totalWork) * total);
  const tway    = Math.max(1, Math.min(total - 1, raw3way));
  const hu      = Math.max(1, total - tway);

  return { hu, tway };
}

// ── Process runner ─────────────────────────────────────────────────────────────

function runParallel(args: string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", PARALLEL_SCRIPT, ...args], {
      stdio: "pipe",
      env: process.env,
    });

    child.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(
        chunk.toString()
          .split("\n")
          .map(l => l ? `[${label}] ${l}` : "")
          .join("\n"),
      );
    });

    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(
        chunk.toString()
          .split("\n")
          .map(l => l ? `[${label}] ${l}` : "")
          .join("\n"),
      );
    });

    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const { hu: huWorkers, tway: twayWorkers } = allocateWorkers(
    opts.totalWorkers, opts.iterHu, opts.iter3way,
  );

  const huWork   = (HU_COMBOS   * opts.iterHu   / 1_000_000).toFixed(1);
  const twayWork = (TWAY_COMBOS * opts.iter3way  / 1_000_000).toFixed(1);

  console.log(`\n2-7 Triple Draw FL Solver — Full Training (HU + 3-way)`);
  console.log(`  Total workers  : ${opts.totalWorkers}`);
  console.log(`  HU   (${HU_COMBOS} combos × ${opts.iterHu.toLocaleString()} iter = ${huWork}M)  → ${huWorkers} worker(s)`);
  console.log(`  3-way (${TWAY_COMBOS} combos × ${opts.iter3way.toLocaleString()} iter = ${twayWork}M) → ${twayWorkers} worker(s)`);
  console.log(`  HU output      : ${opts.outHu}`);
  console.log(`  3-way output   : ${opts.out3way}`);
  console.log();

  const huArgs = [
    "--workers",    String(huWorkers),
    "--iterations", String(opts.iterHu),
    "--out",        opts.outHu,
    "--buckets",    opts.buckets,
    "--transitions", opts.transitions,
  ];

  const twayArgs = [
    "--3way",
    "--workers",    String(twayWorkers),
    "--iterations", String(opts.iter3way),
    "--out",        opts.out3way,
    "--buckets",    opts.buckets,
    "--transitions", opts.transitions,
  ];

  const start = Date.now();

  try {
    await Promise.all([
      runParallel(huArgs,   "HU  "),
      runParallel(twayArgs, "3WAY"),
    ]);
  } catch (err) {
    console.error("\nTraining failed:", err);
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`\nDone in ${elapsed}s.`);
  console.log(`  HU    → ${opts.outHu}`);
  console.log(`  3-way → ${opts.out3way}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
