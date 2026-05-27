# Plano de Execução — SCRUM-18: Adicionar função utilitária formatDate(date, style?) ao módulo src/utils/date.ts

## Identificação
- **Jira Key**: SCRUM-18
- **Resumo**: Adicionar função utilitária `formatDate(date, style?)` ao módulo `src/utils/date.ts`
- **Versão**: 1.0
- **Autor**: Agente LT (IA)
- **Data**: 2026-05-27

## Stack Detectada
- **Runtime**: Node.js 22 / TypeScript 5
- **Framework**: Express 4 (irrelevante para esta história — utilitário puro)
- **Banco de Dados**: PostgreSQL via Drizzle ORM (irrelevante para esta história)
- **Fila**: BullMQ / Redis (irrelevante para esta história)
- **Testes**: Vitest 3 + @vitest/coverage-v8

## Visão Geral

| ID | Descrição resumida | Estimativa | Dependências | Paralelo |
|----|--------------------|------------|--------------|---------|
| TASK-01 | Criar `src/utils/date.ts` com a implementação de `formatDate` | M | — | Sim |
| TASK-02 | Criar `src/utils/index.ts` com barrel export de `formatDate` | P | TASK-01 | Não |
| TASK-03 | Criar `src/utils/date.test.ts` com testes unitários (cobertura ≥ 90%) | M | TASK-01 | Não |
| TASK-04 | Criar ou atualizar `docs/GLOSSARIO.md` com os estilos de formatação | P | — | Sim |

## Tasks Detalhadas

### TASK-01 — Implementar `formatDate` em `src/utils/date.ts`
**Descrição**: Criar o arquivo `src/utils/date.ts` contendo a função `formatDate(date: Date | string | number, style?: 'short' | 'medium' | 'long'): string`. A implementação deve:
- Aceitar `Date`, `string` ISO 8601 e `number` (Unix ms) como entrada, convertendo internamente para `Date`;
- Validar o valor recebido e lançar um `TypeError` com mensagem descritiva (incluindo o valor inválido) quando a data não for parseável ou resultar em `NaN`;
- Usar `Intl.DateTimeFormat` com locale fixo `pt-BR` e a opção `dateStyle` mapeada a partir do parâmetro `style` (`short` → `'short'`, `medium` → `'medium'`, `long` → `'long'`), aplicando `medium` como padrão quando `style` for omitido;
- Ser projetada para extensibilidade: o locale deve estar em uma constante interna (`DEFAULT_LOCALE = 'pt-BR'`) de modo que um parâmetro `locale` possa ser adicionado futuramente sem quebra de contrato;
- Ser exportada como named export (`export function formatDate`);
- Incluir bloco JSDoc completo com `@param date`, `@param style`, `@returns`, `@throws TypeError` e ao menos um `@example` por estilo (`short`, `medium`, `long`), além de um `@example` documentando o lançamento de `TypeError`.

**Arquivos Afetados**:
- `src/utils/date.ts` *(criação)*

**Critério de Aceite Técnico**: `import { formatDate } from './date'` compila sem erros TypeScript (`npm run typecheck`); chamada `formatDate(new Date('2026-05-27'))` retorna uma string não vazia em `pt-BR` no estilo `medium` (ex.: `"27 de mai. de 2026"`); chamada `formatDate('nao-e-data')` lança `TypeError` com mensagem contendo `"nao-e-data"`.
**Estimativa**: M — 2–4h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-02 — Criar barrel export `src/utils/index.ts`
**Descrição**: Criar o arquivo `src/utils/index.ts` re-exportando publicamente todos os símbolos de `src/utils/date.ts` via `export * from './date'`. Este barrel centraliza o ponto de importação do módulo utilitário, permitindo que consumidores usem `import { formatDate } from '@/utils'` (ou caminho relativo equivalente) em vez de referenciar o arquivo diretamente. Caso o arquivo já exista em momento de implementação (por alteração concorrente), adicionar apenas a linha de re-export sem remover conteúdo existente.

**Arquivos Afetados**:
- `src/utils/index.ts` *(criação)*

**Critério de Aceite Técnico**: `import { formatDate } from '../utils'` (importando pelo barrel) compila sem erros TypeScript; `npm run typecheck` passa sem erros no projeto inteiro.
**Estimativa**: P — < 2h
**Dependências**: TASK-01
**Paralelizável**: Não

---

### TASK-03 — Criar testes unitários em `src/utils/date.test.ts`
**Descrição**: Criar o arquivo `src/utils/date.test.ts` com suíte Vitest cobrindo todos os comportamentos especificados no PRD. Os testes devem cobrir:
1. **Estilo padrão**: `formatDate(new Date('2026-05-27'))` sem `style` retorna string não vazia e igual ao resultado de `formatDate(new Date('2026-05-27'), 'medium')`;
2. **Três estilos distintos**: para o mesmo instante, `formatDate(date, 'short')`, `formatDate(date, 'medium')` e `formatDate(date, 'long')` retornam strings diferentes entre si;
3. **Formato `short`**: resultado contém componentes numéricos de dia, mês e ano do instante fornecido;
4. **Formato `medium`**: resultado contém abreviatura do mês em português e ano com 4 dígitos;
5. **Formato `long`**: resultado contém nome completo do mês em português e ano com 4 dígitos;
6. **Equivalência de tipos de entrada**: `formatDate(date)`, `formatDate(date.toISOString())` e `formatDate(date.getTime())` retornam a mesma string para o mesmo instante;
7. **TypeError para string inválida**: `formatDate('nao-e-data')` lança `TypeError` com mensagem incluindo o valor inválido;
8. **TypeError para NaN**: `formatDate(NaN)` lança `TypeError`.

> **Nota sobre estratégia de asserção**: conforme R-01 do PRD, os testes **não devem** fazer comparação por igualdade exata de string de saída do `Intl.DateTimeFormat`. Em vez disso, usar `.toMatch()` / `.toContain()` para verificar a presença de componentes (ex.: `"2026"`, `"maio"`, `"mai."`) e `.not.toBe()` para verificar distinção entre estilos.

**Arquivos Afetados**:
- `src/utils/date.test.ts` *(criação)*

**Critério de Aceite Técnico**: `npm test` executa a suíte sem falhas; `npm run test:coverage` reporta cobertura de linhas ≥ 90% para `src/utils/date.ts`; nenhum snapshot de string exata é usado nos testes.
**Estimativa**: M — 2–4h
**Dependências**: TASK-01
**Paralelizável**: Não

---

### TASK-04 — Criar `docs/GLOSSARIO.md` com definição dos estilos de formatação
**Descrição**: Criar o arquivo `docs/GLOSSARIO.md` (ou adicionar seção ao arquivo caso já exista) documentando os termos e contratos relacionados ao módulo utilitário de datas. O glossário deve conter ao menos:
- **`formatDate`**: descrição da função, módulo onde reside e link para o JSDoc;
- **`style: 'short'`**: descrição do estilo curto — formato numérico compacto (ex.: `"27/05/2026"`);
- **`style: 'medium'`**: descrição do estilo médio — formato com mês abreviado (ex.: `"27 de mai. de 2026"`);
- **`style: 'long'`**: descrição do estilo longo — formato com mês por extenso (ex.: `"27 de maio de 2026"`);
- **locale padrão**: `pt-BR`, conforme `DEFAULT_LOCALE` definido em `src/utils/date.ts`;
- Menção de que a saída exata depende da versão do Node.js (Node.js 22 como referência) e do motor `Intl.DateTimeFormat`.

Esta task é independente da implementação e pode ser desenvolvida em paralelo com TASK-01.

**Arquivos Afetados**:
- `docs/GLOSSARIO.md` *(criação)*

**Critério de Aceite Técnico**: Arquivo `docs/GLOSSARIO.md` existe no repositório; contém entradas para `formatDate`, os três valores de `style` e o locale padrão; está em português e sem erros de formatação Markdown (`prettier --check` ou revisão manual).
**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

## Ordem de Execução

Ondas de execução paralela:

```
Onda 1 (paralelo): TASK-01, TASK-04
Onda 2 (paralelo): TASK-02, TASK-03
```

## Estimativa Total
- Tasks P (< 2h): 2 tasks — TASK-02, TASK-04
- Tasks M (2–4h): 2 tasks — TASK-01, TASK-03
- Tasks G (4–8h): 0 tasks
- **Estimativa total**: 6–12 horas

## Referências
- PRD: SCRUM-18/PRD.md
- Jira: SCRUM-18