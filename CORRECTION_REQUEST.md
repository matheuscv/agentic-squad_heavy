# Pedido de Correção — Iteração 1/3
## Problema detectado
O CI está falhando (conclusion: 'failure') no branch agent/task-scrum-16. A causa raiz provável são asserções de locale frágeis no arquivo `src/utils/currency-extended.test.ts`, que verificam strings formatadas específicas de locale (como 'R$', ',99', '0,00', '9,999.99', '0.00', ',50', '€') usando `toContain()`. Em ambientes de CI, o locale do sistema pode diferir do esperado (pt-BR, en-US, de-DE), causando falhas nas asserções de formatação exata. 

As asserções problemáticas incluem:
- `expect(result).toContain('R$')` — símbolo pode incluir espaço não-breaking
- `expect(result).toContain(',99')` — depende do locale pt-BR estar ativo no sistema
- `expect(result).toContain('0,00')` — idem
- `expect(result).toContain('9,999.99')` — depende do locale en-US
- `expect(result).toContain('0.00')` — idem
- `expect(result).toContain(',50')` — depende do locale de-DE

A correção deve:
1. Substituir asserções de string exatas por verificações mais robustas usando regex ou verificar apenas o tipo de retorno (string não-vazia)
2. Alternativamente, usar `Intl.NumberFormat` no próprio teste para gerar o valor esperado dinamicamente
3. Garantir que os testes não dependam do locale do sistema operacional do CI
4. Manter a semântica dos testes (validar que BRL/USD/EUR são formatados corretamente)
## Arquivos com problemas
- `src/utils/currency-extended.test.ts`
## Testes falhando
- formatCurrency — cobertura estendida > BRL — Real Brasileiro (locale pt-BR) > formata valor com centavos
- formatCurrency — cobertura estendida > BRL — Real Brasileiro (locale pt-BR) > formata valor zero
- formatCurrency — cobertura estendida > USD — Dólar Americano (locale en-US) > formata valor positivo simples
- formatCurrency — cobertura estendida > USD — Dólar Americano (locale en-US) > formata valor zero
- formatCurrency — cobertura estendida > USD — Dólar Americano (locale en-US) > formata valor pequeno fracional
- formatCurrency — cobertura estendida > EUR — Euro (locale de-DE) > formata valor zero
- formatCurrency — cobertura estendida > EUR — Euro (locale de-DE) > usa vírgula como separador decimal (locale de-DE)
## Cobertura insuficiente
```json
{
  "src/utils/currency.ts": {
    "statements": 80.07,
    "branches": 75.76,
    "lines": 80.07
  }
}
```
---
_Gerado pelo Agente QA em 2026-05-26T21:02:35.831Z_