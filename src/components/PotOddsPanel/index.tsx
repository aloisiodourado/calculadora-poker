"use client";

import { TrendingUp } from "lucide-react";

interface PotOddsPanelProps {
  pot: number;
  bet: number;
  onPotChange: (v: number) => void;
  onBetChange: (v: number) => void;
  requiredEquity: number;
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export function PotOddsPanel({
  pot,
  bet,
  onPotChange,
  onBetChange,
  requiredEquity,
}: PotOddsPanelProps) {

  return (
    <div className="rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 p-4 space-y-4">
      {/* Title + required equity */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Pot Odds</span>
        </div>
        {requiredEquity > 0 && (
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
            Equity mínima: {pct(requiredEquity)}
          </span>
        )}
      </div>

      {/* Inputs */}
      <div className="flex gap-4 flex-wrap items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Pot
          </label>
          <input
            type="number"
            min={0}
            step={0.5}
            value={pot}
            onChange={(e) => onPotChange(Math.max(0, Number(e.target.value)))}
            className="w-24 text-sm font-medium border rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Aposta
          </label>
          <input
            type="number"
            min={0}
            step={0.5}
            value={bet}
            onChange={(e) => onBetChange(Math.max(0, Number(e.target.value)))}
            className="w-24 text-sm font-medium border rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-600"
          />
        </div>

        {/* Formula display */}
        {bet > 0 && (
          <div className="text-xs text-muted-foreground pb-2">
            <span className="font-mono">{bet} / ({pot} + {bet})</span>
            <span className="mx-1">=</span>
            <span className="font-bold text-foreground">{pct(requiredEquity)}</span>
          </div>
        )}
      </div>

    </div>
  );
}
