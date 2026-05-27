import { describe, it, expect, afterEach, vi } from 'vitest';
import { formatCurrency } from './currency';

afterEach(() => {
  vi.clearAllMocks();
});

describe('formatCurrency', () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it('formats a positive USD/en-US value correctly', () => {
    const result = formatCurrency(1234.56, 'USD', 'en-US');
    expect(result).toContain('1,234.56');
  });

  it('formats zero in USD/en-US correctly', () => {
    const result = formatCurrency(0, 'USD', 'en-US');
    expect(result).toContain('0.00');
  });

  it('formats a negative USD/en-US value correctly', () => {
    const result = formatCurrency(-99.9, 'USD', 'en-US');
    expect(result).toContain('99.9');
    // Intl produces a minus sign (U+002D) or a negative prefix — ensure it is present
    expect(result).toMatch(/-|(\u2212)/);
  });

  it('formats BRL/pt-BR correctly — contains decimal separator and R$ symbol', () => {
    const result = formatCurrency(1234.56, 'BRL', 'pt-BR');
    expect(result).toContain('1.234,56');
    expect(result).toContain('R$');
  });

  it('formats EUR/de-DE correctly — contains decimal separator and € symbol', () => {
    const result = formatCurrency(1234.56, 'EUR', 'de-DE');
    expect(result).toContain('1.234,56');
    expect(result).toContain('€');
  });

  // ── Custom fractionDigits ─────────────────────────────────────────────────

  it('rounds to 0 fraction digits for USD/en-US', () => {
    const result = formatCurrency(1234.56, 'USD', 'en-US', 0);
    expect(result).toBe('$1,235');
  });

  it('displays 4 fraction digits for USD/en-US', () => {
    const result = formatCurrency(1.5, 'USD', 'en-US', 4);
    expect(result).toContain('1.5000');
  });

  // ── Default fractionDigits = 2 ────────────────────────────────────────────

  it('uses default fractionDigits of 2 when not provided', () => {
    const result = formatCurrency(1000, 'USD', 'en-US');
    expect(result).toBe('$1,000.00');
  });

  // ── TypeError on non-finite values ────────────────────────────────────────

  it('throws TypeError for NaN', () => {
    expect(() => formatCurrency(NaN, 'USD', 'en-US')).toThrow(TypeError);
  });

  it('throws TypeError for Infinity', () => {
    expect(() => formatCurrency(Infinity, 'USD', 'en-US')).toThrow(TypeError);
  });

  it('throws TypeError for -Infinity', () => {
    expect(() => formatCurrency(-Infinity, 'USD', 'en-US')).toThrow(TypeError);
  });

  it('TypeError message describes the invalid value', () => {
    expect(() => formatCurrency(NaN, 'USD', 'en-US')).toThrow(
      'Invalid value: NaN is not a finite number',
    );
  });

  // ── RangeError on empty strings ───────────────────────────────────────────

  it('throws RangeError for empty locale string', () => {
    expect(() => formatCurrency(1, 'USD', '')).toThrow(RangeError);
  });

  it('throws RangeError for empty currency string', () => {
    expect(() => formatCurrency(1, '', 'en-US')).toThrow(RangeError);
  });

  it('RangeError message describes the invalid locale', () => {
    expect(() => formatCurrency(1, 'USD', '')).toThrow(
      "Invalid locale: '' is not a valid BCP 47 locale",
    );
  });

  it('RangeError message describes the invalid currency', () => {
    expect(() => formatCurrency(1, '', 'en-US')).toThrow(
      "Invalid currency: '' is not a valid ISO 4217 currency code",
    );
  });
});
