# Squad Agêntica — agentic-squad-heavy

Sistema de desenvolvimento de software com agentes de IA autônomos orquestrados via Jira. Cada história passa por um pipeline de agentes (PO → LT → DEV → QA) com gates de aprovação humana entre cada etapa.

## Visão Geral

```
Jira (Backlog)
  └─ [webhook] → Orquestrador
       ├─ A Refinar         → Agente PO  → gera PRD.md           → Aguardando Aceite PRD
       ├─ PRD Aceito        → Agente LT  → gera PLANO_DE_EXECUCAO.md → Aguardando Aceite Plano
       ├─ Plano Validado    → Agente DEV → implementa código      → Aguardando Aceite Dev
       └─ Em QA             → Agente QA  → executa testes         → Aguardando Aceite QA
```

Gates humanos em: Aguardando Aceite PRD, Aguardando Aceite Plano, Aguardando Aceite Dev, Aguardando Aceite QA, Validação Final.

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 22 / TypeScript 5 |
| API | Express 5 |
| Banco de dados | PostgreSQL (Supabase) via Drizzle ORM |
| Fila de jobs | BullMQ + Redis (Upstash) |
| IA (agentes) | Anthropic Claude API (claude-opus-4-7) |
| Logs | Pino (JSON estruturado → stdout) |
| Testes | Vitest + v8 coverage |
| Deploy | Render (free tier) |

## Estrutura do Projeto

```
src/
├── agents/
│   ├── po.ts          # Agente Product Owner — gera PRD.md
│   └── lt.ts          # Agente Tech Lead — gera PLANO_DE_EXECUCAO.md
├── db/
│   ├── schema.ts      # Drizzle schema (stories, agent_runs, artifacts)
│   ├── stories.ts     # Helpers de persistência de histórias
│   └── migrations/    # Migrations SQL geradas pelo Drizzle Kit
├── github/
│   └── client.ts      # GitHub App JWT + Contents API (read, commit, branch)
├── jira/
│   └── client.ts      # Jira REST API v3 (getIssue, transitions, comments, search)
├── lib/
│   └── logger.ts      # Pino logger com child loggers por módulo
├── orchestrator/
│   ├── state-machine.ts  # 13 status Jira → ações do orquestrador
│   ├── worker.ts         # BullMQ worker do orquestrador
│   ├── reconciler.ts     # Polling Jira a cada 90s para detectar webhooks perdidos
│   └── index.ts
├── queue/
│   └── index.ts       # Configuração Redis/BullMQ compartilhada
├── webhooks/
│   └── jira.ts        # POST /webhooks/jira — recebe eventos Jira
└── index.ts           # Entrypoint: Express + workers + graceful shutdown
```

## Artefatos por História

Todos os artefatos de uma história são commitados no branch `prd/<jira-key>`:

```
prd/scrum-42/
├── SCRUM-42/PRD.md                  # Gerado pelo Agente PO
└── SCRUM-42/PLANO_DE_EXECUCAO.md    # Gerado pelo Agente LT
```

## Variáveis de Ambiente

```env
# Banco de dados
DATABASE_URL=postgresql://...

# Redis
REDIS_URL=redis://...

# Jira
JIRA_BASE_URL=https://<workspace>.atlassian.net
JIRA_EMAIL=...
JIRA_API_TOKEN=...
JIRA_PROJECT_KEY=SCRUM
JIRA_WEBHOOK_SECRET=...

# GitHub App
GITHUB_APP_ID=...
GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\n...
GITHUB_APP_INSTALLATION_ID=...
GITHUB_OWNER=<username>
GITHUB_REPO=<repo-name>

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-4-7
```

## Rotas

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/webhooks/jira` | Recebe eventos de transição do Jira |
| `GET` | `/health` | Health check (database + redis) |

## Desenvolvimento Local

```bash
npm install
cp .env.example .env   # preencher variáveis
npm run dev            # ts-node-dev com hot reload
npm run dev | npx pino-pretty --colorize   # logs legíveis
```

## Testes

```bash
npm test               # vitest run
npm run test:coverage  # com relatório de cobertura
```
