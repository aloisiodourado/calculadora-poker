import { Card } from "../cards";

export enum HandRank {
  HighCard = 1,
  OnePair = 2,
  TwoPair = 3,
  ThreeOfAKind = 4,
  Straight = 5,
  Flush = 6,
  FullHouse = 7,
  FourOfAKind = 8,
  StraightFlush = 9,
}

// Opaque numeric score: higher = stronger hand.
// Encodes HandRank + tiebreaker kickers into a single comparable number.
export type HandScore = number;

export interface HandEvaluation {
  score: HandScore;
  rank: HandRank;
  label: string;
  bestHand: Card[]; // the 5 cards that form the hand
}

export interface HandEvaluator {
  evaluate(cards: Card[]): HandEvaluation;
  // Returns positive if a > b, negative if a < b, 0 if tie
  compare(a: HandEvaluation, b: HandEvaluation): number;
}
