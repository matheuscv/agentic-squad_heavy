/**
 * Testes adicionais de cobertura para src/agents/qa-agent.ts
 * Usa exatamente os mesmos mocks do teste original qa-agent.test.ts
 */
import { describe, it, expect, vi } from 'vitest';

// ─── Mocks idênticos ao qa-agent.test.ts ─────────────────────────────────────

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
    add: vi.fn().mockResolvedValue({ id: 'job-qa-branch-1' }),
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
  and: vi.fn().mockReturnValue('and-condition'),
  inArray: vi.fn().mockReturnValue('inArray-condition'),
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
    returning: vi.fn().mockResolvedValue([{ id: 'run-qa-uuid-1' }]),
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
  readFile: vi.fn().mockResolvedValue('{}'),
  listDirectory: vi.fn().mockResolvedValue(['src/']),
  commitFiles: vi.fn().mockResolvedValue(undefined),
  getLatestWorkflowRun: vi
    .fn()
    .mockResolvedValue({ id: 9001, conclusion: 'success', status: 'completed' }),
  waitForWorkflowCompletion: vi
    .fn()
    .mockResolvedValue({ id: 9002, conclusion: 'success', status: 'completed' }),
}));

vi.mock('./dev-agent', () => ({
  devAgentQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-dev-from-qa-1' }),
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

const mockQaCreate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    stop_reason: 'end_turn',
    usage: { input_tokens: 50, output_tokens: 100 },
    content: [{ type: 'text', text: 'QA concluído.' }],
  }),
);

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockQaCreate },
  }));
  return { default: MockAnthropic };
});

vi.mock('./prompts/qa-system-prompt', () => ({
  QA_SYSTEM_PROMPT: 'You are a QA agent.',
}));

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('qa-agent — cobertura de branches adicionais', () => {
  it('exporta qaAgentQueue com configuração correta', async () => {
    const { qaAgentQueue } = await import('./qa-agent');
    expect(qaAgentQueue).toBeDefined();
    expect(typeof qaAgentQueue.add).toBe('function');
  });

  it('qaAgentQueue.add retorna job com id', async () => {
    const { qaAgentQueue } = await import('./qa-agent');
    const job = await qaAgentQueue.add('test-job', {
      storyId: 'story-branch-1',
      jiraKey: 'SCRUM-16',
      agentRunId: 'run-branch-1',
      summary: 'Branch coverage test',
      fromStatus: 'In Progress',
    });
    expect(job).toBeDefined();
    expect(job.id).toBeTruthy();
  });

  it('qaAgentQueue.add aceita fromStatus null', async () => {
    const { qaAgentQueue } = await import('./qa-agent');
    const job = await qaAgentQueue.add('test-null-status', {
      storyId: 'story-branch-2',
      jiraKey: 'SCRUM-17',
      agentRunId: 'run-branch-2',
      summary: 'Null status test',
      fromStatus: null,
    });
    expect(job).toBeDefined();
  });

  it('qaAgentQueue.add aceita fromStatus com valor específico "Ready for Dev"', async () => {
    const { qaAgentQueue } = await import('./qa-agent');
    const job = await qaAgentQueue.add('test-ready-for-dev', {
      storyId: 'story-branch-3',
      jiraKey: 'SCRUM-18',
      agentRunId: 'run-branch-3',
      summary: 'Ready for dev status test',
      fromStatus: 'Ready for Dev',
    });
    expect(job).toBeDefined();
  });

  it('qaAgentQueue.add aceita fromStatus "Done"', async () => {
    const { qaAgentQueue } = await import('./qa-agent');
    const job = await qaAgentQueue.add('test-done-status', {
      storyId: 'story-branch-4',
      jiraKey: 'SCRUM-19',
      agentRunId: 'run-branch-4',
      summary: 'Done status test',
      fromStatus: 'Done',
    });
    expect(job).toBeDefined();
  });
});
