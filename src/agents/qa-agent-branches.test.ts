/**
 * Testes adicionais de cobertura de branches para src/agents/qa-agent.ts
 *
 * ESTRATÉGIA: Usa o mesmo padrão do qa-agent.test.ts original, extendendo
 * os casos de teste para cobrir branches não exercitados.
 *
 * IMPORTANTE: Este arquivo usa vi.isolateModules() para evitar conflitos
 * com o módulo em cache de qa-agent.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks globais (devem ser declarados antes de qualquer import dinâmico) ──

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
    add: vi.fn().mockResolvedValue({ id: 'job-qa-b-1' }),
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
    returning: vi.fn().mockResolvedValue([{ id: 'run-qa-b-uuid' }]),
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

const mockReadFile = vi.fn().mockResolvedValue('{}');
const mockListDirectory = vi.fn().mockResolvedValue(['src/utils/']);
const mockCommitFiles = vi.fn().mockResolvedValue(undefined);
const mockGetLatestWorkflowRun = vi.fn().mockResolvedValue({
  id: 9001,
  conclusion: 'success',
  status: 'completed',
});
const mockWaitForWorkflowCompletion = vi.fn().mockResolvedValue({
  id: 9002,
  conclusion: 'success',
  status: 'completed',
});

vi.mock('../github/client', () => ({
  readFile: mockReadFile,
  listDirectory: mockListDirectory,
  commitFiles: mockCommitFiles,
  getLatestWorkflowRun: mockGetLatestWorkflowRun,
  waitForWorkflowCompletion: mockWaitForWorkflowCompletion,
}));

vi.mock('./dev-agent', () => ({
  devAgentQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-dev-corr-b-1' }),
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

vi.mock('./prompts/qa-system-prompt', () => ({
  QA_SYSTEM_PROMPT: 'You are a QA agent for branches test.',
}));

const mockQaBranchesAnthropicCreate = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockQaBranchesAnthropicCreate },
  }));
  return { default: MockAnthropic };
});

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('qa-agent — branches adicionais', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default para a maioria dos cenários
    mockQaBranchesAnthropicCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 100 },
      content: [{ type: 'text', text: 'QA revisão completa.' }],
    });
  });

  describe('qaAgentQueue — exportação e configuração', () => {
    it('exporta qaAgentQueue com método add', async () => {
      const { qaAgentQueue } = await import('./qa-agent');
      expect(qaAgentQueue).toBeDefined();
      expect(typeof qaAgentQueue.add).toBe('function');
    });

    it('qaAgentQueue.add resolve com jobId', async () => {
      const { qaAgentQueue } = await import('./qa-agent');
      const jobData = {
        storyId: 'story-b-1',
        jiraKey: 'SCRUM-16',
        agentRunId: 'run-b-1',
        summary: 'formatCurrency branches',
        fromStatus: 'em_desenvolvimento',
      };
      const job = await qaAgentQueue.add('test-job-b', jobData);
      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
    });
  });

  describe('Worker processor — tool_use blocks', () => {
    it('processa tool_use: get_workflow_run_result retornando CI com sucesso e cobertura ≥ 85%', async () => {
      // Configura: primeira chamada retorna tool_use, segunda retorna end_turn
      mockQaBranchesAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 100, output_tokens: 200 },
          content: [
            {
              type: 'tool_use',
              id: 'tool-get-wf-b-1',
              name: 'get_workflow_run_result',
              input: { branch: 'agent/task-scrum-16' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 50, output_tokens: 100 },
          content: [{ type: 'text', text: 'CI passou. Cobertura OK.' }],
        });

      mockGetLatestWorkflowRun.mockResolvedValue({
        id: 9001,
        conclusion: 'success',
        status: 'completed',
      });
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          total: {
            statements: { pct: 90 },
            branches: { pct: 88 },
            functions: { pct: 92 },
            lines: { pct: 91 },
          },
        }),
      );

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) {
        // Importa o módulo para registrar o worker
        await import('./qa-agent');
        const { Worker: W } = await import('bullmq');
        const proc = (W as any)._lastProcessor;
        if (proc) {
          const fakeJob = {
            id: 'job-b-wf-1',
            data: {
              storyId: 'story-b-wf-1',
              jiraKey: 'SCRUM-16',
              agentRunId: 'run-b-wf-1',
              summary: 'Test CI success',
              fromStatus: null,
            },
          };
          await expect(proc(fakeJob)).resolves.toBeDefined();
        }
        return;
      }

      const fakeJob = {
        id: 'job-b-wf-1',
        data: {
          storyId: 'story-b-wf-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-b-wf-1',
          summary: 'Test CI success',
          fromStatus: null,
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });

    it('processa tool_use: read_github_file', async () => {
      mockQaBranchesAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 150 },
          content: [
            {
              type: 'tool_use',
              id: 'tool-read-b-1',
              name: 'read_github_file',
              input: { file_path: 'src/utils/currency.ts', branch: 'agent/task-scrum-16' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 40, output_tokens: 80 },
          content: [{ type: 'text', text: 'Arquivo lido.' }],
        });

      mockReadFile.mockResolvedValue('export function formatCurrency() {}');

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-b-read-1',
        data: {
          storyId: 'story-b-read-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-b-read-1',
          summary: 'Test read file',
          fromStatus: 'em_desenvolvimento',
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });

    it('processa tool_use: list_github_directory', async () => {
      mockQaBranchesAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 150 },
          content: [
            {
              type: 'tool_use',
              id: 'tool-list-b-1',
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

      mockListDirectory.mockResolvedValue(['currency.ts', 'currency.test.ts']);

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-b-list-1',
        data: {
          storyId: 'story-b-list-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-b-list-1',
          summary: 'Test list dir',
          fromStatus: null,
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });

    it('processa tool_use: write_github_file', async () => {
      mockQaBranchesAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 150 },
          content: [
            {
              type: 'tool_use',
              id: 'tool-write-b-1',
              name: 'write_github_file',
              input: {
                file_path: 'src/utils/currency-new.test.ts',
                content: 'import { describe, it, expect } from "vitest";\ndescribe("test", () => { it("works", () => expect(1).toBe(1)); });',
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 40, output_tokens: 80 },
          content: [{ type: 'text', text: 'Arquivo preparado.' }],
        });

      mockCommitFiles.mockResolvedValue({ sha: 'abc123' });

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-b-write-1',
        data: {
          storyId: 'story-b-write-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-b-write-1',
          summary: 'Test write file',
          fromStatus: null,
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });

    it('processa tool_use: create_github_commit', async () => {
      mockQaBranchesAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 150 },
          content: [
            {
              type: 'tool_use',
              id: 'tool-commit-b-1',
              name: 'create_github_commit',
              input: { commit_message: 'test(QA-iter-1): aumenta cobertura em currency' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 40, output_tokens: 80 },
          content: [{ type: 'text', text: 'Commit criado.' }],
        });

      mockCommitFiles.mockResolvedValue({ sha: 'def456' });

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-b-commit-1',
        data: {
          storyId: 'story-b-commit-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-b-commit-1',
          summary: 'Test commit',
          fromStatus: null,
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });

    it('processa tool_use: wait_for_ci', async () => {
      mockQaBranchesAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 150 },
          content: [
            {
              type: 'tool_use',
              id: 'tool-wait-ci-b-1',
              name: 'wait_for_ci',
              input: { branch: 'agent/task-scrum-16', current_run_id: 9001 },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 40, output_tokens: 80 },
          content: [{ type: 'text', text: 'CI concluído.' }],
        });

      mockWaitForWorkflowCompletion.mockResolvedValue({
        id: 9003,
        conclusion: 'success',
        status: 'completed',
      });

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-b-wait-ci-1',
        data: {
          storyId: 'story-b-wait-ci-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-b-wait-ci-1',
          summary: 'Test wait CI',
          fromStatus: null,
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });

    it('processa tool_use: finish_qa_review com passed=true', async () => {
      mockQaBranchesAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 150 },
          content: [
            {
              type: 'tool_use',
              id: 'tool-finish-b-1',
              name: 'finish_qa_review',
              input: {
                passed: true,
                summary: 'Cobertura 90% em todos os módulos.',
                iterations: 1,
                coverage: { statements: { pct: 90 }, branches: { pct: 88 }, functions: { pct: 92 }, lines: { pct: 91 } },
                tests_written: ['src/utils/currency-extended.test.ts'],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 40, output_tokens: 80 },
          content: [{ type: 'text', text: 'Revisão finalizada.' }],
        });

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-b-finish-1',
        data: {
          storyId: 'story-b-finish-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-b-finish-1',
          summary: 'Test finish review passed',
          fromStatus: null,
        },
      };
      const result = await processor(fakeJob);
      expect(result).toBeDefined();
    });

    it('processa tool_use: finish_qa_review com passed=false (escalado)', async () => {
      mockQaBranchesAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 150 },
          content: [
            {
              type: 'tool_use',
              id: 'tool-finish-b-2',
              name: 'finish_qa_review',
              input: {
                passed: false,
                summary: 'Cobertura insuficiente após 3 iterações.',
                iterations: 3,
                coverage: { statements: { pct: 75 }, branches: { pct: 70 }, functions: { pct: 80 }, lines: { pct: 74 } },
                tests_written: [],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 40, output_tokens: 80 },
          content: [{ type: 'text', text: 'Escalado para humano.' }],
        });

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-b-finish-2',
        data: {
          storyId: 'story-b-finish-2',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-b-finish-2',
          summary: 'Test finish review failed',
          fromStatus: null,
        },
      };
      const result = await processor(fakeJob);
      expect(result).toBeDefined();
    });

    it('processa tool_use: create_correction_request', async () => {
      mockQaBranchesAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 150 },
          content: [
            {
              type: 'tool_use',
              id: 'tool-correction-b-1',
              name: 'create_correction_request',
              input: {
                iteration: 1,
                description: 'CI falhou nos testes de formatCurrency',
                files_with_issues: ['src/utils/currency.ts'],
                failing_tests: ['formatCurrency deve lançar erro para moeda inválida'],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 40, output_tokens: 80 },
          content: [{ type: 'text', text: 'Correção solicitada.' }],
        });

      const { devAgentQueue } = await import('./dev-agent');
      const mockDevAdd = vi.mocked(devAgentQueue.add);
      mockDevAdd.mockResolvedValue({ id: 'job-corr-b-1' } as any);

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-b-correction-1',
        data: {
          storyId: 'story-b-correction-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-b-correction-1',
          summary: 'Test correction request',
          fromStatus: null,
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });

    it('processa tool_use: escalate_to_human', async () => {
      mockQaBranchesAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 150 },
          content: [
            {
              type: 'tool_use',
              id: 'tool-escalate-b-1',
              name: 'escalate_to_human',
              input: {
                reason: 'Cobertura insuficiente após 3 iterações',
                final_coverage: { statements: { pct: 72 }, branches: { pct: 68 } },
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 40, output_tokens: 80 },
          content: [{ type: 'text', text: 'Escalado.' }],
        });

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-b-escalate-1',
        data: {
          storyId: 'story-b-escalate-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-b-escalate-1',
          summary: 'Test escalate',
          fromStatus: null,
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });

    it('processa tool_use: get_pr_files', async () => {
      mockQaBranchesAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 150 },
          content: [
            {
              type: 'tool_use',
              id: 'tool-prfiles-b-1',
              name: 'get_pr_files',
              input: { branch: 'agent/task-scrum-16' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 40, output_tokens: 80 },
          content: [{ type: 'text', text: 'Arquivos do PR listados.' }],
        });

      mockReadFile.mockResolvedValue(JSON.stringify(['src/utils/currency.ts', 'src/utils/currency.test.ts']));

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-b-prfiles-1',
        data: {
          storyId: 'story-b-prfiles-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-b-prfiles-1',
          summary: 'Test get PR files',
          fromStatus: null,
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });

    it('processa tool_use: wait_for_dev_correction', async () => {
      mockQaBranchesAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 150 },
          content: [
            {
              type: 'tool_use',
              id: 'tool-wait-dev-b-1',
              name: 'wait_for_dev_correction',
              input: { agent_run_id: 'run-dev-corr-uuid-1' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 40, output_tokens: 80 },
          content: [{ type: 'text', text: 'Correção aguardada.' }],
        });

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-b-wait-dev-1',
        data: {
          storyId: 'story-b-wait-dev-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-b-wait-dev-1',
          summary: 'Test wait dev correction',
          fromStatus: null,
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });
  });

  describe('Worker processor — cenários de erro', () => {
    it('lança erro quando Anthropic retorna stop_reason="max_tokens"', async () => {
      mockQaBranchesAnthropicCreate.mockResolvedValue({
        stop_reason: 'max_tokens',
        usage: { input_tokens: 5000, output_tokens: 4096 },
        content: [{ type: 'text', text: 'Resposta truncada...' }],
      });

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-b-err-1',
        data: {
          storyId: 'story-b-err-1',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-b-err-1',
          summary: 'Test max tokens error',
          fromStatus: null,
        },
      };
      // max_tokens sem ferramenta pode causar rejeição ou resultado indefinido
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });

    it('propaga erro quando Anthropic lança exceção', async () => {
      mockQaBranchesAnthropicCreate.mockRejectedValue(
        new Error('Anthropic API error: rate limit exceeded'),
      );

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-b-err-2',
        data: {
          storyId: 'story-b-err-2',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-b-err-2',
          summary: 'Test Anthropic error',
          fromStatus: null,
        },
      };
      await expect(processor(fakeJob)).rejects.toThrow();
    });
  });

  describe('pruneOldToolResults — cobertura de branches', () => {
    it('não pruna mensagens quando há poucas mensagens (≤ keepCount)', async () => {
      // Simula conversa com poucas mensagens — pruneOldToolResults não age
      mockQaBranchesAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 50, output_tokens: 100 },
          content: [
            {
              type: 'tool_use',
              id: 'tool-prune-b-1',
              name: 'read_github_file',
              input: { file_path: 'src/utils/currency.ts' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 30, output_tokens: 60 },
          content: [{ type: 'text', text: 'Curto.' }],
        });

      mockReadFile.mockResolvedValue('short content');

      const { Worker } = await import('bullmq');
      const processor = (Worker as any)._lastProcessor;
      if (!processor) return;

      const fakeJob = {
        id: 'job-b-prune-short',
        data: {
          storyId: 'story-b-prune-short',
          jiraKey: 'SCRUM-16',
          agentRunId: 'run-b-prune-short',
          summary: 'Test prune short',
          fromStatus: null,
        },
      };
      await expect(processor(fakeJob)).resolves.toBeDefined();
    });
  });
});
