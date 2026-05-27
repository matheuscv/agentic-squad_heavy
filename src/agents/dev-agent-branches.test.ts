/**
 * Testes adicionais de cobertura para src/agents/dev-agent.ts
 * Abordagem minimalista para não conflitar com dev-agent.test.ts
 */
import { describe, it, expect, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>();
  return {
    ...actual,
    Worker: class MockWorker {
      static _processor: unknown;
      constructor(
        public queueName: string,
        processor: unknown,
        public opts?: unknown,
      ) {
        MockWorker._processor = processor;
      }
      on = vi.fn().mockReturnThis();
      close = vi.fn().mockResolvedValue(undefined);
    },
    Queue: class MockQueue {
      constructor(public name: string, public opts?: unknown) {}
      add = vi.fn().mockResolvedValue({ id: 'job-1' });
      getJob = vi.fn().mockResolvedValue(null);
      close = vi.fn().mockResolvedValue(undefined);
    },
  };
});

vi.mock('../tools/index', () => ({
  createJiraComment: vi.fn().mockResolvedValue({ id: 'comment-1' }),
  transitionJiraIssue: vi.fn().mockResolvedValue({ success: true }),
  triggerQAAgent: vi.fn().mockResolvedValue({ agentRunId: 'run-1' }),
  getJiraIssueDetails: vi.fn().mockResolvedValue({ key: 'SCRUM-1' }),
  createFile: vi.fn().mockResolvedValue({ success: true }),
  updateFile: vi.fn().mockResolvedValue({ success: true }),
  readFile: vi.fn().mockResolvedValue({ content: '' }),
  listDirectory: vi.fn().mockResolvedValue([]),
  createCommit: vi.fn().mockResolvedValue({ sha: 'abc' }),
  getPRFiles: vi.fn().mockResolvedValue([]),
  getWorkflowRunResult: vi.fn().mockResolvedValue({ conclusion: 'success' }),
  readCorrectionRequest: vi.fn().mockResolvedValue(null),
}));

vi.mock('../lib/anthropic', () => ({
  default: {
    messages: {
      create: vi.fn().mockResolvedValue({
        id: 'msg-1',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'OK' }],
      }),
    },
  },
}));

vi.mock('../lib/logger', () => ({
  childLogger: vi.fn().mockReturnValue({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

vi.mock('../queue/index', () => ({
  orchestratorQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-q-1' }),
    getJob: vi.fn().mockResolvedValue(null),
    close: vi.fn().mockResolvedValue(undefined),
  },
  qaQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-qa-1' }),
    getJob: vi.fn().mockResolvedValue(null),
    close: vi.fn().mockResolvedValue(undefined),
  },
  devQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-dev-1' }),
    getJob: vi.fn().mockResolvedValue(null),
    close: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─── Testes ────────────────────────────────────────────────────────────────────

describe('dev-agent — módulo carregado com sucesso', () => {
  it('importa o módulo sem erros', async () => {
    const mod = await import('./dev-agent');
    expect(mod).toBeDefined();
  });

  it('exporta devWorker', async () => {
    const mod = await import('./dev-agent');
    expect(mod.devWorker).toBeDefined();
  });
});
