# PRD — Calculadora de Poker (Equity Calculator)

## 1. Visão geral

Aplicação web para cálculo de equidade de mãos de poker em múltiplas modalidades. O usuário informa as mãos e as cartas do board (quando aplicável), e o sistema roda uma simulação Monte Carlo para retornar a probabilidade de vitória de cada mão.

O projeto é construído em fases incrementais, partindo do engine de lógica até uma aplicação completa com autenticação.

---

## 2. Stack tecnológica

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Frontend | Next.js 15 (App Router) + TypeScript | Roteamento, SSR, API routes em um único projeto |
| UI | shadcn/ui + Tailwind CSS | Componentes acessíveis, fácil customização |
| State (client) | Zustand | State management leve para o calculador |
| Engine de poker | TypeScript (Node.js) | Stack única, sem overhead de serviço extra na fase inicial |
| Banco de dados | Neon Postgres (Vercel Marketplace) | Fase 3 — usuários e histórico |
| Autenticação | Clerk | Fase 3 — integração nativa com Vercel |
| Deploy | Vercel | Deploy contínuo, preview por PR, funções serverless nativas |

### 2.1 Estratégia de performance — Monte Carlo

O engine será implementado inicialmente em TypeScript puro. A performance pode se tornar um gargalo conforme a complexidade das simulações aumentar (variantes Hi-Lo, Stud, Badugi exigem avaliações mais custosas por iteração).

**Plano de migração de performance** (acionar quando simulações ultrapassarem ~2s para 10k iterações):

1. **Fase imediata**: Workers (Node.js `worker_threads`) para paralelizar iterações sem bloquear o event loop
2. **Fase intermediária**: Rust compilado para WebAssembly — o engine roda no browser ou no serverless sem depender de Python
3. **Fase avançada** (se necessário): FastAPI (Python + NumPy) como serviço separado de cálculo

A interface do engine (`SimulatorEngine`) será desenhada desde o início como um contrato isolado, permitindo trocar a implementação sem alterar o restante da aplicação.

---

## 3. Modalidades de poker

### 3.1 Tabela de variantes

| Modalidade | Tipo de mão | Cartas hole | Community cards | Observações |
|---|---|---|---|---|
| Texas Hold'em | High | 2 | 5 (flop/turn/river) | Modalidade base para o avaliador high |
| Omaha Hi | High | 4 | 5 | Obrigatório usar exatamente 2 hole cards + 3 community |
| Omaha Hi-Lo | Split (Hi + Lo A-5) | 4 | 5 | Pot dividido entre melhor high e melhor low (8 ou menos) |
| 7-Card Stud | High | 7 (3 down, 4 up) | Nenhuma | Sem community cards |
| Stud Hi-Lo (8-or-Better) | Split (Hi + Lo A-5) | 7 (3 down, 4 up) | Nenhuma | Pot dividido; low qualifica com 8 ou menos |
| Razz | Low A-5 | 7 (3 down, 4 up) | Nenhuma | Pior mão high ganha; ás é baixo |
| 2-7 Single Draw | Low 2-7 | 5 | Nenhuma | Ás alto, flushes e straights contam contra |
| 2-7 Triple Draw | Low 2-7 | 5 | Nenhuma | 3 rodadas de descarte |
| Badugi | Especial | 4 | Nenhuma | 1 carta por naipe, sem pares, mão mais baixa ganha |

### 3.2 Categorias de avaliadores

```
HandEvaluator (interface)
  ├── HighHandEvaluator
  │     └── usado por: Hold'em, Omaha Hi, 7-Card Stud, metade Hi das variantes split
  ├── LowballEvaluator
  │     ├── AceToFiveLow   → Razz, Omaha Hi-Lo (metade Lo), Stud Hi-Lo (metade Lo)
  │     └── DeuceSeven     → 2-7 Single Draw, 2-7 Triple Draw
  └── BadugiEvaluator
```

### 3.3 Ranking de mãos — High Hand

Do mais fraco ao mais forte:

1. Carta alta (High Card)
2. Par (One Pair)
3. Dois Pares (Two Pair)
4. Trinca (Three of a Kind)
5. Sequência (Straight)
6. Flush
7. Full House
8. Quadra (Four of a Kind)
9. Straight Flush
10. Royal Flush

### 3.4 Regras de qualificação — variantes Lo

**A-5 Lowball** (Razz, Omaha Hi-Lo, Stud Hi-Lo):
- Ás é sempre baixo
- Flushes e straights não contam
- Mão qualificadora para "Lo": 5 cartas ≤ 8 sem par
- Melhor mão possível: A-2-3-4-5 (the Wheel)

**2-7 (Deuce-to-Seven)**:
- Ás é sempre alto
- Flushes e straights contam contra a mão
- Melhor mão possível: 2-3-4-5-7 off-suit
- Pior mão que uma High Card vence qualquer par

**Badugi**:
- Apenas 4 cartas, uma de cada naipe
- Cartas do mesmo naipe ou pares são removidas da mão efetiva
- Mão com mais cartas válidas (Badugi de 4) vence mão menor (Tri de 3)
- Em número igual de cartas, a mão mais baixa ganha

---

## 4. Arquitetura do sistema

### 4.1 Estrutura de pastas

```
src/
  engine/
    cards/
      Card.ts             → { suit: Suit, rank: Rank }
      Deck.ts             → geração, embaralhamento, remoção de cartas
      types.ts            → enums Suit, Rank
    evaluators/
      HighHandEvaluator.ts
      AceToFiveLowEvaluator.ts
      DeuceSeven Evaluator.ts
      BadugiEvaluator.ts
      index.ts            → factory: getEvaluator(variant)
    variants/
      types.ts            → enum PokerVariant + config por variante
      config.ts           → regras de deal, número de cartas, avaliador(es)
    simulator/
      MonteCarloSimulator.ts   → engine principal
      SimulatorEngine.ts       → interface/contrato (para futura troca de impl)
      types.ts                 → SimulationInput, SimulationResult
  app/
    (calculator)/
      page.tsx            → página principal do calculador
      layout.tsx
    (auth)/               → Fase 3
      login/page.tsx
      signup/page.tsx
    api/
      equity/
        route.ts          → POST /api/equity — roda simulação, retorna equidades
  components/
    CardPicker/           → seleção visual de carta (naipe + valor)
    HandInput/            → conjunto de CardPickers para uma mão
    BoardInput/           → cartas do board (para Hold'em, Omaha)
    EquityDisplay/        → barras de progresso com % por mão
    VariantSelector/      → dropdown de modalidade
```

### 4.2 Contrato do engine

```typescript
interface SimulationInput {
  variant: PokerVariant;
  hands: Card[][];       // mãos dos jogadores (cartas conhecidas)
  board: Card[];         // cartas do board (pode ser vazio)
  iterations: number;    // padrão: 10_000
}

interface HandResult {
  hand: Card[];
  equity: number;        // 0–1
  wins: number;
  ties: number;
  losses: number;
}

interface SimulationResult {
  results: HandResult[];
  iterationsRun: number;
  durationMs: number;
}

interface SimulatorEngine {
  simulate(input: SimulationInput): Promise<SimulationResult>;
}
```

### 4.3 Fluxo de uma simulação

```
Usuário seleciona variante + mãos + board
  → POST /api/equity
    → MonteCarloSimulator.simulate()
      → para cada iteração:
          1. Clonar deck sem cartas já conhecidas
          2. Embaralhar deck restante
          3. Completar board e mãos de acordo com as regras da variante
          4. Avaliar cada mão com o(s) avaliador(es) correto(s)
          5. Determinar vencedor(es) — split em variantes Hi-Lo
          6. Acumular wins/ties/losses
      → Calcular equity = wins + ties/n_jogadores
      → Retornar SimulationResult
  → UI exibe barras de equidade por mão
```

---

## 5. Fases de implementação

### Fase 1 — Poker Engine (sem UI)

**Objetivo**: engine testável em isolamento, sem dependência de framework.

- [ ] Modelo de cartas: `Card`, `Rank`, `Suit`, `Deck`
- [ ] `HighHandEvaluator` — ranking padrão completo
- [ ] `AceToFiveLowEvaluator` — Razz / Lo de variantes split
- [ ] `DeuceSeven Evaluator` — 2-7 Single e Triple Draw
- [ ] `BadugiEvaluator` — 4 cartas, sem par, sem flush
- [ ] Configurações de variante (`variant/config.ts`)
- [ ] `MonteCarloSimulator` — implementação TypeScript puro
- [ ] Testes unitários para cada avaliador com casos conhecidos

**Entregável**: suite de testes passando, engine funcional via chamada direta.

---

### Fase 2 — Calculador web

**Objetivo**: interface funcional para calcular equidades.

- [ ] Setup do projeto Next.js 15 + shadcn/ui + Tailwind
- [ ] `VariantSelector` — dropdown de modalidade
- [ ] `CardPicker` — grid de seleção de carta (naipe × valor), bloqueia cartas já usadas
- [ ] `HandInput` — n pickers conforme a variante
- [ ] `BoardInput` — visível apenas para variantes com community cards
- [ ] `EquityDisplay` — barras com percentuais, win/tie/loss breakdown
- [ ] API route `POST /api/equity` — chama o engine, retorna resultado
- [ ] Tratamento de edge cases: cartas duplicadas, mãos incompletas, board inválido

**Entregável**: aplicação deployada na Vercel, calculadora funcional para todas as variantes.

---

### Fase 3 — Autenticação e contas

**Objetivo**: controle de acesso e histórico de cálculos por usuário.

- [ ] Setup Clerk (Vercel Marketplace)
- [ ] Setup Neon Postgres (Vercel Marketplace)
- [ ] Schema: `users`, `calculations` (mãos, variante, resultado, timestamp)
- [ ] Salvar cálculo automaticamente quando logado
- [ ] Página de histórico com replay de simulações anteriores
- [ ] Rotas protegidas (middleware Clerk)

**Entregável**: fluxo de login funcional, histórico persistido por usuário.

---

### Fase 4 — Performance (se necessário)

**Trigger**: simulações ultrapassando ~2s de tempo de resposta percebido.

- [ ] Medir e perfilar onde está o gargalo (avaliador vs. loop Monte Carlo)
- [ ] Avaliar `worker_threads` para paralelismo sem custo de migração
- [ ] Avaliar Rust → WebAssembly para o inner loop do simulador
- [ ] Benchmarks comparativos antes de qualquer migração

---

## 6. Critérios de aceite por fase

### Fase 1
- Todos os avaliadores retornam resultado correto para mãos canônicas conhecidas (ex: Royal Flush > Straight Flush)
- Monte Carlo retorna equidades plausíveis para cenários com solução analítica conhecida (ex: AA vs KK preflop ≈ 80/20)
- Performance baseline documentada: tempo de 10k iterações por variante

### Fase 2
- Usuário consegue calcular equidade para todas as 9 variantes
- Cartas já selecionadas ficam bloqueadas para outras mãos
- Resultado exibido em menos de 3 segundos para 10k iterações
- Interface responsiva (mobile e desktop)

### Fase 3
- Login via email/social (Google, GitHub)
- Histórico persiste entre sessões
- Usuário não autenticado pode usar o calculador mas não salva histórico

---

## 7. Fora do escopo (por ora)

- Cálculo de odds em tempo real durante uma mão em andamento
- GTO solver ou análise de ranges completos
- Suporte a variantes exóticas (Courchevel, Irish Poker, etc.)
- Aplicativo mobile nativo
- Modo multiplayer ou simulação de mesa completa
