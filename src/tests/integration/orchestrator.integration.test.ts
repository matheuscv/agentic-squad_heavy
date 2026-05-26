/**
 * Testes de integração: Orquestrador + Máquina de Estados
 *
 * Verifica que o worker do orquestrador, ao receber histórias reais,
 * despacha os agentes corretos, move cards no Jira e atualiza o banco.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import { SCRUM_50, SCRUM_51 } from './fixtures';
import type { OrchestratorJobData } from '../../queue/index';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  poQueueAdd:  vi.fn().mockResolvedValue({ id: 'po-job-id' }),
  ltQueueAdd:  vi.fn().mockResolvedValue({ id: 'lt-job-id' }),
  devQueueAdd: vi.fn().mockResolvedValue({ id: 'dev-job-id' }),
  qaQueueAdd:  vi.fn().mockResolvedValue({ id: 'qa-job-id' }),
  moveCardTo:  vi.fn().mockResolvedValue(undefined),
  addComment:  vi.fn().mockResolvedValue(undefined),
  dbUpdateWhere:     vi.fn().mockResolvedValue([]),
  dbInsertReturning: vi.fn().mockResolvedValue([{ id: 'test-run-uuid' }]),
  // Valores literais em vi.hoisted (não pode referenciar imports)
  upsertStory: vi.fn().mockResolvedValue({
    id:          'aaaaaaaa-0000-0000-0000-000000000050',
    jiraKey:     'SCRUM-50',
    jiraSummary: 'Adicionar função formatDate() ao módulo de utilitários',
    status:      'plano_validado',
  }),
}));

// ─── vi.mock ──────────────────────────────────────────────────────────────────

vi.mock('bullmq', () => ({
  Queue: vi.fn((name: string) => {
    const adds: Record<string, ReturnType<typeof vi.fn>> = {
      'agent-po':  mocks.poQueueAdd,
      'agent-lt':  mocks.ltQueueAdd,
      'agent-dev': mocks.devQueueAdd,
      'agent-qa':  mocks.qaQueueAdd,
    };
    return { add: adds[name] ?? vi.fn(), close: vi.fn() };
  }),
  Worker: vi.fn(() => ({ on: vi.fn().mockReturnThis(), close: vi.fn() })),
}));

vi.mock('../../jira/client', () => ({
  moveCardTo: mocks.moveCardTo,
  addComment:  mocks.addComment,
}));

vi.mock('../../db/stories', () => ({
  upsertStory:        mocks.upsertStory,
  updateStoryStatus:  vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../db/index', () => ({
  db: {
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: mocks.dbUpdateWhere })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: mocks.dbInsertReturning })) })),
  },
  schema: {
    agentRuns: { id: 'id', storyId: 'story_id', agentType: 'agent_type', status: 'status', input: 'input', output: 'output', startedAt: 'started_at', completedAt: 'completed_at' },
    stories:   { jiraKey: 'jira_key' },
  },
}));

vi.mock('../../queue/index', () => ({
  redisConnection: {},
}));

vi.mock('../../lib/logger', () => ({
  childLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }),
}));

vi.mock('../../agents/po', () => ({
  poAgentQueue: { add: mocks.poQueueAdd, close: vi.fn() },
}));

vi.mock('../../agents/lt', () => ({
  ltAgentQueue: { add: mocks.ltQueueAdd, close: vi.fn() },
}));

vi.mock('../../agents/dev-agent', () => ({
  devAgentQueue: { add: mocks.devQueueAdd, close: vi.fn() },
}));

vi.mock('../../agents/qa-agent', () => ({
  qaAgentQueue: { add: mocks.qaQueueAdd, close: vi.fn() },
}));

// ─── Helper: cria mock de Job do BullMQ ─────────────────────────────────────

function makeJob(data: OrchestratorJobData): Job<OrchestratorJobData> {
  return { id: 'test-job-id', data, attemptsMade: 0, opts: { attempts: 2 } } as Job<OrchestratorJobData>;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Orquestrador — histórias reais de baixa complexidade', () => {
  let processJob: (job: Job<OrchestratorJobData>) => Promise<unknown>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.upsertStory.mockResolvedValue({
      id: SCRUM_50.storyId,
      jiraKey: SCRUM_50.jiraKey,
      jiraSummary: SCRUM_50.summary,
      status: 'plano_validado',
    });

    const { Worker } = await import('bullmq');
    vi.mocked(Worker).mockImplementationOnce(
      (_name: string, processor: (job: Job<OrchestratorJobData>) => Promise<unknown>) => {
        processJob = processor;
        return { on: vi.fn().mockReturnThis(), close: vi.fn() } as never;
      },
    );

    const { createOrchestratorWorker } = await import('../../orchestrator/worker');
    createOrchestratorWorker();
  });

  afterEach(() => {
    vi.resetModules();
  });

  // ── SCRUM-50: módulo utilitário de data ──────────────────────────────────

  describe('SCRUM-50 — "Adicionar função formatDate() ao módulo utils"', () => {
    it('"Plano Validado" despacha agente DEV e move card para "Em Desenvolvimento"', async () => {
      const job = makeJob({
        jiraKey: SCRUM_50.jiraKey,
        summary: SCRUM_50.summary,
        fromStatus: 'Aguardando Aceite Plano',
        toStatus: 'Plano Validado',
        currentStatus: 'Plano Validado',
        receivedAt: new Date().toISOString(),
      });

      const result = await processJob(job);

      // Agente DEV foi enfileirado
      expect(mocks.devQueueAdd).toHaveBeenCalledOnce();
      expect(mocks.devQueueAdd).toHaveBeenCalledWith(
        'dev:run',
        expect.objectContaining({ jiraKey: SCRUM_50.jiraKey }),
        expect.objectContaining({ jobId: expect.stringContaining('dev-') }),
      );

      // Card movido para "Em Desenvolvimento"
      expect(mocks.moveCardTo).toHaveBeenCalledWith(SCRUM_50.jiraKey, 'Em Desenvolvimento');

      // Resultado tem a ação correta
      expect(result).toMatchObject({
        action: expect.objectContaining({ type: 'invoke_agent', agent: 'dev' }),
      });
    });

    it('"Concluído" não despacha nenhum agente (estado terminal)', async () => {
      const job = makeJob({
        jiraKey: SCRUM_50.jiraKey,
        summary: SCRUM_50.summary,
        fromStatus: 'Validação Final',
        toStatus: 'Concluído',
        currentStatus: 'Concluído',
        receivedAt: new Date().toISOString(),
      });

      await processJob(job);

      expect(mocks.devQueueAdd).not.toHaveBeenCalled();
      expect(mocks.poQueueAdd).not.toHaveBeenCalled();
      expect(mocks.qaQueueAdd).not.toHaveBeenCalled();
      expect(mocks.moveCardTo).not.toHaveBeenCalled();
    });

    it('retrogressão "Em QA" → "Plano Validado" é rejeitada (skipped)', async () => {
      const job = makeJob({
        jiraKey: SCRUM_50.jiraKey,
        summary: SCRUM_50.summary,
        fromStatus: 'Em QA',
        toStatus: 'Plano Validado',
        currentStatus: 'Plano Validado',
        receivedAt: new Date().toISOString(),
      });

      const result = await processJob(job);

      expect(result).toMatchObject({ skipped: true, reason: 'retrograde_transition' });
      expect(mocks.devQueueAdd).not.toHaveBeenCalled();
    });
  });

  // ── SCRUM-51: endpoint /ping ─────────────────────────────────────────────

  describe('SCRUM-51 — "Adicionar endpoint GET /ping"', () => {
    beforeEach(() => {
      mocks.upsertStory.mockResolvedValue({
        id: SCRUM_51.storyId,
        jiraKey: SCRUM_51.jiraKey,
        jiraSummary: SCRUM_51.summary,
        status: 'a_refinar',
      });
    });

    it('"A Refinar" despacha agente PO e move card para "Em Refinamento"', async () => {
      const job = makeJob({
        jiraKey: SCRUM_51.jiraKey,
        summary: SCRUM_51.summary,
        fromStatus: 'Backlog',
        toStatus: 'A Refinar',
        currentStatus: 'A Refinar',
        receivedAt: new Date().toISOString(),
      });

      await processJob(job);

      expect(mocks.poQueueAdd).toHaveBeenCalledOnce();
      expect(mocks.moveCardTo).toHaveBeenCalledWith(SCRUM_51.jiraKey, 'Em Refinamento');
    });

    it('"Em QA" despacha agente QA sem mover card (sem moveTo)', async () => {
      mocks.upsertStory.mockResolvedValue({
        id: SCRUM_51.storyId,
        jiraKey: SCRUM_51.jiraKey,
        jiraSummary: SCRUM_51.summary,
        status: 'em_qa',
      });

      const job = makeJob({
        jiraKey: SCRUM_51.jiraKey,
        summary: SCRUM_51.summary,
        fromStatus: 'Aguardando Aceite Dev',
        toStatus: 'Em QA',
        currentStatus: 'Em QA',
        receivedAt: new Date().toISOString(),
      });

      await processJob(job);

      expect(mocks.qaQueueAdd).toHaveBeenCalledOnce();
      expect(mocks.qaQueueAdd).toHaveBeenCalledWith(
        'qa:run',
        expect.objectContaining({ jiraKey: SCRUM_51.jiraKey }),
        expect.anything(),
      );
      // QA não tem moveTo → card não movido no dispatch
      expect(mocks.moveCardTo).not.toHaveBeenCalled();
    });

    it('status desconhecido não despacha agentes nem move card', async () => {
      const job = makeJob({
        jiraKey: SCRUM_51.jiraKey,
        summary: SCRUM_51.summary,
        fromStatus: null,
        toStatus: 'Status Inexistente',
        currentStatus: 'Status Inexistente',
        receivedAt: new Date().toISOString(),
      });

      const result = await processJob(job);

      expect(result).toMatchObject({
        action: expect.objectContaining({ type: 'unknown' }),
      });
      expect(mocks.devQueueAdd).not.toHaveBeenCalled();
      expect(mocks.moveCardTo).not.toHaveBeenCalled();
    });
  });
});
