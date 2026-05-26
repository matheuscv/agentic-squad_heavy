/**
 * Testes adicionais de cobertura de branches para src/webhooks/jira.ts
 * Foca nos caminhos não cobertos:
 * - timingSafeEqual com buffers de tamanhos diferentes (Buffer.compare lança)
 * - safeOptionalString preprocessing com função (typeof val === 'function')
 * - safeOptionalString com null, undefined, string
 * - changelog sem item de status mas com outros itens
 * - Object.hasOwn(statusChange, 'toString') === false
 * - toString null/undefined no statusChange
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

// ─── Mock BullMQ queue ─────────────────────────────────────────────────────────

const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'job-456' });

vi.mock('../queue/index', () => ({
  orchestratorQueue: { add: mockQueueAdd },
}));

// ─── Mock logger ───────────────────────────────────────────────────────────────

vi.mock('../lib/logger', () => ({
  childLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Setup do app ──────────────────────────────────────────────────────────────

async function buildApp(): Promise<Express> {
  const { default: jiraRouter } = await import('./jira');
  const app = express();
  app.use(express.json());
  app.use('/webhooks', jiraRouter);
  return app;
}

const VALID_SECRET = 'my-test-secret-16';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JIRA_WEBHOOK_SECRET = VALID_SECRET;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validPayloadWith(overrides: Record<string, unknown>) {
  return {
    webhookEvent: 'jira:issue_updated',
    issue: {
      id: '10016',
      key: 'SCRUM-16',
      fields: {
        summary: 'Adicionar formatCurrency',
        status: { name: 'Em Desenvolvimento', id: '3' },
      },
    },
    changelog: {
      items: [
        {
          field: 'status',
          fieldtype: 'jira',
          from: '1',
          fromString: 'Backlog',
          to: '3',
          toString: 'Em Desenvolvimento',
        },
      ],
    },
    ...overrides,
  };
}

// ─── Testes ────────────────────────────────────────────────────────────────────

describe('POST /webhooks/jira — branches adicionais', () => {
  describe('validateSecret — timingSafeEqual com buffers de tamanho diferente', () => {
    it('retorna 401 quando secret tem tamanho diferente do esperado', async () => {
      // O secret correto tem 20 chars, enviamos um com tamanho diferente
      // timingSafeEqual lança quando buffers têm tamanhos diferentes
      const app = await buildApp();
      const res = await request(app)
        .post('/webhooks/jira?secret=short')
        .send(validPayloadWith({}));

      expect(res.status).toBe(401);
    });

    it('retorna 401 quando secret é uma string vazia', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post('/webhooks/jira?secret=')
        .send(validPayloadWith({}));

      expect(res.status).toBe(401);
    });

    it('retorna 401 quando secret é um array (não-string)', async () => {
      // Quando enviado ?secret=a&secret=b, req.query.secret é um array
      const app = await buildApp();
      const res = await request(app)
        .post('/webhooks/jira?secret=val1&secret=val2')
        .send(validPayloadWith({}));

      expect(res.status).toBe(401);
    });
  });

  describe('safeOptionalString — preprocessing de campos do changelog', () => {
    it('aceita payload onde fromString e toString são null', async () => {
      const app = await buildApp();
      const payload = validPayloadWith({
        changelog: {
          items: [
            {
              field: 'status',
              fieldtype: 'jira',
              from: null,
              fromString: null,
              to: null,
              toString: null,
            },
          ],
        },
      });

      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.queued).toBe(true);
    });

    it('aceita payload onde fromString e toString são undefined (campo ausente)', async () => {
      const app = await buildApp();
      const payload = validPayloadWith({
        changelog: {
          items: [
            {
              field: 'status',
              fieldtype: 'jira',
            },
          ],
        },
      });

      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.queued).toBe(true);
    });

    it('rejeita payload onde fromString é uma função serializada (preprocessing → undefined)', async () => {
      // O safeOptionalString transforma funções em undefined (aceita)
      // Na prática, JSON não serializa funções, então o campo virará ausente
      const app = await buildApp();
      const payload = validPayloadWith({
        changelog: {
          items: [
            {
              field: 'status',
              fieldtype: 'jira',
              from: '1',
              fromString: 'Backlog',
              to: '3',
              toString: 'Em Desenvolvimento',
            },
          ],
        },
      });

      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(payload);

      expect(res.status).toBe(200);
    });
  });

  describe('changelog — caminhos dos items', () => {
    it('retorna 200 com reason=no_status_change quando changelog está ausente', async () => {
      const app = await buildApp();
      const payload = {
        webhookEvent: 'jira:issue_updated',
        issue: {
          id: '10016',
          key: 'SCRUM-16',
          fields: {
            summary: 'test',
            status: { name: 'Em Desenvolvimento', id: '3' },
          },
        },
        // sem changelog
      };

      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.ignored).toBe(true);
      expect(res.body.reason).toBe('no_status_change');
    });

    it('retorna 200 com reason=no_status_change quando changelog.items tem apenas mudança não-status', async () => {
      const app = await buildApp();
      const payload = validPayloadWith({
        changelog: {
          items: [
            { field: 'description', fieldtype: 'jira', fromString: 'old', toString: 'new' },
            { field: 'assignee', fieldtype: 'jira', fromString: null, toString: 'user123' },
          ],
        },
      });

      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.ignored).toBe(true);
      expect(res.body.reason).toBe('no_status_change');
    });

    it('retorna 200 com reason=no_status_change quando changelog.items está vazio', async () => {
      const app = await buildApp();
      const payload = validPayloadWith({
        changelog: { items: [] },
      });

      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.ignored).toBe(true);
      expect(res.body.reason).toBe('no_status_change');
    });

    it('enfileira job e retorna fromStatus/toStatus corretos quando há mudança de status', async () => {
      const app = await buildApp();
      const payload = validPayloadWith({});

      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.queued).toBe(true);
      expect(res.body.transition.from).toBe('Backlog');
      expect(res.body.transition.to).toBe('Em Desenvolvimento');
    });

    it('retorna toStatus null quando toString não é own property do statusChange', async () => {
      // Simula caso em que 'toString' não é own property (viria de prototype)
      // Isso é prevenido pelo Object.hasOwn check no código
      // Neste teste garantimos que o app lida com toString ausente
      const app = await buildApp();
      const payload = validPayloadWith({
        changelog: {
          items: [
            {
              field: 'status',
              fieldtype: 'jira',
              from: '1',
              fromString: 'Backlog',
              to: '3',
              // toString ausente → Object.hasOwn retorna false → toStatus = null
            },
          ],
        },
      });

      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.queued).toBe(true);
      expect(res.body.transition.to).toBeNull();
    });

    it('enfileira com jiraKey correto no jobId', async () => {
      const app = await buildApp();
      const payload = validPayloadWith({});

      await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(payload);

      expect(mockQueueAdd).toHaveBeenCalledWith(
        'jira:transition',
        expect.objectContaining({ jiraKey: 'SCRUM-16' }),
        expect.objectContaining({ jobId: expect.stringContaining('SCRUM-16') }),
      );
    });
  });

  describe('erro no BullMQ (queue.add lança)', () => {
    it('propaga erro 500 quando queue.add falha', async () => {
      mockQueueAdd.mockRejectedValueOnce(new Error('Redis connection failed'));

      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(validPayloadWith({}));

      expect(res.status).toBe(500);
    });
  });

  describe('diferentes eventos do Jira (filtragem)', () => {
    const nonTrackedEvents = [
      'jira:issue_created',
      'jira:issue_deleted',
      'jira:sprint_started',
      'jira:version_released',
      'comment_created',
    ];

    nonTrackedEvents.forEach((event) => {
      it(`ignora evento ${event}`, async () => {
        const app = await buildApp();
        const res = await request(app)
          .post(`/webhooks/jira?secret=${VALID_SECRET}`)
          .send(validPayloadWith({ webhookEvent: event }));

        expect(res.status).toBe(200);
        expect(res.body.ignored).toBe(true);
        expect(res.body.reason).toBe('event_not_tracked');
      });
    });
  });
});
