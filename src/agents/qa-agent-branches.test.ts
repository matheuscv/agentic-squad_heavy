/**
 * Testes adicionais de cobertura de branches para src/agents/qa-agent.ts
 *
 * Foca nos caminhos não cobertos pelo qa-agent.test.ts existente:
 * - pruneOldToolResults: mensagens com e sem tool_result blocks
 * - Processamento do Worker com tool_use blocks (todas as ferramentas)
 * - Loop de correção: write_github_file, create_github_commit, wait_for_ci
 * - finish_qa_review com passed=false
 * - Tratamento de erros no worker processor
 * - sleep() durante rate-limiting
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks de infraestrutura ──────────────────────────────────────────────────

vi.mock('ioredis', () => {
  const MockIORedis = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
  }));
  return { default: MockIORedis };
});

const mockWorkerProcessor = { fn: null as ((...args: unknown[]) => unknown) | null };

vi.mock('bullmq', () => {
  const mockWorkerInstance = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const MockQueue = vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({ id: 'job-qa-branches-1' }),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  const MockWorker = vi.fn().mockImplementation((_name: string, processor: (...args: unknown[]) => unknown) => {
    mockWorkerProcessor.fn = processor;
    return mockWorkerInstance;
  });
  return { Queue: MockQueue, Worker: MockWorker };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue('eq-condition'),
  and: vi.fn().mockReturnValue('and-condition'),
  inArray: vi.fn().mockReturnValue('inArray-condition'),
}));

const mockDbSelect = vi.fn();
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: mockDbSelect,
  limit: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([{ id: 'run-qa-uuid-branches' }]),
};

vi.mock('../db/index', () => ({
  db: mockDb,
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
    add: vi.fn().mockResolvedValue({ id: 'job-dev-corr-1' }),
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
  QA_SYSTEM_PROMPT: 'You are a QA agent.',
}));

// ─── Mock Anthropic ────────────────────────────────────────────────────────────

const mockAnthropicCreate = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicCreate },
  }));
  return { default: MockAnthropic };
});

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const validJobData = {
  storyId: 'story-branches-uuid',
  jiraKey: 'SCRUM-16',
  agentRunId: 'agent-run-branches-uuid',
  summary: 'Adicionar formatCurrency',
  fromStatus: 'Em Desenvolvimento',
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function getProcessor() {
  await import('./qa-agent');
  return mockWorkerProcessor.fn as (job: unknown) => Promise<unknown>;
}

// ─── Testes ────────────────────────────────────────────────────────────────────

describe('qa-agent — processamento de tool_use blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDbSelect.mockResolvedValue([{ id: 'run-qa-uuid-branches' }]);
    mockDb.returning.mockResolvedValue([{ id: 'run-qa-uuid-branches' }]);
  });

  describe('get_workflow_run_result tool', () => {
    it('processa tool_use get_workflow_run_result e retorna cobertura', async () => {
      const coverageData = JSON.stringify({
        total: {
          statements: { pct: 90 },
          branches: { pct: 88 },
          functions: { pct: 92 },
          lines: { pct: 90 },
        },
      });

      mockReadFile
        .mockResolvedValueOnce(coverageData) // .qa-coverage.json
        .mockResolvedValueOnce(null);

      mockGetLatestWorkflowRun.mockResolvedValueOnce({
        id: 1000,
        conclusion: 'success',
        status: 'completed',
      });

      // 1ª chamada: tool_use para get_workflow_run_result
      // 2ª chamada: finish_qa_review (end_turn)
      mockAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [
            {
              type: 'tool_use',
              id: 'toolu_01',
              name: 'get_workflow_run_result',
              input: { branch: 'agent/task-scrum-16' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 150, output_tokens: 60 },
          content: [{ type: 'text', text: 'CI passou com cobertura ≥ 85%.' }],
        });

      const processor = await getProcessor();
      const job = { data: validJobData };
      const result = await processor(job);

      expect(result).toBeDefined();
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('read_github_file tool', () => {
    it('processa tool_use read_github_file com conteúdo existente', async () => {
      mockReadFile.mockResolvedValueOnce('export function formatCurrency() {}');

      mockAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 40 },
          content: [
            {
              type: 'tool_use',
              id: 'toolu_02',
              name: 'read_github_file',
              input: { file_path: 'src/utils/currency.ts', branch: 'agent/task-scrum-16' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 130, output_tokens: 55 },
          content: [{ type: 'text', text: 'Arquivo lido com sucesso.' }],
        });

      const processor = await getProcessor();
      await processor({ data: validJobData });

      expect(mockReadFile).toHaveBeenCalledWith('src/utils/currency.ts', 'agent/task-scrum-16');
    });

    it('processa tool_use read_github_file quando arquivo não existe (null)', async () => {
      mockReadFile.mockResolvedValueOnce(null);

      mockAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 40 },
          content: [
            {
              type: 'tool_use',
              id: 'toolu_03',
              name: 'read_github_file',
              input: { file_path: 'src/utils/nao-existe.ts' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 120, output_tokens: 50 },
          content: [{ type: 'text', text: 'Arquivo não encontrado.' }],
        });

      const processor = await getProcessor();
      await processor({ data: validJobData });
      // Não deve lançar erro
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('list_github_directory tool', () => {
    it('processa tool_use list_github_directory', async () => {
      mockListDirectory.mockResolvedValueOnce(['src/utils/currency.ts', 'src/utils/currency.test.ts']);

      mockAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 70, output_tokens: 35 },
          content: [
            {
              type: 'tool_use',
              id: 'toolu_04',
              name: 'list_github_directory',
              input: { dir_path: 'src/utils', branch: 'agent/task-scrum-16' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 110, output_tokens: 45 },
          content: [{ type: 'text', text: 'Diretório listado.' }],
        });

      const processor = await getProcessor();
      await processor({ data: validJobData });

      expect(mockListDirectory).toHaveBeenCalledWith('src/utils', 'agent/task-scrum-16');
    });
  });

  describe('write_github_file tool', () => {
    it('processa tool_use write_github_file (staging de arquivo de teste)', async () => {
      mockAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 90, output_tokens: 50 },
          content: [
            {
              type: 'tool_use',
              id: 'toolu_05',
              name: 'write_github_file',
              input: {
                file_path: 'src/utils/currency-extra.test.ts',
                content: "import { describe, it } from 'vitest';\ndescribe('x', () => {});",
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 130, output_tokens: 55 },
          content: [{ type: 'text', text: 'Arquivo de teste escrito.' }],
        });

      const processor = await getProcessor();
      await processor({ data: validJobData });

      // Nenhum commitFiles ainda — apenas staging
      expect(mockCommitFiles).not.toHaveBeenCalled();
    });

    it('rejeita write_github_file para arquivo não-test', async () => {
      mockAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 90, output_tokens: 50 },
          content: [
            {
              type: 'tool_use',
              id: 'toolu_06',
              name: 'write_github_file',
              input: {
                file_path: 'src/utils/currency.ts', // arquivo de produção — deve ser rejeitado
                content: 'export function x() {}',
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 130, output_tokens: 55 },
          content: [{ type: 'text', text: 'Rejeitado.' }],
        });

      const processor = await getProcessor();
      const result = await processor({ data: validJobData });
      // Deve retornar sem crash
      expect(result).toBeDefined();
    });
  });

  describe('create_github_commit tool', () => {
    it('processa tool_use create_github_commit (commit dos arquivos em staging)', async () => {
      mockCommitFiles.mockResolvedValueOnce({ sha: 'abc123', url: 'https://github.com/commit/abc123' });

      mockAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 45 },
          content: [
            {
              type: 'tool_use',
              id: 'toolu_07',
              name: 'create_github_commit',
              input: { commit_message: 'test(QA-iter-1): aumenta cobertura em currency' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 120, output_tokens: 50 },
          content: [{ type: 'text', text: 'Commit criado.' }],
        });

      const processor = await getProcessor();
      await processor({ data: validJobData });
      // commitFiles pode ser chamado na execução
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('wait_for_ci tool', () => {
    it('processa tool_use wait_for_ci aguardando conclusão do CI', async () => {
      mockWaitForWorkflowCompletion.mockResolvedValueOnce({
        id: 9999,
        conclusion: 'success',
        status: 'completed',
      });

      mockAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 40 },
          content: [
            {
              type: 'tool_use',
              id: 'toolu_08',
              name: 'wait_for_ci',
              input: { branch: 'agent/task-scrum-16', current_run_id: 9000 },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 120, output_tokens: 50 },
          content: [{ type: 'text', text: 'CI concluído.' }],
        });

      const processor = await getProcessor();
      await processor({ data: validJobData });
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('get_pr_files tool', () => {
    it('processa tool_use get_pr_files', async () => {
      mockAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 70, output_tokens: 35 },
          content: [
            {
              type: 'tool_use',
              id: 'toolu_09',
              name: 'get_pr_files',
              input: { branch: 'agent/task-scrum-16' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 110, output_tokens: 45 },
          content: [{ type: 'text', text: 'PR files obtidos.' }],
        });

      const processor = await getProcessor();
      await processor({ data: validJobData });
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('create_correction_request tool', () => {
    it('processa tool_use create_correction_request e enfileira job DEV', async () => {
      const { devAgentQueue } = await import('./dev-agent');

      mockAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 100, output_tokens: 60 },
          content: [
            {
              type: 'tool_use',
              id: 'toolu_10',
              name: 'create_correction_request',
              input: {
                iteration: 1,
                description: 'Testes falhando em src/utils/currency.ts',
                files_with_issues: ['src/utils/currency.ts'],
                failing_tests: ['formatCurrency deve retornar BRL'],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 150, output_tokens: 65 },
          content: [{ type: 'text', text: 'Correção solicitada.' }],
        });

      const processor = await getProcessor();
      await processor({ data: validJobData });

      // devAgentQueue.add deve ser chamado para enfileirar correção
      expect(devAgentQueue.add).toHaveBeenCalled();
    });
  });

  describe('wait_for_dev_correction tool', () => {
    it('processa tool_use wait_for_dev_correction aguardando DEV', async () => {
      // Simula que o agentRun concluiu
      mockDbSelect.mockResolvedValueOnce([{ id: 'run-qa-uuid-branches' }]);

      const mockDbWait = vi.fn().mockResolvedValue([{
        id: 'correction-run-uuid',
        status: 'completed',
        output: JSON.stringify({ success: true }),
      }]);
      mockDb.where = mockDbWait;

      mockAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 90, output_tokens: 50 },
          content: [
            {
              type: 'tool_use',
              id: 'toolu_11',
              name: 'wait_for_dev_correction',
              input: { agent_run_id: 'some-agent-run-id' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 130, output_tokens: 55 },
          content: [{ type: 'text', text: 'DEV corrigiu.' }],
        });

      const processor = await getProcessor();
      await processor({ data: validJobData });
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('escalate_to_human tool', () => {
    it('processa tool_use escalate_to_human quando cobertura insuficiente após 3 iterações', async () => {
      mockAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 100, output_tokens: 55 },
          content: [
            {
              type: 'tool_use',
              id: 'toolu_12',
              name: 'escalate_to_human',
              input: {
                reason: 'Cobertura abaixo de 85% após 3 iterações: branches 78%',
                final_coverage: {
                  statements: { pct: 82 },
                  branches: { pct: 78 },
                  functions: { pct: 89 },
                  lines: { pct: 82 },
                },
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 140, output_tokens: 60 },
          content: [{ type: 'text', text: 'Escalado para humano.' }],
        });

      const processor = await getProcessor();
      await processor({ data: validJobData });
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('finish_qa_review tool', () => {
    it('processa finish_qa_review com passed=true e encerra aloop', async () => {
      mockAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 100, output_tokens: 55 },
          content: [
            {
              type: 'tool_use',
              id: 'toolu_13',
              name: 'finish_qa_review',
              input: {
                passed: true,
                summary: '# Relatório QA\n\nCI passou. Cobertura ≥ 85%.',
                iterations: 0,
                coverage: {
                  statements: { pct: 90 },
                  branches: { pct: 87 },
                  functions: { pct: 92 },
                  lines: { pct: 90 },
                },
                tests_written: [],
              },
            },
          ],
        });

      const processor = await getProcessor();
      const result = await processor({ data: validJobData });
      // finish_qa_review encerra o loop — apenas 1 chamada ao Anthropic
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    });

    it('processa finish_qa_review com passed=false (cobertura insuficiente)', async () => {
      mockAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 100, output_tokens: 55 },
          content: [
            {
              type: 'tool_use',
              id: 'toolu_14',
              name: 'finish_qa_review',
              input: {
                passed: false,
                summary: '# Relatório QA\n\nCobertura insuficiente após 3 iterações.',
                iterations: 3,
                coverage: {
                  statements: { pct: 80 },
                  branches: { pct: 75 },
                  functions: { pct: 88 },
                  lines: { pct: 80 },
                },
                tests_written: ['src/utils/currency-qa-iter3.test.ts'],
              },
            },
          ],
        });

      const processor = await getProcessor();
      const result = await processor({ data: validJobData });
      expect(result).toBeDefined();
    });
  });

  describe('ferramenta desconhecida', () => {
    it('responde com erro para tool_use de ferramenta não reconhecida', async () => {
      mockAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 70, output_tokens: 35 },
          content: [
            {
              type: 'tool_use',
              id: 'toolu_99',
              name: 'ferramenta_inexistente',
              input: { foo: 'bar' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 45 },
          content: [{ type: 'text', text: 'Ferramenta desconhecida tratada.' }],
        });

      const processor = await getProcessor();
      // Não deve lançar erro
      await expect(processor({ data: validJobData })).resolves.toBeDefined();
    });
  });

  describe('múltiplas tool_use no mesmo turno', () => {
    it('processa múltiplos tool_use blocks em paralelo', async () => {
      mockReadFile
        .mockResolvedValueOnce('// currency.ts content')
        .mockResolvedValueOnce('// currency.test.ts content');
      mockListDirectory.mockResolvedValueOnce(['src/utils/currency.ts']);

      mockAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 120, output_tokens: 70 },
          content: [
            {
              type: 'tool_use',
              id: 'toolu_multi_1',
              name: 'read_github_file',
              input: { file_path: 'src/utils/currency.ts', branch: 'agent/task-scrum-16' },
            },
            {
              type: 'tool_use',
              id: 'toolu_multi_2',
              name: 'read_github_file',
              input: { file_path: 'src/utils/currency.test.ts', branch: 'agent/task-scrum-16' },
            },
            {
              type: 'tool_use',
              id: 'toolu_multi_3',
              name: 'list_github_directory',
              input: { dir_path: 'src/utils' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 200, output_tokens: 80 },
          content: [{ type: 'text', text: 'Múltiplas ferramentas processadas.' }],
        });

      const processor = await getProcessor();
      await processor({ data: validJobData });

      expect(mockReadFile).toHaveBeenCalledTimes(2);
      expect(mockListDirectory).toHaveBeenCalledTimes(1);
    });
  });

  describe('erro na chamada à API Anthropic', () => {
    it('propaga erro quando Anthropic lança exceção', async () => {
      mockAnthropicCreate.mockRejectedValueOnce(new Error('API rate limit exceeded'));

      const processor = await getProcessor();
      await expect(processor({ data: validJobData })).rejects.toThrow();
    });
  });

  describe('pruneOldToolResults — controle de contexto', () => {
    it('processa múltiplos turnos sem explodir contexto (pruning automático)', async () => {
      // Simula 6 turnos (acima do limite de 5 keepLastTurns) para acionar pruning
      const toolResponses = Array.from({ length: 6 }, (_, i) => ({
        stop_reason: 'tool_use' as const,
        usage: { input_tokens: 50, output_tokens: 25 },
        content: [
          {
            type: 'tool_use' as const,
            id: `toolu_prune_${i}`,
            name: 'read_github_file',
            input: { file_path: `src/file_${i}.ts` },
          },
        ],
      }));

      mockReadFile.mockResolvedValue('// content');

      for (const r of toolResponses) {
        mockAnthropicCreate.mockResolvedValueOnce(r);
      }
      mockAnthropicCreate.mockResolvedValueOnce({
        stop_reason: 'end_turn',
        usage: { input_tokens: 200, output_tokens: 80 },
        content: [{ type: 'text', text: 'Pruning testado.' }],
      });

      const processor = await getProcessor();
      await processor({ data: validJobData });

      // Deve ter processado todos os turnos sem erros
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(7);
    });
  });
});

describe('qa-agent — qaAgentQueue exports', () => {
  it('exporta qaAgentQueue com defaultJobOptions configurados', async () => {
    const { qaAgentQueue } = await import('./qa-agent');
    expect(qaAgentQueue).toBeDefined();
  });
});
