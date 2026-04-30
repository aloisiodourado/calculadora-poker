/// <reference types="vitest/globals" />
import { createTables, initSolver, runIterations, extractBetStrategy, extractDrawStrategy } from "../trainer";

// Use tiny samples so the test runs fast
beforeAll(() => {
  initSolver(5_000, 50); // small bucket sample + small transition sample
}, 30_000);

describe("CFR trainer smoke test", () => {
  it("runs iterations without throwing", async () => {
    const tables = createTables();
    await runIterations(tables, 200);
    expect(tables.iterations).toBe(200);
  });

  it("discovers betting infosets", async () => {
    const tables = createTables();
    await runIterations(tables, 500);
    expect(tables.bet.size).toBeGreaterThan(0);
  });

  it("discovers draw infosets", async () => {
    const tables = createTables();
    await runIterations(tables, 500);
    expect(tables.draw.size).toBeGreaterThan(0);
  });

  it("average strategy sums to 1 for each betting infoset", async () => {
    const tables = createTables();
    await runIterations(tables, 1_000);
    const strategy = extractBetStrategy(tables);
    for (const [, { probs }] of strategy) {
      const sum = probs.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it("average draw strategy sums to 1 for each draw infoset", async () => {
    const tables = createTables();
    await runIterations(tables, 1_000);
    const drawStrat = extractDrawStrategy(tables);
    for (const [, probs] of drawStrat) {
      const sum = probs.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
    }
  });
});
