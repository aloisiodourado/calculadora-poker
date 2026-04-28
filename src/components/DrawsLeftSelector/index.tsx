"use client";

import { cn } from "@/lib/utils";

interface DrawsLeftSelectorProps {
  value: number;
  onChange: (value: number) => void;
}

const OPTIONS = [3, 2, 1] as const;

export function DrawsLeftSelector({ value, onChange }: DrawsLeftSelectorProps) {
  return (
    <div className="flex items-center gap-2 pb-1">
      <span className="text-xs text-muted-foreground whitespace-nowrap">Draws restantes:</span>
      <div className="flex rounded-md border overflow-hidden text-xs font-medium">
        {OPTIONS.map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={cn(
              "px-3 py-1 transition-colors",
              value === n
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-muted"
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
