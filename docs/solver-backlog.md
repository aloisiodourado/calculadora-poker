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
