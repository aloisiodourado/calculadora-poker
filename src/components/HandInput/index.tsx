"use client";

import { useState } from "react";
import { Card, Rank, Suit, RANKS } from "@/engine/cards";
import { PokerVariant } from "@/engine/variants";
import { VariantConfig } from "@/engine/variants/types";
import { HandResult, DrawRoundStrategy } from "@/engine/simulator/types";
import { bestBadugiHand } from "@/engine/evaluators/BadugiEvaluator";
import { RANK_LABELS, SUIT_SYMBOLS } from "@/components/CardPicker";
import { CardPicker } from "@/components/CardPicker";
import { HandPreview } from "@/components/HandPreview";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { X, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { HandCategory, HAND_CATEGORIES, CATEGORY_SHORT, CATEGORY_LABELS, CATEGORY_RANGE_PCT } from "@/lib/representative-hands-27td";
import { useDeckColor } from "@/contexts/DeckColorContext";

export const PLAYER_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
];

const HAND_BORDERS = [
  "border-blue-300 dark:border-blue-700",
  "border-emerald-300 dark:border-emerald-700",
  "border-violet-300 dark:border-violet-700",
  "border-amber-300 dark:border-amber-700",
  "border-rose-300 dark:border-rose-700",
  "border-cyan-300 dark:border-cyan-700",
];

const HAND_BG = [
  "bg-blue-50/60 dark:bg-blue-950/30",
  "bg-emerald-50/60 dark:bg-emerald-950/30",
  "bg-violet-50/60 dark:bg-violet-950/30",
  "bg-amber-50/60 dark:bg-amber-950/30",
  "bg-rose-50/60 dark:bg-rose-950/30",
  "bg-cyan-50/60 dark:bg-cyan-950/30",
];

const ACTIVE_RING = [
  "ring-2 ring-blue-400",
  "ring-2 ring-emerald-400",
  "ring-2 ring-violet-400",
  "ring-2 ring-amber-400",
  "ring-2 ring-rose-400",
  "ring-2 ring-cyan-400",
];

const STUD_LABELS = [
  "Hole", "Hole",
  "3rd St", "4th St", "5th St", "6th St",
  "7th St",
];

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

const DISPLAY_SUITS = [Suit.Spades, Suit.Hearts, Suit.Diamonds, Suit.Clubs];

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
  drawRoundsLeft?: number;
  drawStrategies?: DrawRoundStrategy[];
  explicitDiscards?: boolean[];
  handCategory?: HandCategory | null;
  isActive?: boolean;
  onCardChange: (cardIndex: number, card: Card | null) => void;
  onDiscardToggle: (cardIndex: number) => void;
  onDrawStrategyChange: (roundIdx: number, threshold: Rank) => void;
  onExplicitDiscardToggle: (slotIdx: number) => void;
  onCategoryChange?: (category: HandCategory | null) => void;
  onSetActive?: () => void;
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
  drawRoundsLeft,
  drawStrategies,
  explicitDiscards,
  handCategory,
  isActive,
  onCardChange,
  onDiscardToggle,
  onDrawStrategyChange,
  onExplicitDiscardToggle,
  onCategoryChange,
  onSetActive,
  onRemove,
  canRemove,
}: HandInputProps) {
  const colorIdx = handIndex % PLAYER_COLORS.length;
  const isStud = STUD_VARIANTS.includes(variant);
  const isDraw = DRAW_VARIANTS.includes(variant);
  const isBadugi = variant === PokerVariant.Badugi;
  const isTripleDraw = variant === PokerVariant.TripleDraw27;
  const isSingleDraw27 = variant === PokerVariant.SingleDraw27;
  const showEmptyDiscardCheckboxes = isTripleDraw || isSingleDraw27;
  const inCategoryMode = isTripleDraw && !!handCategory;

  const currentRoundIdx = isTripleDraw && drawRoundsLeft != null ? 3 - drawRoundsLeft : null;
  const currentDrawStrategy =
    currentRoundIdx != null && drawStrategies ? drawStrategies[currentRoundIdx] : undefined;

  const badugiEffective = isBadugi
    ? bestBadugiHand(cards.filter((c): c is Card => c !== null))
    : [];

  function isBadugiValid(cardIdx: number): boolean {
    const card = cards[cardIdx];
    if (!card) return false;
    return badugiEffective.some((c) => c.rank === card.rank && c.suit === card.suit);
  }

  function slotBlocked(slotIdx: number): Card[] {
    return [
      ...blockedCards,
      ...cards.filter((c, ci): c is Card => c !== null && ci !== slotIdx),
    ];
  }

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  return (
    <div
      className={cn(
        "rounded-xl border-2 p-3 space-y-2",
        HAND_BORDERS[colorIdx],
        HAND_BG[colorIdx],
        isActive && ACTIVE_RING[colorIdx]
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
            drawStrategy={currentDrawStrategy}
          />
        </div>
        <div className="flex items-center gap-1">
          {onSetActive && (
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-6 w-6", isActive ? "text-amber-500" : "text-muted-foreground")}
              onClick={onSetActive}
              title={isActive ? "Desmarcar player ativo" : "Selecionar para atribuir mão do Top 10"}
            >
              <Target className="h-3 w-3" />
            </Button>
          )}
          {result && (
            <span className="text-2xl font-bold tabular-nums ml-1">
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

      {/* WIP category selector */}
      {isTripleDraw && onCategoryChange && (
        <CategorySelector
          selected={handCategory ?? null}
          onChange={onCategoryChange}
        />
      )}

      {/* Stud layout — keeps individual pickers (different structure) */}
      {isStud && (
        <StudLayout
          cards={cards}
          discards={discards}
          slotBlocked={slotBlocked}
          onCardChange={onCardChange}
        />
      )}

      {/* Draw layout — batch picker on every slot */}
      {isDraw && (
        <DrawLayout
          cards={cards}
          discards={discards}
          isBadugi={isBadugi}
          isTripleDraw={isTripleDraw}
          showEmptyDiscardCheckboxes={showEmptyDiscardCheckboxes}
          isBadugiValid={isBadugiValid}
          explicitDiscards={explicitDiscards}
          blockedCards={blockedCards}
          onCardChange={onCardChange}
          onDiscardToggle={onDiscardToggle}
          onExplicitDiscardToggle={onExplicitDiscardToggle}
        />
      )}

      {/* Triple Draw strategy config */}
      {isTripleDraw && drawRoundsLeft != null && drawStrategies && (
        <TripleDrawStrategy
          drawRoundsLeft={drawRoundsLeft}
          strategies={drawStrategies}
          onChange={onDrawStrategyChange}
        />
      )}

      {/* Default layout (Hold'em, Omaha) — also uses batch picker */}
      {!isStud && !isDraw && (
        <DefaultLayout
          cards={cards}
          holeCardCount={holeCardCount}
          blockedCards={blockedCards}
          onCardChange={onCardChange}
        />
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

// ── Shared batch card picker popover ──────────────────────────────────────────

function BatchPickerPopover({
  open,
  onOpenChange,
  cards,
  blockedCards,
  onCardChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cards: (Card | null)[];
  blockedCards: Card[];
  onCardChange: (i: number, c: Card | null) => void;
}) {
  const { suitColors } = useDeckColor();
  const emptySlots = cards.filter((c) => c === null).length;
  const totalSlots = cards.length;
  const filledCount = totalSlots - emptySlots;

  function isBlocked(card: Card): boolean {
    return blockedCards.some((b) => b.rank === card.rank && b.suit === card.suit);
  }

  function isInHand(card: Card): boolean {
    return cards.some((c) => c?.rank === card.rank && c?.suit === card.suit);
  }

  function handleClick(card: Card) {
    if (isBlocked(card)) return;
    if (isInHand(card)) {
      const slotIdx = cards.findIndex((c) => c?.rank === card.rank && c?.suit === card.suit);
      if (slotIdx !== -1) onCardChange(slotIdx, null);
    } else {
      const emptyIdx = cards.findIndex((c) => c === null);
      if (emptyIdx !== -1) onCardChange(emptyIdx, card);
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {/* Invisible trigger — opened programmatically via open prop */}
      <PopoverTrigger className="sr-only" />
      <PopoverContent className="w-auto p-3" align="start" side="bottom">
        <p className="text-[11px] text-muted-foreground mb-2">
          {emptySlots > 0
            ? `${filledCount}/${totalSlots} selecionadas · clique para adicionar ou remover`
            : "Mão completa · clique para remover cartas"}
        </p>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${RANKS.length}, 1fr)` }}>
          {DISPLAY_SUITS.map((suit) =>
            [...RANKS].reverse().map((rank) => {
              const card: Card = { rank, suit };
              const blocked = isBlocked(card);
              const inHand = isInHand(card);
              const noRoom = emptySlots === 0 && !inHand;
              return (
                <button
                  key={`${rank}-${suit}`}
                  onClick={() => handleClick(card)}
                  disabled={blocked || noRoom}
                  className={cn(
                    "w-[76px] h-[88px] rounded-xl font-bold flex flex-col items-center justify-center leading-none transition-all gap-1",
                    blocked && "opacity-20 cursor-not-allowed",
                    noRoom && "opacity-30 cursor-not-allowed",
                    inHand && "bg-blue-500 scale-105 shadow-md",
                    !blocked && !noRoom && !inHand && "hover:bg-muted hover:scale-105 cursor-pointer",
                  )}
                >
                  <span className={cn("text-xl", inHand ? "text-white" : suitColors[suit])}>{RANK_LABELS[rank]}</span>
                  <span className={cn("text-xl", inHand ? "text-white" : suitColors[suit])}>{SUIT_SYMBOLS[suit]}</span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Clickable card slot (opens batch picker) ──────────────────────────────────

function ClickableCardSlot({
  card,
  dimmed,
  highlighted,
  className,
  onClick,
}: {
  card: Card | null;
  dimmed?: boolean;
  highlighted?: boolean;
  className?: string;
  onClick: () => void;
}) {
  const { suitColors } = useDeckColor();
  return (
    <div
      onClick={onClick}
      title={card ? "Clique para editar a mão" : "Clique para escolher cartas"}
      className={cn(
        "h-20 w-14 rounded-xl border-2 flex flex-col items-center justify-center font-bold select-none transition-all gap-0.5 cursor-pointer",
        card
          ? "bg-white shadow-md hover:border-blue-400"
          : "border-dashed border-muted-foreground/30 bg-muted/20 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/20",
        highlighted && "ring-2 ring-emerald-400 ring-offset-1",
        dimmed && "opacity-40",
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
  );
}

// ── Draw layout ────────────────────────────────────────────────────────────────

function DrawLayout({
  cards,
  discards,
  isBadugi,
  isTripleDraw,
  showEmptyDiscardCheckboxes,
  isBadugiValid,
  explicitDiscards,
  blockedCards,
  onCardChange,
  onDiscardToggle,
  onExplicitDiscardToggle,
}: {
  cards: (Card | null)[];
  discards: boolean[];
  isBadugi: boolean;
  isTripleDraw: boolean;
  showEmptyDiscardCheckboxes: boolean;
  isBadugiValid: (i: number) => boolean;
  explicitDiscards?: boolean[];
  blockedCards: Card[];
  onCardChange: (i: number, c: Card | null) => void;
  onDiscardToggle: (i: number) => void;
  onExplicitDiscardToggle: (i: number) => void;
}) {
  const [batchOpen, setBatchOpen] = useState(false);
  const showDiscardCheckboxes = !isBadugi && !isTripleDraw;
  const discardCount = discards.filter(Boolean).length;

  return (
    <div className="space-y-2">
      <BatchPickerPopover
        open={batchOpen}
        onOpenChange={setBatchOpen}
        cards={cards}
        blockedCards={blockedCards}
        onCardChange={onCardChange}
      />

      <div className="flex items-center gap-3">
        <div className="flex gap-2">
          {cards.map((card, i) => {
            const isDiscard = discards[i];
            const valid = isBadugi ? isBadugiValid(i) : null;
            const isExplicitDiscard = showEmptyDiscardCheckboxes && !card && (explicitDiscards?.[i] ?? false);

            return (
              <div key={i} className="flex flex-col items-center gap-1">
                {showEmptyDiscardCheckboxes && !card && (
                  <div
                    className="flex items-center gap-1 cursor-pointer"
                    onClick={() => onExplicitDiscardToggle(i)}
                  >
                    <Checkbox
                      checked={isExplicitDiscard}
                      className="h-3 w-3"
                      onCheckedChange={() => onExplicitDiscardToggle(i)}
                    />
                    <Tooltip>
                      <TooltipTrigger>
                        <span className="text-[9px] text-muted-foreground">desc.</span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        {isExplicitDiscard
                          ? "Descarte garantido: simulado como uma carta qualquer descartada no draw"
                          : "Marcar como descarte: trata esta posição como uma carta descartada (sem importar qual)"}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}

                <ClickableCardSlot
                  card={card}
                  dimmed={isDiscard || isExplicitDiscard}
                  highlighted={isBadugi && valid === true}
                  onClick={() => setBatchOpen(true)}
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

                {showDiscardCheckboxes && card && (
                  <div
                    className="flex items-center gap-1 cursor-pointer"
                    onClick={() => onDiscardToggle(i)}
                  >
                    <Checkbox
                      checked={isDiscard}
                      className="h-3 w-3"
                      onCheckedChange={() => onDiscardToggle(i)}
                    />
                    <Tooltip>
                      <TooltipTrigger>
                        <span className="text-[9px] text-muted-foreground">desc.</span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">
                        Marcar para descarte: esta carta será tratada como desconhecida na simulação
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {showDiscardCheckboxes && discardCount > 0 && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <span>🗑</span>
            {discardCount} para descarte
          </span>
        )}
      </div>

      {showDiscardCheckboxes && (
        <p className="text-[10px] text-muted-foreground">
          Single Draw · Marque as cartas que você descartaria para calcular a equidade antes do draw
        </p>
      )}
    </div>
  );
}

// ── Default layout (Hold'em, Omaha) — batch picker ────────────────────────────

function DefaultLayout({
  cards,
  holeCardCount,
  blockedCards,
  onCardChange,
}: {
  cards: (Card | null)[];
  holeCardCount: number;
  blockedCards: Card[];
  onCardChange: (i: number, c: Card | null) => void;
}) {
  const [batchOpen, setBatchOpen] = useState(false);

  return (
    <div className="flex gap-2 flex-wrap">
      <BatchPickerPopover
        open={batchOpen}
        onOpenChange={setBatchOpen}
        cards={cards}
        blockedCards={blockedCards}
        onCardChange={onCardChange}
      />
      {Array.from({ length: holeCardCount }).map((_, i) => (
        <ClickableCardSlot
          key={i}
          card={cards[i] ?? null}
          onClick={() => setBatchOpen(true)}
        />
      ))}
    </div>
  );
}

// ── Stud layout — keeps individual pickers ─────────────────────────────────────

function StudLayout({
  cards,
  discards,
  slotBlocked,
  onCardChange,
}: {
  cards: (Card | null)[];
  discards: boolean[];
  slotBlocked: (i: number) => Card[];
  onCardChange: (i: number, c: Card | null) => void;
}) {
  const holeSlots = [0, 1];
  const upSlots = [2, 3, 4, 5];
  const seventhSlot = 6;

  return (
    <div className="flex items-start gap-4 flex-wrap">
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
              blockedCards={slotBlocked(i)}
              label={STUD_LABELS[i]}
            />
          ))}
        </div>
      </div>

      <div className="w-px bg-slate-200 self-stretch mt-5" />

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
              blockedCards={slotBlocked(i)}
              label={STUD_LABELS[i]}
            />
          ))}
        </div>
      </div>

      <div className="w-px bg-slate-200 self-stretch mt-5" />

      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          7th St (down)
        </span>
        <CardPicker
          selected={cards[seventhSlot] ?? null}
          onSelect={(c) => onCardChange(seventhSlot, c)}
          blockedCards={slotBlocked(seventhSlot)}
        />
      </div>
    </div>
  );
}

// ── WIP category selector ──────────────────────────────────────────────────────

function CategorySelector({
  selected,
  onChange,
}: {
  selected: HandCategory | null;
  onChange: (cat: HandCategory | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {HAND_CATEGORIES.map((cat) => (
        <button
          key={cat}
          onClick={() => onChange(selected === cat ? null : cat)}
          className={cn(
            "text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors",
            selected === cat
              ? "bg-slate-700 dark:bg-slate-200 text-white dark:text-slate-900 border-slate-700 dark:border-slate-200"
              : "bg-transparent text-muted-foreground border-muted-foreground/30 hover:border-slate-400 hover:text-foreground"
          )}
        >
          {CATEGORY_SHORT[cat]}
          <span className="ml-1 opacity-60 font-normal">({CATEGORY_RANGE_PCT[cat]}%)</span>
        </button>
      ))}
      {selected && (
        <span className="text-xs text-muted-foreground self-center ml-1">
          · {CATEGORY_LABELS[selected]}
        </span>
      )}
    </div>
  );
}

// ── Triple Draw strategy config ────────────────────────────────────────────────

const THRESHOLD_OPTIONS: Rank[] = [
  Rank.Seven, Rank.Eight, Rank.Nine, Rank.Ten, Rank.Jack, Rank.Queen, Rank.King,
];

const DRAW_LABELS: Record<number, string> = {
  0: "1º draw",
  1: "2º draw",
  2: "3º draw (final)",
};

function TripleDrawStrategy({
  drawRoundsLeft,
  strategies,
  onChange,
}: {
  drawRoundsLeft: number;
  strategies: DrawRoundStrategy[];
  onChange: (roundIdx: number, threshold: Rank) => void;
}) {
  const startIdx = 3 - drawRoundsLeft;
  const activeRounds = Array.from({ length: drawRoundsLeft }, (_, i) => startIdx + i);

  return (
    <div className="pt-1 border-t border-black/5">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
        Estratégia de descarte
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {activeRounds.map((roundIdx) => (
          <div key={roundIdx} className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              {DRAW_LABELS[roundIdx]}:
            </span>
            <span className="text-[11px] text-muted-foreground">manter ≤</span>
            <select
              value={strategies[roundIdx]?.keepThreshold}
              onChange={(e) => onChange(roundIdx, Number(e.target.value) as Rank)}
              className="text-[11px] font-medium border rounded px-1 py-0.5 bg-background cursor-pointer focus:outline-none"
            >
              {THRESHOLD_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {RANK_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
