import { describe, it, expect } from "vitest";
import { parseCards } from "../cards/Card";
import { HighHandEvaluator } from "../evaluators/HighHandEvaluator";
import { HandRank } from "../evaluators/types";

const eval_ = new HighHandEvaluator();
const ev = (str: string) => eval_.evaluate(parseCards(str));

describe("HighHandEvaluator — hand rankings", () => {
  it("detects Royal Flush", () => {
    const h = ev("As Ks Qs Js Ts");
    expect(h.rank).toBe(HandRank.StraightFlush);
    expect(h.label).toBe("Royal Flush");
  });

  it("detects Straight Flush", () => {
    const h = ev("9h 8h 7h 6h 5h");
    expect(h.rank).toBe(HandRank.StraightFlush);
    expect(h.label).toBe("Straight Flush");
  });

  it("detects Four of a Kind", () => {
    const h = ev("Ah Ad Ac As Kd");
    expect(h.rank).toBe(HandRank.FourOfAKind);
  });

  it("detects Full House", () => {
    const h = ev("Ah Ad Ac Kd Ks");
    expect(h.rank).toBe(HandRank.FullHouse);
  });

  it("detects Flush", () => {
    const h = ev("2h 5h 9h Jh Kh");
    expect(h.rank).toBe(HandRank.Flush);
  });

  it("detects Straight", () => {
    const h = ev("9c 8d 7h 6s 5c");
    expect(h.rank).toBe(HandRank.Straight);
  });

  it("detects wheel straight (A-2-3-4-5)", () => {
    const h = ev("As 2d 3h 4c 5s");
    expect(h.rank).toBe(HandRank.Straight);
  });

  it("detects Three of a Kind", () => {
    const h = ev("Ah Ad Ac 2d 5s");
    expect(h.rank).toBe(HandRank.ThreeOfAKind);
  });

  it("detects Two Pair", () => {
    const h = ev("Ah Ad Kc Kd 5s");
    expect(h.rank).toBe(HandRank.TwoPair);
  });

  it("detects One Pair", () => {
    const h = ev("Ah Ad 3c 7d Ts");
    expect(h.rank).toBe(HandRank.OnePair);
  });

  it("detects High Card", () => {
    const h = ev("2c 5d 7h Jc As");
    expect(h.rank).toBe(HandRank.HighCard);
  });
});

describe("HighHandEvaluator — comparisons", () => {
  it("higher rank always beats lower rank", () => {
    const sf = ev("9h 8h 7h 6h 5h");
    const foak = ev("Ah Ad Ac As Kd");
    expect(eval_.compare(sf, foak)).toBeGreaterThan(0);
    expect(eval_.compare(foak, sf)).toBeLessThan(0);
  });

  it("same rank compared by kicker — higher pair wins", () => {
    const aces = ev("Ah Ad 2c 3d 4s");
    const kings = ev("Kh Kd 2c 3d 4s");
    expect(eval_.compare(aces, kings)).toBeGreaterThan(0);
  });

  it("identical hands are a tie", () => {
    const a = ev("Ah Kh Qh Jh Th");
    const b = ev("As Ks Qs Js Ts");
    expect(eval_.compare(a, b)).toBe(0);
  });

  it("picks best 5 from 7-card hand (Hold'em style)", () => {
    // Board + hole cards that form a flush
    const h = ev("2h 5h 9h Jh Kh 2c 3s");
    expect(h.rank).toBe(HandRank.Flush);
  });

  it("Straight Flush beats Four of a Kind", () => {
    const sf = ev("6c 7c 8c 9c Tc");
    const foak = ev("As Ad Ah Ac Kd");
    expect(eval_.compare(sf, foak)).toBeGreaterThan(0);
  });
});
