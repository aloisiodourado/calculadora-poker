import { Card, Rank, Suit } from "@/engine/cards";
import { HandCategory, CATEGORY_KEEP_COUNT } from "./representative-hands-27td";

export interface RangeEntry {
  category: HandCategory;
  rank1: number; // highest specified rank
  rank2: number; // second highest specified rank (ignored when keepCount < 2)
}

// Ranks available in the dropdowns (2-9, practical 2-7 TD range)
export const RANGE_RANK_OPTIONS: number[] = [9, 8, 7, 6, 5, 4, 3, 2];

export const DEFAULT_RANGE_ENTRY: RangeEntry = {
  category: "d1",
  rank1: Rank.Eight,
  rank2: Rank.Six,
};

function buildRangeHandRanks(keepCount: number, rank1: number, rank2: number): number[] {
  if (keepCount === 0) return [];
  if (keepCount === 1) return [rank1];

  const ranks: number[] = [rank1, rank2];

  // Fill remaining slots with smallest available ranks not already in hand
  for (let r = 2; ranks.length < keepCount; r++) {
    if (!ranks.includes(r)) ranks.push(r);
  }

  ranks.sort((a, b) => b - a);

  // Break a 5-card straight if one is formed (Pat only)
  if (ranks.length === 5) {
    const asc = [...ranks].sort((a, b) => a - b);
    if (asc[4] - asc[0] === 4 && new Set(asc).size === 5) {
      // Remove the middle fill card and replace with something above rank1
      const toRemove = asc[2];
      ranks.splice(ranks.indexOf(toRemove), 1);
      for (let r = rank1 + 1; r <= 14; r++) {
        if (!ranks.includes(r)) { ranks.push(r); break; }
      }
      ranks.sort((a, b) => b - a);
    }
  }

  return ranks;
}

/**
 * Builds the 5-slot hand state for a range entry.
 * Uses disjoint suit sets per player parity (even → ♣♦, odd → ♥♠).
 */
export function buildRangeHandState(entry: RangeEntry, playerIdx: number): {
  cards: (Card | null)[];
  explicitDiscards: boolean[];
} {
  const keepCount = CATEGORY_KEEP_COUNT[entry.category];
  const keptRanks = buildRangeHandRanks(keepCount, entry.rank1, entry.rank2);

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

/** Readable description of the hand a range entry produces. */
export function rangeEntryLabel(entry: RangeEntry): string {
  const keepCount = CATEGORY_KEEP_COUNT[entry.category];
  const ranks = buildRangeHandRanks(keepCount, entry.rank1, entry.rank2);
  const RANK_STR: Record<number, string> = {
    2:"2",3:"3",4:"4",5:"5",6:"6",7:"7",8:"8",9:"9",10:"T",11:"J",12:"Q",13:"K",14:"A",
  };
  return ranks.map(r => RANK_STR[r] ?? String(r)).join("");
}
