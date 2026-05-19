# ProPokerTools Range Syntax Reference

Source: http://www.propokertools.com/oracle_help/range_of_hands

---

## Generic Range Syntax

Applies to all game types unless overridden by game-specific syntax.

### Wildcards

| Symbol | Meaning |
|--------|---------|
| `*`    | Any rank or suit |

### Rank Variables

Rank variables match any rank value. Two cards sharing the same variable have the same rank; different variables have different ranks.

| Variable | Meaning |
|----------|---------|
| `R`      | Any rank |
| `O`      | Any rank (different from `R`) |
| `N`      | Any rank (different from `R` and `O`) |

**Examples:**
- `RR` — any pair (two cards of the same rank, any suits)
- `RRR` — any three-of-a-kind
- `RON` — three cards all of different ranks

### Suit Variables

Suit variables match any suit. Same variable = same suit; different variables = different suits.

| Variable | Meaning |
|----------|---------|
| `w`      | Any suit |
| `x`      | Any suit (different from `w`) |
| `y`      | Any suit (different from `w` and `x`) |
| `z`      | Any suit (different from `w`, `x`, and `y`) |

**Examples:**
- `Rw Rw` — any pair of the same suit (suited pair)
- `Rw Rx` — any pair of different suits (offsuit pair)
- `Rw Ow Nw` — any three cards of the same suit (three-card flush)

### Suit Specifiers

Explicit suit designations:

| Specifier | Suit |
|-----------|------|
| `s`       | Spades |
| `h`       | Hearts |
| `d`       | Diamonds |
| `c`       | Clubs |

**Examples:**
- `As` — Ace of Spades
- `Kh` — King of Hearts
- `Td` — Ten of Diamonds

### Macros

Predefined shorthand for common hand categories:

| Macro | Meaning |
|-------|---------|
| `$B`  | Broadway cards (T, J, Q, K, A) |
| `$M`  | Middle cards (6, 7, 8, 9, T) |
| `$Z`  | Low cards for 2-7 lowball (2, 3, 4, 5, 7 — no 6) |
| `$L`  | Low cards for A-5 lowball (A, 2, 3, 4, 5) |
| `$W`  | Wheel cards (A, 2, 3, 4, 5) |
| `$P`  | Premium cards (J, Q, K, A) |
| `$S`  | Suited |
| `$O`  | Offsuit |

### Rank Spans (Straight Range)

Consecutive rank sequences using a hyphen between two rank sequences of the same length:

- `AKQJ-TJQK` — any broadway straight (A-high down to T-high), i.e. AKQJ, KQJT
- `KQJT-TJQK` — any K-high to T-high straight
- `5432A` — wheel straight (A plays low)

### Combinators

| Symbol | Meaning | Example |
|--------|---------|---------|
| `,`    | OR (union) | `AA,KK` — aces or kings |
| `:`    | AND (intersection/filter) | `RR:$B$B` — broadway pairs |
| `!`    | NOT (exclusion) | `RR!AA` — any pair except aces |

### Card Order in Stud Games

In stud-type games, card position in a range string matters:
- Cards are listed in **deal order**
- For Classic Stud, the pipe `|` separates streets (see below)
- Hole cards come before up-cards in the ordering

---

## Classic Hold'em Range Syntax

Ranges are expressed as two hole cards. Suits optional.

**Examples:**
- `AKs` — Ace-King suited
- `AKo` — Ace-King offsuit
- `AK` — Ace-King (any suits)
- `QQ+` — Queens or better (QQ, KK, AA)
- `77-TT` — Sevens through Tens
- `ATs+` — AT suited through AKs
- `ATo+` — AT offsuit through AKo

---

## Classic Omaha Range Syntax

Ranges are four hole cards. Same rank/suit variable and specifier rules apply.

**Examples:**
- `AARRs` — Any ace-ace-pair with all four cards suited (rare; mainly illustrative)
- `AA**` — Any hand containing a pair of aces
- `RRRRw` — Quads of any rank, all same suit (four-of-a-kind, monotone)

---

## Classic Stud Range Syntax

### Street Separation with Pipe `|`

The `|` character separates down cards (hole cards) from successive streets of up-cards.

Format: `<down cards> | <3rd st up> | <4th st up> | <5th st up> | ...`

**Examples:**
- `** | A` — Any two down cards, Ace showing on 3rd street
- `AA | *` — Rolled-up aces (two aces in the hole, any up card)
- `** | A | K` — Any hole cards, A up on 3rd, K up on 4th
- `RR | *` — Any rolled-up pair in the hole, any up card

### Specific Hole Card Patterns

- `AA | *` — Pocket aces with any 3rd street card
- `AK | *` — AK in the hole (any suits)
- `AKs | *` — AK suited in the hole
- `** | A | A` — Any hole cards, pair of aces showing (3rd and 4th street)

### Rank Constraints in Stud

Use rank variables to express relative rank relationships across streets:

- `RR | R` — Three-of-a-kind (trips): pair in hole + matching up card
- `RO | R` — A pair on board using one hole card: hole card matches 3rd street up card
- `RO | O` — Pair of up-cards using one hole card
- `RR | O` — Buried pair in the hole, different rank showing

### Wildcard Hole Cards

- `** | K | Q | J` — Any hole cards with K, Q, J up (potential straight draw)
- `$B$B | *` — Any broadway pair in the hole

---

## Classic Razz Range Syntax

Razz uses only down cards (all cards dealt face-down for ranking purposes). The syntax follows the same stud conventions but focuses on low card combinations.

### Down Cards Only

- `(A23)` — A, 2, 3 in any order, all different (no pair) — using parentheses for unordered/all-different
- `(A234)` — A, 2, 3, 4 — all different ranks
- `A23` — A, 2, 3 in that specific deal order

### Parentheses for All-Different Ranks

In Razz, `{}` or `()` notation means the cards can appear in any order and must all be different ranks:

- `{A2345}` — The wheel: A, 2, 3, 4, 5 in any order, all different
- `{A234*}` — A, 2, 3, 4 plus any fifth card

### Examples
- `(A2345)` — Wheel hand (best Razz hand)
- `(A234*)` — Four to the wheel with any fifth card
- `(***)` — Any three cards all of different ranks
- `(A2***)` — A and 2 plus any three other different ranks

---

## No-Pair Braces `{}`

Across game types, curly braces `{}` can denote hands where all ranks are distinct (no pair):

- `{AKQJ}` — Four broadway cards, all different ranks
- `{2345}` — Four low cards, all different ranks
- `{RON}` — Any three cards with three distinct ranks

---

## Combined Examples

```
# Hold'em
QQ+,AKs          # QQ, KK, AA, or AKs
77-JJ            # 77 through JJ
ATs+,AJo+        # AT-AK suited plus AJ-AK offsuit

# Stud (7-Card Stud High)
(AA)|*           # Wired aces (any up card)
**|A|*           # Any hole cards with ace up on 3rd street
RR|R             # Trips from the start (e.g., 888)
$B$B|*           # Broadway pair in the hole

# Razz
(A2345)          # Wheel — perfect Razz hand
(A234*)          # Four to the wheel
(***)            # Rainbow three-card start (all different ranks)

# 2-7 Triple Draw (Generic)
$Z$Z$Z$Z$Z       # Five 2-7 low cards (2,3,4,5,7 — no 6)
2345w            # 2-3-4-5 suited (draw to a straight flush)
```

---

## Notes for ProPokerTools Equity Simulations

- Ranges can be composed with `,` (OR) for board texture analysis
- Use `:` to intersect two ranges (e.g., premium hands that are also suited)
- Use `!` to exclude specific combos from a range
- For stud simulations, always include the `|` pipe to distinguish down cards from up cards per street
- The generic rank/suit variable system (`R`, `O`, `N`, `w`, `x`, `y`, `z`) is the most flexible way to express relative hand strength patterns across all game types
