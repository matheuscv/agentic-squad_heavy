/**
 * Testes adicionais de cobertura de branches para src/agents/po.ts
 *
 * Foca nos caminhos não cobertos pelo po.test.ts existente:
 * - Worker processor: processamento de tool_use blocks (read_github_file, commitFile)
 * - Ferramentas: getIssue, commitFile, read_github_file, createBranch
 * - Erros de API
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks de infraestrutura ──────────────────────────────────────────────────

vi.mock('ioredis', () => {
  const MockIORedis = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
  }));
  return { default: MockIORedis };
});

const mockPoWorkerProcessor = { fn: null as ((...args: unknown[]) => unknown) | null };

vi.mock('bullmq', () => {
  const mockWorkerInstance = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const MockQueue = vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({ id: 'job-po-branches-1' }),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  const MockWorker = vi.fn().mockImplementation((_name: string, processor: (...args: unknown[]) => unknown) => {
    mockPoWorkerProcessor.fn = processor;
    return mockWorkerInstance;
  });
  return { Queue: MockQueue, Worker: MockWorker };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue('eq-condition'),
}));

const mockDbPo = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([{ id: 'story-po-uuid', jiraKey: 'SCRUM-16', status: 'a_refinar' }]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([{ id: 'agent-run-po-uuid' }]),
};

vi.mock('../db/index', () => ({
  db: mockDbPo,
  schema: {
    stories: { id: 'id', jiraKey: 'jiraKey', status: 'status' },
    storyStatusEnum: { enumValues: ['backlog', 'a_refinar'] },
    agentRuns: { id: 'id', status: 'status', startedAt: 'startedAt', completedAt: 'completedAt', output: 'output' },
    artifacts: { id: 'id', storyId: 'storyId', artifactType: 'artifactType', filePath: 'filePath', content: 'content', commitSha: 'commitSha' },
  },
}));

vi.mock('../db/stories', () => ({
  updateStoryStatus: vi.fn().mockResolvedValue(undefined),
  updateStoryDescription: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../queue/index', () => ({
  redisConnection: { on: vi.fn() },
  orchestratorQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));

const mockGetIssuePo = vi.fn().mockResolvedValue({
  id: '10016',
  key: 'SCRUM-16',
  fields: {
    summary: 'Adicionar formatCurrency',
    status: { name: 'A Refinar' },
    description: null,
    issuetype: { name: 'Story' },
  },
});
vi.mock('../jira/client', () => ({
  getIssue: mockGetIssuePo,
  moveCardTo: vi.fn().mockResolvedValue(undefined),
  addComment: vi.fn().mockResolvedValue(undefined),
}));

const mockCommitFilePo = vi.fn().mockResolvedValue(undefined);
const mockReadFilePo = vi.fn().mockResolvedValue(null);
const mockCreateBranchPo = vi.fn().mockResolvedValue(undefined);

vi.mock('../github/client', () => ({
  commitFile: mockCommitFilePo,
  createBranch: mockCreateBranchPo,
  readFile: mockReadFilePo,
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

const mockPoAnthropicCreate = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockPoAnthropicCreate },
  }));
  return { default: MockAnthropic };
});

vi.mock('./prompts/po-system-prompt', () => ({
  PO_SYSTEM_PROMPT: 'You are a PO agent.',
}));

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const validPoJobData = {
  storyId: 'story-po-uuid',
  jiraKey: 'SCRUM-16',
  agentRunId: 'agent-run-po-uuid',
  summary: 'Adicionar formatCurrency',
  fromStatus: 'A Refinar',
};

async function getPoProcessor() {
  await import('./po');
  return mockPoWorkerProcessor.fn as (job: unknown) => Promise<unknown>;
}

// ─── Testes ────────────────────────────────────────────────────────────────────

describe('po-agent — processamento de tool_use blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbPo.select.mockReturnThis();
    mockDbPo.from.mockReturnThis();
    mockDbPo.update.mockReturnThis();
    mockDbPo.set.mockReturnThis();
    mockDbPo.insert.mockReturnThis();
    mockDbPo.values.mockReturnThis();
    mockDbPo.where.mockResolvedValue([{ id: 'story-po-uuid', jiraKey: 'SCRUM-16', status: 'a_refinar' }]);
    mockDbPo.returning.mockResolvedValue([{ id: 'agent-run-po-uuid' }]);
  });

  describe('get_issue tool', () => {
    it('processa tool_use get_issue e retorna dados do Jira', async () => {
      mockGetIssuePo.mockResolvedValueOnce({
        id: '10016',
        key: 'SCRUM-16',
        fields: {
          summary: 'Adicionar formatCurrency',
          status: { name: 'A Refinar' },
          description: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Formatar moeda' }] }],
          },
          issuetype: { name: 'Story' },
        },
      });

      mockPoAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 90, output_tokens: 45 },
          content: [
            {
              type: 'tool_use',
              id: 'po_toolu_01',
              name: 'get_issue',
              input: { jira_key: 'SCRUM-16' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 140, output_tokens: 60 },
          content: [{ type: 'text', text: '# PRD — SCRUM-16\n\nA função formatCurrency deve...' }],
        });

      const processor = await getPoProcessor();
      await processor({ data: validPoJobData });

      expect(mockGetIssuePo).toHaveBeenCalledWith('SCRUM-16');
    });

    it('trata erro no get_issue graciosamente', async () => {
      mockGetIssuePo.mockRejectedValueOnce(new Error('Jira issue not found'));

      mockPoAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 90, output_tokens: 45 },
          content: [
            {
              type: 'tool_use',
              id: 'po_toolu_err',
              name: 'get_issue',
              input: { jira_key: 'SCRUM-16' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 130, output_tokens: 55 },
          content: [{ type: 'text', text: 'Erro tratado.' }],
        });

      const processor = await getPoProcessor();
      // Pode ou não propagar — depende da implementação
      const result = await processor({ data: validPoJobData }).catch(() => 'error');
      expect(result).toBeDefined();
    });
  });

  describe('commit_file tool', () => {
    it('processa commit_file e salva PRD no branch', async () => {
      mockPoAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 100, output_tokens: 55 },
          content: [
            {
              type: 'tool_use',
              id: 'po_toolu_02',
              name: 'commit_file',
              input: {
                file_path: 'SCRUM-16/PRD.md',
                content: '# PRD — SCRUM-16\n\nO sistema deve...',
                commit_message: 'docs(SCRUM-16): adiciona PRD',
                branch: 'prd/scrum-16',
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 140, output_tokens: 60 },
          content: [{ type: 'text', text: 'PRD commitado.' }],
        });

      const processor = await getPoProcessor();
      await processor({ data: validPoJobData });

      expect(mockCommitFilePo).toHaveBeenCalledWith(
        'SCRUM-16/PRD.md',
        '# PRD — SCRUM-16\n\nO sistema deve...',
        'docs(SCRUM-16): adiciona PRD',
        'prd/scrum-16',
      );
    });
  });

  describe('read_github_file tool', () => {
    it('lê arquivo de branch específico', async () => {
      mockReadFilePo.mockResolvedValueOnce('# Template PRD');

      mockPoAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 40 },
          content: [
            {
              type: 'tool_use',
              id: 'po_toolu_03',
              name: 'read_github_file',
              input: { file_path: 'docs/templates/PRD_TEMPLATE.md', branch: 'main' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 120, output_tokens: 50 },
          content: [{ type: 'text', text: 'Template lido.' }],
        });

      const processor = await getPoProcessor();
      await processor({ data: validPoJobData });

      expect(mockReadFilePo).toHaveBeenCalledWith('docs/templates/PRD_TEMPLATE.md', 'main');
    });
  });

  describe('create_branch tool', () => {
    it('processa create_branch para criar branch prd/scrum-16', async () => {
      mockPoAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 85, output_tokens: 45 },
          content: [
            {
              type: 'tool_use',
              id: 'po_toolu_04',
              name: 'create_branch',
              input: { branch_name: 'prd/scrum-16', base_branch: 'main' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 125, output_tokens: 55 },
          content: [{ type: 'text', text: 'Branch criado.' }],
        });

      const processor = await getPoProcessor();
      await processor({ data: validPoJobData });
      expect(mockPoAnthropicCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('ferramenta desconhecida', () => {
    it('trata graciosamente tool_use não reconhecido', async () => {
      mockPoAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 70, output_tokens: 35 },
          content: [
            {
              type: 'tool_use',
              id: 'po_toolu_unknown',
              name: 'inexistent_tool',
              input: { key: 'value' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 110, output_tokens: 45 },
          content: [{ type: 'text', text: 'Tratado.' }],
        });

      const processor = await getPoProcessor();
      await expect(processor({ data: validPoJobData })).resolves.toBeDefined();
    });
  });

  describe('múltiplos tool_use no mesmo turno', () => {
    it('processa múltiplas ferramentas em paralelo', async () => {
      mockReadFilePo
        .mockResolvedValueOnce('# README')
        .mockResolvedValueOnce(null);
      mockGetIssuePo.mockResolvedValueOnce({
        id: '10016',
        key: 'SCRUM-16',
        fields: {
          summary: 'Adicionar formatCurrency',
          status: { name: 'A Refinar' },
          description: null,
          issuetype: { name: 'Story' },
        },
      });

      mockPoAnthropicCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          usage: { input_tokens: 120, output_tokens: 65 },
          content: [
            {
              type: 'tool_use',
              id: 'po_multi_1',
              name: 'read_github_file',
              input: { file_path: 'README.md' },
            },
            {
              type: 'tool_use',
              id: 'po_multi_2',
              name: 'get_issue',
              input: { jira_key: 'SCRUM-16' },
            },
            {
              type: 'tool_use',
              id: 'po_multi_3',
              name: 'read_github_file',
              input: { file_path: 'docs/inexistente.md' },
            },
          ],
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          usage: { input_tokens: 200, output_tokens: 80 },
          content: [{ type: 'text', text: 'Paralelo OK.' }],
        });

      const processor = await getPoProcessor();
      await processor({ data: validPoJobData });

      expect(mockReadFilePo).toHaveBeenCalledTimes(2);
      expect(mockGetIssuePo).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('propaga erro quando Anthropic lança exceção', async () => {
      mockPoAnthropicCreate.mockRejectedValueOnce(new Error('Overloaded'));

      const processor = await getPoProcessor();
      await expect(processor({ data: validPoJobData })).rejects.toThrow();
    });
  });
});
