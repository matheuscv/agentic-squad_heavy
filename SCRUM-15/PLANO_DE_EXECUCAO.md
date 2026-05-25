# Plano de Execução — SCRUM-15: Implementar autenticação de usuários com JWT - Teste #3 - Fase 2 - Squad Agêntica

## Identificação
- **Jira Key**: SCRUM-15
- **Resumo**: Implementar autenticação de usuários com JWT - Teste #3 - Fase 2 - Squad Agêntica
- **Versão**: 1.0
- **Autor**: Agente LT (IA)
- **Data**: 2026-05-25

## Stack Detectada
- **Runtime**: Node.js 22 / TypeScript 5
- **Framework**: Express 4.21 (tipagens Express 5)
- **Banco de Dados**: PostgreSQL (Supabase) via Drizzle ORM 0.45
- **Fila**: BullMQ 5 / Redis (Upstash via IORedis)
- **Testes**: Vitest 3 + @vitest/coverage-v8
- **Logs**: Pino 10 (JSON estruturado)
- **Validação**: Zod 3.24

## Visão Geral

| ID | Descrição resumida | Estimativa | Dependências | Paralelo |
|----|--------------------|------------|--------------|---------|
| TASK-01 | Adicionar dependências JWT e bcrypt + variáveis de ambiente | P | — | Sim |
| TASK-02 | Migration Drizzle: tabelas `users` e `user_refresh_tokens` | M | — | Sim |
| TASK-03 | Módulo utilitário de hashing de senha (bcrypt) | P | TASK-01 | Sim |
| TASK-04 | Módulo utilitário de geração e verificação de JWT | P | TASK-01 | Sim |
| TASK-05 | Atualizar `src/db/schema.ts` com tabelas de autenticação | P | TASK-02 | Não |
| TASK-06 | Middleware Express de autenticação JWT | M | TASK-04, TASK-05 | Não |
| TASK-07 | Endpoint `POST /auth/register` | M | TASK-03, TASK-05 | Não |
| TASK-08 | Endpoint `POST /auth/login` | M | TASK-03, TASK-04, TASK-05 | Não |
| TASK-09 | Endpoint `POST /auth/refresh` e `POST /auth/logout` | M | TASK-04, TASK-05 | Não |
| TASK-10 | Registrar router `/auth` e aplicar middleware nas rotas existentes | P | TASK-06, TASK-07, TASK-08, TASK-09 | Não |
| TASK-11 | Logging estruturado Pino nos endpoints de autenticação | P | TASK-07, TASK-08, TASK-09 | Não |
| TASK-12 | Job BullMQ de limpeza de refresh tokens expirados | M | TASK-05 | Não |
| TASK-13 | Testes de integração Vitest (todos os critérios de aceite) | G | TASK-10, TASK-11 | Não |

## Tasks Detalhadas

### TASK-01 — Adicionar dependências JWT e bcrypt + variáveis de ambiente
**Descrição**: Instalar os pacotes `jsonwebtoken`, `bcrypt` e seus tipos TypeScript (`@types/jsonwebtoken`, `@types/bcrypt`) via npm. Adicionar ao `.env.example` as variáveis `JWT_SECRET` (string aleatória ≥ 64 chars), `JWT_ACCESS_EXPIRES_IN=15m` e `JWT_REFRESH_EXPIRES_IN=7d`. Documentar no README a obrigatoriedade dessas variáveis na seção "Variáveis de Ambiente".

**Arquivos Afetados**:
- `package.json`
- `.env.example`
- `README.md`

**Critério de Aceite Técnico**: `npm install` conclui sem erros; `import jwt from 'jsonwebtoken'` e `import bcrypt from 'bcrypt'` compilam sem erros TypeScript (`npm run typecheck` passa).
**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-02 — Migration Drizzle: tabelas `users` e `user_refresh_tokens`
**Descrição**: Criar a migration Drizzle (via `drizzle-kit generate`) que adiciona as tabelas `users` (`id` UUID PK, `email` TEXT UNIQUE NOT NULL, `password_hash` TEXT NOT NULL, `created_at` TIMESTAMP, `updated_at` TIMESTAMP) e `user_refresh_tokens` (`id` UUID PK, `user_id` UUID FK → `users.id` ON DELETE CASCADE, `token_hash` TEXT NOT NULL, `expires_at` TIMESTAMP NOT NULL, `revoked` BOOLEAN NOT NULL DEFAULT false, `created_at` TIMESTAMP). Criar índices em `user_refresh_tokens(user_id)`, `user_refresh_tokens(expires_at)` e `users(email)` para suportar as queries de autenticação e o job de limpeza de tokens.

**Arquivos Afetados**:
- `src/db/schema.ts` *(pré-requisito para gerar a migration — ver TASK-05)*
- `src/db/migrations/` *(arquivo SQL gerado pelo drizzle-kit)*

**Critério de Aceite Técnico**: `npm run db:migrate` executa sem erros contra o banco de desenvolvimento; as tabelas `users` e `user_refresh_tokens` são criadas e visíveis no Drizzle Studio (`npm run db:studio`).
**Estimativa**: M — 2–4h
**Dependências**: Nenhuma *(schema pode ser editado diretamente antes de gerar a migration)*
**Paralelizável**: Sim

---

### TASK-03 — Módulo utilitário de hashing de senha (bcrypt)
**Descrição**: Criar o módulo `src/lib/password.ts` exportando duas funções puras: `hashPassword(plain: string): Promise<string>` (usa bcrypt com `SALT_ROUNDS = 12`) e `verifyPassword(plain: string, hash: string): Promise<boolean>`. Não depende do banco de dados. Documentar o trade-off de performance do salt rounds 12 em comentário inline (referência ao risco R-02 do PRD).

**Arquivos Afetados**:
- `src/lib/password.ts` *(novo)*

**Critério de Aceite Técnico**: Testes unitários Vitest confirmam que `hashPassword('senha123')` retorna string com prefixo `$2b$12$`; `verifyPassword('senha123', hash)` retorna `true` e `verifyPassword('errada', hash)` retorna `false`. `npm run test` passa.
**Estimativa**: P — < 2h
**Dependências**: TASK-01 (bcrypt instalado)
**Paralelizável**: Sim

---

### TASK-04 — Módulo utilitário de geração e verificação de JWT
**Descrição**: Criar o módulo `src/lib/jwt.ts` exportando: `signAccessToken(payload: { userId: string; email: string }): string` (assina com `JWT_SECRET`, expiração de `JWT_ACCESS_EXPIRES_IN`), `signRefreshToken(payload: { userId: string }): string` (expiração de `JWT_REFRESH_EXPIRES_IN`) e `verifyToken(token: string): JwtPayload` (lança `TokenExpiredError` ou `JsonWebTokenError` para tokens inválidos). Usar `process.env.JWT_SECRET` com guarda de inicialização (lança erro se ausente). Nunca logar o token completo.

**Arquivos Afetados**:
- `src/lib/jwt.ts` *(novo)*

**Critério de Aceite Técnico**: Testes unitários Vitest confirmam que `signAccessToken` produz JWT decodificável com `userId` e `email` no payload; `verifyToken` lança `TokenExpiredError` para token com `expiresIn: -1s`; `verifyToken` lança `JsonWebTokenError` para token adulterado. `npm run test` passa.
**Estimativa**: P — < 2h
**Dependências**: TASK-01 (jsonwebtoken instalado)
**Paralelizável**: Sim

---

### TASK-05 — Atualizar `src/db/schema.ts` com tabelas de autenticação
**Descrição**: Adicionar ao `src/db/schema.ts` as definições Drizzle ORM das tabelas `users` e `userRefreshTokens`, com todos os campos descritos em RF-09. Exportar os tipos inferidos `User`, `NewUser`, `UserRefreshToken` e `NewUserRefreshToken`. Adicionar índices Drizzle em `users(email)`, `userRefreshTokens(userId)` e `userRefreshTokens(expiresAt)`. Após essa edição, executar `npm run db:generate` para gerar o arquivo de migration correspondente.

**Arquivos Afetados**:
- `src/db/schema.ts` *(editar)*
- `src/db/migrations/` *(arquivo SQL gerado)*

**Critério de Aceite Técnico**: `npm run typecheck` passa sem erros; `npm run db:generate` gera migration com as duas tabelas e seus índices; os tipos `User` e `UserRefreshToken` são importáveis em outros módulos.
**Estimativa**: P — < 2h
**Dependências**: TASK-02 *(a migration gerada aqui deve ser consistente com o planejado na TASK-02)*
**Paralelizável**: Não

---

### TASK-06 — Middleware Express de autenticação JWT
**Descrição**: Criar `src/middlewares/auth.ts` exportando o middleware `requireAuth`: extrai o token do header `Authorization: Bearer <token>`, chama `verifyToken()` do módulo `src/lib/jwt.ts`, injeta `req.user = { userId, email }` em caso de sucesso. Em caso de ausência do token retorna HTTP 401 `{ "error": "Unauthorized", "message": "Token não fornecido" }`; para token expirado retorna HTTP 401 `{ "error": "Unauthorized", "message": "Token expirado" }`; para token malformado retorna HTTP 401 `{ "error": "Unauthorized", "message": "Token inválido" }`. Estender a interface `Request` do Express via `src/types/express.d.ts` para incluir `user?: { userId: string; email: string }`.

**Arquivos Afetados**:
- `src/middlewares/auth.ts` *(novo)*
- `src/types/express.d.ts` *(novo)*

**Critério de Aceite Técnico**: Testes unitários Vitest com mocks do `verifyToken` confirmam: (1) requisição sem `Authorization` retorna 401 com `"Token não fornecido"`; (2) token expirado retorna 401 com `"Token expirado"`; (3) token válido injeta `req.user` e chama `next()`; (4) a requisição nunca avança para `next()` em caso de erro.
**Estimativa**: M — 2–4h
**Dependências**: TASK-04, TASK-05
**Paralelizável**: Não

---

### TASK-07 — Endpoint `POST /auth/register`
**Descrição**: Criar `src/auth/register.ts` com o handler do endpoint `POST /auth/register`. Validar o body com Zod: `email` (formato de e-mail) e `password` (mínimo 8 caracteres). Verificar unicidade do e-mail na tabela `users` via Drizzle ORM; em caso de duplicata retornar HTTP 409 `{ "error": "Conflict", "message": "E-mail já cadastrado" }`. Caso contrário, chamar `hashPassword()`, persistir o novo usuário e retornar HTTP 201 `{ "id": "<uuid>", "email": "<email>" }`. Nunca retornar `password_hash` na resposta.

**Arquivos Afetados**:
- `src/auth/register.ts` *(novo)*
- `src/auth/router.ts` *(novo — router Express compartilhado por todos os endpoints de auth)*

**Critério de Aceite Técnico**: `POST /auth/register` com body `{ "email": "a@b.com", "password": "12345678" }` retorna HTTP 201 com `{ id, email }`; reenvio do mesmo e-mail retorna HTTP 409; body com `password` de 7 chars retorna HTTP 400 com erro de validação Zod; `password_hash` nunca aparece na resposta.
**Estimativa**: M — 2–4h
**Dependências**: TASK-03, TASK-05
**Paralelizável**: Não

---

### TASK-08 — Endpoint `POST /auth/login`
**Descrição**: Criar `src/auth/login.ts` com o handler do endpoint `POST /auth/login`. Validar body com Zod (`email`, `password`). Buscar o usuário na tabela `users` pelo e-mail; se não encontrado ou senha incorreta retornar HTTP 401 `{ "error": "Unauthorized", "message": "Credenciais inválidas" }` (resposta genérica para não vazar qual campo está errado). Em caso de sucesso: chamar `signAccessToken()` e `signRefreshToken()`, persistir o hash SHA-256 do refresh token na tabela `user_refresh_tokens` com `expires_at = now() + 7 dias`, retornar HTTP 200 `{ "accessToken": "...", "refreshToken": "..." }`.

**Arquivos Afetados**:
- `src/auth/login.ts` *(novo)*
- `src/auth/router.ts` *(editar)*

**Critério de Aceite Técnico**: `POST /auth/login` com credenciais corretas retorna HTTP 200 com `accessToken` (JWT decodificável, `exp` em ~15 min) e `refreshToken`; credenciais incorretas retornam HTTP 401 com mensagem genérica; um registro é inserido em `user_refresh_tokens` a cada login bem-sucedido.
**Estimativa**: M — 2–4h
**Dependências**: TASK-03, TASK-04, TASK-05
**Paralelizável**: Não

---

### TASK-09 — Endpoints `POST /auth/refresh` e `POST /auth/logout`
**Descrição**: Criar `src/auth/refresh.ts` e `src/auth/logout.ts`. **Refresh**: receber `{ refreshToken }` no body, verificar o JWT com `verifyToken()`, calcular o hash SHA-256 do token recebido, buscar em `user_refresh_tokens` onde `token_hash = hash AND revoked = false AND expires_at > now()`; se não encontrado retornar HTTP 401; se válido: marcar o token atual como `revoked = true`, gerar novo par `accessToken` + `refreshToken`, persistir o novo refresh token e retornar HTTP 200 `{ accessToken, refreshToken }`. **Logout**: receber `{ refreshToken }` no body, localizar e marcar como `revoked = true`; retornar HTTP 204.

**Arquivos Afetados**:
- `src/auth/refresh.ts` *(novo)*
- `src/auth/logout.ts` *(novo)*
- `src/auth/router.ts` *(editar)*

**Critério de Aceite Técnico**: `POST /auth/refresh` com refresh token válido retorna HTTP 200 com novo par de tokens e o token anterior fica com `revoked = true` no banco; reuso do token revogado retorna HTTP 401; `POST /auth/logout` com token válido retorna HTTP 204 e o token fica revogado, impedindo uso posterior no `/auth/refresh`.
**Estimativa**: M — 2–4h
**Dependências**: TASK-04, TASK-05
**Paralelizável**: Não

---

### TASK-10 — Registrar router `/auth` e aplicar middleware nas rotas existentes
**Descrição**: Em `src/index.ts`, importar e montar o `authRouter` em `/auth`. Avaliar e aplicar o middleware `requireAuth` nas rotas existentes conforme decisão de escopo: `POST /webhooks/jira` (manter sem autenticação, pois usa HMAC do Jira como validação própria — documentar a decisão em comentário inline); `GET /health` (manter público, pois é usado por health checks externos). Garantir que a ordem de middlewares no Express não cause conflito (auth antes dos handlers de rota protegida).

**Arquivos Afetados**:
- `src/index.ts` *(editar)*
- `src/auth/router.ts` *(finalizar)*

**Critério de Aceite Técnico**: `GET /health` e `POST /webhooks/jira` retornam suas respostas normais sem token; `npm run typecheck` passa; servidor inicia sem erros com `npm run dev`; uma requisição `GET /health` retorna HTTP 200/503 normalmente após a alteração.
**Estimativa**: P — < 2h
**Dependências**: TASK-06, TASK-07, TASK-08, TASK-09
**Paralelizável**: Não

---

### TASK-11 — Logging estruturado Pino nos endpoints de autenticação
**Descrição**: Em cada handler de autenticação (`register`, `login`, `refresh`, `logout`), adicionar logging Pino via child logger (`logger.child({ module: 'auth' })`). Cada log deve conter obrigatoriamente: `action` (ex: `'register'`, `'login'`), `ip` (extraído de `req.ip` ou `X-Forwarded-For`), `statusCode` (código HTTP da resposta), `durationMs` (tempo entre início e fim do handler). Quando disponível, incluir `userId`. **Nunca** logar `password`, `password_hash`, `accessToken`, `refreshToken` ou `token_hash`. Adicionar middleware `onFinished`/timing no início de cada handler para calcular `durationMs`.

**Arquivos Afetados**:
- `src/auth/register.ts` *(editar)*
- `src/auth/login.ts` *(editar)*
- `src/auth/refresh.ts` *(editar)*
- `src/auth/logout.ts` *(editar)*

**Critério de Aceite Técnico**: Ao executar `POST /auth/login` bem-sucedido e capturar stdout com `pino-pretty`, o log emitido contém os campos `action`, `ip`, `statusCode`, `durationMs` e `userId`; ausência total de campos `password`, `token` ou `hash` no output do log.
**Estimativa**: P — < 2h
**Dependências**: TASK-07, TASK-08, TASK-09
**Paralelizável**: Não

---

### TASK-12 — Job BullMQ de limpeza de refresh tokens expirados
**Descrição**: Criar `src/jobs/purge-expired-tokens.ts` com a função de processamento do job: executa `DELETE FROM user_refresh_tokens WHERE expires_at < NOW()` via Drizzle ORM. Registrar o job como worker BullMQ com fila `'auth:maintenance'` e configurar um job repetido (cron `'0 3 * * *'` — diariamente às 3h UTC) em `src/index.ts`. Logar o número de registros deletados em cada execução. Isso mitiga o risco R-03 do PRD (acúmulo de tokens no banco).

**Arquivos Afetados**:
- `src/jobs/purge-expired-tokens.ts` *(novo)*
- `src/index.ts` *(editar — registrar worker e job repetido)*

**Critério de Aceite Técnico**: O worker é instanciado sem erro na inicialização do servidor; ao disparar o job manualmente via BullMQ (`queue.add(...)`) em ambiente de desenvolvimento, a query de DELETE é executada e o log Pino emite `{ action: 'purge_expired_tokens', deletedCount: N }`.
**Estimativa**: M — 2–4h
**Dependências**: TASK-05
**Paralelizável**: Não

---

### TASK-13 — Testes de integração Vitest (todos os critérios de aceite)
**Descrição**: Criar a suíte de testes de integração em `src/auth/__tests__/auth.integration.test.ts` usando Vitest + `supertest` (instalar se necessário). Cobrir todos os critérios de aceite do PRD (CA-01 a CA-07), incluindo: registro com sucesso e com e-mail duplicado (CA-01, CA-06); login com credenciais corretas e incorretas dentro do SLA de 500ms (CA-02); rotas protegidas sem token e com token expirado (CA-03, CA-04); refresh token válido e reuso de token revogado (CA-05); verificação de ausência de dados sensíveis nos logs (CA-07). Usar banco de dados de teste isolado (variável `DATABASE_URL_TEST`) ou mocks Drizzle via `vi.mock`.

**Arquivos Afetados**:
- `src/auth/__tests__/auth.integration.test.ts` *(novo)*
- `src/lib/__tests__/password.test.ts` *(novo — testes unitários de TASK-03)*
- `src/lib/__tests__/jwt.test.ts` *(novo — testes unitários de TASK-04)*
- `src/middlewares/__tests__/auth.test.ts` *(novo — testes unitários de TASK-06)*
- `vitest.config.ts` *(editar se necessário — adicionar env vars de teste)*

**Critério de Aceite Técnico**: `npm run test` passa com 0 falhas; `npm run test:coverage` reporta ≥ 80% de cobertura nas linhas dos módulos `src/auth/` e `src/lib/`; o teste CA-02 mensura e valida `durationMs < 500` para o endpoint de login.
**Estimativa**: G — 4–8h
**Dependências**: TASK-10, TASK-11
**Paralelizável**: Não

## Ordem de Execução

```
TASK-01 ──► TASK-03 ──► TASK-07 ──┐
         └► TASK-04 ──► TASK-08 ──┤
                      └► TASK-09 ──┤
TASK-02 ──► TASK-05 ──► TASK-06 ──┤
                      └──────────► TASK-10 ──► TASK-11 ──► TASK-13
                      └► TASK-12
```

*(TASK-01 e TASK-02 iniciam em paralelo; TASK-03 e TASK-04 rodam em paralelo após TASK-01; TASK-07, TASK-08 e TASK-09 rodam em paralelo após suas dependências estarem prontas; TASK-12 pode rodar em paralelo após TASK-05)*

## Estimativa Total
- Tasks P (< 2h): 5 tasks (TASK-01, TASK-03, TASK-04, TASK-05, TASK-10, TASK-11)
- Tasks M (2–4h): 6 tasks (TASK-02, TASK-06, TASK-07, TASK-08, TASK-09, TASK-12)
- Tasks G (4–8h): 1 task (TASK-13)
- **Estimativa total**: 20–38 horas

## Referências
- PRD: SCRUM-15/PRD.md
- Jira: SCRUM-15