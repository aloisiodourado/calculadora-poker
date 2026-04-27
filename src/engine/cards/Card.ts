import { Card, Rank, Suit } from "./types";

const RANK_SYMBOLS: Record<Rank, string> = {
  [Rank.Two]: "2",
  [Rank.Three]: "3",
  [Rank.Four]: "4",
  [Rank.Five]: "5",
  [Rank.Six]: "6",
  [Rank.Seven]: "7",
  [Rank.Eight]: "8",
  [Rank.Nine]: "9",
  [Rank.Ten]: "T",
  [Rank.Jack]: "J",
  [Rank.Queen]: "Q",
  [Rank.King]: "K",
  [Rank.Ace]: "A",
};

export function cardToString(card: Card): string {
  return `${RANK_SYMBOLS[card.rank]}${card.suit}`;
}

export function cardsEqual(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

export function parseCard(str: string): Card {
  const rankChar = str.slice(0, -1).toUpperCase();
  const suitChar = str.slice(-1).toLowerCase();

  const rankMap: Record<string, Rank> = {
    "2": Rank.Two, "3": Rank.Three, "4": Rank.Four, "5": Rank.Five,
    "6": Rank.Six, "7": Rank.Seven, "8": Rank.Eight, "9": Rank.Nine,
    "T": Rank.Ten, "J": Rank.Jack, "Q": Rank.Queen, "K": Rank.King,
    "A": Rank.Ace,
  };

  const suitMap: Record<string, Suit> = {
    c: Suit.Clubs, d: Suit.Diamonds, h: Suit.Hearts, s: Suit.Spades,
  };

  const rank = rankMap[rankChar];
  const suit = suitMap[suitChar];

  if (rank === undefined || suit === undefined) {
    throw new Error(`Invalid card string: "${str}"`);
  }

  return { rank, suit };
}

export function parseCards(str: string): Card[] {
  return str.trim().split(/\s+/).map(parseCard);
}
