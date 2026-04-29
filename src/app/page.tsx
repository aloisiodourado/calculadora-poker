"use client";

import { useState, useMemo } from "react";
import { Card, Rank } from "@/engine/cards";
import { PokerVariant } from "@/engine/variants";
import { getVariantConfig } from "@/engine/variants/config";
import { SimulationResult, DrawRoundStrategy } from "@/engine/simulator/types";
import { DEFAULT_DRAW_THRESHOLDS } from "@/engine/simulator/drawStrategy";
import { VariantSelector } from "@/components/VariantSelector";
import { HandInput } from "@/components/HandInput";
import { BoardInput } from "@/components/BoardInput";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Loader2, Plus, Moon, Sun } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useDeckColor } from "@/contexts/DeckColorContext";
import { useTheme } from "@/contexts/ThemeContext";
import { DrawsLeftSelector } from "@/components/DrawsLeftSelector";

const DEFAULT_VARIANT = PokerVariant.TripleDraw27;
const MAX_PLAYERS = 6;
const TRIPLE_DRAW_SLOTS = 5;

function emptyHand(size: number): (Card | null)[] {
  return Array(size).fill(null);
}

function emptyDiscards(size: number): boolean[] {
  return Array(size).fill(false);
}

function defaultStrategies(): DrawRoundStrategy[] {
  return DEFAULT_DRAW_THRESHOLDS.map((keepThreshold) => ({ keepThreshold }));
}

function emptyExplicitDiscards(): boolean[] {
  return Array(TRIPLE_DRAW_SLOTS).fill(false);
}

export default function Home() {
  const [variant, setVariant] = useState<PokerVariant>(DEFAULT_VARIANT);
  const defaultConfig = getVariantConfig(DEFAULT_VARIANT);
  const [hands, setHands] = useState<(Card | null)[][]>([emptyHand(defaultConfig.holeCards), emptyHand(defaultConfig.holeCards)]);
  const [discards, setDiscards] = useState<boolean[][]>([emptyDiscards(defaultConfig.holeCards), emptyDiscards(defaultConfig.holeCards)]);
  const [board, setBoard] = useState<(Card | null)[]>(Array(defaultConfig.communityCards).fill(null));
  const [iterations, setIterations] = useState(50_000);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Triple Draw 2-7 specific state
  const [drawRoundsLeft, setDrawRoundsLeft] = useState(3);
  const [playerDrawStrategies, setPlayerDrawStrategies] = useState<DrawRoundStrategy[][]>([
    defaultStrategies(),
    defaultStrategies(),
  ]);
  const [playerExplicitDiscards, setPlayerExplicitDiscards] = useState<boolean[][]>([
    emptyExplicitDiscards(),
    emptyExplicitDiscards(),
  ]);

  const config = useMemo(() => getVariantConfig(variant), [variant]);
  const isHiLo = config.evaluators.length === 2;
  const isTripleDraw = variant === PokerVariant.TripleDraw27;
  const { scheme, toggle } = useDeckColor();
  const { theme, toggle: toggleTheme } = useTheme();

  const allSelectedCards = useMemo<Card[]>(() => {
    const cards: Card[] = [];
    for (const hand of hands) for (const c of hand) if (c) cards.push(c);
    for (const c of board) if (c) cards.push(c);
    return cards;
  }, [hands, board]);

  function handleVariantChange(newVariant: PokerVariant) {
    const newConfig = getVariantConfig(newVariant);
    setVariant(newVariant);
    setHands((prev) => prev.map(() => emptyHand(newConfig.holeCards)));
    setDiscards((prev) => prev.map(() => emptyDiscards(newConfig.holeCards)));
    setBoard(Array(newConfig.communityCards).fill(null));
    setDrawRoundsLeft(3);
    setPlayerExplicitDiscards((prev) => prev.map(() => emptyExplicitDiscards()));
    setResult(null);
    setError(null);
  }

  function handleHandCardChange(handIdx: number, cardIdx: number, card: Card | null) {
    setHands((prev) => {
      const next = prev.map((h) => [...h]);
      next[handIdx][cardIdx] = card;
      return next;
    });
    if (!card) {
      setDiscards((prev) => {
        const next = prev.map((d) => [...d]);
        next[handIdx][cardIdx] = false;
        return next;
      });
    } else {
      // Card selected: clear explicit discard on this slot
      setPlayerExplicitDiscards((prev) => {
        const next = prev.map((d) => [...d]);
        next[handIdx][cardIdx] = false;
        return next;
      });
    }
    setResult(null);
  }

  function handleDiscardToggle(handIdx: number, cardIdx: number) {
    setDiscards((prev) => {
      const next = prev.map((d) => [...d]);
      next[handIdx][cardIdx] = !next[handIdx][cardIdx];
      return next;
    });
    setResult(null);
  }

  function handleExplicitDiscardToggle(playerIdx: number, slotIdx: number) {
    setPlayerExplicitDiscards((prev) => {
      const next = prev.map((d) => [...d]);
      next[playerIdx][slotIdx] = !next[playerIdx][slotIdx];
      return next;
    });
    setResult(null);
  }

  function handleBoardCardChange(idx: number, card: Card | null) {
    setBoard((prev) => { const next = [...prev]; next[idx] = card; return next; });
    setResult(null);
  }

  function handleDrawStrategyChange(playerIdx: number, roundIdx: number, keepThreshold: Rank) {
    setPlayerDrawStrategies((prev) => {
      const next = prev.map((s) => [...s]);
      next[playerIdx][roundIdx] = { keepThreshold };
      return next;
    });
    setResult(null);
  }

  function addPlayer() {
    if (hands.length >= MAX_PLAYERS) return;
    setHands((prev) => [...prev, emptyHand(config.holeCards)]);
    setDiscards((prev) => [...prev, emptyDiscards(config.holeCards)]);
    setPlayerDrawStrategies((prev) => [...prev, defaultStrategies()]);
    setPlayerExplicitDiscards((prev) => [...prev, emptyExplicitDiscards()]);
    setResult(null);
  }

  function removePlayer(idx: number) {
    if (hands.length <= 2) return;
    setHands((prev) => prev.filter((_, i) => i !== idx));
    setDiscards((prev) => prev.filter((_, i) => i !== idx));
    setPlayerDrawStrategies((prev) => prev.filter((_, i) => i !== idx));
    setPlayerExplicitDiscards((prev) => prev.filter((_, i) => i !== idx));
    setResult(null);
  }

  async function calculate() {
    setLoading(true);
    setError(null);
    setResult(null);

    const handData = hands.map((h, hi) =>
      h.filter((c, ci): c is Card => c !== null && !discards[hi][ci])
    );
    const boardData = board.filter((c): c is Card => c !== null);

    try {
      const body: Record<string, unknown> = {
        variant,
        hands: handData,
        board: boardData,
        iterations,
      };

      if (isTripleDraw) {
        body.drawRoundsLeft = drawRoundsLeft;
        body.playerDrawStrategies = playerDrawStrategies;
        body.playerExplicitDiscards = playerExplicitDiscards;
      }

      const res = await fetch("/api/equity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unknown error");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Poker Equity Calculator</h1>
          <p className="text-sm text-muted-foreground">
            Compare hand equities via Monte Carlo simulation
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground select-none">
              {scheme === "4color" ? "4 cores" : "2 cores"}
            </span>
            <Switch
              checked={scheme === "4color"}
              onCheckedChange={toggle}
              aria-label="Alternar esquema de cores do baralho"
            />
          </div>
          <div className="flex items-center gap-2">
            <Sun className="h-3.5 w-3.5 text-muted-foreground" />
            <Switch
              checked={theme === "dark"}
              onCheckedChange={toggleTheme}
              aria-label="Alternar tema escuro"
            />
            <Moon className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-end gap-4 flex-wrap">
          <VariantSelector value={variant} onChange={handleVariantChange} />
          <div className="text-xs text-muted-foreground pb-1">
            {config.holeCards} hole cards
            {config.communityCards > 0 ? ` · ${config.communityCards} community cards` : " · no board"}
            {isHiLo && " · Hi-Lo split"}
          </div>
          {isTripleDraw && (
            <DrawsLeftSelector value={drawRoundsLeft} onChange={(v) => { setDrawRoundsLeft(v); setResult(null); }} />
          )}
        </div>

        <Separator />

        {config.communityCards > 0 && (
          <BoardInput
            cards={board}
            communityCardCount={config.communityCards}
            blockedCards={allSelectedCards}
            variant={variant}
            onCardChange={handleBoardCardChange}
          />
        )}

        <div className="space-y-3">
          {hands.map((hand, i) => {
            const otherCards = allSelectedCards.filter(
              (c) => !hand.some((h) => h?.rank === c.rank && h?.suit === c.suit)
            );
            return (
              <HandInput
                key={i}
                handIndex={i}
                cards={hand}
                discards={discards[i]}
                holeCardCount={config.holeCards}
                blockedCards={otherCards}
                boardCards={board}
                variant={variant}
                config={config}
                result={result?.results[i]}
                isHiLo={isHiLo}
                iterationsRun={result?.iterationsRun}
                drawRoundsLeft={isTripleDraw ? drawRoundsLeft : undefined}
                drawStrategies={isTripleDraw ? playerDrawStrategies[i] : undefined}
                explicitDiscards={isTripleDraw ? playerExplicitDiscards[i] : undefined}
                onCardChange={(cardIdx, card) => handleHandCardChange(i, cardIdx, card)}
                onDiscardToggle={(cardIdx) => handleDiscardToggle(i, cardIdx)}
                onDrawStrategyChange={(roundIdx, threshold) =>
                  handleDrawStrategyChange(i, roundIdx, threshold)
                }
                onExplicitDiscardToggle={(slotIdx) => handleExplicitDiscardToggle(i, slotIdx)}
                onRemove={() => removePlayer(i)}
                canRemove={hands.length > 2}
              />
            );
          })}
        </div>

        <div className="flex gap-3 flex-wrap items-center">
          {hands.length < MAX_PLAYERS && (
            <Button variant="outline" size="sm" onClick={addPlayer}>
              <Plus className="h-4 w-4 mr-1" />
              Add Player
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="iterations-select" className="text-xs text-muted-foreground whitespace-nowrap">
              Iterações:
            </label>
            <select
              id="iterations-select"
              value={iterations}
              onChange={(e) => setIterations(Number(e.target.value))}
              className="text-xs font-medium border rounded px-2 py-1 bg-background cursor-pointer focus:outline-none"
            >
              {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((n) => (
                <option key={n} value={n * 1000}>
                  {n}k
                </option>
              ))}
            </select>
          </div>
          <Button onClick={calculate} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Calculating…
              </>
            ) : (
              "Calculate Equity"
            )}
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {result && (
          <p className="text-xs text-center text-muted-foreground">
            {result.iterationsRun.toLocaleString()} iterações · {result.durationMs}ms
          </p>
        )}
      </main>
    </div>
  );
}
