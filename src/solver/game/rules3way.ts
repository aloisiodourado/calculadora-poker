import type { Street, BetAction } from "./types";
import type { Position3Way, BettingState3Way } from "./types3way";

export const FL_SMALL_BET_3W = 1;
export const FL_BIG_BET_3W = 2;
export const FL_CAP_3W = 4;

export function betSize3Way(street: Street): number {
  return street >= 2 ? FL_BIG_BET_3W : FL_SMALL_BET_3W;
}

// ── Action order ───────────────────────────────────────────────────────────────
// Street 0 (pre-draw): BTN(0) first, SB(1), BB(2) closes with option.
// Streets 1-3 (post-draw): SB(1) first, BB(2), BTN(0) last.

const ACTION_ORDER: readonly (readonly Position3Way[])[] = [
  [0, 1, 2], // street 0
  [1, 2, 0], // street 1
  [1, 2, 0], // street 2
  [1, 2, 0], // street 3
];

export function firstToAct3Way(street: Street): Position3Way {
  return ACTION_ORDER[street][0];
}

// Initial state for each street.
// Street 0: pot = 1.5 (SB posts 0.5, BB posts 1.0), BTN faces toCall = 1.0.
// Streets 1-3: pot = 0 (carry from previous street), no blinds outstanding.
export function initialBettingState3Way(street: Street): BettingState3Way {
  const order = [...ACTION_ORDER[street]] as Position3Way[];
  if (street === 0) {
    return {
      pot: 1.5,
      toCall: 1.0,
      betCount: 1, // BB's post counts as 1 bet
      folded: [false, false, false],
      needsToAct: order, // BTN, SB, BB (BB gets option after everyone calls)
    };
  }
  return {
    pot: 0,
    toCall: 0,
    betCount: 0,
    folded: [false, false, false],
    needsToAct: order,
  };
}

export function activePlayers3Way(folded: [boolean, boolean, boolean]): Position3Way[] {
  return ([0, 1, 2] as Position3Way[]).filter(p => !folded[p]);
}

export function activeCount3Way(folded: [boolean, boolean, boolean]): number {
  return folded.filter(f => !f).length;
}

export function validBetActions3Way(bet: BettingState3Way, street: Street): BetAction[] {
  const actions: BetAction[] = [];
  if (bet.toCall > 0) {
    actions.push("fold");
    actions.push("call");
  } else {
    actions.push("check");
  }
  if (bet.betCount < FL_CAP_3W) {
    actions.push(bet.toCall === 0 ? "bet" : "raise");
  }
  return actions;
}

// Apply an action by the given actor and return the new betting state.
// The folder's obligation is forfeited (pot doesn't increase on fold).
export function applyBetAction3Way(
  bet: BettingState3Way,
  actor: Position3Way,
  action: BetAction,
  street: Street,
): BettingState3Way {
  const size = betSize3Way(street);
  const newFolded: [boolean, boolean, boolean] = [bet.folded[0], bet.folded[1], bet.folded[2]];

  switch (action) {
    case "fold": {
      newFolded[actor] = true;
      return {
        ...bet,
        folded: newFolded,
        needsToAct: bet.needsToAct.filter(p => p !== actor) as Position3Way[],
      };
    }
    case "check": {
      return {
        ...bet,
        needsToAct: bet.needsToAct.filter(p => p !== actor) as Position3Way[],
      };
    }
    case "call": {
      return {
        ...bet,
        pot: bet.pot + bet.toCall,
        toCall: 0,
        needsToAct: bet.needsToAct.filter(p => p !== actor) as Position3Way[],
      };
    }
    case "bet":
    case "raise": {
      const additional = bet.toCall + size;
      // All other active non-folded players must now respond.
      const others = ([0, 1, 2] as Position3Way[]).filter(p => p !== actor && !newFolded[p]);
      return {
        pot: bet.pot + additional,
        toCall: size,
        betCount: bet.betCount + 1,
        folded: newFolded,
        needsToAct: others,
      };
    }
  }
}

// Betting round is complete when no players are pending AND no outstanding call,
// or when only 1 player remains (all others folded).
export function bettingDone3Way(bet: BettingState3Way): boolean {
  if (activeCount3Way(bet.folded) <= 1) return true;
  return bet.needsToAct.length === 0 && bet.toCall === 0;
}

// Next player to act (front of needsToAct queue), or null if none.
export function nextActor3Way(bet: BettingState3Way): Position3Way | null {
  return bet.needsToAct.length > 0 ? bet.needsToAct[0] : null;
}
