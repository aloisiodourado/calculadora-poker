"use client";

import { Card } from "@/engine/cards";
import { PokerVariant } from "@/engine/variants";
import { CardPicker } from "@/components/CardPicker";

interface BoardInputProps {
  cards: (Card | null)[];
  communityCardCount: number;
  blockedCards: Card[];
  variant: PokerVariant;
  onCardChange: (index: number, card: Card | null) => void;
}

const OMAHA_VARIANTS = [PokerVariant.OmahaHi, PokerVariant.OmahaHiLo];

export function BoardInput({
  cards,
  communityCardCount,
  blockedCards,
  variant,
  onCardChange,
}: BoardInputProps) {
  if (communityCardCount === 0) return null;

  const isOmaha = OMAHA_VARIANTS.includes(variant);

  return (
    <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">Board</span>
        {isOmaha && (
          <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-0.5">
            Omaha: use exatamente 2 hole cards + 3 community cards
          </span>
        )}
      </div>

      <div className="flex items-start gap-4">
        {/* Flop */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider text-center">
            Flop
          </span>
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <CardPicker
                key={i}
                selected={cards[i] ?? null}
                onSelect={(card) => onCardChange(i, card)}
                blockedCards={blockedCards}
              />
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="w-px bg-slate-200 self-stretch mt-5" />

        {/* Turn */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider text-center">
            Turn
          </span>
          <CardPicker
            selected={cards[3] ?? null}
            onSelect={(card) => onCardChange(3, card)}
            blockedCards={blockedCards}
          />
        </div>

        {/* Divider */}
        <div className="w-px bg-slate-200 self-stretch mt-5" />

        {/* River */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider text-center">
            River
          </span>
          <CardPicker
            selected={cards[4] ?? null}
            onSelect={(card) => onCardChange(4, card)}
            blockedCards={blockedCards}
          />
        </div>
      </div>
    </div>
  );
}
