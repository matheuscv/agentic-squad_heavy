import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock global fetch ─────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOkResponse(body: unknown, status = 200) {
  return {
    ok: true,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

function makeErrorResponse(status: number, body = 'error') {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(body),
  };
}

function make204Response() {
  return {
    ok: true,
    status: 204,
    json: vi.fn(),
    text: vi.fn(),
  };
}

// ─── Env vars ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  process.env.JIRA_EMAIL = 'test@example.com';
  process.env.JIRA_API_TOKEN = 'test-token';
  process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
});

afterEach(() => {
  delete process.env.JIRA_EMAIL;
  delete process.env.JIRA_API_TOKEN;
  delete process.env.JIRA_BASE_URL;
});

// ─── Importação dinâmica após env estar configurado ────────────────────────────

async function importClient() {
  return await import('./client');
}

// ─── getIssue ─────────────────────────────────────────────────────────────────

describe('getIssue', () => {
  it('retorna issue com campos esperados', async () => {
    const mockIssue = {
      id: '10001',
      key: 'SCRUM-1',
      fields: {
        summary: 'Minha história',
        description: null,
        status: { id: '3', name: 'Em Desenvolvimento' },
      },
    };
    mockFetch.mockResolvedValueOnce(makeOkResponse(mockIssue));

    const { getIssue } = await importClient();
    const result = await getIssue('SCRUM-1');

    expect(result).toEqual(mockIssue);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/rest/api/3/issue/SCRUM-1');
    expect(url).toContain('fields=summary,status,description');
    expect(opts.headers['Authorization']).toMatch(/^Basic /);
  });

  it('lança erro quando a API retorna status não-ok', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(404, 'Issue not found'));

    const { getIssue } = await importClient();
    await expect(getIssue('SCRUM-999')).rejects.toThrow('404');
  });

  it('lança erro quando JIRA_EMAIL não está definido', async () => {
    delete process.env.JIRA_EMAIL;

    const { getIssue } = await importClient();
    await expect(getIssue('SCRUM-1')).rejects.toThrow('JIRA_EMAIL');
  });

  it('lança erro quando JIRA_API_TOKEN não está definido', async () => {
    delete process.env.JIRA_API_TOKEN;

    const { getIssue } = await importClient();
    await expect(getIssue('SCRUM-1')).rejects.toThrow('JIRA_API_TOKEN');
  });

  it('lança erro quando JIRA_BASE_URL não está definido', async () => {
    delete process.env.JIRA_BASE_URL;

    const { getIssue } = await importClient();
    await expect(getIssue('SCRUM-1')).rejects.toThrow('JIRA_BASE_URL');
  });

  it('remove trailing slash da JIRA_BASE_URL', async () => {
    process.env.JIRA_BASE_URL = 'https://example.atlassian.net/';
    const mockIssue = {
      id: '10001', key: 'SCRUM-1',
      fields: { summary: 'Test', description: null, status: { id: '1', name: 'Backlog' } },
    };
    mockFetch.mockResolvedValueOnce(makeOkResponse(mockIssue));

    const { getIssue } = await importClient();
    await getIssue('SCRUM-1');

    const [url] = mockFetch.mock.calls[0];
    expect(url).not.toContain('//rest');
    expect(url).toContain('/rest/api/3/issue/SCRUM-1');
  });
});

// ─── getTransitions ───────────────────────────────────────────────────────────

describe('getTransitions', () => {
  it('retorna array de transições', async () => {
    const mockTransitions = {
      transitions: [
        { id: '21', name: 'Em Refinamento', to: { id: '3', name: 'Em Refinamento' } },
        { id: '31', name: 'Concluído', to: { id: '10', name: 'Concluído' } },
      ],
    };
    mockFetch.mockResolvedValueOnce(makeOkResponse(mockTransitions));

    const { getTransitions } = await importClient();
    const result = await getTransitions('SCRUM-1');

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Em Refinamento');
  });

  it('lança erro quando API falha', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(500, 'Internal Server Error'));

    const { getTransitions } = await importClient();
    await expect(getTransitions('SCRUM-1')).rejects.toThrow('500');
  });
});

// ─── transitionIssue ──────────────────────────────────────────────────────────

describe('transitionIssue', () => {
  it('faz POST com transition.id correto e retorna undefined (204)', async () => {
    mockFetch.mockResolvedValueOnce(make204Response());

    const { transitionIssue } = await importClient();
    const result = await transitionIssue('SCRUM-1', '21');

    expect(result).toBeUndefined();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/rest/api/3/issue/SCRUM-1/transitions');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.transition.id).toBe('21');
  });

  it('lança erro quando API retorna erro', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(400, 'Bad Request'));

    const { transitionIssue } = await importClient();
    await expect(transitionIssue('SCRUM-1', '999')).rejects.toThrow('400');
  });
});

// ─── addComment ───────────────────────────────────────────────────────────────

describe('addComment', () => {
  it('faz POST com body ADF correto', async () => {
    mockFetch.mockResolvedValueOnce(make204Response());

    const { addComment } = await importClient();
    await addComment('SCRUM-1', 'Meu comentário');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/rest/api/3/issue/SCRUM-1/comment');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.body.type).toBe('doc');
    expect(body.body.content[0].content[0].text).toBe('Meu comentário');
  });

  it('lança erro quando API falha', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(403, 'Forbidden'));

    const { addComment } = await importClient();
    await expect(addComment('SCRUM-1', 'teste')).rejects.toThrow('403');
  });
});

// ─── transitionIssueByName ────────────────────────────────────────────────────

describe('transitionIssueByName', () => {
  it('resolve transitionId pelo nome e executa a transição', async () => {
    const mockTransitions = {
      transitions: [
        { id: '21', name: 'Em Refinamento', to: { id: '3', name: 'Em Refinamento' } },
      ],
    };
    // Primeiro fetch: getTransitions; segundo fetch: transitionIssue
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(mockTransitions))
      .mockResolvedValueOnce(make204Response());

    const { transitionIssueByName } = await importClient();
    await transitionIssueByName('SCRUM-1', 'Em Refinamento');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [, opts] = mockFetch.mock.calls[1];
    const body = JSON.parse(opts.body);
    expect(body.transition.id).toBe('21');
  });

  it('lança erro quando a transição desejada não está disponível', async () => {
    const mockTransitions = {
      transitions: [
        { id: '21', name: 'Em Refinamento', to: { id: '3', name: 'Em Refinamento' } },
      ],
    };
    mockFetch.mockResolvedValueOnce(makeOkResponse(mockTransitions));

    const { transitionIssueByName } = await importClient();
    await expect(transitionIssueByName('SCRUM-1', 'Status Inexistente')).rejects.toThrow(
      'Status Inexistente',
    );
  });
});
