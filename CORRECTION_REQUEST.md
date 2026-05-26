# Pedido de Correção — Iteração 1/3
## Problema detectado
O CI está falhando no branch agent/task-scrum-16 (run #26459561776). A causa raiz é que a cobertura geral do projeto está criticamente baixa: statements 46.17%, functions 54.83%, branches 64.33%, lines 46.17% — muito abaixo do mínimo de 85% exigido. O módulo implementado `src/utils/currency.ts` já possui arquivo de teste `src/utils/currency.test.ts`, mas o conjunto de testes da suíte completa não é suficiente para cobrir os demais módulos do projeto (agents, api, db, github, jira, lib, orchestrator, queue, webhooks). É preciso que o CI passe com cobertura ≥ 85% em todas as métricas (statements, branches, functions, lines). Verifique se há configuração de threshold no vitest/jest que está fazendo o CI falhar devido à baixa cobertura, e certifique-se de que os thresholds estão corretamente configurados ou que os testes existentes cubram os módulos principais. Além disso, verifique se o arquivo `src/utils/currency.test.ts` está correto e sem erros de sintaxe (o arquivo foi truncado na leitura, o que pode indicar problemas).
## Arquivos com problemas
- `src/utils/currency.ts`
- `src/utils/currency.test.ts`
- `src/tests/integration/dev-agent.integration.test.ts`
- `src/tests/integration/orchestrator.integration.test.ts`
- `src/tests/integration/qa-correction-loop.integration.test.ts`
## Cobertura insuficiente
```json
{
  "src/utils/currency.ts": {
    "statements": 46.17,
    "branches": 64.33,
    "functions": 54.83,
    "lines": 46.17
  }
}
```
---
_Gerado pelo Agente QA em 2026-05-26T16:14:29.747Z_