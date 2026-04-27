export enum Rank {
  Two = 2,
  Three = 3,
  Four = 4,
  Five = 5,
  Six = 6,
  Seven = 7,
  Eight = 8,
  Nine = 9,
  Ten = 10,
  Jack = 11,
  Queen = 12,
  King = 13,
  Ace = 14,
}

export enum Suit {
  Clubs = "c",
  Diamonds = "d",
  Hearts = "h",
  Spades = "s",
}

export interface Card {
  rank: Rank;
  suit: Suit;
}

export const RANKS = Object.values(Rank).filter(
  (v) => typeof v === "number"
) as Rank[];

export const SUITS = Object.values(Suit) as Suit[];
