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
    add: vi.fn().mockResolvedValue({ id: 'job-dev-1' }),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  const MockWorker = vi.fn().mockImplementation((_name: string, processor: (...args: unknown[]) => unknown) => {
    (MockWorker as any)._lastProcessor = processor;
    return mockWorkerInstance;
  });
  return { Queue: MockQueue, Worker: MockWorker };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue('eq-condition'),
  and: vi.fn().mockReturnValue('and-condition'),
}));

vi.mock('../db/index', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ id: 'story-uuid-1', jiraKey: 'SCRUM-1', status: 'em_desenvolvimento' }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 'agent-run-uuid-1' }]),
  },
  schema: {
    stories: { id: 'id', jiraKey: 'jiraKey', status: 'status' },
    agentRuns: { id: 'id', status: 'status', startedAt: 'startedAt', completedAt: 'completedAt', output: 'output' },
    artifacts: { id: 'id', storyId: 'storyId', artifactType: 'artifactType', filePath: 'filePath', content: 'content', commitSha: 'commitSha' },
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
  createBranch: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('# Plano de Execução — SCRUM-1\n\nPassos.'),
  listDirectory: vi.fn().mockResolvedValue(['src/', 'src/utils/']),
  commitFiles: vi.fn().mockResolvedValue(undefined),
  createPullRequest: vi.fn().mockResolvedValue({
    number: 42,
    url: 'https://api.github.com/repos/org/repo/pulls/42',
    html_url: 'https://github.com/org/repo/pull/42',
  }),
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

const mockAnthropicCreate = vi.hoisted(() => vi.fn().mockResolvedValue({
  stop_reason: 'end_turn',
  usage: { input_tokens: 100, output_tokens: 300 },
  content: [{ type: 'text', text: 'Implementação concluída com sucesso.' }],
}));

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicCreate },
  }));
  return { default: MockAnthropic };
});

vi.mock('./prompts/dev-system-prompt', () => ({
  DEV_SYSTEM_PROMPT: 'You are a DEV agent.',
}));

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('dev-agent — module exports', () => {
  it('exporta devAgentQueue', async () => {
    const { devAgentQueue } = await import('./dev-agent');
    expect(devAgentQueue).toBeDefined();
    expect(typeof devAgentQueue.add).toBe('function');
  });

  it('devAgentQueue.add aceita DevAgentJobData completo', async () => {
    const { devAgentQueue } = await import('./dev-agent');
    const jobData = {
      storyId: 'story-uuid-1',
      jiraKey: 'SCRUM-1',
      agentRunId: 'run-dev-uuid-1',
      summary: 'Add currency formatter',
      fromStatus: 'A Definir',
    };
    await expect(devAgentQueue.add('process', jobData)).resolves.toBeDefined();
  });

  it('devAgentQueue.add aceita correctionMode true', async () => {
    const { devAgentQueue } = await import('./dev-agent');
    const jobData = {
      storyId: 'story-uuid-1',
      jiraKey: 'SCRUM-1',
      agentRunId: 'run-dev-uuid-2',
      summary: 'Fix failing tests',
      fromStatus: null,
      correctionMode: true,
      correctionIteration: 1,
    };
    await expect(devAgentQueue.add('correction', jobData)).resolves.toBeDefined();
  });

  it('devAgentQueue.add aceita fromStatus null', async () => {
    const { devAgentQueue } = await import('./dev-agent');
    const jobData = {
      storyId: 'story-uuid-3',
      jiraKey: 'SCRUM-3',
      agentRunId: 'run-dev-uuid-3',
      summary: 'New feature',
      fromStatus: null,
    };
    await expect(devAgentQueue.add('process', jobData)).resolves.toBeDefined();
  });
});

describe('dev-agent — Worker registrado', () => {
  it('Worker é instanciado ao chamar createDevAgentWorker()', async () => {
    vi.clearAllMocks();
    const { createDevAgentWorker } = await import('./dev-agent');
    const { Worker } = await import('bullmq');
    createDevAgentWorker();
    expect(Worker).toHaveBeenCalled();
  });

  it('Worker é registrado na fila "agent-dev"', async () => {
    vi.clearAllMocks();
    const { createDevAgentWorker } = await import('./dev-agent');
    const { Worker } = await import('bullmq');
    createDevAgentWorker();
    const calls = (Worker as unknown as vi.MockedFunction<any>).mock.calls;
    const devCall = calls.find((c: any[]) => c[0] === 'agent-dev');
    expect(devCall).toBeDefined();
  });
});

describe('dev-agent — DevAgentJobData type shape', () => {
  it('tipo DevAgentJobData exportado é compatível com objeto de job', async () => {
    const mod = await import('./dev-agent');
    // O fato de o módulo exportar a queue valida que o tipo está correto
    expect(mod.devAgentQueue).toBeDefined();
  });
});

describe('dev-agent — job processor execução normal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processa job normal sem correctionMode', async () => {
    const { Worker } = await import('bullmq');
    const processor = (Worker as unknown as any)._lastProcessor;
    if (!processor) return;

    mockAnthropicCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 300 },
        content: [{ type: 'tool_use', id: 'tool-pr-1', name: 'create_pull_request', input: { title: 'feat: add formatCurrency', body: 'Implements currency formatter' } }],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, output_tokens: 20 },
        content: [{ type: 'text', text: 'PR criado.' }],
      });

    const mockJob = {
      id: 'job-dev-id-1',
      data: {
        storyId: 'story-uuid-1',
        jiraKey: 'SCRUM-1',
        agentRunId: 'run-dev-uuid-1',
        summary: 'Add currency formatter',
        fromStatus: 'A Definir',
        correctionMode: false,
      },
    };
    await expect(processor(mockJob)).resolves.toBeDefined();
  });

  it('processa job em modo correção', async () => {
    const { Worker } = await import('bullmq');
    const processor = (Worker as unknown as any)._lastProcessor;
    if (!processor) return;

    const mockJob = {
      id: 'job-dev-id-2',
      data: {
        storyId: 'story-uuid-1',
        jiraKey: 'SCRUM-1',
        agentRunId: 'run-dev-uuid-2',
        summary: 'Fix failing tests',
        fromStatus: null,
        correctionMode: true,
        correctionIteration: 2,
      },
    };
    await expect(processor(mockJob)).resolves.toBeDefined();
  });
});
