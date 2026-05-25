import { createSign } from 'crypto';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type CommitResult = {
  sha: string;
  url: string;
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
