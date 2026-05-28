# Plano de Execução — SCRUM-20: Adicionar endpoint GET /ping

## Identificação
- **Jira Key**: SCRUM-20
- **Resumo**: Adicionar endpoint GET /ping que retorna `{ status: 'ok', version: '1.0.0' }` em `src/routes/ping.ts`
- **Versão**: 1.0
- **Autor**: Agente LT (IA)
- **Data**: 2026-05-28

## Stack Detectada
- **Runtime**: Node.js 22 / TypeScript 5
- **Framework**: Express 4.21 (tipagens Express 5)
- **Banco de Dados**: PostgreSQL (Supabase) via Drizzle ORM
- **Fila**: BullMQ + Redis (Upstash) via IORedis
- **Testes**: Vitest 3 + @vitest/coverage-v8
- **Logs**: Pino 10

## Visão Geral

| ID | Descrição resumida | Estimativa | Dependências | Paralelo |
|----|--------------------|------------|--------------|---------|
| TASK-01 | Criar `src/routes/ping.ts` com handler GET /ping + log Pino | P | — | Sim |
| TASK-02 | Registrar o router de ping em `src/index.ts` | P | TASK-01 | Não |
| TASK-03 | Criar `src/routes/ping.test.ts` com testes unitários e de integração (supertest) | M | TASK-01 | Não |
| TASK-04 | Atualizar tabela de rotas no `README.md` | P | TASK-01 | Sim |

## Tasks Detalhadas

### TASK-01 — Criar `src/routes/ping.ts` com handler GET /ping
**Descrição**: Criar o arquivo `src/routes/ping.ts` exportando um `Router` do Express com um único handler `GET /`. O handler deve: (1) emitir log Pino em nível `debug` com o campo `route: '/ping'`; (2) responder com status HTTP `200` e JSON `{ status: 'ok', version: '1.0.0' }`. A versão deve ser declarada como constante local `const VERSION = '1.0.0'` acompanhada de comentário orientando atualização a cada bump de release. Nenhuma operação de I/O (banco, Redis, filesystem) deve ocorrer durante o processamento da requisição. Importar o logger via `import { logger } from '../lib/logger'` usando `logger.child({ module: 'ping' })` para rastreabilidade.
**Arquivos Afetados**:
- `src/routes/ping.ts` *(novo)*
**Critério de Aceite Técnico**: O módulo exporta um `Router` Express; ao invocar o handler diretamente com mocks de `req`/`res`, `res.status` é chamado com `200` e `res.json` recebe exatamente `{ status: 'ok', version: '1.0.0' }`; o child logger emite `debug` com `route: '/ping'`.
**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-02 — Registrar o router de ping em `src/index.ts`
**Descrição**: Importar o `pingRouter` exportado por `src/routes/ping.ts` e registrá-lo em `src/index.ts` com `app.use('/ping', pingRouter)`. O registro deve ser inserido na seção `── Rotas ──` do arquivo, imediatamente após `app.use(express.json())` e antes de qualquer middleware de autenticação futura, conforme orientação de risco R-01 do PRD. Adicionar comentário inline `// liveness probe — sem dependências externas` para clareza operacional.
**Arquivos Afetados**:
- `src/index.ts`
**Critério de Aceite Técnico**: Após a alteração, `curl -s http://localhost:3000/ping` (com servidor em execução local) retorna HTTP `200` com body `{"status":"ok","version":"1.0.0"}` e header `Content-Type: application/json`.
**Estimativa**: P — < 2h
**Dependências**: TASK-01
**Paralelizável**: Não

---

### TASK-03 — Criar `src/routes/ping.test.ts` com cobertura 100%
**Descrição**: Criar o arquivo de testes `src/routes/ping.test.ts` usando Vitest. A suíte deve cobrir dois níveis: (1) **testes unitários** — mockar `req`/`res` do Express e verificar que o handler chama `res.status(200).json({ status: 'ok', version: '1.0.0' })` e que o logger emite `debug` com `route: '/ping'`; (2) **teste de integração leve com supertest** — importar `app` de `src/index.ts` (já exportado), disparar `GET /ping` contra a instância real do Express e verificar: status HTTP `200`, header `content-type` contendo `application/json`, body exato `{ status: 'ok', version: '1.0.0' }`. A cobertura de linhas de `src/routes/ping.ts` deve atingir 100% ao rodar `npm run test:coverage`. Nota: `supertest` não está listado em `devDependencies` — instalar com `npm install -D supertest @types/supertest` antes de implementar.
**Arquivos Afetados**:
- `src/routes/ping.test.ts` *(novo)*
- `package.json` *(adição de supertest e @types/supertest em devDependencies)*
**Critério de Aceite Técnico**: `npm test` executa todos os casos sem falha; `npm run test:coverage` exibe 100% de cobertura de linhas/branches para `src/routes/ping.ts`; o teste de integração com supertest valida status `200`, `Content-Type: application/json` e body `{"status":"ok","version":"1.0.0"}`.
**Estimativa**: M — 2–4h
**Dependências**: TASK-01
**Paralelizável**: Não

---

### TASK-04 — Atualizar tabela de rotas no `README.md`
**Descrição**: Adicionar uma nova linha na tabela de rotas do `README.md` (seção **Rotas**) documentando o endpoint recém-criado. A linha deve seguir o padrão visual existente: `| \`GET\` | \`/ping\` | Liveness probe — retorna \`{ status, version }\` sem dependências externas |`.
**Arquivos Afetados**:
- `README.md`
**Critério de Aceite Técnico**: A tabela de rotas do `README.md` contém a linha referente a `GET /ping` com descrição do propósito do endpoint; o documento renderiza corretamente em Markdown sem quebras de formatação.
**Estimativa**: P — < 2h
**Dependências**: TASK-01
**Paralelizável**: Sim

## Ordem de Execução

Ondas de execução paralela:

```
Onda 1 (sequencial): TASK-01
Onda 2 (paralelo):   TASK-02, TASK-03, TASK-04
```

## Estimativa Total
- Tasks P (< 2h): 3 tasks — TASK-01, TASK-02, TASK-04
- Tasks M (2–4h): 1 task — TASK-03
- Tasks G (4–8h): 0 tasks
- **Estimativa total**: 4–10 horas (mínimo com paralelismo máximo na Onda 2: ~4h; sequencial completo: ~10h)

## Referências
- PRD: SCRUM-20/PRD.md
- Jira: SCRUM-20