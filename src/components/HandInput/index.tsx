"use client";

import { useState, Fragment } from "react";
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
import { X, Target, Plus, LayoutList, SquarePen } from "lucide-react";
import { cn } from "@/lib/utils";
import { HandCategory, HAND_CATEGORIES, CATEGORY_SHORT, CATEGORY_LABELS, CATEGORY_RANGE_PCT, CATEGORY_KEEP_COUNT } from "@/lib/representative-hands-27td";
import { RangeEntry, DEFAULT_RANGE_ENTRY, RANGE_RANK_OPTIONS, rangeEntryLabel } from "@/lib/range-hand-builder";
import { useDeckColor } from "@/contexts/DeckColorContext";
import { parseStudRange, describeStudRange, countRangeCombinations, MAX_COMBO_COUNT } from "@/engine/ranges/studRangeParser";

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
  playerRange?: RangeEntry[] | null;
  onRangeChange?: (range: RangeEntry[] | null) => void;
  // Stud range mode
  studRangePattern?: string | null;
  onStudRangeChange?: (pattern: string | null) => void;
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
  playerRange,
  onRangeChange,
  studRangePattern,
  onStudRangeChange,
}: HandInputProps) {
  const colorIdx = handIndex % PLAYER_COLORS.length;
  const isStud = STUD_VARIANTS.includes(variant);
  const isDraw = DRAW_VARIANTS.includes(variant);
  const isBadugi = variant === PokerVariant.Badugi;
  const isTripleDraw = variant === PokerVariant.TripleDraw27;
  const isSingleDraw27 = variant === PokerVariant.SingleDraw27;
  const showEmptyDiscardCheckboxes = isTripleDraw || isSingleDraw27;
  const inCategoryMode = isTripleDraw && !!handCategory;
  const inRangeMode = isTripleDraw && !!onRangeChange && playerRange != null;
  const inStudRangeMode = isStud && !!onStudRangeChange && studRangePattern != null;

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
          {isTripleDraw && onRangeChange && (
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-6 w-6", inRangeMode ? "text-violet-500" : "text-muted-foreground")}
              onClick={() => onRangeChange(playerRange != null ? null : [{ ...DEFAULT_RANGE_ENTRY }])}
              title={inRangeMode ? "Voltar para mão única" : "Definir range de mãos"}
            >
              <LayoutList className="h-3 w-3" />
            </Button>
          )}
          {isStud && onStudRangeChange && (
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-6 w-6", inStudRangeMode ? "text-violet-500" : "text-muted-foreground")}
              onClick={() => {
                if (inStudRangeMode) {
                  onStudRangeChange(null);
                } else {
                  // Limpa hole cards (B1, B2) antes de entrar no range mode
                  onCardChange(0, null);
                  onCardChange(1, null);
                  onStudRangeChange("");
                }
              }}
              title={inStudRangeMode ? "Voltar para picker de cartas" : "Definir range de hole cards"}
            >
              <SquarePen className="h-3 w-3" />
            </Button>
          )}
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

      {/* Category selector — hidden in range mode */}
      {isTripleDraw && onCategoryChange && !inRangeMode && (
        <CategorySelector
          selected={handCategory ?? null}
          onChange={onCategoryChange}
        />
      )}

      {/* Range builder */}
      {inRangeMode && playerRange != null && onRangeChange && (
        <RangeBuilder
          range={playerRange}
          playerIdx={handIndex}
          onChange={onRangeChange}
        />
      )}

      {/* Stud — card picker sempre visível; range input aparece quando ativo */}
      {isStud && (
        <StudLayout
          cards={cards}
          blockedCards={blockedCards}
          onCardChange={onCardChange}
          disabledSlots={inStudRangeMode ? new Set([0, 1]) : undefined}
        />
      )}
      {isStud && inStudRangeMode && onStudRangeChange && (
        <StudRangeInput
          pattern={studRangePattern ?? ""}
          onChange={onStudRangeChange}
        />
      )}

      {/* Draw layout — hidden in range mode */}
      {isDraw && !inRangeMode && (
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

// Slot labels indexed by card position (0-6)
const STUD_SLOT_LABELS = ["B1", "B2", "3ª", "4ª", "5ª", "6ª", "7ª"];

function StudMultiPicker({
  groupLabel,
  slotIndices,
  closedSlots = new Set<number>(),
  disabledSlots = new Set<number>(),
  allCards,
  blockedCards,
  onCardChange,
}: {
  groupLabel?: string;
  slotIndices: number[];
  closedSlots?: Set<number>;
  disabledSlots?: Set<number>;
  allCards: (Card | null)[];
  blockedCards: Card[];
  onCardChange: (idx: number, card: Card | null) => void;
}) {
  const { suitColors } = useDeckColor();
  const [picking, setPicking] = useState(false);
  const [activeGroupIdx, setActiveGroupIdx] = useState(0);

  const activeCardIdx = slotIndices[activeGroupIdx];

  function isBlocked(card: Card): boolean {
    if (blockedCards.some(b => b.rank === card.rank && b.suit === card.suit)) return true;
    // block cards selected in any other slot of this player
    return allCards.some((c, ci) => {
      if (ci === activeCardIdx) return false;
      return c !== null && c.rank === card.rank && c.suit === card.suit;
    });
  }

  function handleSlotClick(groupIdx: number) {
    setActiveGroupIdx(groupIdx);
    setPicking(true);
  }

  function handleClearSlot(groupIdx: number, e: React.MouseEvent) {
    e.stopPropagation();
    onCardChange(slotIndices[groupIdx], null);
  }

  function handleCardClick(card: Card) {
    if (isBlocked(card)) return;
    const current = allCards[activeCardIdx];
    if (current?.rank === card.rank && current?.suit === card.suit) {
      onCardChange(activeCardIdx, null);
      return;
    }
    onCardChange(activeCardIdx, card);
    // auto-advance to next empty slot in this group
    const nextEmpty = slotIndices.findIndex((si, gi) => gi !== activeGroupIdx && allCards[si] === null);
    if (nextEmpty !== -1) {
      setActiveGroupIdx(nextEmpty);
    } else {
      setPicking(false);
    }
  }

  const groupCards = slotIndices.map(i => allCards[i] ?? null);

  return (
    <div className="space-y-2">
      {groupLabel && (
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          {groupLabel}
        </span>
      )}

      {/* Transparent full-screen overlay — catches every click outside the picker */}
      {picking && (
        <div
          className="fixed inset-0 z-[50]"
          onMouseDown={() => setPicking(false)}
        />
      )}

      {/* Slot row + card grid — elevated above overlay when open */}
      <div className={picking ? "relative z-[60] space-y-2" : "space-y-2"}>
        {/* Slot row */}
        <div className="flex gap-1 items-end overflow-x-auto pb-1">
          {slotIndices.map((cardIdx, gi) => {
            const card = allCards[cardIdx] ?? null;
            const isClosed = closedSlots.has(gi);
            const isDisabled = disabledSlots.has(gi);
            const prevIsClosed = gi > 0 ? closedSlots.has(gi - 1) : isClosed;
            const showSeparator = gi > 0 && isClosed !== prevIsClosed;
            return (
              <Fragment key={cardIdx}>
                {showSeparator && (
                  <div className="self-stretch w-px bg-border/60 mx-0.5" />
                )}
                <button
                  onClick={() => !isDisabled && handleSlotClick(gi)}
                  disabled={isDisabled}
                  className={cn(
                    "relative h-20 w-12 rounded-xl border-2 flex flex-col items-center justify-center font-bold select-none transition-all gap-0.5 shrink-0",
                    isDisabled
                      ? "border-dashed border-violet-400/40 bg-violet-500/5 opacity-50 cursor-not-allowed"
                      : card
                        ? isClosed
                          ? "bg-white dark:bg-zinc-800 shadow-md border-slate-400/40 dark:border-slate-600/40"
                          : "bg-white dark:bg-zinc-800 shadow-md border-transparent"
                        : isClosed
                          ? "border-dashed border-slate-400/40 bg-slate-500/5 hover:border-slate-400/70 hover:bg-slate-500/10"
                          : "border-dashed border-muted-foreground/30 bg-muted/20 hover:border-primary/50 hover:bg-primary/5",
                    !isDisabled && picking && activeGroupIdx === gi && "ring-2 ring-primary ring-offset-1",
                  )}
                  title={isDisabled ? "Controlado pelo range" : card ? "Clique para trocar" : "Clique para selecionar"}
                >
                  {isDisabled ? (
                    <span className="text-[9px] text-violet-400 font-semibold uppercase tracking-wide">range</span>
                  ) : card ? (
                    <>
                      <span className={cn("text-2xl leading-none font-bold", suitColors[card.suit])}>
                        {RANK_LABELS[card.rank]}
                      </span>
                      <span className={cn("text-xl leading-none", suitColors[card.suit])}>
                        {SUIT_SYMBOLS[card.suit]}
                      </span>
                      <span
                        role="button"
                        className="absolute -top-1.5 -right-1.5 bg-background border rounded-full p-0.5 hover:bg-destructive hover:text-destructive-foreground cursor-pointer transition-colors"
                        onClick={(e) => handleClearSlot(gi, e)}
                        title="Remover"
                      >
                        <X className="h-2.5 w-2.5" />
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground font-normal">
                      {STUD_SLOT_LABELS[cardIdx]}
                    </span>
                  )}
                </button>
              </Fragment>
            );
          })}
          {groupCards.some(Boolean) && (
            <button
              onClick={() => { slotIndices.forEach(i => onCardChange(i, null)); setPicking(false); }}
              className="self-end pb-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Limpar
            </button>
          )}
        </div>

        {/* Inline card grid */}
        {picking && (
          <div className="rounded-xl border bg-card p-3 space-y-2">
            {/* Slot tabs */}
            <div className="flex items-center gap-1 flex-wrap">
              {slotIndices.map((cardIdx, gi) => {
                const card = allCards[cardIdx] ?? null;
                return (
                  <button
                    key={cardIdx}
                    onClick={() => setActiveGroupIdx(gi)}
                    className={cn(
                      "px-2 py-0.5 rounded text-xs font-medium transition-all",
                      activeGroupIdx === gi
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80",
                    )}
                  >
                    {card ? (
                      <span className={suitColors[card.suit]}>
                        {RANK_LABELS[card.rank]}{SUIT_SYMBOLS[card.suit]}
                      </span>
                    ) : STUD_SLOT_LABELS[cardIdx]}
                  </button>
                );
              })}
              <button
                onClick={() => setPicking(false)}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                Fechar
              </button>
            </div>

            {/* Card grid */}
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${RANKS.length}, 1fr)` }}>
              {DISPLAY_SUITS.map((suit) =>
                [...RANKS].reverse().map((rank) => {
                  const card: Card = { rank, suit };
                  const blocked = isBlocked(card);
                  const activeCard = allCards[activeCardIdx];
                  const isCurrent = activeCard?.rank === rank && activeCard?.suit === suit;
                  return (
                    <button
                      key={`${rank}-${suit}`}
                      onClick={() => handleCardClick(card)}
                      disabled={blocked}
                      className={cn(
                        "h-16 rounded-lg font-bold flex flex-col items-center justify-center leading-none transition-all gap-0.5",
                        blocked && "opacity-20 cursor-not-allowed",
                        isCurrent && "bg-primary text-primary-foreground scale-105 shadow-md",
                        !blocked && !isCurrent && cn("hover:bg-muted hover:scale-105 cursor-pointer", suitColors[suit]),
                      )}
                    >
                      <span className="text-sm font-bold">{RANK_LABELS[rank]}</span>
                      <span className="text-base leading-none">{SUIT_SYMBOLS[suit]}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StudLayout({
  cards,
  blockedCards,
  onCardChange,
  disabledSlots,
}: {
  cards: (Card | null)[];
  blockedCards: Card[];
  onCardChange: (i: number, c: Card | null) => void;
  disabledSlots?: Set<number>;
}) {
  // Single row: [B1 B2] | [3ª 4ª 5ª 6ª] | [7ª]
  // gi 0,1 = face-down hole cards; gi 2-5 = face-up upcards; gi 6 = face-down 7th street
  return (
    <StudMultiPicker
      slotIndices={[0, 1, 2, 3, 4, 5, 6]}
      closedSlots={new Set([0, 1, 6])}
      disabledSlots={disabledSlots}
      allCards={cards}
      blockedCards={blockedCards}
      onCardChange={onCardChange}
    />
  );
}

// ── Stud range text input ─────────────────────────────────────────────────────

const STUD_PAIR_RANKS = [
  Rank.Two, Rank.Three, Rank.Four, Rank.Five, Rank.Six, Rank.Seven,
  Rank.Eight, Rank.Nine, Rank.Ten, Rank.Jack, Rank.Queen, Rank.King, Rank.Ace,
];
const STUD_HIGH_RANKS = [Rank.Ace, Rank.King, Rank.Queen, Rank.Jack, Rank.Ten, Rank.Nine, Rank.Eight];
const STUD_SUITED_SUITS = [Suit.Spades, Suit.Hearts, Suit.Diamonds, Suit.Clubs];

function StudRangeInput({
  pattern,
  onChange,
}: {
  pattern: string;
  onChange: (p: string | null) => void;
}) {
  const { suitColors } = useDeckColor();
  const trimmed = pattern.trim();
  const parsed = trimmed ? parseStudRange(pattern) : null;
  const isValid = !trimmed || parsed !== null;
  const description = parsed ? describeStudRange(parsed) : null;
  const comboCount = parsed ? countRangeCombinations(parsed) : null;

  function append(token: string) {
    const current = pattern.trim();
    onChange(current ? `${current}, ${token}` : token);
  }

  const chipCls = "text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border border-border/60 bg-muted/30 hover:bg-muted hover:border-border transition-colors cursor-pointer";

  return (
    <div className="space-y-2 pt-2 border-t border-border/40">
      {/* Text input row */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0">Range</span>
        <input
          type="text"
          value={pattern}
          onChange={e => onChange(e.target.value || null)}
          placeholder='ex: 22+, A*, ss'
          spellCheck={false}
          className={cn(
            "flex-1 text-sm font-mono border rounded-lg px-3 py-1 bg-background focus:outline-none focus:ring-2 transition-colors",
            isValid
              ? "border-border focus:ring-primary/30"
              : "border-destructive focus:ring-destructive/30 text-destructive"
          )}
        />
        {trimmed && (
          <button
            onClick={() => onChange("")}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Limpar range"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {!isValid && (
        <p className="text-[10px] text-destructive">Padrão inválido — verifique a sintaxe</p>
      )}
      {parsed && (description || comboCount !== null) && (
        <div className="flex items-center justify-between gap-2 px-0.5">
          {description && (
            <span className="text-[10px] text-muted-foreground italic truncate">{description}</span>
          )}
          {comboCount !== null && (
            <span className="text-[10px] font-semibold tabular-nums text-muted-foreground whitespace-nowrap ml-auto">
              {comboCount >= MAX_COMBO_COUNT ? "2M+" : comboCount.toLocaleString("pt-BR")} combos
            </span>
          )}
        </div>
      )}

      {/* ── Quick helpers ── */}
      <div className="space-y-1.5">
        {/* Pair ranges */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-muted-foreground w-7 shrink-0">Par:</span>
          {STUD_PAIR_RANKS.map(rank => (
            <button
              key={rank}
              onClick={() => append(`${RANK_LABELS[rank]}${RANK_LABELS[rank]}+`)}
              className={chipCls}
              title={`Par de ${RANK_LABELS[rank]}s ou melhor`}
            >
              {RANK_LABELS[rank]}+
            </button>
          ))}
        </div>

        {/* Suited hole cards */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground w-7 shrink-0">Suit:</span>
          {STUD_SUITED_SUITS.map(suit => (
            <button
              key={suit}
              onClick={() => append(`${suit}${suit}`)}
              className={cn(chipCls, suitColors[suit])}
              title={`Ambas hole cards ${SUIT_SYMBOLS[suit]}`}
            >
              {SUIT_SYMBOLS[suit]}{SUIT_SYMBOLS[suit]}
            </button>
          ))}
        </div>

        {/* High card + any */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-muted-foreground w-7 shrink-0">X*:</span>
          {STUD_HIGH_RANKS.map(rank => (
            <button
              key={rank}
              onClick={() => append(`${RANK_LABELS[rank]}*`)}
              className={chipCls}
              title={`${RANK_LABELS[rank]} no hole + qualquer`}
            >
              {RANK_LABELS[rank]}*
            </button>
          ))}
        </div>
      </div>

      {/* Collapsible syntax help */}
      <details>
        <summary className="text-[10px] text-muted-foreground cursor-pointer list-none underline decoration-dotted w-fit">
          Sintaxe avançada
        </summary>
        <p className="text-[10px] text-muted-foreground leading-relaxed mt-1">
          <span className="font-mono">*</span> qualquer ·{" "}
          <span className="font-mono">R O N</span> var. valor ·{" "}
          <span className="font-mono">w x y z</span> var. naipe ·{" "}
          <span className="font-mono">As Kh</span> carta específica ·{" "}
          <span className="font-mono">$B $L $Z</span> macros ·{" "}
          <span className="font-mono">|</span> streets ·{" "}
          <span className="font-mono">,</span> alternativas
        </p>
      </details>
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

// ── Range builder ──────────────────────────────────────────────────────────────

function RangeBuilder({
  range,
  playerIdx,
  onChange,
}: {
  range: RangeEntry[];
  playerIdx: number;
  onChange: (range: RangeEntry[] | null) => void;
}) {
  function addEntry() {
    onChange([...range, { ...DEFAULT_RANGE_ENTRY }]);
  }

  function updateEntry(i: number, entry: RangeEntry) {
    const next = [...range];
    next[i] = entry;
    onChange(next);
  }

  function removeEntry(i: number) {
    onChange(range.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
        Range de mãos
      </p>
      {range.map((entry, i) => (
        <RangeEntryRow
          key={i}
          entry={entry}
          onChange={(e) => updateEntry(i, e)}
          onRemove={() => removeEntry(i)}
          canRemove={range.length > 1}
        />
      ))}
      {range.length === 0 && (
        <p className="text-xs text-muted-foreground italic">Nenhuma categoria adicionada.</p>
      )}
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addEntry}>
        <Plus className="h-3 w-3 mr-1" />
        Adicionar categoria
      </Button>
    </div>
  );
}

function RangeEntryRow({
  entry,
  onChange,
  onRemove,
  canRemove,
}: {
  entry: RangeEntry;
  onChange: (entry: RangeEntry) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const keepCount = CATEGORY_KEEP_COUNT[entry.category];
  const label = rangeEntryLabel(entry);

  function handleCategoryChange(cat: HandCategory) {
    onChange({ ...entry, category: cat });
  }

  function handleRank1Change(rank: number) {
    const newRank2 = entry.rank2 >= rank ? Math.max(2, rank - 1) : entry.rank2;
    onChange({ ...entry, rank1: rank, rank2: newRank2 });
  }

  function handleRank2Change(rank: number) {
    onChange({ ...entry, rank2: rank });
  }

  const rank2Options = RANGE_RANK_OPTIONS.filter((r) => r < entry.rank1);

  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <select
        value={entry.category}
        onChange={(e) => handleCategoryChange(e.target.value as HandCategory)}
        className="border rounded px-1.5 py-1 bg-background text-xs font-medium cursor-pointer focus:outline-none"
      >
        {HAND_CATEGORIES.map((cat) => (
          <option key={cat} value={cat}>{CATEGORY_SHORT[cat]}</option>
        ))}
      </select>

      {keepCount >= 1 && (
        <>
          <span className="text-muted-foreground">top:</span>
          <select
            value={entry.rank1}
            onChange={(e) => handleRank1Change(Number(e.target.value))}
            className="border rounded px-1.5 py-1 bg-background text-xs font-medium cursor-pointer focus:outline-none"
          >
            {RANGE_RANK_OPTIONS.map((r) => (
              <option key={r} value={r}>{RANK_LABELS[r as Rank]}</option>
            ))}
          </select>
        </>
      )}

      {keepCount >= 2 && rank2Options.length > 0 && (
        <>
          <span className="text-muted-foreground">2ª:</span>
          <select
            value={rank2Options.includes(entry.rank2) ? entry.rank2 : rank2Options[0]}
            onChange={(e) => handleRank2Change(Number(e.target.value))}
            className="border rounded px-1.5 py-1 bg-background text-xs font-medium cursor-pointer focus:outline-none"
          >
            {rank2Options.map((r) => (
              <option key={r} value={r}>{RANK_LABELS[r as Rank]}</option>
            ))}
          </select>
        </>
      )}

      <span className="font-mono font-bold text-foreground">{label}</span>

      {canRemove && (
        <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground" onClick={onRemove}>
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
