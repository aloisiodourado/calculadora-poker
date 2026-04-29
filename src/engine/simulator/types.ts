import { Card } from "../cards";
import { PokerVariant } from "../variants";
import { DrawRoundStrategy } from "./drawStrategy";

export type { DrawRoundStrategy };

export interface SimulationInput {
  variant: PokerVariant;
  hands: Card[][];  // known hole cards per player (can be partially known)
  board: Card[];    // known board/community cards
  iterations: number;
  // Triple Draw params
  drawRoundsLeft?: number;           // 1, 2, or 3 — how many draw rounds remain
  playerDrawStrategies?: DrawRoundStrategy[][];  // [playerIdx][3] — always 3 entries, last drawRoundsLeft used
  playerExplicitDiscards?: boolean[][];  // [playerIdx][slotIdx] — true = guaranteed discard this round
}

export interface HandResult {
  hand: Card[];
  equity: number;   // 0–1
  wins: number;
  ties: number;
  losses: number;
  hiWins: number;   // hi-lo variants
  loWins: number;
  loQualified: number; // times this hand qualified for lo
}

export interface SimulationResult {
  results: HandResult[];
  iterationsRun: number;
  durationMs: number;
}

export interface SimulatorEngine {
  simulate(input: SimulationInput): Promise<SimulationResult>;
}
