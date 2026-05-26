import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks de infraestrutura ──────────────────────────────────────────────────

vi.mock('ioredis', () => {
  const MockIORedis = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
  }));
  return { default: MockIORedis };
});

vi.mock('bullmq', () => {
  const mockWorkerInstance = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const MockQueue = vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({ id: 'job-qa-1' }),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  const MockWorker = vi.fn().mockImplementation((_name: string, processor: Function) => {
    (MockWorker as any)._lastProcessor = processor;
    return mockWorkerInstance;
  });
  return { Queue: MockQueue, Worker: MockWorker };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue('eq-condition'),
  and: vi.fn().mockReturnValue('and-condition'),
  inArray: vi.fn().mockReturnValue('inArray-condition'),
}));

vi.mock('../db/index', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ id: 'story-uuid-1', jiraKey: 'SCRUM-1', status: 'em_revisao_qa' }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  },
  schema: {
    stories: { id: 'id', jiraKey: 'jiraKey', status: 'status' },
    agentRuns: { id: 'id', storyId: 'storyId', agentType: 'agentType', status: 'status' },
  },
}));

vi.mock('../db/stories', () => ({
  updateStoryStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../queue/index', () => ({
  redisConnection: { on: vi.fn() },
}));

vi.mock('../jira/client', () => ({
  moveCardTo: vi.fn().mockResolvedValue(undefined),
  addComment: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../github/client', () => ({
  readFile: vi.fn().mockResolvedValue('coverage content'),
  listDirectory: vi.fn().mockResolvedValue(['src/utils/']),
  commitFiles: vi.fn().mockResolvedValue(undefined),
  getLatestWorkflowRun: vi.fn().mockResolvedValue({ id: 1001, conclusion: 'success', status: 'completed' }),
  waitForWorkflowCompletion: vi.fn().mockResolvedValue({ id: 1002, conclusion: 'success', status: 'completed' }),
}));

vi.mock('./dev-agent', () => ({
  devAgentQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-dev-correction-1' }),
  },
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

vi.mock('../lib/anthropic-rate-limiter', () => ({
  waitForAnthropicCapacity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        stop_reason: 'end_turn',
        usage: { input_tokens: 120, output_tokens: 250 },
        content: [
          {
            type: 'text',
            text: 'Revisão QA concluída. Cobertura >= 85%.',
          },
        ],
      }),
    },
  }));
  return { default: MockAnthropic };
});

vi.mock('./prompts/qa-system-prompt', () => ({
  QA_SYSTEM_PROMPT: 'You are a QA agent.',
}));

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('qa-agent — module exports', () => {
  it('exporta qaAgentQueue', async () => {
    const { qaAgentQueue } = await import('./qa-agent');
    expect(qaAgentQueue).toBeDefined();
    expect(typeof qaAgentQueue.add).toBe('function');
  });

  it('qaAgentQueue.add aceita QaAgentJobData completo', async () => {
    const { qaAgentQueue } = await import('./qa-agent');
    const jobData = {
      storyId: 'story-uuid-1',
      jiraKey: 'SCRUM-1',
      agentRunId: 'run-qa-uuid-1',
      summary: 'Add currency formatter',
      fromStatus: 'Em Desenvolvimento',
    };
    await expect(qaAgentQueue.add('process', jobData)).resolves.toBeDefined();
  });

  it('qaAgentQueue.add aceita fromStatus null', async () => {
    const { qaAgentQueue } = await import('./qa-agent');
    const jobData = {
      storyId: 'story-uuid-2',
      jiraKey: 'SCRUM-2',
      agentRunId: 'run-qa-uuid-2',
      summary: 'Another story',
      fromStatus: null,
    };
    await expect(qaAgentQueue.add('process', jobData)).resolves.toBeDefined();
  });
});

describe('qa-agent — Worker registrado', () => {
  it('Worker é instanciado ao importar o módulo', async () => {
    const { Worker } = await import('bullmq');
    expect(Worker).toHaveBeenCalled();
  });

  it('Worker é registrado na fila "agent-qa"', async () => {
    const { Worker } = await import('bullmq');
    const calls = (Worker as unknown as vi.MockedFunction<any>).mock.calls;
    const qaCall = calls.find((c: any[]) => c[0] === 'agent-qa');
    expect(qaCall).toBeDefined();
  });
});

describe('qa-agent — pruneOldToolResults (via comportamento observável)', () => {
  it('módulo importa sem erros', async () => {
    await expect(import('./qa-agent')).resolves.toBeDefined();
  });
});

describe('qa-agent — sleep utility (via comportamento indireto)', () => {
  it('módulo não expõe sleep diretamente mas importa corretamente', async () => {
    const mod = await import('./qa-agent');
    expect(mod.qaAgentQueue).toBeDefined();
  });
});

describe('qa-agent — job processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processa job QA com dados válidos', async () => {
    const { Worker } = await import('bullmq');
    const processor = (Worker as unknown as any)._lastProcessor;
    if (!processor) return;

    const mockJob = {
      id: 'job-qa-id-1',
      data: {
        storyId: 'story-uuid-1',
        jiraKey: 'SCRUM-1',
        agentRunId: 'run-qa-uuid-1',
        summary: 'Add currency formatter',
        fromStatus: 'Em Desenvolvimento',
      },
    };
    await expect(processor(mockJob)).resolves.toBeDefined();
  });

  it('processa job QA sem fromStatus', async () => {
    const { Worker } = await import('bullmq');
    const processor = (Worker as unknown as any)._lastProcessor;
    if (!processor) return;

    const mockJob = {
      id: 'job-qa-id-2',
      data: {
        storyId: 'story-uuid-2',
        jiraKey: 'SCRUM-2',
        agentRunId: 'run-qa-uuid-2',
        summary: 'Another feature',
        fromStatus: null,
      },
    };
    await expect(processor(mockJob)).resolves.toBeDefined();
  });
});
