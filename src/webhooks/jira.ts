import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { orchestratorQueue, type OrchestratorJobData } from '../queue/index';
import { childLogger } from '../lib/logger';

const log = childLogger({ module: 'webhook.jira' });

const router = Router();

// ─── Schema de validação do payload Jira ─────────────────────────────────────

const changelogItemSchema = z.object({
  field: z.string(),
  fieldtype: z.string().optional(),
  from: z.string().nullable().optional(),
  fromString: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
  toString: z.string().nullable().optional(),
});

const jiraWebhookSchema = z.object({
  webhookEvent: z.string(),
  issue: z.object({
    id: z.string(),
    key: z.string(),
    fields: z.object({
      summary: z.string(),
      status: z.object({
        name: z.string(),
        id: z.string(),
      }),
    }),
  }),
  changelog: z
    .object({
      items: z.array(changelogItemSchema),
    })
    .optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validateSecret(received: unknown): boolean {
  const expected = process.env.JIRA_WEBHOOK_SECRET;
  if (!expected || typeof received !== 'string') return false;
  try {
    return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── POST /webhooks/jira ──────────────────────────────────────────────────────
//
// Jira Cloud não suporta HMAC nativo — o segredo é validado via query param.
// Configurar a URL do webhook no Jira como:
//   https://agentic-squad-heavy.onrender.com/webhooks/jira?secret=<JIRA_WEBHOOK_SECRET>

router.post('/jira', async (req: Request, res: Response) => {
  // 1. Valida segredo
  if (!validateSecret(req.query['secret'])) {
    log.warn({ ip: req.ip }, 'requisição não autorizada — secret inválido');
    return res.status(401).json({ error: 'unauthorized' });
  }

  // 2. Valida estrutura do payload
  const parsed = jiraWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    log.warn({ validationError: parsed.error.message }, 'payload inválido');
    return res.status(400).json({ error: 'invalid_payload' });
  }

  const { webhookEvent, issue, changelog } = parsed.data;

  // 3. Ignora eventos que não sejam atualizações de issue
  if (webhookEvent !== 'jira:issue_updated') {
    return res.status(200).json({ ignored: true, reason: 'event_not_tracked' });
  }

  // 4. Filtra apenas mudanças de status
  const statusChange = changelog?.items.find((item) => item.field === 'status');
  if (!statusChange) {
    return res.status(200).json({ ignored: true, reason: 'no_status_change' });
  }

  const fromStatus = statusChange.fromString ?? null;
  const toStatus = statusChange.toString ?? null;

  log.info({ jiraKey: issue.key, from: fromStatus, to: toStatus }, 'transição recebida');

  // 5. Enfileira job no BullMQ
  const jobData: OrchestratorJobData = {
    jiraKey: issue.key,
    issueId: issue.id,
    summary: issue.fields.summary,
    fromStatus,
    toStatus,
    currentStatus: issue.fields.status.name,
    receivedAt: new Date().toISOString(),
  };

  const job = await orchestratorQueue.add('jira:transition', jobData, {
    jobId: `${issue.key}-${Date.now()}`,
  });

  log.info({ jiraKey: issue.key, jobId: job.id, from: fromStatus, to: toStatus }, 'job enfileirado');

  return res.status(200).json({
    queued: true,
    jobId: job.id,
    jiraKey: issue.key,
    transition: { from: fromStatus, to: toStatus },
  });
});

export default router;
