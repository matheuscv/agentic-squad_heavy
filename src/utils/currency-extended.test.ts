/**
 * Testes adicionais de cobertura para src/utils/currency.ts
 * Complementa o currency.test.ts existente com:
 * - Todos os CurrencyCode suportados
 * - Edge cases numéricos (NaN, Infinity, -Infinity, Number.MAX_VALUE)
 * - Valores decimais precisos
 * - Verificação do branch de erro (moeda inválida)
 * - Verificação dos locales corretos (pt-BR, en-US, de-DE)
 */

import { describe, it, expect } from 'vitest';
import { formatCurrency } from './currency';

describe('formatCurrency — cobertura estendida', () => {
  describe('BRL — Real Brasileiro (locale pt-BR)', () => {
    it('formata valor inteiro positivo', () => {
      const result = formatCurrency(100, 'BRL');
      expect(result).toContain('R$');
      expect(result).toMatch(/100/);
    });

    it('formata valor com centavos', () => {
      const result = formatCurrency(9.99, 'BRL');
      expect(result).toContain('R$');
      // pt-BR usa vírgula como separador decimal
      expect(result).toContain(',99');
    });

    it('formata valor zero', () => {
      const result = formatCurrency(0, 'BRL');
      expect(result).toContain('R$');
      expect(result).toContain('0,00');
    });

    it('formata valor negativo', () => {
      const result = formatCurrency(-1234.5, 'BRL');
      expect(result).toContain('R$');
      expect(result).toMatch(/-/);
    });

    it('formata valor grande com separador de milhar', () => {
      const result = formatCurrency(1000000, 'BRL');
      // pt-BR usa ponto como separador de milhar
      expect(result).toContain('.');
    });
  });

  describe('USD — Dólar Americano (locale en-US)', () => {
    it('formata valor positivo simples', () => {
      const result = formatCurrency(9999.99, 'USD');
      expect(result).toContain('$');
      expect(result).toContain('9,999.99');
    });

    it('formata valor zero', () => {
      const result = formatCurrency(0, 'USD');
      expect(result).toContain('$');
      expect(result).toContain('0.00');
    });

    it('formata valor negativo', () => {
      const result = formatCurrency(-500, 'USD');
      expect(result).toContain('$');
      expect(result).toMatch(/-/);
    });

    it('formata valor pequeno fracional', () => {
      const result = formatCurrency(0.01, 'USD');
      expect(result).toContain('$');
      expect(result).toContain('0.01');
    });

    it('usa ponto como separador decimal (locale en-US)', () => {
      const result = formatCurrency(1234.56, 'USD');
      expect(result).toContain('.');
      expect(result).toContain(',');
    });
  });

  describe('EUR — Euro (locale de-DE)', () => {
    it('formata valor positivo', () => {
      const result = formatCurrency(500, 'EUR');
      // de-DE: o símbolo € aparece após o número
      expect(result).toContain('€');
    });

    it('formata valor zero', () => {
      const result = formatCurrency(0, 'EUR');
      expect(result).toContain('€');
      expect(result).toContain('0,00');
    });

    it('formata valor negativo', () => {
      const result = formatCurrency(-500, 'EUR');
      expect(result).toContain('€');
      expect(result).toMatch(/-/);
    });

    it('usa vírgula como separador decimal (locale de-DE)', () => {
      const result = formatCurrency(1234.5, 'EUR');
      // de-DE usa vírgula para decimal
      expect(result).toContain(',50');
    });
  });

  describe('validação de CurrencyCode — branch de erro', () => {
    it('lança Error com mensagem contendo o código inválido', () => {
      // @ts-expect-error: testando runtime inválido
      expect(() => formatCurrency(100, 'GBP')).toThrow('GBP');
    });

    it('lança Error quando currency é string vazia', () => {
      // @ts-expect-error: testando runtime inválido
      expect(() => formatCurrency(100, '')).toThrow(Error);
    });

    it('lança Error quando currency é undefined', () => {
      // @ts-expect-error: testando runtime inválido
      expect(() => formatCurrency(100, undefined)).toThrow(Error);
    });

    it('lança Error quando currency é null', () => {
      // @ts-expect-error: testando runtime inválido
      expect(() => formatCurrency(100, null)).toThrow(Error);
    });

    it('lança Error quando currency é JPY (suportado pelo Intl mas não pela função)', () => {
      // @ts-expect-error: testando runtime inválido
      expect(() => formatCurrency(100, 'JPY')).toThrow('JPY');
    });

    it('mensagem de erro é descritiva ("Moeda inválida: XYZ")', () => {
      // @ts-expect-error: testando runtime inválido
      expect(() => formatCurrency(100, 'XYZ')).toThrow('Moeda inválida: XYZ');
    });
  });

  describe('edge cases numéricos', () => {
    it('formata Number.MAX_SAFE_INTEGER sem lançar', () => {
      expect(() => formatCurrency(Number.MAX_SAFE_INTEGER, 'USD')).not.toThrow();
    });

    it('formata número muito pequeno (1e-10) sem lançar', () => {
      expect(() => formatCurrency(1e-10, 'BRL')).not.toThrow();
    });

    it('formata NaN sem lançar (Intl trata como NaN)', () => {
      // O Intl.NumberFormat lida com NaN formando "NaN" ou equivalente
      expect(() => formatCurrency(NaN, 'USD')).not.toThrow();
    });

    it('formata Infinity sem lançar', () => {
      expect(() => formatCurrency(Infinity, 'EUR')).not.toThrow();
    });

    it('formata -Infinity sem lançar', () => {
      expect(() => formatCurrency(-Infinity, 'BRL')).not.toThrow();
    });
  });

  describe('consistência de retorno', () => {
    it('sempre retorna uma string', () => {
      expect(typeof formatCurrency(100, 'BRL')).toBe('string');
      expect(typeof formatCurrency(0, 'USD')).toBe('string');
      expect(typeof formatCurrency(-1, 'EUR')).toBe('string');
    });

    it('retorna o mesmo valor em chamadas consecutivas (idempotência)', () => {
      const first = formatCurrency(1234.56, 'BRL');
      const second = formatCurrency(1234.56, 'BRL');
      expect(first).toBe(second);
    });

    it('retorna valores diferentes para moedas diferentes', () => {
      const brl = formatCurrency(100, 'BRL');
      const usd = formatCurrency(100, 'USD');
      const eur = formatCurrency(100, 'EUR');
      // Cada moeda tem seu próprio símbolo/formato
      expect(brl).not.toBe(usd);
      expect(usd).not.toBe(eur);
      expect(brl).not.toBe(eur);
    });
  });
});
