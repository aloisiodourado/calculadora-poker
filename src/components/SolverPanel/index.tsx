"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { Card, Rank, RANKS, SUITS } from "@/engine/cards";
import type { Street, Position, BetAction, DrawCount, BlockerBin, Position6Max } from "@/solver/game/types";
import { infoSetKey, drawInfoSetKey } from "@/solver/game/types";
import { ALL_POSITIONS_6MAX, OPENING_PCT } from "@/solver/game/ranges";
import type { PreflopScenario } from "@/solver/game/preflop";
import { ALL_PREFLOP_SCENARIOS, PREFLOP_SCENARIO_LABELS } from "@/solver/game/preflop";
import type { Position3Way } from "@/solver/game/types3way";
import { infoSetKey3Way, drawInfoSetKey3Way } from "@/solver/game/types3way";
import {
  validBetActions,
  applyBetAction,
  initialBettingState,
  firstToAct,
  type BettingState,
} from "@/solver/game/rules";
import { createTables, initSolver, runIterations } from "@/solver/cfr/trainer";
import type { SolverTables } from "@/solver/cfr/trainer";
import { handToBucket, NUM_BUCKETS, initBucketsFromThresholds, isDrawDecisionBucket, blockerBinForHand } from "@/solver/abstraction/handBuckets";
import type { StrategyTable, DrawStrategyTable } from "@/solver/game/types";
import { averageStrategy, averageDrawStrategy } from "@/solver/cfr/strategy";
import { Button } from "@/components/ui/button";
import { Loader2, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeckColor } from "@/contexts/DeckColorContext";
import { RANK_LABELS, SUIT_SYMBOLS } from "@/components/CardPicker";

// ── Constants ──────────────────────────────────────────────────────────────────

const TRAIN_ITERATIONS = 30_000;
const BUCKET_SAMPLES = 20_000;
const TRANSITION_SAMPLES = 200;
const HAND_SIZE = 5;

const DISPLAY_SUITS = [SUITS[0], SUITS[2], SUITS[1], SUITS[3]] as typeof SUITS; // ♠♥♦♣

const STREET_LABELS: Record<Street, string> = {
  0: "Pré-draw (antes do 1º descarte)",
  1: "1ª rodada (após draw 1)",
  2: "2ª rodada (após draw 2)",
  3: "Showdown (após draw 3)",
};

const ACTION_PT: Record<BetAction, string> = {
  fold:  "Fold (desistir)",
  check: "Check (passar)",
  call:  "Call (pagar)",
  bet:   "Bet (apostar)",
  raise: "Raise (re-apostar)",
};

const ACTION_SHORT: Record<BetAction, string> = {
  fold: "Fold", check: "Check", call: "Call", bet: "Bet", raise: "Raise",
};

const DRAW_PT: Record<number, string> = {
  0: "Ficar (não descartar)",
  1: "Descartar 1",
  2: "Descartar 2",
  3: "Descartar 3",
  4: "Descartar 4",
  5: "Descartar 5",
};

type Phase = "idle" | "loading" | "initializing" | "training" | "ready";

interface StreetRecord {
  street: Street;
  bettingSeq: BetAction[];
  heroDraw: DrawCount;
  villainDraw: DrawCount;
}

// ── Static strategy loading ────────────────────────────────────────────────────

interface ExportedStrategy {
  keyVersion?: string;
  iterations: number;
  bucketThresholds?: number[][];
  bet: [string, { actions: string[]; probs: number[] }][];
  draw: [string, number[]][];
}

const CURRENT_KEY_VERSION = "v7";

function tablesFromExport(data: ExportedStrategy): SolverTables {
  if (data.keyVersion && data.keyVersion !== CURRENT_KEY_VERSION) {
    console.warn(`Solver JSON keyVersion "${data.keyVersion}" may be incompatible with current "${CURRENT_KEY_VERSION}". Strategies may be incorrect.`);
  }

  const bet: StrategyTable = new Map();
  const draw: DrawStrategyTable = new Map();

  if (data.bucketThresholds) {
    initBucketsFromThresholds(data.bucketThresholds);
  }

  for (const [key, { actions, probs }] of data.bet) {
    bet.set(key, {
      actions: actions as BetAction[],
      regretSum: new Array(actions.length).fill(0),
      strategySum: probs.map((p) => p * data.iterations),
    });
  }

  for (const [key, probs] of data.draw) {
    draw.set(key, {
      probabilities: probs,
      regretSum: new Array(probs.length).fill(0),
      strategySum: probs.map((p) => p * data.iterations),
    });
  }

  return { bet, draw, iterations: data.iterations };
}

// ── Optimal draw heuristic ─────────────────────────────────────────────────────

interface DrawAdvice {
  drawCount: number;
  keepCards: Card[];
  discardCards: Card[];
  patBluff?: boolean;
  straightBreak?: boolean; // true when a consecutive run was broken to open more outs
}

// True when the 5-card hand qualifies as a "made low" in 2-7:
// no pairs, no flush, no straight, and highest card ≤ Jack (rank 11).
function isMadeLow(cards: Card[], maxRank = 11): boolean {
  if (cards.length !== 5) return false;
  const ranks = cards.map((c) => c.rank);
  if (ranks.some((r) => r > maxRank)) return false;
  if (new Set(ranks).size !== 5) return false; // pair
  if (new Set(cards.map((c) => c.suit)).size === 1) return false; // flush
  const sorted = [...ranks].sort((a, b) => a - b);
  if (sorted.every((r, i) => i === 0 || r === sorted[i - 1] + 1)) return false; // straight
  return true;
}

// Returns the optimal draw recommendation.
// When villainDraw is provided (in-position draw decision), considers standing
// pat with weak made-low hands to exploit the opponent's drawing disadvantage.
function optimalDraw(
  hand: (Card | null)[],
  villainDraw?: DrawCount,
): DrawAdvice | null {
  const full = hand.filter(Boolean) as Card[];
  if (full.length < 5) return null;

  // Pat bluff: if villain drew cards and hero holds a made J-low or better,
  // standing pat is strategically superior to drawing.
  if (villainDraw !== undefined && villainDraw >= 1) {
    const highCard = Math.max(...full.map((c) => c.rank));
    // J-low or better vs any draw, Q-low vs draw-2+
    const patThreshold = villainDraw >= 2 ? 12 : 11;
    if (isMadeLow(full, patThreshold)) {
      return { drawCount: 0, keepCards: full, discardCards: [], patBluff: highCard >= 10 };
    }
  }

  // Base heuristic: keep unique low-rank cards (≤ 9), discard everything else.
  // One copy of a paired rank IS kept — e.g. 2-2-3-4-K keeps one 2, 3, 4.
  const seenRanks = new Set<Rank>();
  const keepCards: Card[] = [];
  for (const c of [...full].sort((a, b) => a.rank - b.rank)) {
    if (c.rank <= Rank.Nine && !seenRanks.has(c.rank) && keepCards.length < 5) {
      keepCards.push(c);
      seenRanks.add(c.rank);
    }
  }

  // Straight-break: if all 4 kept cards are consecutive (e.g. 5-6-7-8), drawing 1
  // is nearly useless — only 2 outs (ranks just below or just above the run) avoid
  // straights, while 4 destroy the hand. Break the run by dropping the
  // second-highest kept card, opening up a full-gap hand (e.g. keep 5-6-8).
  if (keepCards.length === 4) {
    const keptRanks = keepCards.map((c) => c.rank).sort((a, b) => a - b);
    const allConsecutive = keptRanks.every((r, i) => i === 0 || r === keptRanks[i - 1] + 1);
    if (allConsecutive) {
      // Remove the second-highest card (index 2 in ascending sort) to create a gap
      // that maximises non-straight drawing combinations.
      const rankToRemove = keptRanks[2];
      const cardToRemove = keepCards.find((c) => c.rank === rankToRemove)!;
      const newKeepCards = keepCards.filter((c) => c !== cardToRemove);
      const newKeepSet = new Set(newKeepCards.map((c) => `${c.rank}-${c.suit}`));
      const newDiscardCards = full.filter((c) => !newKeepSet.has(`${c.rank}-${c.suit}`));
      return {
        drawCount: newDiscardCards.length,
        keepCards: newKeepCards,
        discardCards: newDiscardCards,
        straightBreak: true,
      };
    }
  }

  const keepSet = new Set(keepCards.map((c) => `${c.rank}-${c.suit}`));
  const discardCards = full.filter((c) => !keepSet.has(`${c.rank}-${c.suit}`));

  return { drawCount: discardCards.length, keepCards, discardCards };
}

function bettingDone(seq: BetAction[], toCall: number): boolean {
  if (seq.length < 2 || toCall > 0) return false;
  const last = seq[seq.length - 1];
  return last === "check" || last === "call";
}

// ── Multi-slot hand picker ─────────────────────────────────────────────────────
// Inline card grid that appears below the slot row. Clicking any slot focuses
// it; selecting a card fills that slot and auto-advances to the next empty one.

function HandPicker({
  hand,
  onChange,
}: {
  hand: (Card | null)[];
  onChange: (idx: number, card: Card | null) => void;
}) {
  const { suitColors } = useDeckColor();
  const [picking, setPicking] = useState(false);
  const [activeSlot, setActiveSlot] = useState(0);

  const allSelected: Card[] = hand.filter(Boolean) as Card[];

  function isBlocked(card: Card): boolean {
    return allSelected.some(
      (c, si) => si !== activeSlot && c.rank === card.rank && c.suit === card.suit,
    );
  }

  function handleSlotClick(idx: number) {
    setActiveSlot(idx);
    setPicking(true);
  }

  function handleCardClick(card: Card) {
    if (isBlocked(card)) return;
    const current = hand[activeSlot];
    if (current?.rank === card.rank && current?.suit === card.suit) {
      onChange(activeSlot, null);
      return;
    }
    onChange(activeSlot, card);
    // Auto-advance to next empty slot
    const nextEmpty = hand.findIndex((c, i) => i > activeSlot && c === null)
      ?? hand.findIndex((c, i) => i !== activeSlot && c === null);
    const next = hand.findIndex((c, i) => i !== activeSlot && c === null);
    if (next !== -1) {
      setActiveSlot(next);
    } else {
      setPicking(false);
    }
  }

  function handleClearSlot(idx: number, e: React.MouseEvent) {
    e.stopPropagation();
    onChange(idx, null);
  }

  const activeCard = hand[activeSlot];

  return (
    <div className="space-y-3">
      {/* Slot row */}
      <div className="flex gap-2 flex-wrap">
        {hand.map((card, i) => (
          <button
            key={i}
            onClick={() => handleSlotClick(i)}
            className={cn(
              "relative h-20 w-14 rounded-xl border-2 flex flex-col items-center justify-center font-bold select-none transition-all gap-0.5",
              card
                ? "bg-white shadow-md dark:bg-zinc-800 border-transparent"
                : "border-dashed border-muted-foreground/30 bg-muted/20 hover:border-primary/50 hover:bg-primary/5",
              picking && activeSlot === i && "ring-2 ring-primary ring-offset-1",
            )}
            title={card ? "Clique para trocar" : "Clique para selecionar"}
          >
            {card ? (
              <>
                <span className={cn("text-2xl leading-none font-bold", suitColors[card.suit])}>
                  {RANK_LABELS[card.rank]}
                </span>
                <span className={cn("text-xl leading-none", suitColors[card.suit])}>
                  {SUIT_SYMBOLS[card.suit]}
                </span>
                <span
                  role="button"
                  aria-label="Remover"
                  tabIndex={0}
                  className="absolute -top-1.5 -right-1.5 bg-background border rounded-full p-0.5 hover:bg-destructive hover:text-destructive-foreground transition-colors cursor-pointer"
                  onClick={(e) => handleClearSlot(i, e)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onChange(i, null); } }}
                  title="Remover"
                >
                  <X className="h-2.5 w-2.5" />
                </span>
              </>
            ) : (
              <span className="text-base text-muted-foreground font-normal">{i + 1}</span>
            )}
          </button>
        ))}

        {/* Quick-clear all */}
        {hand.some(Boolean) && (
          <button
            onClick={() => { hand.forEach((_, i) => onChange(i, null)); setPicking(false); }}
            className="self-end text-xs text-muted-foreground hover:text-foreground pb-1"
          >
            Limpar tudo
          </button>
        )}
      </div>

      {/* Inline card grid */}
      {picking && (
        <div className="rounded-xl border bg-card p-3 space-y-2">
          {/* Slot tabs */}
          <div className="flex items-center gap-1 flex-wrap">
            {hand.map((card, i) => (
              <button
                key={i}
                onClick={() => setActiveSlot(i)}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-all",
                  activeSlot === i
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                {card ? (
                  <span className={suitColors[card.suit]}>
                    {RANK_LABELS[card.rank]}{SUIT_SYMBOLS[card.suit]}
                  </span>
                ) : (
                  `Carta ${i + 1}`
                )}
              </button>
            ))}
            <button
              onClick={() => setPicking(false)}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            >
              Fechar
            </button>
          </div>

          {/* Card grid — 4 suits × 13 ranks */}
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${RANKS.length}, 1fr)` }}
          >
            {DISPLAY_SUITS.map((suit) =>
              [...RANKS].reverse().map((rank) => {
                const card: Card = { rank, suit };
                const blocked = isBlocked(card);
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
                      !blocked && !isCurrent && "hover:bg-muted hover:scale-105 cursor-pointer",
                      !isCurrent && suitColors[suit],
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
  );
}

// ── Draw phase panel ───────────────────────────────────────────────────────────
// Shown after betting concludes on streets 0-2. Hero toggles which cards to
// discard (pre-filled by draw advice), picks the replacement cards received,
// and reports how many cards the villain drew. Confirming advances the street.

function DrawPhasePanel({
  hand,
  street,
  previousVillainDraw,
  onConfirm,
}: {
  hand: (Card | null)[];
  street: Street;
  previousVillainDraw?: DrawCount;
  onConfirm: (discardedIndices: number[], receivedCards: Card[], villainDraw: DrawCount) => void;
}) {
  const { suitColors } = useDeckColor();

  // Villain draw is asked FIRST so draw advice can incorporate it.
  const [villainDraw, setVillainDraw] = useState<DrawCount>(previousVillainDraw ?? 2);

  // Draw advice reacts to villainDraw — optimalDraw returns pat recommendation when appropriate.
  const drawAdvice = useMemo(() => optimalDraw(hand, villainDraw), [hand, villainDraw]);

  // Derive initial discards from drawAdvice; update whenever advice changes (e.g. villain draw changes).
  function discardSetFromAdvice(adv: DrawAdvice | null): Set<number> {
    if (!adv) return new Set();
    const keepKeys = new Set(adv.keepCards.map((c) => `${c.rank}-${c.suit}`));
    const s = new Set<number>();
    hand.forEach((c, i) => { if (c && !keepKeys.has(`${c.rank}-${c.suit}`)) s.add(i); });
    return s;
  }

  const [discardIdx, setDiscardIdx] = useState<Set<number>>(() => discardSetFromAdvice(drawAdvice));
  const [newCards, setNewCards] = useState<(Card | null)[]>([]);
  const [pickingSlot, setPickingSlot] = useState<number | null>(null);
  const [userOverride, setUserOverride] = useState(false);

  // When drawAdvice changes and user hasn't manually overridden, sync discards.
  useEffect(() => {
    if (userOverride) return;
    setDiscardIdx(discardSetFromAdvice(drawAdvice));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawAdvice]);

  const numDiscard = discardIdx.size;

  // Keep newCards array length in sync with numDiscard
  useEffect(() => {
    setNewCards((prev) => {
      const next: (Card | null)[] = Array(numDiscard).fill(null);
      prev.forEach((c, i) => { if (i < numDiscard) next[i] = c; });
      return next;
    });
    setPickingSlot(null);
  }, [numDiscard]);

  // Cards blocked in the new-card picker
  const keptCards = hand.filter((c, i): c is Card => !!c && !discardIdx.has(i));
  const keptKeys = new Set(keptCards.map((c) => `${c.rank}-${c.suit}`));
  const otherNewKeys = new Set(
    newCards.filter((c, i): c is Card => !!c && i !== pickingSlot).map((c) => `${c.rank}-${c.suit}`),
  );
  function isBlockedNew(card: Card) {
    return keptKeys.has(`${card.rank}-${card.suit}`) || otherNewKeys.has(`${card.rank}-${card.suit}`);
  }

  function toggleDiscard(i: number) {
    setUserOverride(true);
    setDiscardIdx((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  function pickNewCard(slot: number, card: Card) {
    setNewCards((prev) => prev.map((c, i) => (i === slot ? card : c)));
    const nextEmpty = newCards.findIndex((c, i) => i !== slot && !c);
    setPickingSlot(nextEmpty === -1 ? null : nextEmpty);
  }

  const canConfirm = numDiscard === 0 || newCards.every(Boolean);

  function handleConfirm() {
    onConfirm([...discardIdx], newCards.filter(Boolean) as Card[], villainDraw);
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Draw {street + 1} — informe as trocas
      </div>

      {/* Villain draw — FIRST, so draw advice can react */}
      <div className="flex items-center gap-3 pb-3 border-b">
        <label className="text-xs font-medium text-muted-foreground shrink-0">
          Quantas cartas o vilão descartou?
        </label>
        <select
          className="text-sm border rounded-md px-2 py-1.5 bg-background"
          value={villainDraw}
          onChange={(e) => { setVillainDraw(+e.target.value as DrawCount); setUserOverride(false); }}
        >
          {([0, 1, 2, 3, 4, 5] as DrawCount[]).map((n) => (
            <option key={n} value={n}>{n === 0 ? "0 (ficou pat)" : `${n} carta${n > 1 ? "s" : ""}`}</option>
          ))}
        </select>
      </div>

      {/* Draw advice banner — updates when villain draw changes */}
      {drawAdvice && (
        <div className={cn(
          "rounded-lg px-3 py-2 text-xs space-y-1",
          drawAdvice.patBluff
            ? "bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400"
            : drawAdvice.straightBreak
            ? "bg-orange-500/10 border border-orange-500/30 text-orange-700 dark:text-orange-400"
            : drawAdvice.drawCount === 0
            ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
            : "bg-muted/60 text-muted-foreground",
        )}>
          <div>
            {drawAdvice.drawCount === 0
              ? drawAdvice.patBluff
                ? `Pat estratégico — mão feita (${drawAdvice.keepCards.map(c => RANK_LABELS[c.rank]).join("-")}) é favorita contra draw-${villainDraw} do vilão`
                : "Stand pat — sua mão já está completa"
              : `Descartar ${drawAdvice.drawCount} carta${drawAdvice.drawCount > 1 ? "s" : ""} — manter ${drawAdvice.keepCards.map(c => RANK_LABELS[c.rank]).join("-")}`}
          </div>
          {drawAdvice.straightBreak && (
            <div className="opacity-80">
              4 cartas consecutivas detectadas — quebrado para evitar sequência e abrir mais outs
            </div>
          )}
        </div>
      )}

      {/* Hero hand — click to toggle discard */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Suas cartas — clique para marcar como descarte
        </p>
        <div className="flex gap-2 flex-wrap">
          {hand.map((card, i) => {
            if (!card) return null;
            const isDiscard = discardIdx.has(i);
            return (
              <button
                key={i}
                onClick={() => toggleDiscard(i)}
                className={cn(
                  "h-16 w-11 rounded-xl border-2 flex flex-col items-center justify-center font-bold gap-0.5 transition-all select-none",
                  isDiscard
                    ? "opacity-35 border-destructive/50 bg-destructive/5"
                    : "bg-white dark:bg-zinc-800 border-transparent shadow-md",
                )}
              >
                <span className={cn("text-lg leading-none", suitColors[card.suit])}>
                  {RANK_LABELS[card.rank]}
                </span>
                <span className={cn("text-base leading-none", suitColors[card.suit])}>
                  {SUIT_SYMBOLS[card.suit]}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {numDiscard === 0
            ? "Stand pat — não descarta nenhuma carta"
            : `Descartando ${numDiscard} carta${numDiscard > 1 ? "s" : ""}`}
        </p>
      </div>

      {/* New cards received */}
      {numDiscard > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Cartas que você recebeu — clique para selecionar
          </p>
          <div className="flex gap-2 flex-wrap">
            {newCards.map((card, slot) => (
              <button
                key={slot}
                onClick={() => setPickingSlot(pickingSlot === slot ? null : slot)}
                className={cn(
                  "h-16 w-11 rounded-xl border-2 flex flex-col items-center justify-center font-bold gap-0.5 transition-all",
                  card
                    ? "bg-white dark:bg-zinc-800 border-transparent shadow-md"
                    : "border-dashed border-muted-foreground/30 bg-muted/20 hover:border-primary/50",
                  pickingSlot === slot && "ring-2 ring-primary ring-offset-1",
                )}
              >
                {card ? (
                  <>
                    <span className={cn("text-lg leading-none", suitColors[card.suit])}>
                      {RANK_LABELS[card.rank]}
                    </span>
                    <span className={cn("text-base leading-none", suitColors[card.suit])}>
                      {SUIT_SYMBOLS[card.suit]}
                    </span>
                  </>
                ) : (
                  <span className="text-xl text-muted-foreground font-normal">?</span>
                )}
              </button>
            ))}
          </div>

          {pickingSlot !== null && (
            <div className="rounded-xl border bg-muted/20 p-2.5">
              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${RANKS.length}, 1fr)` }}
              >
                {DISPLAY_SUITS.map((suit) =>
                  [...RANKS].reverse().map((rank) => {
                    const card: Card = { rank, suit };
                    const blocked = isBlockedNew(card);
                    const isCurrent =
                      newCards[pickingSlot]?.rank === rank &&
                      newCards[pickingSlot]?.suit === suit;
                    return (
                      <button
                        key={`${rank}-${suit}`}
                        disabled={blocked}
                        onClick={() => pickNewCard(pickingSlot, card)}
                        className={cn(
                          "h-14 rounded-lg font-bold flex flex-col items-center justify-center leading-none transition-all gap-0.5",
                          blocked && "opacity-20 cursor-not-allowed",
                          isCurrent && "bg-primary text-primary-foreground scale-105 shadow-md",
                          !blocked && !isCurrent &&
                            cn("hover:bg-muted hover:scale-105 cursor-pointer", suitColors[suit]),
                        )}
                      >
                        <span className="text-sm font-bold">{RANK_LABELS[rank]}</span>
                        <span className="text-base leading-none">{SUIT_SYMBOLS[suit]}</span>
                      </button>
                    );
                  }),
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirm */}
      <div className="flex items-center gap-3 pt-2 border-t">
        <Button className="ml-auto" disabled={!canConfirm} onClick={handleConfirm}>
          Avançar →
        </Button>
      </div>
    </div>
  );
}

// ── Probability bar ────────────────────────────────────────────────────────────

function ProbBar({ label, prob, best }: { label: string; prob: number; best: boolean }) {
  const pct = Math.round(prob * 100);
  return (
    <div className={cn("rounded-lg px-3 py-2 flex items-center gap-3", best ? "bg-emerald-500/10 border border-emerald-500/30" : "bg-muted/50")}>
      <div className="flex-1 min-w-0">
        <div className={cn("text-sm font-medium", best && "text-emerald-700 dark:text-emerald-400")}>
          {label}
        </div>
        <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full", best ? "bg-emerald-500" : "bg-muted-foreground/40")}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className={cn("tabular-nums font-semibold text-sm shrink-0", best ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
        {pct}%
      </span>
    </div>
  );
}

// ── Hand Timeline ──────────────────────────────────────────────────────────────

const STREET_SHORT: Record<Street, string> = {
  0: "Pré-draw", 1: "1ª rodada", 2: "2ª rodada", 3: "3ª rodada",
};

function HandTimeline({
  history,
  currentStreet,
  currentBetSeq,
  position,
}: {
  history: StreetRecord[];
  currentStreet: Street;
  currentBetSeq: BetAction[];
  position: Position;
}) {
  if (history.length === 0 && currentBetSeq.length === 0) return null;

  return (
    <div className="rounded-xl border bg-card p-4 space-y-0">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
        Linha do tempo da mão
      </div>
      <div className="space-y-0">
        {history.map((record, idx) => {
          const firstActor = firstToAct(record.street);
          return (
            <div key={idx}>
              {/* Betting phase */}
              <div className="flex items-start gap-2 py-2">
                <div className="flex items-center gap-1.5 shrink-0 w-20">
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" />
                  <span className="text-xs text-muted-foreground font-medium">{STREET_SHORT[record.street]}</span>
                </div>
                <div className="flex flex-wrap gap-1 flex-1">
                  {record.bettingSeq.length === 0 ? (
                    <span className="text-xs text-muted-foreground italic">sem apostas</span>
                  ) : (
                    record.bettingSeq.map((a, i) => {
                      const actor = ((firstActor + i) % 2) as Position;
                      const isMe = actor === position;
                      return (
                        <span key={i} className={cn(
                          "text-xs px-1.5 py-0.5 rounded font-medium",
                          isMe ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                        )}>
                          {isMe ? "V" : "O"}: {ACTION_SHORT[a]}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>
              {/* Draw connector */}
              <div className="flex items-center gap-2 pl-2 py-1">
                <div className="w-px h-4 bg-border ml-[3px]" />
                <div className="ml-1 flex items-center gap-3 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
                  <span>
                    <span className="font-medium text-foreground">Draw {idx + 1}</span>
                    {" · "}Você: {record.heroDraw === 0 ? "pat" : `-${record.heroDraw}`}
                    {" · "}Vilão: {record.villainDraw === 0 ? "pat" : `-${record.villainDraw}`}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Current street — in progress */}
        <div className="flex items-start gap-2 py-2">
          <div className="flex items-center gap-1.5 shrink-0 w-20">
            <div className="w-2 h-2 rounded-full bg-primary shrink-0 ring-2 ring-primary/30" />
            <span className="text-xs text-primary font-semibold">{STREET_SHORT[currentStreet]}</span>
          </div>
          <div className="flex flex-wrap gap-1 flex-1 items-center">
            {currentBetSeq.length === 0 ? (
              <span className="text-xs text-muted-foreground italic">em andamento…</span>
            ) : (
              currentBetSeq.map((a, i) => {
                const actor = ((firstToAct(currentStreet) + i) % 2) as Position;
                const isMe = actor === position;
                return (
                  <span key={i} className={cn(
                    "text-xs px-1.5 py-0.5 rounded font-medium",
                    isMe ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                  )}>
                    {isMe ? "V" : "O"}: {ACTION_SHORT[a]}
                  </span>
                );
              })
            )}
            <span className="text-xs text-muted-foreground italic ml-1">← em andamento</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SolverPanel() {
  const { suitColors } = useDeckColor();
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [tables, setTables] = useState<SolverTables | null>(null);
  const [infosetCount, setInfosetCount] = useState(0);

  const [hand, setHand] = useState<(Card | null)[]>(Array(HAND_SIZE).fill(null));
  const [position, setPosition] = useState<Position>(0);
  const [street, setStreet] = useState<Street>(0);
  const [opponentDraws, setOpponentDraws] = useState<[DrawCount, DrawCount, DrawCount]>([2, 2, 2]);

  const [betSeq, setBetSeq] = useState<BetAction[]>([]);
  const [betState, setBetState] = useState<BettingState>(initialBettingState(0));
  const [history, setHistory] = useState<StreetRecord[]>([]);

  // Hero's 6-max seat — determines HU acting order (non-BB = position 0, BB = position 1).
  const [heroPosition6Max, setHeroPosition6Max] = useState<Position6Max>("BTN");

  // Villain's 6-max opening position — encodes their preflop range signal.
  const [villainPosition, setVillainPosition] = useState<Position6Max>("BB");

  // Preflop scenario: SR (single raise), 3B (3-bet pot), LP (limp pot).
  const [preflopScenario, setPreflopScenario] = useState<PreflopScenario>("SR");

  // 3-way mode: second villain (BB when hero is BTN) and hero's structural role.
  const [solverMode, setSolverMode] = useState<"hu" | "3way">("hu");
  const [villain2Position, setVillain2Position] = useState<Position6Max>("BB");
  // In 3-way mode, heroPosition3Way is their structural seat (0=BTN, 1=SB, 2=BB).
  const [heroPosition3Way, setHeroPosition3Way] = useState<Position3Way>(0);

  // UI wizard phase: setup → hand → playing
  const [uiPhase, setUiPhase] = useState<"setup" | "hand" | "playing">("setup");

  // ── Training ───────────────────────────────────────────────────────────────

  const handleTrain = useCallback(async () => {
    // 1. Try to load pre-trained JSON from public folder
    setPhase("loading");
    try {
      const res = await fetch("/solver-strategy.json");
      if (res.ok) {
        const data = (await res.json()) as ExportedStrategy;
        const t = tablesFromExport(data);
        setTables(t);
        setInfosetCount(t.bet.size + t.draw.size);
        setPhase("ready");
        return;
      }
    } catch {
      // fall through to browser training
    }

    // 2. Fallback: calibrate and train in the browser
    setProgress(0);
    await new Promise<void>((r) => setTimeout(r, 30));
    initSolver(BUCKET_SAMPLES, TRANSITION_SAMPLES);
    setPhase("training");
    const t = createTables();
    await runIterations(t, TRAIN_ITERATIONS, {
      progressEvery: 2_000,
      yieldEvery: 1_000,
      onProgress: ({ iterations }) =>
        setProgress(Math.round((iterations / TRAIN_ITERATIONS) * 100)),
    });
    setTables(t);
    setInfosetCount(t.bet.size + t.draw.size);
    setPhase("ready");
    setProgress(100);
  }, []);

  // ── Derived state ──────────────────────────────────────────────────────────

  const selectedCards = useMemo(() => hand.filter(Boolean) as Card[], [hand]);
  const handComplete = selectedCards.length === HAND_SIZE;

  const bucket = useMemo(
    () => (handComplete ? handToBucket(selectedCards) : null),
    [selectedCards, handComplete],
  );

  const myBlockerBin = useMemo(
    () => (handComplete ? blockerBinForHand(selectedCards) : 0 as BlockerBin),
    [selectedCards, handComplete],
  );

  const currentActor = useMemo(
    () => ((firstToAct(street) + betSeq.length) % 2) as Position,
    [street, betSeq.length],
  );

  const isMyTurn = currentActor === position;
  const roundDone = useMemo(() => bettingDone(betSeq, betState.toCall), [betSeq, betState.toCall]);
  const currentActions = useMemo(
    () => (roundDone ? [] : validBetActions(betState, street)),
    [betState, street, roundDone],
  );

  const betStrategy = useMemo(() => {
    if (!tables || bucket === null || !isMyTurn || roundDone) return null;

    const key = solverMode === "3way"
      ? infoSetKey3Way(
          street, heroPosition3Way, bucket, myBlockerBin,
          // 3-way draw history: per-player draws (all zeros if no history yet)
          opponentDraws.slice(0, street).map(d => [d, d, d] as [DrawCount, DrawCount, DrawCount]),
          betSeq.map((a, i) => `${i % 3}:${a}`),
          ["BTN", villainPosition, villain2Position] as [Position6Max, Position6Max, Position6Max],
          preflopScenario,
        )
      : infoSetKey({
          street,
          position,
          myBucket: bucket,
          myBlockerBin,
          opponentDrawHistory: opponentDraws.slice(0, street) as DrawCount[],
          bettingSequence: betSeq,
          villainPosition,
          preflopScenario,
        });

    const node = tables.bet.get(key);
    if (!node) return null;
    const probs = averageStrategy(node);
    return node.actions
      .map((a, i) => ({ action: a as BetAction, prob: probs[i] }))
      .sort((a, b) => b.prob - a.prob);
  }, [tables, bucket, myBlockerBin, position, street, isMyTurn, betSeq, roundDone, opponentDraws, villainPosition, villain2Position, preflopScenario, solverMode, heroPosition3Way]);

  // Draw recommendation is deterministic — no CFR needed.
  const drawAdvice = useMemo(
    () => (street < 3 ? optimalDraw(hand) : null),
    [hand, street],
  );

  const drawStrategy = useMemo(
    () => (drawAdvice ? [{ drawCount: drawAdvice.drawCount, prob: 1.0 }] : null),
    [drawAdvice],
  );
  const bestDrawProb = 1.0;

  // CFR-learned draw strategy: [draw_prob, pat_prob] for decision buckets.
  const cfrDrawStrategy = useMemo(() => {
    if (!tables || bucket === null || street >= 3 || !handComplete) return null;
    if (!isDrawDecisionBucket(bucket, myBlockerBin)) return null;

    const key = solverMode === "3way"
      ? drawInfoSetKey3Way(
          street as Street, heroPosition3Way, bucket, myBlockerBin,
          opponentDraws.slice(0, street).map(d => [d, d, d] as [DrawCount, DrawCount, DrawCount]),
          betSeq.map((a, i) => `${i % 3}:${a}`),
          ["BTN", villainPosition, villain2Position] as [Position6Max, Position6Max, Position6Max],
          preflopScenario,
        )
      : drawInfoSetKey(
          street as Street,
          position,
          bucket,
          myBlockerBin,
          opponentDraws.slice(0, street) as DrawCount[],
          betSeq,
          villainPosition,
          preflopScenario,
        );

    const node = tables.draw.get(key);
    if (!node) return null;
    return averageDrawStrategy(node);
  }, [tables, bucket, myBlockerBin, street, position, handComplete, opponentDraws, villainPosition, villain2Position, preflopScenario, solverMode, heroPosition3Way]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function updateHand(idx: number, card: Card | null) {
    setHand((prev) => prev.map((c, i) => (i === idx ? card : c)));
  }

  function handleStreetChange(s: Street) {
    setStreet(s);
    setBetSeq([]);
    setBetState(initialBettingState(s));
  }

  function handlePositionChange(p: Position) {
    setPosition(p);
    setBetSeq([]);
    setBetState(initialBettingState(street));
  }

  function handleHeroPosition6MaxChange(pos: Position6Max) {
    setHeroPosition6Max(pos);
    handlePositionChange(pos === "BB" ? 1 : 0);
  }

  function pushAction(action: BetAction) {
    const newBet = action === "fold" ? betState : applyBetAction(betState, action, street);
    setBetSeq((prev) => [...prev, action]);
    setBetState(newBet);
  }

  function resetBetting() {
    setBetSeq([]);
    setBetState(initialBettingState(street));
  }

  function truncateBetSeq(upToIndex: number) {
    const newSeq = betSeq.slice(0, upToIndex);
    let state = initialBettingState(street);
    for (const action of newSeq) {
      if (action !== "fold") state = applyBetAction(state, action, street);
    }
    setBetSeq(newSeq);
    setBetState(state);
  }

  function handleDrawConfirm(discardedIndices: number[], receivedCards: Card[], villainDraw: DrawCount) {
    const heroDraw = discardedIndices.length as DrawCount;

    // Record this completed street before advancing
    setHistory((prev) => [...prev, {
      street,
      bettingSeq: betSeq,
      heroDraw,
      villainDraw,
    }]);

    // Replace discarded slots with received cards, keeping order
    let ri = 0;
    const newHand = hand.map((c, i) =>
      discardedIndices.includes(i) ? (receivedCards[ri++] ?? null) : c,
    );
    setHand(newHand);

    // Record villain's draw count for this round (street is always < 3 here)
    setOpponentDraws((prev) => {
      const next = [...prev] as [DrawCount, DrawCount, DrawCount];
      next[street as 0 | 1 | 2] = villainDraw;
      return next;
    });

    // Advance to next street
    const nextStreet = (street + 1) as Street;
    setStreet(nextStreet);
    setBetSeq([]);
    setBetState(initialBettingState(nextStreet));
  }

  function handleFullReset() {
    setHand(Array(HAND_SIZE).fill(null));
    setStreet(0);
    setBetSeq([]);
    setBetState(initialBettingState(0));
    setOpponentDraws([2, 2, 2]);
    setHistory([]);
    setUiPhase("hand");
  }

  const bestBetProb = betStrategy ? betStrategy[0].prob : 0;

  // Warn when solver recommends check but the hand is a made low that would stand pat.
  // Check → pat reveals the pattern: villain decodes "checked, then stood pat = weak made hand."
  // The correct GTO line with a made low facing a drawing villain is usually to bet.
  const checkAndPatWarning = useMemo(() => {
    if (!betStrategy || betStrategy[0]?.action !== "check") return false;
    if (!handComplete || street === 3) return false;
    const full = hand.filter(Boolean) as Card[];
    return isMadeLow(full, Rank.Jack); // J-low or better qualifies
  }, [betStrategy, hand, handComplete, street]);

  // ── Render: não-ready ─────────────────────────────────────────────────────

  if (phase !== "ready") {
    const busy = phase !== "idle";
    return (
      <div className="rounded-xl border bg-card p-6 space-y-5 max-w-lg">
        <div>
          <h2 className="font-semibold">Solver GTO — 2-7 Triple Draw</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Carrega estratégia pré-treinada (se disponível) ou treina no browser como fallback.
          </p>
        </div>

        <ol className="space-y-2 text-sm">
          {[
            <>Clique em <strong className="text-foreground">Inicializar</strong> — carrega o JSON pré-treinado ou treina CFR+ no browser</>,
            <>Insira sua mão (5 cartas) e selecione posição e rodada</>,
            <>Veja a recomendação GTO de aposta e de draw</>,
          ].map((text, i) => (
            <li key={i} className="flex gap-2 text-muted-foreground">
              <span className={cn(
                "shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold",
                i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}>{i + 1}</span>
              {text}
            </li>
          ))}
        </ol>

        {!busy && (
          <Button onClick={handleTrain}>Inicializar Solver</Button>
        )}

        {busy && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              {phase === "loading" && "Carregando estratégia pré-treinada…"}
              {phase === "initializing" && "Calibrando buckets e matriz de transição…"}
              {phase === "training" && `Treinando CFR+ no browser… ${progress}%`}
            </div>
            {(phase === "initializing" || phase === "training") && (
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: phase === "initializing" ? "3%" : `${progress}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Render: ready — setup phase ───────────────────────────────────────────

  if (uiPhase === "setup") {
    return (
      <div className="space-y-4 max-w-lg">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-semibold text-sm">Solver GTO — 2-7 Triple Draw FL</span>
            <span className="ml-2 text-xs text-muted-foreground">{infosetCount.toLocaleString()} infosets</span>
          </div>
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => { setPhase("idle"); setTables(null); }}>
            Recarregar
          </Button>
        </div>

        <div className="rounded-xl border bg-card p-5 space-y-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Passo 1 — Configuração</span>
            <div className="flex rounded-md border overflow-hidden text-xs">
              {(["hu", "3way"] as const).map(mode => (
                <button key={mode} onClick={() => setSolverMode(mode)}
                  className={cn("px-2.5 py-1 font-medium transition-colors",
                    solverMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
                  {mode === "hu" ? "Heads-up" : "3-way"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Sua posição</label>
              <select className="block w-full text-sm border rounded-md px-2 py-1.5 bg-background"
                value={heroPosition6Max} onChange={(e) => handleHeroPosition6MaxChange(e.target.value as Position6Max)}>
                {ALL_POSITIONS_6MAX.map((pos) => <option key={pos} value={pos}>{pos}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Posição do vilão <span className="opacity-60">(range)</span></label>
              <select className="block w-full text-sm border rounded-md px-2 py-1.5 bg-background"
                value={villainPosition} onChange={(e) => setVillainPosition(e.target.value as Position6Max)}>
                {ALL_POSITIONS_6MAX.map((pos) => <option key={pos} value={pos}>{pos} (~{Math.round(OPENING_PCT[pos] * 100)}%)</option>)}
              </select>
            </div>

            {solverMode === "3way" && (
              <>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Posição estrutural (3-way)</label>
                  <select className="block w-full text-sm border rounded-md px-2 py-1.5 bg-background"
                    value={heroPosition3Way} onChange={e => setHeroPosition3Way(+e.target.value as Position3Way)}>
                    <option value={0}>BTN (dealer)</option>
                    <option value={1}>SB</option>
                    <option value={2}>BB</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Range do 2º vilão</label>
                  <select className="block w-full text-sm border rounded-md px-2 py-1.5 bg-background"
                    value={villain2Position} onChange={e => setVillain2Position(e.target.value as Position6Max)}>
                    {ALL_POSITIONS_6MAX.map(pos => <option key={pos} value={pos}>{pos} (~{Math.round(OPENING_PCT[pos] * 100)}%)</option>)}
                  </select>
                </div>
              </>
            )}

          </div>

          <Button className="w-full" onClick={() => setUiPhase("hand")}>Próximo: inserir mão →</Button>
        </div>
      </div>
    );
  }

  // ── Render: ready — hand entry phase ────────────────────────────────────────

  if (uiPhase === "hand") {
    return (
      <div className="space-y-4 max-w-lg">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <button onClick={() => setUiPhase("setup")} className="hover:text-foreground">← Configuração</button>
          <span>·</span>
          <span className="font-medium text-foreground">{heroPosition6Max}</span>
          <span>vs</span>
          <span className="font-medium text-foreground">{villainPosition}</span>
          <span>·</span>
        </div>

        <div className="rounded-xl border bg-card p-5 space-y-4">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Passo 2 — Sua mão inicial</span>
          <HandPicker hand={hand} onChange={updateHand} />
          {bucket !== null ? (
            <p className="text-xs text-muted-foreground">
              Bucket <span className="font-semibold text-foreground">{bucket + 1}</span>/{NUM_BUCKETS}
              {" · "}{bucket < 4 ? "excelente" : bucket < 8 ? "boa" : bucket < 13 ? "mediana" : bucket < 17 ? "fraca" : "muito fraca"}
              {myBlockerBin > 0 && (
                <span className={cn("ml-2 font-medium", myBlockerBin === 2 ? "text-violet-600 dark:text-violet-400" : "text-blue-600 dark:text-blue-400")}>
                  · blocker {myBlockerBin === 2 ? "forte" : "moderado"}
                </span>
              )}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground italic">Selecione as 5 cartas para continuar.</p>
          )}
          <Button className="w-full" disabled={!handComplete} onClick={() => setUiPhase("playing")}>Iniciar mão →</Button>
        </div>
      </div>
    );
  }

  // ── Render: ready — playing phase ────────────────────────────────────────────

  return (
    <div className="space-y-3 max-w-2xl">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">2-7 Triple Draw FL</span>
          <span className="text-xs bg-muted px-2 py-0.5 rounded font-medium">{heroPosition6Max} vs {villainPosition}</span>
          <span className="text-xs text-muted-foreground">{STREET_LABELS[street]}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="text-xs h-7" onClick={handleFullReset}>Nova mão</Button>
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setUiPhase("setup")}>Reconfigurar</Button>
        </div>
      </div>

      {/* Compact hand + preflop scenario */}
      <div className="rounded-xl border bg-card px-4 py-3 space-y-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground shrink-0">Sua mão</span>
          <div className="flex gap-2">
            {hand.map((card, i) => card ? (
              <span key={i} className={cn("text-sm font-bold", suitColors[card.suit])}>
                {RANK_LABELS[card.rank]}{SUIT_SYMBOLS[card.suit]}
              </span>
            ) : null)}
          </div>
          {bucket !== null && (
            <span className="ml-auto text-xs text-muted-foreground">
              bucket {bucket + 1}/{NUM_BUCKETS} · {bucket < 4 ? "excelente" : bucket < 8 ? "boa" : bucket < 13 ? "mediana" : bucket < 17 ? "fraca" : "muito fraca"}
            </span>
          )}
        </div>
        {/* Preflop scenario — inline, always editable */}
        <div className="flex items-center gap-2 pt-1 border-t">
          <span className="text-xs text-muted-foreground shrink-0">Pot pré-flop:</span>
          <div className="flex gap-1">
            {ALL_PREFLOP_SCENARIOS.map(s => (
              <button key={s} onClick={() => setPreflopScenario(s)}
                className={cn(
                  "text-xs px-2 py-0.5 rounded border font-medium transition-colors",
                  preflopScenario === s
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}>
                {PREFLOP_SCENARIO_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <HandTimeline history={history} currentStreet={street} currentBetSeq={betSeq} position={position} />

      {/* Editable current-street sequence */}
      {betSeq.length > 0 && (
        <div className="rounded-xl border bg-card px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Ações desta rodada — clique para editar</span>
            <button onClick={resetBetting} className="text-xs text-muted-foreground hover:text-foreground">
              Limpar tudo
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {betSeq.map((action, i) => {
              const actor = ((firstToAct(street) + i) % 2) as Position;
              const isMe = actor === position;
              return (
                <button
                  key={i}
                  onClick={() => truncateBetSeq(i)}
                  title="Clique para desfazer a partir desta ação"
                  className={cn(
                    "text-xs px-2 py-0.5 rounded flex items-center gap-1 group transition-colors",
                    isMe
                      ? "bg-primary/15 text-primary hover:bg-destructive/15 hover:text-destructive"
                      : "bg-muted text-muted-foreground hover:bg-destructive/15 hover:text-destructive",
                  )}
                >
                  <span>{isMe ? heroPosition6Max : villainPosition}: {ACTION_SHORT[action]}</span>
                  <X className="h-2.5 w-2.5 opacity-40 group-hover:opacity-100" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main action area */}
      {!roundDone ? (
        isMyTurn ? (
          <div className="rounded-xl border bg-card p-4 space-y-4">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Sua vez — {heroPosition6Max}
            </span>

            {betStrategy ? (
              <>
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Recomendação GTO</div>
                    <div className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{ACTION_SHORT[betStrategy[0].action]}</div>
                  </div>
                  <div className="text-3xl font-bold text-emerald-700 dark:text-emerald-400">{Math.round(betStrategy[0].prob * 100)}%</div>
                </div>

                {checkAndPatWarning && (
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                    Atenção: com mão feita planejando ficar pat, bet geralmente domina check — check + pat fica faceup.
                  </div>
                )}

                <div className="space-y-1.5">
                  {betStrategy.map(({ action, prob }) => (
                    <ProbBar key={action} label={ACTION_PT[action]} prob={prob} best={prob === bestBetProb} />
                  ))}
                </div>

                {drawAdvice && street < 3 && (
                  <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    Draw sugerido:{" "}
                    {drawAdvice.drawCount === 0
                      ? <span className="font-medium text-foreground">Stand pat</span>
                      : <>descartar <span className="font-medium text-foreground">{drawAdvice.drawCount}</span>, manter{" "}
                          <span className="font-medium text-foreground">{drawAdvice.keepCards.map(c => RANK_LABELS[c.rank]).join("-")}</span></>
                    }
                  </div>
                )}

                <div className="border-t pt-3 space-y-2">
                  <p className="text-xs text-muted-foreground font-medium">O que você fez?</p>
                  <div className="flex gap-2 flex-wrap">
                    {currentActions.map((action) => (
                      <Button key={action} size="sm"
                        variant={action === betStrategy[0].action ? "default" : "outline"}
                        className="text-xs" onClick={() => pushAction(action)}>
                        {ACTION_SHORT[action]}{action === betStrategy[0].action && " ★"}
                      </Button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-amber-600 dark:text-amber-400">Infoset não visitado — retreine com mais iterações.</p>
                <div className="border-t pt-3 space-y-2">
                  <p className="text-xs text-muted-foreground">O que você fez?</p>
                  <div className="flex gap-2 flex-wrap">
                    {currentActions.map((action) => (
                      <Button key={action} size="sm" variant="outline" className="text-xs" onClick={() => pushAction(action)}>
                        {ACTION_SHORT[action]}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Vez do vilão — {villainPosition}
            </span>
            <p className="text-base font-medium">O que o {villainPosition} fez?</p>
            <div className="flex gap-2 flex-wrap">
              {currentActions.map((action) => (
                <Button key={action} variant="outline" size="sm" className="text-sm" onClick={() => pushAction(action)}>
                  {ACTION_SHORT[action]}
                </Button>
              ))}
            </div>
          </div>
        )
      ) : (
        street < 3 && handComplete ? (
          <DrawPhasePanel hand={hand} street={street}
            previousVillainDraw={street > 0 ? opponentDraws[(street - 1) as 0 | 1 | 2] : undefined}
            onConfirm={handleDrawConfirm} />
        ) : street === 3 ? (
          <div className="rounded-xl border bg-card p-4 flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Mão concluída — showdown.</p>
            <Button size="sm" variant="outline" className="text-xs" onClick={handleFullReset}>Nova mão</Button>
          </div>
        ) : (
          <div className="rounded-xl border bg-card p-4 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Apostas concluídas.</p>
            <button onClick={resetBetting} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <RotateCcw className="h-3 w-3" /> Reiniciar aposta
            </button>
          </div>
        )
      )}
    </div>
  );

}
