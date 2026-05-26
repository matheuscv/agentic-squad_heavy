/**
 * @module currency
 * Utilitários de formatação de valores monetários usando `Intl.NumberFormat`.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * Códigos de moeda suportados pela função `formatCurrency`.
 * Qualquer outro literal de string causará erro de compilação em modo strict.
 */
export type CurrencyCode = 'BRL' | 'USD' | 'EUR';

// ─── Mapa interno de locale por moeda ────────────────────────────────────────

/**
 * Associa cada código de moeda ao locale BCP 47 correto para formatação
 * via `Intl.NumberFormat`.
 *
 * @internal — não exportado; use `formatCurrency` como ponto de entrada público.
 */
const CURRENCY_LOCALE_MAP: Record<CurrencyCode, string> = {
  BRL: 'pt-BR',
  USD: 'en-US',
  EUR: 'de-DE',
};

// ─── Implementação ────────────────────────────────────────────────────────────

/**
 * Formata um valor numérico como string de moeda localizada.
 *
 * @param value    - O valor numérico a ser formatado (pode ser negativo ou zero).
 * @param currency - O código de moeda ISO 4217 suportado (`'BRL'`, `'USD'` ou `'EUR'`).
 * @returns        A string formatada conforme o locale associado à moeda,
 *                 com símbolo, separadores e duas casas decimais.
 * @throws {Error} Se `currency` não for uma chave reconhecida em `CURRENCY_LOCALE_MAP`.
 *
 * @example
 * formatCurrency(1234.5,  'BRL') // → "R$ 1.234,50"
 * formatCurrency(9999.99, 'USD') // → "$9,999.99"
 * formatCurrency(-500,    'EUR') // → "-500,00 €"   (formato de-DE)
 * formatCurrency(0,       'BRL') // → "R$ 0,00"
 */
export function formatCurrency(value: number, currency: CurrencyCode): string {
  if (!(currency in CURRENCY_LOCALE_MAP)) {
    throw new Error(`Moeda inválida: ${currency}`);
  }

  const locale = CURRENCY_LOCALE_MAP[currency];

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(value);
}
