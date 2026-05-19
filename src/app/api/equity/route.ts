import { NextRequest, NextResponse } from "next/server";
import { MonteCarloSimulator } from "@/engine/simulator/MonteCarloSimulator";
import { SimulationInput } from "@/engine/simulator/types";

const simulator = new MonteCarloSimulator();

export async function POST(req: NextRequest) {
  let body: SimulationInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { variant, hands, board, iterations, drawRoundsLeft, playerDrawStrategies, playerExplicitDiscards, deadCards, playerRangePatterns } = body;

  if (!variant || !hands || !Array.isArray(hands) || hands.length < 2) {
    return NextResponse.json({ error: "Need variant and at least 2 hands" }, { status: 400 });
  }

  const clampedIterations = Math.min(Math.max(iterations ?? 10_000, 1_000), 100_000);

  try {
    const result = await simulator.simulate({
      variant,
      hands,
      board: board ?? [],
      iterations: clampedIterations,
      drawRoundsLeft,
      playerDrawStrategies,
      playerExplicitDiscards,
      deadCards: deadCards ?? [],
      playerRangePatterns: playerRangePatterns ?? [],
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Simulation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
