import { createSign } from 'crypto';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type CommitResult = {
  sha: string;
  url: string;
};

export type WorkflowRunResult = {
  runId: number;
  status: string;
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | null;
  htmlUrl: string;
  createdAt: string;
};

export type DirectoryEntry = {
  name: string;
  type: 'file' | 'dir';
  path: string;
};

export type PullRequestResult = {
  number: number;
  url: string;
  html_url: string;
};

// ─── Autenticação GitHub App via JWT + Installation Token ─────────────────────
//
// @octokit/app v15 é ESM-only, incompatível com o output CommonJS deste projeto.
// Implementado com Node.js crypto nativo + fetch global (disponível no Node ≥ 22).

function normalizePrivateKey(key: string): string {
  // Render armazena PEM com \n literal — converte para quebra de linha real
  return key.replace(/\\n/g, '\n');
}

function generateAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId }),
  ).toString('base64url');

  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(normalizePrivateKey(privateKey), 'base64url');

  return `${header}.${payload}.${signature}`;
}

async function getInstallationToken(): Promise<string> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;

  if (!appId || !privateKey || !installationId) {
    throw new Error('GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY e GITHUB_APP_INSTALLATION_ID são obrigatórios');
  }

  const jwt = generateAppJwt(appId, normalizePrivateKey(privateKey));

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub App auth falhou (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { token: string };
  return data.token;
}

// ─── Helpers de API ───────────────────────────────────────────────────────────

async function githubFetch<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} ${path}: ${body}`);
  }

  return res.json() as Promise<T>;
}

function getRepoCoords() {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  if (!owner || !repo) throw new Error('GITHUB_OWNER e GITHUB_REPO são obrigatórios');
  return { owner, repo };
}

async function getDefaultBranchSha(token: string): Promise<{ branch: string; sha: string }> {
  const { owner, repo } = getRepoCoords();
  const repoData = await githubFetch<{ default_branch: string }>(
    `/repos/${owner}/${repo}`,
    token,
  );
  const defaultBranch = repoData.default_branch;
  const refData = await githubFetch<{ object: { sha: string } }>(
    `/repos/${owner}/${repo}/git/refs/heads/${defaultBranch}`,
    token,
  );
  return { branch: defaultBranch, sha: refData.object.sha };
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Lê o conteúdo de um arquivo do repositório.
 * Retorna null se o arquivo não existir (404) ou não for um arquivo regular.
 */
export async function readFile(filePath: string, branch?: string): Promise<string | null> {
  const token = await getInstallationToken();
  const { owner, repo } = getRepoCoords();

  try {
    const query = branch ? `?ref=${encodeURIComponent(branch)}` : '';
    const data = await githubFetch<{ type: string; content: string }>(
      `/repos/${owner}/${repo}/contents/${filePath}${query}`,
      token,
    );
    if (data.type !== 'file') return null;
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
  } catch (err) {
    if ((err as Error).message.includes('404')) return null;
    throw err;
  }
}

/**
 * Cria um branch a partir do branch padrão do repositório.
 * Idempotente: ignora erro 422 (branch já existe) para suportar retries.
 */
export async function createBranch(branchName: string): Promise<void> {
  const token = await getInstallationToken();
  const { owner, repo } = getRepoCoords();
  const { sha } = await getDefaultBranchSha(token);

  try {
    await githubFetch(`/repos/${owner}/${repo}/git/refs`, token, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
    });
  } catch (err) {
    // 422 = branch já existe — idempotente em retries
    if (!(err as Error).message.includes('422')) throw err;
  }
}

/**
 * Cria ou atualiza um arquivo no repositório e retorna o SHA do commit.
 * Aceita branch opcional — padrão: branch default do repositório.
 */
export async function commitFile(
  filePath: string,
  content: string,
  commitMessage: string,
  branch?: string,
): Promise<CommitResult> {
  const token = await getInstallationToken();
  const { owner, repo } = getRepoCoords();

  // Busca SHA atual do arquivo (necessário para atualização — PUT exige sha)
  let existingSha: string | undefined;
  try {
    const query = branch ? `?ref=${encodeURIComponent(branch)}` : '';
    const fileData = await githubFetch<{ type: string; sha: string }>(
      `/repos/${owner}/${repo}/contents/${filePath}${query}`,
      token,
    );
    if (fileData.type === 'file') existingSha = fileData.sha;
  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    if (!msg.includes('404')) throw err;
  }

  const result = await githubFetch<{ commit: { sha: string; html_url?: string } }>(
    `/repos/${owner}/${repo}/contents/${filePath}`,
    token,
    {
      method: 'PUT',
      body: JSON.stringify({
        message: commitMessage,
        content: Buffer.from(content).toString('base64'),
        ...(existingSha && { sha: existingSha }),
        ...(branch && { branch }),
      }),
    },
  );

  return {
    sha: result.commit.sha,
    url: result.commit.html_url ?? '',
  };
}

/**
 * Cria um commit atômico com múltiplos arquivos usando a Git Data API.
 * Usa o fluxo: blobs → tree → commit → update ref.
 */
export async function commitFiles(
  files: { path: string; content: string }[],
  commitMessage: string,
  branch: string,
): Promise<CommitResult> {
  const token = await getInstallationToken();
  const { owner, repo } = getRepoCoords();

  // 1. SHA do commit pai (HEAD do branch)
  const refData = await githubFetch<{ object: { sha: string } }>(
    `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    token,
  );
  const parentSha = refData.object.sha;

  // 2. SHA da tree base do commit pai
  const parentCommit = await githubFetch<{ tree: { sha: string } }>(
    `/repos/${owner}/${repo}/git/commits/${parentSha}`,
    token,
  );
  const baseTreeSha = parentCommit.tree.sha;

  // 3. Cria um blob por arquivo (em paralelo)
  const blobEntries = await Promise.all(
    files.map(async ({ path, content }) => {
      const blob = await githubFetch<{ sha: string }>(
        `/repos/${owner}/${repo}/git/blobs`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({ content: Buffer.from(content).toString('base64'), encoding: 'base64' }),
        },
      );
      return { path, sha: blob.sha };
    }),
  );

  // 4. Cria tree com todos os blobs
  const treeData = await githubFetch<{ sha: string }>(
    `/repos/${owner}/${repo}/git/trees`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: blobEntries.map((e) => ({ path: e.path, mode: '100644', type: 'blob', sha: e.sha })),
      }),
    },
  );

  // 5. Cria o commit
  const newCommit = await githubFetch<{ sha: string; html_url?: string }>(
    `/repos/${owner}/${repo}/git/commits`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ message: commitMessage, tree: treeData.sha, parents: [parentSha] }),
    },
  );

  // 6. Avança o ponteiro do branch
  await githubFetch(
    `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    token,
    {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommit.sha, force: false }),
    },
  );

  return { sha: newCommit.sha, url: newCommit.html_url ?? '' };
}

/**
 * Lista arquivos e subdiretórios em um caminho do repositório.
 * Retorna array vazio se o caminho não existir (404) ou não for diretório.
 */
export async function listDirectory(dirPath: string, branch?: string): Promise<DirectoryEntry[]> {
  const token = await getInstallationToken();
  const { owner, repo } = getRepoCoords();

  try {
    const query = branch ? `?ref=${encodeURIComponent(branch)}` : '';
    const data = await githubFetch<unknown>(
      `/repos/${owner}/${repo}/contents/${dirPath}${query}`,
      token,
    );
    if (!Array.isArray(data)) return [];
    return (data as Array<{ name: string; type: string; path: string }>)
      .filter((item) => item.type === 'file' || item.type === 'dir')
      .map((item) => ({ name: item.name, type: item.type as 'file' | 'dir', path: item.path }));
  } catch (err) {
    if ((err as Error).message.includes('404')) return [];
    throw err;
  }
}

// ─── Helper interno ───────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Workflow Runs ────────────────────────────────────────────────────────────

/**
 * Retorna o run mais recente do workflow de CI para o branch informado, ou null se não houver.
 */
export async function getLatestWorkflowRun(branch: string): Promise<WorkflowRunResult | null> {
  const token = await getInstallationToken();
  const { owner, repo } = getRepoCoords();

  const data = await githubFetch<{
    workflow_runs: Array<{
      id: number;
      status: string;
      conclusion: string | null;
      html_url: string;
      created_at: string;
    }>;
  }>(
    `/repos/${owner}/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&event=push&per_page=5`,
    token,
  );

  const run = data.workflow_runs[0];
  if (!run) return null;

  return {
    runId: run.id,
    status: run.status,
    conclusion: run.conclusion as WorkflowRunResult['conclusion'],
    htmlUrl: run.html_url,
    createdAt: run.created_at,
  };
}

/**
 * Aguarda a conclusão de um novo run de CI com ID maior que afterRunId.
 * Faz polling a cada 30 s com timeout configurável (padrão 10 min).
 * Retorna null em caso de timeout.
 */
export async function waitForWorkflowCompletion(
  branch: string,
  afterRunId: number,
  timeoutMs: number = 600_000,
): Promise<WorkflowRunResult | null> {
  const token = await getInstallationToken();
  const { owner, repo } = getRepoCoords();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await sleep(30_000);

    const data = await githubFetch<{
      workflow_runs: Array<{
        id: number;
        status: string;
        conclusion: string | null;
        html_url: string;
        created_at: string;
      }>;
    }>(
      `/repos/${owner}/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&event=push&per_page=10`,
      token,
    );

    const newRun = data.workflow_runs.find(
      (r) => r.id > afterRunId && r.status === 'completed',
    );

    if (newRun) {
      return {
        runId: newRun.id,
        status: newRun.status,
        conclusion: newRun.conclusion as WorkflowRunResult['conclusion'],
        htmlUrl: newRun.html_url,
        createdAt: newRun.created_at,
      };
    }
  }

  return null;
}

// ─── PR Files ─────────────────────────────────────────────────────────────────

export type PrFileEntry = {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
};

/**
 * Retorna os arquivos modificados no PR aberto para o branch informado.
 * Retorna array vazio se não houver PR aberto.
 */
export async function getPrFiles(branch: string): Promise<PrFileEntry[]> {
  const token = await getInstallationToken();
  const { owner, repo } = getRepoCoords();

  const prs = await githubFetch<Array<{ number: number }>>(
    `/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open&per_page=1`,
    token,
  );

  if (!prs.length) return [];

  const prNumber = prs[0]!.number;
  const files = await githubFetch<Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
  }>>(
    `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`,
    token,
  );

  return files.map((f) => ({
    filename: f.filename,
    status: f.status as PrFileEntry['status'],
    additions: f.additions,
    deletions: f.deletions,
  }));
}

/**
 * Cria um Pull Request do branch de desenvolvimento para o branch padrão (ou base especificado).
 * Lança erro se o PR já existir (422) — idempotência deve ser tratada pelo caller.
 */
export async function createPullRequest(
  title: string,
  body: string,
  headBranch: string,
  baseBranch?: string,
): Promise<PullRequestResult> {
  const token = await getInstallationToken();
  const { owner, repo } = getRepoCoords();

  const base = baseBranch ?? (await getDefaultBranchSha(token)).branch;

  const result = await githubFetch<{ number: number; url: string; html_url: string }>(
    `/repos/${owner}/${repo}/pulls`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ title, body, head: headBranch, base, draft: false }),
    },
  );

  return { number: result.number, url: result.url, html_url: result.html_url };
}
