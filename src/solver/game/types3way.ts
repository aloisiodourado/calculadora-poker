import type { Street, BlockerBin, DrawCount, Position6Max, StrategyTable, DrawStrategyTable } from "./types";
import { drawBin } from "./types";

export type Position3Way = 0 | 1 | 2;

export interface BettingState3Way {
  pot: number;
  toCall: number;
  betCount: number;
  folded: [boolean, boolean, boolean];
  // Players still owed action before this betting round closes.
  // Ordered: front of array is next to act.
  needsToAct: readonly Position3Way[];
}

export interface SolverTables3Way {
  bet: StrategyTable;
  draw: DrawStrategyTable;
  iterations: number;
}

// Draw history for 3-way: drawHistory[round][player] (3 players)
// Encoding for the key: all 3 players' draw bins per round, separated by semicolons.
function encodeDrawHist(drawHistory: DrawCount[][]): string {
  if (drawHistory.length === 0) return ".";
  return drawHistory.map(round => round.map(drawBin).join(",")).join(";");
}

// The villain positions for an actor are the other 2 players, sorted for canonical form.
function villainPosStr(pos6max: [Position6Max, Position6Max, Position6Max], myPos: Position3Way): string {
  return ([0, 1, 2] as Position3Way[])
    .filter(p => p !== myPos)
    .map(p => pos6max[p])
    .sort()
    .join(",");
}

export function infoSetKey3Way(
  street: Street,
  position: Position3Way,
  myBucket: number,
  myBlockerBin: BlockerBin,
  drawHistory: DrawCount[][], // [round][player 0..2]
  bettingSeq: string[],       // "pos:action" strings
  pos6max: [Position6Max, Position6Max, Position6Max],
  preflopScenario: string,
): string {
  return [
    street,
    position,
    myBucket,
    myBlockerBin,
    encodeDrawHist(drawHistory),
    bettingSeq.join("|") || ".",
    villainPosStr(pos6max, position),
    preflopScenario,
  ].join("~");
}

export function drawInfoSetKey3Way(
  street: Street,
  position: Position3Way,
  myBucket: number,
  myBlockerBin: BlockerBin,
  drawHistory: DrawCount[][],
  bettingSeq: string[],
  pos6max: [Position6Max, Position6Max, Position6Max],
  preflopScenario: string,
): string {
  return [
    "3w",
    street,
    position,
    myBucket,
    myBlockerBin,
    encodeDrawHist(drawHistory),
    bettingSeq.join("|") || ".",
    villainPosStr(pos6max, position),
    preflopScenario,
  ].join("~");
}
