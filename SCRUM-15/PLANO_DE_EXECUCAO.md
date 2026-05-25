# Plano de Execução — SCRUM-15: Implementar autenticação de usuários com JWT - Teste #3 - Fase 2 - Squad Agêntica

## Identificação
- **Jira Key**: SCRUM-15
- **Resumo**: Implementar autenticação de usuários com JWT - Teste #3 - Fase 2 - Squad Agêntica
- **Versão**: 1.0
- **Autor**: Agente LT (IA)
- **Data**: 2026-05-25

## Stack Detectada
- **Runtime**: Node.js 22 / TypeScript 5
- **Framework**: Express 4 (declarado como `^4.21.2` no package.json)
- **Banco de Dados**: PostgreSQL (Supabase) via Drizzle ORM
- **Fila**: BullMQ + Redis (Upstash/IORedis)
- **Validação**: Zod 3
- **Logs**: Pino 10 (JSON estruturado)
- **Testes**: Vitest 3 + @vitest/coverage-v8

## Visão Geral

| ID | Descrição resumida | Estimativa | Dependências | Paralelo |
|----|--------------------|------------|--------------|---------|
| TASK-01 | Instalar dependências JWT e bcrypt | P | — | Sim |
| TASK-02 | Migration Drizzle: tabelas `users` e `user_refresh_tokens` | M | — | Sim |
| TASK-03 | Módulo utilitário de hash de senha (bcrypt, salt ≥ 12) | P | TASK-01 | Sim |
| TASK-04 | Módulo utilitário JWT (geração e verificação de access/refresh token) | P | TASK-01 | Sim |
| TASK-05 | Repositório de usuários via Drizzle ORM | M | TASK-02 | Não |
| TASK-06 | Repositório de refresh tokens via Drizzle ORM | M | TASK-02 | Sim |
| TASK-07 | Endpoint `POST /auth/register` | M | TASK-03, TASK-05 | Não |
| TASK-08 | Endpoint `POST /auth/login` | M | TASK-03, TASK-04, TASK-05, TASK-06 | Não |
| TASK-09 | Endpoint `POST /auth/refresh` | M | TASK-04, TASK-06 | Não |
| TASK-10 | Endpoint `POST /auth/logout` | P | TASK-06 | Não |
| TASK-11 | Middleware Express de autenticação JWT | M | TASK-04 | Sim |
| TASK-12 | Integração do router `/auth` e middleware no servidor Express | P | TASK-07, TASK-08, TASK-09, TASK-10, TASK-11 | Não |
| TASK-13 | Job BullMQ de limpeza periódica de refresh tokens expirados | M | TASK-06 | Não |
| TASK-14 | Logging estruturado Pino nos endpoints de autenticação | P | TASK-12 | Não |
| TASK-15 | Testes de integração Vitest: auth endpoints + middleware | G | TASK-12 | Não |

## Tasks Detalhadas

### TASK-01 — Instalar dependências JWT e bcrypt
**Descrição**: Instalar as bibliotecas de produção `jsonwebtoken` e `bcrypt` (ou `bcryptjs`) e seus tipos TypeScript correspondentes (`@types/jsonwebtoken`, `@types/bcrypt`). Adicionar também `@types/bcrypt` como devDependency. Verificar que `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN` e `JWT_REFRESH_EXPIRES_IN` estão documentados no `.env.example` e que os tipos estão presentes no `process.env` através do arquivo de configuração existente ou de um novo `src/config.ts`.
**Arquivos Afetados**:
- `package.json`
- `.env.example`
- `src/config.ts` (criar se não existir)
**Critério de Aceite Técnico**: `npm install` finaliza sem erros; `import jwt from 'jsonwebtoken'` e `import bcrypt from 'bcrypt'` compilam sem erros de tipo; `.env.example` contém as quatro variáveis JWT documentadas.
**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-02 — Migration Drizzle: tabelas `users` e `user_refresh_tokens`
**Descrição**: Adicionar ao `src/db/schema.ts` as tabelas `users` (campos: `id` UUID PK, `email` text único not-null, `password_hash` text not-null, `created_at` timestamp, `updated_at` timestamp) e `user_refresh_tokens` (campos: `id` UUID PK, `user_id` UUID FK → `users.id` cascade delete, `token_hash` text not-null, `expires_at` timestamp not-null, `revoked` boolean not-null default false, `created_at` timestamp). Criar índices em `user_refresh_tokens(user_id)`, `user_refresh_tokens(expires_at)` e `users(email)`. Executar `npm run db:generate` para gerar o arquivo SQL de migration e `npm run db:migrate` para aplicá-la. Exportar os tipos inferidos `User`, `NewUser`, `UserRefreshToken`, `NewUserRefreshToken`.
**Arquivos Afetados**:
- `src/db/schema.ts`
- `src/db/migrations/` (arquivo SQL gerado pelo Drizzle Kit)
**Critério de Aceite Técnico**: `npm run db:generate` gera migration sem erros; `npm run db:migrate` aplica com sucesso; `npm run typecheck` passa; tabelas `users` e `user_refresh_tokens` existem no banco com os índices corretos verificáveis via `drizzle-kit studio`.
**Estimativa**: M — 2–4h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-03 — Módulo utilitário de hash de senha (bcrypt)
**Descrição**: Criar `src/lib/password.ts` com duas funções exportadas: `hashPassword(plain: string): Promise<string>` (usa `bcrypt.hash` com `saltRounds = 12`) e `verifyPassword(plain: string, hash: string): Promise<boolean>` (usa `bcrypt.compare`). O módulo não deve depender de nenhum modelo de banco. Documentar internamente o trade-off de performance (salt rounds 12 vs 10) conforme R-02 do PRD.
**Arquivos Afetados**:
- `src/lib/password.ts`
**Critério de Aceite Técnico**: `hashPassword('minhasenha')` retorna string bcrypt iniciando com `$2b$12$`; `verifyPassword('minhasenha', hash)` retorna `true`; `verifyPassword('errada', hash)` retorna `false`; verificado via teste unitário Vitest.
**Estimativa**: P — < 2h
**Dependências**: TASK-01
**Paralelizável**: Sim

---

### TASK-04 — Módulo utilitário JWT (geração e verificação)
**Descrição**: Criar `src/lib/jwt.ts` com as funções: `signAccessToken(payload: { userId: string; email: string }): string` (assina com `JWT_SECRET`, expiração de `15m`); `signRefreshToken(payload: { userId: string }): string` (assina com `JWT_REFRESH_SECRET`, expiração de `7d`); `verifyAccessToken(token: string): JwtAccessPayload` (lança `TokenExpiredError` ou `JsonWebTokenError` em caso de falha); `verifyRefreshToken(token: string): JwtRefreshPayload`. Exportar os tipos de payload. O módulo não depende do banco de dados.
**Arquivos Afetados**:
- `src/lib/jwt.ts`
**Critério de Aceite Técnico**: `signAccessToken` e `signRefreshToken` retornam strings JWT válidas decodificáveis; `verifyAccessToken` lança `TokenExpiredError` para token expirado; `verifyRefreshToken` lança `JsonWebTokenError` para assinatura inválida; verificado via teste unitário Vitest.
**Estimativa**: P — < 2h
**Dependências**: TASK-01
**Paralelizável**: Sim

---

### TASK-05 — Repositório de usuários via Drizzle ORM
**Descrição**: Criar `src/db/users.ts` com as funções: `createUser(email: string, passwordHash: string): Promise<User>` (insert + return, lança `ConflictError` customizado se email duplicado via `pg error code 23505`); `findUserByEmail(email: string): Promise<User | null>`; `findUserById(id: string): Promise<User | null>`. Usar o pool de conexão existente (`src/db/index.ts` ou equivalente) e o schema Drizzle de TASK-02.
**Arquivos Afetados**:
- `src/db/users.ts`
- `src/db/errors.ts` (criar classe `ConflictError` reutilizável)
**Critério de Aceite Técnico**: `createUser` insere e retorna o registro sem expor `password_hash`; segunda chamada com mesmo email lança `ConflictError`; `findUserByEmail` retorna `null` para e-mail inexistente; verificado via teste de integração com banco real ou usando `vi.mock` do Drizzle.
**Estimativa**: M — 2–4h
**Dependências**: TASK-02
**Paralelizável**: Não

---

### TASK-06 — Repositório de refresh tokens via Drizzle ORM
**Descrição**: Criar `src/db/refreshTokens.ts` com as funções: `createRefreshToken(userId: string, tokenHash: string, expiresAt: Date): Promise<UserRefreshToken>`; `findActiveRefreshToken(tokenHash: string): Promise<UserRefreshToken | null>` (filtra `revoked = false` e `expires_at > now()`); `revokeRefreshToken(id: string): Promise<void>` (seta `revoked = true`); `deleteExpiredRefreshTokens(): Promise<number>` (deleta onde `expires_at < now()`, retorna count para uso no job BullMQ). O refresh token é armazenado como hash SHA-256 do token original para não expor o valor bruto.
**Arquivos Afetados**:
- `src/db/refreshTokens.ts`
**Critério de Aceite Técnico**: `createRefreshToken` persiste com `revoked = false`; `findActiveRefreshToken` retorna `null` para token revogado ou expirado; `revokeRefreshToken` muda flag para `true` no banco; `deleteExpiredRefreshTokens` retorna número de registros deletados ≥ 0.
**Estimativa**: M — 2–4h
**Dependências**: TASK-02
**Paralelizável**: Sim

---

### TASK-07 — Endpoint `POST /auth/register`
**Descrição**: Criar `src/auth/register.ts` com o handler Express do endpoint `POST /auth/register`. Validar o body com Zod: `email` (z.string().email()), `password` (z.string().min(8)). Em caso de body inválido, retornar HTTP 422 com detalhes Zod. Chamar `hashPassword` de TASK-03 e `createUser` de TASK-05. Capturar `ConflictError` e retornar HTTP 409 `{ "error": "Conflict", "message": "E-mail já cadastrado" }`. Em sucesso, retornar HTTP 201 `{ "id": "...", "email": "..." }` — nunca expor `password_hash`.
**Arquivos Afetados**:
- `src/auth/register.ts`
- `src/auth/router.ts` (criar router Express, registrar `POST /register`)
- `src/auth/schemas.ts` (schemas Zod compartilhados)
**Critério de Aceite Técnico**: `POST /auth/register` com body válido retorna HTTP 201 `{ id, email }`; e-mail duplicado retorna HTTP 409; senha com 7 caracteres retorna HTTP 422; `password_hash` jamais aparece no response body.
**Estimativa**: M — 2–4h
**Dependências**: TASK-03, TASK-05
**Paralelizável**: Não

---

### TASK-08 — Endpoint `POST /auth/login`
**Descrição**: Criar `src/auth/login.ts` com o handler do endpoint `POST /auth/login`. Validar body com Zod (`email`, `password`). Buscar usuário via `findUserByEmail`; se não encontrado ou `verifyPassword` retornar `false`, retornar HTTP 401 `{ "error": "Unauthorized", "message": "Credenciais inválidas" }` (mesma resposta para ambos os casos — evita enumeração de usuários). Em sucesso: gerar `accessToken` via `signAccessToken`, gerar `refreshToken` via `signRefreshToken`, armazenar hash SHA-256 do `refreshToken` via `createRefreshToken` com `expiresAt = now() + 7 days`. Retornar HTTP 200 `{ "accessToken": "...", "refreshToken": "..." }`.
**Arquivos Afetados**:
- `src/auth/login.ts`
- `src/auth/router.ts` (registrar `POST /login`)
**Critério de Aceite Técnico**: Credenciais corretas retornam HTTP 200 com `accessToken` (JWT decodificável com `exp` = agora + 900s) e `refreshToken`; credenciais erradas retornam HTTP 401 com mensagem genérica; tempo total de resposta < 500ms medido localmente com bcrypt salt 12.
**Estimativa**: M — 2–4h
**Dependências**: TASK-03, TASK-04, TASK-05, TASK-06
**Paralelizável**: Não

---

### TASK-09 — Endpoint `POST /auth/refresh`
**Descrição**: Criar `src/auth/refresh.ts` com o handler do endpoint `POST /auth/refresh`. Validar body com Zod: `{ "refreshToken": string }`. Calcular SHA-256 do token recebido e buscar via `findActiveRefreshToken`. Se não encontrado (inexistente, revogado ou expirado), retornar HTTP 401 `{ "error": "Unauthorized", "message": "Refresh token inválido ou expirado" }`. Verificar assinatura JWT com `verifyRefreshToken`. Em sucesso: revogar o token atual via `revokeRefreshToken`, gerar novo par `accessToken` + `refreshToken`, persistir o novo refresh token hash. Retornar HTTP 200 `{ "accessToken": "...", "refreshToken": "..." }`.
**Arquivos Afetados**:
- `src/auth/refresh.ts`
- `src/auth/router.ts` (registrar `POST /refresh`)
**Critério de Aceite Técnico**: Refresh token válido retorna HTTP 200 com novo par de tokens e o token anterior fica `revoked = true` no banco; reuso do token anterior retorna HTTP 401; token com assinatura inválida retorna HTTP 401.
**Estimativa**: M — 2–4h
**Dependências**: TASK-04, TASK-06
**Paralelizável**: Não

---

### TASK-10 — Endpoint `POST /auth/logout`
**Descrição**: Criar `src/auth/logout.ts` com o handler do endpoint `POST /auth/logout`. Validar body com Zod: `{ "refreshToken": string }`. Calcular SHA-256, buscar via `findActiveRefreshToken` e chamar `revokeRefreshToken`. Se não encontrado, retornar HTTP 200 igualmente (evita enumeração — logout idempotente). Retornar HTTP 200 `{ "message": "Logout realizado com sucesso" }`.
**Arquivos Afetados**:
- `src/auth/logout.ts`
- `src/auth/router.ts` (registrar `POST /logout`)
**Critério de Aceite Técnico**: `POST /auth/logout` com refresh token válido retorna HTTP 200 e token fica `revoked = true` no banco; segunda chamada com mesmo token também retorna HTTP 200 (idempotência verificada).
**Estimativa**: P — < 2h
**Dependências**: TASK-06
**Paralelizável**: Não

---

### TASK-11 — Middleware Express de autenticação JWT
**Descrição**: Criar `src/auth/middleware.ts` exportando a função `authenticate` (assinatura `RequestHandler`). O middleware extrai o token do header `Authorization: Bearer <token>` usando regex. Se ausente, retorna HTTP 401 `{ "error": "Unauthorized", "message": "Token não fornecido" }`. Chama `verifyAccessToken`; se lançar `TokenExpiredError`, retorna HTTP 401 `{ "error": "Unauthorized", "message": "Token expirado" }`; se lançar qualquer outro erro, retorna HTTP 401 `{ "error": "Unauthorized", "message": "Token inválido" }`. Em sucesso, injeta `req.user = { userId, email }` e chama `next()`. Extender a interface `Request` do Express via `src/types/express.d.ts` para incluir o campo `user`.
**Arquivos Afetados**:
- `src/auth/middleware.ts`
- `src/types/express.d.ts` (criar: augment `express.Request` com `user?: { userId: string; email: string }`)
**Critério de Aceite Técnico**: Requisição sem header retorna HTTP 401 com `"Token não fornecido"`; token expirado retorna HTTP 401 com `"Token expirado"`; token válido chama `next()` e `req.user` está populado com `userId` e `email` corretos.
**Estimativa**: M — 2–4h
**Dependências**: TASK-04
**Paralelizável**: Sim

---

### TASK-12 — Integração do router `/auth` e middleware no servidor Express
**Descrição**: Registrar o router de autenticação no `src/index.ts` via `app.use('/auth', authRouter)`. Avaliar as rotas existentes quanto à aplicação do middleware `authenticate`: `POST /webhooks/jira` — **não** aplicar (webhook externo do Jira usa `JIRA_WEBHOOK_SECRET` próprio); `GET /health` — **não** aplicar (necessário para monitoramento externo sem credencial). Documentar em comentário no código a decisão explícita para cada rota existente, conforme R-04 do PRD. Garantir que o `express.json()` está registrado antes do router de auth (já presente no servidor atual).
**Arquivos Afetados**:
- `src/index.ts`
- `src/auth/router.ts` (consolidar todos os sub-handlers e exportar o router final)
**Critério de Aceite Técnico**: `GET /health` responde HTTP 200 sem token; `POST /webhooks/jira` sem token responde conforme lógica atual (não HTTP 401); `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh` e `POST /auth/logout` respondem corretamente via servidor Express em execução; `npm run dev` sobe sem erros de TypeScript.
**Estimativa**: P — < 2h
**Dependências**: TASK-07, TASK-08, TASK-09, TASK-10, TASK-11
**Paralelizável**: Não

---

### TASK-13 — Job BullMQ de limpeza periódica de refresh tokens expirados
**Descrição**: Criar `src/jobs/purgeExpiredTokens.ts` com um worker BullMQ que executa `deleteExpiredRefreshTokens()` de TASK-06. Registrar o job recorrente (repeat `cron: '0 3 * * *'` — todo dia às 03h00 UTC) via `src/queue/index.ts` ou equivalente. Adicionar o worker ao graceful shutdown em `src/index.ts`. Logar via Pino o número de tokens deletados por execução. Mitigação direta do risco R-03 do PRD.
**Arquivos Afetados**:
- `src/jobs/purgeExpiredTokens.ts`
- `src/queue/index.ts` (registrar job recorrente)
- `src/index.ts` (adicionar worker ao shutdown)
**Critério de Aceite Técnico**: Worker inicializa sem erros; ao disparar manualmente o job no ambiente de dev, `deleteExpiredRefreshTokens` é chamado e o log Pino emite `{ action: 'purge_expired_tokens', deletedCount: N }`; servidor encerra o worker limpo via SIGTERM.
**Estimativa**: M — 2–4h
**Dependências**: TASK-06
**Paralelizável**: Não

---

### TASK-14 — Logging estruturado Pino nos endpoints de autenticação
**Descrição**: Adicionar logging Pino em todos os handlers de auth (`register`, `login`, `refresh`, `logout`) e no middleware `authenticate`. Cada log deve conter: `action` (ex: `'auth.register'`), `ip` (via `req.ip`), `statusCode`, `durationMs` (calculado com `Date.now()` no início do handler). Quando disponível, incluir `userId`. Nunca logar `password`, `passwordHash`, `accessToken` completo, ou `refreshToken` completo — no máximo os primeiros 8 caracteres com sufixo `'...'` para correlação de debug. Usar o `logger` existente de `src/lib/logger.ts` com child logger `logger.child({ module: 'auth' })`.
**Arquivos Afetados**:
- `src/auth/register.ts`
- `src/auth/login.ts`
- `src/auth/refresh.ts`
- `src/auth/logout.ts`
- `src/auth/middleware.ts`
**Critério de Aceite Técnico**: Para cada requisição de auth, o stdout em JSON Pino contém os campos `action`, `ip`, `statusCode` e `durationMs`; grep no log não encontra nenhuma ocorrência de senha em texto plano; campos de token, quando presentes, aparecem truncados; verificado via CA-07 do PRD.
**Estimativa**: P — < 2h
**Dependências**: TASK-12
**Paralelizável**: Não

---

### TASK-15 — Testes de integração Vitest: auth endpoints + middleware
**Descrição**: Criar `src/auth/__tests__/auth.integration.test.ts` cobrindo os cenários dos critérios de aceite CA-01 a CA-07 do PRD. Usar `supertest` (instalar como devDependency) sobre `app` exportado de `src/index.ts`. Mockar chamadas ao banco via `vi.mock` para os repositórios (`src/db/users.ts`, `src/db/refreshTokens.ts`) ou usar banco de teste em memória. Cobrir: registro bem-sucedido (201), e-mail duplicado (409), senha curta (422), login correto (200 com tokens), credenciais erradas (401), rota protegida sem token (401 "Token não fornecido"), rota protegida com token expirado (401 "Token expirado"), refresh válido (200 + rotação), logout (200 + revogação). Meta: cobertura de linhas ≥ 80% nos arquivos `src/auth/`.
**Arquivos Afetados**:
- `src/auth/__tests__/auth.integration.test.ts`
- `package.json` (adicionar `supertest` e `@types/supertest` como devDependencies)
**Critério de Aceite Técnico**: `npm test` passa 100% dos casos; `npm run test:coverage` reporta cobertura de linhas ≥ 80% para `src/auth/**`; nenhum teste depende de banco real (usa mocks ou banco de teste isolado); pipeline CI não quebra.
**Estimativa**: G — 4–8h
**Dependências**: TASK-12
**Paralelizável**: Não

---

## Ordem de Execução

```
TASK-01 ──► TASK-03 ──► TASK-07 ──┐
         ├► TASK-04 ──► TASK-08 ──┤
         │             TASK-09 ──┤
         │             TASK-10 ──┤
         │             TASK-11 ──┤
         └────────────────────────┤
                                  ▼
TASK-02 ──► TASK-05 ──► TASK-07   TASK-12 ──► TASK-14
         └► TASK-06 ──► TASK-08             └► TASK-15
                     ├► TASK-09
                     ├► TASK-10
                     └► TASK-13
```

Leitura simplificada por ondas de execução paralela:

```
Onda 1 (paralelo): TASK-01, TASK-02
Onda 2 (paralelo): TASK-03, TASK-04, TASK-05, TASK-06
Onda 3 (paralelo): TASK-07, TASK-08, TASK-09, TASK-10, TASK-11, TASK-13
Onda 4 (sequencial): TASK-12
Onda 5 (paralelo): TASK-14, TASK-15
```

## Estimativa Total
- Tasks P (< 2h): 5 tasks — TASK-01, TASK-03, TASK-04, TASK-10, TASK-12, TASK-14
- Tasks M (2–4h): 8 tasks — TASK-02, TASK-05, TASK-06, TASK-07, TASK-08, TASK-09, TASK-11, TASK-13
- Tasks G (4–8h): 1 task — TASK-15
- **Estimativa total**: 26–48 horas brutas (em execução paralela por ondas: ~14–24 horas de clock time com 2 desenvolvedores)

## Referências
- PRD: SCRUM-15/PRD.md
- Jira: SCRUM-15