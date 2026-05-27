/**
 * Testes para o barrel export de src/utils/index.ts
 *
 * O objetivo é garantir que a re-exportação funcione corretamente,
 * cobrindo as linhas/statements do arquivo index.ts.
 */
import { describe, it, expect } from 'vitest';

// Importa a partir do barrel (index.ts), não diretamente de ./date
import { formatDate } from './index';

describe('src/utils/index — barrel export', () => {
  describe('re-exportação de formatDate', () => {
    it('exporta a função formatDate', () => {
      expect(typeof formatDate).toBe('function');
    });

    it('formatDate funciona corretamente quando importada via index', () => {
      const date = new Date('2026-05-27T12:00:00.000Z');
      const result = formatDate(date, 'short');
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      expect(result).toMatch(/2026/);
    });

    it('formatDate via index retorna o mesmo resultado que importação direta', async () => {
      const { formatDate: formatDateDirect } = await import('./date');
      const date = new Date('2026-05-27T12:00:00.000Z');
      expect(formatDate(date, 'medium')).toBe(formatDateDirect(date, 'medium'));
    });

    it('formatDate via index lança TypeError para data inválida', () => {
      expect(() => formatDate('data-invalida')).toThrow(TypeError);
      expect(() => formatDate('data-invalida')).toThrow(
        /Valor inválido para date/,
      );
    });

    it('formatDate via index suporta style="long"', () => {
      const date = new Date('2026-05-27T12:00:00.000Z');
      const result = formatDate(date, 'long');
      expect(result).toMatch(/maio/i);
    });
  });
});
