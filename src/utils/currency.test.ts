import { describe, it, expect } from 'vitest';
import { formatCurrency } from './currency';
import type { CurrencyCode } from './currency';

/**
 * Testes para `formatCurrency`.
 *
 * Estratégia: usamos o `Intl.NumberFormat` **real** do runtime (sem mock) e
 * fazemos assertions flexíveis — verificamos a presença do símbolo/código de
 * moeda, dos dígitos corretos e do sinal negativo, sem depender da formatação
 * exata de locale (que varia conforme a build ICU do Node.js no CI).
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normaliza a string removendo espaços normais e não-quebráveis (U+00A0, U+202F)
 * para facilitar comparações de substrings numéricas.
 */
function normalize(s: string): string {
  return s.replace(/[\u00a0\u202f\s.,]/g, '');
}

// ─── Suite principal ───────────────────────────────────────────────────────────

describe('formatCurrency', () => {
  // ── Caminho feliz — BRL ───────────────────────────────────────────────────

  describe('BRL', () => {
    it('(a) BRL 1234.5: deve conter símbolo R$ e os dígitos do valor', () => {
      const result = formatCurrency(1234.5, 'BRL');
      expect(result).toMatch(/R\$|BRL/);
      expect(normalize(result)).toContain('1234');
      expect(normalize(result)).toContain('50');
    });

    it('(b) BRL zero: deve conter símbolo R$ e as casas decimais zeradas', () => {
      const result = formatCurrency(0, 'BRL');
      expect(result).toMatch(/R\$|BRL/);
      expect(normalize(result)).toContain('0');
    });

    it('(c) BRL valor negativo: deve conter símbolo R$ e indicação de negativo', () => {
      const result = formatCurrency(-1234.5, 'BRL');
      expect(result).toMatch(/R\$|BRL/);
      expect(result).toMatch(/[-\u2212]/);
      expect(normalize(result)).toContain('1234');
    });

    it('(d) BRL valor grande: 1000000.00', () => {
      const result = formatCurrency(1_000_000, 'BRL');
      expect(result).toMatch(/R\$|BRL/);
      expect(normalize(result)).toContain('1000000');
    });

    it('(e) BRL valor decimal com arredondamento: 1.005', () => {
      const result = formatCurrency(1.005, 'BRL');
      expect(result).toMatch(/R\$|BRL/);
      expect(normalize(result)).toContain('1');
    });

    it('(f) BRL retorna string', () => {
      const result = formatCurrency(100, 'BRL');
      expect(typeof result).toBe('string');
    });
  });

  // ── Caminho feliz — USD ───────────────────────────────────────────────────

  describe('USD', () => {
    it('(a) USD 9999.99: deve conter símbolo $ e não arredondar para 10000', () => {
      const result = formatCurrency(9999.99, 'USD');
      expect(result).toMatch(/\$|USD/);
      expect(normalize(result)).toContain('9999');
      expect(normalize(result)).not.toContain('10000');
      expect(normalize(result)).toContain('99');
    });

    it('(b) USD arredondamento: 1234.5678 deve ser arredondado para 1234.57', () => {
      const result = formatCurrency(1234.5678, 'USD');
      expect(result).toMatch(/\$|USD/);
      expect(normalize(result)).toContain('57');
      expect(normalize(result)).not.toContain('5678');
    });

    it('(c) USD zero: deve conter símbolo $ e indicar valor zerado', () => {
      const result = formatCurrency(0, 'USD');
      expect(result).toMatch(/\$|USD/);
      expect(normalize(result)).toContain('0');
    });

    it('(d) USD valor negativo: deve conter $ e sinal negativo', () => {
      const result = formatCurrency(-99.99, 'USD');
      expect(result).toMatch(/\$|USD/);
      expect(result).toMatch(/[-\u2212]/);
      expect(normalize(result)).toContain('99');
    });

    it('(e) USD valor pequeno: 0.01', () => {
      const result = formatCurrency(0.01, 'USD');
      expect(result).toMatch(/\$|USD/);
      expect(normalize(result)).toContain('1');
    });

    it('(f) USD retorna string', () => {
      const result = formatCurrency(50, 'USD');
      expect(typeof result).toBe('string');
    });
  });

  // ── Caminho feliz — EUR ───────────────────────────────────────────────────

  describe('EUR', () => {
    it('(a) EUR valor negativo -500: deve conter símbolo € e indicação de negativo', () => {
      const result = formatCurrency(-500, 'EUR');
      expect(result).toMatch(/€|EUR/);
      expect(result).toMatch(/[-\u2212]/);
      expect(normalize(result)).toContain('500');
    });

    it('(b) EUR valor positivo 1000: deve conter símbolo € e não ter sinal negativo', () => {
      const result = formatCurrency(1000, 'EUR');
      expect(result).toMatch(/€|EUR/);
      expect(result).not.toMatch(/[-\u2212]/);
      expect(normalize(result)).toContain('1000');
    });

    it('(c) EUR zero: deve conter símbolo € e indicar valor zerado', () => {
      const result = formatCurrency(0, 'EUR');
      expect(result).toMatch(/€|EUR/);
      expect(normalize(result)).toContain('0');
    });

    it('(d) EUR decimal 19.99', () => {
      const result = formatCurrency(19.99, 'EUR');
      expect(result).toMatch(/€|EUR/);
      expect(normalize(result)).toContain('19');
      expect(normalize(result)).toContain('99');
    });

    it('(e) EUR arredondamento: 1.005', () => {
      const result = formatCurrency(1.005, 'EUR');
      expect(result).toMatch(/€|EUR/);
      expect(normalize(result)).toContain('1');
    });

    it('(f) EUR retorna string', () => {
      const result = formatCurrency(200, 'EUR');
      expect(typeof result).toBe('string');
    });
  });

  // ── Verificações cruzadas entre moedas ───────────────────────────────────

  describe('comparações entre moedas', () => {
    it('formatos BRL e USD para o mesmo valor são diferentes', () => {
      const brl = formatCurrency(1234.56, 'BRL');
      const usd = formatCurrency(1234.56, 'USD');
      // Formatos distintos (separadores diferentes, símbolo diferente)
      expect(brl).not.toBe(usd);
    });

    it('formatos USD e EUR para o mesmo valor são diferentes', () => {
      const usd = formatCurrency(500, 'USD');
      const eur = formatCurrency(500, 'EUR');
      expect(usd).not.toBe(eur);
    });

    it('valor positivo e negativo têm formatos diferentes', () => {
      const pos = formatCurrency(100, 'BRL');
      const neg = formatCurrency(-100, 'BRL');
      expect(pos).not.toBe(neg);
    });
  });

  // ── Casos extremos (edge cases) ───────────────────────────────────────────

  describe('edge cases', () => {
    it('valor muito pequeno 0.001 é formatado (sem erro)', () => {
      expect(() => formatCurrency(0.001, 'BRL')).not.toThrow();
    });

    it('valor Number.MAX_SAFE_INTEGER não lança erro', () => {
      expect(() => formatCurrency(Number.MAX_SAFE_INTEGER, 'USD')).not.toThrow();
    });

    it('valor negativo mínimo não lança erro', () => {
      expect(() => formatCurrency(-Number.MAX_SAFE_INTEGER, 'EUR')).not.toThrow();
    });

    it('currency type é reconhecida como CurrencyCode', () => {
      // Verifica que as três moedas são reconhecidas como tipo válido
      const currencies: CurrencyCode[] = ['BRL', 'USD', 'EUR'];
      currencies.forEach((currency) => {
        expect(() => formatCurrency(100, currency)).not.toThrow();
      });
    });
  });

  // ── Comportamento de erro ─────────────────────────────────────────────────

  describe('lança erro para moeda inválida', () => {
    it('lança Error com "Moeda inválida" para moeda desconhecida', () => {
      // Cast para contornar type-checking (testa o runtime)
      expect(() => formatCurrency(100, 'GBP' as CurrencyCode)).toThrow('Moeda inválida');
    });

    it('lança Error contendo o código de moeda inválido na mensagem', () => {
      expect(() => formatCurrency(100, 'JPY' as CurrencyCode)).toThrow('JPY');
    });

    it('lança Error para string vazia', () => {
      expect(() => formatCurrency(100, '' as CurrencyCode)).toThrow();
    });

    it('lança Error para moeda em minúsculas (case-sensitive)', () => {
      expect(() => formatCurrency(100, 'brl' as CurrencyCode)).toThrow('Moeda inválida');
    });

    it('lança Error para moeda "usd" em minúsculas', () => {
      expect(() => formatCurrency(100, 'usd' as CurrencyCode)).toThrow('Moeda inválida');
    });

    it('lança Error para moeda com espaço', () => {
      expect(() => formatCurrency(100, ' BRL' as CurrencyCode)).toThrow('Moeda inválida');
    });
  });
});
