import { describe, it, expect } from 'vitest';
import {
  JIRA_STATUSES,
  JIRA_TO_DB_STATUS,
  isKnownStatus,
  getStateOrder,
  handleTransition,
} from './state-machine';

// ─── isKnownStatus ────────────────────────────────────────────────────────────

describe('isKnownStatus', () => {
  it('retorna true para todos os 13 status canônicos', () => {
    for (const status of JIRA_STATUSES) {
      expect(isKnownStatus(status), `falhou para "${status}"`).toBe(true);
    }
  });

  it('retorna false para string desconhecida', () => {
    expect(isKnownStatus('Em Progresso')).toBe(false);
  });

  it('retorna false para string vazia', () => {
    expect(isKnownStatus('')).toBe(false);
  });

  it('é case-sensitive (backlog minúsculo não é reconhecido)', () => {
    expect(isKnownStatus('backlog')).toBe(false);
    expect(isKnownStatus('BACKLOG')).toBe(false);
  });
});

// ─── getStateOrder ────────────────────────────────────────────────────────────

describe('getStateOrder', () => {
  it('retorna 0 para Backlog (primeiro)', () => {
    expect(getStateOrder('Backlog')).toBe(0);
  });

  it('retorna 12 para Concluído (último)', () => {
    expect(getStateOrder('Concluído')).toBe(12);
  });

  it('retorna o índice correto para cada status', () => {
    JIRA_STATUSES.forEach((status, index) => {
      expect(getStateOrder(status), `índice errado para "${status}"`).toBe(index);
    });
  });

  it('retorna -1 para status desconhecido', () => {
    expect(getStateOrder('Desconhecido')).toBe(-1);
  });

  it('retorna -1 para string vazia', () => {
    expect(getStateOrder('')).toBe(-1);
  });

  it('Aguardando Aceite PRD é posterior a Em Refinamento', () => {
    expect(getStateOrder('Aguardando Aceite PRD')).toBeGreaterThan(getStateOrder('Em Refinamento'));
  });

  it('Concluído é posterior a todos os outros status', () => {
    const concludedOrder = getStateOrder('Concluído');
    for (const s of JIRA_STATUSES.filter((s) => s !== 'Concluído')) {
      expect(concludedOrder).toBeGreaterThan(getStateOrder(s));
    }
  });
});

// ─── handleTransition — invoke_agent ─────────────────────────────────────────

describe('handleTransition — invoke_agent', () => {
  it('"A Refinar" invoca agente PO e move para "Em Refinamento"', () => {
    const result = handleTransition('A Refinar');
    expect(result.type).toBe('invoke_agent');
    if (result.type !== 'invoke_agent') return;
    expect(result.agent).toBe('po');
    expect(result.moveTo).toBe('Em Refinamento');
    expect(result.description).toBeTruthy();
  });

  it('"PRD Aceito" invoca agente LT', () => {
    const result = handleTransition('PRD Aceito');
    expect(result.type).toBe('invoke_agent');
    if (result.type !== 'invoke_agent') return;
    expect(result.agent).toBe('lt');
  });

  it('"Plano Validado" invoca agente DEV e move para "Em Desenvolvimento"', () => {
    const result = handleTransition('Plano Validado');
    expect(result.type).toBe('invoke_agent');
    if (result.type !== 'invoke_agent') return;
    expect(result.agent).toBe('dev');
    expect(result.moveTo).toBe('Em Desenvolvimento');
  });

  it('"Em QA" invoca agente QA', () => {
    const result = handleTransition('Em QA');
    expect(result.type).toBe('invoke_agent');
    if (result.type !== 'invoke_agent') return;
    expect(result.agent).toBe('qa');
  });
});

// ─── handleTransition — human_gate ───────────────────────────────────────────

describe('handleTransition — human_gate', () => {
  const gates: Array<[string, number]> = [
    ['Aguardando Aceite PRD',   1],
    ['Aguardando Aceite Plano', 2],
    ['Aguardando Aceite Dev',   3],
    ['Aguardando Aceite QA',    4],
    ['Validação Final',         5],
  ];

  for (const [status, expectedGate] of gates) {
    it(`"${status}" retorna gate ${expectedGate}`, () => {
      const result = handleTransition(status);
      expect(result.type).toBe('human_gate');
      if (result.type !== 'human_gate') return;
      expect(result.gate).toBe(expectedGate);
      expect(result.description).toBeTruthy();
    });
  }
});

// ─── handleTransition — in_progress ──────────────────────────────────────────

describe('handleTransition — in_progress', () => {
  it('"Em Refinamento" retorna in_progress (agente PO trabalhando)', () => {
    expect(handleTransition('Em Refinamento').type).toBe('in_progress');
  });

  it('"Em Desenvolvimento" retorna in_progress (agentes DEV trabalhando)', () => {
    expect(handleTransition('Em Desenvolvimento').type).toBe('in_progress');
  });

  it('"Backlog" retorna in_progress (sem mapeamento explícito)', () => {
    // Backlog não está no TRANSITION_MAP — cai no fallback in_progress
    const result = handleTransition('Backlog');
    expect(result.type).toBe('in_progress');
    if (result.type !== 'in_progress') return;
    expect(result.description).toMatch(/Backlog/);
  });
});

// ─── handleTransition — terminal ─────────────────────────────────────────────

describe('handleTransition — terminal', () => {
  it('"Concluído" retorna terminal', () => {
    const result = handleTransition('Concluído');
    expect(result.type).toBe('terminal');
    if (result.type !== 'terminal') return;
    expect(result.description).toBeTruthy();
  });
});

// ─── handleTransition — unknown ──────────────────────────────────────────────

describe('handleTransition — unknown', () => {
  it('retorna unknown para status não reconhecido', () => {
    const result = handleTransition('Status Qualquer');
    expect(result.type).toBe('unknown');
    if (result.type !== 'unknown') return;
    expect(result.status).toBe('Status Qualquer');
  });

  it('retorna unknown para string vazia', () => {
    const result = handleTransition('');
    expect(result.type).toBe('unknown');
  });
});

// ─── JIRA_TO_DB_STATUS ────────────────────────────────────────────────────────

describe('JIRA_TO_DB_STATUS', () => {
  it('contém exatamente 13 mapeamentos (um por status)', () => {
    expect(Object.keys(JIRA_TO_DB_STATUS)).toHaveLength(13);
  });

  it('cobre todos os status de JIRA_STATUSES', () => {
    for (const status of JIRA_STATUSES) {
      expect(JIRA_TO_DB_STATUS[status], `faltando mapeamento para "${status}"`).toBeDefined();
    }
  });

  it('mapeia corretamente os status críticos', () => {
    expect(JIRA_TO_DB_STATUS['Backlog']).toBe('backlog');
    expect(JIRA_TO_DB_STATUS['A Refinar']).toBe('a_refinar');
    expect(JIRA_TO_DB_STATUS['Em Refinamento']).toBe('em_refinamento');
    expect(JIRA_TO_DB_STATUS['Aguardando Aceite PRD']).toBe('aguardando_aceite_prd');
    expect(JIRA_TO_DB_STATUS['PRD Aceito']).toBe('prd_aceito');
    expect(JIRA_TO_DB_STATUS['Aguardando Aceite Plano']).toBe('aguardando_aceite_plano');
    expect(JIRA_TO_DB_STATUS['Plano Validado']).toBe('plano_validado');
    expect(JIRA_TO_DB_STATUS['Em Desenvolvimento']).toBe('em_desenvolvimento');
    expect(JIRA_TO_DB_STATUS['Aguardando Aceite Dev']).toBe('aguardando_aceite_dev');
    expect(JIRA_TO_DB_STATUS['Em QA']).toBe('em_qa');
    expect(JIRA_TO_DB_STATUS['Aguardando Aceite QA']).toBe('aguardando_aceite_qa');
    expect(JIRA_TO_DB_STATUS['Validação Final']).toBe('validacao_final');
    expect(JIRA_TO_DB_STATUS['Concluído']).toBe('concluido');
  });
});
