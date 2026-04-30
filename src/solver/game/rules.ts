import { BetAction, BettingState, DrawCount, GameState, Position, Street } from "./types";

export type { BettingState };

// ── Fixed-Limit bet sizing ─────────────────────────────────────────────────────
// Small bet on streets 0 and 1; big bet on streets 2 and 3.
// All amounts in "small bet" units (big bet = 2).

export const FL_SMALL_BET = 1;
export const FL_BIG_BET = 2;
export const FL_CAP = 4; // maximum bets+raises per street

// Heads-up blind structure (in small bet units)
export const SMALL_BLIND = 0.5;
export const BIG_BLIND = 1;

export function betSize(street: Street): number {
  return street >= 2 ? FL_BIG_BET : FL_SMALL_BET;
}

// ── Action validation ──────────────────────────────────────────────────────────

export function validBetActions(betting: BettingState, street: Street): BetAction[] {
  const { toCall, betCount } = betting;
  const actions: BetAction[] = [];

  if (toCall > 0) {
    actions.push("fold");
    actions.push("call");
  } else {
    actions.push("check");
  }

  if (betCount < FL_CAP) {
    actions.push(toCall === 0 ? "bet" : "raise");
  }

  return actions;
}

// ── Betting state transitions ──────────────────────────────────────────────────

export function applyBetAction(
  betting: BettingState,
  action: BetAction,
  street: Street,
): BettingState {
  const size = betSize(street);

  switch (action) {
    case "fold":
      // Terminal — caller handles payoff; return unchanged state
      return betting;

    case "check":
      return { ...betting };

    case "call":
      return {
        pot: betting.pot + betting.toCall,
        toCall: 0,
        betCount: betting.betCount,
      };

    case "bet":
    case "raise": {
      const additional = betting.toCall + size; // raise = call facing amount + bet size
      return {
        pot: betting.pot + additional,
        toCall: size, // opponent now needs to call this bet size
        betCount: betting.betCount + 1,
      };
    }
  }
}

// ── Street transitions ─────────────────────────────────────────────────────────

// Returns the initial betting state for a new street.
// post-draw streets: BB (position 1) acts first.
// pre-draw: SB posts 0.5, BB posts 1, SB is first to act (can call or raise).
export function initialBettingState(street: Street): BettingState {
  if (street === 0) {
    // Blinds already in: pot = 1.5 units, SB must call 0.5 more or raise
    return { pot: SMALL_BLIND + BIG_BLIND, toCall: BIG_BLIND - SMALL_BLIND, betCount: 1 };
  }
  // Post-draw streets: no blinds, first to act can check or bet
  return { pot: 0, toCall: 0, betCount: 0 };
}

// Who acts first on each street in heads-up FL
// Pre-draw (street 0): SB/Button = position 0 acts first
// Post-draw (streets 1-3): BB = position 1 acts first
export function firstToAct(street: Street): Position {
  return street === 0 ? 0 : 1;
}

// ── Draw round detection ───────────────────────────────────────────────────────

// Returns true if betting for this street is complete
// (both players have acted and no outstanding call)
export function isBettingComplete(
  betting: BettingState,
  actionsThisStreet: BetAction[],
  street: Street,
): boolean {
  if (betting.toCall > 0) return false;

  // Pre-draw: SB acts first. After BB checks or calls, street is done.
  // Post-draw: BB acts first. After both act and no pending call, street is done.
  // Simple rule: at least 2 actions taken and no outstanding bet.
  const minActions = street === 0 ? 2 : 2;
  return actionsThisStreet.length >= minActions;
}

// Valid draw counts: 0 (stand pat) through 5 (discard all)
export const ALL_DRAW_COUNTS: DrawCount[] = [0, 1, 2, 3, 4, 5];

// ── Pot calculation helpers ────────────────────────────────────────────────────

// Running pot carried into the next street after betting completes
// (pot already accumulated; winner takes it at showdown)
export function potAfterStreet(betting: BettingState): number {
  return betting.pot;
}
