# Pedido de Correção — Iteração 2/3
## Problema detectado
CAUSA RAIZ CONFIRMADA: O CI falha com erro de compilação TypeScript porque `src/tests/integration/qa-correction-loop.integration.test.ts` importa 5 símbolos que NÃO EXISTEM em `src/tests/integration/fixtures.ts`:
- `QA_HAPPY_PATH_SEQUENCE` — sequência Claude para o Agente QA no caminho feliz (CI passa com ≥ 85% de cobertura)
- `QA_ONE_CORRECTION_SEQUENCE` — sequência Claude para o Agente QA com 1 ciclo de correção
- `QA_ESCALATION_SEQUENCE` — sequência Claude para o Agente QA com 3 ciclos de correção (escalação)
- `COVERAGE_OK` — objeto de cobertura com todas as 4 métricas ≥ 85% (para mocking de get_workflow_run_result)
- `COVERAGE_LOW` — objeto de cobertura com métricas abaixo de 85% (para mocking de get_workflow_run_result)

O arquivo `fixtures.ts` só possui `SCRUM_50`, `SCRUM_51`, `SCRUM_50_DEV_SEQUENCE`, `SCRUM_51_DEV_CORRECTION_SEQUENCE`, `makeToolUseMsg()` e `makeEndTurnMsg()`. Os 5 símbolos QA precisam ser adicionados a `fixtures.ts`.

Baseando-se na estrutura existente em `fixtures.ts`:
- `COVERAGE_OK` deve ser um objeto como: `{ total: { statements: { pct: 90 }, branches: { pct: 90 }, functions: { pct: 90 }, lines: { pct: 90 } } }`
- `COVERAGE_LOW` deve ser um objeto como: `{ total: { statements: { pct: 50 }, branches: { pct: 60 }, functions: { pct: 55 }, lines: { pct: 50 } } }`
- As 3 sequências QA devem usar `makeToolUseMsg()` para simular as ferramentas que o Agente QA chama (get_workflow_run_result, list_github_directory, read_github_file, write_github_file, create_github_commit, wait_for_ci, create_correction_request, wait_for_dev_correction, escalate_to_human, finish_qa_review)

AÇÃO NECESSÁRIA: Adicionar os 5 exports faltantes ao arquivo `src/tests/integration/fixtures.ts`.
## Arquivos com problemas
- `src/tests/integration/fixtures.ts`
## Testes falhando
- Agente QA — loop de correção > Cenário 1: happy path — CI passa sem correções
- Agente QA — loop de correção > Cenário 2: 1 ciclo de correção
- Agente QA — loop de correção > Cenário 3: escala para humano após 3 ciclos
## Cobertura insuficiente
```json
{
  "src/tests/integration/fixtures.ts": {
    "statements": 0,
    "branches": 0,
    "functions": 0,
    "lines": 0
  },
  "total": {
    "statements": 46.17,
    "branches": 64.33,
    "functions": 54.83,
    "lines": 46.17
  }
}
```
---
_Gerado pelo Agente QA em 2026-05-26T15:30:03.043Z_