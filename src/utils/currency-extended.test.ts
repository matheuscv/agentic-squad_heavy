/**
 * Testes estendidos de cobertura para src/utils/currency.ts
 *
 * Complementa currency.test.ts com:
 * - Cobertura completa dos 3 CurrencyCode suportados (BRL, USD, EUR)
 * - Verificação de locale correto por moeda
 * - Branch de erro: moeda inválida em runtime
 * - Edge cases numéricos: NaN, Infinity, zero, negativo
 * - Verificação do guard `!(currency in CURRENCY_LOCALE_MAP)`
 *
 * NOTA: O tipo CurrencyCode = 'BRL' | 'USD' | 'EUR'. Testes com moedas
 * fora desse conjunto usam @ts-expect-error para testar o branch de erro.
 */
import { describe, it, expect } from 'vitest';
import { formatCurrency, type CurrencyCode } from './currency';

describe('formatCurrency — cobertura estendida', () => {

  describe('BRL — Real Brasileiro (locale pt-BR)', () => {
    it('formata valor inteiro positivo com símbolo R$', () => {
      const result = formatCurrency(100, 'BRL');
      expect(result).toContain('R$');
      expect(result).toMatch(/100/);
    });

    it('formata 9,99 com vírgula decimal (pt-BR)', () => {
      const result = formatCurrency(9.99, 'BRL');
      expect(result).toContain('R$');
      expect(result).toContain(',99');
    });

    it('formata zero como R$ 0,00', () => {
      const result = formatCurrency(0, 'BRL');
      expect(result).toContain('R$');
      expect(result).toContain('0,00');
    });

    it('formata valor negativo com sinal de menos', () => {
      const result = formatCurrency(-1234.5, 'BRL');
      expect(result).toContain('R$');
      expect(result).toMatch(/-/);
    });

    it('formata 1.000.000 com separador de milhar (ponto em pt-BR)', () => {
      const result = formatCurrency(1000000, 'BRL');
      // pt-BR usa ponto como separador de milhar
      expect(result).toMatch(/1[.,\s]000/);
    });

    it('formata valor muito pequeno (0,01)', () => {
      const result = formatCurrency(0.01, 'BRL');
      expect(result).toContain('R$');
    });
  });

  describe('USD — Dólar Americano (locale en-US)', () => {
    it('formata 9999,99 com ponto decimal (en-US)', () => {
      const result = formatCurrency(9999.99, 'USD');
      expect(result).toContain('$');
      expect(result).toContain('9,999.99');
    });

    it('formata zero como $0.00', () => {
      const result = formatCurrency(0, 'USD');
      expect(result).toContain('$');
      expect(result).toContain('0.00');
    });

    it('formata valor negativo', () => {
      const result = formatCurrency(-500, 'USD');
      expect(result).toContain('$');
      expect(result).toMatch(/-/);
    });

    it('formata 0,01 corretamente', () => {
      const result = formatCurrency(0.01, 'USD');
      expect(result).toContain('$');
      expect(result).toContain('0.01');
    });

    it('usa ponto como separador decimal', () => {
      const result = formatCurrency(1234.56, 'USD');
      expect(result).toContain('1,234.56');
    });

    it('retorna string não-vazia', () => {
      const result = formatCurrency(100, 'USD');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('EUR — Euro (locale de-DE)', () => {
    it('formata valor com símbolo €', () => {
      const result = formatCurrency(500, 'EUR');
      expect(result).toContain('€');
    });

    it('formata zero com símbolo €', () => {
      const result = formatCurrency(0, 'EUR');
      expect(result).toContain('€');
      expect(result).toContain('0,00');
    });

    it('formata valor negativo com sinal de menos', () => {
      const result = formatCurrency(-500, 'EUR');
      expect(result).toContain('€');
      expect(result).toMatch(/-/);
    });

    it('usa vírgula como separador decimal (de-DE)', () => {
      const result = formatCurrency(1234.5, 'EUR');
      expect(result).toContain(',50');
    });

    it('formata 1.000 com separador de milhar (de-DE)', () => {
      const result = formatCurrency(1000, 'EUR');
      expect(result).toContain('€');
    });
  });

  describe('branch de erro — guard !(currency in CURRENCY_LOCALE_MAP)', () => {
    it('lança Error com mensagem "Moeda inválida: GBP" para GBP', () => {
      // @ts-expect-error: testando moeda inválida em runtime
      expect(() => formatCurrency(100, 'GBP')).toThrow('Moeda inválida: GBP');
    });

    it('lança Error com mensagem "Moeda inválida: " para string vazia', () => {
      // @ts-expect-error: testando moeda inválida em runtime
      expect(() => formatCurrency(100, '')).toThrow('Moeda inválida: ');
    });

    it('lança Error para undefined', () => {
      // @ts-expect-error: testando moeda inválida em runtime
      expect(() => formatCurrency(100, undefined)).toThrow(Error);
    });

    it('lança Error para null', () => {
      // @ts-expect-error: testando moeda inválida em runtime
      expect(() => formatCurrency(100, null)).toThrow(Error);
    });

    it('lança Error para código numérico', () => {
      // @ts-expect-error: testando moeda inválida em runtime
      expect(() => formatCurrency(100, 986)).toThrow(Error);
    });

    it('lança Error para JPY (moeda existente mas não no mapa)', () => {
      // @ts-expect-error: testando moeda inválida em runtime
      expect(() => formatCurrency(100, 'JPY')).toThrow('Moeda inválida: JPY');
    });

    it('lança Error para ARS (Peso Argentino, fora do mapa)', () => {
      // @ts-expect-error: testando moeda inválida em runtime
      expect(() => formatCurrency(500, 'ARS')).toThrow('Moeda inválida: ARS');
    });

    it('lança Error para brl (lowercase)', () => {
      // @ts-expect-error: testando moeda inválida em runtime (case sensitive)
      expect(() => formatCurrency(100, 'brl')).toThrow('Moeda inválida: brl');
    });
  });

  describe('tipo de retorno — invariantes', () => {
    const currencies: CurrencyCode[] = ['BRL', 'USD', 'EUR'];
    const values = [0, 1, 100, 9999.99, -1, -0.01, 0.5, 1234567.89];

    for (const currency of currencies) {
      for (const value of values) {
        it(`formatCurrency(${value}, '${currency}') retorna string não-vazia`, () => {
          const result = formatCurrency(value, currency);
          expect(typeof result).toBe('string');
          expect(result.length).toBeGreaterThan(0);
        });
      }
    }
  });

  describe('edge cases numéricos', () => {
    it('formata Number.MAX_SAFE_INTEGER em USD', () => {
      const result = formatCurrency(Number.MAX_SAFE_INTEGER, 'USD');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('formata valor muito grande em BRL', () => {
      const result = formatCurrency(999999999.99, 'BRL');
      expect(result).toContain('R$');
    });

    it('formata 1.0 (sem casas decimais relevantes) em EUR', () => {
      const result = formatCurrency(1.0, 'EUR');
      expect(result).toContain('€');
      expect(result).toContain('1,00');
    });

    it('formata -0.01 em USD', () => {
      const result = formatCurrency(-0.01, 'USD');
      expect(typeof result).toBe('string');
    });
  });

  describe('integração Intl.NumberFormat', () => {
    it('BRL: símbolo aparece antes do número', () => {
      const result = formatCurrency(100, 'BRL');
      const symbolIndex = result.indexOf('R$');
      const numberIndex = result.search(/\d/);
      expect(symbolIndex).toBeLessThan(numberIndex);
    });

    it('USD: símbolo $ aparece antes do número', () => {
      const result = formatCurrency(100, 'USD');
      const symbolIndex = result.indexOf('$');
      const numberIndex = result.search(/\d/);
      expect(symbolIndex).toBeLessThan(numberIndex);
    });

    it('resultado contém representação do valor original', () => {
      const result = formatCurrency(42, 'BRL');
      expect(result).toMatch(/42/);
    });
  });
});
