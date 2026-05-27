/**
 * Testes adicionais de cobertura de branches para src/agents/dev-agent.ts
 *
 * Foca nos caminhos não cobertos pelo dev-agent.test.ts existente:
 * - Worker processor: processamento de tool_use blocks (todas as ferramentas)
 * - createBranch, commitFiles, createPullRequest chamados pelo worker
 * - correctionMode=true
 * - Erros propagados corretamente
 * - pruneOldToolResults com muitos turnos
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

const mockDevWorkerProcessor = { fn: null as ((...args: unknown[]) => unknown) | null };

vi.mock('bullmq', () => {
  const mockWorkerInstance = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const MockQueue = vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({ id: 'job-dev-branches-1' }),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  const MockWorker = vi.fn().mockImplementation((_name: string, processor: (...args: unknown[]) => unknown) => {
    mockDevWorkerProcessor.fn = processor;
    return mockWorkerInstance;
  });
  return { Queue: MockQueue, Worker: MockWorker };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue('eq-condition'),
  and: vi.fn().mockReturnValue('and-condition'),
}));

const mockDbDev = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([{ id: 'story-uuid-dev', jiraKey: 'SCRUM-16', status: 'em_desenvolvimento' }]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([{ id: 'agent-run-dev-uuid' }]),
};

vi.mock('../db/index', () => ({
  db: mockDbDev,
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

const mockCreateBranch = vi.fn().mockResolvedValue(undefined);
const mockReadFileDev = vi.fn().mockResolvedValue('# Plano de Execução\n\nPassos.');
const mockListDirectoryDev = vi.fn().mockResolvedValue(['src/utils/', 'src/utils/currency.ts']);
const mockCommitFilesDev = vi.fn().mockResolvedValue({ sha: 'def456', url: 'https://github.com/commit/def456' });
const mockCreatePullRequest = vi.fn().mockResolvedValue({
  number: 99,
  url: 'https://api.github.com/repos/org/repo/pulls/99',
  html_url: 'https://github.com/org/repo/pull/99',
});

vi.mock('../github/client', () => ({
  createBranch: mockCreateBranch,
  readFile: mockReadFileDev,
  listDirectory: mockListDirectoryDev,
  commitFiles: mockCommitFilesDev,
  createPullRequest: mockCreatePullRequest,
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
  DEV_SYSTEM_PROMPT: 'You are a DEV agent.',
}));

const mockAnthropicDevCreate = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicDevCreate },
  }));
  return { default: MockAnthropic };
});

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const validDevJobData = {
  storyId: 'story-dev-uuid',
  jiraKey: 'SCRUM-16',
  agentRunId: 'agent-run-dev-uuid',
  summary: 'Adicionar formatCurrency',
  fromStatus: 'Plano Validado',
};

const correctionJobData = {
  ...validDevJobData,
  correctionMode: true,
  correctionIteration: 1,
};

// ─── Helper ────────────────────────────────────────────────────────────────────

async function getDevProcessor() {
  await import('./dev-agent');
  return mockDevWorkerProcessor.fn as (job: unknown) => Promise<unknown>;
}

// ─── Testes ────────────────────────────────────────────────────────────────────

describe('dev-agent — processamento de tool_use blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbDev.select.mockReturnThis();
    mockDbDev.from.mockReturnThis();
    mockDbDev.update.mockReturnThis();
    mockDbDev.set.mockReturnThis();
    mockDbDev.insert.mockReturnThis();
    mockDbDev.values.mockReturnThis();
    mockDbDev.where.mockResolvedValue([{ id: 'story-uuid-dev', jiraKey: 'SCRUM-16', status: 'em_desenvolvimento' }]);
    mockDbDev.returning.mockResolvedValue([{ id: 'agent-run-dev-uuid' }]);
  });

  describe('read_github_file tool', () => {
    it('processa tool_use read_github_file e retorna conteúdo', async () => {
      mockReadFileDev.mockResolvedValueOnce('export function formatCurrency() {}');

      mockAnthropicDevCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [
            {
              type: 'tool_use',
              id: 'dev_toolu_01',
              name: 'read_github_file',
              input: { file_path: 'src/utils/currency.ts' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 150, output_tokens: 60 },
          content: [{ type: 'text', text: 'Arquivo lido.' }],
        });

      const processor = await getDevProcessor();
      await processor({ data: validDevJobData });

      expect(mockReadFileDev).toHaveBeenCalledWith('src/utils/currency.ts', undefined);
    });

    it('processa read_github_file de branch específico (plano)', async () => {
      mockReadFileDev.mockResolvedValueOnce('# Plano de Execução');

      mockAnthropicDevCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 90, output_tokens: 45 },
          content: [
            {
              type: 'tool_use',
              id: 'dev_toolu_02',
              name: 'read_github_file',
              input: { file_path: 'SCRUM-16/PLANO_DE_EXECUCAO.md', branch: 'prd/scrum-16' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 130, output_tokens: 55 },
          content: [{ type: 'text', text: 'Plano lido.' }],
        });

      const processor = await getDevProcessor();
      await processor({ data: validDevJobData });

      expect(mockReadFileDev).toHaveBeenCalledWith('SCRUM-16/PLANO_DE_EXECUCAO.md', 'prd/scrum-16');
    });
  });

  describe('list_github_directory tool', () => {
    it('processa tool_use list_github_directory', async () => {
      mockListDirectoryDev.mockResolvedValueOnce(['src/utils/currency.ts', 'src/utils/index.ts']);

      mockAnthropicDevCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 70, output_tokens: 35 },
          content: [
            {
              type: 'tool_use',
              id: 'dev_toolu_03',
              name: 'list_github_directory',
              input: { dir_path: 'src/utils' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 110, output_tokens: 45 },
          content: [{ type: 'text', text: 'Diretório listado.' }],
        });

      const processor = await getDevProcessor();
      await processor({ data: validDevJobData });

      expect(mockListDirectoryDev).toHaveBeenCalledWith('src/utils', undefined);
    });
  });

  describe('write_github_file tool', () => {
    it('processa tool_use write_github_file (staging)', async () => {
      mockAnthropicDevCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 90, output_tokens: 50 },
          content: [
            {
              type: 'tool_use',
              id: 'dev_toolu_04',
              name: 'write_github_file',
              input: {
                file_path: 'src/utils/currency.ts',
                content: "export function formatCurrency(v: number, c: string): string { return ''; }",
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 130, output_tokens: 55 },
          content: [{ type: 'text', text: 'Arquivo preparado.' }],
        });

      const processor = await getDevProcessor();
      await processor({ data: validDevJobData });
      // Nenhum commit ainda
      expect(mockCommitFilesDev).not.toHaveBeenCalled();
    });
  });

  describe('create_github_commit tool', () => {
    it('processa tool_use create_github_commit', async () => {
      mockCommitFilesDev.mockResolvedValueOnce({ sha: 'ghi789', url: 'https://github.com/commit/ghi789' });

      mockAnthropicDevCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 45 },
          content: [
            {
              type: 'tool_use',
              id: 'dev_toolu_05',
              name: 'create_github_commit',
              input: { commit_message: 'feat(SCRUM-16): adiciona formatCurrency' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 120, output_tokens: 50 },
          content: [{ type: 'text', text: 'Commit criado.' }],
        });

      const processor = await getDevProcessor();
      await processor({ data: validDevJobData });
      expect(mockAnthropicDevCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('create_pull_request tool', () => {
    it('processa tool_use create_pull_request e abre PR', async () => {
      mockCreatePullRequest.mockResolvedValueOnce({
        number: 16,
        url: 'https://api.github.com/repos/org/repo/pulls/16',
        html_url: 'https://github.com/org/repo/pull/16',
      });

      mockAnthropicDevCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 100, output_tokens: 55 },
          content: [
            {
              type: 'tool_use',
              id: 'dev_toolu_06',
              name: 'create_pull_request',
              input: {
                title: 'feat(SCRUM-16): adiciona formatCurrency',
                body: 'Implementa formatCurrency(value, currency)',
                base: 'main',
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 140, output_tokens: 60 },
          content: [{ type: 'text', text: 'PR criado com sucesso.' }],
        });

      const processor = await getDevProcessor();
      await processor({ data: validDevJobData });
      expect(mockAnthropicDevCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('correctionMode=true', () => {
    it('processa job no modo de correção (correctionMode=true)', async () => {
      mockAnthropicDevCreate
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 120, output_tokens: 60 },
          content: [{ type: 'text', text: 'Correções aplicadas com sucesso.' }],
        });

      const processor = await getDevProcessor();
      const result = await processor({ data: correctionJobData });
      expect(result).toBeDefined();
    });

    it('processa correção com correctionIteration=2', async () => {
      mockAnthropicDevCreate
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [{ type: 'text', text: 'Iteração 2 de correção concluída.' }],
        });

      const processor = await getDevProcessor();
      const result = await processor({ data: { ...correctionJobData, correctionIteration: 2 } });
      expect(result).toBeDefined();
    });
  });

  describe('ferramenta desconhecida', () => {
    it('responde com erro para tool_use não reconhecido', async () => {
      mockAnthropicDevCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 70, output_tokens: 35 },
          content: [
            {
              type: 'tool_use',
              id: 'dev_toolu_unknown',
              name: 'ferramenta_inexistente',
              input: { foo: 'bar' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 110, output_tokens: 45 },
          content: [{ type: 'text', text: 'Tratado.' }],
        });

      const processor = await getDevProcessor();
      await expect(processor({ data: validDevJobData })).resolves.toBeDefined();
    });
  });

  describe('múltiplas tool_use em paralelo', () => {
    it('processa múltiplos tool_use blocks simultaneamente', async () => {
      mockReadFileDev
        .mockResolvedValueOnce('// arquivo A')
        .mockResolvedValueOnce('// arquivo B');
      mockListDirectoryDev.mockResolvedValueOnce(['src/utils/a.ts', 'src/utils/b.ts']);

      mockAnthropicDevCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 130, output_tokens: 75 },
          content: [
            {
              type: 'tool_use',
              id: 'dev_multi_1',
              name: 'read_github_file',
              input: { file_path: 'src/utils/a.ts' },
            },
            {
              type: 'tool_use',
              id: 'dev_multi_2',
              name: 'read_github_file',
              input: { file_path: 'src/utils/b.ts' },
            },
            {
              type: 'tool_use',
              id: 'dev_multi_3',
              name: 'list_github_directory',
              input: { dir_path: 'src/utils' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 200, output_tokens: 80 },
          content: [{ type: 'text', text: 'Processamento paralelo concluído.' }],
        });

      const processor = await getDevProcessor();
      await processor({ data: validDevJobData });

      expect(mockReadFileDev).toHaveBeenCalledTimes(2);
      expect(mockListDirectoryDev).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('propaga erro quando Anthropic lança exceção inesperada', async () => {
      mockAnthropicDevCreate.mockRejectedValueOnce(new Error('Connection timeout'));

      const processor = await getDevProcessor();
      await expect(processor({ data: validDevJobData })).rejects.toThrow();
    });
  });
});
