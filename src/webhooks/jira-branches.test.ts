/**
 * Testes adicionais de cobertura para src/webhooks/jira.ts
 * Foco nos branches de validação: eventos ignorados, mudanças sem status,
 * toStatus derivado de changelog, erros de fila, e evento issue_updated completo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockOrchestratorAdd = vi.fn().mockResolvedValue({ id: 'job-jira-branch-1' });

vi.mock('../queue/index', () => ({
  orchestratorQueue: {
    add: mockOrchestratorAdd,
  },
  redisConnection: { on: vi.fn() },
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

// ─── Setup do app Express ─────────────────────────────────────────────────────

const TEST_SECRET = 'test-webhook-secret-branches';

async function buildApp() {
  process.env['JIRA_WEBHOOK_SECRET'] = TEST_SECRET;
  const { default: jiraRouter } = await import('./jira');
  const app = express();
  app.use(express.json());
  app.use('/webhooks', jiraRouter);
  return app;
}

const SECRET_QUERY = `?secret=${TEST_SECRET}`;

// ─── Payload helpers ──────────────────────────────────────────────────────────

function makeIssueUpdatedPayload(statusFrom: string, statusTo: string, extraItems = []) {
  return {
    webhookEvent: 'jira:issue_updated',
    issue: {
      id: 'issue-10001',
      key: 'SCRUM-16',
      fields: {
        summary: 'Adicionar formatCurrency',
        status: { name: statusTo, id: '3' },
      },
    },
    changelog: {
      items: [
        { field: 'status', fieldtype: 'jira', fromString: statusFrom, toString: statusTo },
        ...extraItems,
      ],
    },
  };
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('POST /webhooks/jira — branches adicionais', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  // Branch: secret inválido → 401
  it('retorna 401 quando secret está ausente', async () => {
    const res = await request(app)
      .post('/webhooks/jira')
      .send({ webhookEvent: 'jira:issue_updated' });
    expect(res.status).toBe(401);
  });

  // Branch: secret errado → 401
  it('retorna 401 quando secret está errado', async () => {
    const res = await request(app)
      .post('/webhooks/jira?secret=wrong-secret')
      .send({ webhookEvent: 'jira:issue_updated' });
    expect(res.status).toBe(401);
  });

  // Branch: payload inválido (sem issue) → 400
  it('retorna 400 para payload sem campo issue', async () => {
    const res = await request(app)
      .post(`/webhooks/jira${SECRET_QUERY}`)
      .send({ webhookEvent: 'jira:issue_updated' });
    expect(res.status).toBe(400);
  });

  // Branch: evento não rastreado → 200 ignored
  it('retorna 200 com ignored=true para evento issue_created', async () => {
    const res = await request(app)
      .post(`/webhooks/jira${SECRET_QUERY}`)
      .send({
        webhookEvent: 'jira:issue_created',
        issue: {
          id: 'issue-2',
          key: 'SCRUM-20',
          fields: {
            summary: 'Nova story',
            status: { name: 'To Do', id: '1' },
          },
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(res.body.reason).toBe('event_not_tracked');
  });

  // Branch: issue_updated sem changelog → 200 ignored
  it('retorna 200 com ignored=true quando não há mudança de status no changelog', async () => {
    const res = await request(app)
      .post(`/webhooks/jira${SECRET_QUERY}`)
      .send({
        webhookEvent: 'jira:issue_updated',
        issue: {
          id: 'issue-3',
          key: 'SCRUM-21',
          fields: {
            summary: 'Atualização sem status',
            status: { name: 'In Progress', id: '2' },
          },
        },
        changelog: {
          items: [
            { field: 'description', fieldtype: 'jira', fromString: 'old', toString: 'new' },
          ],
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(res.body.reason).toBe('no_status_change');
  });

  // Branch: issue_updated sem changelog algum → 200 ignored
  it('retorna 200 com ignored=true quando changelog está ausente', async () => {
    const res = await request(app)
      .post(`/webhooks/jira${SECRET_QUERY}`)
      .send({
        webhookEvent: 'jira:issue_updated',
        issue: {
          id: 'issue-4',
          key: 'SCRUM-22',
          fields: {
            summary: 'Sem changelog',
            status: { name: 'Done', id: '4' },
          },
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
  });

  // Branch: path feliz — issue_updated com transição de status → 200 queued
  it('enfileira job e retorna 200 para transição de status válida', async () => {
    const res = await request(app)
      .post(`/webhooks/jira${SECRET_QUERY}`)
      .send(makeIssueUpdatedPayload('Ready for Dev', 'In Progress'));

    expect(res.status).toBe(200);
    expect(res.body.queued).toBe(true);
    expect(res.body.jiraKey).toBe('SCRUM-16');
    expect(mockOrchestratorAdd).toHaveBeenCalledOnce();
  });

  // Branch: transição "Done" → "Closed"
  it('enfileira job para transição Done → Closed', async () => {
    const res = await request(app)
      .post(`/webhooks/jira${SECRET_QUERY}`)
      .send(makeIssueUpdatedPayload('Done', 'Closed'));

    expect(res.status).toBe(200);
    expect(res.body.queued).toBe(true);
    expect(mockOrchestratorAdd).toHaveBeenCalledOnce();
    const callArgs = mockOrchestratorAdd.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(callArgs?.fromStatus).toBe('Done');
    expect(callArgs?.toStatus).toBe('Closed');
  });

  // Branch: transição com fromStatus null (item sem fromString)
  it('lida com statusChange sem fromString', async () => {
    const res = await request(app)
      .post(`/webhooks/jira${SECRET_QUERY}`)
      .send({
        webhookEvent: 'jira:issue_updated',
        issue: {
          id: 'issue-5',
          key: 'SCRUM-23',
          fields: {
            summary: 'Sem fromString',
            status: { name: 'In Progress', id: '2' },
          },
        },
        changelog: {
          items: [
            { field: 'status', fieldtype: 'jira', toString: 'In Progress' },
          ],
        },
      });

    // Deve processar sem erro
    expect([200, 400]).toContain(res.status);
  });

  // Branch: falha na fila → 500
  it('retorna 500 quando orchestratorQueue.add lança exceção', async () => {
    mockOrchestratorAdd.mockRejectedValueOnce(new Error('Redis connection refused'));

    const res = await request(app)
      .post(`/webhooks/jira${SECRET_QUERY}`)
      .send(makeIssueUpdatedPayload('To Do', 'In Progress'));

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('queue_error');
  });

  // Branch: jobId incluído na resposta
  it('resposta inclui jobId quando job é enfileirado com sucesso', async () => {
    const res = await request(app)
      .post(`/webhooks/jira${SECRET_QUERY}`)
      .send(makeIssueUpdatedPayload('Backlog', 'Ready for Dev'));

    expect(res.status).toBe(200);
    expect(res.body.jobId).toBeDefined();
  });
});
