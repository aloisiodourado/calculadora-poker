"use client";

import { useState, useCallback, useMemo } from "react";
import { Card, Rank, RANKS, SUITS } from "@/engine/cards";
import type { Street, Position, BetAction, DrawCount } from "@/solver/game/types";
import { infoSetKey, drawInfoSetKey } from "@/solver/game/types";
import {
  validBetActions,
  applyBetAction,
  initialBettingState,
  firstToAct,
  type BettingState,
} from "@/solver/game/rules";
import { createTables, initSolver, runIterations } from "@/solver/cfr/trainer";
import type { SolverTables } from "@/solver/cfr/trainer";
import { handToBucket, NUM_BUCKETS } from "@/solver/abstraction/handBuckets";
import { averageStrategy, averageDrawStrategy } from "@/solver/cfr/strategy";
import { Button } from "@/components/ui/button";
import { Loader2, RotateCcw, ChevronDown, ChevronRight, X } from "lucide-react";
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
  0: "Stand pat (manter tudo)",
  1: "Descartar 1",
  2: "Descartar 2",
  3: "Descartar 3",
  4: "Descartar 4",
  5: "Descartar 5",
};

type Phase = "idle" | "initializing" | "training" | "ready";

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
                <button
                  className="absolute -top-1.5 -right-1.5 bg-background border rounded-full p-0.5 hover:bg-destructive hover:text-destructive-foreground transition-colors"
                  onClick={(e) => handleClearSlot(i, e)}
                  title="Remover"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
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

          {/* Card grid */}
          <div
            className="grid gap-1 overflow-x-auto"
            style={{ gridTemplateColumns: `repeat(${RANKS.length}, minmax(44px, 1fr))` }}
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
                      "h-[56px] rounded-lg font-bold flex flex-col items-center justify-center leading-none transition-all gap-0.5 text-sm",
                      blocked && "opacity-20 cursor-not-allowed",
                      isCurrent && "bg-primary text-primary-foreground scale-105 shadow-md",
                      !blocked && !isCurrent && "hover:bg-muted hover:scale-105 cursor-pointer",
                      !isCurrent && suitColors[suit],
                    )}
                  >
                    <span className="text-xs">{RANK_LABELS[rank]}</span>
                    <span className="text-xs">{SUIT_SYMBOLS[suit]}</span>
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

// ── Main component ─────────────────────────────────────────────────────────────

export function SolverPanel() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [tables, setTables] = useState<SolverTables | null>(null);
  const [infosetCount, setInfosetCount] = useState(0);

  const [hand, setHand] = useState<(Card | null)[]>(Array(HAND_SIZE).fill(null));
  const [position, setPosition] = useState<Position>(0);
  const [street, setStreet] = useState<Street>(0);

  const [betSeq, setBetSeq] = useState<BetAction[]>([]);
  const [betState, setBetState] = useState<BettingState>(initialBettingState(0));
  const [showSimulate, setShowSimulate] = useState(false);

  // ── Training ───────────────────────────────────────────────────────────────

  const handleTrain = useCallback(async () => {
    setPhase("initializing");
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
    const key = infoSetKey({
      street,
      position,
      myBucket: bucket,
      opponentDrawHistory: [] as DrawCount[],
      bettingSequence: betSeq,
    });
    const node = tables.bet.get(key);
    if (!node) return null;
    const probs = averageStrategy(node);
    return node.actions
      .map((a, i) => ({ action: a as BetAction, prob: probs[i] }))
      .sort((a, b) => b.prob - a.prob);
  }, [tables, bucket, position, street, isMyTurn, betSeq, roundDone]);

  const drawStrategy = useMemo(() => {
    if (!tables || bucket === null || street >= 3) return null;
    const nextStreet = (street + 1) as Street;
    const key = drawInfoSetKey(nextStreet, position, bucket);
    const node = tables.draw.get(key);
    if (!node) return null;
    const probs = averageDrawStrategy(node);
    return Array.from({ length: 6 }, (_, dc) => ({ drawCount: dc, prob: probs[dc] }))
      .sort((a, b) => b.prob - a.prob);
  }, [tables, bucket, position, street]);

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

  function pushAction(action: BetAction) {
    const newBet = action === "fold" ? betState : applyBetAction(betState, action, street);
    setBetSeq((prev) => [...prev, action]);
    setBetState(newBet);
  }

  function resetBetting() {
    setBetSeq([]);
    setBetState(initialBettingState(street));
  }

  const bestBetProb = betStrategy ? betStrategy[0].prob : 0;
  const bestDrawProb = drawStrategy ? drawStrategy[0].prob : 0;

  // ── Render: training ───────────────────────────────────────────────────────

  if (phase !== "ready") {
    return (
      <div className="rounded-xl border bg-card p-6 space-y-5 max-w-lg">
        <div>
          <h2 className="font-semibold">Solver GTO — 2-7 Triple Draw</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Treina o algoritmo CFR+ no navegador e recomenda ações GTO em tempo real.
          </p>
        </div>

        <ol className="space-y-2 text-sm">
          {[
            <>Clique em <strong className="text-foreground">Inicializar</strong> — treina {TRAIN_ITERATIONS.toLocaleString()} iterações de CFR+ (~4s)</>,
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

        {phase === "idle" && (
          <Button onClick={handleTrain}>Inicializar Solver</Button>
        )}

        {(phase === "initializing" || phase === "training") && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              {phase === "initializing"
                ? "Calibrando buckets e matriz de transição…"
                : `Treinando CFR+… ${progress}%`}
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: phase === "initializing" ? "3%" : `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Render: ready ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-semibold text-sm">Solver GTO — 2-7 Triple Draw FL</span>
          <span className="ml-2 text-xs text-muted-foreground">{infosetCount.toLocaleString()} infosets</span>
        </div>
        <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => { setPhase("idle"); setTables(null); }}>
          Retreinar
        </Button>
      </div>

      {/* Step 1 — Hand */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">1</span>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sua mão — clique em qualquer carta para abrir o picker
          </span>
        </div>
        <HandPicker hand={hand} onChange={updateHand} />
        {bucket !== null ? (
          <p className="text-xs text-muted-foreground">
            Potencial de draw: bucket{" "}
            <span className="font-semibold text-foreground">{bucket + 1}</span>/{NUM_BUCKETS}
            {" "}·{" "}
            {bucket < 4 ? "excelente" : bucket < 8 ? "boa" : bucket < 13 ? "mediana" : bucket < 17 ? "fraca" : "muito fraca"}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            Selecione as 5 cartas para ver a recomendação GTO.
          </p>
        )}
      </div>

      {/* Step 2 — Context */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">2</span>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Situação do jogo</span>
        </div>
        <div className="flex gap-4 flex-wrap">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Sua posição</label>
            <select
              className="block text-sm border rounded-md px-2 py-1.5 bg-background"
              value={position}
              onChange={(e) => handlePositionChange(+e.target.value as Position)}
            >
              <option value={0}>SB / Botão</option>
              <option value={1}>BB</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Rodada de apostas</label>
            <select
              className="block text-sm border rounded-md px-2 py-1.5 bg-background"
              value={street}
              onChange={(e) => handleStreetChange(+e.target.value as Street)}
            >
              {([0, 1, 2, 3] as Street[]).map((s) => (
                <option key={s} value={s}>{STREET_LABELS[s]}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Step 3 — Betting recommendation */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">3</span>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recomendação de aposta</span>
          </div>
          {betSeq.length > 0 && (
            <button onClick={resetBetting} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          )}
        </div>

        {/* Sequence trail */}
        {betSeq.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {betSeq.map((a, i) => {
              const actor = ((firstToAct(street) + i) % 2) as Position;
              const isMe = actor === position;
              return (
                <span key={i} className={cn("text-xs px-1.5 py-0.5 rounded", isMe ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                  {isMe ? "Você" : "Oponente"}: {ACTION_SHORT[a]}
                </span>
              );
            })}
          </div>
        )}

        {/* My turn */}
        {isMyTurn && !roundDone && (
          <>
            {handComplete ? (
              betStrategy ? (
                <div className="space-y-1.5">
                  {betStrategy.map(({ action, prob }) => (
                    <ProbBar key={action} label={ACTION_PT[action]} prob={prob} best={prob === bestBetProb} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Infoset não visitado — tente retreinar com mais iterações.
                </p>
              )
            ) : (
              <p className="text-xs text-muted-foreground italic">Insira a mão (passo 1) para ver a recomendação.</p>
            )}

            {/* Simulate collapse */}
            <button
              onClick={() => setShowSimulate(!showSimulate)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1"
            >
              {showSimulate ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Simular próximas ações
            </button>
            {showSimulate && (
              <div className="flex gap-2 flex-wrap border-t pt-2">
                {currentActions.map((action) => (
                  <Button key={action} size="sm" className="text-xs h-7" onClick={() => pushAction(action)}>
                    Jogar: {ACTION_SHORT[action]}
                  </Button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Opponent's turn */}
        {!isMyTurn && !roundDone && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              {position === 1
                ? "SB age primeiro no pré-draw. O que ele fez?"
                : "BB age primeiro nas rodadas pós-draw. O que ele fez?"}
            </p>
            <div className="flex gap-2 flex-wrap">
              {currentActions.map((action) => (
                <Button key={action} variant="outline" size="sm" className="text-xs h-8" onClick={() => pushAction(action)}>
                  Oponente: {ACTION_SHORT[action]}
                </Button>
              ))}
            </div>
          </div>
        )}

        {roundDone && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Rodada de apostas concluída.</p>
            <button onClick={resetBetting} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <RotateCcw className="h-3 w-3" /> Nova rodada
            </button>
          </div>
        )}
      </div>

      {/* Draw recommendation */}
      {street < 3 && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recomendação de draw
            <span className="ml-1 font-normal normal-case text-muted-foreground/70">
              · draw {street + 1} (após esta rodada de apostas)
            </span>
          </div>
          {!handComplete ? (
            <p className="text-xs text-muted-foreground italic">Insira a mão para ver.</p>
          ) : drawStrategy ? (
            <div className="space-y-1.5">
              {drawStrategy.map(({ drawCount, prob }) => (
                <ProbBar key={drawCount} label={DRAW_PT[drawCount]} prob={prob} best={prob === bestDrawProb} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Infoset não visitado — retreine com mais iterações.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
