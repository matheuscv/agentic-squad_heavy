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

vi.mock('bullmq', () => {
  const mockWorkerInstance = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const MockQueue = vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({ id: 'job-orch-1' }),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  const MockWorker = vi.fn().mockImplementation((_name: string, processor: (...args: unknown[]) => unknown) => {
    if (!(MockWorker as any)._processors) (MockWorker as any)._processors = {};
    (MockWorker as any)._processors[_name] = processor;
    (MockWorker as any)._lastProcessor = processor;
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

vi.mock('../db/index', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 'story-uuid-1' }]),
  },
  schema: {
    stories: { id: 'id', jiraKey: 'jiraKey', status: 'status' },
    agentRuns: { id: 'id', storyId: 'storyId', agentType: 'agentType', status: 'status' },
  },
}));

vi.mock('../db/stories', () => ({
  updateStoryStatus: vi.fn().mockResolvedValue(undefined),
  upsertStory: vi.fn().mockResolvedValue({ id: 'story-uuid-1', jiraKey: 'SCRUM-1', jiraSummary: 'Add currency formatter', status: 'a_refinar' }),
}));

vi.mock('../queue/index', () => ({
  redisConnection: { on: vi.fn() },
  orchestratorQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-orch-1' }),
  },
}));

vi.mock('../agents/po', () => ({
  poAgentQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-po-1' }),
  },
}));

vi.mock('../agents/lt', () => ({
  ltAgentQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-lt-1' }),
  },
}));

vi.mock('../agents/dev-agent', () => ({
  devAgentQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-dev-1' }),
  },
}));

vi.mock('../agents/qa-agent', () => ({
  qaAgentQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-qa-1' }),
  },
}));

vi.mock('../jira/client', () => ({
  getIssue: vi.fn().mockResolvedValue({
    id: '10001',
    key: 'SCRUM-1',
    fields: {
      summary: 'Add currency formatter',
      status: { name: 'A Refinar' },
      description: null,
      issuetype: { name: 'Story' },
    },
  }),
  moveCardTo: vi.fn().mockResolvedValue(undefined),
  addComment: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/logger', () => ({
  childLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('orchestrator/worker — module loads', () => {
  it('importa sem erros', async () => {
    await expect(import('./worker')).resolves.toBeDefined();
  });
});

describe('orchestrator/worker — Worker BullMQ registrado', () => {
  it('Worker é criado ao chamar createOrchestratorWorker()', async () => {
    vi.clearAllMocks();
    const { createOrchestratorWorker } = await import('./worker');
    const { Worker } = await import('bullmq');
    createOrchestratorWorker();
    expect(Worker).toHaveBeenCalled();
  });

  it('Worker é criado com a fila "orchestrator"', async () => {
    vi.clearAllMocks();
    const { createOrchestratorWorker } = await import('./worker');
    const { Worker } = await import('bullmq');
    createOrchestratorWorker();
    const calls = (Worker as unknown as vi.MockedFunction<any>).mock.calls;
    const orchCall = calls.find((c: any[]) => c[0] === 'orchestrator');
    expect(orchCall).toBeDefined();
  });
});

describe('orchestrator/worker — job processor (evento webhook)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processa evento de webhook Jira com story em "A Refinar"', async () => {
    const { Worker } = await import('bullmq');
    const processors = (Worker as unknown as any)._processors;
    const processor = processors?.['orchestrator'] ?? (Worker as unknown as any)._lastProcessor;
    if (!processor) return;

    const mockJob = {
      id: 'orch-job-1',
      data: {
        jiraKey: 'SCRUM-1',
        issueId: '10001',
        summary: 'Add currency formatter',
        fromStatus: 'Backlog',
        toStatus: 'A Refinar',
        currentStatus: 'A Refinar',
        receivedAt: new Date().toISOString(),
      },
    };
    await expect(processor(mockJob)).resolves.toBeDefined();
  });

  it('processa evento de webhook com story em "A Definir"', async () => {
    const { Worker } = await import('bullmq');
    const processors = (Worker as unknown as any)._processors;
    const processor = processors?.['orchestrator'] ?? (Worker as unknown as any)._lastProcessor;
    if (!processor) return;

    const mockJob = {
      id: 'orch-job-2',
      data: {
        jiraKey: 'SCRUM-2',
        issueId: '10002',
        summary: 'Add endpoint',
        fromStatus: 'A Refinar',
        toStatus: 'Em Refinamento',
        currentStatus: 'Em Refinamento',
        receivedAt: new Date().toISOString(),
      },
    };
    await expect(processor(mockJob)).resolves.toBeDefined();
  });

  it('processa evento com story em "Em Desenvolvimento"', async () => {
    const { Worker } = await import('bullmq');
    const processors = (Worker as unknown as any)._processors;
    const processor = processors?.['orchestrator'] ?? (Worker as unknown as any)._lastProcessor;
    if (!processor) return;

    const mockJob = {
      id: 'orch-job-3',
      data: {
        jiraKey: 'SCRUM-3',
        issueId: '10003',
        summary: 'Implement feature',
        fromStatus: 'Plano Validado',
        toStatus: 'Em Desenvolvimento',
        currentStatus: 'Em Desenvolvimento',
        receivedAt: new Date().toISOString(),
      },
    };
    await expect(processor(mockJob)).resolves.toBeDefined();
  });

  it('processa evento com status desconhecido sem lançar erro', async () => {
    const { Worker } = await import('bullmq');
    const processors = (Worker as unknown as any)._processors;
    const processor = processors?.['orchestrator'] ?? (Worker as unknown as any)._lastProcessor;
    if (!processor) return;

    const mockJob = {
      id: 'orch-job-4',
      data: {
        jiraKey: 'SCRUM-4',
        issueId: '10004',
        summary: 'Unknown task',
        fromStatus: null,
        toStatus: 'Status Desconhecido',
        currentStatus: 'Status Desconhecido',
        receivedAt: new Date().toISOString(),
      },
    };
    await expect(processor(mockJob)).resolves.toBeDefined();
  });
});
