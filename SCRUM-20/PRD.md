# PRD — Adicionar endpoint GET /ping

## Identificação
- **Jira Key**: SCRUM-20
- **Resumo**: Adicionar endpoint GET /ping que retorna { status: 'ok', version: '1.0.0' } em src/routes/ping.ts
- **Versão**: 1.0
- **Autor**: Agente PO (IA)
- **Data**: 2026-05-28

## Contexto
O projeto **Squad Agêntica** é um sistema de desenvolvimento de software orientado a agentes de IA autônomos (PO, LT, DEV, QA) orquestrados via Jira. A aplicação é construída em **Node.js 22 / TypeScript 5** com **Express 5**, e cada história percorre um pipeline automatizado com gates de aprovação humana entre as etapas.

Atualmente, a aplicação já expõe a rota `GET /health`, responsável por verificar a conectividade com banco de dados (PostgreSQL via Supabase/Drizzle) e fila de jobs (Redis via Upstash). Contudo, não existe um endpoint de verificação de vivacidade (*liveness*) leve, que responda independentemente de dependências externas e que exponha de forma imediata a versão do serviço em execução.

Esta história faz parte da **Fase 4** do projeto e foi deliberadamente desenhada com escopo mínimo: exatamente **1 arquivo de implementação** (`src/routes/ping.ts`) e **1 arquivo de testes**. Essa contenção de escopo tem como objetivo permitir que toda a equipe observe e valide cada etapa do pipeline de agentes sem ruído de complexidade de negócio, servindo como caso de referência para histórias futuras.

O endpoint também possui valor operacional real: ferramentas de orquestração de contêineres, proxies reversos e pipelines de CI frequentemente exigem um probe de *liveness* ultraleve que não dependa de banco de dados ou cache para confirmar que o processo está no ar e qual versão está rodando.

## Problema
A aplicação não possui um endpoint de *liveness check* dedicado, leve e sem dependências externas. O endpoint `/health` existente verifica banco e Redis — tornando-o inadequado para cenários onde apenas a vivacidade do processo precisa ser confirmada rapidamente (ex.: probes de Kubernetes, smoke tests de CI). Adicionalmente, nenhuma rota atual expõe a versão da aplicação de forma padronizada e programática.

## Objetivos
- **OBJ-01**: Disponibilizar um endpoint `GET /ping` que responda com HTTP 200 e payload `{ status: 'ok', version: '1.0.0' }` em menos de 50 ms (p99), sem dependência de banco de dados ou Redis.
- **OBJ-02**: Garantir cobertura de testes unitários de 100% para o módulo `src/routes/ping.ts`, permitindo que o CI complete a suíte em menos de 2 minutos no total.

## Escopo
- Criação do arquivo `src/routes/ping.ts` contendo o handler Express do endpoint `GET /ping`.
- Registro da nova rota no entrypoint da aplicação (`src/index.ts`).
- Criação do arquivo de testes correspondente (ex.: `src/routes/ping.test.ts`) utilizando **Vitest**.
- Atualização da tabela de rotas no `README.md` para incluir o novo endpoint.

## Fora de Escopo
- Autenticação ou autorização no endpoint `/ping` — a rota deve ser pública.
- Consulta a banco de dados, Redis ou qualquer serviço externo durante o processamento da requisição.
- Versionamento dinâmico a partir de `package.json` em tempo de execução — a versão `'1.0.0'` deve ser um valor fixo (ou constante) nesta entrega.
- Modificações no endpoint `/health` existente.
- Criação de métricas ou instrumentação de observabilidade além do log estruturado padrão (Pino).

## Requisitos Funcionais

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-01 | O sistema deve expor a rota `GET /ping` respondendo com status HTTP `200 OK`. | Must Have |
| RF-02 | O corpo da resposta deve ser um JSON com exatamente dois campos: `status` (string `"ok"`) e `version` (string `"1.0.0"`). | Must Have |
| RF-03 | O header `Content-Type` da resposta deve ser `application/json; charset=utf-8`. | Must Have |
| RF-04 | A rota deve ser implementada em `src/routes/ping.ts` e exportar um `Router` do Express 5. | Must Have |
| RF-05 | O `Router` exportado por `src/routes/ping.ts` deve ser registrado no entrypoint `src/index.ts` antes do início do servidor. | Must Have |
| RF-06 | O endpoint não deve realizar nenhuma operação de I/O (banco de dados, cache, sistema de arquivos) durante o processamento da requisição. | Should Have |
| RF-07 | O handler deve emitir um log estruturado (via Pino) com nível `debug` contendo ao menos o campo `route: '/ping'` a cada requisição recebida. | Should Have |

## Critérios de Aceite
- **CA-01**: Dado que a aplicação está em execução, quando uma requisição `GET /ping` é enviada sem headers especiais, então a resposta deve ter status HTTP `200`, `Content-Type: application/json` e corpo exato `{"status":"ok","version":"1.0.0"}`.
- **CA-02**: Dado que o arquivo `src/routes/ping.ts` existe, quando a suíte de testes é executada com `npm test`, então todos os testes do arquivo `ping.test.ts` devem passar e a cobertura de linhas do módulo `src/routes/ping.ts` deve ser de 100%.
- **CA-03**: Dado que o banco de dados ou o Redis estão indisponíveis, quando uma requisição `GET /ping` é enviada, então a resposta ainda deve retornar HTTP `200` com o payload `{"status":"ok","version":"1.0.0"}`, confirmando ausência de dependências externas.
- **CA-04**: Dado que o pipeline de CI é executado após o merge da história, quando a etapa de testes roda, então a suíte completa deve finalizar em menos de 2 minutos, sem falhas relacionadas à nova rota.
- **CA-05**: Dado que a tabela de rotas do `README.md` é consultada, quando o endpoint `/ping` é entregue, então a tabela deve conter uma linha documentando `GET /ping` com descrição do seu propósito.

## Riscos

| ID | Risco | Probabilidade | Impacto | Mitigação |
|----|-------|--------------|---------|-----------|
| R-01 | Conflito de registro de rotas no `src/index.ts` caso a ordem de montagem dos Routers cause sobreposição com middlewares globais de erro ou autenticação futura. | Baixa | Médio | Registrar a rota `/ping` antes de quaisquer middlewares de autenticação e após os middlewares de parsing (JSON/body-parser), documentando a ordem no próprio arquivo. |
| R-02 | Versão `'1.0.0'` hardcoded pode ficar desatualizada silenciosamente em releases futuras, gerando inconsistência entre o valor retornado e a versão real do pacote. | Média | Baixo | Adicionar comentário no código orientando a atualizar a constante a cada bump de versão; avaliar leitura dinâmica de `package.json` em história futura dedicada. |
| R-03 | Ausência de testes de integração (apenas unitários no escopo) pode não detectar falhas de registro da rota no Express caso o entrypoint seja refatorado. | Baixa | Médio | Incluir ao menos um teste de integração leve com `supertest` que dispare `GET /ping` contra a instância real do Express, verificando status e payload end-to-end. |

## Referências
- Jira: SCRUM-20