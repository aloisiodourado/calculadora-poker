/**
 * Offline training script for the 2-7 Triple Draw Fixed-Limit GTO solver.
 *
 * Usage:
 *   npx tsx src/solver/scripts/train.ts [options]
 *
 * Options:
 *   --iterations <n>    Number of CFR iterations per matchup (default: 100_000)
 *   --out <path>        Output JSON file (default: solver-strategy.json)
 *   --buckets <n>       Hand sample size for bucket calibration (default: 100_000)
 *   --transitions <n>   Samples per bucket for transition matrix (default: 500)
 *   --resume <path>     Resume from a previous export JSON
 *   --pos0 <pos>        Fix player 0's 6-max position (UTG|HJ|CO|BTN|SB|BB)
 *   --pos1 <pos>        Fix player 1's 6-max position (UTG|HJ|CO|BTN|SB|BB)
 *   --all-positions     Train all 21 unordered pos0×pos1 combos with --iterations each.
 *                       Total iterations = 21 × --iterations.
 *                       Produces a single JSON covering every positional matchup.
 *   --eval-every <n>    Estimate exploitability every N total iterations and log it.
 *                       Costs ~1-2s per evaluation (500 MC samples). Default: off.
 *   --3way              Train the 3-player (BTN/SB/BB) game tree instead of HU.
 *                       --pos0/pos1/pos2 fix positions; --all-positions trains all
 *                       C(6,3)+C(6,2)+6 = 56 unordered triples.
 *   --pos2 <pos>        Fix player 2's 6-max position (3-way mode only).
 *
 * Modes:
 *   (no flags)           Random positions each iter — general strategy, converges slowly
 *   --pos0 X --pos1 Y    Fixed matchup — fast convergence for one specific scenario
 *   --all-positions      All combos sequentially — uniform coverage, recommended
 *   --3way               3-player game tree (BTN, SB, BB)
 */

import fs from "node:fs";
import path from "node:path";
import { createTables, initSolver, runIterations, exportTables } from "../cfr/trainer";
import type { SolverTables } from "../cfr/trainer";
import type { Position6Max } from "../game/types";
import { ALL_POSITIONS_6MAX } from "../game/ranges";
import { estimateExploitability } from "../cfr/bestResponse";
import type { PreflopScenario } from "../game/preflop";
import { ALL_PREFLOP_SCENARIOS } from "../game/preflop";
import { createTables3Way, initSolver3Way, runIterations3Way, exportTables3Way, KEY_VERSION_3WAY } from "../cfr/trainer3way";
import type { SolverTables3Way } from "../cfr/trainer3way";
import { streamMergeFiles, readStrategyHeader } from "./stream-utils.js";

// ── Parse CLI args ──────────────────────────────────────────────────────────

function parseArgs(): {
  iterations: number;
  out: string;
  buckets: number;
  transitions: number;
  resume: string | null;
  pos0: Position6Max | null;
  pos1: Position6Max | null;
  pos2: Position6Max | null;
  allPositions: boolean;
  evalEvery: number;
  preflopScenario: PreflopScenario | null;
  threeWay: boolean;
  slice: string | null; // "N/M" — train only the N-th of M equal slices of the combo list
} {
  const args = process.argv.slice(2);
  const get = (flag: string, def: string): string => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
  };

  const parsePos = (flag: string): Position6Max | null => {
    const i = args.indexOf(flag);
    if (i === -1 || !args[i + 1]) return null;
    const v = args[i + 1].toUpperCase() as Position6Max;
    if (!(ALL_POSITIONS_6MAX as readonly string[]).includes(v)) {
      console.error(`Invalid position "${args[i + 1]}" for ${flag}. Must be one of: ${ALL_POSITIONS_6MAX.join(", ")}`);
      process.exit(1);
    }
    return v;
  };

  const parseScenario = (flag: string): PreflopScenario | null => {
    const i = args.indexOf(flag);
    if (i === -1 || !args[i + 1]) return null;
    const v = args[i + 1].toUpperCase() as PreflopScenario;
    if (!(ALL_PREFLOP_SCENARIOS as readonly string[]).includes(v)) {
      console.error(`Invalid preflop scenario "${args[i + 1]}" for ${flag}. Must be one of: ${ALL_PREFLOP_SCENARIOS.join(", ")}`);
      process.exit(1);
    }
    return v;
  };

  return {
    iterations: parseInt(get("--iterations", "100000"), 10),
    out: get("--out", "solver-strategy.json"),
    buckets: parseInt(get("--buckets", "100000"), 10),
    transitions: parseInt(get("--transitions", "500"), 10),
    resume: args.includes("--resume") ? get("--resume", "") : null,
    pos0: parsePos("--pos0"),
    pos1: parsePos("--pos1"),
    pos2: parsePos("--pos2"),
    allPositions: args.includes("--all-positions"),
    evalEvery: args.includes("--eval-every") ? parseInt(get("--eval-every", "0"), 10) : 0,
    preflopScenario: parseScenario("--preflop"),
    threeWay: args.includes("--3way"),
    slice: args.includes("--slice") ? get("--slice", "1/1") : null,
  };
}

// ── Resume support ──────────────────────────────────────────────────────────

const KEY_VERSION = "v7"; // keep in sync with trainer.ts

function loadResume(filePath: string, tables: SolverTables): void {
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw) as {
    keyVersion?: string;
    iterations: number;
    bet: [string, { actions: string[]; probs: number[] }][];
    draw: [string, number[]][];
  };

  if (data.keyVersion !== KEY_VERSION) {
    console.warn(`\n  Resume aborted: JSON keyVersion "${data.keyVersion ?? "v1"}" is incompatible with current "${KEY_VERSION}". Starting fresh training.\n`);
    return;
  }

  for (const [key, { actions, probs }] of data.bet) {
    tables.bet.set(key, {
      actions: actions as import("../game/types").BetAction[],
      regretSum: new Array(actions.length).fill(0),
      strategySum: probs.map((p) => p * data.iterations),
    });
  }

  for (const [key, probs] of data.draw) {
    tables.draw.set(key, {
      probabilities: probs.map((p) => p * data.iterations),
      regretSum: new Array(probs.length).fill(0),
      strategySum: probs.map((p) => p * data.iterations),
    });
  }

  tables.iterations = data.iterations;
  console.log(`Resumed from ${filePath} (${data.iterations.toLocaleString()} iterations already done)`);
}

// ── Progress display ────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

// ── Single-matchup training pass ────────────────────────────────────────────

async function trainMatchup(
  tables: SolverTables,
  iterations: number,
  pos0: Position6Max | null,
  pos1: Position6Max | null,
  globalStart: number,
  label: string,
  evalEvery = 0,
  preflopScenario: PreflopScenario | null = null,
  comboIndex = 0,
  totalCombos = 1,
): Promise<void> {
  const progressEvery = Math.max(1000, Math.floor(iterations / 10));
  const yieldEvery = 5_000;
  const startIter = tables.iterations;

  console.log(`\n${label}`);
  console.log(`${"Iter".padStart(10)}  ${"Prog".padStart(5)}  ${"Infosets".padStart(10)}  ${"Elapsed".padStart(10)}  ${"Iter/s".padStart(10)}${evalEvery ? "  Exploitability" : ""}`);
  console.log("-".repeat(evalEvery ? 75 : 55));

  let lastEvalAt = tables.iterations;

  await runIterations(tables, iterations, {
    progressEvery,
    yieldEvery,
    ...(pos0 ? { pos0 } : {}),
    ...(pos1 ? { pos1 } : {}),
    ...(preflopScenario ? { preflopScenario } : {}),
    onProgress({ iterations: totalIter, infosets }) {
      const comboIter = totalIter - startIter;
      const totalDone = comboIndex * iterations + comboIter;
      const pct = `${Math.min(100, Math.round(totalDone / (totalCombos * iterations) * 100))}%`;
      const elapsed = formatMs(Date.now() - globalStart);
      const realIps = Math.round(totalIter / ((Date.now() - globalStart) / 1000));

      let exploitStr = "";
      if (evalEvery > 0 && totalIter - lastEvalAt >= evalEvery) {
        const exploit = estimateExploitability(tables);
        exploitStr = `  ${exploit.toFixed(4)} SB/hand`;
        lastEvalAt = totalIter;
      }

      console.log(
        `${totalIter.toLocaleString().padStart(10)}  ${pct.padStart(4)}  ${infosets.toLocaleString().padStart(10)}  ${elapsed.padStart(10)}  ${realIps.toLocaleString().padStart(10)}/s${exploitStr}`,
      );
    },
  });
}

// ── 3-way training helper ───────────────────────────────────────────────────

async function trainMatchup3Way(
  tables: SolverTables3Way,
  iterations: number,
  pos0: Position6Max | null,
  pos1: Position6Max | null,
  pos2: Position6Max | null,
  globalStart: number,
  label: string,
  preflopScenario: PreflopScenario | null = null,
  comboIndex = 0,
  totalCombos = 1,
): Promise<void> {
  const progressEvery = Math.max(1000, Math.floor(iterations / 10));
  const yieldEvery = 5_000;
  const startIter = tables.iterations;

  console.log(`\n${label}`);
  console.log(`${"Iter".padStart(10)}  ${"Prog".padStart(5)}  ${"Infosets".padStart(10)}  ${"Elapsed".padStart(10)}  ${"Iter/s".padStart(10)}`);
  console.log("-".repeat(55));

  await runIterations3Way(tables, iterations, {
    progressEvery,
    yieldEvery,
    ...(pos0 ? { pos0 } : {}),
    ...(pos1 ? { pos1 } : {}),
    ...(pos2 ? { pos2 } : {}),
    ...(preflopScenario ? { preflopScenario } : {}),
    onProgress({ iterations: totalIter, infosets }) {
      const comboIter = totalIter - startIter;
      const totalDone = comboIndex * iterations + comboIter;
      const pct = `${Math.min(100, Math.round(totalDone / (totalCombos * iterations) * 100))}%`;
      const elapsed = formatMs(Date.now() - globalStart);
      const realIps = Math.round(totalIter / ((Date.now() - globalStart) / 1000));
      console.log(
        `${totalIter.toLocaleString().padStart(10)}  ${pct.padStart(4)}  ${infosets.toLocaleString().padStart(10)}  ${elapsed.padStart(10)}  ${realIps.toLocaleString().padStart(10)}/s`,
      );
    },
  });
}

// ── JSON streaming writer ───────────────────────────────────────────────────
// JSON.stringify on a large strategy fails with "Invalid string length" in V8.
// We write the file in chunks: header fields first, then one entry at a time.

type StrategyExport = {
  keyVersion: string;
  mode?: string;
  iterations: number;
  bucketThresholds?: number[][];
  positions6max?: readonly string[];
  bet: [string, { actions: string[]; probs: number[] }][];
  draw: [string, number[]][];
};

function writeStrategyFile(outPath: string, data: StrategyExport): void {
  const fd = fs.openSync(outPath, "w");
  try {
    // Write all scalar/small fields as the opening portion of the object.
    const header: Record<string, unknown> = { keyVersion: data.keyVersion, iterations: data.iterations };
    if (data.mode !== undefined) header.mode = data.mode;
    if (data.bucketThresholds !== undefined) header.bucketThresholds = data.bucketThresholds;
    if (data.positions6max !== undefined) header.positions6max = Array.from(data.positions6max);
    // Strip closing `}` so we can append the arrays.
    fs.writeSync(fd, JSON.stringify(header).slice(0, -1) + ',"bet":[');

    for (let i = 0; i < data.bet.length; i++) {
      fs.writeSync(fd, (i > 0 ? "," : "") + JSON.stringify(data.bet[i]));
    }

    fs.writeSync(fd, '],"draw":[');

    for (let i = 0; i < data.draw.length; i++) {
      fs.writeSync(fd, (i > 0 ? "," : "") + JSON.stringify(data.draw[i]));
    }

    fs.writeSync(fd, ']}');
  } finally {
    fs.closeSync(fd);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();

  // ── 3-way branch ───────────────────────────────────────────────────────────
  if (opts.threeWay) {
    type Triple = [Position6Max, Position6Max, Position6Max];
    let triples: Triple[];

    if (opts.allPositions) {
      // All ordered (pos0, pos1, pos2) triples: 6³ = 216.
      // Structural roles BTN/SB/BB differ, so order matters.
      triples = [];
      for (const p0 of ALL_POSITIONS_6MAX)
        for (const p1 of ALL_POSITIONS_6MAX)
          for (const p2 of ALL_POSITIONS_6MAX)
            triples.push([p0, p1, p2]);
    } else if (opts.pos0 && opts.pos1 && opts.pos2) {
      triples = [[opts.pos0, opts.pos1, opts.pos2]];
    } else {
      triples = [[null as unknown as Position6Max, null as unknown as Position6Max, null as unknown as Position6Max]];
    }

    // Apply --slice N/M to the triples list.
    if (opts.slice && opts.allPositions) {
      const [n, m] = opts.slice.split("/").map(Number);
      const start = Math.floor((n - 1) / m * triples.length);
      const end = Math.floor(n / m * triples.length);
      triples = triples.slice(start, end);
    }

    const totalIter3W = opts.iterations * triples.length;
    const modeDesc3W = opts.allPositions
      ? `all 216 triples × ${opts.iterations.toLocaleString()} = ${totalIter3W.toLocaleString()} total`
      : opts.pos0 && opts.pos1 && opts.pos2
        ? `${opts.pos0}/${opts.pos1}/${opts.pos2} BTN/SB/BB (fixed)`
        : "random positions per iter";

    console.log(`\n2-7 Triple Draw FL Solver — 3-way (BTN/SB/BB)`);
    console.log(`  Mode       : ${modeDesc3W}`);
    console.log(`  Iterations : ${opts.iterations.toLocaleString()} per combo`);
    console.log(`  Output     : ${opts.out}`);
    console.log(`  Buckets    : ${opts.buckets.toLocaleString()} samples`);
    console.log(`  Transitions: ${opts.transitions} samples/bucket`);
    if (opts.preflopScenario) console.log(`  Preflop    : ${opts.preflopScenario} (fixed)`);
    else console.log(`  Preflop    : sampled (SR 65%, 3B 25%, LP 10%)`);
    console.log();

    process.stdout.write("Initialising buckets and transition matrix...");
    const initStart = Date.now();
    initSolver3Way(opts.buckets, opts.transitions);
    console.log(` done (${formatMs(Date.now() - initStart)})\n`);

    const outPath3w = path.resolve(process.cwd(), opts.out);
    const globalStart3w = Date.now();

    // ── All-positions: per-combo tables + incremental combo files ──────────────
    // Each combo gets a fresh Map so memory is bounded to ~1 combo at a time.
    // Completed combos are written to <out>-combos/<p0>-<p1>-<p2>.json and
    // skipped on resume, so interrupted runs continue from where they left off.
    if (opts.allPositions && triples.length > 1) {
      const comboDir = outPath3w.replace(/\.json$/, "") + "-combos";
      fs.mkdirSync(comboDir, { recursive: true });

      // Detect already-done combos; delete files from incompatible KEY_VERSION.
      const doneKeys = new Set<string>();
      for (const fname of fs.readdirSync(comboDir)) {
        if (!fname.endsWith(".json")) continue;
        const fpath = path.join(comboDir, fname);
        try {
          const hdr = JSON.parse(fs.readFileSync(fpath, "utf-8")) as { keyVersion?: string };
          if (hdr.keyVersion === KEY_VERSION_3WAY) {
            doneKeys.add(fname.replace(/\.json$/, ""));
          } else {
            fs.unlinkSync(fpath); // stale version — remove
          }
        } catch {
          fs.unlinkSync(fpath); // corrupt — remove
        }
      }

      if (doneKeys.size > 0) {
        console.log(`  Incremental: ${doneKeys.size}/${triples.length} combos already done — resuming\n`);
      }

      for (let i = 0; i < triples.length; i++) {
        const [p0, p1, p2] = triples[i];
        const comboKey = `${p0}-${p1}-${p2}`;

        if (doneKeys.has(comboKey)) {
          console.log(`  [${i + 1}/${triples.length}] ${comboKey} — cached`);
          continue;
        }

        const label = `[${i + 1}/${triples.length}] BTN=${p0} SB=${p1} BB=${p2}`;
        const tables = createTables3Way(); // fresh per combo — Map stays small

        await trainMatchup3Way(
          tables, opts.iterations, p0, p1, p2,
          globalStart3w, label, opts.preflopScenario, i, triples.length,
        );

        const exported = exportTables3Way(tables);
        const comboFile = path.join(comboDir, `${comboKey}.json`);
        writeStrategyFile(comboFile, exported);
        doneKeys.add(comboKey);

        const kb = Math.round(fs.statSync(comboFile).size / 1024);
        console.log(`  → [${doneKeys.size}/${triples.length}] ${comboKey} saved (${exported.bet.length}+${exported.draw.length} infosets, ${kb} KB)`);
      }

      const elapsed3w = formatMs(Date.now() - globalStart3w);
      console.log(`\nAll ${doneKeys.size} combos done in ${elapsed3w}.`);

      if (opts.slice) {
        // Parallel mode (--slice N/M): train-parallel.ts will collect all combo
        // files from all workers' combo dirs and run the final streaming merge.
        console.log(`  Combo dir: ${comboDir}`);
        console.log(`  Waiting for train-parallel.ts to merge across workers.`);
      } else {
        // Standalone mode: stream-merge combo files directly into the output file.
        console.log("Merging combo files (streaming)...");
        const comboFilesList = [...doneKeys].map(ck => path.join(comboDir, `${ck}.json`));
        const firstHeader = readStrategyHeader(comboFilesList[0]);
        await streamMergeFiles(comboFilesList, outPath3w, {
          keyVersion:       KEY_VERSION_3WAY,
          mode:             "3way",
          iterations:       doneKeys.size * opts.iterations,
          bucketThresholds: (firstHeader.bucketThresholds as number[][]) ?? [],
          positions6max:    ALL_POSITIONS_6MAX,
        });
        const kb3w = Math.round(fs.statSync(outPath3w).size / 1024);
        console.log(`Exported to ${outPath3w} (${kb3w.toLocaleString()} KB), ${doneKeys.size} combos`);
      }
      return;
    }

    // ── Single combo or random: one shared table is fine ──────────────────────
    const [p0, p1, p2] = triples[0];
    const isRandom = p0 === null;
    const label3w = isRandom
      ? "Training 3-way (random positions)"
      : `Training 3-way BTN=${p0} SB=${p1} BB=${p2}`;

    const tables3w = createTables3Way();
    await trainMatchup3Way(
      tables3w, opts.iterations,
      isRandom ? null : p0, isRandom ? null : p1, isRandom ? null : p2,
      globalStart3w, label3w, opts.preflopScenario, 0, 1,
    );

    const elapsed3w = formatMs(Date.now() - globalStart3w);
    console.log(`\n${"=".repeat(50)}`);
    console.log(`Done: ${tables3w.iterations.toLocaleString()} iters, ${tables3w.bet.size + tables3w.draw.size} infosets, ${elapsed3w}`);

    const exported3w = exportTables3Way(tables3w);
    writeStrategyFile(outPath3w, exported3w);
    const kb3w = Math.round(fs.statSync(outPath3w).size / 1024);
    console.log(`Exported to ${outPath3w} (${kb3w} KB)`);
    console.log(`  Betting infosets: ${exported3w.bet.length.toLocaleString()}`);
    console.log(`  Draw infosets   : ${exported3w.draw.length.toLocaleString()}`);
    return;
  }

  // ── HU branch (original) ───────────────────────────────────────────────────

  // Build the list of (pos0, pos1) combos to train.
  // With --all-positions we use unordered pairs: (BTN, BB) and (BB, BTN) are
  // the same HU matchup, so we train each pair exactly once.
  // Canonical order: lower index in ALL_POSITIONS_6MAX goes to pos0.
  // This gives C(6,2) + 6 = 21 unique pairs (15 distinct + 6 same-position).
  type Combo = [Position6Max, Position6Max];
  let combos: Combo[];

  if (opts.allPositions) {
    combos = [];
    for (let i = 0; i < ALL_POSITIONS_6MAX.length; i++) {
      for (let j = i; j < ALL_POSITIONS_6MAX.length; j++) {
        combos.push([ALL_POSITIONS_6MAX[i], ALL_POSITIONS_6MAX[j]]);
      }
    }
  } else if (opts.pos0 && opts.pos1) {
    // Normalise to canonical order so manual flags also deduplicate
    const i = ALL_POSITIONS_6MAX.indexOf(opts.pos0);
    const j = ALL_POSITIONS_6MAX.indexOf(opts.pos1);
    combos = i <= j ? [[opts.pos0, opts.pos1]] : [[opts.pos1, opts.pos0]];
  } else {
    combos = [[null as unknown as Position6Max, null as unknown as Position6Max]]; // random mode
  }

  // Apply --slice N/M: only train the N-th chunk of M equal slices.
  if (opts.slice && opts.allPositions) {
    const [n, m] = opts.slice.split("/").map(Number);
    const start = Math.floor((n - 1) / m * combos.length);
    const end = Math.floor(n / m * combos.length);
    combos = combos.slice(start, end);
  }

  const totalIterations = opts.iterations * combos.length;
  const modeDesc = opts.allPositions
    ? `all 21 combos × ${opts.iterations.toLocaleString()} = ${totalIterations.toLocaleString()} total`
    : opts.pos0 && opts.pos1
      ? `${combos[0][0]} vs ${combos[0][1]} (fixed)`
      : "random positions per iter";

  console.log(`\n2-7 Triple Draw FL Solver — 6-max Phase 1`);
  console.log(`  Mode       : ${modeDesc}`);
  console.log(`  Iterations : ${opts.iterations.toLocaleString()} per combo`);
  console.log(`  Output     : ${opts.out}`);
  console.log(`  Buckets    : ${opts.buckets.toLocaleString()} samples`);
  console.log(`  Transitions: ${opts.transitions} samples/bucket`);
  if (opts.resume) console.log(`  Resume     : ${opts.resume}`);
  if (opts.preflopScenario) console.log(`  Preflop    : ${opts.preflopScenario} (fixed)`);
  else console.log(`  Preflop    : sampled (SR 65%, 3B 25%, LP 10%)`);
  console.log();

  // Initialise pre-computation
  process.stdout.write("Initialising buckets and transition matrix...");
  const initStart = Date.now();
  initSolver(opts.buckets, opts.transitions);
  console.log(` done (${formatMs(Date.now() - initStart)})\n`);

  // Create (or resume) tables
  const tables = createTables();
  if (opts.resume) loadResume(opts.resume, tables);

  const globalStart = Date.now();

  // Train each combo
  for (let i = 0; i < combos.length; i++) {
    const [p0, p1] = combos[i];
    const isRandom = p0 === null;
    const comboLabel = opts.allPositions
      ? `[${i + 1}/${combos.length}] ${p0} vs ${p1}`
      : isRandom
        ? "Training (random positions)"
        : `Training ${p0} vs ${p1}`;

    await trainMatchup(tables, opts.iterations, isRandom ? null : p0, isRandom ? null : p1, globalStart, comboLabel, opts.evalEvery, opts.preflopScenario, i, combos.length);

    // Intermediate save after each combo when running --all-positions
    if (opts.allPositions && combos.length > 1) {
      const outPath = path.resolve(process.cwd(), opts.out);
      const exported = exportTables(tables);
      writeStrategyFile(outPath, exported);
      const kb = Math.round(fs.statSync(outPath).size / 1024);
      console.log(`  → checkpoint saved (${(i + 1)}/21 combos, ${tables.iterations.toLocaleString()} iters, ${kb} KB)`);
    }
  }

  const elapsed = formatMs(Date.now() - globalStart);
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Done: ${tables.iterations.toLocaleString()} total iterations, ${tables.bet.size + tables.draw.size} infosets, ${elapsed}`);

  // Final export
  const exported = exportTables(tables, {
    pos0: opts.allPositions ? undefined : (opts.pos0 ?? undefined),
    pos1: opts.allPositions ? undefined : (opts.pos1 ?? undefined),
  });
  const outPath = path.resolve(process.cwd(), opts.out);
  writeStrategyFile(outPath, exported);

  const fileSizeKb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`Exported to ${outPath} (${fileSizeKb} KB)`);
  console.log(`  Betting infosets: ${exported.bet.length.toLocaleString()}`);
  console.log(`  Draw infosets   : ${exported.draw.length.toLocaleString()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
