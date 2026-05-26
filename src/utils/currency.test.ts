import { describe, it, expect, afterEach, vi } from 'vitest';
import { formatCurrency } from './currency';
import type { CurrencyCode } from './currency';

// Garante isolamento entre testes — nenhum mock vaza entre casos
afterEach(() => {
  vi.clearAllMocks();
});

// ─── Suite principal ───────────────────────────────────────────────────────────

describe('formatCurrency', () => {
  // ── Caminho feliz — BRL ────────────────────────────────────────────────────

  it('(a) BRL: deve conter símbolo R$, separador decimal vírgula e separador de milhar ponto', () => {
    const result = formatCurrency(1234.5, 'BRL');

    expect(result).toContain('R$');
    // Separador decimal deve ser vírgula no locale pt-BR
    expect(result).toMatch(/,\d{2}/);
    // Separador de milhar deve ser ponto no locale pt-BR
    expect(result).toMatch(/1\.234/);
  });

  it('(b) USD: deve conter símbolo $ e não arredondar incorretamente 9999.99', () => {
    const result = formatCurrency(9999.99, 'USD');

    expect(result).toContain('$');
    // Garante que o valor 9999.99 aparece integralmente (sem arredondamento para 10000)
    expect(result).toMatch(/9[,.]?999/);
    expect(result).toMatch(/99$/);
  });

  it('(c) EUR: valor negativo deve conter indicação negativa e símbolo €', () => {
    const result = formatCurrency(-500, 'EUR');

    // Símbolo da moeda europeia presente
    expect(result).toContain('€');
    // Indicação de valor negativo (sinal ou prefixo de menos)
    expect(result).toMatch(/-|−/);
  });

  it('(d) BRL zero: deve retornar string terminando em ,00 sem lançar erro', () => {
    const result = formatCurrency(0, 'BRL');

    expect(result).toMatch(/,00$/);
    expect(result).toContain('R$');
  });

  it('(e) USD: deve arredondar para 2 casas decimais (1234.5678 → ...57)', () => {
    const result = formatCurrency(1234.5678, 'USD');

    // Intl.NumberFormat arredonda 1234.5678 → 1234.57
    expect(result).toMatch(/57$/);
    expect(result).not.toMatch(/5678/);
  });

  // ── Caminho de erro ────────────────────────────────────────────────────────

  it('(f) moeda inválida: deve lançar Error com mensagem "Moeda inválida: XYZ"', () => {
    expect(() => formatCurrency(100, 'XYZ' as CurrencyCode)).toThrowError(
      'Moeda inválida: XYZ',
    );
  });

  // ── Cobertura adicional de branches ───────────────────────────────────────

  it('EUR: valor positivo deve conter símbolo € e representação correta', () => {
    const result = formatCurrency(1000, 'EUR');

    expect(result).toContain('€');
    // Não deve ser negativo
    expect(result).not.toMatch(/^-/);
  });

  it('USD: valor zero deve conter $ e terminar com casas decimais zeradas', () => {
    const result = formatCurrency(0, 'USD');

    expect(result).toContain('$');
    // en-US: "$0.00"
    expect(result).toMatch(/\.00$/);
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
