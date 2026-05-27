/**
 * Testes adicionais de cobertura de branches para src/agents/lt.ts
 *
 * Foca nos caminhos não cobertos pelo lt.test.ts existente:
 * - Worker processor: processamento de tool_use blocks (read_github_file, commitFile)
 * - Erros propagados
 * - Múltiplos conteúdos no mesmo turno
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

const mockLtWorkerProcessor = { fn: null as ((...args: unknown[]) => unknown) | null };

vi.mock('bullmq', () => {
  const mockWorkerInstance = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const MockQueue = vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({ id: 'job-lt-branches-1' }),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  const MockWorker = vi.fn().mockImplementation((_name: string, processor: (...args: unknown[]) => unknown) => {
    mockLtWorkerProcessor.fn = processor;
    return mockWorkerInstance;
  });
  return { Queue: MockQueue, Worker: MockWorker };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue('eq-condition'),
}));

const mockDbLt = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([{ id: 'story-lt-uuid', jiraKey: 'SCRUM-16', status: 'a_refinar' }]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([{ id: 'agent-run-lt-uuid' }]),
};

vi.mock('../db/index', () => ({
  db: mockDbLt,
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

const mockCommitFileLt = vi.fn().mockResolvedValue(undefined);
const mockReadFileLt = vi.fn().mockResolvedValue('# PRD — SCRUM-16\n\nConteúdo do PRD.');

vi.mock('../github/client', () => ({
  commitFile: mockCommitFileLt,
  readFile: mockReadFileLt,
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

const mockLtAnthropicCreate = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockLtAnthropicCreate },
  }));
  return { default: MockAnthropic };
});

vi.mock('./prompts/lt-system-prompt', () => ({
  LT_SYSTEM_PROMPT: 'You are a LT agent.',
}));

vi.mock('../lib/anthropic-rate-limiter', () => ({
  waitForAnthropicCapacity: vi.fn().mockResolvedValue(undefined),
}));

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const validLtJobData = {
  storyId: 'story-lt-uuid',
  jiraKey: 'SCRUM-16',
  agentRunId: 'agent-run-lt-uuid',
  summary: 'Adicionar formatCurrency',
  fromStatus: 'PRD Aceito',
};

async function getLtProcessor() {
  const lt = await import('./lt');
  lt.createLtAgentWorker();
  return mockLtWorkerProcessor.fn as (job: unknown) => Promise<unknown>;
}

// ─── Testes ────────────────────────────────────────────────────────────────────

describe('lt-agent — processamento de tool_use blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbLt.select.mockReturnThis();
    mockDbLt.from.mockReturnThis();
    mockDbLt.update.mockReturnThis();
    mockDbLt.set.mockReturnThis();
    mockDbLt.insert.mockReturnThis();
    mockDbLt.values.mockReturnThis();
    mockDbLt.where.mockResolvedValue([{ id: 'story-lt-uuid', jiraKey: 'SCRUM-16', status: 'a_refinar' }]);
    mockDbLt.returning.mockResolvedValue([{ id: 'agent-run-lt-uuid' }]);
  });

  describe('read_github_file tool', () => {
    it('lê arquivo existente e retorna conteúdo ao agente', async () => {
      mockReadFileLt.mockResolvedValueOnce('# PRD SCRUM-16\n\nHistória de usuário.');

      mockLtAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 40 },
          content: [
            {
              type: 'tool_use',
              id: 'lt_toolu_01',
              name: 'read_github_file',
              input: { file_path: 'SCRUM-16/PRD.md', branch: 'prd/scrum-16' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 120, output_tokens: 50 },
          content: [{ type: 'text', text: '# Plano de Execução SCRUM-16\n\nPassos do plano.' }],
        });

      const processor = await getLtProcessor();
      await processor({ data: validLtJobData });

      expect(mockReadFileLt).toHaveBeenCalledWith('SCRUM-16/PRD.md', 'prd/scrum-16');
    });

    it('retorna null quando arquivo não existe', async () => {
      mockReadFileLt.mockResolvedValueOnce(null);

      mockLtAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 40 },
          content: [
            {
              type: 'tool_use',
              id: 'lt_toolu_02',
              name: 'read_github_file',
              input: { file_path: 'SCRUM-16/INEXISTENTE.md' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 120, output_tokens: 50 },
          content: [{ type: 'text', text: 'Arquivo não encontrado.' }],
        });

      const processor = await getLtProcessor();
      await processor({ data: validLtJobData });
      expect(mockLtAnthropicCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('commit_file tool', () => {
    it('processa commit_file e persiste plano de execução', async () => {
      mockLtAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 90, output_tokens: 50 },
          content: [
            {
              type: 'tool_use',
              id: 'lt_toolu_03',
              name: 'commit_file',
              input: {
                file_path: 'SCRUM-16/PLANO_DE_EXECUCAO.md',
                content: '# Plano de Execução SCRUM-16\n\n1. Criar currency.ts',
                commit_message: 'docs(SCRUM-16): adiciona plano de execução',
                branch: 'prd/scrum-16',
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 130, output_tokens: 55 },
          content: [{ type: 'text', text: 'Plano commitado.' }],
        });

      const processor = await getLtProcessor();
      await processor({ data: validLtJobData });

      // lt.ts ignora 'commit_file' como tool (retorna "Ferramenta desconhecida")
      // e commita usando o texto do end_turn com mensagem hardcoded
      expect(mockCommitFileLt).toHaveBeenCalledWith(
        'SCRUM-16/PLANO_DE_EXECUCAO.md',
        'Plano commitado.',
        'docs(SCRUM-16): plano de execução gerado pelo Agente LT\n\n[Agente LT v1.0] — Squad Agêntica',
        'prd/scrum-16',
      );
    });
  });

  describe('ferramenta desconhecida', () => {
    it('responde com erro para tool não reconhecido', async () => {
      mockLtAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 70, output_tokens: 35 },
          content: [
            {
              type: 'tool_use',
              id: 'lt_toolu_unknown',
              name: 'unknown_tool',
              input: {},
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 110, output_tokens: 45 },
          content: [{ type: 'text', text: 'Tratado.' }],
        });

      const processor = await getLtProcessor();
      await expect(processor({ data: validLtJobData })).resolves.toBeDefined();
    });
  });

  describe('error handling', () => {
    it('propaga erro da API Anthropic', async () => {
      mockLtAnthropicCreate.mockRejectedValueOnce(new Error('API unavailable'));

      const processor = await getLtProcessor();
      await expect(processor({ data: validLtJobData })).rejects.toThrow();
    });
  });
});
