import { describe, it, expect } from "vitest";
import { parseCards } from "../cards/Card";
import { MonteCarloSimulator } from "../simulator/MonteCarloSimulator";
import { PokerVariant } from "../variants/types";

const sim = new MonteCarloSimulator();

// Tolerance for Monte Carlo results — natural variance requires some slack
const TOL = 0.06;

describe("MonteCarloSimulator — Texas Hold'em", () => {
  it("AA vs KK preflop ≈ 80/20", async () => {
    const result = await sim.simulate({
      variant: PokerVariant.TexasHoldem,
      hands: [parseCards("Ah Ad"), parseCards("Kh Kd")],
      board: [],
      iterations: 10_000,
    });

    const [aa, kk] = result.results;
    expect(aa.equity).toBeCloseTo(0.8, 1);
    expect(kk.equity).toBeCloseTo(0.2, 1);
  }, 15_000);

  it("identical hands on full board = 50/50", async () => {
    const result = await sim.simulate({
      variant: PokerVariant.TexasHoldem,
      hands: [parseCards("Ah Kh"), parseCards("As Ks")],
      board: parseCards("2c 5d 9h"),
      iterations: 5_000,
    });

    const [a, b] = result.results;
    expect(Math.abs(a.equity - b.equity)).toBeLessThan(TOL);
  }, 10_000);

  it("flopped flush vs top pair — flush heavily favored", async () => {
    // Ah Kh on Qh Jh Th board — royal flush made
    const result = await sim.simulate({
      variant: PokerVariant.TexasHoldem,
      hands: [parseCards("Ah Kh"), parseCards("Qd Qs")],
      board: parseCards("Qh Jh Th"),
      iterations: 1_000,
    });

    const [flush, pair] = result.results;
    expect(flush.equity).toBeGreaterThan(0.9);
    expect(pair.equity).toBeLessThan(0.1);
  }, 5_000);
});

describe("MonteCarloSimulator — Razz", () => {
  it("A-2-3-4-5 strongly favored over K-high hand", async () => {
    const result = await sim.simulate({
      variant: PokerVariant.Razz,
      hands: [parseCards("Ac 2d 3h 4s 5c Jd Qh"), parseCards("Kd Qc 2c 3s 4c 5d 6h")],
      board: [],
      iterations: 5_000,
    });

    const [wheel] = result.results;
    expect(wheel.equity).toBeGreaterThan(0.9);
  }, 10_000);
});

describe("MonteCarloSimulator — Badugi", () => {
  it("complete Badugi favored over incomplete hand", async () => {
    const result = await sim.simulate({
      variant: PokerVariant.Badugi,
      hands: [parseCards("Ac 2d 3h 4s"), parseCards("2c 2h 3d 4s")],
      board: [],
      iterations: 1_000,
    });

    const [complete] = result.results;
    expect(complete.equity).toBeGreaterThan(0.6);
  }, 5_000);
});
