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
import { Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

const TRAIN_ITERATIONS = 30_000;
const BUCKET_SAMPLES = 20_000;
const TRANSITION_SAMPLES = 200;

const STREET_LABELS: Record<Street, string> = {
  0: "Pré-draw",
  1: "1ª rodada (pós-draw 1)",
  2: "2ª rodada (pós-draw 2)",
  3: "3ª rodada (pós-draw 3)",
};

const ACTION_LABELS: Record<BetAction, string> = {
  fold: "Fold",
  check: "Check",
  call: "Call",
  bet: "Bet",
  raise: "Raise",
};

const DRAW_LABELS: Record<number, string> = {
  0: "Stand pat",
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

function ProbBar({ label, prob, highlight }: { label: string; prob: number; highlight?: boolean }) {
  const pct = Math.round(prob * 100);
  return (
    <div className="flex items-center gap-2">
      <span className={cn("text-xs w-24 shrink-0", highlight && "font-semibold text-foreground")}>
        {label}
      </span>
      <div className="flex-1 bg-muted rounded-full h-2 min-w-0">
        <div
          className={cn("rounded-full h-2 transition-all", highlight ? "bg-primary" : "bg-primary/60")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs w-8 text-right tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}

// ── Bucket badge ───────────────────────────────────────────────────────────────

function BucketBadge({ bucket }: { bucket: number | null }) {
  if (bucket === null) return null;
  const label = bucket < NUM_BUCKETS / 4 ? "forte" : bucket < NUM_BUCKETS / 2 ? "médio-forte" : bucket < (NUM_BUCKETS * 3) / 4 ? "médio-fraco" : "fraco";
  return (
    <span className="text-xs text-muted-foreground">
      Bucket <span className="font-mono font-semibold text-foreground">{bucket + 1}/{NUM_BUCKETS}</span>
      {" "}· {label}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SolverPanel() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [tables, setTables] = useState<SolverTables | null>(null);

  // Hand + context
  const [hand, setHand] = useState<(Card | null)[]>(Array(5).fill(null));
  const [position, setPosition] = useState<Position>(0);
  const [street, setStreet] = useState<Street>(0);

  // Betting sequence simulation
  const [betSeq, setBetSeq] = useState<BetAction[]>([]);
  const [betState, setBetState] = useState<BettingState>(initialBettingState(0));

  // ── Training ───────────────────────────────────────────────────────────────

  const handleTrain = useCallback(async () => {
    setPhase("initializing");
    setProgress(0);
    // Yield to React so "initializing" state renders before the sync init
    await new Promise<void>((r) => setTimeout(r, 30));
    initSolver(BUCKET_SAMPLES, TRANSITION_SAMPLES);
    setPhase("training");
    const t = createTables();
    await runIterations(t, TRAIN_ITERATIONS, {
      progressEvery: 3_000,
      yieldEvery: 3_000,
      onProgress: ({ iterations }) =>
        setProgress(Math.round((iterations / TRAIN_ITERATIONS) * 100)),
    });
    setTables(t);
    setPhase("ready");
    setProgress(100);
  }, []);

  // ── Derived state ──────────────────────────────────────────────────────────

  const selectedCards = useMemo(() => hand.filter(Boolean) as Card[], [hand]);

  const bucket = useMemo(
    () => (selectedCards.length === 5 ? handToBucket(selectedCards) : null),
    [selectedCards],
  );

  // Determine current actor in the betting sequence
  const currentActor = useMemo(
    () => ((firstToAct(street) + betSeq.length) % 2) as Position,
    [street, betSeq.length],
  );

  const roundDone = useMemo(() => bettingDone(betSeq, betState.toCall), [betSeq, betState.toCall]);

  const currentActions = useMemo(
    () => (roundDone ? [] : validBetActions(betState, street)),
    [betState, street, roundDone],
  );

  // Betting strategy lookup
  const betStrategy = useMemo(() => {
    if (!tables || bucket === null || roundDone) return null;
    const key = infoSetKey({
      street,
      position: currentActor,
      myBucket: currentActor === position ? bucket : 10, // opponent bucket unknown → midpoint
      opponentDrawHistory: [] as DrawCount[],
      bettingSequence: betSeq,
    });
    const node = tables.bet.get(key);
    if (!node) return null;
    return { actions: node.actions as BetAction[], probs: averageStrategy(node) };
  }, [tables, bucket, position, street, currentActor, betSeq, roundDone]);

  // Draw strategy lookup (for upcoming draw after current street)
  const drawStrategy = useMemo(() => {
    if (!tables || bucket === null || street >= 3) return null;
    const nextStreet = (street + 1) as Street;
    const key = drawInfoSetKey(nextStreet, position, bucket);
    const node = tables.draw.get(key);
    if (!node) return null;
    return averageDrawStrategy(node);
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

  function pushAction(action: BetAction) {
    const newSeq = [...betSeq, action];
    const newBet = action === "fold" ? betState : applyBetAction(betState, action, street);
    setBetSeq(newSeq);
    setBetState(newBet);
  }

  function resetBetting() {
    setBetSeq([]);
    setBetState(initialBettingState(street));
  }

  // ── Render: idle / training ────────────────────────────────────────────────

  if (phase !== "ready") {
    return (
      <div className="rounded-xl border bg-card p-6 space-y-4 max-w-md">
        <div>
          <h2 className="font-semibold text-sm">2-7 Triple Draw — Solver GTO</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Treina o algoritmo CFR+ no browser e mostra recomendações de aposta e draw.
          </p>
        </div>

        {phase === "idle" && (
          <Button onClick={handleTrain} size="sm">
            Inicializar Solver
            <span className="ml-2 text-xs opacity-70">≈{Math.round((TRAIN_ITERATIONS * 0.00014 + 0.5))}s</span>
          </Button>
        )}

        {(phase === "initializing" || phase === "training") && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              {phase === "initializing" ? "Calibrando buckets e matriz de transição…" : `Treinando CFR+… ${progress}%`}
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: phase === "initializing" ? "5%" : `${progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {TRAIN_ITERATIONS.toLocaleString()} iterações · {NUM_BUCKETS} buckets
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── Render: ready ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">2-7 Triple Draw — Solver GTO</h2>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          onClick={() => { setPhase("idle"); setTables(null); }}
        >
          Retreinar
        </Button>
      </div>

      {/* Hand input */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sua mão</div>
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
        <BucketBadge bucket={bucket} />
      </div>

      {/* Context selectors */}
      <div className="flex gap-4 flex-wrap">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Posição</label>
          <select
            className="block text-sm border rounded-md px-2 py-1.5 bg-background"
            value={position}
            onChange={(e) => setPosition(+e.target.value as Position)}
          >
            <option value={0}>SB / Botão</option>
            <option value={1}>BB</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rodada</label>
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

      {/* Bet advisor */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recomendação de Aposta
          </div>
          {betSeq.length > 0 && (
            <button
              onClick={resetBetting}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          )}
        </div>

        {/* Sequence trail */}
        {betSeq.length > 0 && (
          <div className="flex flex-wrap gap-1 text-xs">
            {betSeq.map((a, i) => {
              const actor = (firstToAct(street) + i) % 2 as Position;
              const isMe = actor === position;
              return (
                <span
                  key={i}
                  className={cn(
                    "px-1.5 py-0.5 rounded font-medium",
                    isMe ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {isMe ? "Você" : "Oponente"}: {ACTION_LABELS[a]}
                </span>
              );
            })}
          </div>
        )}

        {/* Round done */}
        {roundDone && (
          <p className="text-xs text-muted-foreground italic">Rodada de apostas concluída.</p>
        )}

        {/* Current actor + strategy */}
        {!roundDone && (
          <>
            <div className="text-xs text-muted-foreground">
              Vez de:{" "}
              <span className="font-medium text-foreground">
                {currentActor === position ? "Você" : "Oponente"}
              </span>
            </div>

            {/* GTO probabilities (shown when it's your turn) */}
            {currentActor === position && bucket !== null && (
              <div className="space-y-1.5">
                {betStrategy ? (
                  betStrategy.actions.map((action, ai) => (
                    <ProbBar
                      key={action}
                      label={ACTION_LABELS[action]}
                      prob={betStrategy.probs[ai]}
                      highlight={betStrategy.probs[ai] === Math.max(...betStrategy.probs)}
                    />
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    Sem dados para este infoset — tente mais iterações.
                  </p>
                )}
              </div>
            )}

            {/* Action buttons to advance simulation */}
            <div className="flex gap-2 flex-wrap pt-1">
              {currentActions.map((action) => (
                <Button
                  key={action}
                  variant={currentActor === position ? "default" : "outline"}
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => pushAction(action)}
                >
                  {currentActor === position ? "Jogar: " : "Oponente: "}
                  {ACTION_LABELS[action]}
                </Button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Draw advisor */}
      {street < 3 && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recomendação de Draw
            <span className="ml-1 font-normal normal-case">
              (após esta rodada · draw {street + 1})
            </span>
          </div>

          {bucket === null ? (
            <p className="text-xs text-muted-foreground italic">Insira sua mão para ver a recomendação.</p>
          ) : drawStrategy ? (
            <div className="space-y-1.5">
              {drawStrategy.map((prob, dc) => (
                <ProbBar
                  key={dc}
                  label={DRAW_LABELS[dc]}
                  prob={prob}
                  highlight={dc === drawStrategy.indexOf(Math.max(...drawStrategy))}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              Sem dados para este infoset — tente mais iterações.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
