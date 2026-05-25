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
- **Testes**: Vitest + v8 coverage
- **Logs**: Pino (JSON estruturado)
- **Validação**: Zod

## Visão Geral

| ID | Descrição resumida | Estimativa | Dependências | Paralelo |
|----|--------------------|------------|--------------|---------|
| TASK-01 | Migration Drizzle: tabelas `users` e `user_refresh_tokens` | M | — | Sim |
| TASK-02 | Módulo utilitário de hashing de senha (bcrypt wrapper) | P | — | Sim |
| TASK-03 | Módulo utilitário JWT (sign access token, sign refresh token, verify) | P | — | Sim |
| TASK-04 | Schemas Zod para validação dos payloads de autenticação | P | — | Sim |
| TASK-05 | Schema Drizzle para `users` e `user_refresh_tokens` + tipos inferidos | P | TASK-01 | Não |
| TASK-06 | Endpoint `POST /auth/register` | M | TASK-02, TASK-04, TASK-05 | Não |
| TASK-07 | Endpoint `POST /auth/login` | M | TASK-02, TASK-03, TASK-04, TASK-05 | Não |
| TASK-08 | Endpoint `POST /auth/refresh` | M | TASK-03, TASK-05 | Não |
| TASK-09 | Endpoint `POST /auth/logout` | P | TASK-05 | Não |
| TASK-10 | Middleware Express de autenticação JWT | M | TASK-03 | Não |
| TASK-11 | Registro do router `/auth` e aplicação do middleware nas rotas protegidas | P | TASK-06, TASK-07, TASK-08, TASK-09, TASK-10 | Não |
| TASK-12 | Logging estruturado Pino em todos os endpoints de autenticação | P | TASK-11 | Não |
| TASK-13 | Worker BullMQ de limpeza de refresh tokens expirados | M | TASK-05 | Não |
| TASK-14 | Testes de integração Vitest — fluxo de autenticação e middleware | G | TASK-11 | Não |
| TASK-15 | Documentação de variáveis de ambiente e runbook de rotação de `JWT_SECRET` | P | TASK-11 | Não |

## Tasks Detalhadas

### TASK-01 — Migration Drizzle: tabelas `users` e `user_refresh_tokens`
**Descrição**: Criar a migration SQL via Drizzle Kit adicionando as tabelas `users` e `user_refresh_tokens` ao banco PostgreSQL. A tabela `users` deve conter: `id` (UUID PK), `email` (text, unique, not null), `password_hash` (text, not null), `created_at` e `updated_at` (timestamp, not null, defaultNow). A tabela `user_refresh_tokens` deve conter: `id` (UUID PK), `user_id` (UUID FK → `users.id`, on delete cascade), `token_hash` (text, not null), `expires_at` (timestamp, not null), `revoked` (boolean, not null, default false), `created_at` (timestamp, not null, defaultNow). Adicionar índices em `user_refresh_tokens.user_id` e `user_refresh_tokens.expires_at` para performance da limpeza periódica (mitigação de R-03).
**Arquivos Afetados**:
- `src/db/schema.ts` *(adição das novas tabelas e enums ao schema existente)*
- `src/db/migrations/` *(arquivo SQL gerado pelo `npm run db:generate`)*
**Critério de Aceite Técnico**: Executar `npm run db:migrate` em ambiente local com sucesso; `SELECT * FROM users LIMIT 1` e `SELECT * FROM user_refresh_tokens LIMIT 1` retornam resultado vazio sem erro; índices confirmados via `\d user_refresh_tokens` no psql.
**Estimativa**: M — 2–4h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-02 — Módulo utilitário de hashing de senha (bcrypt wrapper)
**Descrição**: Implementar módulo `src/lib/password.ts` expondo duas funções: `hashPassword(plain: string): Promise<string>` usando `bcrypt` com `saltRounds = 12`, e `verifyPassword(plain: string, hash: string): Promise<boolean>`. Instalar a dependência `bcrypt` e seus tipos (`@types/bcrypt`). O módulo não tem dependência do banco de dados e pode ser desenvolvido e testado de forma totalmente isolada.
**Arquivos Afetados**:
- `src/lib/password.ts` *(novo)*
- `package.json` *(adicionar `bcrypt` e `@types/bcrypt`)*
**Critério de Aceite Técnico**: Teste unitário Vitest valida: `hashPassword('senha123')` retorna string iniciada com `$2b$12$`; `verifyPassword('senha123', hash)` retorna `true`; `verifyPassword('errada', hash)` retorna `false`.
**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-03 — Módulo utilitário JWT (sign e verify)
**Descrição**: Implementar módulo `src/lib/jwt.ts` expondo: `signAccessToken(payload: { userId: string; email: string }): string` (expiração 15min), `signRefreshToken(payload: { userId: string }): string` (expiração 7 dias), e `verifyToken(token: string): JwtPayload` (lança `TokenExpiredError` ou `JsonWebTokenError` em caso de falha). Instalar `jsonwebtoken` e `@types/jsonwebtoken`. O segredo é lido de `process.env.JWT_SECRET` — lançar erro na inicialização se ausente. Módulo independente do banco de dados.
**Arquivos Afetados**:
- `src/lib/jwt.ts` *(novo)*
- `package.json` *(adicionar `jsonwebtoken` e `@types/jsonwebtoken`)*
**Critério de Aceite Técnico**: Teste unitário Vitest valida: token gerado por `signAccessToken` é verificado com sucesso por `verifyToken`; `verifyToken` com token adulterado lança `JsonWebTokenError`; token expirado (usando `Date` mockado) lança `TokenExpiredError`.
**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-04 — Schemas Zod para validação dos payloads de autenticação
**Descrição**: Implementar `src/auth/schemas.ts` com schemas Zod para validação de entrada dos endpoints de autenticação: `registerSchema` (campos `email` com validação de formato e `password` com mínimo 8 caracteres), `loginSchema` (mesmos campos sem restrições adicionais) e `refreshSchema` (campo `refreshToken: string`). Exportar também os tipos TypeScript inferidos de cada schema. Módulo sem dependências externas além do Zod (já instalado).
**Arquivos Afetados**:
- `src/auth/schemas.ts` *(novo)*
**Critério de Aceite Técnico**: Teste unitário Vitest valida: `registerSchema.parse({ email: 'x@y.com', password: '12345678' })` não lança; `registerSchema.parse({ email: 'invalido', password: '123' })` lança `ZodError` com dois erros (email e senha); `refreshSchema.parse({})` lança `ZodError`.
**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-05 — Definições Drizzle ORM para `users` e `user_refresh_tokens` + tipos TypeScript inferidos
**Descrição**: Atualizar `src/db/schema.ts` adicionando as definições Drizzle das tabelas `users` e `user_refresh_tokens` (espelhando exatamente a migration criada em TASK-01) com todos os índices declarados. Exportar os tipos inferidos: `User`, `NewUser`, `UserRefreshToken`, `NewUserRefreshToken`. Esses tipos serão consumidos por todos os handlers de autenticação. Esta task depende da TASK-01 apenas para garantir consistência entre schema TypeScript e migration SQL.
**Arquivos Afetados**:
- `src/db/schema.ts` *(atualização — adição das novas tabelas ao arquivo existente)*
**Critério de Aceite Técnico**: `npm run typecheck` executa sem erros; importar `users` e `userRefreshTokens` de `src/db/schema.ts` em um arquivo de teste retorna os objetos de tabela Drizzle corretamente tipados.
**Estimativa**: P — < 2h
**Dependências**: TASK-01
**Paralelizável**: Não

---

### TASK-06 — Endpoint `POST /auth/register`
**Descrição**: Implementar handler `src/auth/handlers/register.ts` e rota `POST /auth/register`. O handler deve: (1) validar o corpo com `registerSchema` (Zod), retornando HTTP 422 em caso de falha de validação; (2) verificar se o e-mail já existe na tabela `users` via Drizzle, retornando HTTP 409 com `{ "error": "Conflict", "message": "E-mail já cadastrado" }` se existir; (3) chamar `hashPassword` para gerar o hash bcrypt; (4) inserir o novo usuário na tabela `users` via Drizzle; (5) retornar HTTP 201 com `{ id, email }`. Nenhum campo sensível (`password_hash`) deve constar na resposta.
**Arquivos Afetados**:
- `src/auth/handlers/register.ts` *(novo)*
- `src/auth/router.ts` *(novo — router Express consolidado de autenticação)*
**Critério de Aceite Técnico**: `POST /auth/register` com body `{ email: "a@b.com", password: "senha1234" }` retorna HTTP 201 com `{ id: <uuid>, email: "a@b.com" }` sem `password_hash`; segunda chamada com mesmo e-mail retorna HTTP 409; body inválido retorna HTTP 422.
**Estimativa**: M — 2–4h
**Dependências**: TASK-02, TASK-04, TASK-05
**Paralelizável**: Não

---

### TASK-07 — Endpoint `POST /auth/login`
**Descrição**: Implementar handler `src/auth/handlers/login.ts` e rota `POST /auth/login`. O handler deve: (1) validar o corpo com `loginSchema` (Zod); (2) buscar o usuário pelo e-mail na tabela `users`; (3) usar `verifyPassword` para comparar a senha; (4) em caso de credenciais inválidas (usuário não encontrado ou senha incorreta), retornar HTTP 401 com `{ "error": "Unauthorized", "message": "Credenciais inválidas" }` — sem distinguir os dois casos (evitar user enumeration); (5) gerar `accessToken` (15min) e `refreshToken` (7 dias) via módulo JWT; (6) persistir o hash SHA-256 do `refreshToken` na tabela `user_refresh_tokens` com `expires_at = now + 7 days`; (7) retornar HTTP 200 com `{ accessToken, refreshToken }`.
**Arquivos Afetados**:
- `src/auth/handlers/login.ts` *(novo)*
- `src/auth/router.ts` *(atualização)*
**Critério de Aceite Técnico**: `POST /auth/login` com credenciais corretas retorna HTTP 200 com `accessToken` e `refreshToken` decodificáveis; payload do JWT contém `userId` e `email`; credenciais inválidas retornam HTTP 401; registro em `user_refresh_tokens` é criado com `revoked = false`.
**Estimativa**: M — 2–4h
**Dependências**: TASK-02, TASK-03, TASK-04, TASK-05
**Paralelizável**: Não

---

### TASK-08 — Endpoint `POST /auth/refresh`
**Descrição**: Implementar handler `src/auth/handlers/refresh.ts` e rota `POST /auth/refresh`. O handler deve: (1) validar o corpo com `refreshSchema` (Zod); (2) calcular o hash SHA-256 do `refreshToken` recebido; (3) buscar o registro em `user_refresh_tokens` pelo hash — retornar HTTP 401 se não encontrado, expirado (`expires_at < now`) ou com `revoked = true`; (4) verificar a assinatura JWT do `refreshToken` via módulo JWT; (5) marcar o token atual como `revoked = true` (rotação de token); (6) emitir novo par `accessToken` / `refreshToken`; (7) persistir o novo `refreshToken` (hash) em `user_refresh_tokens`; (8) retornar HTTP 200 com `{ accessToken, refreshToken }`.
**Arquivos Afetados**:
- `src/auth/handlers/refresh.ts` *(novo)*
- `src/auth/router.ts` *(atualização)*
**Critério de Aceite Técnico**: `POST /auth/refresh` com `refreshToken` válido retorna HTTP 200 com novo par de tokens; o token anterior fica com `revoked = true` no banco; segunda chamada com o token original revogado retorna HTTP 401.
**Estimativa**: M — 2–4h
**Dependências**: TASK-03, TASK-05
**Paralelizável**: Não

---

### TASK-09 — Endpoint `POST /auth/logout`
**Descrição**: Implementar handler `src/auth/handlers/logout.ts` e rota `POST /auth/logout`. O handler deve: (1) validar o corpo com `refreshSchema` (Zod); (2) calcular o hash SHA-256 do `refreshToken` recebido; (3) localizar o registro em `user_refresh_tokens` pelo hash e marcá-lo como `revoked = true` via Drizzle; (4) retornar HTTP 204 (No Content) em caso de sucesso — retornar HTTP 204 também se o token não for encontrado (idempotência).
**Arquivos Afetados**:
- `src/auth/handlers/logout.ts` *(novo)*
- `src/auth/router.ts` *(atualização)*
**Critério de Aceite Técnico**: `POST /auth/logout` com `refreshToken` válido retorna HTTP 204 e o registro em `user_refresh_tokens` passa a ter `revoked = true`; chamada repetida com o mesmo token também retorna HTTP 204.
**Estimativa**: P — < 2h
**Dependências**: TASK-05
**Paralelizável**: Não

---

### TASK-10 — Middleware Express de autenticação JWT
**Descrição**: Implementar `src/auth/middleware/authenticate.ts` exportando uma função middleware Express. O middleware deve: (1) extrair o token do header `Authorization: Bearer <token>` — retornar HTTP 401 com `{ "error": "Unauthorized", "message": "Token não fornecido" }` se ausente ou mal formatado; (2) chamar `verifyToken` do módulo JWT — capturar `TokenExpiredError` e retornar HTTP 401 com `{ "error": "Unauthorized", "message": "Token expirado" }`, capturar `JsonWebTokenError` e retornar HTTP 401 com `{ "error": "Unauthorized", "message": "Token inválido" }`; (3) injetar o payload decodificado em `req.user` para uso posterior — estender a tipagem de `Request` via declaration merging em `src/types/express.d.ts`.
**Arquivos Afetados**:
- `src/auth/middleware/authenticate.ts` *(novo)*
- `src/types/express.d.ts` *(novo — declaration merging para `req.user`)*
**Critério de Aceite Técnico**: Requisição sem header `Authorization` retorna HTTP 401 com `message: "Token não fornecido"`; token expirado retorna HTTP 401 com `message: "Token expirado"`; token válido chama `next()` e `req.user` contém `{ userId, email }`; a rota seguinte não é chamada em caso de erro.
**Estimativa**: M — 2–4h
**Dependências**: TASK-03
**Paralelizável**: Não

---

### TASK-11 — Registro do router `/auth` e aplicação do middleware nas rotas protegidas
**Descrição**: Atualizar `src/index.ts` para: (1) montar o router de autenticação em `app.use('/auth', authRouter)`; (2) aplicar o middleware `authenticate` nas rotas que exigem autenticação — de acordo com o PRD, avaliar `POST /webhooks/jira` (proteger com middleware) e manter `GET /health` pública; (3) garantir que o middleware seja registrado ANTES dos handlers das rotas protegidas. Injetar a instância `dbPool` (ou cliente Drizzle) nos handlers de autenticação via closure ou injeção simples para evitar singleton global.
**Arquivos Afetados**:
- `src/index.ts` *(atualização)*
- `src/auth/router.ts` *(finalização — aceitar `db` como parâmetro na factory)*
**Critério de Aceite Técnico**: `GET /health` sem token retorna HTTP 200; `POST /webhooks/jira` sem token retorna HTTP 401; todos os quatro endpoints `/auth/*` respondem conforme seus critérios individuais; `npm run typecheck` e `npm run lint` passam sem erros.
**Estimativa**: P — < 2h
**Dependências**: TASK-06, TASK-07, TASK-08, TASK-09, TASK-10
**Paralelizável**: Não

---

### TASK-12 — Logging estruturado Pino em todos os endpoints de autenticação
**Descrição**: Adicionar logging Pino a cada handler de autenticação (`register`, `login`, `refresh`, `logout`) e ao middleware `authenticate`. Cada log deve registrar ao final da requisição (sucesso ou erro): `action` (ex: `"auth.register"`), `ip` (de `req.ip`), `statusCode`, `durationMs` (calculado com `Date.now()` no início do handler) e `userId` quando disponível. É estritamente proibido logar `password`, `password_hash`, o token JWT completo ou o `refreshToken` completo — apenas os primeiros 8 caracteres do token podem ser logados para correlação de debug, com sufixo `…`.
**Arquivos Afetados**:
- `src/auth/handlers/register.ts` *(atualização)*
- `src/auth/handlers/login.ts` *(atualização)*
- `src/auth/handlers/refresh.ts` *(atualização)*
- `src/auth/handlers/logout.ts` *(atualização)*
- `src/auth/middleware/authenticate.ts` *(atualização)*
**Critério de Aceite Técnico**: Para cada chamada a qualquer endpoint `/auth/*`, exatamente um log Pino é emitido contendo os campos `action`, `ip`, `statusCode` e `durationMs`; `npm run test | grep password` não retorna nenhuma ocorrência nos logs de teste; campo `userId` está presente nos logs de `login` e `refresh` bem-sucedidos.
**Estimativa**: P — < 2h
**Dependências**: TASK-11
**Paralelizável**: Não

---

### TASK-13 — Worker BullMQ de limpeza de refresh tokens expirados
**Descrição**: Implementar `src/auth/workers/token-cleanup.ts` com um worker BullMQ na fila `auth-token-cleanup` que executa `DELETE FROM user_refresh_tokens WHERE expires_at < NOW() OR revoked = true` via Drizzle ORM. Criar um job repetível (repeatable job) configurado para rodar a cada 24 horas, registrado na inicialização do servidor. Adicionar o worker ao ciclo de graceful shutdown em `src/index.ts`. Esta mitigação é citada explicitamente no risco R-03 do PRD.
**Arquivos Afetados**:
- `src/auth/workers/token-cleanup.ts` *(novo)*
- `src/index.ts` *(atualização — inicialização e shutdown do worker)*
**Critério de Aceite Técnico**: Worker registrado com nome de fila `auth-token-cleanup` (kebab-case, sem dois-pontos); ao processar o job, registros com `expires_at < NOW()` e `revoked = true` são removidos da tabela; worker incluído no `Promise.allSettled` do graceful shutdown; teste unitário com banco mock valida que a query DELETE é emitida.
**Estimativa**: M — 2–4h
**Dependências**: TASK-05
**Paralelizável**: Não

---

### TASK-14 — Testes de integração Vitest — fluxo de autenticação e middleware
**Descrição**: Implementar suite de testes de integração em `src/auth/__tests__/auth.integration.test.ts` usando Vitest e `supertest` (instalar como devDependency). Os testes devem cobrir todos os critérios de aceite do PRD (CA-01 a CA-07) em um banco de dados de teste isolado (usando `DATABASE_URL` de teste via variável de ambiente). Cenários obrigatórios: registro com e-mail duplicado (409), login com credenciais incorretas (401), acesso a rota protegida sem token (401), token expirado (401 — mockar `Date`), fluxo completo register → login → refresh → logout, e verificação de que `POST /webhooks/jira` sem token retorna 401.
**Arquivos Afetados**:
- `src/auth/__tests__/auth.integration.test.ts` *(novo)*
- `package.json` *(adicionar `supertest` e `@types/supertest` como devDependencies)*
**Critério de Aceite Técnico**: `npm test` passa com 100% das asserções dos testes de autenticação; cobertura de branches dos handlers de autenticação ≥ 80% segundo `npm run test:coverage`; nenhum teste depende de estado persistente de outro teste (isolamento garantido por limpeza de tabelas no `beforeEach`).
**Estimativa**: G — 4–8h
**Dependências**: TASK-11
**Paralelizável**: Não

---

### TASK-15 — Documentação de variáveis de ambiente e runbook de rotação de `JWT_SECRET`
**Descrição**: Atualizar `README.md` e `.env.example` para documentar as novas variáveis de ambiente requeridas: `JWT_SECRET` (string aleatória ≥ 32 caracteres, recomendado `openssl rand -hex 32`), `JWT_ACCESS_EXPIRES_IN` (default: `15m`) e `JWT_REFRESH_EXPIRES_IN` (default: `7d`). Criar `docs/runbook-jwt-rotation.md` documentando o procedimento de rotação de `JWT_SECRET` em produção (Render), incluindo: geração de novo segredo, atualização no painel do Render, impacto nos tokens ativos (invalidação) e janela de manutenção recomendada. Esta task mitiga diretamente o risco R-01 do PRD.
**Arquivos Afetados**:
- `README.md` *(atualização — seção "Variáveis de Ambiente")*
- `.env.example` *(atualização — novas variáveis JWT)*
- `docs/runbook-jwt-rotation.md` *(novo)*
**Critério de Aceite Técnico**: `.env.example` contém `JWT_SECRET`, `JWT_ACCESS_EXPIRES_IN` e `JWT_REFRESH_EXPIRES_IN` com comentários explicativos; `docs/runbook-jwt-rotation.md` descreve passo a passo a rotação sem expor valores reais; `README.md` lista as três variáveis na tabela de ambiente.
**Estimativa**: P — < 2h
**Dependências**: TASK-11
**Paralelizável**: Não

## Ordem de Execução

Ondas de execução paralela:

```
Onda 1 (paralelo): TASK-01, TASK-02, TASK-03, TASK-04
Onda 2 (sequencial): TASK-05
Onda 3 (paralelo): TASK-06, TASK-07, TASK-08, TASK-09, TASK-10, TASK-13
Onda 4 (sequencial): TASK-11
Onda 5 (paralelo): TASK-12, TASK-14, TASK-15
```

## Estimativa Total
- Tasks P (< 2h): 7 tasks — TASK-02, TASK-03, TASK-04, TASK-05, TASK-09, TASK-11, TASK-12, TASK-15

> ⚠️ Correção de contagem: Tasks P são TASK-02, TASK-03, TASK-04, TASK-05, TASK-09, TASK-11, TASK-12, TASK-15 = **8 tasks P**

- Tasks P (< 2h): 8 tasks — TASK-02, TASK-03, TASK-04, TASK-05, TASK-09, TASK-11, TASK-12, TASK-15
- Tasks M (2–4h): 6 tasks — TASK-01, TASK-06, TASK-07, TASK-08, TASK-10, TASK-13
- Tasks G (4–8h): 1 task — TASK-14
- **Estimativa total**: 22–48 horas

## Referências
- PRD: SCRUM-15/PRD.md
- Jira: SCRUM-15