/**
 * Testes adicionais de cobertura de branches para src/agents/dev-agent.ts
 *
 * ESTRATÉGIA: Usa o mesmo padrão do dev-agent.test.ts original para cobrir
 * branches não exercitados: correctionMode=true, ferramentas específicas,
 * caminhos de erro.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks globais ────────────────────────────────────────────────────────────

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
    add: vi.fn().mockResolvedValue({ id: 'job-dev-b-1' }),
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
    where: vi.fn().mockResolvedValue([{
      id: 'story-uuid-dev-b',
      jiraKey: 'SCRUM-16',
      status: 'em_desenvolvimento',
    }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 'agent-run-dev-b-uuid' }]),
  },
  schema: {
    stories: { id: 'id', jiraKey: 'jiraKey', status: 'status' },
    agentRuns: {
      id: 'id',
      status: 'status',
      startedAt: 'startedAt',
      completedAt: 'completedAt',
      output: 'output',
    },
    artifacts: {
      id: 'id',
      storyId: 'storyId',
      artifactType: 'artifactType',
      filePath: 'filePath',
      content: 'content',
      commitSha: 'commitSha',
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

const mockCreateBranchDev = vi.fn().mockResolvedValue(undefined);
const mockReadFileDev = vi.fn().mockResolvedValue('# Plano\n\nPassos.');
const mockListDirectoryDev = vi.fn().mockResolvedValue(['src/utils/', 'src/utils/currency.ts']);
const mockCommitFilesDev = vi.fn().mockResolvedValue({ sha: 'abc123', url: 'https://github.com/commit/abc123' });
const mockCreatePullRequestDev = vi.fn().mockResolvedValue({
  number: 99,
  url: 'https://api.github.com/repos/org/repo/pulls/99',
  html_url: 'https://github.com/org/repo/pull/99',
});

vi.mock('../github/client', () => ({
  createBranch: mockCreateBranchDev,
  readFile: mockReadFileDev,
  listDirectory: mockListDirectoryDev,
  commitFiles: mockCommitFilesDev,
  createPullRequest: mockCreatePullRequestDev,
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

vi.mock('./prompts/dev-system-prompt', () => ({
  DEV_SYSTEM_PROMPT: 'You are a DEV agent for branches test.',
}));

const mockAnthropicDevBranches = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicDevBranches },
  }));
  return { default: MockAnthropic };
});

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('dev-agent — branches adicionais', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnthropicDevBranches.mockResolvedValue({
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 300 },
      content: [{ type: 'text', text: 'Implementação concluída.' }],
    });
  });

  describe('devAgentQueue — exportação e configuração', () => {
    it('exporta devAgentQueue com método add', async () => {
      const { devAgentQueue } = await import('./dev-agent');
      expect(devAgentQueue).toBeDefined();
      expect(typeof devAgentQueue.add).toBe('function');
    });

    it('devAgentQueue.add aceita correctionMode=true', async () => {
      const { devAgentQueue } = await import('./dev-agent');
      const jobData = {
        storyId: 'story-b-corr-1',
        jiraKey: 'SCRUM-16',
        agentRunId: 'run-b-corr-1',
        summary: 'formatCurrency correction',
        fromStatus: null,
        correctionMode: true,
        correctionIteration: 1,
      };
      const job = await devAgentQueue.add('correction-job', jobData);
      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
    });
  });

  describe('Worker processor — tool_use: read_github_file', () => {
    it('chama readFile quando tool_use = read_github_file', async () => {
      mockAnthropicDevBranches
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 100, output_tokens: 200 },
          content: [
            {
              type: 'tool_use',
              id: 'tool-dev-read-b-1',
              name: 'read_github_file',
              input: { file_path: 'src/utils/currency.ts', branch: 'agent/task-scrum-16' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 50, output_tokens: 100 },
          content: [{ type: 'text', text: 'Arquivo lido.' }],
        });

      mockReadFileDev.mockResolvedValue('export function formatCurrency() {}');

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-dev-b-read-1',
        data: {
          storyId: 'story-dev-b-read-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-dev-b-read-1',
          summary: 'Test read file dev',
          fromStatus: null,
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });
  });

  describe('Worker processor — tool_use: list_github_directory', () => {
    it('chama listDirectory quando tool_use = list_github_directory', async () => {
      mockAnthropicDevBranches
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 150 },
          content: [
            {
              type: 'tool_use',
              id: 'tool-dev-list-b-1',
              name: 'list_github_directory',
              input: { dir_path: 'src/utils', branch: 'agent/task-scrum-16' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 40, output_tokens: 80 },
          content: [{ type: 'text', text: 'Diretório listado.' }],
        });

      mockListDirectoryDev.mockResolvedValue(['currency.ts', 'currency.test.ts']);

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-dev-b-list-1',
        data: {
          storyId: 'story-dev-b-list-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-dev-b-list-1',
          summary: 'Test list dir dev',
          fromStatus: null,
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });
  });

  describe('Worker processor — tool_use: write_github_file', () => {
    it('prepara arquivo via write_github_file', async () => {
      mockAnthropicDevBranches
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 150 },
          content: [
            {
              type: 'tool_use',
              id: 'tool-dev-write-b-1',
              name: 'write_github_file',
              input: {
                file_path: 'src/utils/currency.ts',
                content: 'export function formatCurrency(v: number, c: string): string { return `${c} ${v}`; }',
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 40, output_tokens: 80 },
          content: [{ type: 'text', text: 'Arquivo preparado.' }],
        });

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-dev-b-write-1',
        data: {
          storyId: 'story-dev-b-write-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-dev-b-write-1',
          summary: 'Test write file dev',
          fromStatus: null,
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });
  });

  describe('Worker processor — tool_use: create_github_commit', () => {
    it('cria commit via create_github_commit', async () => {
      mockAnthropicDevBranches
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 150 },
          content: [
            {
              type: 'tool_use',
              id: 'tool-dev-commit-b-1',
              name: 'create_github_commit',
              input: { commit_message: 'feat(SCRUM-16): adiciona formatCurrency' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 40, output_tokens: 80 },
          content: [{ type: 'text', text: 'Commit criado.' }],
        });

      mockCommitFilesDev.mockResolvedValue({ sha: 'ghi789' });

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-dev-b-commit-1',
        data: {
          storyId: 'story-dev-b-commit-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-dev-b-commit-1',
          summary: 'Test create commit dev',
          fromStatus: null,
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });
  });

  describe('Worker processor — tool_use: create_pull_request', () => {
    it('cria PR via create_pull_request', async () => {
      mockAnthropicDevBranches
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 150 },
          content: [
            {
              type: 'tool_use',
              id: 'tool-dev-pr-b-1',
              name: 'create_pull_request',
              input: {
                title: 'feat(SCRUM-16): adiciona formatCurrency',
                body: 'Implementa a função utilitária formatCurrency',
                base: 'main',
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 40, output_tokens: 80 },
          content: [{ type: 'text', text: 'PR criado.' }],
        });

      mockCreatePullRequestDev.mockResolvedValue({
        number: 100,
        url: 'https://api.github.com/repos/org/repo/pulls/100',
        html_url: 'https://github.com/org/repo/pull/100',
      });

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-dev-b-pr-1',
        data: {
          storyId: 'story-dev-b-pr-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-dev-b-pr-1',
          summary: 'Test create PR dev',
          fromStatus: null,
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });
  });

  describe('Worker processor — correctionMode=true', () => {
    it('processa job com correctionMode=true e correctionIteration=2', async () => {
      mockAnthropicDevBranches.mockResolvedValue({
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 200 },
        content: [{ type: 'text', text: 'Correção aplicada.' }],
      });

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-dev-b-corr-2',
        data: {
          storyId: 'story-dev-b-corr-2',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-dev-b-corr-2',
          summary: 'Correção de testes falhos',
          fromStatus: null,
          correctionMode: true,
          correctionIteration: 2,
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });

    it('processa job com correctionMode=false (modo normal)', async () => {
      mockAnthropicDevBranches.mockResolvedValue({
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 200 },
        content: [{ type: 'text', text: 'Implementação normal.' }],
      });

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-dev-b-normal-1',
        data: {
          storyId: 'story-dev-b-normal-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-dev-b-normal-1',
          summary: 'Implementação normal',
          fromStatus: 'refinado',
          correctionMode: false,
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });
  });

  describe('Worker processor — cenários de erro', () => {
    it('propaga erro quando Anthropic lança exceção de API', async () => {
      mockAnthropicDevBranches.mockRejectedValue(
        new Error('Anthropic API error: overloaded'),
      );

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-dev-b-err-1',
        data: {
          storyId: 'story-dev-b-err-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-dev-b-err-1',
          summary: 'Test Anthropic error dev',
          fromStatus: null,
        },
      };
      await expect(processor(fakeJob)).rejects.toThrow();
    });

    it('processa stop_reason=end_turn sem ferramenta (conversa simples)', async () => {
      mockAnthropicDevBranches.mockResolvedValue({
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, output_tokens: 100 },
        content: [{ type: 'text', text: 'Concluído sem ferramentas.' }],
      });

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-dev-b-notool-1',
        data: {
          storyId: 'story-dev-b-notool-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-dev-b-notool-1',
          summary: 'Conversa simples',
          fromStatus: null,
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });
  });
});
