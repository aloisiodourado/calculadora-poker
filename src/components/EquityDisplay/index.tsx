"use client";

import { SimulationResult } from "@/engine/simulator/types";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { PLAYER_COLORS } from "@/components/HandInput";

interface EquityDisplayProps {
  result: SimulationResult;
  isHiLo: boolean;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function EquityDisplay({ result, isHiLo }: EquityDisplayProps) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Equity Results</h2>
        <span className="text-xs text-muted-foreground">
          {result.iterationsRun.toLocaleString()} iterations · {result.durationMs}ms
        </span>
      </div>

      {result.results.map((r, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${PLAYER_COLORS[i % PLAYER_COLORS.length]}`} />
              <span className="font-medium">Player {i + 1}</span>
            </div>
            <span className="font-bold text-base">{pct(r.equity)}</span>
          </div>

          <Progress value={r.equity * 100} className="h-2" />

          <div className="flex gap-2 text-xs text-muted-foreground flex-wrap">
            {isHiLo ? (
              <>
                <Badge variant="secondary">Hi: {pct(r.hiWins / result.iterationsRun)}</Badge>
                <Badge variant="secondary">Lo: {pct(r.loWins / result.iterationsRun)}</Badge>
                <Badge variant="outline">Lo qualified: {pct(r.loQualified / result.iterationsRun)}</Badge>
              </>
            ) : (
              <>
                <span>Win: {pct(r.wins / result.iterationsRun)}</span>
                <span>·</span>
                <span>Loss: {pct(r.losses / result.iterationsRun)}</span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
