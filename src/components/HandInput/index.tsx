"use client";

import { Card } from "@/engine/cards";
import { PokerVariant } from "@/engine/variants";
import { VariantConfig } from "@/engine/variants/types";
import { HandResult } from "@/engine/simulator/types";
import { bestBadugiHand } from "@/engine/evaluators/BadugiEvaluator";
import { CardPicker } from "@/components/CardPicker";
import { HandPreview } from "@/components/HandPreview";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { X, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const PLAYER_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
];

const HAND_BORDERS = [
  "border-blue-300",
  "border-emerald-300",
  "border-violet-300",
  "border-amber-300",
  "border-rose-300",
  "border-cyan-300",
];

const HAND_BG = [
  "bg-blue-50/60",
  "bg-emerald-50/60",
  "bg-violet-50/60",
  "bg-amber-50/60",
  "bg-rose-50/60",
  "bg-cyan-50/60",
];

// Stud street labels: cards 0-1 = hole, 2-5 = streets 3-6, 6 = 7th (down)
const STUD_LABELS = [
  "Hole", "Hole",
  "3rd St", "4th St", "5th St", "6th St",
  "7th St",
];
const STUD_DOWN = [0, 1, 6]; // face-down cards

const DRAW_VARIANTS = [
  PokerVariant.SingleDraw27,
  PokerVariant.TripleDraw27,
  PokerVariant.Badugi,
];

const STUD_VARIANTS = [
  PokerVariant.SevenCardStud,
  PokerVariant.StudHiLo,
  PokerVariant.Razz,
];

interface HandInputProps {
  handIndex: number;
  cards: (Card | null)[];
  discards: boolean[];
  holeCardCount: number;
  blockedCards: Card[];
  boardCards: (Card | null)[];
  variant: PokerVariant;
  config: VariantConfig;
  result?: HandResult;
  isHiLo?: boolean;
  iterationsRun?: number;
  onCardChange: (cardIndex: number, card: Card | null) => void;
  onDiscardToggle: (cardIndex: number) => void;
  onRemove: () => void;
  canRemove: boolean;
}

export function HandInput({
  handIndex,
  cards,
  discards,
  holeCardCount,
  blockedCards,
  boardCards,
  variant,
  config,
  result,
  isHiLo,
  iterationsRun,
  onCardChange,
  onDiscardToggle,
  onRemove,
  canRemove,
}: HandInputProps) {
  const colorIdx = handIndex % PLAYER_COLORS.length;
  const isStud = STUD_VARIANTS.includes(variant);
  const isDraw = DRAW_VARIANTS.includes(variant);
  const isBadugi = variant === PokerVariant.Badugi;

  // Compute effective Badugi hand for highlight
  const badugiEffective = isBadugi
    ? bestBadugiHand(cards.filter((c): c is Card => c !== null))
    : [];

  function isBadugiValid(cardIdx: number): boolean {
    const card = cards[cardIdx];
    if (!card) return false;
    return badugiEffective.some((c) => c.rank === card.rank && c.suit === card.suit);
  }

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  return (
    <div
      className={cn(
        "rounded-xl border-2 p-3 space-y-2",
        HAND_BORDERS[colorIdx],
        HAND_BG[colorIdx]
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn("w-2.5 h-2.5 rounded-full", PLAYER_COLORS[colorIdx])} />
          <span className="text-sm font-semibold">Player {handIndex + 1}</span>
          <HandPreview
            holeCards={cards}
            boardCards={boardCards}
            variant={variant}
            config={config}
          />
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <span className="text-2xl font-bold tabular-nums">
              {pct(result.equity)}
            </span>
          )}
          {canRemove && (
            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={onRemove}>
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Stud layout */}
      {isStud && (
        <StudLayout
          cards={cards}
          discards={discards}
          blockedCards={blockedCards}
          onCardChange={onCardChange}
        />
      )}

      {/* Draw layout (2-7 and Badugi) */}
      {isDraw && (
        <DrawLayout
          cards={cards}
          discards={discards}
          blockedCards={blockedCards}
          isBadugi={isBadugi}
          isBadugiValid={isBadugiValid}
          onCardChange={onCardChange}
          onDiscardToggle={onDiscardToggle}
          variant={variant}
        />
      )}

      {/* Default layout (Hold'em, Omaha) */}
      {!isStud && !isDraw && (
        <div className="flex gap-2 flex-wrap">
          {Array.from({ length: holeCardCount }).map((_, i) => (
            <CardPicker
              key={i}
              selected={cards[i] ?? null}
              onSelect={(card) => onCardChange(i, card)}
              blockedCards={blockedCards}
            />
          ))}
        </div>
      )}

      {/* Equity breakdown */}
      {result && iterationsRun && (
        <div className="flex gap-3 text-xs text-muted-foreground pt-1 border-t border-black/5 flex-wrap">
          {isHiLo ? (
            <>
              <span>Hi: <strong>{pct(result.hiWins / iterationsRun)}</strong></span>
              <span>Lo: <strong>{pct(result.loWins / iterationsRun)}</strong></span>
              <span>Lo qualif.: <strong>{pct(result.loQualified / iterationsRun)}</strong></span>
            </>
          ) : (
            <>
              <span>Win: <strong>{pct(result.wins / iterationsRun)}</strong></span>
              <span>Loss: <strong>{pct(result.losses / iterationsRun)}</strong></span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stud layout ────────────────────────────────────────────────────────────────

function StudLayout({
  cards,
  discards,
  blockedCards,
  onCardChange,
}: {
  cards: (Card | null)[];
  discards: boolean[];
  blockedCards: Card[];
  onCardChange: (i: number, c: Card | null) => void;
}) {
  const holeSlots = [0, 1];
  const upSlots = [2, 3, 4, 5];
  const seventhSlot = 6;

  return (
    <div className="flex items-start gap-4 flex-wrap">
      {/* Down cards */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          Hole (down)
        </span>
        <div className="flex gap-1.5">
          {holeSlots.map((i) => (
            <CardPicker
              key={i}
              selected={cards[i] ?? null}
              onSelect={(c) => onCardChange(i, c)}
              blockedCards={blockedCards}
              label={STUD_LABELS[i]}
            />
          ))}
        </div>
      </div>

      <div className="w-px bg-slate-200 self-stretch mt-5" />

      {/* Up cards */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          Up cards
        </span>
        <div className="flex gap-1.5">
          {upSlots.map((i) => (
            <CardPicker
              key={i}
              selected={cards[i] ?? null}
              onSelect={(c) => onCardChange(i, c)}
              blockedCards={blockedCards}
              label={STUD_LABELS[i]}
            />
          ))}
        </div>
      </div>

      <div className="w-px bg-slate-200 self-stretch mt-5" />

      {/* 7th street */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          7th St (down)
        </span>
        <CardPicker
          selected={cards[seventhSlot] ?? null}
          onSelect={(c) => onCardChange(seventhSlot, c)}
          blockedCards={blockedCards}
        />
      </div>
    </div>
  );
}

// ── Draw layout ────────────────────────────────────────────────────────────────

const DRAW_ROUNDS: Record<string, number> = {
  [PokerVariant.SingleDraw27]: 1,
  [PokerVariant.TripleDraw27]: 3,
  [PokerVariant.Badugi]: 3,
};

function DrawLayout({
  cards,
  discards,
  blockedCards,
  isBadugi,
  isBadugiValid,
  onCardChange,
  onDiscardToggle,
  variant,
}: {
  cards: (Card | null)[];
  discards: boolean[];
  blockedCards: Card[];
  isBadugi: boolean;
  isBadugiValid: (i: number) => boolean;
  onCardChange: (i: number, c: Card | null) => void;
  onDiscardToggle: (i: number) => void;
  variant: PokerVariant;
}) {
  const rounds = DRAW_ROUNDS[variant] ?? 1;
  const discardCount = discards.filter(Boolean).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex gap-2">
          {cards.map((card, i) => {
            const isDiscard = discards[i];
            const valid = isBadugi ? isBadugiValid(i) : null;
            const invalid = isBadugi && card !== null && !isBadugiValid(i);

            return (
              <div key={i} className="flex flex-col items-center gap-1">
                <CardPicker
                  selected={card}
                  onSelect={(c) => onCardChange(i, c)}
                  blockedCards={blockedCards}
                  dimmed={isDiscard}
                  highlighted={isBadugi && valid === true}
                  className={cn(isDiscard && "opacity-40")}
                />

                {isBadugi && card && (
                  <Tooltip>
                    <TooltipTrigger>
                      <span
                        className={cn(
                          "text-[9px] font-bold uppercase tracking-wider px-1 rounded cursor-default",
                          valid ? "text-emerald-600 bg-emerald-50" : "text-slate-400 bg-slate-100 line-through"
                        )}
                      >
                        {valid ? "valid" : "out"}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      {valid
                        ? "Esta carta faz parte da sua mão Badugi efetiva"
                        : "Excluída por par de naipe ou valor duplicado"}
                    </TooltipContent>
                  </Tooltip>
                )}

                {!isBadugi && card && (
                  <Tooltip>
                    <TooltipTrigger>
                      <div
                        className="flex items-center gap-1 cursor-pointer"
                        onClick={() => onDiscardToggle(i)}
                      >
                        <Checkbox
                          checked={isDiscard}
                          className="h-3 w-3"
                          onCheckedChange={() => onDiscardToggle(i)}
                        />
                        <span className="text-[9px] text-muted-foreground">desc.</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      Marcar para descarte: esta carta será tratada como desconhecida na simulação
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            );
          })}
        </div>

        {!isBadugi && discardCount > 0 && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Trash2 className="h-3 w-3" />
            {discardCount} para descarte
          </span>
        )}
      </div>

      {!isBadugi && (
        <p className="text-[10px] text-muted-foreground">
          {rounds === 1 ? "Single Draw" : `Triple Draw (${rounds} rodadas)`} ·
          Marque as cartas que você descartaria para calcular a equidade antes do draw
        </p>
      )}
    </div>
  );
}
