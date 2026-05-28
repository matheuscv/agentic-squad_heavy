# Pedido de Correção — Iteração 2/3
## Problema detectado
O CI continua falhando com cobertura 0% em `src/routes/ping.ts` e `src/index.ts`. O problema raiz é que `src/index.ts` possui imports estáticos no topo do arquivo que carregam módulos com side-effects imediatos (conexões reais a banco de dados, Redis, BullMQ), fazendo com que qualquer teste falhe ao tentar importar qualquer módulo que transite por `src/index.ts`.

**Causa raiz identificada:**
`src/index.ts` ainda importa no topo:
- `import jiraWebhookRouter from './webhooks/jira'` — provavelmente instancia conexões
- `import { createOrchestratorWorker, createReconciler } from './orchestrator'` — conecta ao Redis/BullMQ
- `import { createPoAgentWorker } from './agents/po'` — idem
- `import { createLtAgentWorker } from './agents/lt'` — idem
- `import { createDevAgentWorker } from './agents/dev-agent'` — idem
- `import { createQaAgentWorker } from './agents/qa-agent'` — idem
- `import { db, schema } from './db/index'` — instancia pool de banco de dados
- `import { getAvgDurationByAgent, ... } from './lib/metrics'` — usa db

Esses imports no topo causam exceções ou timeouts em CI (onde DATABASE_URL e REDIS_URL não existem), abortando toda a suite de testes.

**O que o DEV deve fazer:**
1. Mover TODOS esses imports problemáticos para DENTRO da função `bootstrap()` (imports dinâmicos com `await import(...)` ou imports estáticos movidos para dentro do escopo da função)
2. O topo de `src/index.ts` deve ter APENAS imports que não causam side-effects: `express`, `dotenv`, `dns`, `./routes/ping`, `./lib/logger`
3. Os imports de workers, orchestrator, db, redis, pg devem ser lazy (dentro de bootstrap)
4. Garantir que `src/routes/ping.ts` exporta o router corretamente e que `ping.test.ts` passa com 100% de cobertura
5. O arquivo `src/index.ts` precisa de um arquivo de teste `src/index.test.ts` mockando todos os imports problemáticos via `vi.mock()` para que a cobertura passe de 0%

**Testes que estão falhando:** todos os testes do arquivo `src/routes/ping.test.ts` — a cobertura de `ping.ts` está em 0% porque o runner aborta antes de executar os testes.
## Arquivos com problemas
- `src/index.ts`
- `src/routes/ping.ts`
## Testes falhando
- Todos os testes em src/routes/ping.test.ts (CI falhou, cobertura 0%)
## Cobertura insuficiente
```json
{
  "src/index.ts": {
    "statements": 0,
    "branches": 0,
    "functions": 0,
    "lines": 0
  },
  "src/routes/ping.ts": {
    "statements": 0,
    "branches": 0,
    "functions": 0,
    "lines": 0
  }
}
```
---
_Gerado pelo Agente QA em 2026-05-28T12:33:40.408Z_