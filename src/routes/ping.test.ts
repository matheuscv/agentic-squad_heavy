import { describe, it, expect, vi, afterEach } from 'vitest';
import express, { type Request, type Response } from 'express';
import supertest from 'supertest';

// ─── Mock do módulo logger ANTES de qualquer import que o use ─────────────────
const mockDebug = vi.fn();
const mockChildLogger = vi.fn(() => ({ debug: mockDebug }));

vi.mock('../lib/logger', () => ({
  childLogger: mockChildLogger,
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Import do router após os mocks ───────────────────────────────────────────
import pingRouter from './ping';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/ping', pingRouter);
  return app;
}

function makeMockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function makeMockReq(overrides: Partial<Request> = {}): Request {
  return { ...overrides } as Request;
}

// ─── Suíte de testes unitários ────────────────────────────────────────────────
describe('src/routes/ping.ts — handler unitário', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('router é um objeto válido com stack de rotas', () => {
    expect(pingRouter).toBeDefined();
    expect(pingRouter.stack).toBeDefined();
    expect(Array.isArray(pingRouter.stack)).toBe(true);
  });

  it('responde com status 200 e body { status: "ok", version: "1.0.0" }', () => {
    const req = makeMockReq();
    const res = makeMockRes();

    type RouterLayer = {
      route?: {
        methods: Record<string, boolean>;
        stack: Array<{ handle: (req: Request, res: Response) => void }>;
      };
    };

    const layer = (pingRouter.stack as RouterLayer[])
      .find((l) => l.route?.methods?.get)
      ?.route?.stack[0]?.handle;

    expect(layer).toBeDefined();
    layer!(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'ok', version: '1.0.0' });
  });

  it('emite log debug com route: "/ping"', () => {
    const req = makeMockReq();
    const res = makeMockRes();

    type RouterLayer = {
      route?: {
        methods: Record<string, boolean>;
        stack: Array<{ handle: (req: Request, res: Response) => void }>;
      };
    };

    const layer = (pingRouter.stack as RouterLayer[])
      .find((l) => l.route?.methods?.get)
      ?.route?.stack[0]?.handle;

    layer!(req, res);

    expect(mockDebug).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/ping' }),
      expect.any(String),
    );
  });

  it('inicializa o child logger com module: "ping"', () => {
    expect(mockChildLogger).toHaveBeenCalledWith({ module: 'ping' });
  });
});

// ─── Suíte de integração com supertest ───────────────────────────────────────
describe('GET /ping — integração supertest', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('retorna HTTP 200 com Content-Type application/json e body correto', async () => {
    const app = buildTestApp();
    const response = await supertest(app).get('/ping');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({ status: 'ok', version: '1.0.0' });
  });

  it('método POST /ping retorna 404 (rota não registrada)', async () => {
    const app = buildTestApp();
    const response = await supertest(app).post('/ping');

    expect(response.status).toBe(404);
  });

  it('método PUT /ping retorna 404 (rota não registrada)', async () => {
    const app = buildTestApp();
    const response = await supertest(app).put('/ping');

    expect(response.status).toBe(404);
  });

  it('método DELETE /ping retorna 404 (rota não registrada)', async () => {
    const app = buildTestApp();
    const response = await supertest(app).delete('/ping');

    expect(response.status).toBe(404);
  });

  it('resposta não contém campos extras além de status e version', async () => {
    const app = buildTestApp();
    const response = await supertest(app).get('/ping');

    expect(Object.keys(response.body)).toHaveLength(2);
    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('version');
  });

  it('campo status é exatamente "ok"', async () => {
    const app = buildTestApp();
    const response = await supertest(app).get('/ping');

    expect(response.body.status).toBe('ok');
  });

  it('campo version é exatamente "1.0.0"', async () => {
    const app = buildTestApp();
    const response = await supertest(app).get('/ping');

    expect(response.body.version).toBe('1.0.0');
  });
});
