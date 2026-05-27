/**
 * @module src/utils/date
 * Utilitários de formatação de datas em pt-BR usando Intl.DateTimeFormat.
 */

/** Locale padrão usado em todas as formatações deste módulo. */
const DEFAULT_LOCALE = 'pt-BR';

/** Estilos de formatação disponíveis para `formatDate`. */
export type DateStyle = 'short' | 'medium' | 'long';

/**
 * Formata uma data para uma string legível em pt-BR usando `Intl.DateTimeFormat`.
 *
 * Aceita os tipos `Date`, `string` (ISO 8601) e `number` (Unix ms) como entrada,
 * convertendo-os internamente para `Date` antes da formatação.
 *
 * O locale é fixado em `pt-BR` (ver constante `DEFAULT_LOCALE`) de modo que um
 * parâmetro `locale` possa ser adicionado futuramente sem quebra de contrato.
 *
 * @param date - A data a ser formatada. Pode ser um objeto `Date`, uma string
 *   no formato ISO 8601 ou um número representando milissegundos Unix (epoch ms).
 * @param style - Estilo de formatação da data.
 *   - `'short'`  → formato numérico compacto (ex.: `"27/05/2026"`)
 *   - `'medium'` → formato com mês abreviado  (ex.: `"27 de mai. de 2026"`) — **padrão**
 *   - `'long'`   → formato com mês por extenso (ex.: `"27 de maio de 2026"`)
 * @returns String formatada de acordo com o locale `pt-BR` e o `style` solicitado.
 * @throws {TypeError} Quando o valor de `date` não é parseável ou resulta em
 *   `Invalid Date` (NaN interno). A mensagem inclui o valor recebido.
 *
 * @example <caption>Estilo medium (padrão)</caption>
 * formatDate(new Date('2026-05-27'));
 * // → "27 de mai. de 2026"
 *
 * @example <caption>Estilo short</caption>
 * formatDate(new Date('2026-05-27'), 'short');
 * // → "27/05/2026"
 *
 * @example <caption>Estilo long</caption>
 * formatDate(new Date('2026-05-27'), 'long');
 * // → "27 de maio de 2026"
 *
 * @example <caption>Entrada como string ISO 8601</caption>
 * formatDate('2026-05-27T00:00:00.000Z', 'medium');
 * // → "27 de mai. de 2026" (pode variar conforme timezone do ambiente)
 *
 * @example <caption>Entrada como número (Unix ms)</caption>
 * formatDate(1748304000000, 'short');
 * // → "27/05/2026" (pode variar conforme timezone do ambiente)
 *
 * @example <caption>TypeError para valor inválido</caption>
 * formatDate('nao-e-data');
 * // throws TypeError: Valor inválido para date: "nao-e-data". Não foi possível converter para Date.
 */
export function formatDate(
  date: Date | string | number,
  style: DateStyle = 'medium',
): string {
  const parsed = toDate(date);

  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    dateStyle: style,
  }).format(parsed);
}

/**
 * Converte `Date | string | number` para `Date`, lançando `TypeError` se inválido.
 *
 * @internal
 */
function toDate(value: Date | string | number): Date {
  const candidate = value instanceof Date ? value : new Date(value);

  if (isNaN(candidate.getTime())) {
    throw new TypeError(
      `Valor inválido para date: ${JSON.stringify(value)}. Não foi possível converter para Date.`,
    );
  }

  return candidate;
}
