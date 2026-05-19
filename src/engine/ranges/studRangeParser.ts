/**
 * ProPokerTools-compatible stud range parser and hand sampler.
 *
 * Supported syntax:
 *   *          — any card (wildcard)
 *   R, O, N    — rank variables (R=any; O≠R; N≠R,O)
 *   w, x, y, z — suit variables appended to rank token
 *   As, Kh     — specific card
 *   A, K, T    — specific rank, any suit
 *   Rw, Rx     — rank variable + suit variable
 *   $B         — Broadway (T J Q K A)
 *   $M         — Middle (6 7 8 9 T)
 *   $Z         — 2-7 low cards (2 3 4 5 7)
 *   $L / $W    — A-5 low / wheel (A 2 3 4 5)
 *   $P         — Premium (J Q K A)
 *   8+         — rank 8 or higher (rankSet ≥ 8)
 *   [8+]       — same as 8+ (bracket form)
 *   22+        — pocket pair of rank ≥ 2 (pair+ pattern)
 *   ss / hh    — both hole cards of same suit (bare suit chars)
 *   |          — street separator; excess tokens overflow to next slots
 *   ,          — OR (multiple branches)
 *
 * Slot mapping:
 *   0,1 = initial hole cards   2 = 3rd st up   3 = 4th st up
 *   4 = 5th st up   5 = 6th st up   6 = 7th st down
 */

import { Card, Rank, Suit } from "../cards";

// ── Rank / suit character maps ────────────────────────────────────────────────

const RANK_CHARS: Partial<Record<string, Rank>> = {
  "2": Rank.Two,   "3": Rank.Three, "4": Rank.Four,  "5": Rank.Five,
  "6": Rank.Six,   "7": Rank.Seven, "8": Rank.Eight, "9": Rank.Nine,
  "T": Rank.Ten,   "J": Rank.Jack,  "Q": Rank.Queen, "K": Rank.King, "A": Rank.Ace,
};

const SUIT_CHARS: Partial<Record<string, Suit>> = {
  s: Suit.Spades, h: Suit.Hearts, d: Suit.Diamonds, c: Suit.Clubs,
};

const RANK_SETS: Record<string, Rank[]> = {
  "$B": [Rank.Ten, Rank.Jack, Rank.Queen, Rank.King, Rank.Ace],
  "$M": [Rank.Six, Rank.Seven, Rank.Eight, Rank.Nine, Rank.Ten],
  "$Z": [Rank.Two, Rank.Three, Rank.Four, Rank.Five, Rank.Seven],
  "$L": [Rank.Ace, Rank.Two, Rank.Three, Rank.Four, Rank.Five],
  "$W": [Rank.Ace, Rank.Two, Rank.Three, Rank.Four, Rank.Five],
  "$P": [Rank.Jack, Rank.Queen, Rank.King, Rank.Ace],
};

const ALL_RANKS: Rank[] = Object.values(RANK_CHARS).filter((r): r is Rank => r !== undefined);

type RankVar = "R" | "O" | "N";
type SuitVar = "w" | "x" | "y" | "z";

function isSuitChar(c: string): boolean { return "shdc".includes(c); }
function isSuitVar(c: string): boolean  { return "wxyz".includes(c); }

// ── Constraint ────────────────────────────────────────────────────────────────

interface CardConstraint {
  rankFixed:  Rank | null;
  rankSet:    Rank[] | null;
  rankVar:    RankVar | null;
  rankVarSet: Rank[] | null; // restricts which ranks a rankVar may bind to (e.g. "TT+" → {T,J,Q,K,A})
  rankAny:    boolean;
  suitFixed: Suit | null;
  suitVar:   SuitVar | null;
  suitAny:   boolean;
}

const WILDCARD: CardConstraint = {
  rankFixed: null, rankSet: null, rankVar: null, rankVarSet: null, rankAny: true,
  suitFixed: null, suitVar: null, suitAny: true,
};

// ── Tokenizer ─────────────────────────────────────────────────────────────────

function tokenizeStreet(s: string): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    if (ch === " " || ch === "\t") { i++; continue; }

    // Bracket notation: [8+], [T+], …
    if (ch === "[") {
      let j = i + 1;
      while (j < s.length && s[j] !== "]") j++;
      tokens.push("[" + s.slice(i + 1, j) + "]");
      i = j + 1;
      continue;
    }

    // Macro: $X[suitSuffix]
    if (ch === "$" && i + 1 < s.length) {
      const key = "$" + s[i + 1];
      if (RANK_SETS[key]) {
        let token = key;
        i += 2;
        if (i < s.length && (isSuitChar(s[i]) || isSuitVar(s[i]))) {
          token += s[i++];
        } else if (i < s.length && s[i] === "*") {
          i++;
        }
        tokens.push(token);
        continue;
      }
    }

    // Wildcard [suitVar]: *, *w, *x, *y, *z
    if (ch === "*") {
      let token = "*"; i++;
      if (i < s.length && isSuitVar(s[i])) token += s[i++];
      tokens.push(token);
      continue;
    }

    // Rank variable: R, O, N [suitSuffix]
    if (ch === "R" || ch === "O" || ch === "N") {
      let token = ch; i++;
      if (i < s.length && (isSuitChar(s[i]) || isSuitVar(s[i]))) token += s[i++];
      tokens.push(token);
      continue;
    }

    // Specific rank [suitChar] [+]
    if (RANK_CHARS[ch] !== undefined) {
      // Pair-range: XY-ZW (e.g. "22-55", "99-KK") — both chars must be the same rank
      if (i + 4 < s.length &&
          s[i + 1] === ch &&
          s[i + 2] === '-' &&
          RANK_CHARS[s[i + 3].toUpperCase()] !== undefined &&
          s[i + 4] === s[i + 3]) {
        tokens.push(ch + ch + '-' + s[i + 3] + s[i + 3]);
        i += 5;
        continue;
      }
      let token = ch; i++;
      if (i < s.length && (isSuitChar(s[i]) || isSuitVar(s[i]))) token += s[i++];
      if (i < s.length && s[i] === "+") token += s[i++];
      tokens.push(token);
      continue;
    }

    // Bare suit char (e.g., "s" in "ss", "h" in "hh")
    if (isSuitChar(ch)) {
      tokens.push("*" + ch);
      i++;
      continue;
    }

    i++; // skip unknown
  }

  return tokens;
}

// ── Token → Constraint ────────────────────────────────────────────────────────

function ranksPlusOrHigher(minRank: Rank): Rank[] {
  return ALL_RANKS.filter(r => r >= minRank);
}

function parseToken(token: string): CardConstraint {
  if (token === "*") return { ...WILDCARD };

  // Wildcard + suit variable: *w, *x, *y, *z
  if (token.length === 2 && token[0] === "*" && isSuitVar(token[1])) {
    return {
      rankFixed: null, rankSet: null, rankVar: null, rankVarSet: null, rankAny: true,
      suitFixed: null, suitVar: token[1] as SuitVar, suitAny: false,
    };
  }

  // Bare suit: "*s", "*h", "*d", "*c"
  if (token.length === 2 && token[0] === "*" && isSuitChar(token[1])) {
    return {
      rankFixed: null, rankSet: null, rankVar: null, rankVarSet: null, rankAny: true,
      suitFixed: SUIT_CHARS[token[1]] ?? null, suitVar: null, suitAny: false,
    };
  }

  // Bracket notation: [8+], [T+], …
  if (token.startsWith("[") && token.endsWith("]")) {
    const content = token.slice(1, -1);
    if (content.endsWith("+")) {
      const rankChar = content.slice(0, -1).toUpperCase();
      const minRank = RANK_CHARS[rankChar];
      if (minRank !== undefined) {
        return {
          rankFixed: null, rankSet: ranksPlusOrHigher(minRank), rankVar: null, rankVarSet: null, rankAny: false,
          suitFixed: null, suitVar: null, suitAny: true,
        };
      }
    }
    return { ...WILDCARD };
  }

  // Rank+ without brackets: "8+", "T+" (length 2 — one rank char + "+")
  if (token.length === 2 && token.endsWith("+")) {
    const rankChar = token[0].toUpperCase();
    const minRank = RANK_CHARS[rankChar];
    if (minRank !== undefined) {
      return {
        rankFixed: null, rankSet: ranksPlusOrHigher(minRank), rankVar: null, rankVarSet: null, rankAny: false,
        suitFixed: null, suitVar: null, suitAny: true,
      };
    }
  }

  // Macro: $B, $L, etc.
  for (const [key, ranks] of Object.entries(RANK_SETS)) {
    if (token === key) {
      return { rankFixed: null, rankSet: ranks, rankVar: null, rankVarSet: null, rankAny: false,
               suitFixed: null, suitVar: null, suitAny: true };
    }
    if (token.startsWith(key) && token.length > key.length) {
      const suffix = token.slice(key.length);
      return {
        rankFixed: null, rankSet: ranks, rankVar: null, rankVarSet: null, rankAny: false,
        suitFixed: SUIT_CHARS[suffix] ?? null,
        suitVar:   isSuitVar(suffix) ? (suffix as SuitVar) : null,
        suitAny:   !isSuitChar(suffix) && !isSuitVar(suffix),
      };
    }
  }

  // Rank variable: R, O, N [suitSuffix]
  const firstCh = token[0];
  if (firstCh === "R" || firstCh === "O" || firstCh === "N") {
    const suffix = token.slice(1);
    return {
      rankFixed: null, rankSet: null, rankVar: firstCh as RankVar, rankVarSet: null, rankAny: false,
      suitFixed: SUIT_CHARS[suffix] ?? null,
      suitVar:   isSuitVar(suffix) ? (suffix as SuitVar) : null,
      suitAny:   !suffix || (!isSuitChar(suffix) && !isSuitVar(suffix)),
    };
  }

  // Specific rank [suitChar] [trailing +]
  if (RANK_CHARS[firstCh] !== undefined) {
    const rank = RANK_CHARS[firstCh]!;
    const rest = token.slice(1).replace(/\+$/, "");
    const suitFixed = SUIT_CHARS[rest] ?? null;
    const suitVar   = isSuitVar(rest) ? (rest as SuitVar) : null;
    return {
      rankFixed: rank, rankSet: null, rankVar: null, rankVarSet: null, rankAny: false,
      suitFixed,
      suitVar,
      suitAny: !suitFixed && !suitVar,
    };
  }

  return { ...WILDCARD };
}

// ── Branch parser ─────────────────────────────────────────────────────────────

const STUD_SLOTS = 7;

/**
 * Detect "XX+" pair pattern: two tokens where the second equals the first + "+".
 * Examples: ["2","2+"] → Rank.Two, ["T","T+"] → Rank.Ten.
 */
function detectPairPlus(t0: string, t1: string): Rank | null {
  if (!t1.endsWith("+")) return null;
  if (t0 !== t1.slice(0, -1)) return null;
  return RANK_CHARS[t0.toUpperCase()] ?? null;
}

function parseBranch(pattern: string): CardConstraint[] {
  const constraints: CardConstraint[] = [];

  // Flatten all tokens across pipe-separated streets
  const allTokens: string[] = [];
  for (const street of pattern.split("|").map(s => s.trim())) {
    allTokens.push(...tokenizeStreet(street));
  }

  // Detect pair-range pattern: single token "XY-ZW" (e.g. "22-55")
  if (allTokens.length >= 1) {
    const t0 = allTokens[0];
    if (t0.length === 5 && t0[1] === t0[0] && t0[2] === '-' && t0[4] === t0[3] &&
        RANK_CHARS[t0[0].toUpperCase()] !== undefined && RANK_CHARS[t0[3].toUpperCase()] !== undefined) {
      const minRank = RANK_CHARS[t0[0].toUpperCase()]!;
      const maxRank = RANK_CHARS[t0[3].toUpperCase()]!;
      const rankVarSet = ALL_RANKS.filter(r => r >= minRank && r <= maxRank);
      const pairSlot = (): CardConstraint => ({
        rankFixed: null, rankSet: null, rankVar: "R", rankVarSet,
        rankAny: false, suitFixed: null, suitVar: null, suitAny: true,
      });
      constraints.push(pairSlot(), pairSlot());
      for (let j = 1; j < allTokens.length && constraints.length < STUD_SLOTS; j++) {
        constraints.push(parseToken(allTokens[j]));
      }
      while (constraints.length < STUD_SLOTS) constraints.push({ ...WILDCARD });
      return constraints;
    }
  }

  // Detect pair+ pattern in first two tokens: e.g., ["2","2+"] or ["T","T+"]
  if (allTokens.length >= 2) {
    const minRank = detectPairPlus(allTokens[0], allTokens[1]);
    if (minRank !== null) {
      const rankVarSet = ranksPlusOrHigher(minRank);
      const pairSlot = (): CardConstraint => ({
        rankFixed: null, rankSet: null, rankVar: "R", rankVarSet,
        rankAny: false, suitFixed: null, suitVar: null, suitAny: true,
      });
      constraints.push(pairSlot(), pairSlot());
      for (let i = 2; i < allTokens.length && constraints.length < STUD_SLOTS; i++) {
        constraints.push(parseToken(allTokens[i]));
      }
      while (constraints.length < STUD_SLOTS) constraints.push({ ...WILDCARD });
      return constraints;
    }
  }

  // Normal sequential assignment to slots 0-6
  for (let i = 0; i < allTokens.length && constraints.length < STUD_SLOTS; i++) {
    constraints.push(parseToken(allTokens[i]));
  }
  while (constraints.length < STUD_SLOTS) constraints.push({ ...WILDCARD });

  return constraints;
}

// ── Public parser ─────────────────────────────────────────────────────────────

export interface ParsedStudBranch {
  constraints: CardConstraint[];
}
export type ParsedStudRange = ParsedStudBranch[];

export function parseStudRange(pattern: string): ParsedStudRange | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;
  try {
    const rawBranches = trimmed.split(",").map(b => b.trim()).filter(Boolean);
    const lastIdx = rawBranches.length - 1;
    const lastBranch = rawBranches[lastIdx];
    const otherBranches = rawBranches.slice(0, lastIdx);
    const lastHasPipe = lastBranch.includes("|");
    const othersHavePipe = otherBranches.some(b => b.includes("|"));

    // When only the last branch carries a |street_suffix, that suffix is shared
    // across ALL branches — the player always has those upcards regardless of hole cards.
    let branchStrings: string[];
    if (lastHasPipe && !othersHavePipe && otherBranches.length > 0) {
      const pipeIdx = lastBranch.indexOf("|");
      const streetSuffix = lastBranch.slice(pipeIdx);
      const lastHoleOnly = lastBranch.slice(0, pipeIdx);
      branchStrings = [...otherBranches, lastHoleOnly].map(b => b + streetSuffix);
    } else {
      branchStrings = rawBranches;
    }

    const branches = branchStrings.map(b => ({ constraints: parseBranch(b) }));
    return branches.length > 0 ? branches : null;
  } catch {
    return null;
  }
}

// ── Sampler ───────────────────────────────────────────────────────────────────

interface VarBindings {
  rank: Partial<Record<RankVar, Rank>>;
  suit: Partial<Record<SuitVar, Suit>>;
}

function sampleConstraint(
  c: CardConstraint,
  available: Card[],
  b: VarBindings
): Card | null {
  let candidates = available;

  if (c.rankFixed !== null) {
    candidates = candidates.filter(x => x.rank === c.rankFixed);
  } else if (c.rankVar !== null) {
    const bound = b.rank[c.rankVar];
    if (bound !== undefined) {
      candidates = candidates.filter(x => x.rank === bound);
    } else {
      const used = new Set(Object.values(b.rank) as Rank[]);
      if (c.rankVarSet) {
        const allowed = new Set(c.rankVarSet.filter(r => !used.has(r)));
        candidates = candidates.filter(x => allowed.has(x.rank));
      } else {
        candidates = candidates.filter(x => !used.has(x.rank));
      }
    }
  } else if (c.rankSet !== null) {
    const set = new Set(c.rankSet);
    candidates = candidates.filter(x => set.has(x.rank));
  }

  if (c.suitFixed !== null) {
    candidates = candidates.filter(x => x.suit === c.suitFixed);
  } else if (c.suitVar !== null) {
    const bound = b.suit[c.suitVar];
    if (bound !== undefined) {
      candidates = candidates.filter(x => x.suit === bound);
    } else {
      const used = new Set(Object.values(b.suit) as Suit[]);
      candidates = candidates.filter(x => !used.has(x.suit));
    }
  }

  if (candidates.length === 0) return null;

  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  if (c.rankVar && b.rank[c.rankVar] === undefined) b.rank[c.rankVar] = picked.rank;
  if (c.suitVar && b.suit[c.suitVar] === undefined) b.suit[c.suitVar] = picked.suit;

  return picked;
}

// Detect unordered-pair double-counting in asymmetric branches (e.g. A* where slot0=Ace,
// slot1=wildcard: both [Ah,As] and [As,Ah] satisfy the branch but represent the same hand).
// Returns true if swapping the two sampled hole cards would also be valid for the branch.
function swapSlots01IsValid(c0: CardConstraint, c1: CardConstraint, card0: Card, card1: Card): boolean {
  const b: VarBindings = { rank: {}, suit: {} };
  if (filterCandidates(c0, [card1], b).length === 0) return false;
  if (c0.rankVar && b.rank[c0.rankVar] === undefined) b.rank[c0.rankVar] = card1.rank;
  if (c0.suitVar && b.suit[c0.suitVar] === undefined) b.suit[c0.suitVar] = card1.suit;
  return filterCandidates(c1, [card0], b).length > 0;
}

export function sampleStudHand(
  range: ParsedStudRange,
  available: Card[],
  maxRetries = 30,
  branchWeights?: number[]
): Card[] | null {
  const useWeights = branchWeights && branchWeights.length === range.length;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let branchIdx: number;
    if (useWeights) {
      const r = Math.random();
      let cum = 0;
      branchIdx = range.length - 1;
      for (let i = 0; i < branchWeights!.length; i++) {
        cum += branchWeights![i];
        if (r < cum) { branchIdx = i; break; }
      }
    } else {
      branchIdx = Math.floor(Math.random() * range.length);
    }

    const branch = range[branchIdx];
    const constraints = branch.constraints;
    const result: (Card | null)[] = new Array(constraints.length).fill(null);
    let pool = [...available];
    let ok = true;

    // Phase 1: pre-assign all fully-specified (rankFixed + suitFixed) slots first.
    // This prevents variable slots from accidentally consuming a card needed by a
    // specific fixed slot later (e.g., a diamond hole card stealing Ad when slot2=Ad).
    for (let i = 0; i < constraints.length; i++) {
      const c = constraints[i];
      if (c.rankFixed !== null && c.suitFixed !== null) {
        const idx = pool.findIndex(x => x.rank === c.rankFixed && x.suit === c.suitFixed);
        if (idx < 0) { ok = false; break; }
        result[i] = pool[idx];
        pool.splice(idx, 1);
      }
    }
    if (!ok) continue;

    // Phase 2: sample remaining (variable) slots in slot order.
    const bindings: VarBindings = { rank: {}, suit: {} };
    for (let i = 0; i < constraints.length; i++) {
      if (result[i] !== null) continue; // already assigned in phase 1
      const c = constraints[i];
      const card = sampleConstraint(c, pool, bindings);
      if (!card) { ok = false; break; }
      result[i] = card;
      pool = pool.filter(x => !(x.rank === card.rank && x.suit === card.suit));
    }
    if (!ok) continue;

    // Unordered-pair deduplication: asymmetric branches (e.g. A*, J*, K*) treat [Ah,As]
    // and [As,Ah] as distinct ordered samples, but they represent the same hand. Reject
    // one ordering with 50% probability so each unordered pair gets equal weight.
    // Guard: symmetric branches (dd, 22+) already sample uniformly — skip them.
    if (!holeCardsAreSymmetric(branch) &&
        result[0] !== null && result[1] !== null &&
        swapSlots01IsValid(constraints[0], constraints[1], result[0]!, result[1]!) &&
        Math.random() < 0.5) {
      continue;
    }

    // First-match exclusivity: reject if this hand also satisfies an earlier branch.
    // This prevents overlapping branches (e.g. [8+][8+] ⊂ 22+) from double-sampling the same hand.
    if (branchIdx > 0) {
      if (range.slice(0, branchIdx).some(b => handMatchesBranch(result, b))) continue;
    }

    return result as Card[];
  }

  return null;
}

/**
 * Compute per-branch sampling weights using constrained-slot combo counts from the
 * available deck (dead cards already removed). Wildcards are skipped so only the
 * constrained slots contribute — this mirrors how PPT weights branches by the number
 * of distinct valid hands for each branch given the current game state.
 */
export function computeBranchWeights(range: ParsedStudRange, deck: Card[]): number[] {
  const counts = range.map((branch, i) => {
    const earlierBranches = range.slice(0, i);
    const lc = lastConstrainedIdx(branch.constraints);
    let ordered: number;
    if (earlierBranches.length === 0) {
      ordered = countConstraints(branch.constraints, deck, { rank: {}, suit: {} }, 0);
    } else {
      const chosen: (Card | null)[] = new Array(branch.constraints.length).fill(null);
      ordered = countExclusiveCombos(
        branch.constraints, deck, { rank: {}, suit: {} }, 0, chosen, earlierBranches, lc
      );
    }
    return holeCardsAreSymmetric(branch) ? ordered / 2 : ordered;
  });
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return range.map(() => 1 / range.length);
  return counts.map(c => c / total);
}

// ── Display helpers ────────────────────────────────────────────────────────────

const RANK_DISPLAY: Partial<Record<Rank, string>> = {
  [Rank.Two]: "2", [Rank.Three]: "3", [Rank.Four]: "4", [Rank.Five]: "5",
  [Rank.Six]: "6", [Rank.Seven]: "7", [Rank.Eight]: "8", [Rank.Nine]: "9",
  [Rank.Ten]: "T", [Rank.Jack]: "J", [Rank.Queen]: "Q", [Rank.King]: "K", [Rank.Ace]: "A",
};

const SUIT_DISPLAY: Partial<Record<Suit, string>> = {
  [Suit.Spades]: "♠", [Suit.Hearts]: "♥", [Suit.Diamonds]: "♦", [Suit.Clubs]: "♣",
};

const MACRO_DISPLAY: Record<string, string> = {
  "$B": "Broadway (T-A)", "$M": "Médio (6-T)", "$Z": "Baixo 2-7",
  "$L": "Baixo A-5", "$W": "Wheel (A-5)", "$P": "Premium (J-A)",
};

function rankSetName(ranks: Rank[]): string {
  for (const [k, rs] of Object.entries(RANK_SETS)) {
    if (rs.length === ranks.length && rs.every(r => ranks.includes(r))) {
      return MACRO_DISPLAY[k] ?? k;
    }
  }
  return "grupo";
}

function isWildcard(c: CardConstraint): boolean {
  return c.rankAny && c.suitAny;
}

// Two constraints are equivalent if any card satisfying one also satisfies the other
// (used to detect symmetric hole-card slots like "hh" or pair hands "22+").
function constraintsEquivalent(a: CardConstraint, b: CardConstraint): boolean {
  if (a.rankFixed !== b.rankFixed) return false;
  if (a.rankVar !== b.rankVar) return false;
  if (a.rankAny !== b.rankAny) return false;
  if (a.suitFixed !== b.suitFixed) return false;
  if (a.suitVar !== b.suitVar) return false;
  if (a.suitAny !== b.suitAny) return false;
  const rsA = a.rankSet, rsB = b.rankSet;
  if ((rsA === null) !== (rsB === null)) return false;
  if (rsA !== null && rsB !== null &&
      (rsA.length !== rsB.length || !rsA.every((r, i) => r === rsB[i]))) return false;
  const vsA = a.rankVarSet, vsB = b.rankVarSet;
  if ((vsA === null) !== (vsB === null)) return false;
  if (vsA !== null && vsB !== null &&
      (vsA.length !== vsB.length || !vsA.every((r, i) => r === vsB[i]))) return false;
  return true;
}

// Hole cards (slots 0 and 1) are interchangeable when both have identical constraints.
// When true, the ordered count from countConstraints double-counts {A,B} and {B,A},
// so we divide by 2 to get the correct combination count.
function holeCardsAreSymmetric(branch: ParsedStudBranch): boolean {
  if (branch.constraints.length < 2) return false;
  return constraintsEquivalent(branch.constraints[0], branch.constraints[1]);
}

function slotLabel(c: CardConstraint): string | null {
  if (isWildcard(c)) return null;
  const rank = c.rankFixed !== null ? (RANK_DISPLAY[c.rankFixed] ?? "?")
    : c.rankVar !== null ? c.rankVar
    : c.rankSet !== null ? rankSetName(c.rankSet)
    : "*";
  const suit = c.suitFixed !== null ? (SUIT_DISPLAY[c.suitFixed] ?? "") : "";
  return rank + suit;
}

function describeBranch(b: ParsedStudBranch): string {
  const c = b.constraints;
  if (c.every(isWildcard)) return "Qualquer mão";

  const h0 = c[0], h1 = c[1];
  const upCards = c.slice(2, 6);
  const river = c[6];
  const parts: string[] = [];

  // Suited hole: both rankAny, same fixed suit (e.g., "ss", "hh")
  if (h0.rankAny && h1.rankAny && h0.suitFixed !== null && h0.suitFixed === h1.suitFixed) {
    const suitEmoji = SUIT_DISPLAY[h0.suitFixed] ?? "";
    parts.push(`Suited no buraco ${suitEmoji}`);
  }
  // Pocket pair (same rank variable in both hole cards)
  else if (h0.rankVar !== null && h0.rankVar === h1.rankVar) {
    const pairVar = h0.rankVar;
    const tripsIdx = c.findIndex((cc, i) => i >= 2 && cc.rankVar === pairVar);
    if (tripsIdx >= 2) {
      const streets = ["3ª", "4ª", "5ª", "6ª", "7ª"];
      return `Trips desde a ${streets[tripsIdx - 2]} rua`;
    }
    const suitedHole = h0.suitVar !== null && h1.suitVar !== null && h0.suitVar === h1.suitVar;
    parts.push(suitedHole ? "Par fechado suited" : "Par fechado");
  }
  // Other hole constraints
  else if (!isWildcard(h0) || !isWildcard(h1)) {
    const hl = [slotLabel(h0), slotLabel(h1)].filter(Boolean);
    if (hl.length > 0) parts.push(hl.join(" ") + " no buraco");
  }

  // Showing cards (3rd–6th street)
  const upLabels = upCards.map(slotLabel).filter(Boolean);
  if (upLabels.length > 0) parts.push(upLabels.join(" ") + " aparente");

  // 7th street
  const riverLabel = slotLabel(river);
  if (riverLabel) parts.push(`7ª: ${riverLabel}`);

  return parts.length > 0 ? parts.join(" · ") : "Qualquer mão";
}

export function describeStudRange(range: ParsedStudRange): string {
  if (range.length === 0) return "";
  const descs = range.map(describeBranch);
  return [...new Set(descs)].join(" ou ");
}

// ── Combo counter ─────────────────────────────────────────────────────────────

export const MAX_COMBO_COUNT = 2_000_000;

// Check if a (possibly partial) hand satisfies all non-wildcard constraints in a branch
// for a specific card ordering.
function matchBranchOrdered(chosen: (Card | null)[], branch: ParsedStudBranch): boolean {
  const bindings: VarBindings = { rank: {}, suit: {} };
  for (let i = 0; i < branch.constraints.length; i++) {
    const c = branch.constraints[i];
    if (isWildcard(c)) continue;
    const card = i < chosen.length ? chosen[i] : null;
    if (!card) continue; // tail wildcard slot — conservatively no exclusion

    if (c.rankFixed !== null) {
      if (card.rank !== c.rankFixed) return false;
    } else if (c.rankVar !== null) {
      const bound = bindings.rank[c.rankVar];
      if (bound !== undefined) {
        if (card.rank !== bound) return false;
      } else {
        if (c.rankVarSet && !c.rankVarSet.includes(card.rank)) return false;
        const usedRanks = new Set(Object.values(bindings.rank) as Rank[]);
        if (usedRanks.has(card.rank)) return false;
        bindings.rank[c.rankVar] = card.rank;
      }
    } else if (c.rankSet !== null) {
      if (!c.rankSet.includes(card.rank)) return false;
    }

    if (c.suitFixed !== null) {
      if (card.suit !== c.suitFixed) return false;
    } else if (c.suitVar !== null) {
      const bound = bindings.suit[c.suitVar];
      if (bound !== undefined) {
        if (card.suit !== bound) return false;
      } else {
        const usedSuits = new Set(Object.values(bindings.suit) as Suit[]);
        if (usedSuits.has(card.suit)) return false;
        bindings.suit[c.suitVar] = card.suit;
      }
    }
  }
  return true;
}

// Hole cards (slots 0 and 1) are unordered, so check both orderings to avoid
// cross-branch double-counting when a sampled hand's slots are in the "wrong" order.
function handMatchesBranch(chosen: (Card | null)[], branch: ParsedStudBranch): boolean {
  if (matchBranchOrdered(chosen, branch)) return true;
  if (chosen[0] !== null && chosen[1] !== null) {
    const swapped = [chosen[1], chosen[0], ...chosen.slice(2)];
    return matchBranchOrdered(swapped, branch);
  }
  return false;
}

function filterCandidates(c: CardConstraint, pool: Card[], b: VarBindings): Card[] {
  let cands = pool;

  if (c.rankFixed !== null) {
    cands = cands.filter(x => x.rank === c.rankFixed);
  } else if (c.rankVar !== null) {
    const bound = b.rank[c.rankVar];
    if (bound !== undefined) {
      cands = cands.filter(x => x.rank === bound);
    } else {
      const used = new Set(Object.values(b.rank) as Rank[]);
      if (c.rankVarSet) {
        const allowed = new Set(c.rankVarSet.filter(r => !used.has(r)));
        cands = cands.filter(x => allowed.has(x.rank));
      } else {
        cands = cands.filter(x => !used.has(x.rank));
      }
    }
  } else if (c.rankSet !== null) {
    const rs = new Set(c.rankSet);
    cands = cands.filter(x => rs.has(x.rank));
  }

  if (c.suitFixed !== null) {
    cands = cands.filter(x => x.suit === c.suitFixed);
  } else if (c.suitVar !== null) {
    const bound = b.suit[c.suitVar];
    if (bound !== undefined) {
      cands = cands.filter(x => x.suit === bound);
    } else {
      const used = new Set(Object.values(b.suit) as Suit[]);
      cands = cands.filter(x => !used.has(x.suit));
    }
  }

  return cands;
}

function lastConstrainedIdx(constraints: CardConstraint[]): number {
  for (let i = constraints.length - 1; i >= 0; i--) {
    if (!isWildcard(constraints[i])) return i;
  }
  return -1;
}

function countConstraints(
  constraints: CardConstraint[],
  pool: Card[],
  bindings: VarBindings,
  idx: number,
  lastConstr?: number
): number {
  if (idx === constraints.length) return 1;
  const lc = lastConstr ?? lastConstrainedIdx(constraints);
  const c = constraints[idx];

  if (isWildcard(c)) {
    if (idx > lc && idx >= 2) {
      // Tail wildcard for upcard slots (idx≥2) — skip without consuming a card.
      // Slot 1 (the second hole card) is never skipped: A* and Kd* branches have
      // lc=0 but slot1=* should still be weighted by the remaining pool size,
      // otherwise their weight becomes 1 instead of ~51 and the branch is massively
      // undersampled compared to JT+/KT+ which have slot1 constrained.
      return countConstraints(constraints, pool, bindings, idx + 1, lc);
    }
    // Interior wildcard — iterate over all valid pool cards
    // so branches like "7*|7h" aren't systematically underweighted vs fully-constrained branches.
    let total = 0;
    for (const card of pool) {
      const newPool = pool.filter(x => !(x.rank === card.rank && x.suit === card.suit));
      total += countConstraints(constraints, newPool, bindings, idx + 1, lc);
      if (total >= MAX_COMBO_COUNT) return MAX_COMBO_COUNT;
    }
    return total;
  }

  const cands = filterCandidates(c, pool, bindings);
  let total = 0;
  for (const card of cands) {
    const nb: VarBindings = { rank: { ...bindings.rank }, suit: { ...bindings.suit } };
    if (c.rankVar && nb.rank[c.rankVar] === undefined) nb.rank[c.rankVar] = card.rank;
    if (c.suitVar && nb.suit[c.suitVar] === undefined) nb.suit[c.suitVar] = card.suit;
    const newPool = pool.filter(x => !(x.rank === card.rank && x.suit === card.suit));
    total += countConstraints(constraints, newPool, nb, idx + 1, lc);
    if (total >= MAX_COMBO_COUNT) return MAX_COMBO_COUNT;
  }
  return total;
}

// Like countConstraints but rejects hands already covered by an earlier branch (first-match exclusive).
// chosen[] is mutated in-place (backtracking); caller must pre-allocate with length = constraints.length.
function countExclusiveCombos(
  constraints: CardConstraint[],
  pool: Card[],
  bindings: VarBindings,
  idx: number,
  chosen: (Card | null)[],
  earlierBranches: ParsedStudBranch[],
  lc: number
): number {
  if (idx === constraints.length) {
    if (earlierBranches.length > 0 && earlierBranches.some(b => handMatchesBranch(chosen, b))) return 0;
    return 1;
  }
  const c = constraints[idx];

  if (isWildcard(c)) {
    if (idx > lc && idx >= 2) {
      chosen[idx] = null;
      return countExclusiveCombos(constraints, pool, bindings, idx + 1, chosen, earlierBranches, lc);
    }
    let total = 0;
    for (const card of pool) {
      const newPool = pool.filter(x => !(x.rank === card.rank && x.suit === card.suit));
      chosen[idx] = card;
      total += countExclusiveCombos(constraints, newPool, bindings, idx + 1, chosen, earlierBranches, lc);
      if (total >= MAX_COMBO_COUNT) return MAX_COMBO_COUNT;
    }
    return total;
  }

  const cands = filterCandidates(c, pool, bindings);
  let total = 0;
  for (const card of cands) {
    const nb: VarBindings = { rank: { ...bindings.rank }, suit: { ...bindings.suit } };
    if (c.rankVar && nb.rank[c.rankVar] === undefined) nb.rank[c.rankVar] = card.rank;
    if (c.suitVar && nb.suit[c.suitVar] === undefined) nb.suit[c.suitVar] = card.suit;
    const newPool = pool.filter(x => !(x.rank === card.rank && x.suit === card.suit));
    chosen[idx] = card;
    total += countExclusiveCombos(constraints, newPool, nb, idx + 1, chosen, earlierBranches, lc);
    if (total >= MAX_COMBO_COUNT) return MAX_COMBO_COUNT;
  }
  return total;
}

function createFullDeck(): Card[] {
  const ranks = Object.values(RANK_CHARS).filter((r): r is Rank => r !== undefined);
  const suits = Object.values(SUIT_CHARS).filter((s): s is Suit => s !== undefined);
  const cards: Card[] = [];
  for (const rank of ranks) for (const suit of suits) cards.push({ rank, suit });
  return cards;
}

export function countRangeCombinations(range: ParsedStudRange, deck?: Card[]): number | null {
  if (!range.some(b => b.constraints.some(c => !isWildcard(c)))) return null;
  const pool = deck ?? createFullDeck();
  let total = 0;
  for (let i = 0; i < range.length; i++) {
    const branch = range[i];
    const earlierBranches = range.slice(0, i);
    const lc = lastConstrainedIdx(branch.constraints);
    let ordered: number;
    if (earlierBranches.length === 0) {
      ordered = countConstraints(branch.constraints, pool, { rank: {}, suit: {} }, 0);
    } else {
      const chosen: (Card | null)[] = new Array(branch.constraints.length).fill(null);
      ordered = countExclusiveCombos(
        branch.constraints, pool, { rank: {}, suit: {} }, 0, chosen, earlierBranches, lc
      );
    }
    total += holeCardsAreSymmetric(branch) ? ordered / 2 : ordered;
    if (total >= MAX_COMBO_COUNT) return MAX_COMBO_COUNT;
  }
  return total;
}
