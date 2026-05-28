import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { orchestratorQueue, redisConnection, type OrchestratorJobData } from '../queue/index';
import { childLogger } from '../lib/logger';
import { sanitizeForLlm } from '../lib/sanitize';

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

// ─── Rate limiting ────────────────────────────────────────────────────────────
// In-memory: 60 requisições por IP por janela de 60 segundos.

const rateLimitStore = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ─── Proteção contra replay ───────────────────────────────────────────────────
// Chave única por (jiraKey + fromStatus + toStatus) dentro de uma janela de 5 min.
// Redis SET NX com TTL de 300s garante idempotência para retries do Jira.

function replayNonceKey(issueKey: string, from: string | null, to: string | null): string {
  const bucket = Math.floor(Date.now() / 300_000); // janela de 5 min
  return `wh:nonce:${issueKey}:${from ?? '_'}:${to ?? '_'}:${bucket}`;
}

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
  // 1. Rate limiting
  const clientIp = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
  if (!checkRateLimit(clientIp)) {
    log.warn({ ip: clientIp }, 'rate limit excedido');
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'rate_limit_exceeded' });
  }

  // 2. Valida segredo
  if (!validateSecret(req.query['secret'])) {
    log.warn({ ip: clientIp }, 'requisição não autorizada — secret inválido');
    return res.status(401).json({ error: 'unauthorized' });
  }

  // 3. Valida estrutura do payload
  const parsed = jiraWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    log.warn({ validationError: parsed.error.message }, 'payload inválido');
    return res.status(400).json({ error: 'invalid_payload' });
  }

  const { webhookEvent, issue, changelog } = parsed.data;

  // 4. Ignora eventos que não sejam atualizações de issue
  if (webhookEvent !== 'jira:issue_updated') {
    return res.status(200).json({ ignored: true, reason: 'event_not_tracked' });
  }

  // 5. Filtra apenas mudanças de status
  const statusChange = changelog?.items.find((item) => item.field === 'status');
  if (!statusChange) {
    return res.status(200).json({ ignored: true, reason: 'no_status_change' });
  }

  const fromStatus = statusChange.fromString ?? null;
  const toStatus = statusChange.toString ?? null;

  // 6. Proteção contra replay — idempotência de 5 min via Redis SET NX
  const nonceKey = replayNonceKey(issue.key, fromStatus, toStatus);
  const wasSet = await redisConnection.set(nonceKey, '1', 'EX', 300, 'NX');
  if (wasSet === null) {
    log.info({ jiraKey: issue.key, from: fromStatus, to: toStatus }, 'replay detectado — evento ignorado');
    return res.status(200).json({ ignored: true, reason: 'replay_detected' });
  }

  log.info({ jiraKey: issue.key, from: fromStatus, to: toStatus }, 'transição recebida');

  // 7. Enfileira job no BullMQ (sanitiza o summary antes de persistir)
  const jobData: OrchestratorJobData = {
    jiraKey: issue.key,
    projectKey: issue.key.split('-')[0]!,
    issueId: issue.id,
    summary: sanitizeForLlm(issue.fields.summary),
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
