"use client";

import { useState, useCallback, useMemo } from "react";
import { Card } from "@/engine/cards";
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
import { CardPicker } from "@/components/CardPicker";
import { Button } from "@/components/ui/button";
import { Loader2, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const TRAIN_ITERATIONS = 30_000;
const BUCKET_SAMPLES = 20_000;
const TRANSITION_SAMPLES = 200;

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

// ── Probability bar ────────────────────────────────────────────────────────────

function ProbBar({
  label,
  sublabel,
  prob,
  best,
}: {
  label: string;
  sublabel?: string;
  prob: number;
  best: boolean;
}) {
  const pct = Math.round(prob * 100);
  return (
    <div className={cn("rounded-lg px-3 py-2 flex items-center gap-3", best ? "bg-emerald-500/10 border border-emerald-500/30" : "bg-muted/50")}>
      <div className="flex-1 min-w-0">
        <div className={cn("text-sm font-medium", best && "text-emerald-700 dark:text-emerald-400")}>
          {label}
          {sublabel && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{sublabel}</span>}
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

  const [hand, setHand] = useState<(Card | null)[]>(Array(5).fill(null));
  const [position, setPosition] = useState<Position>(0);
  const [street, setStreet] = useState<Street>(0);

  const [betSeq, setBetSeq] = useState<BetAction[]>([]);
  const [betState, setBetState] = useState<BettingState>(initialBettingState(0));
  const [showHistory, setShowHistory] = useState(false);

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
  const handComplete = selectedCards.length === 5;

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

  // Betting strategy lookup (only for user's own position)
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
    return node.actions.map((a, i) => ({ action: a as BetAction, prob: probs[i] }));
  }, [tables, bucket, position, street, isMyTurn, betSeq, roundDone]);

  // Draw strategy lookup
  const drawStrategy = useMemo(() => {
    if (!tables || bucket === null || street >= 3) return null;
    const nextStreet = (street + 1) as Street;
    const key = drawInfoSetKey(nextStreet, position, bucket);
    const node = tables.draw.get(key);
    if (!node) return null;
    const probs = averageDrawStrategy(node);
    return Array.from({ length: 6 }, (_, dc) => ({ drawCount: dc, prob: probs[dc] }));
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

  // ── Render: training phase ─────────────────────────────────────────────────

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
          <li className="flex gap-2 text-muted-foreground">
            <span className="shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">1</span>
            Clique em <strong className="text-foreground">Inicializar</strong> — o solver treina {TRAIN_ITERATIONS.toLocaleString()} iterações de CFR+ (~4s)
          </li>
          <li className="flex gap-2 text-muted-foreground">
            <span className="shrink-0 w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-bold">2</span>
            Insira sua mão (5 cartas) e selecione posição e rodada
          </li>
          <li className="flex gap-2 text-muted-foreground">
            <span className="shrink-0 w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-bold">3</span>
            Veja a recomendação GTO de aposta e de draw
          </li>
        </ol>

        {phase === "idle" && (
          <Button onClick={handleTrain}>
            Inicializar Solver
          </Button>
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

  const bestBetProb = betStrategy ? Math.max(...betStrategy.map((x) => x.prob)) : 0;
  const bestDrawProb = drawStrategy ? Math.max(...drawStrategy.map((x) => x.prob)) : 0;

  return (
    <div className="space-y-4 max-w-xl">
      {/* Header */}
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
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sua mão (5 cartas)</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {hand.map((card, i) => (
            <CardPicker
              key={i}
              selected={card}
              onSelect={(c) => updateHand(i, c)}
              blockedCards={hand.filter((c, j) => j !== i && c !== null) as Card[]}
            />
          ))}
        </div>
        {bucket !== null && (
          <p className="text-xs text-muted-foreground">
            Força da mão: bucket{" "}
            <span className="font-semibold text-foreground">{bucket + 1}</span>/{NUM_BUCKETS}{" "}
            {bucket < 5 ? "· excelente" : bucket < 10 ? "· boa" : bucket < 15 ? "· mediana" : "· fraca"}
          </p>
        )}
        {!handComplete && (
          <p className="text-xs text-muted-foreground italic">Insira as 5 cartas para ver as recomendações.</p>
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
              <option value={0}>SB / Botão (age 1º no pré-draw)</option>
              <option value={1}>BB (age 1º pós-draw)</option>
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
              <RotateCcw className="h-3 w-3" />Reset
            </button>
          )}
        </div>

        {/* My turn — show recommendation */}
        {isMyTurn && !roundDone && (
          <>
            {handComplete ? (
              betStrategy ? (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground mb-2">
                    GTO recomenda (bucket {bucket! + 1}/{NUM_BUCKETS}):
                  </p>
                  {betStrategy
                    .sort((a, b) => b.prob - a.prob)
                    .map(({ action, prob }) => (
                      <ProbBar
                        key={action}
                        label={ACTION_PT[action]}
                        prob={prob}
                        best={prob === bestBetProb}
                      />
                    ))}
                </div>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Infoset não visitado — tente retreinar com mais iterações.
                </p>
              )
            ) : (
              <p className="text-xs text-muted-foreground italic">Insira sua mão (passo 1) para ver a recomendação.</p>
            )}

            {/* Simulate advancing — collapse by default */}
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1"
            >
              {showHistory ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Simular sequência de apostas
            </button>

            {showHistory && (
              <div className="flex gap-2 flex-wrap pt-1 border-t mt-1">
                {currentActions.map((action) => (
                  <Button key={action} size="sm" className="text-xs h-7" onClick={() => pushAction(action)}>
                    Jogar: {ACTION_SHORT[action]}
                  </Button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Opponent's turn — let user specify what opponent did */}
        {!isMyTurn && !roundDone && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {position === 0
                ? "BB age primeiro nesta rodada. O que ele fez?"
                : "SB age primeiro no pré-draw. O que ele fez?"}
            </p>
            <div className="flex gap-2 flex-wrap">
              {currentActions.map((action) => (
                <Button
                  key={action}
                  variant="outline"
                  size="sm"
                  className="text-xs h-8"
                  onClick={() => pushAction(action)}
                >
                  Oponente: {ACTION_SHORT[action]}
                </Button>
              ))}
            </div>

            {/* History trail */}
            {betSeq.length > 0 && (
              <div className="flex flex-wrap gap-1 text-xs pt-1">
                {betSeq.map((a, i) => {
                  const actor = ((firstToAct(street) + i) % 2) as Position;
                  const isMe = actor === position;
                  return (
                    <span key={i} className={cn("px-1.5 py-0.5 rounded", isMe ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                      {isMe ? "Você" : "Oponente"}: {ACTION_SHORT[a]}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Sequence history trail when it IS my turn but actions already happened */}
        {isMyTurn && !roundDone && betSeq.length > 0 && (
          <div className="flex flex-wrap gap-1 text-xs border-t pt-2">
            {betSeq.map((a, i) => {
              const actor = ((firstToAct(street) + i) % 2) as Position;
              const isMe = actor === position;
              return (
                <span key={i} className={cn("px-1.5 py-0.5 rounded", isMe ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                  {isMe ? "Você" : "Oponente"}: {ACTION_SHORT[a]}
                </span>
              );
            })}
          </div>
        )}

        {roundDone && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Rodada de apostas concluída.</p>
            <button onClick={resetBetting} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <RotateCcw className="h-3 w-3" />Nova rodada
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
            <p className="text-xs text-muted-foreground italic">Insira sua mão para ver.</p>
          ) : drawStrategy ? (
            <div className="space-y-1.5">
              {drawStrategy
                .sort((a, b) => b.prob - a.prob)
                .map(({ drawCount, prob }) => (
                  <ProbBar
                    key={drawCount}
                    label={DRAW_PT[drawCount]}
                    prob={prob}
                    best={prob === bestDrawProb}
                  />
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
