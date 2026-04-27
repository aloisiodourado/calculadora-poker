"use client";

import { useState, useMemo } from "react";
import { Card } from "@/engine/cards";
import { PokerVariant } from "@/engine/variants";
import { getVariantConfig } from "@/engine/variants/config";
import { SimulationResult } from "@/engine/simulator/types";
import { VariantSelector } from "@/components/VariantSelector";
import { HandInput } from "@/components/HandInput";
import { BoardInput } from "@/components/BoardInput";
import { EquityDisplay } from "@/components/EquityDisplay";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Loader2, Plus } from "lucide-react";

const DEFAULT_VARIANT = PokerVariant.TexasHoldem;
const MAX_PLAYERS = 6;

function emptyHand(size: number): (Card | null)[] {
  return Array(size).fill(null);
}

function emptyDiscards(size: number): boolean[] {
  return Array(size).fill(false);
}

export default function Home() {
  const [variant, setVariant] = useState<PokerVariant>(DEFAULT_VARIANT);
  const [hands, setHands] = useState<(Card | null)[][]>([emptyHand(2), emptyHand(2)]);
  const [discards, setDiscards] = useState<boolean[][]>([emptyDiscards(2), emptyDiscards(2)]);
  const [board, setBoard] = useState<(Card | null)[]>(Array(5).fill(null));
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config = useMemo(() => getVariantConfig(variant), [variant]);
  const isHiLo = config.evaluators.length === 2;

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
    setResult(null);
    setError(null);
  }

  function handleHandCardChange(handIdx: number, cardIdx: number, card: Card | null) {
    setHands((prev) => {
      const next = prev.map((h) => [...h]);
      next[handIdx][cardIdx] = card;
      return next;
    });
    // Clear discard when card is removed
    if (!card) {
      setDiscards((prev) => {
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

  function handleBoardCardChange(idx: number, card: Card | null) {
    setBoard((prev) => { const next = [...prev]; next[idx] = card; return next; });
    setResult(null);
  }

  function addPlayer() {
    if (hands.length >= MAX_PLAYERS) return;
    setHands((prev) => [...prev, emptyHand(config.holeCards)]);
    setDiscards((prev) => [...prev, emptyDiscards(config.holeCards)]);
    setResult(null);
  }

  function removePlayer(idx: number) {
    if (hands.length <= 2) return;
    setHands((prev) => prev.filter((_, i) => i !== idx));
    setDiscards((prev) => prev.filter((_, i) => i !== idx));
    setResult(null);
  }

  async function calculate() {
    setLoading(true);
    setError(null);
    setResult(null);

    // Cards marked for discard are treated as unknown (not sent to API)
    const handData = hands.map((h, hi) =>
      h.filter((c, ci): c is Card => c !== null && !discards[hi][ci])
    );
    const boardData = board.filter((c): c is Card => c !== null);

    try {
      const res = await fetch("/api/equity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant, hands: handData, board: boardData, iterations: 10_000 }),
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
      <header className="border-b px-6 py-4">
        <h1 className="text-xl font-bold tracking-tight">Poker Equity Calculator</h1>
        <p className="text-sm text-muted-foreground">
          Compare hand equities via Monte Carlo simulation
        </p>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        {/* Variant selector */}
        <div className="flex items-end gap-4 flex-wrap">
          <VariantSelector value={variant} onChange={handleVariantChange} />
          <div className="text-xs text-muted-foreground pb-1">
            {config.holeCards} hole cards
            {config.communityCards > 0 ? ` · ${config.communityCards} community cards` : " · no board"}
            {isHiLo && " · Hi-Lo split"}
          </div>
        </div>

        <Separator />

        {/* Board */}
        {config.communityCards > 0 && (
          <BoardInput
            cards={board}
            communityCardCount={config.communityCards}
            blockedCards={allSelectedCards}
            variant={variant}
            onCardChange={handleBoardCardChange}
          />
        )}

        {/* Hands */}
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
                onCardChange={(cardIdx, card) => handleHandCardChange(i, cardIdx, card)}
                onDiscardToggle={(cardIdx) => handleDiscardToggle(i, cardIdx)}
                onRemove={() => removePlayer(i)}
                canRemove={hands.length > 2}
              />
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex gap-3 flex-wrap">
          {hands.length < MAX_PLAYERS && (
            <Button variant="outline" size="sm" onClick={addPlayer}>
              <Plus className="h-4 w-4 mr-1" />
              Add Player
            </Button>
          )}
          <Button onClick={calculate} disabled={loading} className="ml-auto">
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

        {result && <EquityDisplay result={result} isHiLo={isHiLo} />}
      </main>
    </div>
  );
}
