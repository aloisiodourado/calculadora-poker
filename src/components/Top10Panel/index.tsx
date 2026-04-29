import { TOP_10_27 } from "@/lib/top10-27";
import { cn } from "@/lib/utils";

const RANK_LABEL: Record<number, string> = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8",
  9: "9", 10: "T", 11: "J", 12: "Q", 13: "K", 14: "A",
};

interface Top10PanelProps {
  activeRanks?: Set<number>;
  selectableForPlayer?: number | null;
  onHandSelect?: (rankIdx: number) => void;
}

export function Top10Panel({ activeRanks, selectableForPlayer, onHandSelect }: Top10PanelProps) {
  const isSelectable = selectableForPlayer !== null && selectableForPlayer !== undefined;

  return (
    <div className="sticky top-6 rounded-xl border bg-card w-80 shrink-0 overflow-hidden">
      <div className="px-4 py-4 border-b bg-muted/40">
        <p className="text-lg font-bold tracking-tight">
          Top 10 - 2-7 Hands
        </p>
        {isSelectable && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 font-medium">
            Clique para atribuir ao Player {selectableForPlayer}
          </p>
        )}
      </div>

      <ol>
        {TOP_10_27.map((ranks, i) => {
          const rank = i + 1;
          const isActive = activeRanks?.has(rank);
          const isEven = i % 2 === 0;
          const hand = ranks.map((r) => RANK_LABEL[r]).join("  ");

          return (
            <li
              key={rank}
              onClick={isSelectable && onHandSelect ? () => onHandSelect(rank) : undefined}
              className={cn(
                "flex items-center gap-4 px-4 py-2.5 text-sm transition-colors",
                isSelectable && "cursor-pointer",
                isActive
                  ? "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 font-semibold"
                  : isEven
                  ? cn(
                      "bg-slate-100 dark:bg-slate-800/60 text-muted-foreground",
                      isSelectable && "hover:bg-amber-50 dark:hover:bg-amber-900/20"
                    )
                  : cn(
                      "bg-transparent text-muted-foreground",
                      isSelectable && "hover:bg-amber-50 dark:hover:bg-amber-900/20"
                    )
              )}
            >
              <span className="w-7 text-right font-mono text-xs shrink-0 opacity-50">
                #{rank}
              </span>
              <span className="font-mono tracking-widest text-sm">{hand}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
