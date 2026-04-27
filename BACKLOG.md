# Backlog

Items planejados para as próximas fases do projeto. Atualizar conforme decisões forem tomadas.

---

## Fase 3 — Autenticação e contas de usuário

### Setup de infraestrutura
- [ ] Instalar e configurar Clerk (Vercel Marketplace)
- [ ] Provisionar Neon Postgres (Vercel Marketplace)
- [ ] Rodar migrações iniciais do schema

### Schema do banco
```sql
-- users gerenciados pelo Clerk; tabela local só para dados extras
CREATE TABLE calculations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,          -- Clerk user ID
  variant     TEXT NOT NULL,
  hands       JSONB NOT NULL,
  board       JSONB NOT NULL,
  result      JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### Features
- [ ] Salvar cálculo automaticamente no banco quando usuário estiver logado
- [ ] Página `/history` — lista de cálculos anteriores com replay
- [ ] Replay de cálculo: pré-popula o calculador com mãos/board salvo
- [ ] Middleware Clerk protegendo rotas que necessitam de auth
- [ ] Página de login (`/login`) e signup (`/signup`)
- [ ] Botão "Sign in" no header quando deslogado
- [ ] Usuário deslogado pode usar o calculador mas vê CTA para salvar histórico

---

## Fase 4 — Performance (acionar só se simulações > ~2s para 10k iterações)

### Diagnóstico antes de qualquer mudança
- [ ] Medir tempo por variante com 10k iterações (baseline)
- [ ] Perfilar: gargalo está no avaliador ou no loop Monte Carlo?

### Opções em ordem de custo de implementação
1. **`worker_threads`** — paralelizar iterações sem mudar o engine
2. **Rust → WebAssembly** — reescrever o inner loop do simulador
3. **FastAPI (Python)** — serviço separado se WASM não for suficiente

### Critério de migração
Mover para a próxima opção somente se a anterior não resolver o gargalo medido.

---

## Ideias futuras (sem fase definida)

- Suporte a ranges de mãos (ex: "AA-KK, AKs") além de mãos específicas
- Cálculo de odds em tempo real (atualiza equity conforme board é revelado)
- Modo "random hand" — sorteia uma mão válida para o jogador
- Compartilhar cálculo via URL (estado serializado na query string)
- Dark mode
