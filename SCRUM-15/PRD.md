# PRD — Implementar autenticação de usuários com JWT - Teste #3 - Fase 2 - Squad Agêntica

## Identificação
- **Jira Key**: SCRUM-15
- **Resumo**: Implementar autenticação de usuários com JWT - Teste #3 - Fase 2 - Squad Agêntica
- **Versão**: 1.0
- **Autor**: Agente PO (IA)
- **Data**: 2026-05-25

## Contexto
O **Squad Agêntica** opera uma plataforma de desenvolvimento de software orientada por agentes de IA autônomos (PO, LT, DEV e QA), orquestrados via Jira e hospedados em uma stack Node.js 22 / TypeScript 5 com Express 5, PostgreSQL (Supabase via Drizzle ORM) e Redis/BullMQ. O pipeline percorre múltiplos status no Jira, com gates de aprovação humana entre cada etapa, gerando artefatos versionados no GitHub por história.

Atualmente, a plataforma não possui um mecanismo formal de autenticação e autorização para seus usuários. Isso significa que qualquer rota e funcionalidade da API pode ser acessada sem validação de identidade, expondo dados sensíveis de orquestração, artefatos de histórias e credenciais de integrações (Jira, GitHub, Anthropic) a acessos não autorizados.

A implementação de autenticação baseada em JWT (JSON Web Token) é uma fundação crítica de segurança para o produto. Ela permitirá que apenas usuários autenticados e devidamente autorizados interajam com os recursos protegidos do sistema — como webhooks, artefatos de histórias e dados do banco de dados — alinhando a plataforma a padrões mínimos de segurança para produtos B2B SaaS.

Esta história faz parte da Fase 2 do roadmap do Squad Agêntica e é pré-requisito para futuras funcionalidades de controle de acesso baseado em papéis (RBAC), multi-tenancy e auditoria de ações por usuário.

## Problema
A plataforma do Squad Agêntica não possui mecanismo de autenticação de usuários, deixando todas as rotas e recursos da API acessíveis sem verificação de identidade. Isso impede o controle de acesso a funcionalidades protegidas e representa um risco de segurança crítico para um produto B2B SaaS em evolução.

## Objetivos
- **OBJ-01**: Garantir que 100% das rotas protegidas da API rejeitem requisições sem token JWT válido, retornando HTTP 401, antes do fim do sprint.
- **OBJ-02**: Reduzir o tempo médio de autenticação de um usuário (do envio do formulário até o recebimento do token) para menos de 500 ms em ambiente de produção (Render free tier).

## Escopo
Esta entrega cobre a implementação completa do fluxo de autenticação de usuários via e-mail e senha com emissão de tokens JWT. Inclui: endpoint de login (`POST /auth/login`), endpoint de cadastro (`POST /auth/register`), middleware de autenticação JWT para proteção de rotas, persistência de usuários no banco de dados PostgreSQL via Drizzle ORM, hashing seguro de senhas e renovação de token via refresh token. As rotas protegidas existentes (`POST /webhooks/jira` e `GET /health`) deverão ser avaliadas individualmente para aplicação do middleware.

## Fora de Escopo
- Autenticação via provedores externos (OAuth2, Google, GitHub SSO)
- Controle de acesso baseado em papéis (RBAC) — previsto para fase posterior
- Interface de usuário (front-end) para login e cadastro
- Recuperação e redefinição de senha via e-mail
- Autenticação multi-fator (MFA)
- Gerenciamento de sessões com revogação de tokens individuais (blacklist de JWT)

## Requisitos Funcionais

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-01 | O sistema deve expor o endpoint `POST /auth/register` que recebe `email` e `password`, valida o formato do e-mail e força senha com no mínimo 8 caracteres, armazena o usuário com senha hasheada (bcrypt, salt rounds ≥ 12) no PostgreSQL e retorna HTTP 201 com o `id` e `email` do usuário criado. | Must Have |
| RF-02 | O sistema deve expor o endpoint `POST /auth/login` que recebe `email` e `password`, valida as credenciais contra o banco de dados e, em caso de sucesso, retorna HTTP 200 com um `accessToken` JWT (expiração de 15 minutos) e um `refreshToken` (expiração de 7 dias). | Must Have |
| RF-03 | O sistema deve implementar um middleware Express de autenticação JWT que extrai o token do header `Authorization: Bearer <token>`, valida assinatura e expiração, e injeta os dados do usuário no objeto `req` para uso pelos handlers subsequentes. | Must Have |
| RF-04 | O middleware de autenticação deve rejeitar requisições com token ausente, malformado ou expirado com HTTP 401 e corpo JSON `{ "error": "Unauthorized", "message": "<motivo>" }`. | Must Have |
| RF-05 | O sistema deve expor o endpoint `POST /auth/refresh` que recebe um `refreshToken` válido e retorna um novo par `accessToken` / `refreshToken`, invalidando o refresh token anterior. | Must Have |
| RF-06 | O sistema deve persistir os refresh tokens na tabela `user_refresh_tokens` do PostgreSQL, associados ao `user_id`, com campos de expiração e flag de revogação, gerenciados via Drizzle ORM. | Should Have |
| RF-07 | O endpoint `POST /auth/logout` deve aceitar o `refreshToken` e marcá-lo como revogado no banco de dados, impedindo sua reutilização. | Should Have |
| RF-08 | Todos os endpoints de autenticação devem registrar logs estruturados (via Pino) com campos: `userId` (quando disponível), `action`, `ip`, `statusCode` e `durationMs`, sem registrar senhas ou tokens completos. | Should Have |
| RF-09 | O sistema deve criar a migration Drizzle com as tabelas `users` (`id`, `email`, `password_hash`, `created_at`, `updated_at`) e `user_refresh_tokens` (`id`, `user_id`, `token_hash`, `expires_at`, `revoked`, `created_at`). | Must Have |

## Critérios de Aceite

- **CA-01**: Dado que um novo usuário envia `POST /auth/register` com e-mail válido e senha com 8+ caracteres, quando a requisição é processada, então o sistema retorna HTTP 201 com `{ id, email }` e o usuário é persistido no banco com a senha hasheada (não em texto plano).
- **CA-02**: Dado que um usuário cadastrado envia `POST /auth/login` com credenciais corretas, quando a requisição é processada, então o sistema retorna HTTP 200 contendo `accessToken` (JWT válido por exatamente 15 minutos) e `refreshToken` (válido por 7 dias), e o tempo total de resposta é inferior a 500 ms.
- **CA-03**: Dado que um cliente realiza uma requisição a uma rota protegida sem o header `Authorization`, quando o middleware de autenticação avalia a requisição, então o sistema retorna HTTP 401 com corpo JSON `{ "error": "Unauthorized", "message": "Token não fornecido" }` e a requisição não avança para o handler da rota.
- **CA-04**: Dado que um cliente envia um `accessToken` expirado no header `Authorization: Bearer <token>`, quando o middleware valida o token, então o sistema retorna HTTP 401 com `{ "error": "Unauthorized", "message": "Token expirado" }`.
- **CA-05**: Dado que um usuário autenticado envia `POST /auth/refresh` com um `refreshToken` válido e não revogado, quando a requisição é processada, então o sistema retorna um novo `accessToken` e um novo `refreshToken`, e o refresh token anterior é marcado como revogado no banco de dados.
- **CA-06**: Dado que alguém tenta registrar um e-mail já existente no banco, quando `POST /auth/register` é chamado, então o sistema retorna HTTP 409 com `{ "error": "Conflict", "message": "E-mail já cadastrado" }` sem criar duplicatas.
- **CA-07**: Dado que o sistema processa qualquer requisição de autenticação, quando a ação é concluída (com sucesso ou erro), então um log estruturado Pino é emitido contendo os campos `action`, `ip`, `statusCode` e `durationMs`, sem expor senha ou token completo.

## Riscos

| ID | Risco | Probabilidade | Impacto | Mitigação |
|----|-------|--------------|---------|-----------|
| R-01 | Segredo JWT (`JWT_SECRET`) armazenado de forma insegura em variáveis de ambiente no Render free tier pode ser exposto em logs ou builds | Média | Alto | Usar variáveis de ambiente cifradas no Render; nunca logar o segredo; documentar rotação de chave na runbook da equipe |
| R-02 | Latência superior a 500 ms no Render free tier devido a cold start do serviço combinado com bcrypt (salt rounds 12) | Alta | Médio | Medir o tempo de hashing em ambiente de produção antes do aceite; avaliar redução para salt rounds 10 se necessário, documentando o trade-off de segurança |
| R-03 | Acúmulo ilimitado de refresh tokens no banco de dados, causando degradação de performance nas consultas da tabela `user_refresh_tokens` | Média | Médio | Implementar job BullMQ de limpeza periódica (purge de tokens expirados) junto com índice em `expires_at` e `user_id` na migration Drizzle |
| R-04 | Implementação incorreta do middleware pode proteger rotas novas mas deixar rotas existentes (`/webhooks/jira`) sem autenticação por omissão | Baixa | Alto | Criar testes de integração (Vitest) cobrindo explicitamente cada rota protegida; revisão obrigatória do LT no plano de execução |

## Referências
- Jira: SCRUM-15