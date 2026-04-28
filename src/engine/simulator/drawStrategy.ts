import { Card, Rank, Suit } from "../cards";

export interface DrawRoundStrategy {
  keepThreshold: Rank; // keep cards with rank ≤ this value
}

// Default thresholds for each of the 3 draw positions (0-indexed)
export const DEFAULT_DRAW_THRESHOLDS: [Rank, Rank, Rank] = [
  Rank.Eight, // 1st draw
  Rank.Nine,  // 2nd draw
  Rank.Ten,   // 3rd/last draw
];

function rankVal(rank: Rank): number {
  return rank as number;
}

function isStraight27(cards: Card[]): boolean {
  if (cards.length !== 5) return false;
  const ranks = [...new Set(cards.map((c) => rankVal(c.rank)))].sort((a, b) => a - b);
  if (ranks.length !== 5) return false;
  if (ranks[4] - ranks[0] === 4) return true;
  // Wheel: A-2-3-4-5 (values 2,3,4,5,14)
  return ranks[0] === 2 && ranks[1] === 3 && ranks[2] === 4 && ranks[3] === 5 && ranks[4] === 14;
}

function isA2345(cards: Card[]): boolean {
  const ranks = cards.map((c) => rankVal(c.rank)).sort((a, b) => a - b);
  return (
    ranks[0] === 2 && ranks[1] === 3 && ranks[2] === 4 && ranks[3] === 5 && ranks[4] === 14
  );
}

/**
 * Count how many extra cards share a suit with another card in the set.
 * E.g. [♠, ♠, ♥] → 1 conflict (one extra ♠).
 */
function suitConflicts(cards: Card[]): number {
  const counts = new Map<Suit, number>();
  for (const c of cards) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
  let total = 0;
  for (const n of counts.values()) if (n > 1) total += n - 1;
  return total;
}

/**
 * From the given candidates (already filtered by rank threshold), keep exactly
 * one card per rank and choose which duplicate to discard so that the kept set
 * has as few same-suit pairs as possible (offsuit preference).
 *
 * Tries all combinations when multiple pairs are present (max 5 cards, so the
 * search space is tiny).
 */
function chooseBestCards(candidates: Card[]): Card[] {
  // Group by rank
  const byRank = new Map<Rank, Card[]>();
  for (const card of candidates) {
    if (!byRank.has(card.rank)) byRank.set(card.rank, []);
    byRank.get(card.rank)!.push(card);
  }

  const singletons: Card[] = [];
  const pairGroups: Card[][] = [];

  for (const cards of byRank.values()) {
    if (cards.length === 1) singletons.push(cards[0]);
    else pairGroups.push(cards);
  }

  // No pairs to resolve — return singletons as-is
  if (pairGroups.length === 0) return singletons;

  // Enumerate all ways to pick one card from each pair group.
  // Pick the combination that minimises suit conflicts with the singletons.
  let bestConflicts = Infinity;
  let bestKeep: Card[] = [];

  function tryAll(idx: number, current: Card[]) {
    if (idx === pairGroups.length) {
      const kept = [...singletons, ...current];
      const conflicts = suitConflicts(kept);
      if (conflicts < bestConflicts) {
        bestConflicts = conflicts;
        bestKeep = kept;
      }
      return;
    }
    for (const card of pairGroups[idx]) {
      tryAll(idx + 1, [...current, card]);
    }
  }

  tryAll(0, []);
  return bestKeep;
}

/**
 * Decide which cards to keep and discard for one draw round.
 *
 * Rules (applied in order):
 *   1. Discard all cards above keepThreshold.
 *   2. From the remaining candidates, keep exactly one card per rank.
 *      When choosing between duplicates, prefer the card that leaves
 *      the hand most offsuit (fewest same-suit pairs).
 *   3. If the resulting 5 kept cards form a straight, break it:
 *      - A-2-3-4-5 → discard the Ace
 *      - Any other straight → discard the second-highest card
 */
export function applyDrawStrategy(
  hand: Card[],
  strategy: DrawRoundStrategy
): { keep: Card[]; discard: Card[] } {
  const threshold = rankVal(strategy.keepThreshold);

  const candidates = hand.filter((c) => rankVal(c.rank) <= threshold);
  const aboveThreshold = hand.filter((c) => rankVal(c.rank) > threshold);

  // Choose which card to keep from each rank group, minimising suit conflicts
  let keep = chooseBestCards(candidates);
  const discardFromCandidates = candidates.filter(
    (c) => !keep.some((k) => k.rank === c.rank && k.suit === c.suit)
  );
  let discard = [...aboveThreshold, ...discardFromCandidates];

  // Break a 5-card straight among the kept cards
  if (keep.length === 5 && isStraight27(keep)) {
    const descending = [...keep].sort((a, b) => rankVal(b.rank) - rankVal(a.rank));
    // A2345: discard Ace; any other straight: discard second-highest
    const toRemove = isA2345(keep) ? descending[0] : descending[1];
    keep = keep.filter((c) => !(c.rank === toRemove.rank && c.suit === toRemove.suit));
    discard = [...discard, toRemove];
  }

  // Break a 5-card flush: discard the highest card
  if (keep.length === 5) {
    const firstSuit = keep[0].suit;
    if (keep.every((c) => c.suit === firstSuit)) {
      const highest = keep.reduce((a, b) => (rankVal(a.rank) > rankVal(b.rank) ? a : b));
      keep = keep.filter((c) => !(c.rank === highest.rank && c.suit === highest.suit));
      discard = [...discard, highest];
    }
  }

  return { keep, discard };
}
