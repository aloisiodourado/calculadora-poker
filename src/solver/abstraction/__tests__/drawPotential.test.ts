/// <reference types="vitest/globals" />
import { Rank, Suit } from '@/engine/cards';
import { handToBucket, initBuckets } from '@/solver/abstraction/handBuckets';

beforeAll(() => initBuckets(50_000));

const c = (rank: Rank, suit: Suit) => ({ rank, suit });

it('KQ632 e TT632 ficam no mesmo bucket (mesmo potencial de draw: 6-3-2)', () => {
  const KQ632 = [c(Rank.King,Suit.Clubs), c(Rank.Queen,Suit.Diamonds), c(Rank.Six,Suit.Hearts), c(Rank.Three,Suit.Spades), c(Rank.Two,Suit.Clubs)];
  const TT632 = [c(Rank.Ten,Suit.Clubs), c(Rank.Ten,Suit.Diamonds), c(Rank.Six,Suit.Hearts), c(Rank.Three,Suit.Spades), c(Rank.Two,Suit.Clubs)];
  const b1 = handToBucket(KQ632);
  const b2 = handToBucket(TT632);
  console.log(`KQ632 bucket: ${b1+1}/20`);
  console.log(`TT632 bucket: ${b2+1}/20`);
  expect(b1).toBe(b2);
});
