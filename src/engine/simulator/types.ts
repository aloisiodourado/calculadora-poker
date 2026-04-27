import { Card } from "../cards";
import { PokerVariant } from "../variants";

export interface SimulationInput {
  variant: PokerVariant;
  hands: Card[][];  // known hole cards per player (can be partially known)
  board: Card[];    // known board/community cards
  iterations: number;
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
