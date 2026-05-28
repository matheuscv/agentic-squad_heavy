# agentic-squad-heavy

> Squad 100% agêntica que automatiza o ciclo completo de desenvolvimento — da história no Jira ao Pull Request no GitHub — usando agentes de IA orquestrados pelo Claude (Anthropic).

[![npm version](https://img.shields.io/npm/v/agentic-squad-heavy)](https://www.npmjs.com/package/agentic-squad-heavy)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-227%20passing-brightgreen)](#testes)

---

## O que é

O **agentic-squad-heavy** é um servidor de orquestração que conecta seu quadro Jira a uma equipe de agentes de IA. Quando uma história avança no Jira, os agentes escrevem PRDs, planos de execução, código e testes de forma autônoma — e abrem Pull Requests prontos para revisão humana.

```
Jira (webhook)
  └─► Orchestrator
        ├─► Agente PO   → gera PRD.md no GitHub
        ├─► Agente LT   → gera PLANO_DE_EXECUCAO.md no GitHub
        ├─► Agente DEV  → implementa código, abre Pull Request
        └─► Agente QA   → escreve testes, valida cobertura, solicita correções
```

Os gates humanos (aceitar PRD, aprovar plano, fazer merge do PR) permanecem sob controle humano.

---

## Stack

| Camada         | Tecnologia                                    |
|----------------|-----------------------------------------------|
| Runtime        | Node.js ≥ 20 / TypeScript 5                   |
| API            | Express 5                                     |
| Banco de dados | PostgreSQL (Supabase) via Drizzle ORM         |
| Fila de jobs   | BullMQ + Redis (Upstash)                      |
| IA             | Anthropic Claude API (`claude-opus-4-7`)      |
| Logs           | Pino — JSON estruturado → Betterstack         |
| Testes         | Vitest + v8 coverage (227 testes)             |
| Deploy         | Render                                        |

---

## Início Rápido

### Pré-requisitos

- Node.js ≥ 20
- PostgreSQL (ex.: [Supabase](https://supabase.com) — free tier)
- Redis (ex.: [Upstash](https://upstash.com) — free tier)
- [GitHub App](https://docs.github.com/en/apps/creating-github-apps) com permissões de leitura/escrita em Contents e Pull Requests
- Conta [Jira Cloud](https://www.atlassian.com/software/jira) com API token
- Chave de API [Anthropic](https://console.anthropic.com)

### Instalação do CLI

```bash
npm install -g agentic-squad-heavy
```

### Configuração interativa

```bash
agentic-squad init
```

O wizard coleta e valida todas as credenciais, instala o workflow de CI no repositório alvo e registra o webhook no Jira automaticamente.

### Subir o servidor

```bash
# Desenvolvimento local
npm run dev

# Produção
npm run build && npm start
```

---

## Variáveis de Ambiente

Todas as variáveis são coletadas pelo `agentic-squad init` e gravadas no `.env`. Para configuração manual:

| Variável                      | Obrigatória | Descrição                                           |
|-------------------------------|:-----------:|-----------------------------------------------------|
| `DATABASE_URL`                | ✓           | Connection string PostgreSQL                        |
| `REDIS_URL`                   | ✓           | URL Redis (suporta `rediss://` para Upstash TLS)    |
| `JIRA_BASE_URL`               | ✓           | Ex.: `https://sua-org.atlassian.net`                |
| `JIRA_EMAIL`                  | ✓           | E-mail da conta Jira                                |
| `JIRA_API_TOKEN`              | ✓           | API token gerado em id.atlassian.com                |
| `JIRA_PROJECT_KEY`            | ✓           | Chave do projeto (ex.: `SCRUM`)                     |
| `JIRA_WEBHOOK_SECRET`         | ✓           | Secret para validar webhooks (gerado pelo wizard)   |
| `GITHUB_OWNER`                | ✓           | Dono do repositório (usuário ou organização)        |
| `GITHUB_REPO`                 | ✓           | Nome do repositório                                 |
| `GITHUB_APP_ID`               | ✓           | ID do GitHub App                                    |
| `GITHUB_APP_PRIVATE_KEY`      | ✓           | Chave PEM do GitHub App (inline com `\n`)           |
| `GITHUB_APP_INSTALLATION_ID`  | ✓           | ID da instalação do GitHub App                      |
| `GITHUB_DEFAULT_BRANCH`       |             | Branch principal (padrão: `main`)                   |
| `ANTHROPIC_API_KEY`           | ✓           | Chave de API da Anthropic                           |
| `CI_TEST_COMMAND`             |             | Comando de testes (detectado automaticamente)        |
| `CI_COVERAGE_COMMAND`         |             | Comando de cobertura (detectado automaticamente)     |
| `CI_COVERAGE_THRESHOLD`       |             | Threshold mínimo de cobertura em % (padrão: 85)     |
| `AGENTS_DEV_CONCURRENCY`      |             | Jobs DEV simultâneos (padrão: 5)                    |
| `AGENTS_MODEL_DEFAULT`        |             | Modelo Claude padrão (padrão: `claude-opus-4-7`)    |
| `COST_ALERT_THRESHOLD_USD`    |             | Alerta de custo por história em USD (padrão: 1.00)  |
| `BETTERSTACK_SOURCE_TOKEN`    |             | Token para alertas críticos no Betterstack          |

---

## Arquitetura

### Máquina de Estados

O orquestrador mapeia os 13 status do Jira para ações dos agentes:

```
A Refinar             → Agente PO   (gera PRD.md)
Em Refinamento        → [aguarda]
Aguardando Aceite PRD → [gate humano: revisar PRD]
PRD Aceito            → Agente LT   (gera plano de execução)
Aguardando Aceite Plano → [gate humano: aprovar plano]
Plano Validado        → Agente DEV  (implementa código, abre PR)
Em Desenvolvimento    → [aguarda CI]
Aguardando Aceite Dev → [gate humano: revisar PR]
Em QA                 → Agente QA   (escreve testes, valida cobertura)
Aguardando Aceite QA  → [gate humano: aprovar QA]
Validação Final       → [gate humano: merge]
Concluído             → [terminal]
```

### Agentes

| Agente        | Responsabilidade                                                  | Modelo          |
|---------------|-------------------------------------------------------------------|-----------------|
| Orchestrator  | Rota eventos Jira para o agente correto                           | —               |
| PO            | Gera `PRD.md` com critérios de aceite e contexto técnico          | claude-opus-4-7 |
| LT            | Gera `PLANO_DE_EXECUCAO.md` com arquitetura e plano de arquivos   | claude-opus-4-7 |
| DEV           | Implementa código, cria branch, commita e abre Pull Request       | claude-opus-4-7 |
| QA            | Escreve testes, executa CI, solicita correções ao DEV (até 3×)    | claude-opus-4-7 |

### Loop de Correção QA → DEV

Quando o Agente QA detecta cobertura insuficiente, enfileira o Agente DEV em modo `correctionMode` com prioridade `HIGH`. Após até 3 iterações sem sucesso, escala para um humano via comentário no Jira.

### Detecção Automática de Stack

Durante o `agentic-squad init`, o wizard lê os manifests do repositório alvo e configura automaticamente `CI_TEST_COMMAND` e `CI_COVERAGE_COMMAND`.

Linguagens suportadas: **Node.js** (npm/yarn/pnpm, vitest/jest/mocha), **Python** (pip/poetry/pdm, pytest), **Java** (maven/gradle), **Go**, **Rust**, **Ruby**, **PHP**.

### Isolamento Multi-Projeto

Múltiplos projetos Jira podem rodar na mesma instância sem interferência:

- **Estado DB**: coluna `project_key` em `stories` segrega os dados por projeto
- **Logs**: campo `projectKey` em todos os eventos de agente — filtrável no Betterstack
- **Métricas/Custos**: todas as queries aceitam `projectKey` opcional
- **Derivação automática**: `SCRUM-17` → `projectKey = "SCRUM"`

---

## Rotas da API

| Método | Rota                   | Descrição                                               |
|--------|------------------------|---------------------------------------------------------|
| POST   | `/webhooks/jira`       | Recebe eventos Jira (`?secret=<JIRA_WEBHOOK_SECRET>`)   |
| GET    | `/health`              | Status básico (DB + Redis)                              |
| GET    | `/health/detailed`     | Status + contadores de todas as filas BullMQ            |
| GET    | `/metrics`             | Duração média e taxa de sucesso por agente              |
| GET    | `/metrics/cost`        | Consumo de tokens e custo USD por agente e história     |

### Exemplo: `/health`

```json
{
  "status": "ok",
  "timestamp": "2026-05-28T15:00:00.000Z",
  "checks": { "database": "ok", "redis": "ok" }
}
```

### Exemplo: `/metrics/cost`

```json
{
  "summary": {
    "totalInputTokens": 184320,
    "totalOutputTokens": 42100,
    "totalCostUsd": 0.312845
  },
  "byAgent": {
    "dev": { "costUsd": 0.198, "runs": 12 },
    "qa":  { "costUsd": 0.074, "runs": 8 }
  },
  "byStory": [
    { "jiraKey": "SCRUM-17", "costUsd": 0.089, "runs": 5 }
  ]
}
```

---

## CLI

```bash
# Wizard de configuração interativo
agentic-squad init

# Gerar changelog desde a última tag git
agentic-squad changelog

# Forçar versão e escrever CHANGELOG.md
agentic-squad changelog --version 1.2.0

# Pré-visualizar sem escrever arquivo
agentic-squad changelog --dry-run

# Controle de migrações de banco
agentic-squad migrate status    # relatório: aplicadas vs. pendentes
agentic-squad migrate check     # verifica se há operações destrutivas
agentic-squad migrate dry-run   # imprime SQL sem executar
agentic-squad migrate run       # aplica migrações pendentes
```

---

## Banco de Dados e Migrações

O schema é gerenciado pelo Drizzle ORM com migrações SQL versionadas em `src/db/migrations/`.

```bash
# Após editar src/db/schema.ts — gera novo arquivo SQL
npm run db:generate

# Inspecionar banco visualmente
npm run db:studio
```

### Tabelas

| Tabela       | Descrição                                                              |
|--------------|------------------------------------------------------------------------|
| `stories`    | Uma linha por história Jira; `project_key` isola projetos              |
| `agent_runs` | Cada execução de agente com tokens, custo USD e duração                |
| `artifacts`  | PRDs, planos e relatórios de cobertura vinculados à história           |

### Proteção contra Destrutivas

O migration runner detecta `DROP TABLE`, `TRUNCATE`, `DROP COLUMN`, `ALTER COLUMN` e bloqueia sem `--force`:

```
⚠️  Operações destrutivas detectadas:
  🔴 DROP TABLE "stories"

Use agentic-squad migrate run --force para prosseguir.
```

---

## Observabilidade

### Logs Estruturados

```json
{
  "level": "info",
  "service": "agentic-squad-heavy",
  "module": "agent.dev",
  "jiraKey": "SCRUM-17",
  "projectKey": "SCRUM",
  "event": "agent_completed",
  "durationMs": 45230,
  "tokenCostUsd": 0.089
}
```

```bash
# Output legível em desenvolvimento
npm run dev | npx pino-pretty --colorize
```

### Alertas Betterstack

Alertas HTTP diretos para eventos críticos:
- `cost_threshold_exceeded` — custo da história ultrapassou `COST_ALERT_THRESHOLD_USD`
- `agent_failed` — agente falhou após todas as tentativas

### Reconciliador

Polling a cada 90 segundos detecta divergências entre banco e Jira (webhooks perdidos) e re-enfileira automaticamente, sem duplicar jobs.

---

## Segurança

| Mecanismo                    | Implementação                                           |
|------------------------------|---------------------------------------------------------|
| Autenticação de webhook      | `timingSafeEqual` — protege contra timing attacks       |
| Rate limiting                | 60 req/IP/min na rota `/webhooks/jira`                  |
| Proteção contra replay       | Chave Redis com TTL 5 min por evento                    |
| Sanitização de inputs LLM    | Remove sequências de controle antes de enviar ao Claude |
| Guard de migrações           | Bloqueia destrutivas sem `--force` explícito            |
| Graceful shutdown            | Drena jobs ativos em até 30s antes de encerrar          |
| Startup recovery             | Recupera jobs interrompidos por restart/crash           |

---

## Deploy no Render

O arquivo `render.yaml` configura o serviço. Para deploy:

```bash
npm run render:setup-env   # envia variáveis de ambiente para o Render
npm run render:deploy      # dispara o deploy
```

O servidor expõe `PORT` (padrão `3000`) e suporta graceful shutdown via `SIGTERM`/`SIGINT`.

---

## Desenvolvimento Local

```bash
# Clonar e instalar
git clone https://github.com/<owner>/agentic-squad-heavy
cd agentic-squad-heavy
npm install

# Configurar (wizard interativo)
npm run init

# Aplicar migrações
agentic-squad migrate run

# Subir em modo watch com logs coloridos
npm run dev | npx pino-pretty --colorize
```

### Testes

```bash
npm test                # suite completa (227 testes)
npm run test:watch      # modo watch
npm run test:coverage   # com relatório v8
npm run typecheck       # tsc --noEmit
```

### Estrutura do Projeto

```
src/
├── agents/
│   ├── po.ts              # Agente PO — gera PRD.md
│   ├── lt.ts              # Agente LT — gera PLANO_DE_EXECUCAO.md
│   ├── dev-agent.ts       # Agente DEV — código e PR
│   ├── qa-agent.ts        # Agente QA — testes e loop de correção
│   └── prompts/           # System prompts dos agentes
├── cli/
│   ├── stack-detector.ts  # Detecção de linguagem/framework
│   ├── github-setup.ts    # Instalação do workflow de CI
│   └── smoke-test.ts      # Smoke test end-to-end
├── db/
│   ├── schema.ts          # Drizzle schema
│   ├── migrate-runner.ts  # Runner com detecção de destrutivas
│   └── migrations/        # Arquivos SQL versionados
├── lib/
│   ├── logger.ts          # Pino + child loggers tipados
│   ├── metrics.ts         # Observabilidade por agente/projeto
│   ├── cost.ts            # Cálculo e alertas de custo
│   └── sanitize.ts        # Sanitização para o LLM
├── orchestrator/
│   ├── state-machine.ts   # 13 status Jira → ações
│   ├── worker.ts          # BullMQ worker
│   └── reconciler.ts      # Polling anti-drift (90s)
├── versioning/
│   └── changelog.ts       # Gerador Conventional Commits
├── webhooks/
│   └── jira.ts            # POST /webhooks/jira
└── index.ts               # Express + workers + graceful shutdown

scripts/
├── init.ts                # Wizard de configuração
├── changelog.ts           # CLI do gerador de changelog
└── migrate.ts             # CLI de migrações

bin/
└── agentic-squad.js       # Entrypoint publicado no npm
```

---

## Versionamento e Changelog

O projeto segue [Conventional Commits](https://www.conventionalcommits.org/) e gera changelogs automaticamente:

```bash
# Gerar entrada para a próxima release
agentic-squad changelog

# Com bump semântico automático (major/minor/patch)
agentic-squad changelog --version auto
```

O gerador detecta `feat` (minor), `fix`/`perf`/`refactor` (patch) e `feat!`/`BREAKING CHANGE` (major), e agrupa as seções em português.

---

## Licença

MIT — veja [LICENSE](LICENSE).

---

## Contribuindo

1. Fork + branch: `git checkout -b feat/minha-feature`
2. Commits em [Conventional Commits](https://www.conventionalcommits.org/)
3. Testes passando: `npm test`
4. PR com descrição do que muda e por quê

```bash
# Antes de abrir o PR
npm test && npm run typecheck
agentic-squad changelog --dry-run
```
