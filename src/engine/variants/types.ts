export enum PokerVariant {
  TexasHoldem = "texas-holdem",
  OmahaHi = "omaha-hi",
  OmahaHiLo = "omaha-hi-lo",
  SevenCardStud = "seven-card-stud",
  StudHiLo = "stud-hi-lo",
  Razz = "razz",
  SingleDraw27 = "2-7-single-draw",
  TripleDraw27 = "2-7-triple-draw",
  TripleDraw27WIP = "2-7-td-wip",
  Badugi = "badugi",
}

export type EvaluatorType = "high" | "a5low" | "27low" | "badugi";

export interface VariantConfig {
  name: string;
  holeCards: number;        // cards dealt face-down to each player
  communityCards: number;   // shared board cards (0 for stud/draw games)
  totalCards: number;       // total cards a player ends up with
  evaluators: EvaluatorType[]; // ["high"] | ["a5low"] | ["high","a5low"] for hi-lo
  // For Omaha: must use exactly 2 hole cards + 3 community
  omahaRules: boolean;
  // For stud: some cards are face-up (relevant for UI, not equity calc)
  studGame: boolean;
}
