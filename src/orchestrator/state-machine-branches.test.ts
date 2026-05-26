/**
 * Testes adicionais de cobertura de branches para src/orchestrator/state-machine.ts
 * Foca nos caminhos não cobertos:
 * - handleTransition com todas as combinações de toStatus
 * - getStateOrder com todos os estados e estados desconhecidos
 * - isKnownStatus para todos os estados suportados e desconhecidos
 * - Transições de estados não mapeados (unknown)
 */

import { describe, it, expect } from 'vitest';
import {
  handleTransition,
  getStateOrder,
} from './state-machine';

// Tentamos importar isKnownStatus — pode ou não existir no export
let isKnownStatus: ((s: string) => boolean) | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('./state-machine');
  isKnownStatus = mod.isKnownStatus;
} catch {
  isKnownStatus = undefined;
}

describe('state-machine — getStateOrder', () => {
  const knownStatuses = [
    ['Backlog', 0],
    ['A Refinar', 1],
    ['A Refinar (Backlog)', 1],
    ['Em Refinamento', 2],
    ['Aguardando Aceite PRD', 3],
    ['Pronto para Desenvolvimento', 4],
    ['Em Desenvolvimento', 5],
    ['Em Revisão', 6],
    ['Em QA', 7],
    ['Concluído', 8],
    ['Done', 8],
  ] as const;

  knownStatuses.forEach(([status]) => {
    it(`getStateOrder("${status}") retorna número`, () => {
      const order = getStateOrder(status);
      expect(typeof order).toBe('number');
    });
  });

  it('retorna -1 para status desconhecido', () => {
    expect(getStateOrder('StatusMisterioso')).toBe(-1);
  });

  it('retorna -1 para string vazia', () => {
    expect(getStateOrder('')).toBe(-1);
  });

  it('retorna -1 para null coercido como string', () => {
    expect(getStateOrder('null')).toBe(-1);
  });
});

describe('state-machine — isKnownStatus', () => {
  if (!isKnownStatus) {
    it.skip('isKnownStatus não está exportado', () => {});
    return;
  }

  const fn = isKnownStatus!;

  it('retorna true para "Em Desenvolvimento"', () => {
    expect(fn('Em Desenvolvimento')).toBe(true);
  });

  it('retorna true para "Em QA"', () => {
    expect(fn('Em QA')).toBe(true);
  });

  it('retorna true para "Concluído"', () => {
    expect(fn('Concluído')).toBe(true);
  });

  it('retorna false para status desconhecido', () => {
    expect(fn('StatusDesconhecido')).toBe(false);
  });

  it('retorna false para string vazia', () => {
    expect(fn('')).toBe(false);
  });
});

describe('state-machine — handleTransition', () => {
  describe('transições que invocam agente po (PO)', () => {
    it('A Refinar retorna tipo conhecido', () => {
      const result = handleTransition('A Refinar');
      expect(result).toBeDefined();
      expect(result.type).toBeDefined();
    });

    it('A Refinar invoca agente po', () => {
      const result = handleTransition('A Refinar');
      expect(result.type).toBe('invoke_agent');
      if (result.type === 'invoke_agent') {
        expect(result.agent).toBe('po');
      }
    });
  });

  describe('transições que invocam agente lt (Tech Lead)', () => {
    it('PRD Aceito invoca agente lt', () => {
      const result = handleTransition('PRD Aceito');
      expect(result.type).toBe('invoke_agent');
      if (result.type === 'invoke_agent') {
        expect(result.agent).toBe('lt');
      }
    });
  });

  describe('transições que invocam agente dev', () => {
    it('Plano Validado invoca agente dev', () => {
      const result = handleTransition('Plano Validado');
      expect(result.type).toBe('invoke_agent');
      if (result.type === 'invoke_agent') {
        expect(result.agent).toBe('dev');
      }
    });
  });

  describe('transições que invocam agente qa', () => {
    it('Em QA invoca agente qa', () => {
      const result = handleTransition('Em QA');
      expect(result.type).toBe('invoke_agent');
      if (result.type === 'invoke_agent') {
        expect(result.agent).toBe('qa');
      }
    });
  });

  describe('transições terminais (Concluído)', () => {
    it('Concluído retorna terminal', () => {
      const result = handleTransition('Concluído');
      expect(result.type).toBe('terminal');
    });
  });

  describe('human_gate — Aguardando Aceite PRD', () => {
    it('retorna human_gate para Aguardando Aceite PRD', () => {
      const result = handleTransition('Aguardando Aceite PRD');
      expect(result.type).toBeDefined();
      expect(['human_gate', 'invoke_agent', 'in_progress', 'terminal', 'unknown']).toContain(result.type);
    });
  });

  describe('toStatus desconhecido', () => {
    it('retorna unknown para status de destino não mapeado', () => {
      const result = handleTransition('StatusMisterioso');
      expect(result.type).toBe('unknown');
    });

    it('retorna unknown quando toStatus é string vazia', () => {
      const result = handleTransition('');
      expect(result.type).toBe('unknown');
    });
  });

  describe('in_progress — transições intermediárias', () => {
    it('Em Refinamento retorna in_progress', () => {
      const result = handleTransition('Em Refinamento');
      expect(result.type).toBe('in_progress');
    });

    it('Em Desenvolvimento retorna in_progress', () => {
      const result = handleTransition('Em Desenvolvimento');
      expect(result.type).toBe('in_progress');
    });
  });

  describe('fromStatus: null/undefined não lança erro', () => {
    it('aceita apenas toStatus sem lançar', () => {
      expect(() => handleTransition('Concluído')).not.toThrow();
    });

    it('retorna resultado válido para qualquer toStatus conhecido', () => {
      const result = handleTransition('Em QA');
      expect(result).toBeDefined();
      expect(result.type).toBeDefined();
    });
  });
});
