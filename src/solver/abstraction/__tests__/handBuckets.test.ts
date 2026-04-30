import { Rank, Suit } from "@/engine/cards";
import { handToBucket, initBuckets, NUM_BUCKETS } from "../handBuckets";

// Seed the distribution once for all tests in this file
beforeAll(() => {
  initBuckets(20_000); // smaller sample for test speed
});

const card = (rank: Rank, suit: Suit) => ({ rank, suit });

// Known hand rankings in 2-7 lowball (best to worst):
// 7-5-4-3-2 offsuit > 7-6-4-3-2 > ... > any pair > two pair > straight/flush

const BEST_HAND = [
  card(Rank.Seven, Suit.Clubs),
  card(Rank.Five, Suit.Diamonds),
  card(Rank.Four, Suit.Hearts),
  card(Rank.Three, Suit.Spades),
  card(Rank.Two, Suit.Clubs),
];

const GOOD_HAND = [
  card(Rank.Eight, Suit.Clubs),
  card(Rank.Seven, Suit.Diamonds),
  card(Rank.Five, Suit.Hearts),
  card(Rank.Three, Suit.Spades),
  card(Rank.Two, Suit.Clubs),
];

const PAIR_HAND = [
  card(Rank.Two, Suit.Clubs),
  card(Rank.Two, Suit.Diamonds),
  card(Rank.Five, Suit.Hearts),
  card(Rank.Six, Suit.Spades),
  card(Rank.Seven, Suit.Clubs),
];

const WORST_HAND = [
  card(Rank.Ace, Suit.Clubs),
  card(Rank.Ace, Suit.Diamonds),
  card(Rank.King, Suit.Hearts),
  card(Rank.King, Suit.Spades),
  card(Rank.Queen, Suit.Clubs),
];

describe("handToBucket", () => {
  it("returns a bucket in [0, NUM_BUCKETS-1]", () => {
    const b = handToBucket(BEST_HAND);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(NUM_BUCKETS);
  });

  it("best 2-7 hand (7-5-4-3-2) gets a stronger bucket than a pair", () => {
    const bestBucket = handToBucket(BEST_HAND);
    const pairBucket = handToBucket(PAIR_HAND);
    expect(bestBucket).toBeLessThan(pairBucket);
  });

  it("good hand beats a pair hand", () => {
    const goodBucket = handToBucket(GOOD_HAND);
    const pairBucket = handToBucket(PAIR_HAND);
    expect(goodBucket).toBeLessThan(pairBucket);
  });

  it("pair hand beats worst hand (AA-KK-Q)", () => {
    const pairBucket = handToBucket(PAIR_HAND);
    const worstBucket = handToBucket(WORST_HAND);
    expect(pairBucket).toBeLessThan(worstBucket);
  });

  it("best hand is in the top quarter of buckets", () => {
    const b = handToBucket(BEST_HAND);
    expect(b).toBeLessThan(NUM_BUCKETS / 4);
  });

  it("worst hand is in the bottom quarter of buckets", () => {
    const b = handToBucket(WORST_HAND);
    expect(b).toBeGreaterThanOrEqual((NUM_BUCKETS * 3) / 4);
  });
});
