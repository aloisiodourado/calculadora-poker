/**
 * Streaming utilities for merging large strategy JSON files without loading
 * them entirely into memory.
 *
 * The strategy file format written by writeStrategyFile is:
 *   {"keyVersion":"...","mode":"...","iterations":N,"bucketThresholds":[...],"positions6max":[...],"bet":[ENTRIES],"draw":[ENTRIES]}
 *
 * extractArraySectionFromBuf extracts a raw subarray view of the content
 * between the "[" and "]" of a named array field — no copies, no JSON parsing.
 *
 * streamMergeFiles reads each input file once, writes bet sections to a temp
 * file and draw sections to another, then pipelines both into the final output.
 * Peak RAM is bounded by one input file at a time (~183 MB for combo files).
 */

import fs from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";

// ── Array section extractor ────────────────────────────────────────────────────

// Finds the raw content of `"field":[...]` in buf and returns a subarray view
// (no copy) of the content between the [ and ] delimiters.
// Returns an empty Buffer if the field is not found.
export function extractArraySectionFromBuf(buf: Buffer, field: string): Buffer {
  const marker = Buffer.from(`"${field}":[`);

  let start = -1;
  outer: for (let i = 0; i <= buf.length - marker.length; i++) {
    for (let j = 0; j < marker.length; j++) {
      if (buf[i + j] !== marker[j]) continue outer;
    }
    start = i + marker.length;
    break;
  }
  if (start === -1) return Buffer.alloc(0);

  let depth = 1, inString = false;
  let i = start;
  while (i < buf.length && depth > 0) {
    const c = buf[i];
    if (inString) {
      if (c === 92) { i += 2; continue; } // backslash — skip next char
      if (c === 34) inString = false;      // close quote
    } else {
      if      (c === 34)         inString = true;
      else if (c === 91 || c === 123) depth++;          // [ or {
      else if (c === 93 || c === 125) { if (--depth === 0) break; } // ] or }
    }
    i++;
  }
  return buf.subarray(start, i);
}

// ── Header reader ──────────────────────────────────────────────────────────────

export interface StrategyHeader {
  keyVersion: string;
  mode?: string;
  iterations: number;
  bucketThresholds?: number[][];
  positions6max?: readonly string[];
}

// Reads just the header fields of a strategy JSON (stops before "bet":[).
// Loads only the first 16 KB — header is always near the start.
export function readStrategyHeader(filePath: string): StrategyHeader {
  const PEEK = 16 * 1024;
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.allocUnsafe(PEEK);
  const n = fs.readSync(fd, buf, 0, PEEK, 0);
  fs.closeSync(fd);

  const str = buf.subarray(0, n).toString("utf-8");
  const betIdx = str.indexOf('"bet":[');
  const truncated = betIdx !== -1 ? str.substring(0, betIdx) + "}" : str;

  try {
    return JSON.parse(truncated) as StrategyHeader;
  } catch {
    // Fallback: extract fields with regex
    const kv  = (str.match(/"keyVersion"\s*:\s*"([^"]+)"/) ?? [])[1] ?? "unknown";
    const iter = parseInt((str.match(/"iterations"\s*:\s*(\d+)/) ?? [])[1] ?? "0", 10);
    return { keyVersion: kv, iterations: iter };
  }
}

// ── Streaming merge ────────────────────────────────────────────────────────────

export interface MergeHeader {
  keyVersion: string;
  mode?: string;
  iterations: number;
  bucketThresholds: number[][];
  positions6max: readonly string[];
}

// Merges multiple strategy JSON files into outputPath.
//
// Algorithm (two-phase to avoid large in-memory arrays):
//   Phase 1: for each input file, read it once, extract bet + draw sections,
//            append them to separate temp files (with commas).
//   Phase 2: pipeline betTmp → output → drawTmp → output using streams.
//
// Peak RAM = one input file (e.g. 183 MB for combo files).
// Disk overhead = betTmp + drawTmp (~total bet/draw content).
export async function streamMergeFiles(
  inputFiles: string[],
  outputPath: string,
  header: MergeHeader,
): Promise<void> {
  const betTmpPath  = outputPath + ".bet.tmp";
  const drawTmpPath = outputPath + ".draw.tmp";

  // ── Phase 1: extract sections into temp files ────────────────────────────────
  const fdBet  = fs.openSync(betTmpPath,  "w");
  const fdDraw = fs.openSync(drawTmpPath, "w");
  let betFirst = true, drawFirst = true;

  for (const f of inputFiles) {
    const buf = fs.readFileSync(f); // bounded by file size (e.g. 183 MB)

    const betSection = extractArraySectionFromBuf(buf, "bet");
    if (betSection.length > 0) {
      if (!betFirst) fs.writeSync(fdBet, Buffer.from(","));
      fs.writeSync(fdBet, betSection);
      betFirst = false;
    }

    const drawSection = extractArraySectionFromBuf(buf, "draw");
    if (drawSection.length > 0) {
      if (!drawFirst) fs.writeSync(fdDraw, Buffer.from(","));
      fs.writeSync(fdDraw, drawSection);
      drawFirst = false;
    }
    // buf released to GC here
  }

  fs.closeSync(fdBet);
  fs.closeSync(fdDraw);

  // ── Phase 2: assemble final file via streams ─────────────────────────────────
  const headerObj: Record<string, unknown> = {
    keyVersion: header.keyVersion,
    iterations: header.iterations,
    bucketThresholds: header.bucketThresholds,
    positions6max: Array.from(header.positions6max),
  };
  if (header.mode !== undefined) headerObj.mode = header.mode;

  const out = createWriteStream(outputPath);
  out.write(JSON.stringify(headerObj).slice(0, -1) + ',"bet":[');
  await pipeline(createReadStream(betTmpPath),  out, { end: false });
  out.write('],"draw":[');
  await pipeline(createReadStream(drawTmpPath), out, { end: false });
  out.write(']}');
  out.end();
  await new Promise<void>(r => out.once("finish", r));

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  try { fs.unlinkSync(betTmpPath);  } catch {}
  try { fs.unlinkSync(drawTmpPath); } catch {}
}

// ── Combo-dir file collector ───────────────────────────────────────────────────

// Given a list of shard output paths, returns all combo files across their
// corresponding combo directories (e.g. solver-strategy-3way-shard1-combos/).
export function collectComboFiles(shardPaths: string[]): string[] {
  const files: string[] = [];
  for (const shard of shardPaths) {
    const comboDir = shard.replace(/\.json$/, "") + "-combos";
    if (!fs.existsSync(comboDir)) continue;
    for (const f of fs.readdirSync(comboDir)) {
      if (f.endsWith(".json")) files.push(path.join(comboDir, f));
    }
  }
  return files;
}
