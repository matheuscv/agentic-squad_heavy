# Pedido de Correção — Iteração 1/3
## Problema detectado
O CI está falhando (conclusion: failure) no branch agent/task-scrum-16. A causa raiz identificada é que o arquivo `src/tests/integration/qa-correction-loop.integration.test.ts` importa de `src/tests/integration/fixtures.ts` os seguintes símbolos que podem não estar exportados: `QA_HAPPY_PATH_SEQUENCE`, `QA_ONE_CORRECTION_SEQUENCE`, `QA_ESCALATION_SEQUENCE`, `COVERAGE_OK` e `COVERAGE_LOW`. Além disso, a cobertura geral está muito abaixo de 85% (statements: 46.17%, branches: 64.33%, functions: 54.83%, lines: 46.17%), indicando que o arquivo principal `src/utils/currency.ts` pode não estar sendo coberto pelos testes existentes.

Ações necessárias:
1. Verificar se `fixtures.ts` exporta todos os símbolos QA necessários (QA_HAPPY_PATH_SEQUENCE, QA_ONE_CORRECTION_SEQUENCE, QA_ESCALATION_SEQUENCE, COVERAGE_OK, COVERAGE_LOW) e adicioná-los caso estejam faltando.
2. Garantir que `src/utils/currency.ts` compila sem erros TypeScript e exporta corretamente a função `formatCurrency(value, currency)`.
3. Garantir que todos os testes existentes passam após as correções.
## Arquivos com problemas
- `src/tests/integration/fixtures.ts`
- `src/utils/currency.ts`
- `src/utils/currency.test.ts`
## Testes falhando
- Agente QA — loop de correção (qa-correction-loop.integration.test.ts)
## Cobertura insuficiente
```json
{
  "src/utils/currency.ts": {
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
_Gerado pelo Agente QA em 2026-05-26T15:26:50.483Z_