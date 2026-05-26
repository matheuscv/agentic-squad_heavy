/**
 * Testes de integração: Loop de Correção do Agente QA
 *
 * Testa os 3 cenários principais do loop QA → DEV → QA:
 *  1. Happy path  — CI passa com ≥ 85% de cobertura, sem correções
 *  2. 1 ciclo     — CI falha → DEV corrige → CI passa → aprovado
 *  3. 3 ciclos    — CI falha 3 vezes → escala para humano
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import {
  SCRUM_50,
  SCRUM_51,
  QA_HAPPY_PATH_SEQUENCE,
  QA_ONE_CORRECTION_SEQUENCE,
  QA_ESCALATION_SEQUENCE,
  COVERAGE_OK,
  COVERAGE_LOW,
} from './fixtures';
import type { QaAgentJobData } from '../../agents/qa-agent';

// ─── Env: poll sem espera nos testes ─────────────────────────────────────────

process.env['QA_POLL_INTERVAL_MS'] = '0';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  messagesCreate: vi.fn(),

  // GitHub
  readFile:                  vi.fn().mockResolvedValue(null),
  listDirectory:             vi.fn().mockResolvedValue([]),
  commitFiles:               vi.fn().mockResolvedValue({ sha: 'sha-abc', url: '' }),
  getLatestWorkflowRun:      vi.fn(),
  waitForWorkflowCompletion: vi.fn(),

  // Jira
  moveCardTo: vi.fn().mockResolvedValue(undefined),
  addComment:  vi.fn().mockResolvedValue(undefined),

  // BullMQ — fila DEV para correções
  devQueueAdd: vi.fn().mockResolvedValue({ id: 'dev-correction-job-id' }),

  // DB
  dbUpdateWhere:     vi.fn().mockResolvedValue([]),
  dbInsertReturning: vi.fn().mockResolvedValue([{ id: 'new-run-uuid' }]),
  dbSelectWhere:     vi.fn(),

  // Stories
  updateStoryStatus: vi.fn().mockResolvedValue(undefined),
}));

// ─── vi.mock ──────────────────────────────────────────────────────────────────

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({ messages: { create: mocks.messagesCreate } })),
}));

vi.mock('bullmq', () => ({
  Queue:  vi.fn(() => ({ add: mocks.devQueueAdd, close: vi.fn() })),
  Worker: vi.fn(() => ({ on: vi.fn().mockReturnThis(), close: vi.fn() })),
}));

vi.mock('../../jira/client', () => ({
  moveCardTo: mocks.moveCardTo,
  addComment:  mocks.addComment,
}));

vi.mock('../../github/client', () => ({
  readFile:                  mocks.readFile,
  listDirectory:             mocks.listDirectory,
  commitFiles:               mocks.commitFiles,
  getLatestWorkflowRun:      mocks.getLatestWorkflowRun,
  waitForWorkflowCompletion: mocks.waitForWorkflowCompletion,
}));

vi.mock('../../agents/dev-agent', () => ({
  devAgentQueue: { add: mocks.devQueueAdd, close: vi.fn() },
}));

vi.mock('../../db/stories', () => ({
  updateStoryStatus: mocks.updateStoryStatus,
}));

vi.mock('../../db/index', () => ({
  db: {
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: mocks.dbUpdateWhere })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: mocks.dbInsertReturning })) })),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: mocks.dbSelectWhere })) })),
  },
  schema: {
    agentRuns: { id: 'id', status: 'status', output: 'output', startedAt: 'started_at', completedAt: 'completed_at', durationMs: 'duration_ms', errorMessage: 'error_message' },
    artifacts: {},
    stories:   { jiraKey: 'jira_key' },
  },
}));

vi.mock('../../queue/index', () => ({ redisConnection: {} }));

vi.mock('../../lib/logger', () => ({
  childLogger: () => ({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
    child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeQaJob(data: QaAgentJobData): Job<QaAgentJobData> {
  return { id: 'test-qa-job', data, attemptsMade: 0, opts: { attempts: 2 } } as Job<QaAgentJobData>;
}

function loadMockSequence(sequence: ReturnType<typeof import('./fixtures').makeToolUseMsg>[]) {
  vi.clearAllMocks();
  process.env['QA_POLL_INTERVAL_MS'] = '0';
  for (const msg of sequence) {
    mocks.messagesCreate.mockResolvedValueOnce(msg);
  }
}

// ─── Captura o processador do Worker ─────────────────────────────────────────

let processQaJob: (job: Job<QaAgentJobData>) => Promise<unknown>;

describe('Agente QA — Loop de Correção (histórias reais)', () => {
  beforeEach(async () => {
    // Recaptura o processador real via Worker mock
    const { Worker } = await import('bullmq');
    vi.mocked(Worker).mockImplementationOnce(
      (_name: string, processor: (job: Job) => Promise<unknown>) => {
        processQaJob = processor;
        return { on: vi.fn().mockReturnThis(), close: vi.fn() } as never;
      },
    );

    const { createQaAgentWorker } = await import('../../agents/qa-agent');
    createQaAgentWorker();
  });

  // ── Cenário 1: Happy path ────────────────────────────────────────────────

  describe('Cenário 1 — Happy path (SCRUM-50: cobertura ≥ 85%, CI passou)', () => {
    beforeEach(() => {
      loadMockSequence(QA_HAPPY_PATH_SEQUENCE);

      // CI passou com boa cobertura
      mocks.getLatestWorkflowRun.mockResolvedValue({
        runId: 100,
        status: 'completed',
        conclusion: 'success',
        htmlUrl: 'https://github.com/actions/runs/100',
        createdAt: new Date().toISOString(),
      });
      // .qa-coverage.json com 91% de cobertura
      mocks.readFile.mockImplementation((path: string) => {
        if (path === '.qa-coverage.json') return Promise.resolve(COVERAGE_OK);
        return Promise.resolve('(conteúdo)');
      });
    });

    it('passa sem iterações quando cobertura já é ≥ 85%', async () => {
      const job = makeQaJob({
        storyId:    SCRUM_50.storyId,
        jiraKey:    SCRUM_50.jiraKey,
        agentRunId: SCRUM_50.agentRunId,
        summary:    SCRUM_50.summary,
        fromStatus: 'Aguardando Aceite Dev',
      });

      const result = await processQaJob(job);

      expect(result).toMatchObject({ passed: true, iterations: 0 });
    });

    it('não cria pedido de correção quando CI está verde', async () => {
      const job = makeQaJob({
        storyId:    SCRUM_50.storyId,
        jiraKey:    SCRUM_50.jiraKey,
        agentRunId: SCRUM_50.agentRunId,
        summary:    SCRUM_50.summary,
        fromStatus: 'Aguardando Aceite Dev',
      });

      await processQaJob(job);

      expect(mocks.devQueueAdd).not.toHaveBeenCalled();
      expect(mocks.commitFiles).not.toHaveBeenCalled();
    });

    it('move card para "Aguardando Aceite QA" no Jira', async () => {
      const job = makeQaJob({
        storyId:    SCRUM_50.storyId,
        jiraKey:    SCRUM_50.jiraKey,
        agentRunId: SCRUM_50.agentRunId,
        summary:    SCRUM_50.summary,
        fromStatus: 'Aguardando Aceite Dev',
      });

      await processQaJob(job);

      expect(mocks.moveCardTo).toHaveBeenCalledWith(SCRUM_50.jiraKey, 'Aguardando Aceite QA');
    });

    it('posta comentário de aprovação no Jira', async () => {
      const job = makeQaJob({
        storyId:    SCRUM_50.storyId,
        jiraKey:    SCRUM_50.jiraKey,
        agentRunId: SCRUM_50.agentRunId,
        summary:    SCRUM_50.summary,
        fromStatus: 'Aguardando Aceite Dev',
      });

      await processQaJob(job);

      expect(mocks.addComment).toHaveBeenCalledWith(
        SCRUM_50.jiraKey,
        expect.stringContaining('aprovada'),
      );
    });
  });

  // ── Cenário 2: 1 ciclo de correção ──────────────────────────────────────

  describe('Cenário 2 — 1 ciclo de correção (SCRUM-51: CI falha → DEV corrige → CI passa)', () => {
    beforeEach(() => {
      loadMockSequence(QA_ONE_CORRECTION_SEQUENCE);

      let callCount = 0;
      mocks.getLatestWorkflowRun.mockImplementation(() => {
        callCount++;
        // Primeira chamada: CI falhou
        if (callCount === 1) {
          return Promise.resolve({
            runId: 101,
            status: 'completed',
            conclusion: 'failure',
            htmlUrl: 'https://github.com/actions/runs/101',
            createdAt: new Date().toISOString(),
          });
        }
        // Segunda chamada (após correção): CI passou
        return Promise.resolve({
          runId: 102,
          status: 'completed',
          conclusion: 'success',
          htmlUrl: 'https://github.com/actions/runs/102',
          createdAt: new Date().toISOString(),
        });
      });

      // .qa-coverage.json: primeira leitura baixa, segunda OK
      let coverageCallCount = 0;
      mocks.readFile.mockImplementation((path: string) => {
        if (path === '.qa-coverage.json') {
          coverageCallCount++;
          return Promise.resolve(coverageCallCount === 1 ? COVERAGE_LOW : COVERAGE_OK);
        }
        return Promise.resolve('(conteúdo do arquivo)');
      });

      // DEV correction run: poll retorna "completed" na primeira chamada
      mocks.dbSelectWhere.mockResolvedValue([{
        status:       'completed',
        output:       { correctionMode: true, filesWritten: ['src/routes/ping.ts'] },
        errorMessage: null,
      }]);

      // CI wait retorna novo run
      mocks.waitForWorkflowCompletion.mockResolvedValue({
        runId: 102,
        status: 'completed',
        conclusion: 'success',
        htmlUrl: 'https://github.com/actions/runs/102',
        createdAt: new Date().toISOString(),
      });

      // DB insert para agentRun de correção
      mocks.dbInsertReturning.mockResolvedValue([{ id: 'correction-run-uuid-1' }]);
    });

    it('completa com passed: true após 1 ciclo de correção', async () => {
      const job = makeQaJob({
        storyId:    SCRUM_51.storyId,
        jiraKey:    SCRUM_51.jiraKey,
        agentRunId: SCRUM_51.agentRunId,
        summary:    SCRUM_51.summary,
        fromStatus: 'Em QA',
      });

      const result = await processQaJob(job);

      expect(result).toMatchObject({ passed: true });
    });

    it('cria CORRECTION_REQUEST.md no branch do DEV', async () => {
      const job = makeQaJob({
        storyId:    SCRUM_51.storyId,
        jiraKey:    SCRUM_51.jiraKey,
        agentRunId: SCRUM_51.agentRunId,
        summary:    SCRUM_51.summary,
        fromStatus: 'Em QA',
      });

      await processQaJob(job);

      expect(mocks.commitFiles).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ path: 'CORRECTION_REQUEST.md' }),
        ]),
        expect.stringContaining('QA-iter-1'),
        SCRUM_51.branch,
      );
    });

    it('enfileira job DEV de correção com correctionMode: true', async () => {
      const job = makeQaJob({
        storyId:    SCRUM_51.storyId,
        jiraKey:    SCRUM_51.jiraKey,
        agentRunId: SCRUM_51.agentRunId,
        summary:    SCRUM_51.summary,
        fromStatus: 'Em QA',
      });

      await processQaJob(job);

      expect(mocks.devQueueAdd).toHaveBeenCalledWith(
        'dev:correction',
        expect.objectContaining({ correctionMode: true, jiraKey: SCRUM_51.jiraKey }),
        expect.objectContaining({ jobId: expect.stringContaining('dev-correction-') }),
      );
    });

    it('posta comentário de pedido de correção no Jira', async () => {
      const job = makeQaJob({
        storyId:    SCRUM_51.storyId,
        jiraKey:    SCRUM_51.jiraKey,
        agentRunId: SCRUM_51.agentRunId,
        summary:    SCRUM_51.summary,
        fromStatus: 'Em QA',
      });

      await processQaJob(job);

      expect(mocks.addComment).toHaveBeenCalledWith(
        SCRUM_51.jiraKey,
        expect.stringContaining('pedido de correção'),
      );
    });

    it('move card para "Aguardando Aceite QA" no final', async () => {
      const job = makeQaJob({
        storyId:    SCRUM_51.storyId,
        jiraKey:    SCRUM_51.jiraKey,
        agentRunId: SCRUM_51.agentRunId,
        summary:    SCRUM_51.summary,
        fromStatus: 'Em QA',
      });

      await processQaJob(job);

      expect(mocks.moveCardTo).toHaveBeenCalledWith(SCRUM_51.jiraKey, 'Aguardando Aceite QA');
    });
  });

  // ── Cenário 3: 3 ciclos falhados → escalação ─────────────────────────────

  describe('Cenário 3 — Escalação (SCRUM-51: 3 ciclos falhados → humano)', () => {
    beforeEach(() => {
      loadMockSequence(QA_ESCALATION_SEQUENCE);

      // CI sempre falha
      mocks.getLatestWorkflowRun.mockResolvedValue({
        runId: 101,
        status: 'completed',
        conclusion: 'failure',
        htmlUrl: 'https://github.com/actions/runs/101',
        createdAt: new Date().toISOString(),
      });

      mocks.readFile.mockImplementation((path: string) => {
        if (path === '.qa-coverage.json') return Promise.resolve(COVERAGE_LOW);
        return Promise.resolve('(conteúdo)');
      });

      // DEV correction runs: sempre completa (mas CI ainda falha)
      mocks.dbSelectWhere.mockResolvedValue([{
        status:       'completed',
        output:       { correctionMode: true },
        errorMessage: null,
      }]);

      // wait_for_ci retorna run (mas CI ainda falha)
      mocks.waitForWorkflowCompletion.mockResolvedValue({
        runId: 105,
        status: 'completed',
        conclusion: 'failure',
        htmlUrl: 'https://github.com/actions/runs/105',
        createdAt: new Date().toISOString(),
      });

      // DB inserts para os 3 agentRuns de correção
      mocks.dbInsertReturning
        .mockResolvedValueOnce([{ id: 'correction-run-uuid-1' }])
        .mockResolvedValueOnce([{ id: 'correction-run-uuid-2' }])
        .mockResolvedValueOnce([{ id: 'correction-run-uuid-3' }])
        .mockResolvedValue([{ id: 'artifact-uuid' }]);
    });

    it('finaliza com passed: false após 3 ciclos', async () => {
      const job = makeQaJob({
        storyId:    SCRUM_51.storyId,
        jiraKey:    SCRUM_51.jiraKey,
        agentRunId: SCRUM_51.agentRunId,
        summary:    SCRUM_51.summary,
        fromStatus: 'Em QA',
      });

      const result = await processQaJob(job);

      expect(result).toMatchObject({ passed: false });
    });

    it('cria exatamente 3 pedidos de correção DEV', async () => {
      const job = makeQaJob({
        storyId:    SCRUM_51.storyId,
        jiraKey:    SCRUM_51.jiraKey,
        agentRunId: SCRUM_51.agentRunId,
        summary:    SCRUM_51.summary,
        fromStatus: 'Em QA',
      });

      await processQaJob(job);

      expect(mocks.devQueueAdd).toHaveBeenCalledTimes(3);
    });

    it('posta comentário de escalação para humano no Jira', async () => {
      const job = makeQaJob({
        storyId:    SCRUM_51.storyId,
        jiraKey:    SCRUM_51.jiraKey,
        agentRunId: SCRUM_51.agentRunId,
        summary:    SCRUM_51.summary,
        fromStatus: 'Em QA',
      });

      await processQaJob(job);

      // Comentário de escalação (escalate_to_human) + comentário final do job
      const allComments = mocks.addComment.mock.calls.map(
        (call: [string, string]) => call[1],
      );
      expect(allComments.some((c) => c.includes('cobertura mínima') || c.includes('após 3'))).toBe(true);
    });

    it('ainda move card para "Aguardando Aceite QA" mesmo após escalação', async () => {
      const job = makeQaJob({
        storyId:    SCRUM_51.storyId,
        jiraKey:    SCRUM_51.jiraKey,
        agentRunId: SCRUM_51.agentRunId,
        summary:    SCRUM_51.summary,
        fromStatus: 'Em QA',
      });

      await processQaJob(job);

      expect(mocks.moveCardTo).toHaveBeenCalledWith(SCRUM_51.jiraKey, 'Aguardando Aceite QA');
    });
  });
});
