# Pedido de Correção — Iteração 1/3
## Problema detectado
O CI no branch `agent/task-scrum-16` está falhando (`conclusion: 'failure'`) após a implementação da função `formatCurrency()` em `src/utils/currency.ts`. Não há dados de cobertura disponíveis, o que indica que a suite de testes falha antes de completar a execução.

**Possíveis causas identificadas:**
1. Erro de TypeScript/compilação em `src/utils/currency.ts` ou `src/utils/currency.test.ts` — verificar tipos e imports
2. Testes de integração em `src/tests/integration/` podem estar quebrando devido a mudanças de contexto ou imports adicionados
3. O `vitest.config.ts` define thresholds de cobertura para `src/orchestrator/state-machine.ts` (mínimo 80%), o que pode causar falha se algum arquivo novo não estiver sendo incluído corretamente
4. Possível falha de lint ou typecheck no pipeline CI

**O que precisa ser investigado e corrigido:**
- Verificar se `src/utils/currency.ts` compila corretamente sem erros TypeScript
- Verificar se `src/utils/currency.test.ts` está sintaticamente correto e os imports estão resolvendo
- Garantir que os testes unitários em `currency.test.ts` passam corretamente (checar asserções de formato de moeda que dependem de `Intl.NumberFormat` e locale do ambiente de CI)
- Verificar se o ambiente CI tem suporte adequado aos locales `pt-BR`, `en-US` e `de-DE` para `Intl.NumberFormat`
- Garantir que nenhum teste de integração pré-existente foi quebrado pela adição do novo módulo
## Arquivos com problemas
- `src/utils/currency.ts`
- `src/utils/currency.test.ts`
## Testes falhando
- formatCurrency — todos os testes unitários (CI falha sem dados de cobertura)
---
_Gerado pelo Agente QA em 2026-05-26T14:00:16.532Z_