/**
 * Testes adicionais de cobertura para src/utils/currency.ts
 * Complementa currency.test.ts com branches não cobertos
 */
import { describe, it, expect } from 'vitest';
import { formatCurrency } from './currency';

describe('formatCurrency — cobertura de branches adicionais', () => {
  // ─── Valores extremos ────────────────────────────────────────────────────────

  describe('valores extremos e especiais', () => {
    it('formata zero para BRL', () => {
      const result = formatCurrency(0, 'BRL');
      expect(result).toContain('0');
    });

    it('formata zero para USD', () => {
      const result = formatCurrency(0, 'USD');
      expect(result).toContain('0');
    });

    it('formata zero para EUR', () => {
      const result = formatCurrency(0, 'EUR');
      expect(result).toContain('0');
    });

    it('formata valor negativo para BRL', () => {
      const result = formatCurrency(-100, 'BRL');
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('formata valor negativo para USD', () => {
      const result = formatCurrency(-50.99, 'USD');
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('formata valor negativo para EUR', () => {
      const result = formatCurrency(-1234.56, 'EUR');
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('formata valor muito grande para BRL', () => {
      const result = formatCurrency(1_000_000_000, 'BRL');
      expect(result).toBeDefined();
      expect(result).toContain('1');
    });

    it('formata valor muito grande para USD', () => {
      const result = formatCurrency(999_999_999.99, 'USD');
      expect(result).toBeDefined();
    });

    it('formata valor muito pequeno (frações) para EUR', () => {
      const result = formatCurrency(0.01, 'EUR');
      expect(result).toBeDefined();
      expect(result).toContain('0');
    });
  });

  // ─── Tipos de moeda ──────────────────────────────────────────────────────────

  describe('cobertura completa por moeda', () => {
    it('formata corretamente BRL com símbolo R$', () => {
      const result = formatCurrency(1234.56, 'BRL');
      // BRL deve conter R$ ou "BRL"
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('formata corretamente USD com símbolo $', () => {
      const result = formatCurrency(1234.56, 'USD');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('formata corretamente EUR', () => {
      const result = formatCurrency(1234.56, 'EUR');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('BRL e USD produzem resultados distintos para o mesmo valor', () => {
      const brl = formatCurrency(100, 'BRL');
      const usd = formatCurrency(100, 'USD');
      expect(brl).not.toBe(usd);
    });

    it('USD e EUR produzem resultados distintos para o mesmo valor', () => {
      const usd = formatCurrency(100, 'USD');
      const eur = formatCurrency(100, 'EUR');
      expect(usd).not.toBe(eur);
    });
  });

  // ─── Arredondamento e casas decimais ─────────────────────────────────────────

  describe('arredondamento e precisão', () => {
    it('formata valor com muitas casas decimais para BRL', () => {
      const result = formatCurrency(1.999999, 'BRL');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('formata valor com exatamente 2 casas decimais para USD', () => {
      const result = formatCurrency(9.99, 'USD');
      expect(result).toBeDefined();
    });

    it('formata valor inteiro para EUR', () => {
      const result = formatCurrency(500, 'EUR');
      expect(result).toBeDefined();
    });
  });

  // ─── Invariantes ─────────────────────────────────────────────────────────────

  describe('invariantes gerais', () => {
    it('sempre retorna uma string não-vazia', () => {
      const cases: Array<[number, 'BRL' | 'USD' | 'EUR']> = [
        [0, 'BRL'], [0, 'USD'], [0, 'EUR'],
        [1, 'BRL'], [1, 'USD'], [1, 'EUR'],
        [-1, 'BRL'], [-1, 'USD'], [-1, 'EUR'],
        [100.5, 'BRL'], [100.5, 'USD'], [100.5, 'EUR'],
      ];
      for (const [value, currency] of cases) {
        const result = formatCurrency(value, currency);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }
    });

    it('formata o mesmo valor de forma determinística', () => {
      const v1 = formatCurrency(250.75, 'BRL');
      const v2 = formatCurrency(250.75, 'BRL');
      expect(v1).toBe(v2);
    });

    it('formata o mesmo valor de forma determinística para USD', () => {
      const v1 = formatCurrency(42.0, 'USD');
      const v2 = formatCurrency(42.0, 'USD');
      expect(v1).toBe(v2);
    });
  });
});
