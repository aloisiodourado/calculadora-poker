import { Card, Rank, Suit } from "@/engine/cards";

export type HandCategory = "pat" | "d1" | "d2" | "d3" | "d4" | "d5";

export const HAND_CATEGORIES: HandCategory[] = ["pat", "d1", "d2", "d3", "d4", "d5"];

export const CATEGORY_LABELS: Record<HandCategory, string> = {
  pat: "Pat",
  d1: "Discard 1",
  d2: "Discard 2",
  d3: "Discard 3",
  d4: "Discard 4",
  d5: "Discard 5",
};

export const CATEGORY_SHORT: Record<HandCategory, string> = {
  pat: "Pat",
  d1: "D1",
  d2: "D2",
  d3: "D3",
  d4: "D4",
  d5: "D5",
};

interface RepHand {
  cards: Card[];
  explicitDiscardCount: number;
}

// Template A (even player index 0,2,4): uses ♣ and ♦ only — no overlap with Template B
// Template B (odd player index 1,3,5): uses ♥ and ♠ only — no overlap with Template A
// Within each template, all 15 cards (5+4+3+2+1) are unique (distinct rank+suit pairs).

const TEMPLATE_A: Record<HandCategory, RepHand> = {
  pat: {
    cards: [
      { rank: Rank.Eight, suit: Suit.Clubs },
      { rank: Rank.Seven, suit: Suit.Diamonds },
      { rank: Rank.Five, suit: Suit.Diamonds },
      { rank: Rank.Four, suit: Suit.Clubs },
      { rank: Rank.Two, suit: Suit.Clubs },
    ],
    explicitDiscardCount: 0,
  },
  d1: {
    cards: [
      { rank: Rank.Six, suit: Suit.Clubs },
      { rank: Rank.Five, suit: Suit.Clubs },
      { rank: Rank.Three, suit: Suit.Diamonds },
      { rank: Rank.Two, suit: Suit.Diamonds },
    ],
    explicitDiscardCount: 1,
  },
  d2: {
    cards: [
      { rank: Rank.Seven, suit: Suit.Clubs },
      { rank: Rank.Six, suit: Suit.Diamonds },
      { rank: Rank.Three, suit: Suit.Clubs },
    ],
    explicitDiscardCount: 2,
  },
  d3: {
    cards: [
      { rank: Rank.Eight, suit: Suit.Diamonds },
      { rank: Rank.Four, suit: Suit.Diamonds },
    ],
    explicitDiscardCount: 3,
  },
  d4: {
    cards: [{ rank: Rank.Nine, suit: Suit.Clubs }],
    explicitDiscardCount: 4,
  },
  d5: {
    cards: [],
    explicitDiscardCount: 5,
  },
};

const TEMPLATE_B: Record<HandCategory, RepHand> = {
  pat: {
    cards: [
      { rank: Rank.Eight, suit: Suit.Hearts },
      { rank: Rank.Seven, suit: Suit.Spades },
      { rank: Rank.Five, suit: Suit.Spades },
      { rank: Rank.Four, suit: Suit.Hearts },
      { rank: Rank.Two, suit: Suit.Hearts },
    ],
    explicitDiscardCount: 0,
  },
  d1: {
    cards: [
      { rank: Rank.Six, suit: Suit.Hearts },
      { rank: Rank.Five, suit: Suit.Hearts },
      { rank: Rank.Three, suit: Suit.Spades },
      { rank: Rank.Two, suit: Suit.Spades },
    ],
    explicitDiscardCount: 1,
  },
  d2: {
    cards: [
      { rank: Rank.Seven, suit: Suit.Hearts },
      { rank: Rank.Six, suit: Suit.Spades },
      { rank: Rank.Three, suit: Suit.Hearts },
    ],
    explicitDiscardCount: 2,
  },
  d3: {
    cards: [
      { rank: Rank.Eight, suit: Suit.Spades },
      { rank: Rank.Four, suit: Suit.Spades },
    ],
    explicitDiscardCount: 3,
  },
  d4: {
    cards: [{ rank: Rank.Nine, suit: Suit.Hearts }],
    explicitDiscardCount: 4,
  },
  d5: {
    cards: [],
    explicitDiscardCount: 5,
  },
};

export function getRepresentativeHand(playerIdx: number, category: HandCategory): RepHand {
  return playerIdx % 2 === 0 ? TEMPLATE_A[category] : TEMPLATE_B[category];
}

/** Builds the 5-slot cards array and explicitDiscards array for simulation. */
export function buildRepHandState(playerIdx: number, category: HandCategory): {
  cards: (Card | null)[];
  explicitDiscards: boolean[];
} {
  const rep = getRepresentativeHand(playerIdx, category);
  const SLOTS = 5;
  const cards: (Card | null)[] = Array(SLOTS).fill(null);
  const explicitDiscards: boolean[] = Array(SLOTS).fill(false);

  rep.cards.forEach((c, i) => { cards[i] = c; });
  for (let i = rep.cards.length; i < rep.cards.length + rep.explicitDiscardCount; i++) {
    explicitDiscards[i] = true;
  }

  return { cards, explicitDiscards };
}

export const CATEGORY_KEEP_COUNT: Record<HandCategory, number> = {
  pat: 5, d1: 4, d2: 3, d3: 2, d4: 1, d5: 0,
};

// Approximate probability of each category in a random starting hand
// based on binomial distribution: P(k cards ≤8) with 28 "good" cards out of 52
// pat≈4%, d1≈19%, d2≈35%, d3≈29%, d4≈11%, d5≈2%
export const CATEGORY_RANGE_PCT: Record<HandCategory, number> = {
  pat: 4,
  d1: 19,
  d2: 35,
  d3: 29,
  d4: 11,
  d5: 2,
};

function generateKeptRanks(keepCount: number, keepThreshold: number): number[] {
  if (keepCount === 0) return [];

  // Cap the "high anchor" at 8 (user preference: show 7 or 8, never 9/10 as anchor)
  const highAnchor = Math.min(8, keepThreshold);

  // Priority: 2, 3, highAnchor, 7 (if anchor is 8), then 5, 6, 4 as fillers
  const rawPriority = [2, 3, highAnchor, ...(highAnchor >= 8 ? [7] : []), 5, 6, 4];

  const seen = new Set<number>();
  const priority: number[] = [];
  for (const r of rawPriority) {
    if (r >= 2 && r <= keepThreshold && !seen.has(r)) {
      seen.add(r);
      priority.push(r);
    }
  }
  // Safety fill for very low thresholds (edge case)
  for (let r = 2; r <= keepThreshold; r++) {
    if (!seen.has(r)) { seen.add(r); priority.push(r); }
  }

  const selected = priority.slice(0, keepCount).sort((a, b) => b - a);

  // For 5-card Pat hands: break a straight if one was formed
  if (selected.length === 5) {
    const asc = [...selected].sort((a, b) => a - b);
    if (asc[4] - asc[0] === 4 && new Set(asc).size === 5) {
      const toRemove = asc[3]; // remove second-highest to break the straight
      selected.splice(selected.indexOf(toRemove), 1);
      const usedSet = new Set(selected);
      for (let r = 2; r <= keepThreshold; r++) {
        if (!usedSet.has(r)) { selected.push(r); break; }
      }
      selected.sort((a, b) => b - a);
    }
  }

  return selected;
}

/**
 * Builds a strategy-aware representative hand where all kept cards respect
 * the draw strategy's keepThreshold. Disjoint suit sets per player parity
 * (even → ♣♦, odd → ♥♠) prevent inter-player card conflicts.
 */
export function buildStrategyAwareRepHand(
  playerIdx: number,
  category: HandCategory,
  keepThreshold: number,
): { cards: (Card | null)[]; explicitDiscards: boolean[] } {
  const keepCount = CATEGORY_KEEP_COUNT[category];
  const keptRanks = generateKeptRanks(keepCount, keepThreshold);

  const isTemplateA = playerIdx % 2 === 0;
  const suitA = isTemplateA ? Suit.Clubs : Suit.Hearts;
  const suitB = isTemplateA ? Suit.Diamonds : Suit.Spades;

  const keptCards: Card[] = keptRanks.map((rank, i) => ({
    rank,
    suit: i % 2 === 0 ? suitA : suitB,
  }));

  const SLOTS = 5;
  const cards: (Card | null)[] = Array(SLOTS).fill(null);
  const explicitDiscards: boolean[] = Array(SLOTS).fill(false);

  keptCards.forEach((c, i) => { cards[i] = c; });
  for (let i = keepCount; i < SLOTS; i++) {
    explicitDiscards[i] = true;
  }

  return { cards, explicitDiscards };
}
