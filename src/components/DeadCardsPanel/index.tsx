"use client";

import { useState } from "react";
import { Card, Rank, Suit, RANKS } from "@/engine/cards";
import { RANK_LABELS, SUIT_SYMBOLS } from "@/components/CardPicker";
import { cn } from "@/lib/utils";
import { Skull, X } from "lucide-react";
import { useDeckColor } from "@/contexts/DeckColorContext";

const DISPLAY_SUITS = [Suit.Spades, Suit.Hearts, Suit.Diamonds, Suit.Clubs];

interface DeadCardsPanelProps {
  deadCards: Card[];
  blockedCards: Card[]; // cards in player hands / board — cannot be marked dead
  onChange: (cards: Card[]) => void;
}

export function DeadCardsPanel({ deadCards, blockedCards, onChange }: DeadCardsPanelProps) {
  const { suitColors } = useDeckColor();
  const [picking, setPicking] = useState(false);

  function isDead(card: Card) {
    return deadCards.some(d => d.rank === card.rank && d.suit === card.suit);
  }

  function isBlocked(card: Card) {
    return blockedCards.some(b => b.rank === card.rank && b.suit === card.suit);
  }

  function toggleCard(card: Card) {
    if (isBlocked(card)) return;
    if (isDead(card)) {
      onChange(deadCards.filter(d => !(d.rank === card.rank && d.suit === card.suit)));
    } else {
      onChange([...deadCards, card]);
    }
  }

  function removeCard(card: Card) {
    onChange(deadCards.filter(d => !(d.rank === card.rank && d.suit === card.suit)));
  }

  return (
    <div className="rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 p-3 space-y-2.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skull className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-semibold">Cartas mortas</span>
        </div>
        <button
          onClick={() => setPicking(v => !v)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {picking ? "Fechar" : "Adicionar"}
        </button>
      </div>

      {/* Selected dead cards as removable chips */}
      <div className="flex flex-wrap gap-1 min-h-[20px]">
        {deadCards.length === 0 && !picking && (
          <span className="text-xs text-muted-foreground italic">Nenhuma carta morta</span>
        )}
        {deadCards.map(card => (
          <button
            key={`${card.rank}-${card.suit}`}
            onClick={() => removeCard(card)}
            title="Remover carta morta"
            className={cn(
              "flex items-center gap-0.5 text-xs font-bold px-1.5 py-0.5 rounded-md border",
              "bg-background hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors",
              suitColors[card.suit]
            )}
          >
            {RANK_LABELS[card.rank]}{SUIT_SYMBOLS[card.suit]}
            <X className="h-2.5 w-2.5 ml-0.5 opacity-60" />
          </button>
        ))}
      </div>

      {/* Inline card picker grid */}
      {picking && (
        <div className="rounded-lg border bg-card p-2 space-y-1.5">
          <p className="text-[10px] text-muted-foreground">
            Clique para marcar/desmarcar · cartas em jogo não podem ser adicionadas
          </p>
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${RANKS.length}, 1fr)` }}>
            {DISPLAY_SUITS.map(suit =>
              [...RANKS].reverse().map(rank => {
                const card: Card = { rank, suit };
                const dead = isDead(card);
                const blocked = isBlocked(card);
                return (
                  <button
                    key={`${rank}-${suit}`}
                    onClick={() => toggleCard(card)}
                    disabled={blocked}
                    title={blocked ? "Em uso por um jogador" : dead ? "Remover da lista morta" : "Marcar como morta"}
                    className={cn(
                      "h-10 rounded-md font-bold flex flex-col items-center justify-center leading-none transition-all gap-0",
                      blocked && "opacity-15 cursor-not-allowed",
                      dead && "bg-red-600 text-white scale-105 shadow-sm",
                      !blocked && !dead && cn("hover:bg-muted hover:scale-105 cursor-pointer", suitColors[suit]),
                    )}
                  >
                    <span className="text-[10px] font-bold leading-none">{RANK_LABELS[rank]}</span>
                    <span className="text-[11px] leading-none">{SUIT_SYMBOLS[suit]}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
