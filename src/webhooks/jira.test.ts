import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

// ─── Mock BullMQ queue ─────────────────────────────────────────────────────────

const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'job-123' });

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

// ─── Payload de teste válido ───────────────────────────────────────────────────

const validPayload = {
  webhookEvent: 'jira:issue_updated',
  issue: {
    id: '10001',
    key: 'SCRUM-1',
    fields: {
      summary: 'Minha história de teste',
      status: { name: 'Em Desenvolvimento', id: '3' },
    },
  },
  changelog: {
    items: [
      {
        field: 'status',
        fieldtype: 'jira',
        from: '2',
        fromString: 'A Refinar',
        to: '3',
        toString: 'Em Desenvolvimento',
      },
    ],
  },
};

const VALID_SECRET = 'my-test-secret';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JIRA_WEBHOOK_SECRET = VALID_SECRET;
});

// ─── Testes ────────────────────────────────────────────────────────────────────

describe('POST /webhooks/jira', () => {
  describe('autenticação', () => {
    it('retorna 401 quando secret não é fornecido', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post('/webhooks/jira')
        .send(validPayload);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('unauthorized');
    });

    it('retorna 401 quando secret está errado', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post('/webhooks/jira?secret=wrong-secret')
        .send(validPayload);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('unauthorized');
    });

    it('retorna 401 quando JIRA_WEBHOOK_SECRET não está configurado', async () => {
      delete process.env.JIRA_WEBHOOK_SECRET;
      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(validPayload);

      expect(res.status).toBe(401);
    });
  });

  describe('validação de payload', () => {
    it('retorna 400 quando payload está malformado (issue ausente)', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send({ webhookEvent: 'jira:issue_updated' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_payload');
    });

    it('retorna 400 quando issue.fields.summary está ausente', async () => {
      const app = await buildApp();
      const badPayload = {
        ...validPayload,
        issue: { id: '10001', key: 'SCRUM-1', fields: { status: { name: 'Backlog', id: '1' } } },
      };
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(badPayload);

      expect(res.status).toBe(400);
    });
  });

  describe('filtragem de eventos', () => {
    it('retorna 200 com ignored=true para evento não rastreado', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send({ ...validPayload, webhookEvent: 'jira:issue_created' });

      expect(res.status).toBe(200);
      expect(res.body.ignored).toBe(true);
      expect(res.body.reason).toBe('event_not_tracked');
    });

    it('retorna 200 com ignored=true quando changelog não tem mudança de status', async () => {
      const app = await buildApp();
      const payloadSemStatus = {
        ...validPayload,
        changelog: {
          items: [{ field: 'description', fieldtype: 'jira' }],
        },
      };
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(payloadSemStatus);

      expect(res.status).toBe(200);
      expect(res.body.ignored).toBe(true);
      expect(res.body.reason).toBe('no_status_change');
    });

    it('retorna 200 com ignored=true quando changelog está ausente', async () => {
      const app = await buildApp();
      const payloadSemChangelog = { ...validPayload };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (payloadSemChangelog as any).changelog;

      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(payloadSemChangelog);

      expect(res.status).toBe(200);
      expect(res.body.ignored).toBe(true);
      expect(res.body.reason).toBe('no_status_change');
    });
  });

  describe('caminho feliz — enfileiramento', () => {
    it('retorna 200 com queued=true e chama orchestratorQueue.add', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(validPayload);

      expect(res.status).toBe(200);
      expect(res.body.queued).toBe(true);
      expect(res.body.jiraKey).toBe('SCRUM-1');
      expect(res.body.jobId).toBe('job-123');
      expect(res.body.transition.from).toBe('A Refinar');
      expect(res.body.transition.to).toBe('Em Desenvolvimento');
      expect(mockQueueAdd).toHaveBeenCalledOnce();
    });

    it('enfileira job com dados corretos (jiraKey, summary, fromStatus, toStatus)', async () => {
      const app = await buildApp();
      await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(validPayload);

      const [eventName, jobData] = mockQueueAdd.mock.calls[0];
      expect(eventName).toBe('jira:transition');
      expect(jobData.jiraKey).toBe('SCRUM-1');
      expect(jobData.summary).toBe('Minha história de teste');
      expect(jobData.fromStatus).toBe('A Refinar');
      expect(jobData.toStatus).toBe('Em Desenvolvimento');
      expect(jobData.currentStatus).toBe('Em Desenvolvimento');
      expect(jobData.receivedAt).toBeDefined();
    });

    it('usa fromString/toString como null quando ausentes no changelogItem', async () => {
      const app = await buildApp();
      const payloadSemStrings = {
        ...validPayload,
        changelog: {
          items: [{ field: 'status', fieldtype: 'jira' }],
        },
      };

      const res = await request(app)
        .post(`/webhooks/jira?secret=${VALID_SECRET}`)
        .send(payloadSemStrings);

      expect(res.status).toBe(200);
      expect(res.body.queued).toBe(true);
      const [, jobData] = mockQueueAdd.mock.calls[0];
      expect(jobData.fromStatus).toBeNull();
      expect(jobData.toStatus).toBeNull();
    });
  });
});
