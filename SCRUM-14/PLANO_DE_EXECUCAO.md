# Plano de Execução — SCRUM-14: Implementar autenticação de usuários com JWT - Teste #2 - Fase 2 - Squad Agêntica

## Identificação
- **Jira Key**: SCRUM-14
- **Resumo**: Implementar autenticação de usuários com JWT - Teste #2 - Fase 2 - Squad Agêntica
- **Versão**: 1.0
- **Autor**: Agente LT (IA)
- **Data**: 2026-05-25

## Stack Detectada
- **Runtime**: Node.js 22 / TypeScript 5
- **Framework**: Express 4 (declarado como `^4.21.2`)
- **Banco de Dados**: PostgreSQL (Supabase) via Drizzle ORM
- **Fila**: BullMQ + Redis (Upstash / IORedis)
- **Testes**: Vitest + v8 coverage
- **Logs**: Pino (JSON estruturado)
- **Validação**: Zod

## Visão Geral

| ID | Descrição resumida | Estimativa | Dependências | Paralelo |
|----|--------------------|------------|--------------|---------|
| TASK-01 | Adicionar tabela `users` ao schema Drizzle e gerar migration | M | — | Sim |
| TASK-02 | Módulo utilitário de hash de senha (bcrypt/argon2) | P | — | Sim |
| TASK-03 | Módulo utilitário de geração e validação de JWT | P | — | Sim |
| TASK-04 | Configuração e validação de variáveis de ambiente de auth via Zod | P | — | Sim |
| TASK-05 | Endpoint `POST /auth/login` — validação de credenciais e emissão de tokens | M | TASK-01, TASK-02, TASK-03, TASK-04 | Não |
| TASK-06 | Endpoint `POST /auth/refresh` — renovação de access token via refresh token | M | TASK-01, TASK-03, TASK-04 | Não |
| TASK-07 | Middleware `authenticate` para proteção de rotas com JWT | M | TASK-03, TASK-04 | Não |
| TASK-08 | Rate limiting no endpoint de login | P | TASK-05 | Não |
| TASK-09 | Logging de tentativas com token inválido/expirado via Pino | P | TASK-07 | Não |
| TASK-10 | Testes unitários dos módulos utilitários (hash e JWT) | M | TASK-02, TASK-03 | Sim |
| TASK-11 | Testes de integração dos endpoints `/auth/login` e `/auth/refresh` e do middleware | G | TASK-05, TASK-06, TASK-07, TASK-08, TASK-09 | Não |

## Tasks Detalhadas

### TASK-01 — Adicionar tabela `users` ao schema Drizzle e gerar migration
**Descrição**: Adicionar a tabela `users` ao arquivo `src/db/schema.ts` usando Drizzle ORM, com os campos `id` (UUID PK), `email` (text, unique, not null), `password_hash` (text, not null), `roles` (text[], not null, default `['user']`), `created_at` e `updated_at`. Em seguida, executar `npm run db:generate` para gerar o arquivo de migration SQL correspondente em `src/db/migrations/`. Exportar os tipos inferidos `User` e `NewUser`.
**Arquivos Afetados**:
- `src/db/schema.ts`
- `src/db/migrations/<timestamp>_add_users_table.sql` (gerado automaticamente)
**Critério de Aceite Técnico**: `src/db/schema.ts` exporta a tabela `users` com todos os campos especificados; o arquivo de migration é gerado sem erros e, ao executar `npm run db:migrate`, a tabela `users` é criada no banco com a constraint `UNIQUE` em `email`.
**Estimativa**: M — 2–4h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-02 — Módulo utilitário de hash de senha (argon2id)
**Descrição**: Criar o módulo `src/lib/password.ts` com as funções exportadas `hashPassword(plain: string): Promise<string>` e `verifyPassword(plain: string, hash: string): Promise<boolean>`. Utilizar a biblioteca `argon2` (instalar como dependência de produção) com algoritmo `argon2id` e configurações seguras de custo. A função `hashPassword` nunca deve logar o valor de entrada. Caso `argon2` não seja aprovado pelo time, usar `bcryptjs` com custo mínimo 10 como alternativa.
**Arquivos Afetados**:
- `src/lib/password.ts`
- `package.json` (nova dependência: `argon2`)
**Critério de Aceite Técnico**: `hashPassword('secret')` retorna uma string hash iniciada com `$argon2id`; `verifyPassword('secret', hash)` retorna `true` para o hash correto e `false` para senha incorreta; ambas as funções rejeitam com erro para entrada vazia.
**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-03 — Módulo utilitário de geração e validação de JWT
**Descrição**: Criar o módulo `src/lib/jwt.ts` com as funções exportadas `signAccessToken(payload: JwtPayload): string`, `signRefreshToken(userId: string): string` e `verifyToken(token: string, secret: string): JwtPayload`. Utilizar a biblioteca `jsonwebtoken` (instalar como dependência de produção). Definir e exportar a interface `JwtPayload` contendo `user_id`, `email`, `roles`, `iat` e `exp`. O secret e os tempos de expiração devem ser recebidos via parâmetro ou injetados a partir da configuração de ambiente (TASK-04), sem hardcode.
**Arquivos Afetados**:
- `src/lib/jwt.ts`
- `package.json` (nova dependência: `jsonwebtoken`; devDependency: `@types/jsonwebtoken`)
**Critério de Aceite Técnico**: `signAccessToken({ user_id, email, roles })` retorna um JWT decodificável com os campos corretos no payload; `verifyToken` lança `JsonWebTokenError` para token malformado e `TokenExpiredError` para token expirado; `verifyToken` retorna o payload correto para token válido.
**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-04 — Configuração e validação de variáveis de ambiente de auth via Zod
**Descrição**: Criar o módulo `src/config/auth.ts` que lê e valida, via Zod, as variáveis de ambiente relacionadas à autenticação: `JWT_ACCESS_SECRET` (string, min 32 chars), `JWT_REFRESH_SECRET` (string, min 32 chars), `JWT_ACCESS_EXPIRES_IN` (string, default `'15m'`) e `JWT_REFRESH_EXPIRES_IN` (string, default `'7d'`). O módulo deve exportar o objeto `authConfig` com os valores tipados. A aplicação deve falhar em startup (`process.exit(1)`) caso alguma variável obrigatória esteja ausente. Atualizar `.env.example` com as novas variáveis documentadas.
**Arquivos Afetados**:
- `src/config/auth.ts`
- `.env.example`
**Critério de Aceite Técnico**: Se `JWT_ACCESS_SECRET` ou `JWT_REFRESH_SECRET` estiver ausente no ambiente, o processo encerra com código 1 e uma mensagem de erro clara no log Pino; se presentes e válidas, `authConfig` exporta todos os campos com os valores corretos.
**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-05 — Endpoint `POST /auth/login` — validação de credenciais e emissão de tokens
**Descrição**: Criar o router `src/auth/router.ts` e registrá-lo no Express em `src/index.ts` sob o prefixo `/auth`. Implementar o handler `POST /auth/login` que: (1) valida o body `{ email, password }` via Zod, retornando 400 para body inválido; (2) busca o usuário na tabela `users` pelo email usando Drizzle ORM; (3) verifica o hash da senha com a função de TASK-02; (4) em caso de credencial inválida (usuário não encontrado ou senha incorreta), retorna HTTP 401 com `{ "error": "invalid_credentials" }` sem revelar qual campo está errado; (5) em caso de sucesso, assina e retorna `{ access_token, refresh_token, expires_in }` com HTTP 200 usando as funções de TASK-03 e a configuração de TASK-04. Criar também `src/auth/login.ts` para a lógica de negócio isolada do handler HTTP.
**Arquivos Afetados**:
- `src/auth/router.ts`
- `src/auth/login.ts`
- `src/index.ts` (registrar `app.use('/auth', authRouter)`)
**Critério de Aceite Técnico**: `POST /auth/login` com credenciais válidas retorna HTTP 200 com JSON contendo `access_token` (decodificável, com `user_id`, `email`, `roles`, `exp`) e `refresh_token`; com credenciais inválidas retorna HTTP 401 com `{ "error": "invalid_credentials" }` independentemente de o email existir ou não; body malformado retorna HTTP 400.
**Estimativa**: M — 2–4h
**Dependências**: TASK-01, TASK-02, TASK-03, TASK-04
**Paralelizável**: Não

---

### TASK-06 — Endpoint `POST /auth/refresh` — renovação de access token via refresh token
**Descrição**: Adicionar o handler `POST /auth/refresh` no router `src/auth/router.ts`. O endpoint deve: (1) validar o body `{ refresh_token }` via Zod; (2) verificar o refresh token usando `verifyToken` com `JWT_REFRESH_SECRET` (TASK-03); (3) buscar o usuário pelo `user_id` contido no payload para confirmar que ainda existe na base; (4) emitir e retornar um novo `access_token` com HTTP 200; (5) retornar HTTP 401 para token inválido ou expirado. Criar `src/auth/refresh.ts` para a lógica de negócio isolada.
**Arquivos Afetados**:
- `src/auth/refresh.ts`
- `src/auth/router.ts`
**Critério de Aceite Técnico**: `POST /auth/refresh` com refresh token válido retorna HTTP 200 com novo `access_token` e `expires_in`; refresh token expirado ou malformado retorna HTTP 401; body sem `refresh_token` retorna HTTP 400.
**Estimativa**: M — 2–4h
**Dependências**: TASK-01, TASK-03, TASK-04
**Paralelizável**: Não

---

### TASK-07 — Middleware `authenticate` para proteção de rotas com JWT
**Descrição**: Criar o middleware Express `src/auth/middleware.ts` exportando `authenticate`. O middleware deve: (1) extrair o token do header `Authorization: Bearer <token>`; (2) verificar o token com `verifyToken` usando `JWT_ACCESS_SECRET` (TASK-03/TASK-04); (3) em caso de ausência, malformação ou expiração do token, retornar HTTP 401 com `{ "error": "unauthorized" }`; (4) em caso de sucesso, anexar o payload decodificado em `req.user` (estender a interface `Request` do Express via declaration merging em `src/types/express.d.ts`) e chamar `next()`.
**Arquivos Afetados**:
- `src/auth/middleware.ts`
- `src/types/express.d.ts`
**Critério de Aceite Técnico**: Rota protegida com `authenticate` retorna HTTP 401 quando `Authorization` está ausente; retorna HTTP 401 quando token é expirado ou malformado; executa `next()` e popula `req.user` corretamente quando token é válido.
**Estimativa**: M — 2–4h
**Dependências**: TASK-03, TASK-04
**Paralelizável**: Não

---

### TASK-08 — Rate limiting no endpoint de login
**Descrição**: Instalar e configurar a biblioteca `express-rate-limit` (dependência de produção). Criar o middleware de rate limit em `src/auth/rate-limit.ts` com as regras: máximo de 5 tentativas por IP em uma janela de 60 segundos para a rota `POST /auth/login`. Retornar HTTP 429 com corpo `{ "error": "too_many_requests" }` ao exceder o limite. Aplicar o middleware exclusivamente sobre a rota `/auth/login` no router de auth.
**Arquivos Afetados**:
- `src/auth/rate-limit.ts`
- `src/auth/router.ts`
- `package.json` (nova dependência: `express-rate-limit`)
**Critério de Aceite Técnico**: Após 5 requisições para `POST /auth/login` a partir do mesmo IP em 60 segundos, a 6ª requisição retorna HTTP 429 com `{ "error": "too_many_requests" }`; a 1ª requisição após o reset da janela é processada normalmente.
**Estimativa**: P — < 2h
**Dependências**: TASK-05
**Paralelizável**: Não

---

### TASK-09 — Logging de tentativas com token inválido/expirado via Pino
**Descrição**: Adicionar, dentro do middleware `authenticate` em `src/auth/middleware.ts`, chamadas ao logger Pino (child logger com módulo `auth`) no nível `warn` sempre que uma requisição for rejeitada por token ausente, malformado ou expirado. O log deve incluir: `timestamp` (automático pelo Pino), `route` (valor de `req.path`), `ip` (valor de `req.ip`), `reason` (`'missing_token'`, `'invalid_token'` ou `'expired_token'`). O token completo NUNCA deve ser logado.
**Arquivos Afetados**:
- `src/auth/middleware.ts`
**Critério de Aceite Técnico**: Ao receber requisição com token expirado na rota `/protected`, o Pino emite uma linha JSON com `level: 'warn'`, `module: 'auth'`, `route: '/protected'`, campo `ip` preenchido e `reason: 'expired_token'`; nenhum campo do log contém o valor do token.
**Estimativa**: P — < 2h
**Dependências**: TASK-07
**Paralelizável**: Não

---

### TASK-10 — Testes unitários dos módulos utilitários (hash e JWT)
**Descrição**: Criar suítes de testes unitários com Vitest para os módulos de utilidade implementados nas TASK-02 e TASK-03. Para `src/lib/password.ts`: testar `hashPassword` (retorna hash não legível, hash diferente para mesma entrada), `verifyPassword` (true para senha correta, false para incorreta, false para hash adulterado). Para `src/lib/jwt.ts`: testar `signAccessToken` (payload correto no JWT decodificado), `signRefreshToken` (contém `user_id`), `verifyToken` (sucesso, lança para token malformado, lança para token expirado). Usar mocks de tempo do Vitest para simular expiração.
**Arquivos Afetados**:
- `src/lib/password.test.ts`
- `src/lib/jwt.test.ts`
**Critério de Aceite Técnico**: `npm test` executa todos os testes sem falhas; cobertura de linha dos módulos `password.ts` e `jwt.ts` ≥ 90% conforme relatório de `npm run test:coverage`.
**Estimativa**: M — 2–4h
**Dependências**: TASK-02, TASK-03
**Paralelizável**: Sim

---

### TASK-11 — Testes de integração dos endpoints e middleware de auth
**Descrição**: Criar testes de integração em `src/auth/auth.integration.test.ts` usando Vitest e o módulo nativo `supertest` (instalar como devDependency). Os testes devem cobrir: (CA-01) login com credenciais válidas → HTTP 200 com `access_token` e `refresh_token`; (CA-02) login com credenciais inválidas → HTTP 401 com `{ "error": "invalid_credentials" }`; (CA-03) acesso a rota protegida sem token → HTTP 401; (CA-04) acesso a rota protegida com token válido → HTTP 200; (CA-05) refresh com refresh token válido → HTTP 200 com novo `access_token`; rate limit → 6ª tentativa de login retorna HTTP 429. Usar banco de dados em memória ou seed de fixture para o usuário de teste.
**Arquivos Afetados**:
- `src/auth/auth.integration.test.ts`
- `package.json` (devDependency: `supertest`, `@types/supertest`)
**Critério de Aceite Técnico**: `npm test` executa todos os cenários de integração sem falhas; todos os 6 cenários descritos acima possuem ao menos um caso de teste verde; nenhum teste depende de estado externo não controlado.
**Estimativa**: G — 4–8h
**Dependências**: TASK-05, TASK-06, TASK-07, TASK-08, TASK-09
**Paralelizável**: Não

---

## Ordem de Execução

Ondas de execução paralela:

```
Onda 1 (paralelo): TASK-01, TASK-02, TASK-03, TASK-04
Onda 2 (paralelo): TASK-05, TASK-06, TASK-07, TASK-10
Onda 3 (paralelo): TASK-08, TASK-09
Onda 4 (sequencial): TASK-11
```

## Estimativa Total
- Tasks P (< 2h): 4 tasks — TASK-02, TASK-03, TASK-04, TASK-08, TASK-09
- Tasks M (2–4h): 5 tasks — TASK-01, TASK-05, TASK-06, TASK-07, TASK-10
- Tasks G (4–8h): 1 task — TASK-11

> **Contagem verificada**: TASK-02, TASK-03, TASK-04, TASK-08, TASK-09 = **5 tasks P**; TASK-01, TASK-05, TASK-06, TASK-07, TASK-10 = **5 tasks M**; TASK-11 = **1 task G**. Total: 11 tasks.

- Tasks P (< 2h): 5 tasks
- Tasks M (2–4h): 5 tasks
- Tasks G (4–8h): 1 task
- **Estimativa total**: 18–40 horas

## Referências
- PRD: SCRUM-14/PRD.md
- Jira: SCRUM-14