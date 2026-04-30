import {
  BetAction,
  DrawStrategyNode,
  StrategyNode,
  StrategyTable,
  DrawStrategyTable,
} from "../game/types";

// ── Regret matching ────────────────────────────────────────────────────────────

// Current strategy from positive regrets (CFR+: negatives are clamped to 0).
export function currentStrategy(node: StrategyNode): number[] {
  const pos = node.regretSum.map((r) => Math.max(0, r));
  const sum = pos.reduce((a, b) => a + b, 0);
  if (sum > 0) return pos.map((r) => r / sum);
  return node.actions.map(() => 1 / node.actions.length); // uniform fallback
}

// Current draw strategy (6 options: draw 0–5 cards).
export function currentDrawStrategy(node: DrawStrategyNode): number[] {
  const pos = node.regretSum.map((r) => Math.max(0, r));
  const sum = pos.reduce((a, b) => a + b, 0);
  if (sum > 0) return pos.map((r) => r / sum);
  return new Array(6).fill(1 / 6);
}

// Average strategy — converges to Nash equilibrium.
export function averageStrategy(node: StrategyNode): number[] {
  const sum = node.strategySum.reduce((a, b) => a + b, 0);
  if (sum > 0) return node.strategySum.map((s) => s / sum);
  return node.actions.map(() => 1 / node.actions.length);
}

export function averageDrawStrategy(node: DrawStrategyNode): number[] {
  const sum = node.strategySum.reduce((a, b) => a + b, 0);
  if (sum > 0) return node.strategySum.map((s) => s / sum);
  return new Array(6).fill(1 / 6);
}

// ── Node accessors ─────────────────────────────────────────────────────────────

export function getOrCreateBetNode(
  table: StrategyTable,
  key: string,
  actions: BetAction[],
): StrategyNode {
  let node = table.get(key);
  if (!node) {
    node = {
      actions,
      regretSum: new Array(actions.length).fill(0),
      strategySum: new Array(actions.length).fill(0),
    };
    table.set(key, node);
  }
  return node;
}

export function getOrCreateDrawNode(
  table: DrawStrategyTable,
  key: string,
): DrawStrategyNode {
  let node = table.get(key);
  if (!node) {
    node = {
      probabilities: new Array(6).fill(1 / 6),
      regretSum: new Array(6).fill(0),
      strategySum: new Array(6).fill(0),
    };
    table.set(key, node);
  }
  return node;
}

// ── Sampling ───────────────────────────────────────────────────────────────────

// Sample one action index from a probability distribution.
export function sampleIdx(dist: number[]): number {
  const r = Math.random();
  let cum = 0;
  for (let i = 0; i < dist.length; i++) {
    cum += dist[i];
    if (r <= cum) return i;
  }
  return dist.length - 1;
}
