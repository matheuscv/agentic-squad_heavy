/**
 * Testes adicionais de cobertura de branches para orchestrator/worker.ts
 * Foca nos caminhos não cobertos pelos testes existentes:
 * - transição retroativa (regressão)
 * - action.type: human_gate, in_progress, terminal, unknown
 * - dispatchAgent: com e sem moveTo, erro no moveCardTo
 * - diferentes agentes (po, lt, dev, qa)
 * - retry loop dos agentes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks de infraestrutura ──────────────────────────────────────────────────

vi.mock('ioredis', () => {
  const MockIORedis = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    subscribe: vi.fn(),
  }));
  return { default: MockIORedis };
});

const mockWorkerProcessor = { fn: null as ((...args: unknown[]) => unknown) | null };

vi.mock('bullmq', () => {
  const mockWorkerInstance = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const MockQueue = vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  const MockWorker = vi.fn().mockImplementation((_name: string, processor: (...args: unknown[]) => unknown) => {
    mockWorkerProcessor.fn = processor;
    return mockWorkerInstance;
  });
  const MockQueueEvents = vi.fn().mockImplementation(() => ({
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  }));
  return { Queue: MockQueue, Worker: MockWorker, QueueEvents: MockQueueEvents };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue('eq-condition'),
  and: vi.fn().mockReturnValue('and-condition'),
}));

const mockDbInsert = {
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([{ id: 'agent-run-uuid-1' }]),
};

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnValue(mockDbInsert),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([{ id: 'story-uuid-1' }]),
};

vi.mock('../db/index', () => ({
  db: mockDb,
  schema: {
    stories: { id: 'id', jiraKey: 'jiraKey', status: 'status' },
    agentRuns: { id: 'id', storyId: 'storyId', agentType: 'agentType', status: 'status' },
  },
}));

const mockUpsertStory = vi.fn().mockResolvedValue({
  id: 'story-uuid-1',
  jiraKey: 'SCRUM-16',
  jiraSummary: 'Adicionar formatCurrency',
  status: 'a_refinar',
});

vi.mock('../db/stories', () => ({
  updateStoryStatus: vi.fn().mockResolvedValue(undefined),
  upsertStory: mockUpsertStory,
}));

vi.mock('../queue/index', () => ({
  redisConnection: { on: vi.fn() },
  orchestratorQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-orch-1' }),
  },
}));

const mockPoAdd = vi.fn().mockResolvedValue({ id: 'job-po-1' });
vi.mock('../agents/po', () => ({
  poAgentQueue: { add: mockPoAdd },
}));

const mockLtAdd = vi.fn().mockResolvedValue({ id: 'job-lt-1' });
vi.mock('../agents/lt', () => ({
  ltAgentQueue: { add: mockLtAdd },
}));

const mockDevAdd = vi.fn().mockResolvedValue({ id: 'job-dev-1' });
vi.mock('../agents/dev-agent', () => ({
  devAgentQueue: { add: mockDevAdd },
}));

const mockQaAdd = vi.fn().mockResolvedValue({ id: 'job-qa-1' });
vi.mock('../agents/qa-agent', () => ({
  qaAgentQueue: { add: mockQaAdd },
}));

const mockMoveCardTo = vi.fn().mockResolvedValue(undefined);
const mockAddComment = vi.fn().mockResolvedValue(undefined);
vi.mock('../jira/client', () => ({
  moveCardTo: mockMoveCardTo,
  addComment: mockAddComment,
}));

const mockLog = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};
vi.mock('../lib/logger', () => ({
  childLogger: vi.fn().mockReturnValue(mockLog),
}));

// ─── Mock state-machine ───────────────────────────────────────────────────────

const mockHandleTransition = vi.fn();
const mockGetStateOrder = vi.fn();

vi.mock('./state-machine', () => ({
  handleTransition: mockHandleTransition,
  getStateOrder: mockGetStateOrder,
  type: undefined,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeJob(data: Record<string, unknown>) {
  return { data, id: 'job-1' };
}

async function getProcessor() {
  const { createOrchestratorWorker } = await import('./worker');
  createOrchestratorWorker();
  return mockWorkerProcessor.fn!;
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('orchestrator/worker — branches adicionais', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup do db.insert
    mockDbInsert.values.mockReturnThis();
    mockDbInsert.returning.mockResolvedValue([{ id: 'agent-run-uuid-1' }]);
    mockDb.insert.mockReturnValue(mockDbInsert);

    mockUpsertStory.mockResolvedValue({
      id: 'story-uuid-1',
      jiraKey: 'SCRUM-16',
      jiraSummary: 'Adicionar formatCurrency',
      status: 'a_refinar',
    });
  });

  describe('idempotência — transições retroativas', () => {
    it('retorna skipped quando toOrder <= fromOrder (transição retroativa)', async () => {
      // fromOrder=5 > toOrder=3 → retroativa
      mockGetStateOrder.mockReturnValueOnce(5).mockReturnValueOnce(3);
      mockHandleTransition.mockReturnValue({ type: 'in_progress' });

      const processor = await getProcessor();
      const job = makeJob({
        jiraKey: 'SCRUM-16',
        fromStatus: 'Em Desenvolvimento',
        toStatus: 'A Refinar',
        summary: 'test',
      });

      const result = await processor(job);
      expect(result).toEqual({ skipped: true, reason: 'retrograde_transition' });
    });

    it('retorna skipped quando toOrder === fromOrder (sem progresso)', async () => {
      mockGetStateOrder.mockReturnValueOnce(3).mockReturnValueOnce(3);
      mockHandleTransition.mockReturnValue({ type: 'in_progress' });

      const processor = await getProcessor();
      const job = makeJob({
        jiraKey: 'SCRUM-16',
        fromStatus: 'Em Desenvolvimento',
        toStatus: 'Em Desenvolvimento',
        summary: 'test',
      });

      const result = await processor(job);
      expect(result).toEqual({ skipped: true, reason: 'retrograde_transition' });
    });

    it('não retorna skipped quando getStateOrder retorna -1 (status desconhecido)', async () => {
      mockGetStateOrder.mockReturnValue(-1);
      mockHandleTransition.mockReturnValue({ type: 'terminal' });

      const processor = await getProcessor();
      const job = makeJob({
        jiraKey: 'SCRUM-16',
        fromStatus: 'StatusDesconhecido',
        toStatus: 'OutroDesconhecido',
        summary: 'test',
      });

      const result = await processor(job);
      // Não é skipped — deve processar normalmente
      expect(result).toHaveProperty('action');
    });

    it('processa normalmente quando fromStatus ou toStatus são nulos', async () => {
      mockHandleTransition.mockReturnValue({ type: 'terminal' });

      const processor = await getProcessor();
      const job = makeJob({
        jiraKey: 'SCRUM-16',
        fromStatus: null,
        toStatus: null,
        summary: 'test',
      });

      const result = await processor(job);
      expect(result).toHaveProperty('action');
    });
  });

  describe('tipos de ação (action.type)', () => {
    it('action.type === human_gate: loga info e não despacha agente', async () => {
      mockGetStateOrder.mockReturnValue(0);
      mockHandleTransition.mockReturnValue({ type: 'human_gate', gate: 'aceite_prd' });

      const processor = await getProcessor();
      const job = makeJob({
        jiraKey: 'SCRUM-16',
        fromStatus: null,
        toStatus: 'Aguardando Aceite PRD',
        summary: 'test',
      });

      const result = await processor(job);
      expect(result).toMatchObject({ action: { type: 'human_gate', gate: 'aceite_prd' } });
      expect(mockPoAdd).not.toHaveBeenCalled();
      expect(mockDevAdd).not.toHaveBeenCalled();
    });

    it('action.type === in_progress: loga debug e retorna', async () => {
      mockGetStateOrder.mockReturnValue(0);
      mockHandleTransition.mockReturnValue({ type: 'in_progress' });

      const processor = await getProcessor();
      const job = makeJob({
        jiraKey: 'SCRUM-16',
        fromStatus: null,
        toStatus: 'Em Desenvolvimento',
        summary: 'test',
      });

      const result = await processor(job);
      expect(result).toMatchObject({ action: { type: 'in_progress' } });
    });

    it('action.type === terminal: loga info e retorna', async () => {
      mockGetStateOrder.mockReturnValue(0);
      mockHandleTransition.mockReturnValue({ type: 'terminal' });

      const processor = await getProcessor();
      const job = makeJob({
        jiraKey: 'SCRUM-16',
        fromStatus: null,
        toStatus: 'Concluído',
        summary: 'test',
      });

      const result = await processor(job);
      expect(result).toMatchObject({ action: { type: 'terminal' } });
    });

    it('action.type === unknown: loga warn e retorna', async () => {
      mockGetStateOrder.mockReturnValue(0);
      mockHandleTransition.mockReturnValue({ type: 'unknown', status: 'StatusMisterioso' });

      const processor = await getProcessor();
      const job = makeJob({
        jiraKey: 'SCRUM-16',
        fromStatus: null,
        toStatus: 'StatusMisterioso',
        summary: 'test',
      });

      const result = await processor(job);
      expect(result).toMatchObject({ action: { type: 'unknown' } });
      expect(mockLog.warn).toHaveBeenCalled();
    });
  });

  describe('dispatchAgent — diferentes agentes', () => {
    it('despacha agente po sem moveTo', async () => {
      mockGetStateOrder.mockReturnValue(0);
      mockHandleTransition.mockReturnValue({ type: 'invoke_agent', agent: 'po' });

      const processor = await getProcessor();
      const job = makeJob({
        jiraKey: 'SCRUM-16',
        fromStatus: null,
        toStatus: 'A Refinar',
        summary: 'test',
      });

      await processor(job);
      expect(mockPoAdd).toHaveBeenCalled();
      expect(mockMoveCardTo).not.toHaveBeenCalled();
    });

    it('despacha agente po com moveTo — chama moveCardTo', async () => {
      mockGetStateOrder.mockReturnValue(0);
      mockHandleTransition.mockReturnValue({
        type: 'invoke_agent',
        agent: 'po',
        moveTo: 'Em Refinamento',
      });

      const processor = await getProcessor();
      const job = makeJob({
        jiraKey: 'SCRUM-16',
        fromStatus: null,
        toStatus: 'A Refinar',
        summary: 'test',
      });

      await processor(job);
      expect(mockMoveCardTo).toHaveBeenCalledWith('SCRUM-16', 'Em Refinamento');
      expect(mockPoAdd).toHaveBeenCalled();
    });

    it('despacha agente lt', async () => {
      mockGetStateOrder.mockReturnValue(0);
      mockHandleTransition.mockReturnValue({ type: 'invoke_agent', agent: 'lt' });

      const processor = await getProcessor();
      const job = makeJob({
        jiraKey: 'SCRUM-16',
        fromStatus: null,
        toStatus: 'Em Refinamento',
        summary: 'test',
      });

      await processor(job);
      expect(mockLtAdd).toHaveBeenCalled();
    });

    it('despacha agente dev', async () => {
      mockGetStateOrder.mockReturnValue(0);
      mockHandleTransition.mockReturnValue({ type: 'invoke_agent', agent: 'dev' });

      const processor = await getProcessor();
      const job = makeJob({
        jiraKey: 'SCRUM-16',
        fromStatus: null,
        toStatus: 'Em Desenvolvimento',
        summary: 'test',
      });

      await processor(job);
      expect(mockDevAdd).toHaveBeenCalled();
    });

    it('despacha agente qa', async () => {
      mockGetStateOrder.mockReturnValue(0);
      mockHandleTransition.mockReturnValue({ type: 'invoke_agent', agent: 'qa' });

      const processor = await getProcessor();
      const job = makeJob({
        jiraKey: 'SCRUM-16',
        fromStatus: null,
        toStatus: 'Em QA',
        summary: 'test',
      });

      await processor(job);
      expect(mockQaAdd).toHaveBeenCalled();
    });

    it('lança erro quando moveCardTo falha', async () => {
      mockGetStateOrder.mockReturnValue(0);
      mockHandleTransition.mockReturnValue({
        type: 'invoke_agent',
        agent: 'po',
        moveTo: 'Em Refinamento',
      });
      mockMoveCardTo.mockRejectedValueOnce(new Error('Jira API error'));

      const processor = await getProcessor();
      const job = makeJob({
        jiraKey: 'SCRUM-16',
        fromStatus: null,
        toStatus: 'A Refinar',
        summary: 'test',
      });

      await expect(processor(job)).rejects.toThrow('Jira API error');
      expect(mockLog.error).toHaveBeenCalled();
    });

    it('agente desconhecido não despacha nenhuma fila conhecida', async () => {
      mockGetStateOrder.mockReturnValue(0);
      mockHandleTransition.mockReturnValue({ type: 'invoke_agent', agent: 'unknown_agent' });

      const processor = await getProcessor();
      const job = makeJob({
        jiraKey: 'SCRUM-16',
        fromStatus: null,
        toStatus: 'StatusQualquer',
        summary: 'test',
      });

      // Deve processar sem lançar erro e sem chamar as filas conhecidas
      await processor(job);
      expect(mockPoAdd).not.toHaveBeenCalled();
      expect(mockLtAdd).not.toHaveBeenCalled();
      expect(mockDevAdd).not.toHaveBeenCalled();
      expect(mockQaAdd).not.toHaveBeenCalled();
    });
  });

  describe('retorno do processJob', () => {
    it('retorna action e storyId quando processamento é bem-sucedido', async () => {
      mockGetStateOrder.mockReturnValue(0);
      mockHandleTransition.mockReturnValue({ type: 'terminal' });

      const processor = await getProcessor();
      const job = makeJob({
        jiraKey: 'SCRUM-16',
        fromStatus: null,
        toStatus: 'Concluído',
        summary: 'test',
      });

      const result = await processor(job) as Record<string, unknown>;
      expect(result.storyId).toBe('story-uuid-1');
      expect(result.action).toBeDefined();
    });
  });
});
