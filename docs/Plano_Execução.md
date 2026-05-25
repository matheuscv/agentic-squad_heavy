# Plano de Execução — Squad 100% Agêntica

> Baseado em: `Proposta_Squad_Agentica_v1.docx` · Versão 1.0 · Maio de 2026  
> Legenda: **[HUMANO]** = você executa | **[CLAUDE]** = eu executo

---

## Visão Geral do Projeto

Construção de uma **Squad 100% Agêntica**: um conjunto de agentes de IA que conduzem, de ponta a ponta, o ciclo de desenvolvimento de histórias de software. Composta por:

- **Orquestrador** — coordena o pipeline, lê o board do Jira e delega
- **Agente PO** — gera o PRD a partir da história
- **Agente LT** — gera o plano de execução técnico (tasks)
- **Agente DEV** — implementa o código (até 5 em paralelo)
- **Agente QA** — executa testes, mede cobertura, aciona loop de correção

O controle de fluxo é ancorado no **board do Jira** (máquina de estados). Gates de aprovação humana existem em pontos críticos do ciclo.

---

## Stack Tecnológica

| Camada | Escolha | Alternativa |
|---|---|---|
| Linguagem / Runtime | **TypeScript + Node.js** | Python |
| Serviço orquestrador | **Render (Web Service)** | Fly.io / Railway |
| Banco de dados | **Supabase (Postgres)** | Neon / PlanetScale |
| Fila de jobs | **BullMQ + Redis** (via Upstash) | SQS / PgBoss |
| LLM | **Anthropic Claude** (API) | OpenAI |
| Integração Jira | **Jira REST API v3 + Webhooks** | — |
| Integração GitHub | **GitHub App + Actions** | GitLab CI |
| Observabilidade | **Betterstack / Logtail** | Datadog |
| Artefatos | **Supabase Storage** | S3 |
| Pacote NPM (Fase 5) | **npm registry** | GitHub Packages |

---

## Contas e Ferramentas Externas — Pré-Requisitos

Esta seção lista **tudo que você precisa criar/configurar antes de qualquer linha de código**.

### [HUMANO] — Criar Contas e Configurações Externas

#### 1. Atlassian / Jira Cloud
- [ ] Criar conta em [atlassian.com](https://atlassian.com) (free tier suficiente para dev)
- [ ] Criar um projeto Jira do tipo **Scrum** ou **Kanban**
- [ ] Configurar as colunas do board (máquina de estados):
  1. `Backlog`
  2. `A Refinar` *(gate humano — PO move para cá)*
  3. `Em Refinamento` *(agente PO ativo)*
  4. `Aguardando Aceite PRD` *(gate humano)*
  5. `PRD Aceito` *(agente LT ativo)*
  6. `Aguardando Aceite Plano` *(gate humano — LT humano revisa)*
  7. `Plano Validado` *(agentes DEV ativos, até 5 paralelos)*
  8. `Em Desenvolvimento` *(DEVs implementando)*
  9. `Aguardando Aceite Dev` *(gate humano)*
  10. `Em QA` *(agente QA ativo)*
  11. `Aguardando Aceite QA` *(gate humano)*
  12. `Validação Final` *(gate humano)*
  13. `Concluído`
- [ ] Gerar **API Token do Jira**: `Configurações de conta → Segurança → Criar API Token`
- [ ] Anotar: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`

#### 2. GitHub
- [ ] Criar (ou usar) conta no [github.com](https://github.com)
- [ ] Criar repositório: `agentic-squad` (público ou privado)
- [ ] Criar um **GitHub App** (Settings → Developer settings → GitHub Apps → New):
  - Permissões necessárias: `Contents: Read & Write`, `Pull requests: Read & Write`, `Actions: Read`, `Checks: Read`
  - Webhook URL: URL do Render (preencher depois — atualize após deploy)
  - Gerar e baixar a **Private Key (.pem)**
  - Anotar: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`
- [ ] Habilitar **GitHub Actions** no repositório

#### 3. Anthropic (Claude API)
- [ ] Criar conta em [console.anthropic.com](https://console.anthropic.com)
- [ ] Gerar **API Key**: `API Keys → Create Key`
- [ ] Verificar plano — recomendado **Build** para ter rate limits adequados para 5 DEVs paralelos
- [ ] Anotar: `ANTHROPIC_API_KEY`
- [ ] Definir qual modelo usar: `claude-opus-4-7` para Orquestrador/PO/LT/QA, `claude-sonnet-4-6` para DEV (custo/performance)

#### 4. Render
- [ ] Criar conta em [render.com](https://render.com)
- [ ] Não criar serviços agora — o Claude fará o deploy via Git na Fase 1
- [ ] Conectar a conta do GitHub ao Render (Settings → Connected Accounts)
- [ ] Anotar: `RENDER_API_KEY` (Account Settings → API Keys)

#### 5. Supabase
- [ ] Criar conta em [supabase.com](https://supabase.com)
- [ ] Criar projeto: `agentic-squad-db` (escolher região mais próxima)
- [ ] Aguardar provisionamento (2-3 minutos)
- [ ] Anotar (em Settings → API):
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `DATABASE_URL` (em Settings → Database → Connection string → URI)

#### 6. Upstash (Redis para BullMQ)
- [ ] Criar conta em [upstash.com](https://upstash.com)
- [ ] Criar banco Redis: `agentic-squad-queue` (região igual ao Render)
- [ ] Anotar: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- [ ] Também anotar a **connection string Redis** (formato `rediss://...`)

#### 7. Betterstack / Logtail (Observabilidade)
- [ ] Criar conta em [betterstack.com](https://betterstack.com)
- [ ] Criar source de logs: `agentic-squad`
- [ ] Anotar: `BETTERSTACK_SOURCE_TOKEN`

#### 8. npm (para Fase 5 — pode deixar para depois)
- [ ] Verificar se já tem conta no [npmjs.com](https://npmjs.com)
- [ ] Gerar token de publicação: `npm token create`
- [ ] Anotar: `NPM_TOKEN`

---

## Arquivo `.env` — Template Completo

> **[HUMANO]** Criar este arquivo na raiz do projeto após coletar todas as credenciais acima.

```env
# Jira
JIRA_BASE_URL=https://seu-workspace.atlassian.net
JIRA_EMAIL=seu@email.com
JIRA_API_TOKEN=...
JIRA_PROJECT_KEY=SAG
JIRA_WEBHOOK_SECRET=gere-um-uuid-aleatório

# GitHub App
GITHUB_APP_ID=...
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
GITHUB_APP_INSTALLATION_ID=...
GITHUB_OWNER=seu-usuario-github
GITHUB_REPO=agentic-squad

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
DATABASE_URL=postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres

# Redis (Upstash)
REDIS_URL=rediss://...

# Observabilidade
BETTERSTACK_SOURCE_TOKEN=...

# Ambiente
NODE_ENV=development
PORT=3000
```

---

## Fase 0 — Fundação e Provisionamento

**Objetivo:** Infraestrutura pronta, repositório estruturado, secrets configurados, esqueleto do serviço rodando.

### [HUMANO]
- [ ] Criar todas as contas listadas acima (seção "Pré-Requisitos")
- [ ] Coletar todos os tokens e variáveis de ambiente
- [ ] Criar o repositório GitHub `agentic-squad`
- [ ] Fazer clone local: `git clone https://github.com/seu-usuario/agentic-squad`
- [ ] Criar o arquivo `.env` local com todas as variáveis
- [ ] Apontar o Claude Code para o repositório clonado

### [CLAUDE]
- [ ] Inicializar estrutura do projeto TypeScript + Node.js:
  - `package.json`, `tsconfig.json`, `eslint`, `prettier`
  - Dependências: `@anthropic-ai/sdk`, `jira.js`, `@octokit/app`, `bullmq`, `ioredis`, `express`, `zod`, `drizzle-orm`
- [ ] Criar estrutura de pastas:
  ```
  src/
    orchestrator/      # máquina de estados
    agents/            # PO, LT, DEV, QA
    integrations/      # jira, github
    queue/             # BullMQ workers
    db/                # schema Drizzle + migrações
    webhooks/          # receiver e validação
    api/               # endpoints REST internos
  ```
- [ ] Configurar Drizzle ORM com schema inicial (tabela `stories`, `agent_runs`, `artifacts`)
- [ ] Rodar migrações no Supabase
- [ ] Criar `Dockerfile` e `render.yaml` para deploy no Render
- [ ] Criar workflow de CI base no GitHub Actions (`.github/workflows/ci.yml`): lint + build + test
- [ ] Criar servidor Express mínimo com endpoint `GET /health`
- [ ] Configurar variáveis de ambiente no Render (via dashboard ou API)
- [ ] Fazer primeiro deploy no Render e validar que `/health` responde

### Entregáveis da Fase 0
- Repositório GitHub com estrutura TypeScript
- Banco Supabase com schema inicial migrado
- Serviço rodando no Render (`/health` = 200 OK)
- CI verde no GitHub Actions
- `.env.example` documentado no repositório

### Definition of Done — Fase 0
- ✓ `GET /health` retorna 200 no Render (URL pública)
- ✓ CI passa: build, lint, testes (mínimos)
- ✓ Banco de dados acessível e migrado
- ✓ Fila Redis conectada (ping OK)
- ✓ Nenhum secret em código — tudo via env vars

---

## Fase 1 — Núcleo do Orquestrador + Integração Jira

**Objetivo:** Máquina de estados funcionando ponta a ponta, movendo cards no Jira com um agente real (PO mock).

**Criticidade:** CRÍTICA — tudo depende desta fase.

### [HUMANO]
- [ ] Configurar webhook no Jira:
  - Jira → Configurações → Sistema → Webhooks → Criar
  - URL: `https://sua-app.onrender.com/webhooks/jira`
  - Eventos: `Issue updated` (campo status)
  - Criar um card de teste no board para validar
- [ ] Instalar o GitHub App no repositório (Settings → GitHub Apps → Install)
- [ ] Informar ao Claude o `GITHUB_APP_INSTALLATION_ID` após instalar
- [ ] Testar manualmente: mover um card de `Backlog` → `A Refinar` e verificar se o webhook chega

### [CLAUDE]
- [ ] Implementar **Webhook Receiver**:
  - Endpoint `POST /webhooks/jira` com validação de assinatura HMAC-SHA256
  - Parser de payload: extrair `issue_key`, `story_id`, `new_status`, `old_status`
  - Enfileirar job no BullMQ com os dados da transição
- [ ] Implementar **Máquina de Estados** do Orquestrador:
  - Mapa completo das 13 colunas e transições válidas
  - Para cada transição automática: qual agente invocar
  - Para cada gate humano: suspender e aguardar
  - Idempotência: processar o mesmo evento duas vezes não causa dano
- [ ] Implementar **Job de Reconciliação**:
  - Polling a cada 1-2 minutos no Jira
  - Compara estado persistido no banco vs. estado real no Jira
  - Resolve divergências (tolerância a falhas de webhook)
- [ ] Implementar **Jira API Client**:
  - `getIssue(key)`, `transitionIssue(key, statusId)`, `addComment(key, text)`, `getTransitions(key)`
  - Autenticação via Basic Auth (email + API token)
- [ ] Implementar **GitHub App Client**:
  - Autenticação JWT + installation token
  - `createCommit`, `createPR`, `triggerWorkflow`, `getWorkflowRunStatus`
- [ ] Implementar **Agente PO (stub)** para teste de ponta a ponta:
  - Versão simplificada: gera um PRD.md mínimo (texto fixo + dados da história)
  - Apenas para validar o fluxo — será substituído na Fase 2
- [ ] Persistir estado de cada história no banco (`stories` table)
- [ ] Logs estruturados em cada transição (para Betterstack)

### Entregáveis da Fase 1
- Webhook receiver validado e enfileirando jobs
- Máquina de estados cobrindo todos os 13 estados
- Card se move automaticamente Backlog → A Refinar → Em Refinamento → Aguardando Aceite PRD
- Agente PO stub gera PRD.md e commita no repositório
- Job de reconciliação rodando

### Definition of Done — Fase 1
- ✓ Card criado no Jira chega ao serviço via webhook em < 5s
- ✓ Orquestrador move o card para o próximo status automático
- ✓ Gate humano: card para em `Aguardando Aceite PRD` e NÃO avança sem ação humana
- ✓ PRD.md stub é commitado no branch correto do repositório
- ✓ Reconciliação detecta card "travado" e re-processa
- ✓ Zero secrets em código; testes de unidade na máquina de estados (≥ 80% coverage)

---

## Fase 2 — Agentes PO e LT (Artefatos Reais)

**Objetivo:** PRD.md e PLANO_DE_EXECUCAO.md gerados por IA de verdade, com qualidade e estrutura padronizada.

### [HUMANO]
- [ ] Revisar e aprovar o primeiro PRD.md gerado pelo agente PO real (gate humano no Jira)
- [ ] Revisar e aprovar o primeiro PLANO_DE_EXECUCAO.md gerado pelo agente LT (gate humano)
- [ ] Dar feedback ao Claude sobre qualidade dos artefatos gerados (para ajuste de prompts)

### [CLAUDE]
- [ ] Implementar **Agente PO completo**:
  - System prompt: papel de Product Owner sênior
  - Ferramentas: `jira.getIssue()` (lê história e contexto), `github.readFile()` (lê README, PRDs anteriores, glossário)
  - Geração do PRD.md com estrutura padronizada:
    - Contexto, Problema, Objetivos, Escopo, Fora-de-escopo
    - Requisitos funcionais (RF-XX numerados)
    - Critérios de aceite mensuráveis
    - Riscos identificados
  - Commit do PRD.md no branch da história
  - Atualizar card Jira: mover para `Aguardando Aceite PRD` + comentário com link
- [ ] Implementar **Agente LT completo**:
  - System prompt: papel de Tech Lead sênior
  - Ferramentas: `github.readFile(PRD.md)`, `github.readFile(README)` (detecta stack existente)
  - Decomposição do PRD em tasks técnicas numeradas (TASK-01, TASK-02, ...)
  - Cada task: descrição, arquivos afetados, critério de aceite técnico, estimativa relativa
  - Identificação de tasks paralelizáveis vs. sequenciais
  - Geração do PLANO_DE_EXECUCAO.md
  - Commit do arquivo e move card para `Aguardando Aceite Plano`
- [ ] Ajustar prompts baseado em feedback do HUMANO
- [ ] Testes de integração: PO e LT rodando com histórias reais do Jira de teste

### Entregáveis da Fase 2
- `src/agents/po-agent.ts` — implementação completa
- `src/agents/lt-agent.ts` — implementação completa
- Prompts versionados em `src/agents/prompts/`
- PRD.md e PLANO_DE_EXECUCAO.md gerados em histórias de teste

### Definition of Done — Fase 2
- ✓ PRD.md tem mínimo de 5 RFs numerados, critérios mensuráveis, seção de fora-de-escopo
- ✓ PLANO_DE_EXECUCAO.md tem tasks numeradas, pelo menos 2 identificadas como paralelizáveis
- ✓ Artefatos commitados no branch correto antes do gate humano
- ✓ Comentário no Jira com link para os artefatos após cada geração
- ✓ Tempo de geração PO < 3 min; LT < 5 min por história

---

## Fase 3 — Agentes DEV e QA via CI

**Objetivo:** Código implementado + testes com ≥ 85% de cobertura + loop de correção automático.

### [HUMANO]
- [ ] Aprovar o gate "Aguardando Aceite Dev" após revisar o PR gerado
- [ ] Aprovar o gate "Aguardando Aceite QA" após revisar relatório de cobertura
- [ ] Configurar **runner de CI** no GitHub Actions (o Claude cria o workflow; você habilita Actions no repo)

### [CLAUDE]
- [ ] Implementar **Agente DEV completo**:
  - System prompt: papel de desenvolvedor sênior na linguagem do projeto-alvo
  - Ferramentas: `github.readFile(PLANO_DE_EXECUCAO.md)`, `github.readFile(task específica)`, `github.writeFile()`, `github.createCommit()`
  - Recebe: número da task, contexto do projeto (stack, estrutura de pastas, convenções)
  - Produz: implementação + testes unitários no mesmo PR
  - Cria PR para branch principal com título padronizado `[TASK-XX] descrição`
  - Move card para `Aguardando Aceite Dev`
- [ ] Implementar **Workflow de CI** (`agent-dev.yml`):
  - Trigger: push em branches `agent/task-*`
  - Steps: checkout, install deps, lint, build, test, coverage report
  - Status check obrigatório no PR
- [ ] Implementar **Agente QA completo**:
  - System prompt: papel de engenheiro de QA especializado em testes
  - Ferramentas: `github.getWorkflowRunResult()`, `github.readFile()` (lê código e testes)
  - Analisa relatório de cobertura do CI
  - Se cobertura < 85%: gera novos testes, faz commit → CI roda novamente → loop
  - Máximo de 3 iterações do loop — se ainda < 85%, escala para humano via comentário
  - Relatório de regressão: executa todos os testes existentes, detecta quebras
  - Move card para `Aguardando Aceite QA` quando aprovado
- [ ] **Loop de Correção**:
  - QA detecta falha → cria issue de correção → DEV corrige → QA re-valida
  - Máximo de 3 ciclos antes de escalar para humano
- [ ] Testes de integração com histórias reais de baixa complexidade

### Entregáveis da Fase 3
- `src/agents/dev-agent.ts`
- `src/agents/qa-agent.ts`
- `.github/workflows/agent-dev.yml`
- Loop de correção DEV ↔ QA funcional

### Definition of Done — Fase 3
- ✓ Código gerado passa lint e build sem erros
- ✓ Cobertura de testes ≥ 85% antes de avançar do QA
- ✓ Testes de regressão: zero quebras em testes pré-existentes
- ✓ Loop de correção funciona: QA → DEV → QA em até 3 iterações
- ✓ PR criado pelo DEV é revisável por humano (código limpo, commits atômicos)

---

## Fase 4 — Paralelismo, Observabilidade e Hardening

**Objetivo:** Até 5 DEVs simultâneos, métricas de custo, alertas, segurança e resiliência.

### [HUMANO]
- [ ] Revisar e aprovar limites de concorrência (padrão: 5 DEVs paralelos)
- [ ] Configurar alertas no Betterstack (threshold de custo, taxa de erro)
- [ ] Revisar relatório de custo após primeira semana de uso real

### [CLAUDE]
- [ ] **Paralelismo de DEVs**:
  - BullMQ com concurrency=5 para jobs de DEV
  - Isolamento de contexto: cada DEV recebe apenas sua task
  - Sem vazamento de estado entre workers paralelos
  - Fila com prioridade: tasks críticas avançam na fila
- [ ] **Painel de Custo de Tokens**:
  - Instrumentação de cada chamada Anthropic: input tokens, output tokens, custo estimado
  - Persistência por agente, por história, por fase no banco
  - Endpoint `GET /metrics/cost` retorna custo acumulado
  - Alerta automático se custo/história exceder threshold configurável
- [ ] **Observabilidade completa**:
  - Logs estruturados em JSON com: `story_id`, `agent`, `phase`, `duration_ms`, `token_cost`
  - Métricas: tempo médio por fase, taxa de sucesso, loops de correção por história
  - Integração Betterstack: enviar logs + alertas
- [ ] **Hardening e segurança**:
  - Rate limiting no webhook receiver (proteção contra replay attacks)
  - Validação rigorosa de todos os inputs com Zod
  - Sanitização de payloads antes de passar ao LLM (prompt injection prevention)
  - Retry com backoff exponencial em falhas de API (Jira, GitHub, Anthropic)
  - Dead-letter queue: jobs que falham 3x vão para DLQ e alertam o humano
  - Timeout configurável por agente (DEV: 15min, PO/LT: 5min, QA: 10min)
- [ ] **Resiliência**:
  - Restart automático de jobs interrompidos (idempotência garantida)
  - Health check expandido: `/health/detailed` com status de fila, banco, Redis
  - Graceful shutdown: drena fila antes de encerrar

### Entregáveis da Fase 4
- Múltiplos DEVs rodando em paralelo sem conflitos
- Dashboard de custo de tokens acessível via API
- Logs centralizados no Betterstack
- DLQ configurada e alertas ativos

### Definition of Done — Fase 4
- ✓ 5 DEVs simultâneos sem race conditions ou vazamento de contexto
- ✓ Custo de tokens visível por história e por agente
- ✓ Alerta disparado quando custo/história > threshold
- ✓ Job na DLQ gera notificação (comentário no Jira + log)
- ✓ Sistema sobrevive a restart do Render sem perder estado

---

## Fase 5 — Reusabilidade (Squad-in-a-Box)

**Objetivo:** Pacote NPM instalável que conecta a squad a qualquer projeto via configuração.

### [HUMANO]
- [ ] Definir nome do pacote NPM (ex: `@seu-usuario/agentic-squad`)
- [ ] Testar o onboarding em um segundo projeto real
- [ ] Publicar o pacote no npm (após aprovação): `npm publish`

### [CLAUDE]
- [ ] **Arquivo de configuração por projeto** (`squad.config.ts`):
  ```typescript
  {
    jira: { baseUrl, projectKey, statusMap },
    github: { owner, repo, defaultBranch },
    ci: { testCommand, coverageCommand, coverageThreshold },
    agents: { devConcurrency, timeouts, models },
    notifications: { onGateReached, onError }
  }
  ```
- [ ] **CLI de Onboarding** (`npx agentic-squad init`):
  - Wizard interativo: conecta Jira, GitHub App, valida acessos
  - Instala GitHub Actions workflow no repo alvo
  - Registra webhook no Jira automaticamente
  - Roda "smoke test": cria história de teste e valida o fluxo completo
- [ ] **Detecção de stack**:
  - Lê `package.json`, `pyproject.toml`, `pom.xml` etc. do projeto alvo
  - Configura automaticamente `testCommand` e `coverageCommand`
- [ ] **Isolamento multi-projeto**:
  - Estado, logs e custos segmentados por `projectKey`
  - Múltiplos projetos rodando na mesma instância sem interferência
- [ ] **Versionamento da squad**:
  - Changelogs automáticos
  - Migração de schema controlada (Drizzle migrations)
- [ ] Publicação no npm com documentação completa (`README.md`)

### Entregáveis da Fase 5
- Pacote `agentic-squad` publicado no npm
- `npx agentic-squad init` funcional
- Documentação: `README.md`, `RUNBOOK.md`, `COST_GUIDE.md`
- Segundo projeto onboardado com sucesso como prova de conceito

### Definition of Done — Fase 5
- ✓ Squad conectada a um segundo projeto distinto **apenas via configuração**, sem alterar o motor
- ✓ Onboarding completo em < 10 minutos
- ✓ Dois projetos rodando em paralelo sem vazamento de estado
- ✓ `npx agentic-squad init` sem erros em projeto limpo

---

## Gates de Aprovação Humana (Resumo)

| Gate | Status Jira | O que o humano faz |
|---|---|---|
| Gate 1 | `Aguardando Aceite PRD` | Lê PRD.md, move para `PRD Aceito` se aprovado |
| Gate 2 | `Aguardando Aceite Plano` | Lê PLANO_DE_EXECUCAO.md, move para `Plano Validado` se aprovado |
| Gate 3 | `Aguardando Aceite Dev` | Revisa PR do DEV no GitHub, aprova ou solicita mudanças |
| Gate 4 | `Aguardando Aceite QA` | Lê relatório de cobertura, move para `Validação Final` |
| Gate 5 | `Validação Final` | Valida a história end-to-end, move para `Concluído` |

---

## Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Rate limit da API Anthropic com 5 DEVs paralelos | Média | Alto | Retry com backoff; monitorar usage; tier Build da Anthropic |
| Webhook do Jira não chegar (firewall, timeout) | Baixa | Alto | Job de reconciliação a cada 1-2 min como rede de segurança |
| DEV gera código que quebra testes existentes | Alta | Médio | QA roda regressão completa antes de liberar |
| Loop DEV↔QA infinito | Baixa | Médio | Limite de 3 iterações + DLQ + alerta humano |
| Custo de tokens explode em histórias complexas | Média | Médio | Alerta por threshold; cache de prompts; limite de tokens por agente |
| GitHub App com permissões insuficientes | Baixa | Alto | Checklist de permissões na Fase 0; smoke test na Fase 1 |
| Jira Cloud vs. Server/Data Center | Baixa | Médio | Abstração na camada de cliente Jira; configurável por projeto |
| Prompt injection via conteúdo do Jira | Baixa | Alto | Sanitização obrigatória antes de passar contexto ao LLM |

---

## Decisões de Projeto (Confirmadas)

| Decisão | Justificativa |
|---|---|
| TypeScript + Node.js | SDKs maduros (Jira, GitHub, Anthropic); tipagem fortalece a máquina de estados |
| Render (Web Service) | Long-running real, sem timeout de serverless; deploy simples via Git |
| Supabase (Postgres) | Estado + artefatos + auth no mesmo lugar; custo previsível |
| BullMQ + Redis | Filas robustas com retry, DLQ e concurrency nativa |
| Webhook + polling de reconciliação | Tempo real orientado a eventos + rede de segurança contra falhas |
| Gates humanos nos 5 pontos críticos | Supervisão e responsabilização — transforma autonomia em confiança |
| Orquestrador não codifica | Separação clara de papéis; o Orquestrador apenas coordena |
| Fases ordenadas por criticidade | Orquestrador primeiro → artefatos → paralelismo → reusabilidade |

---

## Cronograma e Esforço Relativo

| Fase | Marco principal | Esforço | Dependência |
|---|---|---|---|
| **Fase 0** | Infra configurada e serviço no ar | Pequeno | — (pré-requisito humano) |
| **Fase 1** | Fluxo ponta a ponta com mocks | **Grande** (núcleo, maior risco técnico) | Fase 0 |
| **Fase 2** | PO e LT gerando artefatos reais | Médio | Fase 1 |
| **Fase 3** | DEV+QA via CI; loop de correção | **Grande** | Fase 2 |
| **Fase 4** | Paralelismo, observabilidade, hardening | Médio | Fase 3 |
| **Fase 5** | Pacote plugável em qualquer projeto | Médio | Fase 4 |

> A Fase 1 concentra o maior risco técnico — merece folga no planejamento.

---

## Estimativa de Custo Mensal (Ordem de Grandeza)

### Infraestrutura (custo-base fixo)
| Serviço | Plano | Estimativa |
|---|---|---|
| Render (Web Service) | Starter ($7/mês) ou Standard ($25/mês) | $7–25/mês |
| Supabase | Free (até 500MB) → Pro ($25/mês) | $0–25/mês |
| Upstash Redis | Pay-per-use (< $1 em dev) | $1–5/mês |
| Betterstack | Free (até 1GB/mês) | $0–10/mês |
| **Total infra** | | **~$10–65/mês** |

### Consumo de IA (variável por uso)
| Modelo | Uso estimado | Custo/história (estimativa) |
|---|---|---|
| claude-opus-4-7 (Orquestrador, PO, LT, QA) | ~50K tokens/história | ~$0.75–1.50 |
| claude-sonnet-4-6 (DEV × até 5) | ~30K tokens/task | ~$0.45–0.90/task |
| **Total por história** | (4 tasks médias) | **~$3–8/história** |

> Com 20 histórias/mês: ~$60–160 em LLM + $10–65 de infra = **~$70–225/mês total**.

---

## Próximos Passos Imediatos

1. **[HUMANO]** Criar as contas listadas na seção "Pré-Requisitos" (Jira, GitHub, Anthropic, Render, Supabase, Upstash, Betterstack)
2. **[HUMANO]** Coletar todos os tokens e preencher o template `.env`
3. **[HUMANO]** Criar o repositório `agentic-squad` no GitHub e clonar localmente
4. **[HUMANO]** Abrir o Claude Code na raiz do repositório clonado e dizer: *"Vamos iniciar a Fase 0"*
5. **[CLAUDE]** Inicializar o projeto TypeScript, estrutura de pastas, schema do banco e primeiro deploy

---

*Documento gerado em: 2026-05-24 | Baseado em: Proposta_Squad_Agentica_v1.docx*
