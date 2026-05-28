import { describe, it, expect, vi, afterEach, type MockedFunction } from 'vitest';
import { type Request, type Response } from 'express';

// ─── Mock do módulo logger ANTES de qualquer import que o use ─────────────────
const mockDebug = vi.fn();
const mockChildLogger = vi.fn(() => ({ debug: mockDebug }));

vi.mock('../lib/logger', () => ({
  childLogger: mockChildLogger,
}));

// ─── Import do router após os mocks ───────────────────────────────────────────
import pingRouter from './ping';

// ─── Helpers para Request / Response mock ─────────────────────────────────────
function makeMockRes(): Response {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response;

  // res.status(xxx) deve retornar o próprio res para encadeamento .json()
  (res.status as MockedFunction<typeof res.status>).mockReturnValue(res);

  return res;
}

function makeMockReq(overrides: Partial<Request> = {}): Request {
  return { ...overrides } as Request;
}

// ─── Suíte de testes unitários ────────────────────────────────────────────────
describe('src/routes/ping.ts', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('TASK-01 — handler unitário', () => {
    it('responde com status 200 e body { status: "ok", version: "1.0.0" }', () => {
      const req = makeMockReq();
      const res = makeMockRes();

      // Extrai o handler registrado em GET '/'
      const layer = (
        pingRouter.stack as Array<{
          route?: {
            methods: Record<string, boolean>;
            stack: Array<{ handle: (req: Request, res: Response) => void }>;
          };
        }>
      ).find((l) => l.route?.methods?.get)?.route?.stack[0]?.handle;

      expect(layer).toBeDefined();
      layer!(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ status: 'ok', version: '1.0.0' });
    });

    it('emite log debug com route: "/ping"', () => {
      const req = makeMockReq();
      const res = makeMockRes();

      const layer = (
        pingRouter.stack as Array<{
          route?: {
            methods: Record<string, boolean>;
            stack: Array<{ handle: (req: Request, res: Response) => void }>;
          };
        }>
      ).find((l) => l.route?.methods?.get)?.route?.stack[0]?.handle;

      layer!(req, res);

      expect(mockDebug).toHaveBeenCalledWith(
        expect.objectContaining({ route: '/ping' }),
        expect.any(String),
      );
    });

    it('inicializa o child logger com module: "ping"', () => {
      // mockChildLogger é chamado no carregamento do módulo
      expect(mockChildLogger).toHaveBeenCalledWith({ module: 'ping' });
    });
  });
});

// ─── Suíte de integração leve com supertest ───────────────────────────────────
describe('GET /ping — integração supertest', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('retorna HTTP 200 com Content-Type application/json e body correto', async () => {
    // Importação dinâmica para evitar inicialização dos workers do BullMQ
    // durante os testes unitários — supertest usa apenas a instância Express
    const supertest = await import('supertest');
    const request = supertest.default;

    // Importamos apenas o router e montamos um app Express mínimo para o teste
    const express = await import('express');
    const testApp = express.default();
    testApp.use(express.json());
    testApp.use('/ping', pingRouter);

    const response = await request(testApp).get('/ping');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({ status: 'ok', version: '1.0.0' });
  });

  it('método POST /ping retorna 404 (rota não registrada)', async () => {
    const supertest = await import('supertest');
    const request = supertest.default;

    const express = await import('express');
    const testApp = express.default();
    testApp.use(express.json());
    testApp.use('/ping', pingRouter);

    const response = await request(testApp).post('/ping');

    expect(response.status).toBe(404);
  });
});
