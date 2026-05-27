/**
 * Testes adicionais de cobertura de branches para src/webhooks/jira.ts
 *
 * ESTRATÉGIA: Usa o mesmo padrão do jira.test.ts original (supertest + express),
 * foca em cenários não cobertos: erros de fila, transições sem changelog,
 * diferentes fromStatus/toStatus, erro 500.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

// ─── Mock BullMQ orchestratorQueue ────────────────────────────────────────────

const mockOrchestratorQueueAdd = vi.fn().mockResolvedValue({ id: 'job-branches-1' });

vi.mock('../queue/index', () => ({
  orchestratorQueue: { add: mockOrchestratorQueueAdd },
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

// ─── Payload base ─────────────────────────────────────────────────────────────

const VALID_SECRET = 'test-secret-branches';

function makePayload(overrides: Record<string, unknown> = {}) {
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
          from: '2',
          fromString: 'Refinado',
          to: '3',
          toString: 'Em Desenvolvimento',
        },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JIRA_WEBHOOK_SECRET = VALID_SECRET;
  mockOrchestratorQueueAdd.mockResolvedValue({ id: 'job-branches-default' });
});

// ─── Testes ────────────────────────────────────────────────────────────────────

describe('POST /webhooks/jira — branches adicionais', () => {
  describe('autenticação — edge cases', () => {
    it('retorna 401 quando secret é string vazia', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post('/webhooks/jira?secret=')
        .send(makePayload());

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('unauthorized');
    });

    it('retorna 401 quando JIRA_WEBHOOK_SECRET não está definido', async () => {
      delete process.env.JIRA_WEBHOOK_SECRET;
      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(makePayload());

      expect(res.status).toBe(401);
    });

    it('retorna 401 quando secret tem tamanho diferente do esperado', async () => {
      process.env.JIRA_WEBHOOK_SECRET = 'short';
      const app = await buildApp();
      const res = await request(app)
        .post('/webhooks/jira?secret=much-longer-secret-that-differs')
        .send(makePayload());

      expect(res.status).toBe(401);
    });
  });

  describe('filtragem de eventos — branches', () => {
    it('ignora evento jira:issue_created', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(makePayload({ webhookEvent: 'jira:issue_created' }));

      expect(res.status).toBe(200);
      expect(res.body.ignored).toBe(true);
      expect(res.body.reason).toBe('event_not_tracked');
    });

    it('ignora evento jira:issue_deleted', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(makePayload({ webhookEvent: 'jira:issue_deleted' }));

      expect(res.status).toBe(200);
      expect(res.body.ignored).toBe(true);
    });

    it('ignora evento sprint_started', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(makePayload({ webhookEvent: 'sprint_started' }));

      expect(res.status).toBe(200);
      expect(res.body.ignored).toBe(true);
    });
  });

  describe('changelog — ausência de status change', () => {
    it('ignora quando changelog está ausente', async () => {
      const app = await buildApp();
      const payload = makePayload();
      delete (payload as any).changelog;

      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.ignored).toBe(true);
      expect(res.body.reason).toBe('no_status_change');
    });

    it('ignora quando changelog.items não contém field=status', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(makePayload({
          changelog: {
            items: [
              {
                field: 'assignee',
                fieldtype: 'jira',
                from: null,
                fromString: null,
                to: '10001',
                toString: 'John Doe',
              },
            ],
          },
        }));

      expect(res.status).toBe(200);
      expect(res.body.ignored).toBe(true);
      expect(res.body.reason).toBe('no_status_change');
    });

    it('ignora quando changelog.items está vazio', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(makePayload({
          changelog: { items: [] },
        }));

      expect(res.status).toBe(200);
      expect(res.body.ignored).toBe(true);
      expect(res.body.reason).toBe('no_status_change');
    });
  });

  describe('enfileiramento bem-sucedido — diferentes transições', () => {
    it('enfileira job para transição Backlog → Refinado', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(makePayload({
          issue: {
            id: '10016',
            key: 'SCRUM-16',
            fields: {
              summary: 'Adicionar formatCurrency',
              status: { name: 'Refinado', id: '2' },
            },
          },
          changelog: {
            items: [
              {
                field: 'status',
                fieldtype: 'jira',
                from: '1',
                fromString: 'Backlog',
                to: '2',
                toString: 'Refinado',
              },
            ],
          },
        }));

      expect(res.status).toBe(200);
      expect(res.body.queued).toBe(true);
      expect(mockOrchestratorQueueAdd).toHaveBeenCalledTimes(1);
      expect(mockOrchestratorQueueAdd).toHaveBeenCalledWith(
        'jira:transition',
        expect.objectContaining({
          jiraKey: 'SCRUM-16',
          fromStatus: 'Backlog',
          toStatus: 'Refinado',
        }),
        expect.any(Object),
      );
    });

    it('enfileira job para transição Em Desenvolvimento → Em Revisão QA', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(makePayload({
          issue: {
            id: '10016',
            key: 'SCRUM-16',
            fields: {
              summary: 'Adicionar formatCurrency',
              status: { name: 'Em Revisão QA', id: '4' },
            },
          },
          changelog: {
            items: [
              {
                field: 'status',
                fieldtype: 'jira',
                from: '3',
                fromString: 'Em Desenvolvimento',
                to: '4',
                toString: 'Em Revisão QA',
              },
            ],
          },
        }));

      expect(res.status).toBe(200);
      expect(res.body.queued).toBe(true);
      expect(res.body.transition).toEqual({
        from: 'Em Desenvolvimento',
        to: 'Em Revisão QA',
      });
    });

    it('enfileira job com fromString=null (campo ausente)', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(makePayload({
          changelog: {
            items: [
              {
                field: 'status',
                fieldtype: 'jira',
                from: null,
                to: '3',
                toString: 'Em Desenvolvimento',
                // fromString ausente propositalmente
              },
            ],
          },
        }));

      expect(res.status).toBe(200);
      expect(res.body.queued).toBe(true);
    });

    it('inclui jiraKey correto no job enfileirado', async () => {
      const app = await buildApp();
      await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(makePayload({ issue: { id: '10999', key: 'SCRUM-99', fields: { summary: 'Outra história', status: { name: 'Em Desenvolvimento', id: '3' } } } }));

      const callArgs = mockOrchestratorQueueAdd.mock.calls[0];
      expect(callArgs).toBeDefined();
      if (callArgs) {
        expect(callArgs[1]).toMatchObject({ jiraKey: 'SCRUM-99' });
      }
    });
  });

  describe('erro de fila — retorna 500', () => {
    it('retorna 500 quando orchestratorQueue.add lança erro', async () => {
      mockOrchestratorQueueAdd.mockRejectedValueOnce(new Error('Redis connection refused'));

      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(makePayload());

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('queue_error');
    });

    it('retorna 500 quando orchestratorQueue.add lança erro de timeout', async () => {
      mockOrchestratorQueueAdd.mockRejectedValueOnce(new Error('Connection timeout'));

      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(makePayload());

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('queue_error');
    });
  });

  describe('validação de payload — edge cases', () => {
    it('retorna 400 quando issue.fields.status está ausente', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send({
          webhookEvent: 'jira:issue_updated',
          issue: {
            id: '10016',
            key: 'SCRUM-16',
            fields: {
              summary: 'Adicionar formatCurrency',
              // status ausente
            },
          },
          changelog: { items: [] },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_payload');
    });

    it('retorna 400 quando issue.key está ausente', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send({
          webhookEvent: 'jira:issue_updated',
          issue: {
            id: '10016',
            // key ausente
            fields: {
              summary: 'Teste',
              status: { name: 'Em Desenvolvimento', id: '3' },
            },
          },
          changelog: { items: [] },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_payload');
    });

    it('retorna 400 quando webhookEvent está ausente', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send({
          issue: {
            id: '10016',
            key: 'SCRUM-16',
            fields: {
              summary: 'Teste',
              status: { name: 'Em Desenvolvimento', id: '3' },
            },
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_payload');
    });
  });
});
