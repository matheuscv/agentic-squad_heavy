# Plano de Execução — SCRUM-16: Adicionar função utilitária formatCurrency(value, currency) ao módulo src/utils/currency.ts

## Identificação
- **Jira Key**: SCRUM-16
- **Resumo**: Adicionar função utilitária `formatCurrency(value, currency)` ao módulo `src/utils/currency.ts`
- **Versão**: 1.0
- **Autor**: Agente LT (IA)
- **Data**: 2026-05-26

## Stack Detectada
- **Runtime**: Node.js 22 / TypeScript 5
- **Framework**: Express 4 (4.21.2)
- **Banco de Dados**: PostgreSQL (Supabase) via Drizzle ORM
- **Fila**: BullMQ / Redis (Upstash)
- **Testes**: Vitest 3 + @vitest/coverage-v8

## Visão Geral

| ID | Descrição resumida | Estimativa | Dependências | Paralelo |
|----|--------------------|------------|--------------|---------|
| TASK-01 | Criar tipo `CurrencyCode` e mapa de locale por moeda | P | — | Sim |
| TASK-02 | Implementar `formatCurrency` com `Intl.NumberFormat` e tratamento de erro | P | TASK-01 | Não |
| TASK-03 | Escrever suite de testes unitários em Vitest com cobertura ≥ 90% | M | TASK-02 | Não |

## Tasks Detalhadas

### TASK-01 — Criar tipo `CurrencyCode` e mapa de locale por moeda
**Descrição**: Criar o arquivo `src/utils/currency.ts` com o scaffolding de tipos. Definir o union type exportado `CurrencyCode` cobrindo ao menos `'BRL' | 'USD' | 'EUR'`. Definir internamente um mapa `CURRENCY_LOCALE_MAP: Record<CurrencyCode, string>` associando cada código ao locale correto (`'pt-BR'`, `'en-US'`, `'de-DE'`). Não implementar a função ainda — apenas as definições de tipo e o mapa, garantindo que o compilador TypeScript em modo `strict` valide os tipos em todas as tasks subsequentes.

**Arquivos Afetados**:
- `src/utils/currency.ts` *(novo)*

**Critério de Aceite Técnico**: `npx tsc --noEmit` não reporta erros; `CurrencyCode` é importável por outro módulo e aceita exatamente `'BRL'`, `'USD'` e `'EUR'` — qualquer outro literal de string causa erro de compilação.
**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-02 — Implementar `formatCurrency` com `Intl.NumberFormat` e tratamento de erro
**Descrição**: No mesmo arquivo `src/utils/currency.ts`, implementar e exportar nominalmente a função `formatCurrency(value: number, currency: CurrencyCode): string`. A função deve: (1) verificar se `currency` é uma chave válida de `CURRENCY_LOCALE_MAP`; caso contrário, lançar `new Error(\`Moeda inválida: ${currency}\`)`; (2) instanciar `Intl.NumberFormat(locale, { style: 'currency', currency })` e retornar `format(value)`. Adicionar bloco JSDoc com `@param`, `@returns` e `@throws` conforme requisitado no PRD (risco R-02).

**Arquivos Afetados**:
- `src/utils/currency.ts`

**Critério de Aceite Técnico**: Chamadas manuais via `tsx` no REPL confirmam: `formatCurrency(1234.5, 'BRL')` → `"R$ 1.234,50"`; `formatCurrency(9999.99, 'USD')` → `"$9,999.99"`; `formatCurrency(-500, 'EUR')` → string negativa no formato europeu; `formatCurrency(0, 'BRL')` → `"R$ 0,00"`; `formatCurrency(100, 'XYZ' as any)` → lança `Error` com mensagem contendo `"XYZ"`.
**Estimativa**: P — < 2h
**Dependências**: TASK-01
**Paralelizável**: Não

---

### TASK-03 — Escrever suite de testes unitários em Vitest com cobertura ≥ 90%
**Descrição**: Criar o arquivo `src/utils/currency.test.ts` com suite completa de testes unitários usando Vitest. Cobrir os seguintes casos: (a) `formatCurrency(1234.5, 'BRL')` retorna string contendo símbolo `R$`, separador decimal `,` e separador de milhar `.`; (b) `formatCurrency(9999.99, 'USD')` retorna string contendo `$`, sem arredondamento; (c) `formatCurrency(-500, 'EUR')` retorna string com indicação negativa e símbolo `€`; (d) `formatCurrency(0, 'BRL')` retorna string terminando em `,00` sem lançar erro; (e) `formatCurrency(1234.5678, 'USD')` verifica arredondamento para 2 casas decimais; (f) `formatCurrency(100, 'XYZ' as any)` lança `Error` com mensagem `"Moeda inválida: XYZ"`. Seguindo a mitigação do risco R-01 do PRD, os testes devem validar a estrutura da string (ex.: `.toContain`, `.toMatch` com regex) em vez de igualdade literal exata, tornando-os robustos a variações de ambiente.

**Arquivos Afetados**:
- `src/utils/currency.test.ts` *(novo)*

**Critério de Aceite Técnico**: `npm run test:coverage` passa com 0 falhas e o relatório v8 aponta ≥ 90% de statements e ≥ 90% de branches cobertos especificamente para `src/utils/currency.ts`.
**Estimativa**: M — 2–4h
**Dependências**: TASK-02
**Paralelizável**: Não

---

## Ordem de Execução

Ondas de execução paralela:

```
Onda 1 (sequencial): TASK-01
Onda 2 (sequencial): TASK-02
Onda 3 (sequencial): TASK-03
```

## Estimativa Total
- Tasks P (< 2h): 2 tasks
- Tasks M (2–4h): 1 task
- Tasks G (4–8h): 0 tasks
- **Estimativa total**: 4–8 horas

## Referências
- PRD: SCRUM-16/PRD.md
- Jira: SCRUM-16