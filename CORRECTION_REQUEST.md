# Pedido de Correção — Iteração 1/3
## Problema detectado
O CI do branch `agent/task-scrum-16` está falhando (conclusion: 'failure') com cobertura global muito abaixo do mínimo de 85%. As métricas atuais são: statements 46.17%, branches 64.33%, functions 54.83%, lines 46.17%.

O arquivo `src/utils/currency.test.ts` utiliza `vi.spyOn(globalThis, 'Intl', 'get')` para mockar o `Intl.NumberFormat`. Esta abordagem pode estar causando erros no CI, pois `Intl` pode não ser uma propriedade configurável do objeto global em todos os ambientes Node.js, especialmente na versão que roda no CI. Além disso, o fallback dentro de `mockFormat` chama `new Intl.NumberFormat(...)` com o próprio Intl já mockado, o que pode causar recursão infinita ou erros.

As correções necessárias são:
1. Reescrever o arquivo `src/utils/currency.test.ts` para remover o uso de `vi.spyOn(globalThis, 'Intl', 'get')`. Em vez disso, usar uma abordagem mais simples e estável: testar os resultados reais do `Intl.NumberFormat` ou usar `vi.stubGlobal` de forma mais segura.
2. A melhor abordagem é testar a função com valores reais (sem mock do Intl) usando assertions flexíveis que verificam presença de símbolo de moeda e valores numéricos, sem depender de formatação exacta de locale — já que isso varia entre ambientes.
3. Garantir que o módulo `src/utils/currency.ts` esteja corretamente implementado e que os testes cubram: caminho feliz para BRL, USD e EUR; valor zero; valor negativo; erro para moeda inválida; arredondamento de decimais.
## Arquivos com problemas
- `src/utils/currency.test.ts`
## Testes falhando
- currency.test.ts — mock de Intl via vi.spyOn(globalThis, 'Intl', 'get') instável no CI
## Cobertura insuficiente
```json
{
  "src/utils/currency.ts": {
    "statements": 46.17,
    "branches": 64.33,
    "functions": 54.83,
    "lines": 46.17
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
_Gerado pelo Agente QA em 2026-05-26T15:54:32.554Z_