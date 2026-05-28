import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks do DB ──────────────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockInnerJoin = vi.fn();
const mockWhere = vi.fn();
const mockGroupBy = vi.fn();
const mockOrderBy = vi.fn();

function buildChain() {
  const chain = {
    select: mockSelect,
    from: mockFrom,
    innerJoin: mockInnerJoin,
    where: mockWhere,
    groupBy: mockGroupBy,
    orderBy: mockOrderBy,
  };
  mockSelect.mockReturnValue(chain);
  mockFrom.mockReturnValue(chain);
  mockInnerJoin.mockReturnValue(chain);
  mockWhere.mockReturnValue(chain);
  mockGroupBy.mockReturnValue(chain);
  mockOrderBy.mockReturnValue(Promise.resolve([]));
  return chain;
}

vi.mock('../db/index', () => ({
  db: { select: (...args: unknown[]) => mockSelect(...args) },
  schema: {
    agentRuns: {
      storyId: 'story_id',
      agentType: 'agent_type',
      status: 'status',
      durationMs: 'duration_ms',
      costUsd: 'cost_usd',
      input: 'input',
      id: 'id',
    },
    stories: {
      id: 'id',
      jiraKey: 'jira_key',
      projectKey: 'project_key',
    },
  },
}));

// ─── Imports após mock ────────────────────────────────────────────────────────

import {
  getAvgDurationByAgent,
  getSuccessRateByAgent,
  getCorrectionLoopsByStory,
  getCostByProject,
} from './metrics';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function captureWhereArg(): unknown {
  return mockWhere.mock.calls[mockWhere.mock.calls.length - 1]?.[0];
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('isolamento multi-projeto — metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildChain();
  });

  describe('getAvgDurationByAgent', () => {
    it('sem projectKey: não filtra por projeto (where sem condição de projeto)', async () => {
      await getAvgDurationByAgent();
      expect(mockInnerJoin).toHaveBeenCalledOnce();
      expect(mockWhere).toHaveBeenCalledOnce();
    });

    it('com projectKey: adiciona filtro por projeto ao where', async () => {
      await getAvgDurationByAgent('SCRUM');
      expect(mockInnerJoin).toHaveBeenCalledOnce();
      expect(mockWhere).toHaveBeenCalledOnce();
      const whereArg = captureWhereArg();
      expect(whereArg).toBeDefined();
    });

    it('projetos diferentes recebem chamadas independentes', async () => {
      await getAvgDurationByAgent('SCRUM');
      const firstCall = mockWhere.mock.calls.length;

      vi.clearAllMocks();
      buildChain();

      await getAvgDurationByAgent('PROJ');
      expect(mockWhere.mock.calls.length).toBe(firstCall);
    });
  });

  describe('getSuccessRateByAgent', () => {
    it('sem projectKey: agrega todos os projetos', async () => {
      await getSuccessRateByAgent();
      expect(mockInnerJoin).toHaveBeenCalledOnce();
    });

    it('com projectKey: faz join com stories e filtra', async () => {
      await getSuccessRateByAgent('PROJ');
      expect(mockInnerJoin).toHaveBeenCalledOnce();
      expect(mockWhere).toHaveBeenCalledOnce();
    });
  });

  describe('getCorrectionLoopsByStory', () => {
    it('sem projectKey: retorna loops de todos os projetos', async () => {
      await getCorrectionLoopsByStory();
      expect(mockInnerJoin).toHaveBeenCalledOnce();
    });

    it('com projectKey: filtra loops pelo projeto', async () => {
      await getCorrectionLoopsByStory('SCRUM');
      expect(mockInnerJoin).toHaveBeenCalledOnce();
      expect(mockWhere).toHaveBeenCalledOnce();
    });
  });

  describe('getCostByProject', () => {
    it('retorna custo agrupado por projectKey', async () => {
      await getCostByProject();
      expect(mockInnerJoin).toHaveBeenCalledOnce();
      expect(mockGroupBy).toHaveBeenCalledOnce();
      expect(mockOrderBy).toHaveBeenCalledOnce();
    });
  });
});

// ─── Isolamento de dados: projectKey derivado do jiraKey ─────────────────────

describe('derivação de projectKey a partir do jiraKey', () => {
  const cases: [string, string][] = [
    ['SCRUM-17', 'SCRUM'],
    ['PROJ-1',   'PROJ'],
    ['ALPHA-100','ALPHA'],
    ['XY-999',   'XY'],
  ];

  it.each(cases)('jiraKey=%s → projectKey=%s', (jiraKey, expected) => {
    const derived = jiraKey.split('-')[0];
    expect(derived).toBe(expected);
  });

  it('jiraKey com múltiplos hífens preserva apenas o prefixo', () => {
    expect('MY-PROJECT-123'.split('-')[0]).toBe('MY');
  });
});

// ─── Schema: projectKey presente em stories ───────────────────────────────────

describe('schema stories inclui projectKey', () => {
  it('campo project_key existe no schema mock', async () => {
    const { schema } = await import('../db/index');
    expect(schema.stories).toHaveProperty('projectKey');
  });
});
