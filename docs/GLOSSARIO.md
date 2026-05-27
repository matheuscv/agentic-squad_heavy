# Glossário — Squad Agêntica

Este documento define os termos e contratos públicos dos módulos utilitários do projeto.

---

## Módulo `src/utils/date`

### `formatDate`

**Módulo**: `src/utils/date` (re-exportado por `src/utils/index`)  
**Assinatura**: `formatDate(date: Date | string | number, style?: 'short' | 'medium' | 'long'): string`

Função utilitária que formata uma data para uma string legível em português do Brasil (`pt-BR`) usando a API nativa `Intl.DateTimeFormat`. Consulte o bloco JSDoc no arquivo fonte para exemplos detalhados.

---

### Estilos de formatação (`style`)

| Valor | Descrição | Exemplo de saída* |
|-------|-----------|-------------------|
| `'short'` | Formato numérico compacto — todos os componentes (dia, mês e ano) representados por números. | `"27/05/2026"` |
| `'medium'` | Formato com mês abreviado em português. Aplicado como **padrão** quando `style` é omitido. | `"27 de mai. de 2026"` |
| `'long'` | Formato com nome completo do mês em português. | `"27 de maio de 2026"` |

> \* A saída exata depende da versão do motor `Intl.DateTimeFormat` disponível no ambiente de
> execução. Os exemplos acima foram obtidos com **Node.js 22** (ICU data v74+). Versões
> anteriores do Node.js ou ambientes com ICU reduzida (`small-icu`) podem produzir strings
> ligeiramente diferentes.

---

### Locale padrão

O locale utilizado pela função é `pt-BR`, definido pela constante interna `DEFAULT_LOCALE`
em `src/utils/date.ts`. A constante foi projetada para permitir a adição futura de um
parâmetro `locale` opcional sem quebra de contrato retroativo.

---

### Tratamento de erros

Quando o valor passado para `date` não é parseável ou resulta em `Invalid Date` (i.e., o
método `.getTime()` retorna `NaN`), a função lança um `TypeError` cuja mensagem inclui o
valor recebido, facilitando a depuração:

```
TypeError: Valor inválido para date: "nao-e-data". Não foi possível converter para Date.
```

---

### Tipos de entrada aceitos

| Tipo | Exemplo |
|------|---------|
| `Date` | `new Date('2026-05-27')` |
| `string` (ISO 8601) | `'2026-05-27T12:00:00.000Z'` |
| `number` (Unix ms) | `1748304000000` |
