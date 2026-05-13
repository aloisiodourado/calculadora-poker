"use client";

import { useState, useMemo } from "react";
import { Card, Rank, Suit, SUITS } from "@/engine/cards";
import { PokerVariant } from "@/engine/variants";
import { getVariantConfig } from "@/engine/variants/config";
import { SimulationResult, DrawRoundStrategy } from "@/engine/simulator/types";
import { DEFAULT_DRAW_THRESHOLDS, applyDrawStrategy } from "@/engine/simulator/drawStrategy";
import { findTop10Rank, TOP_10_27 } from "@/lib/top10-27";
import { HandCategory, buildStrategyAwareRepHand } from "@/lib/representative-hands-27td";
import { RangeEntry, buildRangeHandState } from "@/lib/range-hand-builder";
import { VariantSelector } from "@/components/VariantSelector";
import { PotOddsPanel } from "@/components/PotOddsPanel";
import { Top10Panel } from "@/components/Top10Panel";
import { HandInput } from "@/components/HandInput";
import { BoardInput } from "@/components/BoardInput";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Loader2, Plus, Moon, Sun } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useDeckColor } from "@/contexts/DeckColorContext";
import { useTheme } from "@/contexts/ThemeContext";
import { DrawsLeftSelector } from "@/components/DrawsLeftSelector";
import { SolverPanel } from "@/components/SolverPanel";

const DEFAULT_VARIANT = PokerVariant.Solver27TD;
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

const POT_ODDS_DEFAULTS: Record<number, { pot: number; bet: number }> = {
  3: { pot: 3.5, bet: 1 },
  2: { pot: 5.5, bet: 1 },
  1: { pot: 8.5, bet: 2 },
};

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

  const [handCategories, setHandCategories] = useState<(HandCategory | null)[]>([null, null]);
  const [playerRanges, setPlayerRanges] = useState<(RangeEntry[] | null)[]>([null, null]);
  const [activePlayerIdx, setActivePlayerIdx] = useState<number | null>(null);

  // Pot odds
  const [pot, setPot] = useState<number>(POT_ODDS_DEFAULTS[3].pot);
  const [bet, setBet] = useState<number>(POT_ODDS_DEFAULTS[3].bet);

  const requiredEquity = useMemo(() => {
    const denom = pot + bet;
    return denom > 0 ? bet / denom : 0;
  }, [pot, bet]);

  const config = useMemo(() => getVariantConfig(variant), [variant]);
  const isHiLo = config.evaluators.length === 2;
  const isTripleDraw = variant === PokerVariant.TripleDraw27;
  const isSolver = variant === PokerVariant.Solver27TD;
  const is27Low = isTripleDraw || variant === PokerVariant.SingleDraw27;
  const { scheme, toggle } = useDeckColor();
  const { theme, toggle: toggleTheme } = useTheme();

  const activeTop10Ranks = useMemo<Set<number>>(() => {
    if (!is27Low) return new Set();
    const result = new Set<number>();
    hands.forEach((hand, playerIdx) => {
      const known = hand.filter((c): c is Card => c !== null);
      if (known.length === 0) return;
      let kept = known;
      if (isTripleDraw && drawRoundsLeft != null) {
        const roundIdx = 3 - drawRoundsLeft;
        const strategy = playerDrawStrategies[playerIdx]?.[roundIdx];
        if (strategy) kept = applyDrawStrategy(known, strategy).keep;
      }
      if (kept.length !== 5) return;
      const sortedRanks = kept.map((c) => c.rank).sort((a, b) => b - a);
      const r = findTop10Rank(sortedRanks);
      if (r !== -1) result.add(r);
    });
    return result;
  }, [hands, is27Low, isTripleDraw, drawRoundsLeft, playerDrawStrategies]);

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
    setHandCategories((prev) => prev.map(() => null));
    setPlayerRanges((prev) => prev.map(() => null));
    setActivePlayerIdx(null);
    setResult(null);
    setError(null);
  }

  function handleCategoryChange(playerIdx: number, category: HandCategory | null) {
    setHandCategories((prev) => {
      const next = [...prev];
      next[playerIdx] = category;
      return next;
    });
    if (category) {
      const roundIdx = Math.max(0, Math.min(3 - drawRoundsLeft, 2));
      const keepThreshold = playerDrawStrategies[playerIdx]?.[roundIdx]?.keepThreshold ?? Rank.Eight;
      const { cards, explicitDiscards } = buildStrategyAwareRepHand(playerIdx, category, keepThreshold);
      setHands((prev) => { const next = [...prev]; next[playerIdx] = cards; return next; });
      setPlayerExplicitDiscards((prev) => { const next = [...prev]; next[playerIdx] = explicitDiscards; return next; });
    } else {
      setHands((prev) => { const next = [...prev]; next[playerIdx] = emptyHand(config.holeCards); return next; });
      setPlayerExplicitDiscards((prev) => { const next = [...prev]; next[playerIdx] = emptyExplicitDiscards(); return next; });
    }
    setResult(null);
  }

  function handleRangeChange(playerIdx: number, range: RangeEntry[] | null) {
    setPlayerRanges((prev) => {
      const next = [...prev];
      next[playerIdx] = range;
      return next;
    });
    setResult(null);
  }

  function handleTop10HandSelect(rankIdx: number) {
    if (activePlayerIdx === null) return;
    const ranks = TOP_10_27[rankIdx - 1];
    if (!ranks) return;

    const blocked = allSelectedCards.filter(
      (c) => !hands[activePlayerIdx].some((h) => h?.rank === c.rank && h?.suit === c.suit)
    );

    const shuffledSuits = [...SUITS].sort(() => Math.random() - 0.5);
    const suitCount: Record<string, number> = {};
    const assigned: Card[] = [];

    for (const rank of ranks) {
      let picked: Card | null = null;
      for (const suit of shuffledSuits) {
        const card = { rank, suit };
        const isBlocked = blocked.some((b) => b.rank === rank && b.suit === suit);
        const suitUsed = (suitCount[suit] ?? 0);
        if (!isBlocked && suitUsed < 4) {
          picked = card;
          suitCount[suit] = suitUsed + 1;
          break;
        }
      }
      if (!picked) return; // can't assign without conflict
      assigned.push(picked);
    }

    // Clear category mode for this player
    setHandCategories((prev) => { const next = [...prev]; next[activePlayerIdx] = null; return next; });
    setHands((prev) => { const next = [...prev]; next[activePlayerIdx] = assigned; return next; });
    setPlayerExplicitDiscards((prev) => { const next = [...prev]; next[activePlayerIdx] = emptyExplicitDiscards(); return next; });
    setDiscards((prev) => { const next = [...prev]; next[activePlayerIdx] = emptyDiscards(config.holeCards); return next; });
    setActivePlayerIdx(null);
    setResult(null);
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
    // Recompute representative hand if this player is in category mode
    // and the affected round is the current draw round
    const currentRoundIdx = Math.max(0, Math.min(3 - drawRoundsLeft, 2));
    if (handCategories[playerIdx] && roundIdx === currentRoundIdx) {
      const { cards, explicitDiscards } = buildStrategyAwareRepHand(playerIdx, handCategories[playerIdx]!, keepThreshold);
      setHands((prev) => { const next = [...prev]; next[playerIdx] = cards; return next; });
      setPlayerExplicitDiscards((prev) => { const next = [...prev]; next[playerIdx] = explicitDiscards; return next; });
    }
    setResult(null);
  }

  function addPlayer() {
    if (hands.length >= MAX_PLAYERS) return;
    setHands((prev) => [...prev, emptyHand(config.holeCards)]);
    setDiscards((prev) => [...prev, emptyDiscards(config.holeCards)]);
    setPlayerDrawStrategies((prev) => [...prev, defaultStrategies()]);
    setPlayerExplicitDiscards((prev) => [...prev, emptyExplicitDiscards()]);
    setHandCategories((prev) => [...prev, null]);
    setPlayerRanges((prev) => [...prev, null]);
    setResult(null);
  }

  function removePlayer(idx: number) {
    if (hands.length <= 2) return;
    setHands((prev) => prev.filter((_, i) => i !== idx));
    setDiscards((prev) => prev.filter((_, i) => i !== idx));
    setPlayerDrawStrategies((prev) => prev.filter((_, i) => i !== idx));
    setPlayerExplicitDiscards((prev) => prev.filter((_, i) => i !== idx));
    setHandCategories((prev) => prev.filter((_, i) => i !== idx));
    setPlayerRanges((prev) => prev.filter((_, i) => i !== idx));
    if (activePlayerIdx === idx) setActivePlayerIdx(null);
    setResult(null);
  }

  async function calculate() {
    setLoading(true);
    setError(null);
    setResult(null);

    const boardData = board.filter((c): c is Card => c !== null);
    const hasAnyRange = playerRanges.some((r) => r && r.length > 0);

    try {
      if (!hasAnyRange) {
        const handData = hands.map((h, hi) =>
          h.filter((c, ci): c is Card => c !== null && !discards[hi][ci])
        );
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
      } else {
        // Build per-player options: range players get one option per entry, others get one fixed option
        const perPlayerOptions = hands.map((hand, i) => {
          const range = playerRanges[i];
          if (range && range.length > 0) {
            return range.map((entry) => {
              const { cards, explicitDiscards } = buildRangeHandState(entry, i);
              return {
                cards: cards.filter((c): c is Card => c !== null),
                explicitDiscards,
              };
            });
          }
          return [{
            cards: hand.filter((c, ci): c is Card => c !== null && !discards[i][ci]),
            explicitDiscards: playerExplicitDiscards[i],
          }];
        });

        // Cartesian product of all player options
        const combinations = perPlayerOptions.reduce<Array<Array<{ cards: Card[]; explicitDiscards: boolean[] }>>>(
          (acc, opts) => acc.flatMap((combo) => opts.map((opt) => [...combo, opt])),
          [[]]
        );

        const simResults = await Promise.all(
          combinations.map(async (combo) => {
            const body: Record<string, unknown> = {
              variant,
              hands: combo.map((p) => p.cards),
              board: boardData,
              iterations,
            };
            if (isTripleDraw) {
              body.drawRoundsLeft = drawRoundsLeft;
              body.playerDrawStrategies = playerDrawStrategies;
              body.playerExplicitDiscards = combo.map((p) => p.explicitDiscards);
            }
            const res = await fetch("/api/equity", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Unknown error");
            return data as SimulationResult;
          })
        );

        const n = combinations.length;
        const avgResults = hands.map((hand, i) => ({
          hand: hand.filter((c): c is Card => c !== null),
          equity: simResults.reduce((sum, r) => sum + r.results[i].equity, 0) / n,
          wins: simResults.reduce((sum, r) => sum + r.results[i].wins, 0) / n,
          ties: simResults.reduce((sum, r) => sum + r.results[i].ties, 0) / n,
          losses: simResults.reduce((sum, r) => sum + r.results[i].losses, 0) / n,
          hiWins: simResults.reduce((sum, r) => sum + r.results[i].hiWins, 0) / n,
          loWins: simResults.reduce((sum, r) => sum + r.results[i].loWins, 0) / n,
          loQualified: simResults.reduce((sum, r) => sum + r.results[i].loQualified, 0) / n,
        }));

        setResult({
          results: avgResults,
          iterationsRun: iterations,
          durationMs: simResults.reduce((sum, r) => sum + r.durationMs, 0),
        });
      }
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

      <main className="max-w-6xl mx-auto px-4 py-6 flex items-start">
        <div className="basis-2/3 min-w-0 space-y-5 pr-6">

        <div className="flex items-end gap-4 flex-wrap">
          <VariantSelector value={variant} onChange={handleVariantChange} />
          <div className="text-xs text-muted-foreground pb-1">
            {config.holeCards} hole cards
            {config.communityCards > 0 ? ` · ${config.communityCards} community cards` : " · no board"}
            {isHiLo && " · Hi-Lo split"}
          </div>
          {isTripleDraw && (
            <DrawsLeftSelector value={drawRoundsLeft} onChange={(v) => {
              setDrawRoundsLeft(v);
              const defaults = POT_ODDS_DEFAULTS[v];
              if (defaults) { setPot(defaults.pot); setBet(defaults.bet); }
              setResult(null);
            }} />
          )}
        </div>

        <Separator />

        {isSolver && <SolverPanel />}

        {!isSolver && config.communityCards > 0 && (
          <BoardInput
            cards={board}
            communityCardCount={config.communityCards}
            blockedCards={allSelectedCards}
            variant={variant}
            onCardChange={handleBoardCardChange}
          />
        )}

        {/* Sidebar (calculate + pot odds) alongside player hands */}
        {!isSolver && <div className="flex gap-4 items-start">

          {/* Left sidebar */}
          <div className="shrink-0 w-64 space-y-3">
            <div className="rounded-xl border bg-card p-3 space-y-2.5">
              <Button onClick={calculate} disabled={loading} className="w-full" size="sm">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Calculando…
                  </>
                ) : (
                  "Calculate Equity"
                )}
              </Button>
              <div className="flex items-center gap-2">
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
                    <option key={n} value={n * 1000}>{n}k</option>
                  ))}
                </select>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              {result && (
                <p className="text-xs text-muted-foreground">
                  {result.iterationsRun.toLocaleString()} iter. · {result.durationMs}ms
                </p>
              )}
            </div>

            {isTripleDraw && (
              <PotOddsPanel
                pot={pot}
                bet={bet}
                onPotChange={setPot}
                onBetChange={setBet}
                requiredEquity={requiredEquity}
              />
            )}
          </div>

          {/* Player hands */}
          <div className="flex-1 min-w-0 space-y-3">
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
                  explicitDiscards={(isTripleDraw || variant === PokerVariant.SingleDraw27) ? playerExplicitDiscards[i] : undefined}
                  handCategory={isTripleDraw ? (handCategories[i] ?? null) : null}
                  isActive={activePlayerIdx === i}
                  onCardChange={(cardIdx, card) => {
                    if (isTripleDraw && handCategories[i]) handleCategoryChange(i, null);
                    handleHandCardChange(i, cardIdx, card);
                  }}
                  onDiscardToggle={(cardIdx) => handleDiscardToggle(i, cardIdx)}
                  onDrawStrategyChange={(roundIdx, threshold) =>
                    handleDrawStrategyChange(i, roundIdx, threshold)
                  }
                  onExplicitDiscardToggle={(slotIdx) => handleExplicitDiscardToggle(i, slotIdx)}
                  onCategoryChange={isTripleDraw ? (cat) => handleCategoryChange(i, cat) : undefined}
                  playerRange={isTripleDraw ? playerRanges[i] : undefined}
                  onRangeChange={isTripleDraw ? (range) => handleRangeChange(i, range) : undefined}
                  onSetActive={() => setActivePlayerIdx(activePlayerIdx === i ? null : i)}
                  onRemove={() => removePlayer(i)}
                  canRemove={hands.length > 2}
                />
              );
            })}

            {hands.length < MAX_PLAYERS && (
              <Button variant="outline" size="sm" onClick={addPlayer}>
                <Plus className="h-4 w-4 mr-1" />
                Add Player
              </Button>
            )}
          </div>
        </div>}
        </div>

        {is27Low && (
          <div className="basis-1/3 flex justify-center pt-0">
            <Top10Panel
              activeRanks={activeTop10Ranks}
              selectableForPlayer={activePlayerIdx !== null ? activePlayerIdx + 1 : null}
              onHandSelect={handleTop10HandSelect}
            />
          </div>
        )}
      </main>
    </div>
  );
}
