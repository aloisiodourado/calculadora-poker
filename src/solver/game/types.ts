import { Card } from "@/engine/cards";

// ── Streets ────────────────────────────────────────────────────────────────────
// 0 = pre-draw betting, 1 = post-draw-1, 2 = post-draw-2, 3 = post-draw-3

export type Street = 0 | 1 | 2 | 3;

// ── Positions ──────────────────────────────────────────────────────────────────
// Heads-up FL convention: position 0 = Button/SB (acts first pre-draw, second post-draw)
//                         position 1 = BB       (acts second pre-draw, first post-draw)

export type Position = 0 | 1;

// ── Actions ────────────────────────────────────────────────────────────────────

export type BetAction = "fold" | "check" | "call" | "bet" | "raise";

// Number of cards discarded (0 = stand pat)
export type DrawCount = 0 | 1 | 2 | 3 | 4 | 5;

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

  // Opponent draw counts in each prior draw round (public info)
  opponentDrawHistory: DrawCount[];

  // Sequence of bet actions in the current street up to this point
  bettingSequence: BetAction[];
}

// Canonical string key for a Map lookup
export function infoSetKey(is: InfoSet): string {
  return [
    is.street,
    is.position,
    is.myBucket,
    is.opponentDrawHistory.join(","),
    is.bettingSequence.join("-") || ".",
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

export function drawInfoSetKey(street: Street, position: Position, myBucket: number): string {
  return `draw|${street}|${position}|${myBucket}`;
}

// ── Solver result ──────────────────────────────────────────────────────────────

export interface SolverResult {
  betStrategy: StrategyTable;
  drawStrategy: DrawStrategyTable;
  iterations: number;
  exploitability: number; // approximate, in small-bet units per hand
  durationMs: number;
}
