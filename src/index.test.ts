import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// ─── Mocks de todos os módulos com side-effects ────────────────────────────────
// DEVEM ser declarados ANTES de qualquer import do módulo sob teste.

vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

vi.mock('dns', () => ({
  setDefaultResultOrder: vi.fn(),
}));

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
    disconnect: vi.fn(),
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
  default: (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const express = require('express');
    const router = express.Router();
    router.post('/', (_req: unknown, res: { sendStatus: (c: number) => void }) => res.sendStatus(200));
    return router;
  })(),
}));

vi.mock('./orchestrator', () => ({
  createOrchestratorWorker: vi.fn().mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
  }),
  createReconciler: vi.fn().mockReturnValue(
    setInterval(() => undefined, 999_999),
  ),
}));

vi.mock('./agents/po', () => ({
  createPoAgentWorker: vi.fn().mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('./agents/lt', () => ({
  createLtAgentWorker: vi.fn().mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('./agents/dev-agent', () => ({
  createDevAgentWorker: vi.fn().mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('./agents/qa-agent', () => ({
  createQaAgentWorker: vi.fn().mockReturnValue({
    close: vi.fn().mockResolvedValue(undefined),
  }),
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
    agentRuns: {
      agentType: 'agentType',
      inputTokens: 'inputTokens',
      outputTokens: 'outputTokens',
      costUsd: 'costUsd',
      status: 'status',
      storyId: 'storyId',
    },
    stories: { jiraKey: 'jiraKey', id: 'id' },
  },
}));

vi.mock('./lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  childLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('./routes/ping', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require('express');
  const router = express.Router();
  router.get('/', (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => {
    res.status(200).json({ status: 'ok', version: '1.0.0' });
  });
  return { default: router };
});

// ─── Import do módulo sob teste (após todos os mocks) ─────────────────────────
import supertest from 'supertest';

// ─── Suíte de testes ──────────────────────────────────────────────────────────
describe('src/index.ts', () => {
  // Importação dinâmica para garantir que todos os mocks já foram registrados
  let appModule: typeof import('./index');

  beforeEach(async () => {
    appModule = await import('./index');
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ── Estrutura do módulo ───────────────────────────────────────────────────
  describe('exports do módulo', () => {
    it('exporta a função bootstrap', async () => {
      const mod = await import('./index');
      expect(typeof mod.bootstrap).toBe('function');
    });

    it('exporta a instância express app', async () => {
      const mod = await import('./index');
      expect(mod.app).toBeDefined();
      expect(typeof mod.app).toBe('function'); // Express app é uma função
    });
  });

  // ── /ping sem bootstrap ──────────────────────────────────────────────────
  describe('GET /ping — sem bootstrap', () => {
    it('retorna 200 com body { status: "ok", version: "1.0.0" }', async () => {
      const mod = await import('./index');
      const res = await supertest(mod.app).get('/ping');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', version: '1.0.0' });
    });
  });

  // ── /health antes do bootstrap ────────────────────────────────────────────
  describe('GET /health — antes do bootstrap', () => {
    it('retorna 503 com status degraded', async () => {
      const mod = await import('./index');
      const res = await supertest(mod.app).get('/health');

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ status: 'degraded' });
    });
  });

  // ── bootstrap() ───────────────────────────────────────────────────────────
  describe('bootstrap()', () => {
    it('executa sem lançar erros com mocks em vigor', async () => {
      const mod = await import('./index');
      // Substitui listen para evitar binding real de porta
      const listenSpy = vi.spyOn(mod.app, 'listen').mockImplementation(
        (_port: unknown, cb?: () => void) => {
          if (typeof cb === 'function') cb();
          return {} as ReturnType<typeof mod.app.listen>;
        },
      );

      await expect(mod.bootstrap()).resolves.not.toThrow();
      listenSpy.mockRestore();
    });

    it('registra /webhooks após bootstrap', async () => {
      const mod = await import('./index');
      const listenSpy = vi.spyOn(mod.app, 'listen').mockImplementation(
        (_port: unknown, cb?: () => void) => {
          if (typeof cb === 'function') cb();
          return {} as ReturnType<typeof mod.app.listen>;
        },
      );

      await mod.bootstrap();

      // Após bootstrap, POST /webhooks deve existir (não retornar 404 do Express padrão)
      const res = await supertest(mod.app).post('/webhooks');
      expect(res.status).not.toBe(404);

      listenSpy.mockRestore();
    });

    it('bootstrap() pode ser chamado múltiplas vezes sem lançar', async () => {
      const mod = await import('./index');
      const listenSpy = vi.spyOn(mod.app, 'listen').mockImplementation(
        (_port: unknown, cb?: () => void) => {
          if (typeof cb === 'function') cb();
          return {} as ReturnType<typeof mod.app.listen>;
        },
      );

      await expect(mod.bootstrap()).resolves.not.toThrow();
      await expect(mod.bootstrap()).resolves.not.toThrow();

      listenSpy.mockRestore();
    });
  });

  // ── /health após bootstrap ────────────────────────────────────────────────
  describe('GET /health — após bootstrap', () => {
    it('retorna 200 quando banco e Redis respondem OK', async () => {
      const mod = await import('./index');
      const listenSpy = vi.spyOn(mod.app, 'listen').mockImplementation(
        (_port: unknown, cb?: () => void) => {
          if (typeof cb === 'function') cb();
          return {} as ReturnType<typeof mod.app.listen>;
        },
      );

      await mod.bootstrap();

      const res = await supertest(mod.app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok' });

      listenSpy.mockRestore();
    });

    it('retorna 503 quando banco falha', async () => {
      const { Pool } = await import('pg');
      (Pool as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
        query: vi.fn().mockRejectedValue(new Error('DB connection refused')),
        end: vi.fn().mockResolvedValue(undefined),
      }));

      const mod = await import('./index');
      const listenSpy = vi.spyOn(mod.app, 'listen').mockImplementation(
        (_port: unknown, cb?: () => void) => {
          if (typeof cb === 'function') cb();
          return {} as ReturnType<typeof mod.app.listen>;
        },
      );

      await mod.bootstrap();

      const res = await supertest(mod.app).get('/health');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ status: 'degraded' });

      listenSpy.mockRestore();
    });
  });

  // ── /metrics após bootstrap ───────────────────────────────────────────────
  describe('GET /metrics — após bootstrap', () => {
    it('retorna 200 com estrutura esperada', async () => {
      const mod = await import('./index');
      const listenSpy = vi.spyOn(mod.app, 'listen').mockImplementation(
        (_port: unknown, cb?: () => void) => {
          if (typeof cb === 'function') cb();
          return {} as ReturnType<typeof mod.app.listen>;
        },
      );

      await mod.bootstrap();

      const res = await supertest(mod.app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        avgDurationByPhase: expect.any(Object),
        successRateByPhase: expect.any(Object),
        correctionLoopsByStory: expect.any(Array),
      });

      listenSpy.mockRestore();
    });

    it('retorna 500 quando lib/metrics lança erro', async () => {
      const metrics = await import('./lib/metrics');
      (metrics.getAvgDurationByAgent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('metrics DB error'),
      );

      const mod = await import('./index');
      const listenSpy = vi.spyOn(mod.app, 'listen').mockImplementation(
        (_port: unknown, cb?: () => void) => {
          if (typeof cb === 'function') cb();
          return {} as ReturnType<typeof mod.app.listen>;
        },
      );

      await mod.bootstrap();

      const res = await supertest(mod.app).get('/metrics');
      expect(res.status).toBe(500);

      listenSpy.mockRestore();
    });
  });
});
