// ─── Jira: validação de credenciais e registro de webhook ────────────────────

const TIMEOUT_MS = 10_000;

function jiraHeaders(email: string, token: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// ─── Validação ────────────────────────────────────────────────────────────────

export type ValidationResult = { ok: boolean; detail?: string };

export async function validateJiraAccess(
  baseUrl: string,
  email: string,
  token: string,
  projectKey: string,
): Promise<ValidationResult> {
  try {
    const res = await fetch(
      `${baseUrl.replace(/\/$/, '')}/rest/api/3/project/${projectKey}`,
      { headers: jiraHeaders(email, token), signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (res.ok) return { ok: true };
    const body = await res.text().catch(() => '');
    return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

// ─── Registro de webhook ──────────────────────────────────────────────────────

export type WebhookRegistrationResult = {
  ok: boolean;
  webhookId?: number;
  detail?: string;
};

export async function registerJiraWebhook(
  baseUrl: string,
  email: string,
  token: string,
  webhookUrl: string,
  projectKey: string,
): Promise<WebhookRegistrationResult> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/rest/api/3/webhook`, {
      method: 'POST',
      headers: jiraHeaders(email, token),
      body: JSON.stringify({
        url: webhookUrl,
        webhooks: [
          {
            events: ['jira:issue_updated'],
            jqlFilter: `project = "${projectKey}"`,
            fieldIdsFilter: ['status'],
          },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }

    const data = (await res.json()) as {
      webhookRegistrationResult?: Array<{ createdWebhookId?: number; errors?: string[] }>;
    };

    const result = data.webhookRegistrationResult?.[0];
    if (result?.errors?.length) {
      return { ok: false, detail: result.errors.join(', ') };
    }

    return { ok: true, webhookId: result?.createdWebhookId };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

// ─── Operações de issue para smoke test ──────────────────────────────────────

export type IssueRef = { id: string; key: string };

export async function createTestIssue(
  baseUrl: string,
  email: string,
  token: string,
  projectKey: string,
): Promise<IssueRef> {
  const base = baseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/rest/api/3/issue`, {
    method: 'POST',
    headers: jiraHeaders(email, token),
    body: JSON.stringify({
      fields: {
        project: { key: projectKey },
        summary: '[SMOKE TEST] agentic-squad init — pode remover',
        issuetype: { name: 'Story' },
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Falha ao criar issue de teste: HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { id: string; key: string };
  return { id: data.id, key: data.key };
}

export async function transitionIssueTo(
  baseUrl: string,
  email: string,
  token: string,
  issueKey: string,
  targetStatusName: string,
): Promise<void> {
  const base = baseUrl.replace(/\/$/, '');
  const headers = jiraHeaders(email, token);

  const tRes = await fetch(`${base}/rest/api/3/issue/${issueKey}/transitions`, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!tRes.ok) throw new Error(`Falha ao buscar transições: HTTP ${tRes.status}`);

  const { transitions } = (await tRes.json()) as {
    transitions: Array<{ id: string; to: { name: string } }>;
  };
  const transition = transitions.find((t) => t.to.name === targetStatusName);
  if (!transition) {
    const names = transitions.map((t) => t.to.name).join(', ');
    throw new Error(`Transição "${targetStatusName}" indisponível. Disponíveis: ${names}`);
  }

  const pRes = await fetch(`${base}/rest/api/3/issue/${issueKey}/transitions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ transition: { id: transition.id } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!pRes.ok) throw new Error(`Falha ao aplicar transição: HTTP ${pRes.status}`);
}

export async function deleteIssue(
  baseUrl: string,
  email: string,
  token: string,
  issueKey: string,
): Promise<void> {
  await fetch(`${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${issueKey}`, {
    method: 'DELETE',
    headers: jiraHeaders(email, token),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}
