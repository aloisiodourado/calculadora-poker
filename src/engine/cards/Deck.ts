import { Card, RANKS, SUITS } from "./types";
import { cardsEqual } from "./Card";

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

// Fisher-Yates shuffle — mutates in place
export function shuffle(deck: Card[]): void {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

export function removeCards(deck: Card[], toRemove: Card[]): Card[] {
  return deck.filter(
    (card) => !toRemove.some((removed) => cardsEqual(card, removed))
  );
}

export function dealN(deck: Card[], n: number): [Card[], Card[]] {
  return [deck.slice(0, n), deck.slice(n)];
}
