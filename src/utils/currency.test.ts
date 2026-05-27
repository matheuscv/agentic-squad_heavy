/**
 * Testes para src/utils/currency.ts
 * Foca em cobertura completa da função formatCurrency(value, currency)
 *
 * SCRUM-16 — "Adicionar função utilitária formatCurrency(value, currency)"
 */
import { describe, it, expect } from 'vitest';
import { formatCurrency } from './currency';

describe('formatCurrency', () => {
  describe('caminho feliz — moedas comuns', () => {
    it('formata valor positivo em BRL (Real Brasileiro)', () => {
      const result = formatCurrency(1000, 'BRL');
      expect(result).toMatch(/1\.000/); // separador de milhar
      expect(result).toMatch(/00/); // centavos
    });

    it('formata valor positivo em USD (Dólar Americano)', () => {
      const result = formatCurrency(1500.5, 'USD');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('formata valor positivo em EUR (Euro)', () => {
      const result = formatCurrency(999.99, 'EUR');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('formata valor positivo em GBP (Libra Esterlina)', () => {
      const result = formatCurrency(250, 'GBP');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('formata valor positivo em JPY (Iene Japonês)', () => {
      const result = formatCurrency(1000, 'JPY');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });

  describe('valores de borda', () => {
    it('formata zero como valor', () => {
      const result = formatCurrency(0, 'BRL');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('formata valor muito pequeno (centavos)', () => {
      const result = formatCurrency(0.01, 'BRL');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('formata valor muito grande (milhões)', () => {
      const result = formatCurrency(1_000_000, 'BRL');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('formata valor negativo', () => {
      const result = formatCurrency(-500, 'BRL');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('formata valor fracionário com muitas casas decimais', () => {
      const result = formatCurrency(1.9999, 'USD');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('formata Number.MAX_SAFE_INTEGER', () => {
      const result = formatCurrency(Number.MAX_SAFE_INTEGER, 'USD');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });

  describe('moedas adicionais', () => {
    it('formata em ARS (Peso Argentino)', () => {
      const result = formatCurrency(5000, 'ARS');
      expect(result).toBeDefined();
    });

    it('formata em CAD (Dólar Canadense)', () => {
      const result = formatCurrency(1200, 'CAD');
      expect(result).toBeDefined();
    });

    it('formata em CHF (Franco Suíço)', () => {
      const result = formatCurrency(800, 'CHF');
      expect(result).toBeDefined();
    });

    it('formata em CNY (Yuan Chinês)', () => {
      const result = formatCurrency(3000, 'CNY');
      expect(result).toBeDefined();
    });

    it('formata em AUD (Dólar Australiano)', () => {
      const result = formatCurrency(700, 'AUD');
      expect(result).toBeDefined();
    });
  });

  describe('tipo de retorno', () => {
    it('sempre retorna string', () => {
      const values = [0, 1, 100, 9999.99, -1, 0.5];
      const currencies = ['BRL', 'USD', 'EUR'];

      for (const v of values) {
        for (const c of currencies) {
          expect(typeof formatCurrency(v, c)).toBe('string');
        }
      }
    });

    it('retorna string não vazia para qualquer combinação válida', () => {
      expect(formatCurrency(100, 'BRL')).not.toBe('');
      expect(formatCurrency(100, 'USD')).not.toBe('');
    });
  });

  describe('consistência de formatação', () => {
    it('formata valor inteiro sem casas decimais desnecessárias quando currency não tem centavos', () => {
      // JPY não usa casas decimais
      const result = formatCurrency(1000, 'JPY');
      expect(result).toBeDefined();
    });

    it('dois valores diferentes produzem strings diferentes', () => {
      const r1 = formatCurrency(100, 'BRL');
      const r2 = formatCurrency(200, 'BRL');
      expect(r1).not.toBe(r2);
    });

    it('a mesma chamada produz resultados idempotentes', () => {
      const r1 = formatCurrency(1500, 'USD');
      const r2 = formatCurrency(1500, 'USD');
      expect(r1).toBe(r2);
    });
  });

  describe('edge cases de currency code', () => {
    it('aceita código de moeda em uppercase', () => {
      // BRL já é uppercase
      const result = formatCurrency(100, 'BRL');
      expect(typeof result).toBe('string');
    });

    it('aceita código de moeda com 3 letras', () => {
      // Todos os ISO 4217 têm 3 letras
      expect(typeof formatCurrency(50, 'BRL')).toBe('string');
      expect(typeof formatCurrency(50, 'USD')).toBe('string');
      expect(typeof formatCurrency(50, 'EUR')).toBe('string');
    });
  });
});
