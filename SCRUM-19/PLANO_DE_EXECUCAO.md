# Plano de Execução — SCRUM-19: Adicionar função utilitária formatBytes(bytes, decimals?) ao módulo src/utils/bytes.ts

## Identificação
- **Jira Key**: SCRUM-19
- **Resumo**: Adicionar função utilitária `formatBytes(bytes, decimals?)` ao módulo `src/utils/bytes.ts`, com re-exportação via barrel e documentação no glossário
- **Versão**: 1.0
- **Autor**: Agente LT (IA)
- **Data**: 2026-05-27

## Stack Detectada
- **Runtime**: Node.js 22 / TypeScript 5
- **Framework**: Express 4 (^4.21.2)
- **Banco de Dados**: PostgreSQL (Supabase) via Drizzle ORM
- **Fila**: BullMQ + Redis (Upstash / ioredis)
- **Testes**: Vitest 3 + @vitest/coverage-v8

## Visão Geral

| ID | Descrição resumida | Estimativa | Dependências | Paralelo |
|----|-------------------|------------|-------------|---------|
| TASK-01 | Criar `src/utils/bytes.ts` com a função `formatBytes` (base-1024, JSDoc completo) | M | — | Sim |
| TASK-02 | Escrever testes unitários em `src/utils/bytes.test.ts` com cobertura ≥ 90% | M | TASK-01 | Não |
| TASK-03 | Re-exportar `formatBytes` no barrel `src/utils/index.ts` | P | TASK-01 | Não |
| TASK-04 | Atualizar `docs/GLOSSARIO.md` com entrada do módulo `src/utils/bytes` | P | TASK-01 | Sim |

## Tasks Detalhadas

### TASK-01 — Criar `src/utils/bytes.ts` com a função `formatBytes`
**Descrição**: Criar o arquivo `src/utils/bytes.ts` exportando a função `formatBytes(bytes: number, decimals?: number): string`. A implementação adota **base-1024 binária** (igual à base usada pela GitHub Contents API ao reportar tamanhos de arquivo), com unidades `Bytes | KB | MB | GB | TB | PB | EB | ZB | YB`. Regras de contrato:
- `bytes === 0` → retorna `"0 Bytes"` imediatamente.
- `bytes < 0`, `NaN` ou `Infinity` → lança `TypeError` com mensagem contendo o valor recebido (ex.: `TypeError: Valor inválido para bytes: -512. O valor deve ser um número finito e não negativo.`), seguindo o mesmo padrão de `formatDate`.
- `decimals` omitido → usa `2` casas decimais como default.
- `decimals` negativo ou não-inteiro → sanitizado via `Math.max(0, Math.round(decimals))`, sem lançar erro (RF-06).
- Cálculo da unidade: `i = Math.floor(Math.log(bytes) / Math.log(1024))`, resultado via `parseFloat((bytes / 1024 ** i).toFixed(k))`, onde `k` é o valor sanitizado de `decimals`.
- Bloco JSDoc completo com `@param`, `@returns`, `@throws` e pelo menos 3 `@example`.

A decisão de base-1024 deve estar registrada em um comentário interno no arquivo e replicada no Glossário (TASK-04), constituindo o contrato público imutável desta versão.

**Arquivos Afetados**:
- `src/utils/bytes.ts` *(novo)*

**Critério de Aceite Técnico**:
- `formatBytes(0)` retorna `"0 Bytes"`.
- `formatBytes(1048576)` retorna `"1.00 MB"` (1024² bytes).
- `formatBytes(1536, 3)` retorna `"1.500 KB"` (1536 / 1024 = 1.5, 3 casas).
- `formatBytes(-512)` lança `TypeError` com `-512` na mensagem.
- `formatBytes(NaN)` lança `TypeError` com `NaN` na mensagem.
- `tsc --noEmit` passa sem erros no arquivo.

**Estimativa**: M — 2–4h
**Dependências**: Nenhuma
**Paralelizável**: Sim

---

### TASK-02 — Escrever testes unitários em `src/utils/bytes.test.ts`
**Descrição**: Criar o arquivo de testes `src/utils/bytes.test.ts` usando Vitest. O arquivo deve importar `formatBytes` diretamente de `src/utils/bytes.ts` (sem passar pelo barrel, para isolar a cobertura do arquivo-alvo) e cobrir os seguintes cenários obrigatórios:

| Cenário | Entrada | Saída / Comportamento esperado |
|---------|---------|-------------------------------|
| Zero bytes | `formatBytes(0)` | `"0 Bytes"` |
| Decimais padrão — KB | `formatBytes(1536)` | `"1.50 KB"` |
| Decimais padrão — MB | `formatBytes(1048576)` | `"1.00 MB"` |
| Decimais padrão — GB | `formatBytes(1073741824)` | `"1.00 GB"` |
| Decimais customizados | `formatBytes(1536, 3)` | `"1.500 KB"` |
| `decimals = 0` | `formatBytes(1536, 0)` | `"2 KB"` |
| `decimals` negativo (sanitização) | `formatBytes(1536, -1)` | `"2 KB"` (trata como 0) |
| `decimals` não-inteiro (sanitização) | `formatBytes(1536, 1.7)` | `"1.5 KB"` (arredonda para 2) |
| Entrada negativa | `formatBytes(-512)` | lança `TypeError` contendo `"-512"` |
| Entrada `NaN` | `formatBytes(NaN)` | lança `TypeError` contendo `"NaN"` |
| Entrada `Infinity` | `formatBytes(Infinity)` | lança `TypeError` contendo `"Infinity"` |
| Unidade máxima | `formatBytes(1024 ** 8)` | retorna string terminando em `"YB"` |

Cobertura mínima: ≥ 90% em statements e branches (verificado por `npm run test:coverage`).

**Arquivos Afetados**:
- `src/utils/bytes.test.ts` *(novo)*

**Critério de Aceite Técnico**: `npm run test:coverage` executa com sucesso; o relatório v8 exibe `src/utils/bytes.ts` com `Stmts ≥ 90%` e `Branch ≥ 90%`; todos os `it/test` blocks passam sem uso de `.skip` ou `.todo`.

**Estimativa**: M — 2–4h
**Dependências**: TASK-01
**Paralelizável**: Não

---

### TASK-03 — Re-exportar `formatBytes` no barrel `src/utils/index.ts`
**Descrição**: Adicionar a linha `export * from './bytes';` ao arquivo `src/utils/index.ts`, imediatamente após a exportação existente de `./date`, respeitando a ordem alfabética dos módulos. Antes de editar, verificar que não existe identificador `formatBytes` já exportado no barrel (risco R-02), garantindo ausência de colisão. Após a edição, confirmar que `import { formatBytes } from '../utils'` resolve corretamente em um teste de smoke (pode ser verificado via `tsc --noEmit`).

**Arquivos Afetados**:
- `src/utils/index.ts` *(alterado)*

**Critério de Aceite Técnico**: `tsc --noEmit` passa sem erros; `import { formatBytes } from '../utils'` pode ser resolvido estaticamente pelo compilador TypeScript; nenhum identificador duplicado é introduzido no barrel.

**Estimativa**: P — < 2h
**Dependências**: TASK-01
**Paralelizável**: Não

---

### TASK-04 — Atualizar `docs/GLOSSARIO.md` com a entrada do módulo `src/utils/bytes`
**Descrição**: Adicionar uma nova seção `## Módulo src/utils/bytes` ao arquivo `docs/GLOSSARIO.md`, seguindo exatamente o mesmo padrão visual e estrutural já adotado para `## Módulo src/utils/date`. A entrada deve incluir:
- **Assinatura pública**: `formatBytes(bytes: number, decimals?: number): string`
- **Descrição**: o que a função faz e em qual contexto é usada no projeto.
- **Tabela de comportamento**: zero bytes, decimais padrão (2), decimais customizados, sanitização de `decimals` inválido.
- **Base de cálculo**: declarar explicitamente que a implementação adota **base-1024 binária** (contrato imutável desta versão), com nota sobre a motivação (compatibilidade com a GitHub Contents API).
- **Tratamento de erros**: descrever o `TypeError` lançado para `bytes` negativo, `NaN` e `Infinity`, com exemplo de mensagem.
- **Unidades suportadas**: `Bytes`, `KB`, `MB`, `GB`, `TB`, `PB`, `EB`, `ZB`, `YB`.

**Arquivos Afetados**:
- `docs/GLOSSARIO.md` *(alterado)*

**Critério de Aceite Técnico**: `docs/GLOSSARIO.md` contém seção `## Módulo \`src/utils/bytes\`` com subsections de assinatura, tabela de comportamento, declaração explícita de base-1024 e descrição do `TypeError`; a estrutura é visualmente consistente com a seção `src/utils/date` já existente; o arquivo renderiza corretamente como Markdown (sem quebras de sintaxe).

**Estimativa**: P — < 2h
**Dependências**: TASK-01
**Paralelizável**: Sim

---

## Ordem de Execução

Ondas de execução paralela:

```
Onda 1 (sequencial): TASK-01
Onda 2 (paralelo):   TASK-02, TASK-03, TASK-04
```

> **Nota**: TASK-02, TASK-03 e TASK-04 dependem todas de TASK-01, mas são independentes entre si e podem ser executadas em paralelo por desenvolvedores distintos após a conclusão de TASK-01. TASK-03 deve ser mergeada antes de TASK-02 ser considerada "done" no critério de aceite do barrel (CA-05), mas os dois podem ser desenvolvidos simultaneamente.

## Estimativa Total
- Tasks P (< 2h): 2 tasks — TASK-03, TASK-04
- Tasks M (2–4h): 2 tasks — TASK-01, TASK-02
- Tasks G (4–8h): 0 tasks
- **Estimativa total**: 6–12 horas (em execução sequencial pura) / **4–8 horas** com paralelização da Onda 2

## Referências
- PRD: SCRUM-19/PRD.md
- Jira: SCRUM-19