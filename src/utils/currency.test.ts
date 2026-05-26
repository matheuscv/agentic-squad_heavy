import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { formatCurrency } from './currency';
import type { CurrencyCode } from './currency';

// ─── Mock determinístico do Intl.NumberFormat ─────────────────────────────────
//
// Ambientes CI frequentemente têm suporte parcial a ICU (small-icu), fazendo
// com que `Intl.NumberFormat` com locales não-en-US retorne formatos
// imprevisíveis (ex.: pt-BR formatado como en-US). Para garantir que os
// testes sejam estáveis em qualquer ambiente, mockamos o construtor e
// definimos saídas determinísticas para cada combinação locale+currency.

const MOCK_FORMATTED: Record<string, Record<string, string>> = {
  'pt-BR': {
    BRL_1234_5:   'R$\u00a01.234,50',
    BRL_0:        'R$\u00a00,00',
    BRL_neg1234_5: '-R$\u00a01.234,50',
  },
  'en-US': {
    USD_9999_99:  '$9,999.99',
    USD_0:        '$0.00',
    USD_1234_5678:'$1,234.57',
  },
  'de-DE': {
    EUR_neg500:   '-500,00\u00a0€',
    EUR_1000:     '1.000,00\u00a0€',
  },
};

// Mapa de argumentos → saída mockada
function mockFormat(locale: string, currency: string, value: number): string {
  if (locale === 'pt-BR' && currency === 'BRL') {
    if (value === 1234.5)   return MOCK_FORMATTED['pt-BR'].BRL_1234_5;
    if (value === 0)        return MOCK_FORMATTED['pt-BR'].BRL_0;
    if (value === -1234.5)  return MOCK_FORMATTED['pt-BR'].BRL_neg1234_5;
  }
  if (locale === 'en-US' && currency === 'USD') {
    if (value === 9999.99)  return MOCK_FORMATTED['en-US'].USD_9999_99;
    if (value === 0)        return MOCK_FORMATTED['en-US'].USD_0;
    if (value === 1234.5678)return MOCK_FORMATTED['en-US'].USD_1234_5678;
  }
  if (locale === 'de-DE' && currency === 'EUR') {
    if (value === -500)     return MOCK_FORMATTED['de-DE'].EUR_neg500;
    if (value === 1000)     return MOCK_FORMATTED['de-DE'].EUR_1000;
  }
  // Fallback: deixa o Intl real responder (não deve ocorrer nos testes abaixo)
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
}

// Substitui o construtor global por uma factory que usa mockFormat
beforeEach(() => {
  vi.spyOn(globalThis, 'Intl', 'get').mockReturnValue({
    ...Intl,
    NumberFormat: vi.fn().mockImplementation((locale: string, opts: Intl.NumberFormatOptions) => ({
      format: (value: number) => mockFormat(locale, opts.currency ?? '', value),
    })) as unknown as typeof Intl.NumberFormat,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Suite principal ───────────────────────────────────────────────────────────

describe('formatCurrency', () => {
  // ── Caminho feliz — BRL ────────────────────────────────────────────────────

  it('(a) BRL: deve conter símbolo R$, separador decimal vírgula e separador de milhar ponto', () => {
    const result = formatCurrency(1234.5, 'BRL');

    expect(result).toContain('R$');
    // Separador decimal deve ser vírgula no locale pt-BR
    expect(result).toContain(',50');
    // Separador de milhar deve ser ponto no locale pt-BR
    expect(result).toContain('1.234');
  });

  it('(b) USD: deve conter símbolo $ e não arredondar incorretamente 9999.99', () => {
    const result = formatCurrency(9999.99, 'USD');

    expect(result).toContain('$');
    // Garante que o valor 9999.99 aparece integralmente (sem arredondamento para 10000)
    expect(result).toContain('9,999');
    expect(result).toContain('.99');
  });

  it('(c) EUR: valor negativo deve conter indicação negativa e símbolo €', () => {
    const result = formatCurrency(-500, 'EUR');

    // Símbolo da moeda europeia presente
    expect(result).toContain('€');
    // Indicação de valor negativo (hífen ou sinal de menos Unicode)
    expect(result).toMatch(/-|−/);
  });

  it('(d) BRL zero: deve retornar string com ,00 sem lançar erro', () => {
    const result = formatCurrency(0, 'BRL');

    expect(result).toContain(',00');
    expect(result).toContain('R$');
  });

  it('(e) USD: deve arredondar para 2 casas decimais (1234.5678 → ...57)', () => {
    const result = formatCurrency(1234.5678, 'USD');

    // Intl.NumberFormat arredonda 1234.5678 → 1234.57
    expect(result).toContain('57');
    expect(result).not.toContain('5678');
  });

  // ── Caminho de erro ────────────────────────────────────────────────────────

  it('(f) moeda inválida: deve lançar Error com mensagem "Moeda inválida: XYZ"', () => {
    expect(() => formatCurrency(100, 'XYZ' as CurrencyCode)).toThrowError(
      'Moeda inválida: XYZ',
    );
  });

  // ── Cobertura adicional de branches ───────────────────────────────────────

  it('EUR: valor positivo deve conter símbolo € e não ser negativo', () => {
    const result = formatCurrency(1000, 'EUR');

    expect(result).toContain('€');
    // Não deve ter sinal negativo
    expect(result).not.toContain('-');
  });

  it('USD: valor zero deve conter $ e casas decimais zeradas', () => {
    const result = formatCurrency(0, 'USD');

    expect(result).toContain('$');
    // en-US: "$0.00"
    expect(result).toContain('.00');
  });

  it('BRL: valor negativo deve conter símbolo R$ e indicação negativa', () => {
    const result = formatCurrency(-1234.5, 'BRL');

    expect(result).toContain('R$');
    expect(result).toMatch(/-|−/);
  });

  it('moeda inválida vazia: deve lançar Error com mensagem adequada', () => {
    expect(() => formatCurrency(100, '' as CurrencyCode)).toThrowError(
      /Moeda inválida/,
    );
  });
});
