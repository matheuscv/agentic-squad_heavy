/**
 * Testes de integração: Agente DEV com histórias reais
 *
 * Testa o loop de tool-use do Agente DEV com sequências pré-roteirizadas do Claude.
 * SCRUM-50: modo normal (implementa módulo utils/date)
 * SCRUM-51: modo correção (lê CORRECTION_REQUEST.md, não cria PR)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import {
  SCRUM_50,
  SCRUM_51,
  SCRUM_50_DEV_SEQUENCE,
  SCRUM_51_DEV_CORRECTION_SEQUENCE,
} from './fixtures';
import type { DevAgentJobData } from '../../agents/dev-agent';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  messagesCreate: vi.fn(),
  moveCardTo:     vi.fn().mockResolvedValue(undefined),
  addComment:     vi.fn().mockResolvedValue(undefined),
  createBranch:   vi.fn().mockResolvedValue(undefined),
  readFile:       vi.fn().mockResolvedValue('(conteúdo do arquivo)'),
  listDirectory:  vi.fn().mockResolvedValue([{ name: 'src', type: 'dir', path: 'src' }]),
  commitFiles:    vi.fn().mockResolvedValue({ sha: 'sha-abc123', url: '' }),
  createPullRequest: vi.fn().mockResolvedValue({ number: 42, url: 'https://github.com/pr/42', html_url: 'https://github.com/pr/42' }),
  dbUpdateWhere:     vi.fn().mockResolvedValue([]),
  dbInsertReturning: vi.fn().mockResolvedValue([{ id: 'artifact-uuid' }]),
  updateStoryStatus: vi.fn().mockResolvedValue(undefined),
}));

// ─── vi.mock ──────────────────────────────────────────────────────────────────

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({
    messages: { create: mocks.messagesCreate },
  })),
}));

vi.mock('bullmq', () => ({
  Queue:  vi.fn(() => ({ add: vi.fn(), close: vi.fn() })),
  Worker: vi.fn(() => ({ on: vi.fn().mockReturnThis(), close: vi.fn() })),
}));

vi.mock('../../jira/client', () => ({
  moveCardTo: mocks.moveCardTo,
  addComment:  mocks.addComment,
}));

vi.mock('../../github/client', () => ({
  createBranch:      mocks.createBranch,
  readFile:          mocks.readFile,
  listDirectory:     mocks.listDirectory,
  commitFiles:       mocks.commitFiles,
  createPullRequest: mocks.createPullRequest,
}));

vi.mock('../../db/stories', () => ({
  updateStoryStatus: mocks.updateStoryStatus,
}));

vi.mock('../../db/index', () => ({
  db: {
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: mocks.dbUpdateWhere })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: mocks.dbInsertReturning })) })),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Object.assign(Promise.resolve([]), { limit: vi.fn().mockResolvedValue([]) })) })) })),
  },
  schema: {
    agentRuns: { id: 'id', status: 'status', startedAt: 'started_at', completedAt: 'completed_at', output: 'output', durationMs: 'duration_ms', errorMessage: 'error_message' },
    artifacts: {},
  },
}));

vi.mock('../../queue/index', () => ({ redisConnection: { eval: vi.fn().mockResolvedValue(-1) } }));

vi.mock('../../lib/logger', () => ({
  childLogger: () => ({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
    child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  }),
  logAgentStarted:   vi.fn(),
  logAgentCompleted: vi.fn(),
  logAgentFailed:    vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDevJob(data: DevAgentJobData): Job<DevAgentJobData> {
  return { id: 'test-job', data, attemptsMade: 0, opts: { attempts: 2 } } as Job<DevAgentJobData>;
}

function loadMockSequence(sequence: ReturnType<typeof import('./fixtures').makeToolUseMsg>[]) {
  for (const msg of sequence) {
    mocks.messagesCreate.mockResolvedValueOnce(msg);
  }
}

// ─── Captura o processador do Worker ─────────────────────────────────────────

let processDevJob: (job: Job<DevAgentJobData>) => Promise<unknown>;

// ─────────────────────────────────────────────────────────────────────────────

describe('Agente DEV — histórias reais de baixa complexidade', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Recaptura o processador do Worker mockado
    const { Worker } = await import('bullmq');
    vi.mocked(Worker).mockImplementationOnce(
      (_name: string, processor: (job: Job) => Promise<unknown>) => {
        processDevJob = processor;
        return { on: vi.fn().mockReturnThis(), close: vi.fn() } as never;
      },
    );

    const { createDevAgentWorker } = await import('../../agents/dev-agent');
    createDevAgentWorker();
  });

  // ── SCRUM-50: modo normal ────────────────────────────────────────────────

  describe('SCRUM-50 — "Adicionar função formatDate() ao módulo utils" (modo normal)', () => {
    beforeEach(() => {
      loadMockSequence(SCRUM_50_DEV_SEQUENCE);
    });

    it('completa o loop de tool-use sem erros', async () => {
      const job = makeDevJob({
        storyId:    SCRUM_50.storyId,
        jiraKey:    SCRUM_50.jiraKey,
        agentRunId: SCRUM_50.agentRunId,
        summary:    SCRUM_50.summary,
        fromStatus: 'Plano Validado',
      });

      const result = await processDevJob(job);

      expect(result).toMatchObject({
        prNumber:     42,
        branch:       'agent/task-scrum-50',
        filesWritten: expect.any(Array),
      });
    });

    it('cria o branch antes de qualquer operação', async () => {
      const job = makeDevJob({
        storyId:    SCRUM_50.storyId,
        jiraKey:    SCRUM_50.jiraKey,
        agentRunId: SCRUM_50.agentRunId,
        summary:    SCRUM_50.summary,
        fromStatus: 'Plano Validado',
      });

      await processDevJob(job);

      expect(mocks.createBranch).toHaveBeenCalledWith('agent/task-scrum-50');
    });

    it('comita os arquivos gerados (utils/date.ts e date.test.ts)', async () => {
      const job = makeDevJob({
        storyId:    SCRUM_50.storyId,
        jiraKey:    SCRUM_50.jiraKey,
        agentRunId: SCRUM_50.agentRunId,
        summary:    SCRUM_50.summary,
        fromStatus: 'Plano Validado',
      });

      await processDevJob(job);

      // commitFiles chamado ao menos uma vez com os 2 arquivos
      expect(mocks.commitFiles).toHaveBeenCalled();
      const allFiles = mocks.commitFiles.mock.calls.flatMap(
        (call: [Array<{ path: string }>, ...unknown[]]) => call[0].map((f) => f.path),
      );
      expect(allFiles).toContain('src/utils/date.ts');
      expect(allFiles).toContain('src/utils/date.test.ts');
    });

    it('cria PR com título no formato "[JIRA-KEY] descrição"', async () => {
      const job = makeDevJob({
        storyId:    SCRUM_50.storyId,
        jiraKey:    SCRUM_50.jiraKey,
        agentRunId: SCRUM_50.agentRunId,
        summary:    SCRUM_50.summary,
        fromStatus: 'Plano Validado',
      });

      await processDevJob(job);

      expect(mocks.createPullRequest).toHaveBeenCalledWith(
        expect.stringMatching(/^\[SCRUM-50\]/),
        expect.any(String),
        'agent/task-scrum-50',
      );
    });

    it('move o card para "Aguardando Aceite Dev" no Jira', async () => {
      const job = makeDevJob({
        storyId:    SCRUM_50.storyId,
        jiraKey:    SCRUM_50.jiraKey,
        agentRunId: SCRUM_50.agentRunId,
        summary:    SCRUM_50.summary,
        fromStatus: 'Plano Validado',
      });

      await processDevJob(job);

      expect(mocks.moveCardTo).toHaveBeenCalledWith(SCRUM_50.jiraKey, 'Aguardando Aceite Dev');
    });

    it('posta comentário no Jira com link para o PR', async () => {
      const job = makeDevJob({
        storyId:    SCRUM_50.storyId,
        jiraKey:    SCRUM_50.jiraKey,
        agentRunId: SCRUM_50.agentRunId,
        summary:    SCRUM_50.summary,
        fromStatus: 'Plano Validado',
      });

      await processDevJob(job);

      expect(mocks.addComment).toHaveBeenCalledWith(
        SCRUM_50.jiraKey,
        expect.stringContaining('Pull Request'),
      );
    });

    it('marca o agentRun como "completed" no banco', async () => {
      const job = makeDevJob({
        storyId:    SCRUM_50.storyId,
        jiraKey:    SCRUM_50.jiraKey,
        agentRunId: SCRUM_50.agentRunId,
        summary:    SCRUM_50.summary,
        fromStatus: 'Plano Validado',
      });

      await processDevJob(job);

      // O último dbUpdate deve conter status: 'completed'
      expect(mocks.dbUpdateWhere).toHaveBeenCalled();
    });
  });

  // ── SCRUM-51: modo correção ──────────────────────────────────────────────

  describe('SCRUM-51 — "Adicionar endpoint GET /ping" (modo correção)', () => {
    beforeEach(() => {
      loadMockSequence(SCRUM_51_DEV_CORRECTION_SEQUENCE);
    });

    it('não cria PR em modo correção (PR já existe)', async () => {
      const job = makeDevJob({
        storyId:         SCRUM_51.storyId,
        jiraKey:         SCRUM_51.jiraKey,
        agentRunId:      SCRUM_51.agentRunId,
        summary:         SCRUM_51.summary,
        fromStatus:      'Em QA',
        correctionMode:  true,
        correctionIteration: 1,
      });

      await processDevJob(job);

      expect(mocks.createPullRequest).not.toHaveBeenCalled();
    });

    it('não move card no Jira em modo correção (QA assume controle)', async () => {
      const job = makeDevJob({
        storyId:         SCRUM_51.storyId,
        jiraKey:         SCRUM_51.jiraKey,
        agentRunId:      SCRUM_51.agentRunId,
        summary:         SCRUM_51.summary,
        fromStatus:      'Em QA',
        correctionMode:  true,
        correctionIteration: 1,
      });

      await processDevJob(job);

      expect(mocks.moveCardTo).not.toHaveBeenCalled();
    });

    it('comita a correção no branch existente', async () => {
      const job = makeDevJob({
        storyId:         SCRUM_51.storyId,
        jiraKey:         SCRUM_51.jiraKey,
        agentRunId:      SCRUM_51.agentRunId,
        summary:         SCRUM_51.summary,
        fromStatus:      'Em QA',
        correctionMode:  true,
        correctionIteration: 1,
      });

      await processDevJob(job);

      expect(mocks.commitFiles).toHaveBeenCalled();
      const correctedFiles = mocks.commitFiles.mock.calls.flatMap(
        (call: [Array<{ path: string }>, ...unknown[]]) => call[0].map((f) => f.path),
      );
      expect(correctedFiles).toContain('src/routes/ping.ts');
    });

    it('retorna filesWritten com correctionMode: true no resultado', async () => {
      const job = makeDevJob({
        storyId:         SCRUM_51.storyId,
        jiraKey:         SCRUM_51.jiraKey,
        agentRunId:      SCRUM_51.agentRunId,
        summary:         SCRUM_51.summary,
        fromStatus:      'Em QA',
        correctionMode:  true,
        correctionIteration: 1,
      });

      const result = await processDevJob(job);

      expect(result).toMatchObject({ correctionMode: true, filesWritten: expect.any(Array) });
    });
  });
});
