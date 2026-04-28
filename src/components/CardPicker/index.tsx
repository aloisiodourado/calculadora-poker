"use client";

import { useState } from "react";
import { Card, Rank, Suit, RANKS, SUITS } from "@/engine/cards";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useDeckColor } from "@/contexts/DeckColorContext";

export const RANK_LABELS: Record<Rank, string> = {
  [Rank.Two]: "2", [Rank.Three]: "3", [Rank.Four]: "4",
  [Rank.Five]: "5", [Rank.Six]: "6", [Rank.Seven]: "7",
  [Rank.Eight]: "8", [Rank.Nine]: "9", [Rank.Ten]: "T",
  [Rank.Jack]: "J", [Rank.Queen]: "Q", [Rank.King]: "K",
  [Rank.Ace]: "A",
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  [Suit.Spades]: "♠", [Suit.Hearts]: "♥",
  [Suit.Diamonds]: "♦", [Suit.Clubs]: "♣",
};

// Kept for reference; actual colors come from DeckColorContext at runtime
export { SUIT_COLORS_4 as SUIT_COLORS } from "@/contexts/DeckColorContext";

// Display order in the picker grid: ♠ ♥ ♦ ♣
const DISPLAY_SUITS = [Suit.Spades, Suit.Hearts, Suit.Diamonds, Suit.Clubs];

interface CardDisplayProps {
  card: Card | null;
  dimmed?: boolean;
  highlighted?: boolean;
  label?: string;
  className?: string;
}

export function CardDisplay({ card, dimmed, highlighted, label, className }: CardDisplayProps) {
  const { suitColors } = useDeckColor();
  return (
    <div className="flex flex-col items-center gap-0.5">
      {label && (
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
      )}
      <div
        className={cn(
          "h-20 w-14 rounded-xl border-2 flex flex-col items-center justify-center font-bold select-none transition-all gap-0.5",
          card
            ? "bg-white shadow-md"
            : "border-dashed border-muted-foreground/30 bg-muted/20",
          highlighted && "ring-2 ring-emerald-400 ring-offset-1",
          dimmed && "opacity-30",
          className
        )}
      >
        {card ? (
          <>
            <span className={cn("text-2xl leading-none font-bold", suitColors[card.suit])}>
              {RANK_LABELS[card.rank]}
            </span>
            <span className={cn("text-xl leading-none", suitColors[card.suit])}>
              {SUIT_SYMBOLS[card.suit]}
            </span>
          </>
        ) : (
          <span className="text-base text-muted-foreground">?</span>
        )}
      </div>
    </div>
  );
}

interface CardPickerProps {
  selected: Card | null;
  onSelect: (card: Card | null) => void;
  blockedCards: Card[];
  label?: string;
  dimmed?: boolean;
  highlighted?: boolean;
  className?: string;
}

export function CardPicker({
  selected,
  onSelect,
  blockedCards,
  label,
  dimmed,
  highlighted,
  className,
}: CardPickerProps) {
  const [open, setOpen] = useState(false);
  const { suitColors } = useDeckColor();

  function isBlocked(card: Card): boolean {
    return blockedCards.some((b) => b.rank === card.rank && b.suit === card.suit);
  }

  function isSelected(card: Card): boolean {
    return selected?.rank === card.rank && selected?.suit === card.suit;
  }

  function handleGridClick(card: Card) {
    if (isBlocked(card)) return;
    if (isSelected(card)) {
      onSelect(null);
      setOpen(false);
    } else {
      onSelect(card);
      setOpen(false);
    }
  }

  function handleTriggerClick() {
    // Clicking a filled card slot clears it without opening the popover
    if (selected) {
      onSelect(null);
    } else {
      setOpen(true);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "flex flex-col items-center gap-0.5 cursor-pointer focus:outline-none group",
          className
        )}
        onClick={handleTriggerClick}
        title={selected ? "Click to clear" : "Click to pick a card"}
      >
        {label && (
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </span>
        )}
        <div
          className={cn(
            "h-20 w-14 rounded-xl border-2 flex flex-col items-center justify-center font-bold select-none transition-all gap-0.5",
            selected
              ? "bg-white shadow-md group-hover:border-red-400"
              : "border-dashed border-muted-foreground/30 bg-muted/20 group-hover:border-blue-400 group-hover:bg-blue-50",
            highlighted && "ring-2 ring-emerald-400 ring-offset-1",
            dimmed && "opacity-30",
          )}
        >
          {selected ? (
            <>
              <span className={cn("text-2xl leading-none font-bold", suitColors[selected.suit])}>
                {RANK_LABELS[selected.rank]}
              </span>
              <span className={cn("text-xl leading-none", suitColors[selected.suit])}>
                {SUIT_SYMBOLS[selected.suit]}
              </span>
            </>
          ) : (
            <span className="text-base text-muted-foreground">?</span>
          )}
        </div>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-3" align="start" side="bottom">
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${RANKS.length}, 1fr)` }}>
          {DISPLAY_SUITS.map((suit) =>
            [...RANKS].reverse().map((rank) => {
              const card: Card = { rank, suit };
              const blocked = isBlocked(card);
              const sel = isSelected(card);
              return (
                <button
                  key={`${rank}-${suit}`}
                  onClick={() => handleGridClick(card)}
                  disabled={blocked}
                  className={cn(
                    "w-[76px] h-[88px] rounded-xl font-bold flex flex-col items-center justify-center leading-none transition-all gap-1",
                    blocked && "opacity-20 cursor-not-allowed",
                    sel && "bg-blue-500 text-white scale-105 shadow-md",
                    !blocked && !sel && "hover:bg-muted hover:scale-105 cursor-pointer",
                    suitColors[suit]
                  )}
                >
                  <span className="text-xl">{RANK_LABELS[rank]}</span>
                  <span className="text-xl">{SUIT_SYMBOLS[suit]}</span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
