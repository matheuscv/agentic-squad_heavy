// ─── Smoke test end-to-end ────────────────────────────────────────────────────
//
// Fluxo: cria issue no Jira → move para "A Refinar" → simula webhook →
//        verifica resposta do orquestrador → remove issue de teste.
//
// O teste valida: credenciais Jira, conectividade com o serviço e pipeline
// de recebimento de eventos (fila + resposta HTTP). Não aguarda conclusão
// dos agentes (isso levaria 15+ minutos).

import {
  createTestIssue,
  transitionIssueTo,
  deleteIssue,
  type IssueRef,
} from './jira-setup';

const TIMEOUT_MS = 15_000;

export type SmokeTestResult = {
  ok: boolean;
  issue?: IssueRef;
  webhookResponse?: unknown;
  detail?: string;
  cleaned: boolean;
};

export async function runSmokeTest(opts: {
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraToken: string;
  jiraProjectKey: string;
  serviceUrl: string;
  webhookSecret: string;
}): Promise<SmokeTestResult> {
  const { jiraBaseUrl, jiraEmail, jiraToken, jiraProjectKey, serviceUrl, webhookSecret } = opts;

  let issue: IssueRef | undefined;
  // Encapsula resultado sem o campo `cleaned` — preenchido após tentativa de limpeza
  type PartialResult = Omit<SmokeTestResult, 'cleaned'>;
  let partial: PartialResult = { ok: false, detail: 'não iniciado' };

  try {
    // 1. Cria issue de teste
    issue = await createTestIssue(jiraBaseUrl, jiraEmail, jiraToken, jiraProjectKey);
    partial = { ...partial, issue };

    // 2. Move para "A Refinar"
    await transitionIssueTo(jiraBaseUrl, jiraEmail, jiraToken, issue.key, 'A Refinar');

    // 3. Simula webhook do Jira
    const webhookUrl = `${serviceUrl.replace(/\/$/, '')}/webhooks/jira?secret=${encodeURIComponent(webhookSecret)}`;
    const payload = {
      webhookEvent: 'jira:issue_updated',
      issue: {
        id: issue.id,
        key: issue.key,
        fields: {
          summary: '[SMOKE TEST] agentic-squad init — pode remover',
          status: { name: 'A Refinar', id: '10001' },
        },
      },
      changelog: {
        items: [
          {
            field: 'status',
            fieldtype: 'jira',
            from: '10000',
            fromString: 'Backlog',
            to: '10001',
            toString: 'A Refinar',
          },
        ],
      },
    };

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const webhookResponse = await res.json().catch(() => ({ status: res.status }));

    if (!res.ok) {
      partial = { ok: false, issue, webhookResponse, detail: `Webhook retornou HTTP ${res.status}` };
    } else {
      const body = webhookResponse as Record<string, unknown>;
      if (!body['queued']) {
        partial = {
          ok: false,
          issue,
          webhookResponse,
          detail: 'Webhook não enfileirou o job (esperado: { queued: true })',
        };
      } else {
        partial = { ok: true, issue, webhookResponse };
      }
    }
  } catch (err) {
    partial = { ok: false, issue, detail: (err as Error).message };
  }

  // 4. Limpeza — remove a issue de teste (best-effort)
  let cleaned = false;
  if (issue) {
    try {
      await deleteIssue(jiraBaseUrl, jiraEmail, jiraToken, issue.key);
      cleaned = true;
    } catch {
      // silencioso — wizard notifica sobre limpeza manual
    }
  }

  return { ...partial, cleaned };
}

// ─── Verificação de saúde do serviço ─────────────────────────────────────────

export type HealthCheckResult = { ok: boolean; status?: string; detail?: string };

export async function checkServiceHealth(serviceUrl: string): Promise<HealthCheckResult> {
  try {
    const res = await fetch(`${serviceUrl.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = (await res.json()) as { status?: string };
    return { ok: body.status === 'ok', status: body.status };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}
