// ─── Cliente Jira REST API v3 ─────────────────────────────────────────────────
//
// Usado pelo reconciler para buscar o estado real dos cards no Jira.
// Autenticação via Basic Auth (email + API token).

export type JiraIssue = {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: {
      id: string;
      name: string;
    };
  };
};

type JiraSearchResult = {
  issues: JiraIssue[];
  total: number;
  maxResults: number;
  startAt: number;
};

function getBaseHeaders(): Record<string, string> {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;

  if (!email || !token) {
    throw new Error('JIRA_EMAIL e JIRA_API_TOKEN são obrigatórios');
  }

  const credentials = Buffer.from(`${email}:${token}`).toString('base64');

  return {
    Authorization: `Basic ${credentials}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function getBaseUrl(): string {
  const url = process.env.JIRA_BASE_URL;
  if (!url) throw new Error('JIRA_BASE_URL é obrigatório');
  return url.replace(/\/$/, '');
}

/** Busca todas as issues ativas de um projeto (exclui Backlog e Concluído). */
export async function fetchActiveIssues(projectKey: string): Promise<JiraIssue[]> {
  const baseUrl = getBaseUrl();
  const headers = getBaseHeaders();

  // JQL: issues do projeto que não estão nos extremos do fluxo
  const jql = encodeURIComponent(
    `project = "${projectKey}" AND status NOT IN ("Backlog", "Concluído") ORDER BY updated DESC`,
  );

  const url = `${baseUrl}/rest/api/3/search?jql=${jql}&fields=summary,status&maxResults=50`;

  const res = await fetch(url, { headers });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira API ${res.status}: ${body}`);
  }

  const data = (await res.json()) as JiraSearchResult;
  return data.issues;
}

/** Busca o estado atual de uma única issue pelo key (ex: SCRUM-10). */
export async function fetchIssueStatus(issueKey: string): Promise<JiraIssue> {
  const baseUrl = getBaseUrl();
  const headers = getBaseHeaders();

  const url = `${baseUrl}/rest/api/3/issue/${issueKey}?fields=summary,status`;

  const res = await fetch(url, { headers });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira API ${res.status} para ${issueKey}: ${body}`);
  }

  return (await res.json()) as JiraIssue;
}
