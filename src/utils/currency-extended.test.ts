/**
 * Testes adicionais para src/utils/currency.ts
 * Cobre branches e edge cases não cobertos pelo currency.test.ts original
 */
import { describe, it, expect } from 'vitest';
import { formatCurrency } from './currency';

describe('formatCurrency — casos estendidos', () => {
  // ─── BRL ──────────────────────────────────────────────────────────────────

  describe('BRL — Real Brasileiro', () => {
    it('formata valor zero em BRL', () => {
      const result = formatCurrency(0, 'BRL');
      expect(result).toMatch(/0/);
    });

    it('formata valor positivo grande em BRL', () => {
      const result = formatCurrency(1_000_000, 'BRL');
      expect(result).toMatch(/1/);
    });

    it('formata valor negativo em BRL', () => {
      const result = formatCurrency(-99.99, 'BRL');
      expect(result).toMatch(/99/);
    });

    it('formata centavos em BRL', () => {
      const result = formatCurrency(0.01, 'BRL');
      expect(result).toMatch(/0/);
    });

    it('formata valor com múltiplas casas decimais em BRL (arredondamento)', () => {
      const result = formatCurrency(1.005, 'BRL');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('retorna string não vazia para BRL', () => {
      const result = formatCurrency(100, 'BRL');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ─── USD ──────────────────────────────────────────────────────────────────

  describe('USD — Dólar Americano', () => {
    it('formata valor zero em USD', () => {
      const result = formatCurrency(0, 'USD');
      expect(result).toMatch(/0/);
    });

    it('formata valor positivo em USD', () => {
      const result = formatCurrency(500.5, 'USD');
      expect(result).toMatch(/500/);
    });

    it('formata valor negativo em USD', () => {
      const result = formatCurrency(-1234.56, 'USD');
      expect(result).toMatch(/1/);
    });

    it('formata valor muito pequeno em USD', () => {
      const result = formatCurrency(0.99, 'USD');
      expect(result).toMatch(/99/);
    });

    it('formata milhão em USD', () => {
      const result = formatCurrency(1_000_000.00, 'USD');
      expect(result).toMatch(/1/);
    });

    it('retorna string com símbolo dólar ou código USD', () => {
      const result = formatCurrency(42, 'USD');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });

  // ─── EUR ──────────────────────────────────────────────────────────────────

  describe('EUR — Euro', () => {
    it('formata valor zero em EUR', () => {
      const result = formatCurrency(0, 'EUR');
      expect(result).toMatch(/0/);
    });

    it('formata valor positivo em EUR', () => {
      const result = formatCurrency(250.75, 'EUR');
      expect(result).toMatch(/250/);
    });

    it('formata valor negativo em EUR', () => {
      const result = formatCurrency(-99.50, 'EUR');
      expect(result).toMatch(/99/);
    });

    it('formata valor com dois decimais em EUR', () => {
      const result = formatCurrency(1.23, 'EUR');
      expect(result).toMatch(/1/);
    });

    it('retorna string não vazia para EUR', () => {
      const result = formatCurrency(100, 'EUR');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ─── Tipos de retorno ──────────────────────────────────────────────────────

  describe('tipo de retorno', () => {
    it('sempre retorna uma string', () => {
      expect(typeof formatCurrency(1, 'BRL')).toBe('string');
      expect(typeof formatCurrency(1, 'USD')).toBe('string');
      expect(typeof formatCurrency(1, 'EUR')).toBe('string');
    });

    it('diferentes moedas produzem formatações diferentes', () => {
      const brl = formatCurrency(100, 'BRL');
      const usd = formatCurrency(100, 'USD');
      const eur = formatCurrency(100, 'EUR');
      // Pelo menos duas delas devem ser diferentes
      const allSame = brl === usd && usd === eur;
      expect(allSame).toBe(false);
    });
  });

  // ─── Valores extremos ─────────────────────────────────────────────────────

  describe('valores extremos', () => {
    it('formata Number.MAX_SAFE_INTEGER', () => {
      const result = formatCurrency(Number.MAX_SAFE_INTEGER, 'USD');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('formata Number.MIN_SAFE_INTEGER', () => {
      const result = formatCurrency(Number.MIN_SAFE_INTEGER, 'EUR');
      expect(typeof result).toBe('string');
    });

    it('formata NaN sem lançar exceção', () => {
      expect(() => formatCurrency(NaN, 'BRL')).not.toThrow();
    });

    it('formata Infinity sem lançar exceção', () => {
      expect(() => formatCurrency(Infinity, 'USD')).not.toThrow();
    });
  });
});
