import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock global fetch ────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Mock crypto (createSign) ─────────────────────────────────────────────────

vi.mock('crypto', () => ({
  createSign: vi.fn().mockReturnValue({
    update: vi.fn().mockReturnThis(),
    sign: vi.fn().mockReturnValue('mock-signature'),
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOkResponse(body: unknown, status = 200) {
  return {
    ok: true,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

function makeErrorResponse(status: number, body = 'Not Found') {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({ message: body }),
    text: vi.fn().mockResolvedValue(body),
  };
}

// ─── Setup de variáveis de ambiente ───────────────────────────────────────────

const ENV_VARS = {
  GITHUB_APP_ID: 'test-app-id',
  GITHUB_APP_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
  GITHUB_APP_INSTALLATION_ID: 'test-installation-id',
  GITHUB_OWNER: 'test-owner',
  GITHUB_REPO: 'test-repo',
};

function setupEnv(overrides: Partial<typeof ENV_VARS> = {}) {
  const vars = { ...ENV_VARS, ...overrides };
  Object.entries(vars).forEach(([k, v]) => {
    process.env[k] = v;
  });
}

function clearEnv() {
  Object.keys(ENV_VARS).forEach((k) => delete process.env[k]);
}

// ─── Mock de token de instalação ──────────────────────────────────────────────

function mockInstallationToken(token = 'ghs_mock_token') {
  // Primeira chamada: gera JWT via App → exchange por token de instalação
  mockFetch.mockResolvedValueOnce(makeOkResponse({ token }));
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('github/client', () => {
  beforeEach(() => {
    setupEnv();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearEnv();
  });

  // ── readFile ────────────────────────────────────────────────────────────

  describe('readFile', () => {
    it('retorna conteúdo decodificado de Base64 quando arquivo existe', async () => {
      const content = 'Hello, world!';
      const encoded = Buffer.from(content).toString('base64');

      mockInstallationToken();
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ type: 'file', content: encoded + '\n', encoding: 'base64' }),
      );

      const { readFile } = await import('./client');
      const result = await readFile('README.md');

      expect(result).toBe(content);
    });

    it('retorna conteúdo de arquivo em branch específico', async () => {
      const content = 'Branch content';
      const encoded = Buffer.from(content).toString('base64');

      mockInstallationToken();
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ type: 'file', content: encoded, encoding: 'base64' }),
      );

      const { readFile } = await import('./client');
      const result = await readFile('src/file.ts', 'feature-branch');

      expect(result).toBe(content);
    });

    it('retorna null quando arquivo não existe (404)', async () => {
      mockInstallationToken();
      mockFetch.mockResolvedValueOnce(makeErrorResponse(404));

      const { readFile } = await import('./client');
      const result = await readFile('nao-existe.ts');

      expect(result).toBeNull();
    });

    it('lança erro quando API retorna status diferente de 404', async () => {
      mockInstallationToken();
      mockFetch.mockResolvedValueOnce(makeErrorResponse(500, 'Internal Server Error'));

      const { readFile } = await import('./client');
      await expect(readFile('arquivo.ts')).rejects.toThrow('500');
    });
  });

  // ── listDirectory ───────────────────────────────────────────────────────

  describe('listDirectory', () => {
    it('retorna lista de entradas do diretório', async () => {
      const entries = [
        { name: 'index.ts', type: 'file', path: 'src/index.ts' },
        { name: 'lib', type: 'dir', path: 'src/lib' },
      ];

      mockInstallationToken();
      mockFetch.mockResolvedValueOnce(makeOkResponse(entries));

      const { listDirectory } = await import('./client');
      const result = await listDirectory('src');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: 'index.ts', type: 'file', path: 'src/index.ts' });
      expect(result[1]).toEqual({ name: 'lib', type: 'dir', path: 'src/lib' });
    });

    it('retorna array vazio para diretório vazio', async () => {
      mockInstallationToken();
      mockFetch.mockResolvedValueOnce(makeOkResponse([]));

      const { listDirectory } = await import('./client');
      const result = await listDirectory('src/empty');

      expect(result).toEqual([]);
    });

    it('lista diretório em branch específico', async () => {
      const entries = [{ name: 'file.ts', type: 'file', path: 'src/file.ts' }];

      mockInstallationToken();
      mockFetch.mockResolvedValueOnce(makeOkResponse(entries));

      const { listDirectory } = await import('./client');
      const result = await listDirectory('src', 'my-branch');

      expect(result).toHaveLength(1);
    });
  });

  // ── createBranch ─────────────────────────────────────────────────────────

  describe('createBranch', () => {
    it('cria branch com sucesso a partir do SHA da branch padrão', async () => {
      // Token
      mockInstallationToken();
      // Get repo info (default branch)
      mockFetch.mockResolvedValueOnce(makeOkResponse({ default_branch: 'main' }));
      // Get ref SHA
      mockFetch.mockResolvedValueOnce(makeOkResponse({ object: { sha: 'abc123' } }));
      // Create ref
      mockFetch.mockResolvedValueOnce(makeOkResponse({ ref: 'refs/heads/new-branch' }));

      const { createBranch } = await import('./client');
      await expect(createBranch('new-branch')).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('422 é silenciado (branch já existe é idempotente)', async () => {
      mockInstallationToken();
      mockFetch.mockResolvedValueOnce(makeOkResponse({ default_branch: 'main' }));
      mockFetch.mockResolvedValueOnce(makeOkResponse({ object: { sha: 'abc123' } }));
      mockFetch.mockResolvedValueOnce(makeErrorResponse(422, 'Reference already exists'));

      const { createBranch } = await import('./client');
      await expect(createBranch('existing-branch')).resolves.toBeUndefined();
    });

    it('lança erro quando criação de branch falha com 500', async () => {
      mockInstallationToken();
      mockFetch.mockResolvedValueOnce(makeOkResponse({ default_branch: 'main' }));
      mockFetch.mockResolvedValueOnce(makeOkResponse({ object: { sha: 'abc123' } }));
      mockFetch.mockResolvedValueOnce(makeErrorResponse(500, 'Internal Server Error'));

      const { createBranch } = await import('./client');
      await expect(createBranch('new-branch')).rejects.toThrow('500');
    });
  });

  // ── getLatestWorkflowRun ─────────────────────────────────────────────────

  describe('getLatestWorkflowRun', () => {
    it('retorna o workflow run mais recente para o branch', async () => {
      const runData = {
        workflow_runs: [
          {
            id: 12345,
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.com/owner/repo/actions/runs/12345',
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      };

      mockInstallationToken();
      mockFetch.mockResolvedValueOnce(makeOkResponse(runData));

      const { getLatestWorkflowRun } = await import('./client');
      const result = await getLatestWorkflowRun('my-branch');

      expect(result).not.toBeNull();
      expect(result?.runId).toBe(12345);
      expect(result?.conclusion).toBe('success');
      expect(result?.status).toBe('completed');
    });

    it('retorna null quando não há workflow runs', async () => {
      mockInstallationToken();
      mockFetch.mockResolvedValueOnce(makeOkResponse({ workflow_runs: [] }));

      const { getLatestWorkflowRun } = await import('./client');
      const result = await getLatestWorkflowRun('empty-branch');

      expect(result).toBeNull();
    });

    it('retorna run com conclusion null quando ainda em execução', async () => {
      const runData = {
        workflow_runs: [
          {
            id: 99,
            status: 'in_progress',
            conclusion: null,
            html_url: 'https://github.com/owner/repo/actions/runs/99',
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      };

      mockInstallationToken();
      mockFetch.mockResolvedValueOnce(makeOkResponse(runData));

      const { getLatestWorkflowRun } = await import('./client');
      const result = await getLatestWorkflowRun('running-branch');

      expect(result?.conclusion).toBeNull();
      expect(result?.status).toBe('in_progress');
    });
  });

  // ── waitForWorkflowCompletion ─────────────────────────────────────────────

  describe('waitForWorkflowCompletion', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retorna run quando encontrado após sleep inicial de 30s', async () => {
      const completedRun = {
        workflow_runs: [
          {
            id: 42,
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://example.com',
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      };

      mockInstallationToken();
      mockFetch.mockResolvedValueOnce(makeOkResponse(completedRun));

      const { waitForWorkflowCompletion } = await import('./client');
      const promise = waitForWorkflowCompletion('my-branch', 41);
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await promise;

      expect(result).not.toBeNull();
      expect(result?.runId).toBe(42);
    });
  });

  // ── commitFiles ───────────────────────────────────────────────────────────

  describe('commitFiles', () => {
    it('cria commit com múltiplos arquivos com sucesso', async () => {
      // Assinatura real: commitFiles(files, commitMessage, branch)
      mockInstallationToken();
      // Get branch ref SHA
      mockFetch.mockResolvedValueOnce(makeOkResponse({ object: { sha: 'head-sha-abc' } }));
      // Get commit (git commits API retorna { sha, tree: { sha } })
      mockFetch.mockResolvedValueOnce(makeOkResponse({ sha: 'head-sha-abc', tree: { sha: 'tree-sha-xyz' } }));
      // Create blob (arquivo 1)
      mockFetch.mockResolvedValueOnce(makeOkResponse({ sha: 'blob-sha-1' }));
      // Create blob (arquivo 2)
      mockFetch.mockResolvedValueOnce(makeOkResponse({ sha: 'blob-sha-2' }));
      // Create tree
      mockFetch.mockResolvedValueOnce(makeOkResponse({ sha: 'new-tree-sha' }));
      // Create commit
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ sha: 'new-commit-sha', html_url: 'https://example.com/commit/new' }),
      );
      // Update ref
      mockFetch.mockResolvedValueOnce(makeOkResponse({ ref: 'refs/heads/my-branch' }));

      const { commitFiles } = await import('./client');
      const result = await commitFiles(
        [
          { path: 'src/a.ts', content: 'export const a = 1;' },
          { path: 'src/b.ts', content: 'export const b = 2;' },
        ],
        'feat: add files',
        'my-branch',
      );

      expect(result.sha).toBe('new-commit-sha');
      expect(result.url).toBe('https://example.com/commit/new');
    });

    it('lança erro quando API de criação de blob falha', async () => {
      mockInstallationToken();
      mockFetch.mockResolvedValueOnce(makeOkResponse({ object: { sha: 'head-sha' } }));
      mockFetch.mockResolvedValueOnce(makeOkResponse({ sha: 'head-sha', tree: { sha: 'tree-sha' } }));
      mockFetch.mockResolvedValueOnce(makeErrorResponse(422, 'Blob creation failed'));

      const { commitFiles } = await import('./client');
      await expect(
        commitFiles([{ path: 'file.ts', content: 'code' }], 'feat: test', 'my-branch'),
      ).rejects.toThrow('422');
    });
  });

  // ── createPullRequest ─────────────────────────────────────────────────────

  describe('createPullRequest', () => {
    it('cria pull request com sucesso', async () => {
      // Assinatura real: createPullRequest(title, body, headBranch, baseBranch?)
      // Sem baseBranch, chama getDefaultBranchSha (2 fetches: repo + ref)
      const prData = {
        number: 42,
        url: 'https://api.github.com/repos/owner/repo/pulls/42',
        html_url: 'https://github.com/owner/repo/pull/42',
      };

      mockInstallationToken();
      mockFetch.mockResolvedValueOnce(makeOkResponse({ default_branch: 'main' }));
      mockFetch.mockResolvedValueOnce(makeOkResponse({ object: { sha: 'main-sha' } }));
      mockFetch.mockResolvedValueOnce(makeOkResponse(prData));

      const { createPullRequest } = await import('./client');
      const result = await createPullRequest('[SCRUM-99] Título', 'Descrição do PR', 'feature-branch');

      expect(result.number).toBe(42);
      expect(result.html_url).toBe('https://github.com/owner/repo/pull/42');
    });

    it('lança erro quando PR já existe (422)', async () => {
      mockInstallationToken();
      mockFetch.mockResolvedValueOnce(makeOkResponse({ default_branch: 'main' }));
      mockFetch.mockResolvedValueOnce(makeOkResponse({ object: { sha: 'main-sha' } }));
      mockFetch.mockResolvedValueOnce(makeErrorResponse(422, 'PR already exists'));

      const { createPullRequest } = await import('./client');
      await expect(
        createPullRequest('[SCRUM-99] Título', 'Corpo', 'feature-branch'),
      ).rejects.toThrow('422');
    });
  });

  // ── Erros de configuração ─────────────────────────────────────────────────

  describe('erros de configuração de ambiente', () => {
    it('lança erro quando GITHUB_OWNER não está definido', async () => {
      delete process.env.GITHUB_OWNER;

      mockInstallationToken();

      const { readFile } = await import('./client');
      await expect(readFile('file.ts')).rejects.toThrow('GITHUB_OWNER');
    });

    it('lança erro quando GITHUB_REPO não está definido', async () => {
      delete process.env.GITHUB_REPO;

      mockInstallationToken();

      const { readFile } = await import('./client');
      await expect(readFile('file.ts')).rejects.toThrow('GITHUB_REPO');
    });

    it('lança erro quando GITHUB_APP_ID não está definido', async () => {
      delete process.env.GITHUB_APP_ID;

      const { readFile } = await import('./client');
      await expect(readFile('file.ts')).rejects.toThrow('GITHUB_APP_ID');
    });

    it('lança erro quando GITHUB_APP_PRIVATE_KEY não está definido', async () => {
      delete process.env.GITHUB_APP_PRIVATE_KEY;

      const { readFile } = await import('./client');
      await expect(readFile('file.ts')).rejects.toThrow('GITHUB_APP_PRIVATE_KEY');
    });

    it('lança erro quando GITHUB_APP_INSTALLATION_ID não está definido', async () => {
      delete process.env.GITHUB_APP_INSTALLATION_ID;

      const { readFile } = await import('./client');
      await expect(readFile('file.ts')).rejects.toThrow('GITHUB_APP_INSTALLATION_ID');
    });

    it('lança erro quando autenticação GitHub App falha (401)', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(401, 'Unauthorized'));

      const { readFile } = await import('./client');
      await expect(readFile('file.ts')).rejects.toThrow('401');
    });
  });

  // ── commitFile (compat) ───────────────────────────────────────────────────

  describe('commitFile', () => {
    it('cria commit de arquivo único com sucesso', async () => {
      // Assinatura real: commitFile(filePath, content, commitMessage, branch?)
      // Usa PUT /contents (não git data API): token + GET existente + PUT
      mockInstallationToken();
      // GET existing file → 404 (arquivo novo)
      mockFetch.mockResolvedValueOnce(makeErrorResponse(404));
      // PUT /contents/filePath → retorna { commit: { sha, html_url } }
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ commit: { sha: 'commit-sha', html_url: 'https://example.com' } }),
      );

      const { commitFile } = await import('./client');
      const result = await commitFile('src/file.ts', 'content here', 'feat: add', 'my-branch');

      expect(result.sha).toBe('commit-sha');
    });
  });
});
