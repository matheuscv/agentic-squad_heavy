Ambos os arquivos de contexto do repositório não foram localizados, mas tenho todos os dados da história SCRUM-14. Vou gerar o PRD completo com base nas informações coletadas do Jira e no meu conhecimento sênior de produto B2B SaaS!

---

```markdown
# PRD — Implementar autenticação de usuários com JWT

## Identificação
- **Jira Key**: SCRUM-14
- **Resumo**: Implementar autenticação de usuários com JWT - Teste #2 - Fase 2 - Squad Agêntica
- **Versão**: 1.0
- **Autor**: Agente PO (IA)
- **Data**: 2025-07-08

## Contexto
A plataforma encontra-se em fase de refinamento de funcionalidades fundamentais de segurança. A autenticação de usuários é a camada de entrada e proteção de todo o sistema — sem ela, nenhuma funcionalidade sensível ou personalizada pode ser entregue com segurança ao usuário final.

Em produtos B2B SaaS, a confiança do cliente começa pela robustez do mecanismo de acesso. JSON Web Tokens (JWT) são o padrão consolidado de mercado para autenticação stateless, amplamente adotado por permitir escalabilidade horizontal, integração com múltiplos serviços e auditoria de sessão sem necessidade de armazenamento de estado no servidor.

Esta história faz parte da Fase 2 do roadmap do Squad Agêntica, indicando que a plataforma já possui camadas anteriores estabelecidas (infraestrutura, modelagem de dados, etc.) e agora evolui para a habilitação do acesso seguro dos usuários às funcionalidades protegidas.

A entrega desta história é pré-requisito crítico para todas as demais features que exijam contexto de usuário autenticado, como painéis personalizados, gestão de permissões e integrações protegidas por escopo.

## Problema
Atualmente, os usuários não possuem um mecanismo seguro e padronizado para se autenticar na plataforma. Sem autenticação implementada, nenhuma rota ou funcionalidade protegida pode ser disponibilizada, bloqueando o avanço do desenvolvimento de features de negócio e impedindo a realização de testes de integração e homologação com usuários reais.

## Objetivos
- **OBJ-01**: Permitir que 100% dos usuários cadastrados consigam se autenticar via e-mail e senha, recebendo um token JWT válido em até 2 segundos (p95) após o envio das credenciais corretas.
- **OBJ-02**: Garantir que 100% das rotas protegidas da plataforma rejeitem requisições sem token JWT válido, retornando HTTP 401, eliminando acessos não autorizados a funcionalidades sensíveis.

## Escopo
- Endpoint de login (`POST /auth/login`) que recebe e-mail e senha, valida as credenciais e retorna um token JWT assinado (access token) e, opcionalmente, um refresh token.
- Geração de JWT com payload contendo: `user_id`, `email`, `roles`, `iat` (issued at) e `exp` (expiration).
- Middleware/guard de autenticação para validação do token JWT em rotas protegidas.
- Tratamento de erros com respostas padronizadas para credenciais inválidas (HTTP 401) e token expirado/inválido (HTTP 401/403).
- Hash seguro de senhas (bcrypt ou argon2) na verificação das credenciais.
- Configuração de tempo de expiração do access token (ex: 15 minutos) e do refresh token (ex: 7 dias), externalizados via variáveis de ambiente.

## Fora de Escopo
- Autenticação social (OAuth2 com Google, GitHub, etc.) — prevista para fase futura.
- Autenticação multifator (MFA/2FA) — não contemplada nesta entrega.
- Fluxo de cadastro/registro de novos usuários — considerado história separada.
- Fluxo de recuperação e redefinição de senha — considerado história separada.
- Gerenciamento de permissões granulares (RBAC/ABAC) além do campo `roles` no token.
- Revogação ativa de tokens (token blacklist) — a ser avaliada em iteração futura.

## Requisitos Funcionais
| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-01 | O sistema deve disponibilizar o endpoint `POST /auth/login` que aceita `email` e `password` no corpo da requisição (JSON). | Must Have |
| RF-02 | Ao receber credenciais válidas, o sistema deve retornar um access token JWT assinado com algoritmo HS256 ou RS256, contendo `user_id`, `email`, `roles`, `iat` e `exp` no payload. | Must Have |
| RF-03 | O sistema deve validar o token JWT em todas as rotas marcadas como protegidas, bloqueando requisições com token ausente, malformado ou expirado com resposta HTTP 401. | Must Have |
| RF-04 | O sistema deve retornar HTTP 401 com mensagem de erro padronizada (`{"error": "invalid_credentials"}`) quando as credenciais fornecidas forem inválidas, sem revelar qual campo está incorreto. | Must Have |
| RF-05 | O sistema deve armazenar senhas exclusivamente em formato de hash (bcrypt com custo mínimo 10 ou argon2id), nunca em texto plano, nem nos logs. | Must Have |
| RF-06 | O sistema deve disponibilizar o endpoint `POST /auth/refresh` que aceita um refresh token válido e retorna um novo access token, sem necessidade de reenvio de credenciais. | Should Have |
| RF-07 | O tempo de expiração do access token e do refresh token deve ser configurável via variáveis de ambiente (`JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`), com valores padrão de 15m e 7d, respectivamente. | Should Have |
| RF-08 | O sistema deve registrar em log (nível `warn`) cada tentativa de acesso com token inválido ou expirado, incluindo timestamp, rota acessada e IP de origem, sem logar o token completo. | Could Have |

## Critérios de Aceite
- **CA-01**: Dado que um usuário cadastrado existe na base com e-mail `user@empresa.com` e senha válida, quando ele envia uma requisição `POST /auth/login` com as credenciais corretas, então o sistema retorna HTTP 200 com um JSON contendo `access_token` (JWT válido e decodificável) e `expires_in`, em no máximo 2 segundos (p95).
- **CA-02**: Dado que um usuário envia uma requisição `POST /auth/login` com e-mail inexistente ou senha incorreta, quando o sistema processa a requisição, então retorna HTTP 401 com o corpo `{"error": "invalid_credentials"}`, sem indicar qual campo está errado e sem vazar informações de existência do e-mail.
- **CA-03**: Dado que uma rota protegida existe na plataforma, quando uma requisição é feita sem o header `Authorization: Bearer <token>` ou com um token expirado/malformado, então o sistema retorna HTTP 401 e o acesso ao recurso é bloqueado completamente.
- **CA-04**: Dado que um usuário possui um access token JWT válido, quando ele envia uma requisição a uma rota protegida com o header `Authorization: Bearer <token>` correto, então o sistema processa a requisição normalmente e retorna HTTP 200 (ou o status esperado pela rota).
- **CA-05**: Dado que um access token expirou e o usuário possui um refresh token válido, quando ele envia `POST /auth/refresh` com o refresh token, então o sistema retorna um novo access token JWT válido com `exp` renovado, sem exigir reenvio de e-mail e senha.

## Riscos
| ID | Risco | Probabilidade | Impacto | Mitigação |
|----|-------|--------------|---------|-----------|
| R-01 | Vazamento do segredo JWT (`JWT_SECRET`) em repositório ou logs, comprometendo todos os tokens ativos. | Média | Alto | Utilizar gerenciador de segredos (ex: AWS Secrets Manager, Vault ou variáveis de ambiente protegidas no CI/CD); nunca commitar `.env` com segredos reais; adicionar `.env` ao `.gitignore` e configurar secret scanning no repositório. |
| R-02 | Ausência de rate limiting no endpoint de login pode viabilizar ataques de força bruta contra contas de usuários. | Alta | Alto | Implementar rate limiting (ex: máximo de 5 tentativas por IP em 60 segundos) com retorno HTTP 429, preferencialmente via API Gateway ou middleware dedicado. |
| R-03 | Tokens JWT com longa validade sem mecanismo de revogação podem manter acesso ativo mesmo após logout ou comprometimento de conta. | Média | Médio | Definir access token com expiração curta (15 minutos); planejar implementação de blacklist ou rotação de segredo para iteração futura; documentar a limitação para os stakeholders. |
| R-04 | Dependência desta história por outras features de negócio pode gerar bloqueio no sprint caso a entrega atrase. | Média | Alto | Priorizar esta história como primeiro item do sprint; garantir pair programming ou revisão de código ágil para reduzir ciclo de PR; definir mock de autenticação para times dependentes enquanto a feature não é entregue em produção. |

## Referências
- Jira: SCRUM-14
```