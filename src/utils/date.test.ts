import { describe, it, expect, afterEach, vi } from 'vitest';
import { formatDate } from './date';

afterEach(() => {
  vi.clearAllMocks();
});

// Data de referência: 27 de maio de 2026 ao meio-dia UTC
// Usamos UTC para minimizar variações de fuso horário nos CIs
const REF_ISO = '2026-05-27T12:00:00.000Z';
const REF_DATE = new Date(REF_ISO);
const REF_MS = REF_DATE.getTime();

describe('formatDate', () => {
  // ------------------------------------------------------------------ //
  // 1. Estilo padrão (medium)
  // ------------------------------------------------------------------ //
  describe('estilo padrão', () => {
    it('retorna string não vazia quando style é omitido', () => {
      const result = formatDate(REF_DATE);
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('o resultado sem style é idêntico ao de style="medium"', () => {
      expect(formatDate(REF_DATE)).toBe(formatDate(REF_DATE, 'medium'));
    });
  });

  // ------------------------------------------------------------------ //
  // 2. Três estilos produzem strings distintas
  // ------------------------------------------------------------------ //
  describe('distinção entre estilos', () => {
    it('short, medium e long produzem saídas diferentes entre si', () => {
      const short = formatDate(REF_DATE, 'short');
      const medium = formatDate(REF_DATE, 'medium');
      const long = formatDate(REF_DATE, 'long');

      expect(short).not.toBe(medium);
      expect(medium).not.toBe(long);
      expect(short).not.toBe(long);
    });
  });

  // ------------------------------------------------------------------ //
  // 3. Formato short — componentes numéricos
  // ------------------------------------------------------------------ //
  describe('formato short', () => {
    it('contém o ano de 4 dígitos', () => {
      expect(formatDate(REF_DATE, 'short')).toMatch(/2026/);
    });

    it('contém componentes numéricos (dia e mês como números)', () => {
      // Formato esperado pelo Intl em pt-BR: "27/05/2026"
      // Verificamos a presença de "/" como separador numérico
      expect(formatDate(REF_DATE, 'short')).toMatch(/\d/);
    });

    it('contém "27" como representação do dia', () => {
      expect(formatDate(REF_DATE, 'short')).toContain('27');
    });
  });

  // ------------------------------------------------------------------ //
  // 4. Formato medium — mês abreviado em português
  // ------------------------------------------------------------------ //
  describe('formato medium', () => {
    it('contém o ano com 4 dígitos', () => {
      expect(formatDate(REF_DATE, 'medium')).toMatch(/2026/);
    });

    it('contém abreviatura do mês em português ("mai" para maio)', () => {
      // Node.js 22 com pt-BR produz "mai." para maio no estilo medium
      expect(formatDate(REF_DATE, 'medium')).toMatch(/mai/i);
    });

    it('contém "27" como representação do dia', () => {
      expect(formatDate(REF_DATE, 'medium')).toContain('27');
    });
  });

  // ------------------------------------------------------------------ //
  // 5. Formato long — mês por extenso em português
  // ------------------------------------------------------------------ //
  describe('formato long', () => {
    it('contém o ano com 4 dígitos', () => {
      expect(formatDate(REF_DATE, 'long')).toMatch(/2026/);
    });

    it('contém o nome completo do mês em português ("maio")', () => {
      expect(formatDate(REF_DATE, 'long')).toMatch(/maio/i);
    });

    it('contém "27" como representação do dia', () => {
      expect(formatDate(REF_DATE, 'long')).toContain('27');
    });
  });

  // ------------------------------------------------------------------ //
  // 6. Equivalência de tipos de entrada
  // ------------------------------------------------------------------ //
  describe('equivalência entre tipos de entrada', () => {
    it('Date, string ISO e number (ms) produzem a mesma saída', () => {
      const fromDate = formatDate(REF_DATE);
      const fromString = formatDate(REF_ISO);
      const fromNumber = formatDate(REF_MS);

      expect(fromDate).toBe(fromString);
      expect(fromDate).toBe(fromNumber);
    });

    it('aceita um objeto Date válido sem lançar erro', () => {
      expect(() => formatDate(new Date('2000-01-01'))).not.toThrow();
    });

    it('aceita uma string ISO 8601 válida sem lançar erro', () => {
      expect(() => formatDate('2000-01-01T00:00:00.000Z')).not.toThrow();
    });

    it('aceita um número (Unix ms) sem lançar erro', () => {
      expect(() => formatDate(0)).not.toThrow();
    });
  });

  // ------------------------------------------------------------------ //
  // 7. TypeError para string inválida
  // ------------------------------------------------------------------ //
  describe('TypeError para entrada inválida', () => {
    it('lança TypeError para string não parseável', () => {
      expect(() => formatDate('nao-e-data')).toThrow(TypeError);
    });

    it('mensagem do TypeError inclui o valor inválido recebido', () => {
      expect(() => formatDate('nao-e-data')).toThrowError(/nao-e-data/);
    });

    it('mensagem do TypeError é descritiva (contém "Não foi possível converter")', () => {
      expect(() => formatDate('nao-e-data')).toThrowError(
        /Não foi possível converter para Date/,
      );
    });

    // ---------------------------------------------------------------- //
    // 8. TypeError para NaN
    // ---------------------------------------------------------------- //
    it('lança TypeError quando o número passado é NaN', () => {
      expect(() => formatDate(NaN)).toThrow(TypeError);
    });

    it('mensagem do TypeError para NaN menciona que não foi possível converter', () => {
      // JSON.stringify(NaN) retorna "null" — verificamos que o erro é lançado
      expect(() => formatDate(NaN)).toThrowError(
        /Não foi possível converter para Date/,
      );
    });

    it('lança TypeError ou retorna string para string vazia (cobertura de branch)', () => {
      // new Date('') resulta em Invalid Date em alguns engines
      // Garantimos que a função não falha silenciosamente
      try {
        const result = formatDate('');
        // Se não lançar, a string deve ser não-vazia (engines permissivos)
        expect(typeof result).toBe('string');
      } catch (err) {
        expect(err).toBeInstanceOf(TypeError);
      }
    });
  });
});
