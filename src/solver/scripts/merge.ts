/**
 * Merge multiple partial training JSON files into a single strategy file.
 *
 * Usage:
 *   npx tsx src/solver/scripts/merge.ts --out merged.json file1.json file2.json ...
 *
 * Each input file was trained on a disjoint subset of position combos, so
 * infoset keys do not overlap.  Merging is a streaming concatenation of the
 * bet/draw arrays — no large in-memory allocations.
 */

import fs from "node:fs";
import path from "node:path";
import { streamMergeFiles, readStrategyHeader } from "./stream-utils.js";

function parseArgs(): { out: string; files: string[] } {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const out = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : "merged-strategy.json";
  const files = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--out"));
  return { out, files };
}

async function main() {
  const { out, files } = parseArgs();

  if (files.length === 0) {
    console.error("Usage: merge.ts --out <out.json> <file1.json> <file2.json> ...");
    process.exit(1);
  }

  const absPaths = files.map(f => path.resolve(process.cwd(), f));
  for (const p of absPaths) {
    if (!fs.existsSync(p)) { console.error(`File not found: ${p}`); process.exit(1); }
  }

  console.log(`Merging ${files.length} file(s) → ${out}`);

  // Read headers without loading bet/draw content.
  const headers = absPaths.map(readStrategyHeader);

  // Validate all key versions match.
  const versions = [...new Set(headers.map(h => h.keyVersion))];
  if (versions.length > 1) {
    console.error(`Key version mismatch: ${versions.join(", ")} — all files must use the same training version.`);
    process.exit(1);
  }

  const totalIterations = headers.reduce((s, h) => s + h.iterations, 0);
  const baseHeader = headers[0];

  if (!baseHeader.bucketThresholds) {
    console.error("First file is missing bucketThresholds.");
    process.exit(1);
  }

  const outPath = path.resolve(process.cwd(), out);
  await streamMergeFiles(absPaths, outPath, {
    keyVersion:        baseHeader.keyVersion,
    mode:              baseHeader.mode,
    iterations:        Math.round(totalIterations / files.length), // avg per-infoset
    bucketThresholds:  baseHeader.bucketThresholds,
    positions6max:     baseHeader.positions6max ?? [],
  });

  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`✓ Merged ${files.length} file(s) → ${outPath} (${kb.toLocaleString()} KB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
