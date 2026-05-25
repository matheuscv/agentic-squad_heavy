Tenho todas as informações necessárias. O README não foi encontrado, mas o schema e o PRD fornecem contexto rico o suficiente. O schema revela uma stack com **PostgreSQL + Drizzle ORM + TypeScript**, e o PRD detalha todos os requisitos. Gerando o plano agora:

---

```markdown
# Plano de Execução — SCRUM-14: Implementar autenticação de usuários com JWT

## Identificação
- **Jira Key**: SCRUM-14
- **Resumo**: Implementar autenticação de usuários com JWT - Teste #2 - Fase 2 - Squad Agêntica
- **Versão**: 1.0
- **Autor**: Agente LT (IA)
- **Data**: 2025-07-08

## Stack Detectada
- **Runtime**: Node.js / TypeScript
- **Framework**: Não detectado via README (inferido: Express ou similar, com base na estrutura do projeto)
- **Banco de Dados**: PostgreSQL via Drizzle ORM (`drizzle-orm/pg-core`)
- **Autenticação**: JWT (jsonwebtoken / jose) + bcrypt ou argon2 para hash de senhas
- **Testes**: Não detectado via README (inferido: Vitest, padrão comum na stack TS do projeto)

## Visão Geral

| ID | Descrição resumida | Estimativa | Dependências | Paralelo |
|----|--------------------|------------|--------------|----------|
| TASK-01 | Criar tabela `users` no schema Drizzle e gerar migration | M | — | Sim |
| TASK-02 | Configurar variáveis de ambiente JWT e utilitário de geração/validação de token | P | — | Sim |
| TASK-03 | Implementar serviço de hash e verificação de senha (bcrypt) | P | TASK-01 | Não |
| TASK-04 | Implementar endpoint `POST /auth/login` | G | TASK-01, TASK-02, TASK-03 | Não |
| TASK-05 | Implementar middleware de autenticação JWT para rotas protegidas | M | TASK-02 | Não |
| TASK-06 | Implementar endpoint `POST /auth/refresh` com refresh token | G | TASK-01, TASK-02 | Não |
| TASK-07 | Adicionar logging de tentativas inválidas (warn) no middleware e no login | P | TASK-04, TASK-05 | Não |
| TASK-08 | Escrever testes unitários e de integração para login, refresh e middleware | G | TASK-04, TASK-05, TASK-06 | Não |

## Tasks Detalhadas

---

### TASK-01 — Criar tabela `users` no schema Drizzle e gerar migration

**Descrição**: Adicionar a definição da tabela `users` no arquivo `src/db/schema.ts` usando `pgTable` do Drizzle ORM, com os campos: `id` (uuid, PK), `email` (text, unique, not null), `passwordHash` (text, not null), `roles` (text array ou jsonb, not null, default `['user']`), `createdAt` e `updatedAt` (timestamp). Após adicionar a definição, executar o comando de geração de migration (ex: `drizzle-kit generate`) e aplicar com `drizzle-kit migrate` (ou equivalente configurado no projeto). Exportar os tipos inferidos `User` e `NewUser`.

**Arquivos Afetados**:
- `src/db/schema.ts`
- `src/db/migrations/` *(novo arquivo de migration gerado)*

**Critério de Aceite Técnico**:
- A tabela `users` existe no banco de dados após rodar a migration.
- A constraint `UNIQUE` em `email` é aplicada: tentar inserir dois registros com o mesmo e-mail resulta em erro de banco.
- Os tipos `User` e `NewUser` estão exportados e utilizáveis por outros módulos sem erros de compilação TypeScript.

**Estimativa**: M — 2–4h
**Dependências**: Nenhuma
**Paralelizável**: Sim (pode rodar em paralelo com TASK-02)

---

### TASK-02 — Configurar variáveis de ambiente JWT e utilitário de geração/validação de token

**Descrição**: Criar o módulo utilitário `src/auth/jwt.ts` responsável por:
1. Ler as variáveis de ambiente `JWT_SECRET`, `JWT_ACCESS_EXPIRES_IN` (padrão: `"15m"`) e `JWT_REFRESH_EXPIRES_IN` (padrão: `"7d"`) — lançar erro fatal (`throw new Error`) na inicialização se `JWT_SECRET` não estiver definido.
2. Exportar a função `signAccessToken(payload: { userId: string; email: string; roles: string[] }): string` que gera um JWT assinado com HS256 contendo os campos `user_id`, `email`, `roles`, `iat` e `exp`.
3. Exportar a função `signRefreshToken(payload: { userId: string }): string` que gera um JWT de refresh.
4. Exportar a função `verifyToken(token: string): JwtPayload` que valida e decodifica o token, lançando erros tipados (`TokenExpiredError`, `JsonWebTokenError`) em caso de falha.
Adicionar `JWT_SECRET`, `JWT_ACCESS_EXPIRES_IN` e `JWT_REFRESH_EXPIRES_IN` ao `.env.example`.

**Arquivos Afetados**:
- `src/auth/jwt.ts` *(novo)*
- `.env.example`

**Critério de Aceite Técnico**:
- `signAccessToken({ userId: 'uuid-test', email: 'a@b.com', roles: ['user'] })` retorna uma string com 3 segmentos separados por `.` (formato JWT).
- `verifyToken(token)` decodifica o token gerado acima e retorna um objeto com `user_id`, `email` e `roles` corretos.
- `verifyToken('token.invalido')` lança `JsonWebTokenError`.
- A aplicação lança erro na inicialização se `JWT_SECRET` for `undefined`.

**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim (pode rodar em paralelo com TASK-01)

---

### TASK-03 — Implementar serviço de hash e verificação de senha (bcrypt)

**Descrição**: Criar o módulo `src/auth/password.ts` com duas funções exportadas:
1. `hashPassword(plain: string): Promise<string>` — utiliza `bcrypt.hash` com custo (`saltRounds`) mínimo de **10**, configurável via variável de ambiente `BCRYPT_SALT_ROUNDS` (padrão: `10`).
2. `verifyPassword(plain: string, hash: string): Promise<boolean>` — utiliza `bcrypt.compare` e retorna `true` se corresponder, `false` caso contrário.
Nunca logar a senha em texto plano em nenhum ponto do módulo. Adicionar `bcryptjs` (ou `bcrypt` com types) como dependência de produção.

**Arquivos Afetados**:
- `src/auth/password.ts` *(novo)*
- `package.json` *(dependência bcryptjs)*

**Critério de Aceite Técnico**:
- `hashPassword('senha123')` retorna uma string começando com `$2b$` (prefixo bcrypt), de tamanho ≥ 60 caracteres.
- `verifyPassword('senha123', hash)` retorna `true` para o hash gerado acima.
- `verifyPassword('senhaErrada', hash)` retorna `false`.
- O fator de custo (`saltRounds`) pode ser sobrescrito via `BCRYPT_SALT_ROUNDS=12` sem alterar o código.

**Estimativa**: P — < 2h
**Dependências**: TASK-01 (depende do schema de usuário estar definido para uso coerente)
**Paralelizável**: Não

---

### TASK-04 — Implementar endpoint `POST /auth/login`

**Descrição**: Criar o controller/handler `src/auth/login.handler.ts` e registrá-lo na rota `POST /auth/login`. O fluxo deve ser:
1. Validar o corpo da requisição: `email` (string, formato e-mail) e `password` (string, não vazio) — retornar HTTP 400 com `{"error": "validation_error", "details": [...]}` se inválido (usar `zod` para validação de schema).
2. Buscar o usuário no banco via Drizzle ORM pelo `email` fornecido.
3. Se o usuário não existir **ou** a senha não corresponder ao hash: retornar HTTP 401 com `{"error": "invalid_credentials"}` **sem diferenciar** qual campo está errado (timing-safe: chamar `verifyPassword` mesmo quando o usuário não existir, usando um hash dummy para evitar timing attacks).
4. Se as credenciais forem válidas: gerar `accessToken` com `signAccessToken` e `refreshToken` com `signRefreshToken`, retornar HTTP 200 com `{ "access_token": "...", "token_type": "Bearer", "expires_in": 900, "refresh_token": "..." }`.
5. O `refresh_token` deve ser persistido (hash do token) na tabela `users` ou em uma tabela auxiliar `refresh_tokens` (campo `refreshTokenHash` + `refreshTokenExpiresAt`), para validação posterior em TASK-06.

**Arquivos Afetados**:
- `src/auth/login.handler.ts` *(novo)*
- `src/auth/auth.router.ts` *(novo ou existente)*
- `src/db/schema.ts` *(adicionar campos `refreshTokenHash` e `refreshTokenExpiresAt` em `users`, se optado por essa abordagem)*
- `src/app.ts` ou `src/server.ts` *(registrar o router de auth)*

**Critério de Aceite Técnico**:
- `POST /auth/login` com `{"email":"user@test.com","password":"correta"}` retorna HTTP 200 com JSON contendo `access_token` (JWT decodificável com `user_id`, `email`, `roles`) e `refresh_token`.
- `POST /auth/login` com senha errada retorna HTTP 401 com `{"error":"invalid_credentials"}`.
- `POST /auth/login` com e-mail inexistente retorna HTTP 401 com `{"error":"invalid_credentials"}` (sem vazar existência do usuário).
- `POST /auth/login` sem o campo `email` retorna HTTP 400 com `{"error":"validation_error"}`.
- O tempo de resposta para credenciais inválidas (usuário inexistente) é equivalente ao de credenciais erradas (bcrypt roda em ambos os casos).

**Estimativa**: G — 4–8h
**Dependências**: TASK-01, TASK-02, TASK-03
**Paralelizável**: Não

---

### TASK-05 — Implementar middleware de autenticação JWT para rotas protegidas

**Descrição**: Criar o middleware `src/auth/auth.middleware.ts` que intercepta requisições em rotas protegidas. O middleware deve:
1. Extrair o token do header `Authorization: Bearer <token>`. Se ausente ou mal formatado, retornar HTTP 401 com `{"error": "unauthorized", "message": "Missing or invalid Authorization header"}`.
2. Chamar `verifyToken(token)` do módulo JWT.
3. Se `TokenExpiredError`: retornar HTTP 401 com `{"error": "token_expired"}`.
4. Se `JsonWebTokenError` (malformado/assinatura inválida): retornar HTTP 401 com `{"error": "invalid_token"}`.
5. Se válido: anexar o payload decodificado ao objeto de request (ex: `req.user = { userId, email, roles }`) e chamar `next()`.
Exportar também o tipo `AuthenticatedRequest` estendendo o tipo de request base com o campo `user`.

**Arquivos Afetados**:
- `src/auth/auth.middleware.ts` *(novo)*
- `src/types/express.d.ts` ou equivalente *(extensão do tipo Request)*

**Critério de Aceite Técnico**:
- Uma rota protegida com o middleware retorna HTTP 401 quando chamada sem o header `Authorization`.
- A mesma rota retorna HTTP 401 com `{"error":"token_expired"}` quando chamada com um JWT expirado.
- A mesma rota retorna HTTP 200 e processa normalmente quando chamada com um JWT válido, e `req.user.userId` está acessível dentro do handler.
- Um token assinado com secret diferente do configurado retorna HTTP 401 com `{"error":"invalid_token"}`.

**Estimativa**: M — 2–4h
**Dependências**: TASK-02
**Paralelizável**: Não

---

### TASK-06 — Implementar endpoint `POST /auth/refresh`

**Descrição**: Criar o handler `src/auth/refresh.handler.ts` e registrá-lo na rota `POST /auth/refresh`. O fluxo deve ser:
1. Receber `{ "refresh_token": "..." }` no corpo da requisição (validar com zod).
2. Verificar a assinatura e expiração do refresh token com `verifyToken`.
3. Buscar no banco o usuário correspondente ao `userId` do payload e validar se o hash do refresh token recebido corresponde ao armazenado (evitar reutilização após rotação).
4. Se válido: gerar novo `accessToken`, fazer rotação do `refreshToken` (gerar novo, salvar novo hash, invalidar o anterior), retornar HTTP 200 com `{ "access_token": "...", "token_type": "Bearer", "expires_in": 900, "refresh_token": "..." }`.
5. Se inválido ou expirado: retornar HTTP 401 com `{"error": "invalid_refresh_token"}`.

**Arquivos Afetados**:
- `src/auth/refresh.handler.ts` *(novo)*
- `src/auth/auth.router.ts` *(registrar nova rota)*

**Critério de Aceite Técnico**:
- `POST /auth/refresh` com refresh token válido (obtido no login) retorna HTTP 200 com novo `access_token` JWT válido e `expires_in: 900`.
- `POST /auth/refresh` com o mesmo refresh token usado anteriormente (após rotação) retorna HTTP 401 com `{"error":"invalid_refresh_token"}`.
- `POST /auth/refresh` com string arbitrária retorna HTTP 401.
- O novo `access_token` contém `user_id`, `email` e `roles` corretos do usuário.

**Estimativa**: G — 4–8h
**Dependências**: TASK-01, TASK-02
**Paralelizável**: Não (inicia após TASK-04 estar minimamente estruturada para reaproveitamento do router)

---

### TASK-07 — Adicionar logging de tentativas inválidas (warn) no middleware e no login

**Descrição**: Integrar logging estruturado (nível `warn`) nos pontos de falha de autenticação, usando o logger já existente no projeto (ou `pino` / `winston` se ainda não houver). Os eventos a logar são:
1. No middleware (`auth.middleware.ts`): token ausente, token expirado ou token inválido — log com campos: `timestamp`, `level: "warn"`, `event: "auth_failure"`, `reason: "missing_token" | "token_expired" | "invalid_token"`, `route`, `ip`.
2. No handler de login (`login.handler.ts`): credenciais inválidas — log com campos: `timestamp`, `level: "warn"`, `event: "login_failure"`, `ip`, `email` (apenas domínio, ex: `***@empresa.com` — não logar e-mail completo).
**Restrição**: Nunca logar o token JWT completo, a senha, nem o e-mail completo.

**Arquivos Afetados**:
- `src/auth/auth.middleware.ts`
- `src/auth/login.handler.ts`
- `src/lib/logger.ts` *(se precisar criar ou adaptar)*

**Critério de Aceite Técnico**:
- Ao chamar uma rota protegida com token expirado, a saída de logs contém uma entrada com `level: "warn"`, `event: "auth_failure"` e `reason: "token_expired"`.
- Ao chamar `POST /auth/login` com senha errada, os logs contêm `event: "login_failure"` e o campo `email` está mascarado (não exibe a parte local do e-mail).
- Nenhum log contém o token JWT completo (verificar via grep/test de snapshot).

**Estimativa**: P — < 2h
**Dependências**: TASK-04, TASK-05
**Paralelizável**: Não

---

### TASK-08 — Escrever testes unitários e de integração para login, refresh e middleware

**Descrição**: Criar suíte de testes cobrindo os fluxos críticos de autenticação:

**Testes unitários** (`src/auth/__tests__/`):
- `jwt.spec.ts`: testar `signAccessToken`, `signRefreshToken` e `verifyToken` com token válido, expirado e malformado.
- `password.spec.ts`: testar `hashPassword` e `verifyPassword` com match e mismatch.

**Testes de integração** (`src/auth/__tests__/`):
- `login.integration.spec.ts`: montar a aplicação com banco de teste (in-memory ou test DB), criar usuário de seed, testar HTTP 200 (credenciais corretas), HTTP 401 (senha errada), HTTP 401 (e-mail inexistente), HTTP 400 (body inválido).
- `refresh.integration.spec.ts`: testar HTTP 200 com refresh token válido, HTTP 401 com token reutilizado (após rotação), HTTP 401 com token arbitrário.
- `middleware.integration.spec.ts`: testar rota protegida com token válido (200), sem token (401), com token expirado (401), com token de secret diferente (401).

**Arquivos Afetados**:
- `src/auth/__tests__/jwt.spec.ts` *(novo)*
- `src/auth/__tests__/password.spec.ts` *(novo)*
- `src/auth/__tests__/login.integration.spec.ts` *(novo)*
- `src/auth/__tests__/refresh.integration.spec.ts` *(novo)*
- `src/auth/__tests__/middleware.integration.spec.ts` *(novo)*

**Critério de Aceite Técnico**:
- Todos os testes passam com `npm test` (ou `npx vitest run`) sem erros.
- Cobertura de linhas ≥ 80% nos arquivos `src/auth/*.ts`.
- Nenhum teste depende de estado externo não controlado (sem chamadas reais a APIs de terceiros).

**Estimativa**: G — 4–8h
**Dependências**: TASK-04, TASK-05, TASK-06
**Paralelizável**: Não

---

## Ordem de Execução

```
TASK-01 ──► TASK-03 ──►
                        \
TASK-02 ────────────────►  TASK-04 ──► TASK-07 ──► TASK-08
                        /             /
                  TASK-05 ───────────
                        \
TASK-01 ──► ─────────►  TASK-06 ──► TASK-08
TASK-02 ──►
```

**Visualização simplificada por fases:**

```
Fase 1 (paralelo)     Fase 2          Fase 3         Fase 4 (paralelo)   Fase 5
┌──────────┐         ┌──────────┐    ┌──────────┐   ┌──────────┐
│ TASK-01  │──────►  │ TASK-03  │──► │          │   │ TASK-06  │──►
└──────────┘         └──────────┘    │ TASK-04  │   └──────────┘        ┌──────────┐
                                     │          │──► TASK-07 ──────────► │ TASK-08  │
┌──────────┐                         │          │   ┌──────────┐         └──────────┘
│ TASK-02  │─────────────────────►   │          │   │ TASK-05  │──►
└──────────┘                         └──────────┘   └──────────┘
```

---

## Estimativa Total
- **Tasks P (< 2h)**: 3 tasks — TASK-02, TASK-03, TASK-07
- **Tasks M (2–4h)**: 2 tasks — TASK-01, TASK-05
- **Tasks G (4–8h)**: 3 tasks — TASK-04, TASK-06, TASK-08
- **Estimativa total**: 22–44 horas (mín. de esforço paralelo ~16h com 2 devs)

---

## Referências
- PRD: `SCRUM-14/PRD.md` (branch `prd/scrum-14`)
- Jira: SCRUM-14
- Schema atual: `src/db/schema.ts`
```