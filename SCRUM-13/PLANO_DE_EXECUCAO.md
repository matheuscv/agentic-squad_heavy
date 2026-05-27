# Plano de Execução — SCRUM-13: Teste #1 - Fase 2 — Squad Agêntica

## Identificação
- **Jira Key**: SCRUM-13
- **Resumo**: Teste #1 - Fase 2 — Squad Agêntica — execução estruturada de cenários de validação dos agentes com coleta de evidências, avaliação de qualidade e rastreabilidade no Jira
- **Versão**: 1.0
- **Autor**: Agente LT (IA)
- **Data**: 2026-05-27

## Stack Detectada
- **Runtime**: Node.js 22 / TypeScript 5
- **Framework**: Express 4
- **Banco de Dados**: PostgreSQL (Supabase) via Drizzle ORM
- **Fila**: BullMQ + Redis (Upstash / IORedis)
- **IA (Agentes)**: Anthropic Claude API (`claude-opus-4-7`) via `@anthropic-ai/sdk`
- **Testes**: Vitest + v8 coverage
- **Logs**: Pino (JSON estruturado)

## Visão Geral

| ID | Descrição resumida | Estimativa | Dependências | Paralelo |
|----|--------------------|------------|--------------|---------|
| TASK-01 | Definir e documentar cenários de teste da Fase 2 | M | — | Sim |
| TASK-02 | Criar módulo de avaliação de artefatos (critérios de qualidade) | M | — | Sim |
| TASK-03 | Criar módulo de coleta e persistência de evidências de teste | M | TASK-01 | Sim |
| TASK-04 | Implementar executor de cenários sobre o pipeline de agentes | G | TASK-01, TASK-02 | Não |
| TASK-05 | Implementar consolidação de métricas de desempenho por cenário | M | TASK-04 | Não |
| TASK-06 | Implementar gerador do relatório estruturado de teste | M | TASK-04, TASK-05 | Não |
| TASK-07 | Implementar vinculação do relatório e artefatos à issue SCRUM-13 no Jira | P | TASK-06 | Não |
| TASK-08 | Implementar categorização e registro de desvios e falhas | M | TASK-04 | Sim |
| TASK-09 | Persistir runs e artefatos do ciclo de teste no schema existente | M | TASK-03, TASK-04 | Não |
| TASK-10 | Escrever testes automatizados para os módulos de avaliação e geração de relatório | M | TASK-02, TASK-06 | Não |

## Tasks Detalhadas

### TASK-01 — Definir e Documentar Cenários de Teste da Fase 2
**Descrição**: Levantar, formalizar e persistir os cenários de teste do Teste #1 — Fase 2. Cada cenário deve conter: identificador (`TC-XX`), descrição, agente-alvo (`po`, `lt`, `dev` ou `qa`), entrada utilizada (jiraKey / prompt), saída esperada (tipo de artefato e formato), e critérios de avaliação aplicáveis (corretude, completude, rastreabilidade, aderência ao formato). Os cenários devem ser representados como um array tipado em `src/testing/scenarios.ts` e expostos como constante exportável para consumo pelo executor (TASK-04). Incluir ao menos um cenário por agente do pipeline (`po`, `lt`, `dev`, `qa`).
**Arquivos Afetados**:
- `src/testing/scenarios.ts` *(novo)*
- `src/testing/types.ts` *(novo — tipos compartilhados: `TestScenario`, `EvaluationCriteria`, `EvaluationResult`, `DeviationType`)*
**Critério de Aceite Técnico**: `src/testing/scenarios.ts` exporta array `TEST_SCENARIOS` com ao menos 4 entradas (uma por agente), cada entrada satisfazendo a interface `TestScenario` definida em `types.ts`; `npx tsc --noEmit` passa sem erros.
**Estimativa**: M — 2–4h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-02 — Criar Módulo de Avaliação de Artefatos
**Descrição**: Implementar `src/testing/evaluator.ts` com a função `evaluateArtifact(artifact: string, criteria: EvaluationCriteria): EvaluationResult`. O módulo deve avaliar um artefato textual gerado por um agente contra quatro eixos: **corretude** (estrutura mínima presente), **completude** (todas as seções obrigatórias do tipo de artefato), **rastreabilidade** (referência ao jiraKey e ao tipo de artefato) e **aderência ao formato** (markdown válido, headers, listas). Cada eixo retorna `'Aprovado' | 'Aprovado com ressalvas' | 'Reprovado'` com `reason: string`. A função também retorna o resultado global (`overallResult`) usando a regra: qualquer `'Reprovado'` → global `'Reprovado'`; qualquer `'Aprovado com ressalvas'` sem `'Reprovado'` → global `'Aprovado com ressalvas'`; todos `'Aprovado'` → global `'Aprovado'`. Este módulo não depende do banco de dados nem de chamadas externas.
**Arquivos Afetados**:
- `src/testing/evaluator.ts` *(novo)*
- `src/testing/types.ts` *(atualizado com tipos `CriterionResult`, `EvaluationResult`)*
**Critério de Aceite Técnico**: `evaluateArtifact` retorna `overallResult: 'Reprovado'` quando qualquer eixo individual for `'Reprovado'`; retorna `'Aprovado'` quando todos os eixos forem `'Aprovado'`; sem dependências de runtime externas (sem imports de `db`, `jira` ou `anthropic`).
**Estimativa**: M — 2–4h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-03 — Criar Módulo de Coleta e Persistência de Evidências
**Descrição**: Implementar `src/testing/evidence-collector.ts` com a função `collectEvidence(scenario: TestScenario, artifactContent: string, evaluationResult: EvaluationResult, agentRunId: string): Evidence`. A evidência deve capturar: `scenarioId`, `agentType`, `artifactType`, `artifactContent` (truncado a 10.000 chars para storage), `evaluationResult`, `agentRunId`, `collectedAt` (ISO timestamp) e `durationMs`. Implementar também `saveEvidence(evidence: Evidence, db: DrizzleDb): Promise<string>` que persiste o artefato na tabela `artifacts` existente (campo `content` + `artifact_type` + `file_path` como `SCRUM-13/evidence/<scenarioId>.json`) e retorna o `artifact.id` gerado. Usar o tipo `ArtifactType = 'test_report'` já existente no schema para as evidências.
**Arquivos Afetados**:
- `src/testing/evidence-collector.ts` *(novo)*
- `src/testing/types.ts` *(atualizado com tipo `Evidence`)*
**Critério de Aceite Técnico**: `saveEvidence` insere uma linha na tabela `artifacts` com `artifact_type = 'test_report'`, `file_path` no padrão `SCRUM-13/evidence/<scenarioId>.json` e retorna um UUID válido; `collectEvidence` não realiza chamadas de rede.
**Estimativa**: M — 2–4h
**Dependências**: TASK-01
**Paralelizável**: Sim

---

### TASK-04 — Implementar Executor de Cenários sobre o Pipeline de Agentes
**Descrição**: Implementar `src/testing/scenario-runner.ts` com a função assíncrona `runScenario(scenario: TestScenario, deps: RunnerDeps): Promise<ScenarioRunResult>`. O runner deve: (1) invocar o agente correto (`po`, `lt`, `dev` ou `qa`) via os workers BullMQ já existentes, publicando um job na fila `agent-runner` com o payload do cenário; (2) aguardar a conclusão do `agentRun` via polling na tabela `agent_runs` (status `completed` ou `failed`) com timeout configurável (padrão 120s, intervalo de polling 3s); (3) recuperar o conteúdo do artefato gerado via `src/github/client.ts`; (4) chamar `evaluateArtifact` do TASK-02 sobre o conteúdo recuperado; (5) retornar `ScenarioRunResult` com campos: `scenarioId`, `agentRunId`, `artifactContent`, `evaluationResult`, `durationMs`, `status: 'success' | 'timeout' | 'agent_error'`. Implementar também `runAllScenarios(scenarios: TestScenario[], deps: RunnerDeps): Promise<ScenarioRunResult[]>` que executa os cenários sequencialmente e acumula os resultados. O nome da fila BullMQ para despachar jobs ao agente deve seguir o padrão kebab-case: ex. `'po-agent'`, `'lt-agent'`, `'dev-agent'`, `'qa-agent'`.
**Arquivos Afetados**:
- `src/testing/scenario-runner.ts` *(novo)*
- `src/testing/types.ts` *(atualizado com tipos `RunnerDeps`, `ScenarioRunResult`)*
- `src/queue/index.ts` *(leitura das filas existentes — sem modificação)*
**Critério de Aceite Técnico**: `runScenario` retorna `status: 'timeout'` quando o `agentRun` não transitar para `completed` dentro do timeout; retorna `status: 'success'` com `evaluationResult` preenchido quando o agente conclui com sucesso; `runAllScenarios` retorna array com `TEST_SCENARIOS.length` entradas.
**Estimativa**: G — 4–8h
**Dependências**: TASK-01, TASK-02
**Paralelizável**: Não

---

### TASK-05 — Implementar Consolidação de Métricas de Desempenho por Cenário
**Descrição**: Implementar `src/testing/metrics.ts` com a função `consolidateMetrics(results: ScenarioRunResult[]): TestMetrics`. O objeto `TestMetrics` deve conter: `totalScenarios`, `executed` (status não `timeout`), `succeeded` (status `success`), `failed` (status `agent_error`), `timedOut` (status `timeout`), `approvalRate` (% de `overallResult` `'Aprovado'` ou `'Aprovado com ressalvas'` sobre os executados), `avgDurationMs`, `minDurationMs`, `maxDurationMs` e `byAgent: Record<AgentType, { count: number; avgDurationMs: number; approvalRate: number }>`. Sem dependências de banco ou de rede — função pura sobre o array de resultados.
**Arquivos Afetados**:
- `src/testing/metrics.ts` *(novo)*
- `src/testing/types.ts` *(atualizado com tipo `TestMetrics`)*
**Critério de Aceite Técnico**: Dado um array de 4 `ScenarioRunResult` com `durationMs` conhecidos, `consolidateMetrics` retorna `avgDurationMs` correto (média aritmética), `approvalRate` correto e `byAgent` com entradas para cada `agentType` presente nos resultados; função pura sem side-effects.
**Estimativa**: M — 2–4h
**Dependências**: TASK-04
**Paralelizável**: Não

---

### TASK-06 — Implementar Gerador do Relatório Estruturado de Teste
**Descrição**: Implementar `src/testing/report-generator.ts` com a função `generateReport(results: ScenarioRunResult[], metrics: TestMetrics, deviations: Deviation[]): TestReport` e `renderReportMarkdown(report: TestReport): string`. O relatório markdown deve seguir estrutura fixa com as seções: `## Identificação` (jiraKey, data, versão), `## Resumo Executivo` (métricas globais + `approvalRate`), `## Cenários Executados` (tabela com scenarioId, agente, resultado global, duração), `## Avaliação por Critério` (tabela detalhada por eixo para cada cenário), `## Desvios Encontrados` (tabela com id, tipo, descrição, severidade) e `## Conclusão`. O arquivo deve ser salvo como `SCRUM-13/RELATORIO_TESTE_FASE2.md` no branch `prd/scrum-13` via `src/github/client.ts`.
**Arquivos Afetados**:
- `src/testing/report-generator.ts` *(novo)*
- `src/testing/types.ts` *(atualizado com tipos `TestReport`, `Deviation`)*
**Critério de Aceite Técnico**: `renderReportMarkdown` retorna string contendo exatamente as 6 seções `##` listadas; `generateReport` monta `TestReport` com `approvalRate` igual ao valor de `metrics.approvalRate`; o arquivo commitado no branch `prd/scrum-13` é legível via `read_github_file`.
**Estimativa**: M — 2–4h
**Dependências**: TASK-04, TASK-05
**Paralelizável**: Não

---

### TASK-07 — Vincular Relatório e Artefatos à Issue SCRUM-13 no Jira
**Descrição**: Implementar `src/testing/jira-linker.ts` com a função `linkResultsToJira(report: TestReport, reportGithubUrl: string, artifactIds: string[], jiraClient: JiraClient): Promise<void>`. A função deve: (1) postar um comentário estruturado na issue SCRUM-13 via `jiraClient.addComment` contendo o link direto para `SCRUM-13/RELATORIO_TESTE_FASE2.md` no GitHub, a taxa de aprovação global, o número de cenários executados e a lista de desvios críticos (severidade `high`); (2) adicionar um remote link na issue apontando para o arquivo no GitHub usando `jiraClient.addRemoteLink` com title `"Relatório Teste #1 — Fase 2"`. Usar o `src/jira/client.ts` existente sem modificá-lo.
**Arquivos Afetados**:
- `src/testing/jira-linker.ts` *(novo)*
**Critério de Aceite Técnico**: Após execução, a issue SCRUM-13 no Jira contém um comentário com o link para o relatório no GitHub e `approvalRate` em percentual; o remote link aparece na aba "Vincular" da issue; função lança `Error` se `jiraClient.addComment` rejeitar.
**Estimativa**: P — < 2h
**Dependências**: TASK-06
**Paralelizável**: Não

---

### TASK-08 — Implementar Categorização e Registro de Desvios e Falhas
**Descrição**: Implementar `src/testing/deviation-tracker.ts` com a função `trackDeviation(result: ScenarioRunResult, source: 'evaluator' | 'runner'): Deviation | null`. A função deve inspecionar `result` e retornar um `Deviation` quando: (a) `result.evaluationResult.overallResult === 'Reprovado'`; (b) `result.status === 'timeout'`; ou (c) `result.status === 'agent_error'`. O tipo `Deviation` deve conter: `id` (gerado como `DEV-<scenarioId>-<sequência>`), `scenarioId`, `agentType`, `deviationType: 'qualidade_artefato' | 'comportamento_agente' | 'falha_integracao' | 'outro'`, `description: string`, `severity: 'low' | 'medium' | 'high'`. Implementar também `collectAllDeviations(results: ScenarioRunResult[]): Deviation[]` que filtra e mapeia resultados com desvios. Função pura, sem dependências externas.
**Arquivos Afetados**:
- `src/testing/deviation-tracker.ts` *(novo)*
- `src/testing/types.ts` *(atualizado com tipo `Deviation` completo)*
**Critério de Aceite Técnico**: `trackDeviation` retorna `null` para resultado `status: 'success'` com `overallResult: 'Aprovado'`; retorna `Deviation` com `deviationType: 'comportamento_agente'` e `severity: 'high'` para `status: 'timeout'`; `collectAllDeviations` retorna apenas entradas não-nulas.
**Estimativa**: M — 2–4h
**Dependências**: TASK-04
**Paralelizável**: Sim

---

### TASK-09 — Persistir Runs e Artefatos do Ciclo de Teste no Schema Existente
**Descrição**: Implementar `src/testing/test-run-persister.ts` com a função `persistTestRun(results: ScenarioRunResult[], metrics: TestMetrics, reportPath: string, db: DrizzleDb): Promise<PersistenceReceipt>`. A função deve: (1) inserir uma linha em `agent_runs` por resultado de cenário, com `agent_type = 'orchestrator'`, `status = 'completed' | 'failed'`, `input` com o payload do cenário (jsonb), `output` com o `evaluationResult` (jsonb), `duration_ms`, `started_at` e `completed_at`; (2) inserir uma linha em `artifacts` para o relatório final com `artifact_type = 'test_report'`, `file_path = 'SCRUM-13/RELATORIO_TESTE_FASE2.md'` e `github_commit_sha` quando disponível; (3) retornar `PersistenceReceipt` com `agentRunIds[]` e `reportArtifactId`. Reutilizar o `storyId` da história SCRUM-13, buscando-o pelo `jira_key` na tabela `stories`.
**Arquivos Afetados**:
- `src/testing/test-run-persister.ts` *(novo)*
- `src/testing/types.ts` *(atualizado com tipo `PersistenceReceipt`)*
- `src/db/schema.ts` *(somente leitura — sem alterações no schema)*
**Critério de Aceite Técnico**: Após `persistTestRun`, a tabela `agent_runs` contém N novas linhas (uma por cenário) com `story_id` correspondente à história SCRUM-13; a tabela `artifacts` contém nova linha com `artifact_type = 'test_report'` e `file_path = 'SCRUM-13/RELATORIO_TESTE_FASE2.md'`; `PersistenceReceipt.agentRunIds` tem comprimento igual a `results.length`.
**Estimativa**: M — 2–4h
**Dependências**: TASK-03, TASK-04
**Paralelizável**: Não

---

### TASK-10 — Escrever Testes Automatizados para Avaliador e Gerador de Relatório
**Descrição**: Implementar suíte de testes em `src/testing/__tests__/` cobrindo os dois módulos mais críticos e sem dependências de rede. Para `evaluator.ts`: testar os três resultados globais possíveis com fixtures de artefatos markdown válidos/inválidos/parciais; testar que cada eixo individualmente retorna o resultado esperado. Para `report-generator.ts`: testar que `renderReportMarkdown` contém as 6 seções `##` obrigatórias; testar que `approvalRate` no relatório coincide com o valor de métricas de entrada. Para `deviation-tracker.ts`: testar `trackDeviation` com os três casos de desvio e o caso sem desvio. Meta de cobertura: ≥ 80% de `statements` para os três arquivos medida via `vitest run --coverage`.
**Arquivos Afetados**:
- `src/testing/__tests__/evaluator.test.ts` *(novo)*
- `src/testing/__tests__/report-generator.test.ts` *(novo)*
- `src/testing/__tests__/deviation-tracker.test.ts` *(novo)*
**Critério de Aceite Técnico**: `npm test` passa com zero falhas; `npm run test:coverage` reporta ≥ 80% de `statements` para `evaluator.ts`, `report-generator.ts` e `deviation-tracker.ts`; nenhum teste usa mocks de rede real (todos os mocks são in-memory).
**Estimativa**: M — 2–4h
**Dependências**: TASK-02, TASK-06
**Paralelizável**: Não

---

## Ordem de Execução

Ondas de execução paralela:

```
Onda 1 (paralelo): TASK-01, TASK-02
Onda 2 (paralelo): TASK-03, TASK-04
Onda 3 (paralelo): TASK-05, TASK-08
Onda 4 (sequencial): TASK-09
Onda 5 (sequencial): TASK-06
Onda 6 (sequencial): TASK-07
Onda 7 (sequencial): TASK-10
```

## Estimativa Total
- Tasks P (< 2h): 1 task — TASK-07
- Tasks M (2–4h): 7 tasks — TASK-01, TASK-02, TASK-03, TASK-05, TASK-06, TASK-08, TASK-09, TASK-10
- Tasks G (4–8h): 1 task — TASK-04

> ⚠️ Correção de contagem: Tasks M somam 8 (TASK-01, TASK-02, TASK-03, TASK-05, TASK-06, TASK-08, TASK-09, TASK-10), não 7. Recontagem final:

- Tasks P (< 2h): 1 task — TASK-07
- Tasks M (2–4h): 8 tasks — TASK-01, TASK-02, TASK-03, TASK-05, TASK-06, TASK-08, TASK-09, TASK-10
- Tasks G (4–8h): 1 task — TASK-04
- **Estimativa total**: 20–42 horas (1P: até 2h + 8M: 16–32h + 1G: 4–8h)

## Referências
- PRD: SCRUM-13/PRD.md
- Jira: SCRUM-13