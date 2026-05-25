# Plano de Execução — SCRUM-14: Implementar autenticação de usuários com JWT - Teste #2 - Fase 2 - Squad Agêntica

## Identificação
- **Jira Key**: SCRUM-14
- **Resumo**: Implementar autenticação de usuários com JWT — endpoint de login, geração/validação de token, middleware de proteção de rotas e refresh token
- **Versão**: 1.0
- **Autor**: Agente LT (IA)
- **Data**: 2026-05-25

## Stack Detectada
- **Runtime**: Node.js 22 / TypeScript 5
- **Framework**: Express 4.x (tipos @types/express 5)
- **Banco de Dados**: PostgreSQL (Supabase) via Drizzle ORM
- **Fila**: BullMQ + Redis (Upstash / ioredis)
- **Testes**: Vitest 3 + v8 coverage
- **Logs**: Pino (JSON estruturado)
- **Validação**: Zod 3

## Visão Geral

| ID | Descrição resumida | Estimativa | Dependências | Paralelo |
|----|--------------------|------------|--------------|---------|
| TASK-01 | Adicionar tabela `users` ao schema Drizzle e gerar migration | M | — | Sim |
| TASK-02 | Módulo utilitário de hash de senha (bcrypt/argon2) | P | — | Sim |
| TASK-03 | Módulo utilitário JWT (sign access token + sign refresh token + verify) | P | — | Sim |
| TASK-04 | Variáveis de ambiente JWT validadas via Zod (`JWT_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`) | P | — | Sim |
| TASK-05 | Repositório de usuários — helper `findUserByEmail` via Drizzle | P | TASK-01 | Não |
| TASK-06 | Endpoint `POST /auth/login` — validação de credenciais e emissão de tokens | M | TASK-02, TASK-03, TASK-04, TASK-05 | Não |
| TASK-07 | Middleware de autenticação JWT para rotas protegidas | M | TASK-03, TASK-04 | Não |
| TASK-08 | Endpoint `POST /auth/refresh` — renovação de access token via refresh token | M | TASK-03, TASK-04, TASK-05 | Não |
| TASK-09 | Logging de tentativas inválidas de autenticação com Pino (warn) | P | TASK-06, TASK-07 | Não |
| TASK-10 | Rate limiting no endpoint `/auth/login` (máx. 5 req/60s por IP) | M | TASK-06 | Não |
| TASK-11 | Testes unitários dos módulos utilitários (hash + JWT) | M | TASK-02, TASK-03 | Sim |
| TASK-12 | Testes de integração dos endpoints `/auth/login` e `/auth/refresh` + middleware | G | TASK-06, TASK-07, TASK-08 | Não |

## Tasks Detalhadas

### TASK-01 — Adicionar tabela `users` ao schema Drizzle e gerar migration
**Descrição**: Estender o arquivo `src/db/schema.ts` com a tabela `users`, contendo os campos: `id` (UUID PK), `email` (text único, not null), `password_hash` (text, not null), `roles` (text array, not null, default `['user']`), `created_at` e `updated_at` (timestamps). Após definir a tabela, executar `npm run db:generate` para gerar o arquivo de migration SQL no diretório `src/db/migrations/` e `npm run db:migrate` para aplicar. Exportar os tipos `User` e `NewUser` inferidos pelo Drizzle.
**Arquivos Afetados**:
- `src/db/schema.ts`
- `src/db/migrations/<timestamp>_add_users_table.sql` (gerado automaticamente)

**Critério de Aceite Técnico**: A tabela `users` existe no banco após `db:migrate`; `select * from users limit 1` executa sem erro; o tipo `User` exportado possui os campos `id`, `email`, `passwordHash`, `roles`, `createdAt` e `updatedAt` verificáveis via `tsc --noEmit`.
**Estimativa**: M — 2–4h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-02 — Módulo utilitário de hash de senha
**Descrição**: Criar o módulo `src/lib/password.ts` com duas funções exportadas: `hashPassword(plain: string): Promise<string>` e `verifyPassword(plain: string, hash: string): Promise<boolean>`. Usar a biblioteca `bcryptjs` (instalar como dependência de produção) com custo mínimo de 10 rounds. O módulo não deve importar nenhum módulo do banco de dados. Adicionar `@types/bcryptjs` como devDependency.
**Arquivos Afetados**:
- `src/lib/password.ts`
- `package.json`

**Critério de Aceite Técnico**: `hashPassword('secret')` retorna string iniciada com `$2b$10$`; `verifyPassword('secret', hash)` retorna `true`; `verifyPassword('wrong', hash)` retorna `false` — verificável nos testes unitários da TASK-11.
**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-03 — Módulo utilitário JWT (sign + verify)
**Descrição**: Criar o módulo `src/lib/jwt.ts` com as funções: `signAccessToken(payload: JwtPayload): string`, `signRefreshToken(userId: string): string` e `verifyToken(token: string): JwtPayload`. O tipo `JwtPayload` deve conter `user_id: string`, `email: string`, `roles: string[]`, `iat?: number` e `exp?: number`. Usar a biblioteca `jsonwebtoken` (instalar como dependência de produção; adicionar `@types/jsonwebtoken` como devDependency). Algoritmo HS256. As configurações de segredo e expiração devem ser lidas do módulo de env (TASK-04), mas como TASK-04 será independente e carregada antes, declarar a dependência no nível de runtime (import), não de compilação — TASK-03 pode ser desenvolvida em paralelo usando valores placeholder para testes unitários.
**Arquivos Afetados**:
- `src/lib/jwt.ts`
- `package.json`

**Critério de Aceite Técnico**: `signAccessToken({ user_id: 'abc', email: 'x@y.com', roles: ['user'] })` retorna string com 3 segmentos separados por `.`; `verifyToken(token)` retorna o payload original; `verifyToken('token-invalido')` lança `JsonWebTokenError` — verificável nos testes da TASK-11.
**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-04 — Módulo de variáveis de ambiente JWT validadas com Zod
**Descrição**: Criar o módulo `src/lib/env.ts` que exporta um objeto `env` com todas as variáveis de ambiente da aplicação validadas pelo Zod no momento do boot. O schema Zod deve incluir: `JWT_SECRET` (string, min 32 chars), `JWT_ACCESS_EXPIRES_IN` (string, default `'15m'`), `JWT_REFRESH_EXPIRES_IN` (string, default `'7d'`), além das variáveis já existentes (`DATABASE_URL`, `REDIS_URL`, etc.). O módulo deve lançar erro descritivo em boot caso variáveis obrigatórias estejam ausentes. Atualizar `src/index.ts` para importar `env` deste módulo e remover usos diretos de `process.env` dispersos. Adicionar as novas variáveis ao `.env.example`.
**Arquivos Afetados**:
- `src/lib/env.ts` (novo)
- `.env.example`
- `src/index.ts` (ajuste de imports)

**Critério de Aceite Técnico**: Iniciar o servidor sem `JWT_SECRET` lança `ZodError` com mensagem legível antes de abrir a porta; com `JWT_SECRET` de 32+ chars o boot ocorre normalmente; `tsc --noEmit` passa sem erros.
**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-05 — Repositório de usuários (`findUserByEmail`)
**Descrição**: Criar o módulo `src/db/users.ts` com a função `findUserByEmail(email: string, db: NodePgDatabase): Promise<User | undefined>` que executa um `select` via Drizzle ORM na tabela `users`, filtrando por e-mail (case-insensitive via `lower()`). Exportar também `createUser(data: NewUser, db: NodePgDatabase): Promise<User>` para uso em seeds/testes. O `db` deve ser injetado como parâmetro para permitir mock em testes.
**Arquivos Afetados**:
- `src/db/users.ts` (novo)

**Critério de Aceite Técnico**: `findUserByEmail('USER@empresa.com', db)` retorna o registro cujo e-mail é `user@empresa.com`; retorna `undefined` para e-mails inexistentes — verificável via teste de integração na TASK-12.
**Estimativa**: P — < 2h
**Dependências**: TASK-01
**Paralelizável**: Não

---

### TASK-06 — Endpoint `POST /auth/login`
**Descrição**: Criar o router `src/auth/router.ts` e registrá-lo no Express em `src/index.ts` sob o prefixo `/auth`. Implementar o handler `POST /auth/login` que: (1) valida o body com Zod (`email: z.string().email()`, `password: z.string().min(1)`) retornando 400 em caso de falha de validação; (2) busca o usuário via `findUserByEmail` — se não encontrado, retorna 401 com `{"error":"invalid_credentials"}`; (3) verifica a senha com `verifyPassword` — se inválida, retorna 401 com `{"error":"invalid_credentials"}`; (4) em caso de sucesso, chama `signAccessToken` e `signRefreshToken` e retorna HTTP 200 com `{"access_token": "...", "refresh_token": "...", "token_type": "Bearer", "expires_in": <segundos>}`. O handler deve receber o `db` pool via closure de fábrica para facilitar testes. Criar `src/auth/index.ts` como barrel.
**Arquivos Afetados**:
- `src/auth/router.ts` (novo)
- `src/auth/index.ts` (novo)
- `src/index.ts` (registro do router)

**Critério de Aceite Técnico**: `POST /auth/login` com credenciais válidas retorna HTTP 200 com JSON contendo `access_token` decodificável com o `JWT_SECRET` correto e payload com `user_id`, `email`, `roles`; credenciais inválidas retornam HTTP 401 com `{"error":"invalid_credentials"}` sem vazar qual campo está errado; body malformado retorna HTTP 400.
**Estimativa**: M — 2–4h
**Dependências**: TASK-02, TASK-03, TASK-04, TASK-05
**Paralelizável**: Não

---

### TASK-07 — Middleware de autenticação JWT para rotas protegidas
**Descrição**: Criar o middleware `src/auth/middleware.ts` com a função `requireAuth`: lê o header `Authorization`, extrai o Bearer token, chama `verifyToken` e em caso de sucesso injeta o payload em `req.user` (estender a tipagem do Express `Request` via `declaration merging` em `src/types/express.d.ts`). Se o header estiver ausente, retorna 401 com `{"error":"missing_token"}`; se o token for inválido ou expirado, retorna 401 com `{"error":"invalid_token"}`. Aplicar o middleware na rota de health check como demonstração de uso protegido (rota `GET /protected/ping` criada apenas para validação).
**Arquivos Afetados**:
- `src/auth/middleware.ts` (novo)
- `src/types/express.d.ts` (novo — declaration merging de `req.user`)
- `src/index.ts` (registro da rota de demonstração)

**Critério de Aceite Técnico**: `GET /protected/ping` sem header retorna 401 `{"error":"missing_token"}`; com `Authorization: Bearer <token-invalido>` retorna 401 `{"error":"invalid_token"}`; com token válido retorna 200; `tsc --noEmit` reconhece `req.user` como `JwtPayload` sem erros de tipo.
**Estimativa**: M — 2–4h
**Dependências**: TASK-03, TASK-04
**Paralelizável**: Não

---

### TASK-08 — Endpoint `POST /auth/refresh`
**Descrição**: Adicionar o handler `POST /auth/refresh` ao router de autenticação (`src/auth/router.ts`). O endpoint: (1) valida o body com Zod (`refresh_token: z.string().min(1)`); (2) chama `verifyToken` no refresh token recebido — se inválido/expirado, retorna 401 com `{"error":"invalid_refresh_token"}`; (3) busca o usuário pelo `user_id` extraído do payload do refresh token via nova função `findUserById` no `src/db/users.ts`; (4) se o usuário existir, emite um novo access token e retorna HTTP 200 com `{"access_token":"...", "token_type":"Bearer", "expires_in":<segundos>}`.
**Arquivos Afetados**:
- `src/auth/router.ts` (adição de handler)
- `src/db/users.ts` (adição de `findUserById`)

**Critério de Aceite Técnico**: `POST /auth/refresh` com refresh token válido retorna HTTP 200 com novo `access_token` decodificável com payload correto; token inválido ou expirado retorna HTTP 401 com `{"error":"invalid_refresh_token"}`; body malformado retorna HTTP 400.
**Estimativa**: M — 2–4h
**Dependências**: TASK-03, TASK-04, TASK-05
**Paralelizável**: Não

---

### TASK-09 — Logging de tentativas inválidas de autenticação com Pino
**Descrição**: Instrumentar os pontos de falha de autenticação com logs Pino no nível `warn`, usando child loggers (`logger.child({ module: 'auth' })`). Nos handlers de login: logar e-mail (não a senha), IP de origem (`req.ip`) e timestamp quando as credenciais forem inválidas. No middleware JWT: logar a rota acessada (`req.path`), IP e motivo de rejeição (token ausente vs. inválido), sem logar o token completo (apenas os primeiros 10 chars + `...`). Garantir que nenhum campo sensível (senha, token completo) seja incluído nos logs.
**Arquivos Afetados**:
- `src/auth/router.ts` (adição de chamadas ao logger)
- `src/auth/middleware.ts` (adição de chamadas ao logger)

**Critério de Aceite Técnico**: Ao fornecer credenciais inválidas no login, o stdout em formato JSON contém `{"level":"warn","module":"auth","email":"...","ip":"...","msg":"invalid credentials attempt"}`; nenhuma linha de log contém a senha ou o token JWT completo — verificável via inspeção de output de teste.
**Estimativa**: P — < 2h
**Dependências**: TASK-06, TASK-07
**Paralelizável**: Não

---

### TASK-10 — Rate limiting no endpoint `/auth/login`
**Descrição**: Instalar e configurar o pacote `express-rate-limit` (dependência de produção). Criar o middleware de rate limit `authRateLimiter` em `src/auth/middleware.ts` com janela de 60 segundos e máximo de 5 requisições por IP. Aplicar exclusivamente na rota `POST /auth/login`. Quando o limite for excedido, retornar HTTP 429 com body `{"error":"too_many_requests","retry_after":<segundos>}`. Documentar a variável de ambiente `AUTH_RATE_LIMIT_MAX` (opcional, default 5) no `.env.example` e no módulo `src/lib/env.ts` para configurabilidade futura.
**Arquivos Afetados**:
- `src/auth/middleware.ts` (adição de `authRateLimiter`)
- `src/auth/router.ts` (aplicação do middleware)
- `src/lib/env.ts` (variável `AUTH_RATE_LIMIT_MAX` opcional)
- `.env.example`
- `package.json`

**Critério de Aceite Técnico**: Após 5 requisições `POST /auth/login` do mesmo IP em menos de 60 segundos, a 6ª retorna HTTP 429 com `{"error":"too_many_requests"}`; as primeiras 5 requisições seguem o fluxo normal (200 ou 401 conforme credenciais).
**Estimativa**: M — 2–4h
**Dependências**: TASK-06
**Paralelizável**: Não

---

### TASK-11 — Testes unitários dos módulos utilitários (hash + JWT)
**Descrição**: Criar os arquivos de teste Vitest para os módulos puros, sem dependência de banco ou rede. Em `src/lib/password.test.ts`: testar `hashPassword` (formato do hash), `verifyPassword` com senha correta (true) e incorreta (false), e garantir que `hashPassword` nunca retorna a string original. Em `src/lib/jwt.test.ts`: testar `signAccessToken` (formato do token, claims presentes), `verifyToken` com token válido (payload correto), `verifyToken` com token manipulado (lança erro) e `verifyToken` com token expirado (lança `TokenExpiredError`). Usar `vi.useFakeTimers()` para simular expiração de token. Cobertura de branches ≥ 90% nos dois módulos.
**Arquivos Afetados**:
- `src/lib/password.test.ts` (novo)
- `src/lib/jwt.test.ts` (novo)

**Critério de Aceite Técnico**: `npm test` executa todos os testes de `password.test.ts` e `jwt.test.ts` sem falhas; `npm run test:coverage` mostra cobertura de branches ≥ 90% nos dois arquivos; nenhum teste depende de conexão com banco ou rede.
**Estimativa**: M — 2–4h
**Dependências**: TASK-02, TASK-03
**Paralelizável**: Sim

---

### TASK-12 — Testes de integração dos endpoints de autenticação e middleware
**Descrição**: Criar `src/auth/auth.integration.test.ts` usando Vitest com supertest (instalar como devDependency). Configurar um banco de dados de teste (via `DATABASE_URL` de um schema isolado ou SQLite em modo compatível) e popular com um usuário seed usando `createUser` + `hashPassword`. Cobrir os cenários: (1) login com credenciais válidas → 200 com tokens decodificáveis; (2) login com senha errada → 401 `invalid_credentials`; (3) login com e-mail inexistente → 401 `invalid_credentials`; (4) login com body inválido → 400; (5) rota protegida sem token → 401; (6) rota protegida com token válido → 200; (7) rota protegida com token expirado → 401; (8) refresh com token válido → 200 com novo access token; (9) refresh com token inválido → 401.
**Arquivos Afetados**:
- `src/auth/auth.integration.test.ts` (novo)
- `package.json` (adição de `supertest` e `@types/supertest`)

**Critério de Aceite Técnico**: `npm test` executa todos os 9 cenários listados sem falhas; os testes são determinísticos (sem dependência de estado externo não controlado); o tempo total de execução dos testes de integração é inferior a 30 segundos.
**Estimativa**: G — 4–8h
**Dependências**: TASK-06, TASK-07, TASK-08
**Paralelizável**: Não

## Ordem de Execução

```
TASK-01 ──► TASK-05 ──────────────────────────────────────────────────┐
TASK-02 ──────────────────────────────────────────────────────────────┼──► TASK-06 ──► TASK-09 ──► (fim)
TASK-03 ──────────────────────────────────────────────────────────────┤         │
TASK-04 ──────────────────────────────────────────────────────────────┘         ├──► TASK-07 ──► TASK-09
                                                                                 │         │
             TASK-02 ──► TASK-11                                                 │         └──► TASK-12
             TASK-03 ──┘                                                         │
                                                                                 ├──► TASK-08 ──► TASK-12
                                                                                 └──► TASK-10
```

**Visualização por fases (colunas = paralelo possível):**

```
Fase 1 (paralelo)     Fase 2          Fase 3 (paralelo)     Fase 4          Fase 5
────────────────      ────────        ─────────────────      ────────        ────────
TASK-01               TASK-05         TASK-06                TASK-09         TASK-12
TASK-02                               TASK-07                TASK-10
TASK-03                               TASK-08
TASK-04                               TASK-11
```

## Estimativa Total
- Tasks P (< 2h): 5 tasks (TASK-02, TASK-03, TASK-04, TASK-05, TASK-09)
- Tasks M (2–4h): 6 tasks (TASK-01, TASK-06, TASK-07, TASK-08, TASK-10, TASK-11)
- Tasks G (4–8h): 1 task (TASK-12)
- **Estimativa total**: 20–38 horas (execução sequencial) / **12–20 horas** (execução com paralelismo máximo entre Fase 1 e tarefas independentes)

## Referências
- PRD: SCRUM-14/PRD.md
- Jira: SCRUM-14