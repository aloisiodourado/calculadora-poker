import { Card } from "@/engine/cards";

// ── Streets ────────────────────────────────────────────────────────────────────
// 0 = pre-draw betting, 1 = post-draw-1, 2 = post-draw-2, 3 = post-draw-3

export type Street = 0 | 1 | 2 | 3;

// ── 6-max positions ────────────────────────────────────────────────────────────
// Opening position of a player at a 6-max table.
// Used as a range signal: UTG opens ~15% (tight), BTN opens ~45% (wide).

export type Position6Max = "UTG" | "HJ" | "CO" | "BTN" | "SB" | "BB";

// ── Positions ──────────────────────────────────────────────────────────────────
// Heads-up FL convention: position 0 = Button/SB (acts first pre-draw, second post-draw)
//                         position 1 = BB       (acts second pre-draw, first post-draw)

export type Position = 0 | 1;

// ── Actions ────────────────────────────────────────────────────────────────────

export type BetAction = "fold" | "check" | "call" | "bet" | "raise";

// Number of cards discarded (0 = stand pat)
export type DrawCount = 0 | 1 | 2 | 3 | 4 | 5;

// Count of rank-2/3 cards in hand, binned: 0 = 0-1, 1 = 2-3, 2 = 4-5
export type BlockerBin = 0 | 1 | 2;

// ── Betting state within a street ─────────────────────────────────────────────

export interface BettingState {
  pot: number;       // accumulated pot in small-bet units
  toCall: number;    // amount the acting player must put in to call (0 = no open bet)
  betCount: number;  // bets+raises committed this street (caps at FL_CAP)
}

// ── Full game state (used internally by CFR traversal) ─────────────────────────

export interface GameState {
  street: Street;
  activePlayer: Position;
  betting: BettingState;

  // Public draw history: how many cards each player drew each draw round
  // drawHistory[drawRound][player] = DrawCount
  drawHistory: DrawCount[][];

  // Private: each player's current hand (5 cards, null = to be drawn)
  hands: [Card[], Card[]];

  // Each player's abstracted bucket for the current street
  buckets: [number, number];

  terminal: false;
}

export interface TerminalState {
  terminal: true;
  // Payoff for player 0 in small-bet units (+pot = player 0 wins, -pot = player 1 wins)
  payoff: number;
}

export type SolverState = GameState | TerminalState;

// ── Information Set ────────────────────────────────────────────────────────────
// What a player knows at decision time — used as the key in the strategy table.

export interface InfoSet {
  street: Street;
  position: Position;
  myBucket: number;
  myBlockerBin: BlockerBin;

  // Opponent draw counts in each prior draw round (public info)
  opponentDrawHistory: DrawCount[];

  // Sequence of bet actions in the current street up to this point
  bettingSequence: BetAction[];

  // 6-max opening position of the villain — encodes their preflop range.
  // UTG = tight (~15%), BTN = wide (~45%), etc.
  villainPosition: Position6Max;

  // Preflop scenario that led to this HU game — conditions both players' ranges.
  // "SR" = single raise, "3B" = 3-bet pot, "LP" = limp pot.
  preflopScenario: string;
}

// Opponent draw count → 3-bin abstraction to limit key explosion.
// 0 = pat, 1 = drew 1-2, 2 = drew 3-5.
// Reduces combinations from 6^N to 3^N (e.g. street 3: 216 → 27).
export function drawBin(d: DrawCount): 0 | 1 | 2 {
  if (d === 0) return 0;
  if (d <= 2) return 1;
  return 2;
}

// Canonical string key for a Map lookup
export function infoSetKey(is: InfoSet): string {
  return [
    is.street,
    is.position,
    is.myBucket,
    is.myBlockerBin,
    is.opponentDrawHistory.map(drawBin).join(","),
    is.bettingSequence.join("-") || ".",
    is.villainPosition,
    is.preflopScenario,
  ].join("|");
}

// ── Strategy storage ───────────────────────────────────────────────────────────

export interface StrategyNode {
  actions: BetAction[];
  regretSum: number[];   // cumulative counterfactual regrets (CFR+: clamped ≥ 0)
  strategySum: number[]; // cumulative strategy (used to compute average strategy)
}

// The full strategy table: infoset key → node
export type StrategyTable = Map<string, StrategyNode>;

// ── Draw strategy node ─────────────────────────────────────────────────────────
// Separate table for draw decisions (which cards to keep).
// Key: drawInfoSetKey; value: probability distribution over DrawCount 0-5.

export interface DrawStrategyNode {
  probabilities: number[]; // index = DrawCount (0..5)
  regretSum: number[];
  strategySum: number[];
}

export type DrawStrategyTable = Map<string, DrawStrategyNode>;

export function drawInfoSetKey(
  street: Street,
  position: Position,
  myBucket: number,
  myBlockerBin: BlockerBin,
  opponentDrawHistory: DrawCount[],
  bettingSeq: BetAction[],
  villainPosition: Position6Max,
  preflopScenario: string,
): string {
  return `draw|${street}|${position}|${myBucket}|${myBlockerBin}|${opponentDrawHistory.map(drawBin).join(",") || "."}|${bettingSeq.join("-") || "."}|${villainPosition}|${preflopScenario}`;
}

// ── Solver result ──────────────────────────────────────────────────────────────

export interface SolverResult {
  betStrategy: StrategyTable;
  drawStrategy: DrawStrategyTable;
  iterations: number;
  exploitability: number; // approximate, in small-bet units per hand
  durationMs: number;
}
