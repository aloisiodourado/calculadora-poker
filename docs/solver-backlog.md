# Backlog — Fixed-Limit 2-7 Triple Draw Solver

## Objetivo

Implementar um solver GTO para 2-7 Triple Draw em formato **heads-up fixed-limit**, usando o algoritmo **CFR+ (Counterfactual Regret Minimization Plus)**. O solver roda offline em Node.js, exporta strategy tables como JSON, e o web app faz lookup estático.

---

## Decisões de design

- **Formato:** Heads-up, Fixed-Limit
- **Estrutura de apostas:** 4 ruas (pré-draw, pós-draw-1, pós-draw-2, pós-draw-3); apostas pequenas nas 2 primeiras ruas, grandes nas 2 últimas; cap de 4 bets por rua
- **Ações:** `fold | check/call | bet/raise` — sem abstração de tamanho de aposta (vantagem do FL)
- **Hand buckets iniciais:** 20 buckets por street (pode ser ampliado)
- **Algoritmo:** CFR+

---

## Estrutura de arquivos planejada

```
src/solver/
  game/
    types.ts              — GameState, InfoSet, Action, Street
    rules.ts              — regras FL: quando bet/raise é válido, cap, etc.
    draw.ts               — lógica de draw: quais cartas manter dado um bucket
  abstraction/
    handBuckets.ts        — mão de 5 cartas → bucket (0..N)
    bucketTransition.ts   — bucket × draw_count → distribuição de buckets futuros
  cfr/
    cfr.ts                — algoritmo CFR+ (travessia recursiva)
    strategy.ts           — armazenamento de estratégia + average strategy
    trainer.ts            — loop de treinamento com convergência
  scripts/
    train.ts              — script Node.js que roda o solver offline
    export.ts             — exporta strategy tables para JSON
```

---

## Etapas de implementação

### Etapa 1 — Tipos e regras do jogo ✅
Definir `GameState` (street, pot, posição, histórico de bets, cards drawn pelo oponente), ações válidas por estado, condições terminais.

> **Desbloqueador**: sem os tipos e regras corretos, nenhuma etapa seguinte funciona.

### Etapa 2 — Abstração de mãos ✅
Mapear cada mão de 5 cartas para um bucket. Estratégia:

- **Pre-draw:** bucket baseado em quantas cartas boas (≤8, sem par, sem straight/flush) e potencial de draw
- **Post-draw-3:** bucket = rank direto da mão feita
- **Streets intermediárias:** percentil de equidade simulada

> **Ponto mais crítico**: a qualidade da abstração impacta diretamente a qualidade da solução.

### Etapa 3 — Transições de bucket ✅
Pré-computar via Monte Carlo: dado bucket B e K cartas descartadas, qual a distribuição de buckets possíveis na próxima street?

```
bucketTransitions[bucket][drawCount] → { bucket: probabilidade }[]
```

### Etapa 4 — CFR+ ✅
```
cfr(state, reach_p0, reach_p1):
  if terminal → return payoff
  if draw node:
    para cada draw action (0..5):
      sample bucket via transition matrix
      recurse
  if betting node:
    para cada ação válida (fold, check/call, bet/raise):
      recurse → acumular counterfactual values
    atualizar regrets e strategy
```

> O algoritmo em si é ~100 linhas. CFR+ atualiza regrets com `max(r, 0)` em vez de acumular negativos — converge mais rápido.

### Etapa 5 — Trainer e export ✅
Script offline que itera CFR+ até exploitabilidade < 0,5% do pot, depois exporta strategy tables como JSON comprimido para consumo no web app.

### Etapa 6 — Integração no web app ✅
Lookup estático: dado (hand bucket, street, pot odds, histórico de bet) → retornar distribuição de ações GTO recomendada.

---

## Estimativa de tamanho do problema

Com 20 buckets × 4 streets × 6 possíveis draws do oponente × ~25 históricos de bet:

```
~20 × 6 × 25 × 4 ≈ 12.000 infosets por jogador
Cada infoset: 3 floats (fold / call / raise)
Total de estratégia: ~72KB
```

Com 50 buckets: ~180KB — ainda trivial. CFR converge em minutos no Node.js.

---

## Estimativa de prazo

| Etapa | Esforço estimado |
|---|---|
| 1 — Tipos e regras | 1 semana |
| 2 — Abstração de mãos | 2 semanas |
| 3 — Transições de bucket | 1 semana |
| 4 — CFR+ | 1 semana |
| 5 — Trainer + export | 1 semana |
| 6 — Integração web | 1 semana |
| **Total** | **~7 semanas** |

---

## Status

- [x] Planejamento inicial (2026-04-30)
- [x] Etapa 1 — Tipos e regras (2026-04-29)
- [x] Etapa 2 — Abstração de mãos (2026-04-29)
- [x] Etapa 3 — Transições de bucket (2026-04-29)
- [x] Etapa 4 — CFR+ external sampling MCCFR (2026-04-29)
- [x] Etapa 5 — Trainer script + export JSON (2026-04-30)
- [x] Etapa 6 — Integração web app — SolverPanel GTO interativo (2026-04-30)
- [x] Etapa 7 — Decisão de draw como nó CFR (D1/D2/D3-blocker podem ficar pat) (2026-05-10)
- [x] Etapa 8 — Blocker bins (rank 2-3) como dimensão do infoset (2026-05-10)
- [x] Fase 1 6-max — Range-weighted bucket sampling + posição do vilão no infoset (2026-05-10)

---

## Melhorias técnicas pendentes (solver HU)

### M1 — Bluff-pat bucket dedicado ⚠️ impacto alto
**Problema:** `PAT_BUCKET_FOR_STANDING_PAT = 5` faz 22223 e T8765 mapearem para o mesmo bucket pós-pat. No showdown, 22223 "ganha" como se fosse um 9-low fraco, superestimando o EV do bluff.

**Solução:** Criar bucket 31 (`BLUFF_PAT_BUCKET`) para D3-blocker que ficou pat. Em `showdownPayoff`, bucket ≥ NUM_BUCKETS_REAL → sempre perde contra qualquer pat genuíno (buckets 0-5). D1/D2 pats continuam em bucket 5 (podem ser T-lows/J-lows legítimos).

**Mudanças:** `handBuckets.ts`, `cfr.ts` (showdownPayoff), `trainer.ts` (export)

---

### M2 — Matriz de transição de blockerBin ⚠️ impacto médio
**Problema:** Após draw, `sampleBlockerBinForBucket(newBucket)` ignora correlação com blockerBin original. Se você manteve um 2 e um 3 do hand original, essa informação é perdida.

**Solução:** Pré-computar `P(newBlockerBin | oldBucket, oldBlockerBin, drawCount)` durante `initSolver` (30 × 3 × 6 × 3 = 1620 valores). Usar essa matriz em `cfrDraw` ao invés do marginal.

**Mudanças:** `bucketTransition.ts` (nova função), `handBuckets.ts`, `cfr.ts`

---

### M3 — Poda baseada em visitas, não em entropia ⚠️ impacto médio
**Problema:** `pruneThreshold = 0.36` remove infosets com estratégia próxima do uniforme, que podem ser bluffs legítimos com mixing quase-uniforme.

**Solução:** Remover apenas infosets com `strategySum.every(s => s === 0)` (nunca visitados). Infosets visitados com estratégia uniforme são estratégia GTO legítima.

**Mudanças:** `trainer.ts` (exportTables)

---

### M4 — Estimativa de exploitabilidade ⚠️ impacto baixo
**Problema:** O script não tem critério de parada baseado em qualidade.

**Solução:** Adicionar flag `--eval-every N` no train.ts. A cada N iterações, rodar best-response approximation para estimar exploitabilidade em small-bet units. Reportar no log.

---

### M5 — Validação de versão no resume ⚠️ impacto baixo
**Problema:** `loadResume` não valida se o formato de chave do JSON é compatível com a versão atual do código.

**Solução:** Adicionar campo `keyVersion` no export JSON (`"v2"` = inclui blockerBin). `loadResume` verifica e aborta se incompatível.

---

## Roadmap — Evolução para 6-max

### Contexto e princípio de design

Em 2-7 Triple Draw 6-max, a estrutura pré-flop determina quem entra na mão, mas uma vez iniciada a mão, o jogo é frequentemente HU (ou com até 3 jogadores). A diferença crítica em relação ao HU puro é que **os ranges iniciais variam drasticamente por posição**:

| Posição | Range de abertura (estimado) | Exemplo de mão aceitável |
|---|---|---|
| UTG (EP) | ~15-20% das mãos | Draw-1 forte, pats legítimos |
| HJ | ~20-25% | Draw-1 médio ou melhor |
| CO | ~30% | Draw-2 forte ou melhor |
| BTN | ~40-45% | Draw-2 médio ou melhor |
| SB | ~35% | Draw-1/2 médio (posição pior pós-draw) |
| BB | Fecha a ação, defende mais | Qualquer draw-2 razoável |

O impacto é direto no solver: um vilão que abre de UTG está representando um range muito mais forte do que um vilão que abre do BTN. Isso muda drasticamente os EVs de bluff, call, e fold.

---

### Fase 1 — Range-weighted bucket sampling (HU, curto prazo) ✅ (2026-05-10)

**Objetivo:** Sem mudar o game tree HU, tornar o solver ciente de que diferentes posições têm distribuições iniciais de buckets diferentes.

**Implementado:**
- `Position6Max` (`"UTG"|"HJ"|"CO"|"BTN"|"SB"|"BB"`) adicionado a `types.ts`
- `villainPosition: Position6Max` adicionado ao `InfoSet` e a `drawInfoSetKey` (ambas as tabelas, bet e draw)
- `src/solver/game/ranges.ts` — novo: `GROUP_WEIGHT` por posição + `sampleBucketForPosition` + `samplePosition`
- `cfr.ts` — `pos6max: [Position6Max, Position6Max]` propagado por toda a árvore; vilão incluído no infoset key
- `trainer.ts` — amostra posições e buckets ponderados por range; KEY_VERSION bumped para "v5"
- `train.ts` — `--pos0` / `--pos1` CLI args; treinamento geral (sem flags) amostra posições aleatoriamente
- `SolverPanel` — dropdown de posição do vilão com percentual de range; KEY_VERSION = "v5"

**Resultado:** O solver aprende que `check/fold` é mais frequente contra vilão UTG do que contra vilão BTN com a mesma sequência de draws, porque o range do UTG é mais forte.

---

### Fase 2 — Preflop action tree (médio prazo)

**Objetivo:** Modelar a ação pré-draw incluindo a sequência de apostas de abertura, o que determina quem entra e com qual range efetivo.

**Game tree expandido:**
```
Início: UTG decide open/fold → HJ decide 3bet/call/fold → ... → BTN → SB → BB
                                       ↓
                  2-3 jogadores entram na mão com ranges conhecidos
                                       ↓
                     Game tree de draw existente (HU ou 3-way)
```

**Como implementar (HU simplificado):**
- Adicionar `PreflopState` como primeira fase do game tree: ação de fold/open por posição
- Ao final da fase preflop, os 2 jogadores remanescentes têm distribuições de bucket condicionadas às ações tomadas (quem chamou um 3-bet tem range mais forte do que quem abriu o BTN sem re-raise)
- O solver aprende diferença entre `open folded to BTN vs 3bet-called-by-BB` etc.

**Mudanças:**
```
src/solver/game/preflop.ts   — novo: PreflopState, ação de fold/open por posição
src/solver/game/rules.ts     — adicionar regras pré-draw de 6-max
src/solver/cfr/cfr.ts        — adicionar fase preflop antes de cfrBet(street=0)
```

**Complexidade:** O game tree preflop com 6 posições tem ~50 nós. Cada nó de preflop condiciona a distribuição de range usada no game tree de draw.

---

### Fase 3 — 3-way pots (longo prazo)

**Objetivo:** Suporte a 3 jogadores na mão simultaneamente.

**Desafio principal:** CFR para 3+ jogadores requer algoritmia diferente (MCCFR pode ser aplicado, mas a definição de regret counterfactual muda).

**Abordagem recomendada:**
- Usar **Public Chance Sampling MCCFR** (variante adequada para jogos com mais de 2 jogadores)
- Expandir `b: [number, number]` e `bl: [BlockerBin, BlockerBin]` para arrays de 3 elementos
- Adaptar `showdownPayoff` para 3 jogadores (showdown a 3)
- A complexidade do game tree cresce ~10x com um terceiro jogador

**Nota:** Esta fase é o maior salto de complexidade. Recomenda-se implementar as Fases 1 e 2 primeiro e validar que produzem estratégias sensatas antes de atacar 3-way.

---

### Estimativa de esforço — 6-max

| Fase | Esforço | Pré-requisito |
|---|---|---|
| Fase 1 — Range-weighted HU | 1 semana | M3 (export correto) |
| Fase 2 — Preflop tree | 2-3 semanas | Fase 1 |
| Fase 3 — 3-way pots | 4-6 semanas | Fase 2 |

---

### Arquivos novos planejados (6-max)

```
src/solver/game/
  preflop.ts          — PreflopState, ação de abertura por posição
  ranges.ts           — rangeDistPerPosition: peso de bucket por posição 6-max
src/solver/cfr/
  cfr6max.ts          — variante 3-way do game tree (Fase 3)
```
