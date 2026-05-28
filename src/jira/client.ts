// ─── Cliente Jira REST API v3 ─────────────────────────────────────────────────
//
// Autenticação via Basic Auth (JIRA_EMAIL + JIRA_API_TOKEN).
// Jira Cloud não suporta HMAC — segredo do webhook é validado via query param.

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type JiraIssue = {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: unknown;
    status: {
      id: string;
      name: string;
    };
  };
};

export type JiraTransition = {
  id: string;
  name: string;
  to: {
    id: string;
    name: string;
  };
};

type JiraSearchResult = {
  issues: JiraIssue[];
  total: number;
  maxResults: number;
  startAt: number;
};

type JiraTransitionsResult = {
  transitions: JiraTransition[];
};

// ─── Retry com backoff exponencial ────────────────────────────────────────────

const JIRA_RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const JIRA_MAX_RETRIES = 3;
const JIRA_BASE_DELAY_MS = 1_000;

// ─── Helpers internos ─────────────────────────────────────────────────────────

function getBaseHeaders(): Record<string, string> {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;

  if (!email || !token) {
    throw new Error('JIRA_EMAIL e JIRA_API_TOKEN são obrigatórios');
  }

  return {
    Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function getBaseUrl(): string {
  const url = process.env.JIRA_BASE_URL;
  if (!url) throw new Error('JIRA_BASE_URL é obrigatório');
  return url.replace(/\/$/, '');
}

async function jiraFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let lastErr: Error | undefined;

  for (let attempt = 0; attempt <= JIRA_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, JIRA_BASE_DELAY_MS * 2 ** (attempt - 1)));
    }

    let res: Response;
    try {
      res = await fetch(`${getBaseUrl()}${path}`, {
        ...options,
        headers: { ...getBaseHeaders(), ...(options.headers as Record<string, string> | undefined) },
      });
    } catch (err) {
      lastErr = err as Error;
      if (attempt < JIRA_MAX_RETRIES) continue;
      throw lastErr;
    }

    if (res.status === 204) return undefined as T;
    if (res.ok) return res.json() as Promise<T>;

    if (!JIRA_RETRYABLE.has(res.status) || attempt === JIRA_MAX_RETRIES) {
      const body = await res.text();
      throw new Error(`Jira API ${res.status} ${path}: ${body}`);
    }

    lastErr = new Error(`Jira API ${res.status} ${path} (tentativa ${attempt + 1}/${JIRA_MAX_RETRIES + 1})`);
  }

  throw lastErr ?? new Error('unreachable');
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Busca uma issue pelo key com campos summary, status e description.
 * Equivale a GET /rest/api/3/issue/{key}
 */
export async function getIssue(issueKey: string): Promise<JiraIssue> {
  return jiraFetch<JiraIssue>(
    `/rest/api/3/issue/${issueKey}?fields=summary,status,description`,
  );
}

/**
 * Lista as transições disponíveis para a issue no estado atual.
 * Equivale a GET /rest/api/3/issue/{key}/transitions
 */
export async function getTransitions(issueKey: string): Promise<JiraTransition[]> {
  const data = await jiraFetch<JiraTransitionsResult>(
    `/rest/api/3/issue/${issueKey}/transitions`,
  );
  return data.transitions;
}

/**
 * Move o card para o status correspondente ao transitionId.
 * Use getTransitions() para descobrir o ID antes de chamar.
 * Equivale a POST /rest/api/3/issue/{key}/transitions
 */
export async function transitionIssue(
  issueKey: string,
  transitionId: string,
): Promise<void> {
  await jiraFetch<undefined>(`/rest/api/3/issue/${issueKey}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ transition: { id: transitionId } }),
  });
}

/**
 * Adiciona um comentário (formato Atlassian Document Format — ADF) à issue.
 * Equivale a POST /rest/api/3/issue/{key}/comment
 */
export async function addComment(issueKey: string, text: string): Promise<void> {
  // Jira Cloud REST v3 exige ADF (não aceita string simples)
  const adfBody = {
    body: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text }],
        },
      ],
    },
  };

  await jiraFetch<undefined>(`/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    body: JSON.stringify(adfBody),
  });
}

/**
 * Move o card para um status pelo nome (ex: "Aguardando Aceite PRD").
 * Chama getTransitions internamente para resolver o transitionId.
 * Lança erro se a transição não estiver disponível no estado atual do card.
 */
export async function moveCardTo(issueKey: string, targetStatusName: string): Promise<void> {
  const transitions = await getTransitions(issueKey);
  const transition = transitions.find((t) => t.to.name === targetStatusName);

  if (!transition) {
    const available = transitions.map((t) => t.to.name).join(', ');
    throw new Error(
      `Transição para "${targetStatusName}" indisponível em ${issueKey}. Disponíveis: ${available}`,
    );
  }

  await transitionIssue(issueKey, transition.id);
}

/**
 * Busca todas as issues ativas de um projeto (exclui Backlog e Concluído).
 * Usado pelo reconciler para comparar estado do banco vs Jira.
 */
export async function fetchActiveIssues(projectKey: string): Promise<JiraIssue[]> {
  // GET /rest/api/3/search foi removido (410) — migrado para POST /rest/api/3/search/jql
  const data = await jiraFetch<JiraSearchResult>(`/rest/api/3/search/jql`, {
    method: 'POST',
    body: JSON.stringify({
      jql: `project = "${projectKey}" AND status NOT IN ("Backlog", "Concluído") ORDER BY updated DESC`,
      fields: ['summary', 'status'],
      maxResults: 50,
    }),
  });

  return data.issues;
}
