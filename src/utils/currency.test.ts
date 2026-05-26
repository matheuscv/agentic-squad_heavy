import { describe, it, expect, afterEach } from 'vitest';
import { formatCurrency } from './currency';
import type { CurrencyCode } from './currency';

/**
 * Testes para `formatCurrency`.
 *
 * Estratégia: usamos o `Intl.NumberFormat` **real** do runtime (sem mock) e
 * fazemos assertions flexíveis — verificamos a presença do símbolo/código de
 * moeda, dos dígitos corretos e do sinal negativo, sem depender da formatação
 * exacta de locale (que varia conforme a build ICU do Node.js no CI).
 */

afterEach(() => {
  // Sem mocks globais configurados, mas mantemos o afterEach por convenção.
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normaliza a string removendo espaços normais e não-quebráveis (U+00A0, U+202F)
 * para facilitar comparações de substrings numéricas.
 */
function normalize(s: string): string {
  return s.replace(/[\u00a0\u202f\s]/g, '');
}

// ─── Suite principal ───────────────────────────────────────────────────────────

describe('formatCurrency', () => {
  // ── Caminho feliz — BRL ──────────────────────────────────────────────────

  it('(a) BRL 1234.5: deve conter símbolo R$ e os dígitos do valor', () => {
    const result = formatCurrency(1234.5, 'BRL');

    // Símbolo obrigatório (pode ter espaço não-quebrável entre símbolo e número)
    expect(result).toMatch(/R\$|BRL/);
    // Os dígitos 1234 e 50 devem estar presentes
    expect(normalize(result)).toContain('1234');
    expect(normalize(result)).toContain('50');
  });

  it('(b) BRL zero: deve conter símbolo R$ e as casas decimais zeradas', () => {
    const result = formatCurrency(0, 'BRL');

    expect(result).toMatch(/R\$|BRL/);
    // Deve ter algum "0" formatado
    expect(normalize(result)).toContain('0');
  });

  it('(c) BRL valor negativo: deve conter símbolo R$ e indicação de negativo', () => {
    const result = formatCurrency(-1234.5, 'BRL');

    expect(result).toMatch(/R\$|BRL/);
    // Sinal negativo (hífen ASCII ou sinal menos Unicode U+2212)
    expect(result).toMatch(/[-\u2212]/);
    expect(normalize(result)).toContain('1234');
  });

  // ── Caminho feliz — USD ───────────────────────────────────────────────────

  it('(d) USD 9999.99: deve conter símbolo $ e não arredondar para 10000', () => {
    const result = formatCurrency(9999.99, 'USD');

    expect(result).toMatch(/\$|USD/);
    // 9999 deve estar presente; 10000 não deve aparecer
    expect(normalize(result)).toContain('9999');
    expect(normalize(result)).not.toContain('10000');
    // Parte decimal .99
    expect(normalize(result)).toContain('99');
  });

  it('(e) USD arredondamento: 1234.5678 deve ser arredondado para 1234.57', () => {
    const result = formatCurrency(1234.5678, 'USD');

    expect(result).toMatch(/\$|USD/);
    // Arredondamento correto: .57 presente, .5678 não
    expect(normalize(result)).toContain('57');
    expect(normalize(result)).not.toContain('5678');
  });

  it('(f) USD zero: deve conter símbolo $ e indicar valor zerado', () => {
    const result = formatCurrency(0, 'USD');

    expect(result).toMatch(/\$|USD/);
    expect(normalize(result)).toContain('0');
  });

  // ── Caminho feliz — EUR ───────────────────────────────────────────────────

  it('(g) EUR valor negativo -500: deve conter símbolo € e indicação de negativo', () => {
    const result = formatCurrency(-500, 'EUR');

    expect(result).toMatch(/€|EUR/);
    expect(result).toMatch(/[-\u2212]/);
    expect(normalize(result)).toContain('500');
  });

  it('(h) EUR valor positivo 1000: deve conter símbolo € e não ter sinal negativo', () => {
    const result = formatCurrency(1000, 'EUR');

    expect(result).toMatch(/€|EUR/);
    // Sem sinal negativo
    expect(result).not.toMatch(/[-\u2212]/);
    expect(normalize(result)).toContain('1000');
  });

  it('(i) EUR zero: deve conter símbolo € e indicar valor zerado', () => {
    const result = formatCurrency(0, 'EUR');

    expect(result).toMatch(/€|EUR/);
    expect(normalize(result)).toContain('0');
  });

  // ── Caminhos de erro ──────────────────────────────────────────────────────

  it('(j) moeda inválida "XYZ": deve lançar Error com mensagem "Moeda inválida: XYZ"', () => {
    expect(() => formatCurrency(100, 'XYZ' as CurrencyCode)).toThrowError(
      'Moeda inválida: XYZ',
    );
  });

  it('(k) moeda inválida string vazia: deve lançar Error com mensagem "Moeda inválida:"', () => {
    expect(() => formatCurrency(100, '' as CurrencyCode)).toThrowError(
      /Moeda inválida/,
    );
  });

  // ── Propriedade: retorno é sempre string não-vazia ────────────────────────

  it('(l) BRL, USD e EUR: retorno deve ser sempre uma string não-vazia', () => {
    const currencies: CurrencyCode[] = ['BRL', 'USD', 'EUR'];

    for (const currency of currencies) {
      const result = formatCurrency(42, currency);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }
  });
});
