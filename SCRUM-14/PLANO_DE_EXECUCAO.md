# Plano de Execução — SCRUM-14: Implementar autenticação de usuários com JWT

## Identificação
- **Jira Key**: SCRUM-14
- **Resumo**: Implementar autenticação de usuários com JWT - Teste #2 - Fase 2 - Squad Agêntica
- **Versão**: 1.0
- **Autor**: Agente LT (IA)
- **Data**: 2026-05-25

## Stack Detectada
- **Runtime**: Node.js 22 / TypeScript 5
- **Framework**: Express 4 (declarado como `^4.21.2` no package.json)
- **Banco de Dados**: PostgreSQL (Supabase) via Drizzle ORM
- **Fila**: BullMQ + Redis (Upstash / ioredis)
- **Testes**: Vitest 3 + @vitest/coverage-v8
- **Logs**: Pino (JSON estruturado)
- **Validação**: Zod 3

## Visão Geral

| ID | Descrição resumida | Estimativa | Dependências | Paralelo |
|----|--------------------|------------|--------------|---------|
| TASK-01 | Adicionar tabela `users` ao schema Drizzle e gerar migration | M | — | Sim |
| TASK-02 | Módulo utilitário de hash de senha (bcrypt/argon2) | P | — | Sim |
| TASK-03 | Módulo utilitário JWT (sign/verify access & refresh tokens) | P | — | Sim |
| TASK-04 | Variáveis de ambiente para JWT e validação com Zod | P | — | Sim |
| TASK-05 | Endpoint `POST /auth/login` | M | TASK-01, TASK-02, TASK-03, TASK-04 | Não |
| TASK-06 | Endpoint `POST /auth/refresh` | M | TASK-03, TASK-04 | Não |
| TASK-07 | Middleware de autenticação JWT para rotas protegidas | P | TASK-03 | Não |
| TASK-08 | Rate limiting no endpoint de login | P | TASK-05 | Não |
| TASK-09 | Logging de tentativas inválidas de acesso (RF-08) | P | TASK-05, TASK-07 | Não |
| TASK-10 | Testes unitários e de integração (login, refresh, middleware) | G | TASK-05, TASK-06, TASK-07 | Não |

## Tasks Detalhadas

### TASK-01 — Adicionar tabela `users` ao schema Drizzle e gerar migration
**Descrição**: Estender `src/db/schema.ts` com a tabela `users`, contendo os campos: `id` (uuid PK), `email` (text, unique, not null), `password_hash` (text, not null), `roles` (text array, default `['user']`), `created_at` e `updated_at` (timestamps). Exportar os tipos inferidos `User` e `NewUser`. Executar `npm run db:generate` para gerar o arquivo SQL de migration em `src/db/migrations/`. O campo `password_hash` jamais deve expor o valor em logs ou respostas de API — adicionar comentário no schema reforçando esta restrição.

**Arquivos Afetados**:
- `src/db/schema.ts`
- `src/db/migrations/<timestamp>_add_users_table.sql` *(gerado automaticamente)*

**Critério de Aceite Técnico**: `src/db/schema.ts` exporta a tabela `users` com todos os campos especificados; `npm run db:generate` produz migration SQL sem erros; `npm run typecheck` passa sem erros de tipo.

**Estimativa**: M — 2–4h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-02 — Módulo utilitário de hash de senha
**Descrição**: Criar `src/lib/password.ts` com dois exports: `hashPassword(plain: string): Promise<string>` e `verifyPassword(plain: string, hash: string): Promise<boolean>`. Utilizar `argon2` (preferencialmente) ou `bcrypt` com custo mínimo 10. Instalar a dependência necessária (`argon2` via `npm install argon2`). O módulo não deve importar nada do banco de dados — é um utilitário puro. Adicionar JSDoc explicitando que `plain` nunca deve ser logado.

**Arquivos Afetados**:
- `src/lib/password.ts` *(novo)*
- `package.json` *(nova dependência `argon2`)*

**Critério de Aceite Técnico**: `hashPassword('senha123')` retorna string iniciada com `$argon2`; `verifyPassword('senha123', hash)` retorna `true`; `verifyPassword('errada', hash)` retorna `false`; módulo não importa `schema.ts` nem `db/`.

**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-03 — Módulo utilitário JWT (sign/verify)
**Descrição**: Criar `src/lib/jwt.ts` com as funções: `signAccessToken(payload: JwtUserPayload): string`, `signRefreshToken(userId: string): string` e `verifyToken(token: string, secret: string): JwtUserPayload | RefreshPayload`. O tipo `JwtUserPayload` deve conter `{ user_id: string; email: string; roles: string[] }`. Usar o algoritmo HS256 com `jsonwebtoken` (instalar via `npm install jsonwebtoken` + `@types/jsonwebtoken`). Os segredos e TTLs devem ser recebidos como parâmetro ou lidos do módulo de configuração (TASK-04). Lançar erro tipado `TokenExpiredError` e `JsonWebTokenError` para tratamento nos middlewares.

**Arquivos Afetados**:
- `src/lib/jwt.ts` *(novo)*
- `package.json` *(novas dependências `jsonwebtoken`, `@types/jsonwebtoken`)*

**Critério de Aceite Técnico**: `signAccessToken({ user_id, email, roles })` retorna JWT decodificável com `jsonwebtoken.decode()`; `verifyToken(token, secret)` lança `TokenExpiredError` para token expirado e `JsonWebTokenError` para token malformado; módulo não importa `schema.ts` nem `db/`.

**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-04 — Variáveis de ambiente JWT e validação com Zod
**Descrição**: Criar `src/config/env.ts` (ou estender um existente) com um schema Zod que valide as variáveis de ambiente relacionadas à autenticação: `JWT_ACCESS_SECRET` (string, min 32 chars), `JWT_REFRESH_SECRET` (string, min 32 chars), `JWT_ACCESS_EXPIRES_IN` (string, default `'15m'`) e `JWT_REFRESH_EXPIRES_IN` (string, default `'7d'`). O módulo deve fazer `parse` no momento da importação e lançar erro descritivo em caso de variável ausente ou inválida, impedindo a inicialização do servidor. Adicionar as variáveis ao `.env.example`.

**Arquivos Afetados**:
- `src/config/env.ts` *(novo)*
- `.env.example`

**Critério de Aceite Técnico**: Importar `src/config/env.ts` sem as variáveis `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` definidas lança `ZodError` com mensagem legível; com variáveis válidas, exporta objeto tipado com os 4 campos; `npm run typecheck` passa.

**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-05 — Endpoint `POST /auth/login`
**Descrição**: Criar o router `src/auth/router.ts` e o handler `src/auth/handlers/login.ts`. O endpoint recebe `{ email: string, password: string }` via JSON, valida o schema com Zod (retorna 400 em caso de payload inválido), busca o usuário na tabela `users` pelo e-mail usando Drizzle ORM, compara a senha com `verifyPassword` (TASK-02) e, em caso de sucesso, chama `signAccessToken` e `signRefreshToken` (TASK-03) com os dados do usuário. Resposta de sucesso: HTTP 200 com `{ access_token: string, refresh_token: string, expires_in: number }`. Credenciais inválidas: HTTP 401 com `{ "error": "invalid_credentials" }` — mesma resposta para e-mail inexistente e senha errada (sem vazar qual campo falhou). Registrar o router em `src/index.ts` como `app.use('/auth', authRouter)`.

**Arquivos Afetados**:
- `src/auth/router.ts` *(novo)*
- `src/auth/handlers/login.ts` *(novo)*
- `src/index.ts` *(registrar router)*

**Critério de Aceite Técnico**: `POST /auth/login` com credenciais válidas retorna HTTP 200 com JSON contendo `access_token` (JWT decodificável) e `refresh_token`; com e-mail inexistente retorna HTTP 401 `{"error":"invalid_credentials"}`; com senha errada retorna HTTP 401 `{"error":"invalid_credentials"}`; com payload malformado retorna HTTP 400.

**Estimativa**: M — 2–4h
**Dependências**: TASK-01, TASK-02, TASK-03, TASK-04
**Paralelizável**: Não

---

### TASK-06 — Endpoint `POST /auth/refresh`
**Descrição**: Criar o handler `src/auth/handlers/refresh.ts`. O endpoint recebe `{ refresh_token: string }` via JSON, valida com Zod, chama `verifyToken` do módulo JWT (TASK-03) usando `JWT_REFRESH_SECRET`. Se o token for válido, extrai o `user_id`, consulta o usuário no banco para confirmar existência (evitar refresh de usuário deletado), e retorna HTTP 200 com `{ access_token: string, expires_in: number }`. Em caso de token inválido ou expirado, retorna HTTP 401 com `{ "error": "invalid_token" }`. Registrar a rota em `src/auth/router.ts`.

**Arquivos Afetados**:
- `src/auth/handlers/refresh.ts` *(novo)*
- `src/auth/router.ts` *(adicionar rota `POST /refresh`)*

**Critério de Aceite Técnico**: `POST /auth/refresh` com refresh token válido retorna HTTP 200 com novo `access_token` JWT; com token expirado retorna HTTP 401 `{"error":"invalid_token"}`; com token malformado retorna HTTP 401 `{"error":"invalid_token"}`; com payload faltando `refresh_token` retorna HTTP 400.

**Estimativa**: M — 2–4h
**Dependências**: TASK-03, TASK-04
**Paralelizável**: Não

---

### TASK-07 — Middleware de autenticação JWT para rotas protegidas
**Descrição**: Criar `src/auth/middleware/authenticate.ts` exportando um middleware Express `authenticate`. O middleware extrai o token do header `Authorization: Bearer <token>`, chama `verifyToken` (TASK-03) com `JWT_ACCESS_SECRET`, e em caso de sucesso injeta o payload decodificado em `res.locals.user` (tipado como `JwtUserPayload`). Se o header estiver ausente, malformado, ou o token for inválido/expirado, retorna imediatamente HTTP 401 com `{ "error": "unauthorized" }`. Exportar também o tipo `AuthenticatedLocals` para uso pelos handlers protegidos. Criar `src/auth/middleware/index.ts` re-exportando o middleware.

**Arquivos Afetados**:
- `src/auth/middleware/authenticate.ts` *(novo)*
- `src/auth/middleware/index.ts` *(novo)*

**Critério de Aceite Técnico**: Rota protegida com `authenticate` retorna HTTP 401 quando `Authorization` header está ausente; retorna HTTP 401 para token expirado; retorna HTTP 401 para token malformado; permite requisição e popula `res.locals.user` corretamente com token válido.

**Estimativa**: P — < 2h
**Dependências**: TASK-03
**Paralelizável**: Não

---

### TASK-08 — Rate limiting no endpoint de login
**Descrição**: Instalar `express-rate-limit` (`npm install express-rate-limit`) e criar `src/auth/middleware/rateLimiter.ts` com um limiter configurado para máximo de 5 requisições por IP em janela de 60 segundos, retornando HTTP 429 com `{ "error": "too_many_requests" }` ao exceder o limite. Aplicar o limiter exclusivamente na rota `POST /auth/login` em `src/auth/router.ts`. O limiter deve usar o header padrão `RateLimit-*` (RFC 6585) na resposta. A janela e o limite devem ser configuráveis via variáveis de ambiente `LOGIN_RATE_LIMIT_WINDOW_MS` (default `60000`) e `LOGIN_RATE_LIMIT_MAX` (default `5`), adicionadas ao `src/config/env.ts` e ao `.env.example`.

**Arquivos Afetados**:
- `src/auth/middleware/rateLimiter.ts` *(novo)*
- `src/auth/router.ts` *(aplicar limiter na rota de login)*
- `src/config/env.ts` *(novas variáveis)*
- `.env.example`
- `package.json` *(nova dependência `express-rate-limit`)*

**Critério de Aceite Técnico**: Após 5 requisições consecutivas ao `POST /auth/login` pelo mesmo IP, a 6ª retorna HTTP 429 com `{"error":"too_many_requests"}`; requisições a outras rotas não são afetadas pelo limiter; header `RateLimit-Remaining` presente nas respostas.

**Estimativa**: P — < 2h
**Dependências**: TASK-05
**Paralelizável**: Não

---

### TASK-09 — Logging de tentativas inválidas de acesso
**Descrição**: Integrar logs Pino (usando o `logger` existente em `src/lib/logger.ts`) em dois pontos: (1) no handler de login (`src/auth/handlers/login.ts`), registrar `logger.warn` em caso de credenciais inválidas com campos `{ route: 'POST /auth/login', ip: req.ip, timestamp }`; (2) no middleware `authenticate` (`src/auth/middleware/authenticate.ts`), registrar `logger.warn` em caso de token inválido/expirado com campos `{ route: req.path, method: req.method, ip: req.ip, reason: 'token_expired' | 'token_invalid' | 'missing_token', timestamp }`. Em ambos os casos, garantir que o token completo e a senha **nunca** apareçam no log. Adicionar child logger com `module: 'auth'`.

**Arquivos Afetados**:
- `src/auth/handlers/login.ts` *(adicionar warn log)*
- `src/auth/middleware/authenticate.ts` *(adicionar warn log)*

**Critério de Aceite Técnico**: Ao tentar login com credenciais inválidas, linha JSON de log com `level: 'warn'` e `module: 'auth'` é emitida para stdout sem conter os campos `password` ou `password_hash`; ao acessar rota protegida com token expirado, linha JSON de log com `reason: 'token_expired'` é emitida sem conter o token.

**Estimativa**: P — < 2h
**Dependências**: TASK-05, TASK-07
**Paralelizável**: Não

---

### TASK-10 — Testes unitários e de integração
**Descrição**: Criar suite de testes com Vitest cobrindo os módulos críticos de autenticação. Testes unitários para `src/lib/password.ts` (hash e verify) e `src/lib/jwt.ts` (sign, verify, expiração). Testes de integração usando `supertest` (`npm install -D supertest @types/supertest`) para os endpoints: `POST /auth/login` (sucesso, credencial inválida, payload malformado), `POST /auth/refresh` (sucesso, token expirado, token malformado) e rota protegida com middleware `authenticate` (com/sem token, token expirado). Mockar a camada de banco de dados com `vi.mock` para isolar os handlers. Cobertura mínima de 80% das linhas nos arquivos de `src/auth/` e `src/lib/password.ts` + `src/lib/jwt.ts`, verificada via `npm run test:coverage`.

**Arquivos Afetados**:
- `src/lib/password.test.ts` *(novo)*
- `src/lib/jwt.test.ts` *(novo)*
- `src/auth/handlers/login.test.ts` *(novo)*
- `src/auth/handlers/refresh.test.ts` *(novo)*
- `src/auth/middleware/authenticate.test.ts` *(novo)*
- `package.json` *(novas devDependencies `supertest`, `@types/supertest`)*

**Critério de Aceite Técnico**: `npm test` passa com 0 falhas; `npm run test:coverage` reporta ≥ 80% de cobertura de linhas para todos os arquivos em `src/auth/`, `src/lib/password.ts` e `src/lib/jwt.ts`; testes de integração validam os status codes HTTP e schemas de resposta JSON descritos nos critérios de aceite do PRD (CA-01 a CA-05).

**Estimativa**: G — 4–8h
**Dependências**: TASK-05, TASK-06, TASK-07
**Paralelizável**: Não

## Ordem de Execução

```
TASK-01 ──┐
TASK-02 ──┤
TASK-03 ──┼──► TASK-05 ──► TASK-08 ──► TASK-09 ──► TASK-10
TASK-04 ──┘         │                       ▲
                     │                       │
           TASK-03 ──► TASK-06 ──────────────┤
                                             │
           TASK-03 ──► TASK-07 ─────────────┘
```

> **Tasks paralelizáveis no início** (sem dependências entre si): TASK-01, TASK-02, TASK-03, TASK-04 — podem ser executadas simultaneamente por desenvolvedores diferentes.
> TASK-06 depende apenas de TASK-03 e TASK-04, podendo iniciar em paralelo com TASK-05 após a conclusão dessas.
> TASK-07 depende apenas de TASK-03, podendo iniciar em paralelo com TASK-05 e TASK-06.
> TASK-08 aguarda TASK-05. TASK-09 aguarda TASK-05 e TASK-07. TASK-10 aguarda TASK-05, TASK-06 e TASK-07.

## Estimativa Total
- Tasks P (< 2h): 6 tasks (TASK-02, TASK-03, TASK-04, TASK-07, TASK-08, TASK-09)
- Tasks M (2–4h): 3 tasks (TASK-01, TASK-05, TASK-06)
- Tasks G (4–8h): 1 task (TASK-10)
- **Estimativa total**: 18–34 horas (execução sequencial) / **8–12 horas** (execução paralela com 2–3 desenvolvedores)

## Referências
- PRD: SCRUM-14/PRD.md
- Jira: SCRUM-14