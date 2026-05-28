import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// ─── Mocks de todos os módulos com side-effects ────────────────────────────────
// Devem ser declarados ANTES de qualquer import que transite por esses módulos.

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('./lib/metrics', () => ({
  getAvgDurationByAgent: vi.fn().mockResolvedValue([]),
  getSuccessRateByAgent: vi.fn().mockResolvedValue([]),
  getCorrectionLoopsByStory: vi.fn().mockResolvedValue([]),
}));

vi.mock('./webhooks/jira', () => ({
  default: vi.fn(() => ({})),
}));

vi.mock('./orchestrator', () => ({
  createOrchestratorWorker: vi.fn().mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) }),
  createReconciler: vi.fn().mockReturnValue(setInterval(() => undefined, 999_999)),
}));

vi.mock('./agents/po', () => ({
  createPoAgentWorker: vi.fn().mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('./agents/lt', () => ({
  createLtAgentWorker: vi.fn().mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('./agents/dev-agent', () => ({
  createDevAgentWorker: vi.fn().mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('./agents/qa-agent', () => ({
  createQaAgentWorker: vi.fn().mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('./db/index', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockResolvedValue([]),
        }),
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    }),
    insert: vi.fn(),
    update: vi.fn(),
  },
  schema: {
    agentRuns: { agentType: 'agentType', inputTokens: 'inputTokens', outputTokens: 'outputTokens', costUsd: 'costUsd', status: 'status', storyId: 'storyId' },
    stories:   { jiraKey: 'jiraKey', id: 'id' },
  },
}));

vi.mock('./lib/logger', () => ({
  logger: {
    info:  vi.fn(),
    error: vi.fn(),
    warn:  vi.fn(),
    debug: vi.fn(),
  },
  childLogger: vi.fn().mockReturnValue({
    info:  vi.fn(),
    error: vi.fn(),
    warn:  vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('./routes/ping', () => {
  const express = require('express');
  const router = express.Router();
  router.get('/', (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => {
    res.status(200).json({ status: 'ok', version: '1.0.0' });
  });
  return { default: router };
});

// ─── Import do módulo sob teste (após todos os mocks) ─────────────────────────
import { app, bootstrap } from './index';

// ─── Helpers ──────────────────────────────────────────────────────────────────
import supertest from 'supertest';

// ─── Suíte de testes ──────────────────────────────────────────────────────────
describe('src/index.ts', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── app export ──────────────────────────────────────────────────────────────
  describe('export { app }', () => {
    it('exporta uma instância Express válida', () => {
      expect(app).toBeDefined();
      expect(typeof app).toBe('function'); // Express app é uma função
    });

    it('GET /ping responde 200 com body correto sem chamar bootstrap()', async () => {
      const res = await supertest(app).get('/ping');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', version: '1.0.0' });
    });

    it('GET /health retorna 503 antes do bootstrap()', async () => {
      const res = await supertest(app).get('/health');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ status: 'degraded' });
    });
  });

  // ── bootstrap() ─────────────────────────────────────────────────────────────
  describe('bootstrap()', () => {
    beforeEach(() => {
      // Evita abrir porta real durante o teste
      vi.spyOn(app, 'listen').mockImplementation((_port: unknown, cb?: () => void) => {
        cb?.();
        return { close: vi.fn((fn?: () => void) => fn?.()) } as unknown as ReturnType<typeof app.listen>;
      });
    });

    it('executa sem lançar exceções com variáveis de ambiente mockadas', async () => {
      process.env.PORT = '0';
      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
      process.env.REDIS_URL = 'redis://localhost:6379';

      await expect(bootstrap()).resolves.toBeUndefined();
    });

    it('importa workers e inicia o servidor HTTP', async () => {
      process.env.PORT = '0';

      const { createOrchestratorWorker } = await import('./orchestrator');
      const { createPoAgentWorker }      = await import('./agents/po');

      await bootstrap();

      expect(createOrchestratorWorker).toHaveBeenCalled();
      expect(createPoAgentWorker).toHaveBeenCalled();
    });
  });
});
