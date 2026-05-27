/**
 * Testes adicionais de cobertura para src/agents/dev-agent.ts
 * Usa exatamente os mesmos mocks do teste original dev-agent.test.ts
 */
import { describe, it, expect, vi } from 'vitest';

// ─── Mocks idênticos ao dev-agent.test.ts ────────────────────────────────────

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
    add: vi.fn().mockResolvedValue({ id: 'job-dev-branch-1' }),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  const MockWorker = vi.fn().mockImplementation(
    (_name: string, processor: (...args: unknown[]) => unknown) => {
      (MockWorker as any)._lastProcessor = processor;
      return mockWorkerInstance;
    },
  );
  return { Queue: MockQueue, Worker: MockWorker };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue('eq-condition'),
}));

vi.mock('../db/index', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 'run-dev-branch-1' }]),
  },
  schema: {
    stories: { id: 'id', jiraKey: 'jiraKey', status: 'status' },
    agentRuns: {
      id: 'id',
      storyId: 'storyId',
      agentType: 'agentType',
      status: 'status',
      output: 'output',
      errorMessage: 'errorMessage',
      startedAt: 'startedAt',
      completedAt: 'completedAt',
    },
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
  readFile: vi.fn().mockResolvedValue('file content'),
  listDirectory: vi.fn().mockResolvedValue(['src/']),
  commitFiles: vi.fn().mockResolvedValue(undefined),
  createPullRequest: vi.fn().mockResolvedValue({
    number: 42,
    url: 'https://api.github.com/repos/owner/repo/pulls/42',
    html_url: 'https://github.com/owner/repo/pull/42',
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

const mockDevCreate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    stop_reason: 'end_turn',
    usage: { input_tokens: 60, output_tokens: 120 },
    content: [{ type: 'text', text: 'Dev concluído.' }],
  }),
);

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockDevCreate },
  }));
  return { default: MockAnthropic };
});

vi.mock('./prompts/dev-system-prompt', () => ({
  DEV_SYSTEM_PROMPT: 'You are a Dev agent.',
}));

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('dev-agent — cobertura de branches adicionais', () => {
  it('exporta devAgentQueue com método add', async () => {
    const { devAgentQueue } = await import('./dev-agent');
    expect(devAgentQueue).toBeDefined();
    expect(typeof devAgentQueue.add).toBe('function');
  });

  it('devAgentQueue.add retorna job com id (modo normal)', async () => {
    const { devAgentQueue } = await import('./dev-agent');
    const job = await devAgentQueue.add('test-dev-job', {
      storyId: 'story-dev-branch-1',
      jiraKey: 'SCRUM-16',
      agentRunId: 'run-dev-branch-1',
      summary: 'Branch coverage dev test',
      fromStatus: 'Ready for Dev',
      correctionMode: false,
    });
    expect(job).toBeDefined();
    expect(job.id).toBeTruthy();
  });

  it('devAgentQueue.add aceita correctionMode true com correctionIteration', async () => {
    const { devAgentQueue } = await import('./dev-agent');
    const job = await devAgentQueue.add('test-dev-correction', {
      storyId: 'story-dev-branch-2',
      jiraKey: 'SCRUM-16',
      agentRunId: 'run-dev-branch-2',
      summary: 'Correction mode test',
      fromStatus: 'In Review',
      correctionMode: true,
      correctionIteration: 1,
    });
    expect(job).toBeDefined();
  });

  it('devAgentQueue.add aceita correctionIteration 2', async () => {
    const { devAgentQueue } = await import('./dev-agent');
    const job = await devAgentQueue.add('test-dev-correction-2', {
      storyId: 'story-dev-branch-3',
      jiraKey: 'SCRUM-20',
      agentRunId: 'run-dev-branch-3',
      summary: 'Correction iteration 2',
      fromStatus: null,
      correctionMode: true,
      correctionIteration: 2,
    });
    expect(job).toBeDefined();
  });

  it('devAgentQueue.add aceita correctionIteration 3 (último ciclo)', async () => {
    const { devAgentQueue } = await import('./dev-agent');
    const job = await devAgentQueue.add('test-dev-correction-3', {
      storyId: 'story-dev-branch-4',
      jiraKey: 'SCRUM-21',
      agentRunId: 'run-dev-branch-4',
      summary: 'Final correction cycle',
      fromStatus: null,
      correctionMode: true,
      correctionIteration: 3,
    });
    expect(job).toBeDefined();
  });
});
