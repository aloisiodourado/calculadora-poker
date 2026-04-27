import { describe, it, expect } from "vitest";
import { parseCards } from "../cards/Card";
import { BadugiEvaluator } from "../evaluators/BadugiEvaluator";

const eval_ = new BadugiEvaluator();
const ev = (str: string) => eval_.evaluate(parseCards(str));

describe("BadugiEvaluator", () => {
  it("4-card Badugi beats 3-card", () => {
    const badugi4 = ev("2c 3d 4h 5s");
    const badugi3 = ev("Ac 2d 3h As"); // As duplicates rank
    expect(eval_.compare(badugi4, badugi3)).toBeGreaterThan(0);
  });

  it("A-2-3-4 rainbow is the best Badugi", () => {
    const best = ev("Ac 2d 3h 4s");
    const secondBest = ev("Ac 2d 3h 5s");
    expect(eval_.compare(best, secondBest)).toBeGreaterThan(0);
  });

  it("same-suit cards are excluded from the hand", () => {
    // 2c and 3c — only one can count; best effective hand is 2c 3d 4h (3-card)
    const h = ev("2c 3c 4h 5d");
    expect(h.bestHand.length).toBe(3);
  });

  it("paired ranks are excluded", () => {
    // 2c and 2d — only one can count
    const h = ev("2c 2d 3h 4s");
    expect(h.bestHand.length).toBe(3);
  });

  it("Ace is low in Badugi", () => {
    const withAce = ev("Ac 2d 3h 4s");
    const withFive = ev("5c 2d 3h 4s"); // 2-3-4-5 vs A-2-3-4
    // A-2-3-4 is better (ace = 1)
    expect(eval_.compare(withAce, withFive)).toBeGreaterThan(0);
  });
});
