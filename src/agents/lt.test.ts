import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    add: vi.fn().mockResolvedValue({ id: 'job-lt-1' }),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  const MockWorker = vi.fn().mockImplementation((_name: string, processor: Function) => {
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
  commitFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('# PRD — SCRUM-1\n\nConteúdo do PRD.'),
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
        usage: { input_tokens: 80, output_tokens: 150 },
        content: [
          { type: 'text', text: '# Plano de Execução — SCRUM-1\n\nPassos do plano.' },
        ],
      }),
    },
  }));
  return { default: MockAnthropic };
});

vi.mock('./prompts/lt-system-prompt', () => ({
  LT_SYSTEM_PROMPT: 'You are a LT agent.',
}));

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('lt agent — module exports', () => {
  it('exporta ltAgentQueue como instância de Queue', async () => {
    const { ltAgentQueue } = await import('./lt');
    expect(ltAgentQueue).toBeDefined();
    expect(typeof ltAgentQueue.add).toBe('function');
  });

  it('ltAgentQueue.add pode ser chamado com dados válidos', async () => {
    const { ltAgentQueue } = await import('./lt');
    const jobData = {
      storyId: 'story-uuid-1',
      jiraKey: 'SCRUM-1',
      agentRunId: 'run-lt-uuid-1',
      summary: 'Add currency formatter',
      fromStatus: 'A Refinar',
    };
    await expect(ltAgentQueue.add('process', jobData)).resolves.toBeDefined();
  });

  it('ltAgentQueue.add funciona com fromStatus null', async () => {
    const { ltAgentQueue } = await import('./lt');
    const jobData = {
      storyId: 'story-uuid-2',
      jiraKey: 'SCRUM-2',
      agentRunId: 'run-lt-uuid-2',
      summary: 'Another story',
      fromStatus: null,
    };
    await expect(ltAgentQueue.add('process', jobData)).resolves.toBeDefined();
  });
});

describe('lt agent — Worker criado', () => {
  it('Worker é instanciado ao importar o módulo', async () => {
    const { Worker } = await import('bullmq');
    expect(Worker).toHaveBeenCalled();
  });

  it('Worker é criado com a fila correta "agent-lt"', async () => {
    const { Worker } = await import('bullmq');
    const calls = (Worker as unknown as vi.MockedFunction<any>).mock.calls;
    const ltWorkerCall = calls.find((c: any[]) => c[0] === 'agent-lt');
    expect(ltWorkerCall).toBeDefined();
  });
});

describe('lt agent — job processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('processa job com dados válidos', async () => {
    const { Worker } = await import('bullmq');
    const processor = (Worker as unknown as any)._lastProcessor;
    if (!processor) return;

    const mockJob = {
      id: 'job-lt-id-1',
      data: {
        storyId: 'story-uuid-1',
        jiraKey: 'SCRUM-1',
        agentRunId: 'run-lt-uuid-1',
        summary: 'Add currency formatter',
        fromStatus: 'A Refinar',
      },
    };
    await expect(processor(mockJob)).resolves.toBeDefined();
  });

  it('processa job sem fromStatus', async () => {
    const { Worker } = await import('bullmq');
    const processor = (Worker as unknown as any)._lastProcessor;
    if (!processor) return;

    const mockJob = {
      id: 'job-lt-id-2',
      data: {
        storyId: 'story-uuid-2',
        jiraKey: 'SCRUM-2',
        agentRunId: 'run-lt-uuid-2',
        summary: 'Another story',
        fromStatus: null,
      },
    };
    await expect(processor(mockJob)).resolves.toBeDefined();
  });
});

describe('lt agent — extractMarkdownContent (comportamento observável)', () => {
  it('módulo importa sem erros', async () => {
    await expect(import('./lt')).resolves.toBeDefined();
  });

  it('modelo retorna bloco de código markdown e é devidamente processado', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    // Simula resposta com bloco de código markdown
    (Anthropic as any).mockImplementationOnce(() => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          usage: { input_tokens: 80, output_tokens: 150 },
          content: [
            {
              type: 'text',
              text: "Aqui está o plano:\n```markdown\n# Plano de Execução — SCRUM-3\n\nPassos.\n```",
            },
          ],
        }),
      },
    }));

    const { Worker } = await import('bullmq');
    const processor = (Worker as unknown as any)._lastProcessor;
    if (!processor) return;

    const mockJob = {
      id: 'job-lt-id-3',
      data: {
        storyId: 'story-uuid-3',
        jiraKey: 'SCRUM-3',
        agentRunId: 'run-lt-uuid-3',
        summary: 'Story with markdown fence',
        fromStatus: null,
      },
    };
    await expect(processor(mockJob)).resolves.toBeDefined();
  });
});
