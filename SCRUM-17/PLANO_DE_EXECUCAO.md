# Plano de Execução — SCRUM-17: Adicionar função utilitária formatCurrency ao módulo src/utils/currency.ts

## Identificação
- **Jira Key**: SCRUM-17
- **Resumo**: Adicionar função utilitária `formatCurrency` ao módulo `src/utils/currency.ts`
- **Versão**: 1.0
- **Autor**: Agente LT (IA)
- **Data**: 2026-05-27

## Stack Detectada
- **Runtime**: Node.js 22 / TypeScript 5
- **Framework**: Express 4
- **Banco de Dados**: PostgreSQL (Supabase) via Drizzle ORM
- **Fila**: BullMQ / Redis (Upstash)
- **Testes**: Vitest 3 + @vitest/coverage-v8

## Visão Geral

| ID | Descrição resumida | Estimativa | Dependências | Paralelo |
|----|--------------------|------------|--------------|---------|
| TASK-01 | Implementar `src/utils/currency.ts` com `formatCurrency` | M | — | Sim |
| TASK-02 | Escrever testes unitários para `currency.ts` com 100% de cobertura | M | TASK-01 | Não |
| TASK-03 | Verificar compilação TypeScript e conformidade de lint/format | P | TASK-01 | Não |

## Tasks Detalhadas

### TASK-01 — Implementar src/utils/currency.ts com formatCurrency
**Descrição**: Criar o arquivo `src/utils/currency.ts` com a função `formatCurrency(value: number, currency: string, locale: string, fractionDigits?: number): string` exportada nominalmente. A implementação deve:
- Validar que `value` não é `NaN`, `Infinity` ou `-Infinity`, lançando `TypeError` com mensagem descritiva antes de qualquer formatação (ex.: `"Invalid value: NaN is not a finite number"`).
- Validar que `locale` e `currency` são strings não-vazias; caso contrário lançar `RangeError` com mensagem clara (ex.: `"Invalid locale: '' is not a valid BCP 47 locale"`).
- Utilizar `Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: fractionDigits ?? 2, maximumFractionDigits: fractionDigits ?? 2 }).format(value)` para a formatação efetiva.
- Suportar obrigatoriamente BRL/pt-BR (`R$ 1.234,56`), USD/en-US (`$1,234.56`) e EUR/de-DE (`1.234,56 €`).
- Ter o parâmetro `fractionDigits` com default `2`, aceitando qualquer número ≥ 0.
- Incluir documentação JSDoc completa com `@param`, `@returns`, `@throws` (TypeError e RangeError) e `@example` para cada combinação obrigatória de moeda/locale e para o caso de `fractionDigits` customizado.
- Ser totalmente tipado em TypeScript 5 strict, sem uso de `any`.

**Arquivos Afetados**:
- `src/utils/currency.ts` *(criação)*

**Critério de Aceite Técnico**:
- `formatCurrency(1234.56, 'BRL', 'pt-BR')` retorna string contendo `1.234,56` e o símbolo `R$`.
- `formatCurrency(1234.56, 'USD', 'en-US')` retorna `'$1,234.56'`.
- `formatCurrency(1000, 'USD', 'en-US')` retorna `'$1,000.00'` (default `fractionDigits=2`).
- `formatCurrency(1234.56, 'USD', 'en-US', 0)` retorna `'$1,235'`.
- `formatCurrency(NaN, 'USD', 'en-US')` lança `TypeError`.
- `formatCurrency(Infinity, 'USD', 'en-US')` lança `TypeError`.
- `tsc --noEmit` (`npm run typecheck`) encerra com código 0 após a criação do arquivo.

**Estimativa**: M — 2–4h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-02 — Escrever testes unitários com 100% de cobertura para currency.ts
**Descrição**: Criar o arquivo de testes `src/utils/currency.test.ts` cobrindo todos os branches e linhas do módulo `src/utils/currency.ts`. Os casos de teste devem incluir:
1. **Valores positivos** — `formatCurrency(1234.56, 'USD', 'en-US')` → verifica retorno com `toContain('1,234.56')`.
2. **Valor zero** — `formatCurrency(0, 'USD', 'en-US')` → verifica retorno com `toContain('0.00')`.
3. **Valor negativo** — `formatCurrency(-99.9, 'USD', 'en-US')` → verifica que o retorno contém `99.9` e sinal negativo.
4. **Combinação BRL/pt-BR** — `formatCurrency(1234.56, 'BRL', 'pt-BR')` → `toContain('1.234,56')` e `toContain('R$')`.
5. **Combinação EUR/de-DE** — `formatCurrency(1234.56, 'EUR', 'de-DE')` → `toContain('1.234,56')` e `toContain('€')`.
6. **fractionDigits customizado (0)** — `formatCurrency(1234.56, 'USD', 'en-US', 0)` → `toBe('$1,235')`.
7. **fractionDigits customizado (4)** — `formatCurrency(1.5, 'USD', 'en-US', 4)` → `toContain('1.5000')`.
8. **NaN lança TypeError** — `expect(() => formatCurrency(NaN, 'USD', 'en-US')).toThrow(TypeError)`.
9. **Infinity lança TypeError** — `expect(() => formatCurrency(Infinity, 'USD', 'en-US')).toThrow(TypeError)`.
10. **-Infinity lança TypeError** — `expect(() => formatCurrency(-Infinity, 'USD', 'en-US')).toThrow(TypeError)`.
11. **Locale vazio lança RangeError** — `expect(() => formatCurrency(1, 'USD', '')).toThrow(RangeError)`.
12. **Currency vazia lança RangeError** — `expect(() => formatCurrency(1, '', 'en-US')).toThrow(RangeError)`.

Usar `toContain` em vez de `toBe` para strings com potencial variação de caracteres Unicode (espaço narrow `\u00a0`) em ambientes de CI — exceto nos casos em que o output é determinístico (ex.: `fractionDigits=0`). Usar `toThrow` com a classe do erro (não string), conforme RF-04 e RF-05 do PRD.

**Arquivos Afetados**:
- `src/utils/currency.test.ts` *(criação)*

**Critério de Aceite Técnico**:
- `npm run test:coverage` executa sem falhas e o relatório v8 para `src/utils/currency.ts` exibe **100%** em `lines`, `functions` e `branches`.
- Todos os 12 casos de teste passam em `vitest run`.

**Estimativa**: M — 2–4h
**Dependências**: TASK-01
**Paralelizável**: Não

---

### TASK-03 — Verificar compilação TypeScript e conformidade de lint/format
**Descrição**: Executar e corrigir (se necessário) os checks de qualidade estática do projeto para os arquivos criados nas tasks anteriores. As etapas são:
1. Rodar `npm run typecheck` (`tsc --noEmit`) e resolver qualquer erro de tipos nos novos arquivos.
2. Rodar `npm run lint` (`eslint src --ext .ts`) e corrigir warnings/errors reportados em `currency.ts` e `currency.test.ts`.
3. Rodar `npm run format:check` (`prettier --check`) e aplicar `npm run format` se necessário para conformidade de estilo.
4. Confirmar que `npm run build` (`tsc`) também encerra com código 0, garantindo que o módulo está incluso no build de produção em `dist/`.

**Arquivos Afetados**:
- `src/utils/currency.ts`
- `src/utils/currency.test.ts`

**Critério de Aceite Técnico**:
- `npm run typecheck` encerra com código 0 e zero erros.
- `npm run lint` encerra com código 0 e zero erros/warnings nos arquivos `currency.ts` e `currency.test.ts`.
- `npm run format:check` encerra com código 0 (sem diferenças de formatação).
- `npm run build` encerra com código 0 e `dist/utils/currency.js` é gerado.

**Estimativa**: P — < 2h
**Dependências**: TASK-01
**Paralelizável**: Não

---

## Ordem de Execução

Ondas de execução paralela:

```
Onda 1 (sequencial): TASK-01
Onda 2 (paralelo):   TASK-02, TASK-03
```

## Estimativa Total
- Tasks P (< 2h): 1 task → TASK-03
- Tasks M (2–4h): 2 tasks → TASK-01, TASK-02
- Tasks G (4–8h): 0 tasks
- **Estimativa total**: 6–10 horas

## Referências
- PRD: SCRUM-17/PRD.md
- Jira: SCRUM-17