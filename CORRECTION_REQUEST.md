# Pedido de Correção — Iteração 1/3
## Problema detectado
O CI está falhando no branch agent/task-scrum-16 (run #26460479470, conclusion: failure). A cobertura está criticamente abaixo de 85%: statements 46.17%, lines 46.17%, functions 54.83%, branches 64.33%.

A implementação do módulo `src/utils/currency.ts` (formatCurrency) parece correta e possui testes unitários em `src/utils/currency.test.ts`. Entretanto, o CI falhou — é necessário investigar e corrigir a causa raiz da falha. Possíveis problemas:
1. Erro de compilação TypeScript (tipo CurrencyCode sendo usado de forma incorreta, ou importação com problema)
2. Falha de build ou de configuração do Vitest
3. Algum teste existente nos arquivos de integração (dev-agent.integration.test.ts, orchestrator.integration.test.ts, qa-correction-loop.integration.test.ts) quebrou por incompatibilidade com o código novo
4. O arquivo `src/utils/currency.ts` pode conter um erro que faz o branch de validação `!(currency in CURRENCY_LOCALE_MAP)` nunca ser atingido com TypeScript strict (pois o tipo CurrencyCode já garante que apenas valores válidos são aceitos, mas o branch guard throw nunca é executado nos testes)

Por favor, verifique e corrija a causa raiz da falha do CI. Garanta que todos os testes passem e que o módulo currency.ts esteja corretamente implementado.
## Arquivos com problemas
- `src/utils/currency.ts`
- `src/utils/currency.test.ts`
## Testes falhando
- src/utils/currency.test.ts
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
_Gerado pelo Agente QA em 2026-05-26T17:27:56.207Z_