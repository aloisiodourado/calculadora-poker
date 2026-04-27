import { describe, it, expect } from "vitest";
import { parseCards } from "../cards/Card";
import { AceToFiveLowEvaluator } from "../evaluators/AceToFiveLowEvaluator";
import { DeuceSevenEvaluator } from "../evaluators/DeuceSevenEvaluator";

const a5 = new AceToFiveLowEvaluator();
const d7 = new DeuceSevenEvaluator();

describe("AceToFiveLowEvaluator", () => {
  it("Wheel (A-2-3-4-5) is the best low hand", () => {
    const wheel = a5.evaluate(parseCards("As 2d 3h 4c 5s"));
    const secondBest = a5.evaluate(parseCards("As 2d 3h 4c 6s"));
    expect(a5.compare(wheel, secondBest)).toBeGreaterThan(0);
  });

  it("A-2-3-4-6 beats A-2-3-5-6", () => {
    const better = a5.evaluate(parseCards("As 2d 3h 4c 6s"));
    const worse = a5.evaluate(parseCards("As 2d 3h 5c 6s"));
    expect(a5.compare(better, worse)).toBeGreaterThan(0);
  });

  it("7-high beats 8-high", () => {
    const sevenHigh = a5.evaluate(parseCards("As 2d 3h 4c 7s"));
    const eightHigh = a5.evaluate(parseCards("As 2d 3h 4c 8s"));
    expect(a5.compare(sevenHigh, eightHigh)).toBeGreaterThan(0);
  });

  it("Ace counts as 1 (low)", () => {
    // A-2-3-4-5 should be better than 2-3-4-5-6
    const wheel = a5.evaluate(parseCards("Ac 2d 3h 4c 5s"));
    const sixHigh = a5.evaluate(parseCards("2c 3d 4h 5c 6s"));
    expect(a5.compare(wheel, sixHigh)).toBeGreaterThan(0);
  });
});

describe("DeuceSevenEvaluator", () => {
  it("2-3-4-5-7 offsuit is the best 2-7 hand", () => {
    const best = d7.evaluate(parseCards("2c 3d 4h 5s 7c"));
    const secondBest = d7.evaluate(parseCards("2c 3d 4h 5s 8c"));
    expect(d7.compare(best, secondBest)).toBeGreaterThan(0);
  });

  it("flush counts against — offsuit beats flush", () => {
    const offsuit = d7.evaluate(parseCards("2c 3d 4h 5s 7c"));
    const flush = d7.evaluate(parseCards("2c 3c 4c 5c 7c"));
    expect(d7.compare(offsuit, flush)).toBeGreaterThan(0);
  });

  it("straight counts against — broken beats straight", () => {
    const broken = d7.evaluate(parseCards("2c 3d 4h 5s 8c"));
    const straight = d7.evaluate(parseCards("2c 3d 4h 5s 6c")); // A-6 straight
    expect(d7.compare(broken, straight)).toBeGreaterThan(0);
  });

  it("Ace is high in 2-7 (worst card)", () => {
    const noAce = d7.evaluate(parseCards("2c 3d 4h 5s Kc"));
    const withAce = d7.evaluate(parseCards("2c 3d 4h 5s Ac"));
    // Ace is higher than King, so noAce (K-high) is better
    expect(d7.compare(noAce, withAce)).toBeGreaterThan(0);
  });
});
