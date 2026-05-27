/**
 * @module currency
 * @description Utility functions for currency formatting using the Intl.NumberFormat API.
 */

/**
 * Formats a numeric value as a localized currency string.
 *
 * @param value - The numeric amount to format. Must be a finite number (not NaN, Infinity or -Infinity).
 * @param currency - A valid ISO 4217 currency code (e.g. `'BRL'`, `'USD'`, `'EUR'`). Must be a non-empty string.
 * @param locale - A valid BCP 47 locale string (e.g. `'pt-BR'`, `'en-US'`, `'de-DE'`). Must be a non-empty string.
 * @param fractionDigits - Number of decimal places to display. Must be ≥ 0. Defaults to `2`.
 * @returns A locale-aware currency string produced by `Intl.NumberFormat`.
 *
 * @throws {TypeError} When `value` is `NaN`, `Infinity` or `-Infinity`.
 * @throws {RangeError} When `locale` or `currency` is an empty string.
 *
 * @example
 * // BRL / pt-BR → "R$ 1.234,56"
 * formatCurrency(1234.56, 'BRL', 'pt-BR');
 *
 * @example
 * // USD / en-US → "$1,234.56"
 * formatCurrency(1234.56, 'USD', 'en-US');
 *
 * @example
 * // EUR / de-DE → "1.234,56 €"
 * formatCurrency(1234.56, 'EUR', 'de-DE');
 *
 * @example
 * // Custom fractionDigits → "$1,235"
 * formatCurrency(1234.56, 'USD', 'en-US', 0);
 *
 * @example
 * // Custom fractionDigits → "$1.5000"
 * formatCurrency(1.5, 'USD', 'en-US', 4);
 */
export function formatCurrency(
  value: number,
  currency: string,
  locale: string,
  fractionDigits?: number,
): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(
      `Invalid value: ${String(value)} is not a finite number`,
    );
  }

  if (locale.trim() === '') {
    throw new RangeError(
      `Invalid locale: '${locale}' is not a valid BCP 47 locale`,
    );
  }

  if (currency.trim() === '') {
    throw new RangeError(
      `Invalid currency: '${currency}' is not a valid ISO 4217 currency code`,
    );
  }

  const digits = fractionDigits ?? 2;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
