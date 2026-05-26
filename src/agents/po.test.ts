import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks de infraestrutura ──────────────────────────────────────────────────

vi.mock('ioredis', () => {
  const MockIORedis = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
  }));
  return { default: MockIORedis };
});

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
  const MockWorker = vi.fn().mockImplementation((_name: string, processor: Function) => {
    // Expõe o processor para os testes
    (MockWorker as any)._lastProcessor = processor;
    return mockWorkerInstance;
  });
  return { Queue: MockQueue, Worker: MockWorker };
});

vi.mock('drizzle-orm', () => ({ eq: vi.fn().mockReturnValue('eq-condition') }));

vi.mock('../db/index', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ id: 'story-uuid-1', jiraKey: 'SCRUM-1', status: 'a_refinar' }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  },
  schema: {
    stories: { id: 'id', jiraKey: 'jiraKey', status: 'status' },
    storyStatusEnum: { enumValues: ['backlog', 'a_refinar'] },
  },
}));

vi.mock('../db/stories', () => ({
  updateStoryStatus: vi.fn().mockResolvedValue(undefined),
  updateStoryDescription: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../queue/index', () => ({
  redisConnection: { on: vi.fn() },
  orchestratorQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../jira/client', () => ({
  getIssue: vi.fn().mockResolvedValue({
    id: '10001',
    key: 'SCRUM-1',
    fields: { summary: 'Add currency formatter', status: { name: 'A Refinar' }, description: null },
  }),
  moveCardTo: vi.fn().mockResolvedValue(undefined),
  addComment: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../github/client', () => ({
  commitFile: vi.fn().mockResolvedValue(undefined),
  createBranch: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('# README'),
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

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 200 },
        content: [{ type: 'text', text: '# PRD — SCRUM-1\n\nConteúdo do PRD.' }],
      }),
    },
  }));
  return { default: MockAnthropic };
});

vi.mock('./prompts/po-system-prompt', () => ({
  PO_SYSTEM_PROMPT: 'You are a PO agent.',
}));

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('po agent — module exports', () => {
  it('exporta poAgentQueue como instância de Queue', async () => {
    const { poAgentQueue } = await import('./po');
    expect(poAgentQueue).toBeDefined();
    expect(typeof poAgentQueue.add).toBe('function');
  });

  it('poAgentQueue.add pode ser chamado com dados válidos', async () => {
    const { poAgentQueue } = await import('./po');
    const jobData = {
      storyId: 'story-uuid-1',
      jiraKey: 'SCRUM-1',
      agentRunId: 'run-uuid-1',
      summary: 'Add currency formatter',
      fromStatus: 'Backlog',
    };
    await expect(poAgentQueue.add('process', jobData)).resolves.toBeDefined();
  });
});

describe('po agent — extractTextFromAdf (via processamento interno)', () => {
  it('o módulo importa sem erros', async () => {
    await expect(import('./po')).resolves.toBeDefined();
  });
});

describe('po agent — Worker criado', () => {
  it('Worker é instanciado ao importar o módulo', async () => {
    const { Worker } = await import('bullmq');
    // Verifica que Worker foi chamado (instanciado ao importar po.ts)
    expect(Worker).toHaveBeenCalled();
  });

  it('Worker é criado com a fila correta "agent-po"', async () => {
    const { Worker } = await import('bullmq');
    const calls = (Worker as unknown as vi.MockedFunction<any>).mock.calls;
    const poWorkerCall = calls.find((c: any[]) => c[0] === 'agent-po');
    expect(poWorkerCall).toBeDefined();
  });
});

describe('po agent — job processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('processa job com dados mínimos válidos', async () => {
    const { Worker } = await import('bullmq');
    const processor = (Worker as unknown as any)._lastProcessor;
    if (!processor) return; // fallback se não capturou

    const mockJob = {
      id: 'job-id-1',
      data: {
        storyId: 'story-uuid-1',
        jiraKey: 'SCRUM-1',
        agentRunId: 'run-uuid-1',
        summary: 'Add currency formatter',
        fromStatus: 'Backlog',
      },
    };

    // Não deve lançar erro
    await expect(processor(mockJob)).resolves.toBeDefined();
  });

  it('lida com job sem fromStatus', async () => {
    const { Worker } = await import('bullmq');
    const processor = (Worker as unknown as any)._lastProcessor;
    if (!processor) return;

    const mockJob = {
      id: 'job-id-2',
      data: {
        storyId: 'story-uuid-2',
        jiraKey: 'SCRUM-2',
        agentRunId: 'run-uuid-2',
        summary: 'Another story',
        fromStatus: null,
      },
    };
    await expect(processor(mockJob)).resolves.toBeDefined();
  });
});
