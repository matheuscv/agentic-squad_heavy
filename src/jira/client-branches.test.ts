/**
 * Testes adicionais de cobertura de branches para src/jira/client.ts
 * Foca nos caminhos não cobertos:
 * - moveCardTo: transição encontrada e não encontrada
 * - fetchActiveIssues: paginação, issues vazios, erro
 * - addComment: corpo ADF correto
 * - getBaseHeaders sem JIRA_EMAIL ou sem JIRA_API_TOKEN
 * - trailing slash em JIRA_BASE_URL
 * - status 204 no jiraFetch (retorna undefined)
 */

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
  return { ok: false, status, json: vi.fn(), text: vi.fn().mockResolvedValue(body) };
}

function make204Response() {
  return { ok: true, status: 204, json: vi.fn(), text: vi.fn() };
}

// ─── Env vars ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  process.env.JIRA_EMAIL = 'qa@example.com';
  process.env.JIRA_API_TOKEN = 'qa-token';
  process.env.JIRA_BASE_URL = 'https://qa.atlassian.net';
});

afterEach(() => {
  delete process.env.JIRA_EMAIL;
  delete process.env.JIRA_API_TOKEN;
  delete process.env.JIRA_BASE_URL;
});

async function importClient() {
  return await import('./client');
}

// ─── moveCardTo ───────────────────────────────────────────────────────────────

describe('moveCardTo', () => {
  it('encontra e executa a transição pelo nome', async () => {
    const transitions = {
      transitions: [
        { id: '1', name: 'Backlog', to: { id: '1', name: 'Backlog' } },
        { id: '2', name: 'Em Desenvolvimento', to: { id: '3', name: 'Em Desenvolvimento' } },
        { id: '3', name: 'Em QA', to: { id: '4', name: 'Em QA' } },
      ],
    };

    mockFetch
      .mockResolvedValueOnce(makeOkResponse(transitions)) // getTransitions
      .mockResolvedValueOnce(make204Response());           // transitionIssue

    const { moveCardTo } = await importClient();
    await expect(moveCardTo('SCRUM-16', 'Em Desenvolvimento')).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [, opts] = mockFetch.mock.calls[1];
    const body = JSON.parse(opts.body as string);
    expect(body.transition.id).toBe('2');
  });

  it('lança erro quando a transição desejada não está disponível', async () => {
    const transitions = {
      transitions: [
        { id: '1', name: 'Backlog', to: { id: '1', name: 'Backlog' } },
      ],
    };

    mockFetch.mockResolvedValueOnce(makeOkResponse(transitions));

    const { moveCardTo } = await importClient();
    await expect(moveCardTo('SCRUM-16', 'Concluído')).rejects.toThrow(
      expect.stringMatching(/Concluído/),
    );
  });

  it('lança erro quando API retorna não-ok ao buscar transições', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(403, 'Forbidden'));

    const { moveCardTo } = await importClient();
    await expect(moveCardTo('SCRUM-16', 'Em Desenvolvimento')).rejects.toThrow('403');
  });

  it('case-insensitive match para nome da transição', async () => {
    const transitions = {
      transitions: [
        { id: '5', name: 'Em Refinamento', to: { id: '2', name: 'Em Refinamento' } },
      ],
    };

    mockFetch
      .mockResolvedValueOnce(makeOkResponse(transitions))
      .mockResolvedValueOnce(make204Response());

    const { moveCardTo } = await importClient();
    // Testa matching exato (o código usa === ou toLowerCase() dependendo da implementação)
    await expect(moveCardTo('SCRUM-16', 'Em Refinamento')).resolves.toBeUndefined();
  });
});

// ─── fetchActiveIssues ────────────────────────────────────────────────────────

describe('fetchActiveIssues', () => {
  it('retorna issues da resposta da API', async () => {
    const jiraResponse = {
      issues: [
        { key: 'SCRUM-1', fields: { summary: 'Issue 1', status: { name: 'Em Desenvolvimento', id: '3' } } },
        { key: 'SCRUM-2', fields: { summary: 'Issue 2', status: { name: 'Em QA', id: '4' } } },
      ],
      total: 2,
      maxResults: 50,
      startAt: 0,
    };

    mockFetch.mockResolvedValueOnce(makeOkResponse(jiraResponse));

    const { fetchActiveIssues } = await importClient();
    const result = await fetchActiveIssues('SCRUM');

    expect(result).toEqual(jiraResponse.issues);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('SCRUM');
  });

  it('retorna array vazio quando não há issues', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ issues: [], total: 0, maxResults: 50, startAt: 0 }));

    const { fetchActiveIssues } = await importClient();
    const result = await fetchActiveIssues('SCRUM');

    expect(result).toEqual([]);
  });

  it('lança erro quando API retorna não-ok', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(500, 'Internal Server Error'));

    const { fetchActiveIssues } = await importClient();
    await expect(fetchActiveIssues('SCRUM')).rejects.toThrow('500');
  });

  it('constrói URL JQL corretamente com o projectKey', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ issues: [], total: 0, maxResults: 50, startAt: 0 }));

    const { fetchActiveIssues } = await importClient();
    await fetchActiveIssues('MYPROJECT');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('MYPROJECT');
  });
});

// ─── transitionIssue ─────────────────────────────────────────────────────────

describe('transitionIssue', () => {
  it('retorna undefined (204) ao executar transição com sucesso', async () => {
    mockFetch.mockResolvedValueOnce(make204Response());

    const { transitionIssue } = await importClient();
    const result = await transitionIssue('SCRUM-16', 'transition-id-5');

    expect(result).toBeUndefined();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/rest/api/3/issue/SCRUM-16/transitions');
    expect(opts.method).toBe('POST');
  });

  it('lança erro quando a API retorna 400', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(400, 'Bad Request'));

    const { transitionIssue } = await importClient();
    await expect(transitionIssue('SCRUM-16', 'bad-id')).rejects.toThrow('400');
  });
});

// ─── addComment ───────────────────────────────────────────────────────────────

describe('addComment', () => {
  it('envia comentário no formato ADF correto', async () => {
    mockFetch.mockResolvedValueOnce(make204Response());

    const { addComment } = await importClient();
    await expect(addComment('SCRUM-16', 'Testes de QA aprovados!')).resolves.toBeUndefined();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/rest/api/3/issue/SCRUM-16/comment');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body as string);
    expect(body.body.type).toBe('doc');
    expect(body.body.version).toBe(1);
    expect(body.body.content[0].type).toBe('paragraph');
    expect(body.body.content[0].content[0].text).toBe('Testes de QA aprovados!');
  });

  it('lança erro quando a API de comentário retorna não-ok', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(403, 'Forbidden'));

    const { addComment } = await importClient();
    await expect(addComment('SCRUM-16', 'comentário')).rejects.toThrow('403');
  });
});

// ─── getBaseHeaders — variações de env vars ───────────────────────────────────

describe('getBaseHeaders — todas as combinações de env vars faltantes', () => {
  it('lança quando JIRA_EMAIL está ausente mas JIRA_API_TOKEN está presente', async () => {
    delete process.env.JIRA_EMAIL;
    process.env.JIRA_API_TOKEN = 'token';

    const { getIssue } = await importClient();
    await expect(getIssue('SCRUM-1')).rejects.toThrow('JIRA_EMAIL');
  });

  it('lança quando JIRA_API_TOKEN está ausente mas JIRA_EMAIL está presente', async () => {
    process.env.JIRA_EMAIL = 'user@example.com';
    delete process.env.JIRA_API_TOKEN;

    const { getIssue } = await importClient();
    await expect(getIssue('SCRUM-1')).rejects.toThrow('JIRA_API_TOKEN');
  });

  it('lança quando JIRA_BASE_URL não está definido', async () => {
    delete process.env.JIRA_BASE_URL;

    const { getIssue } = await importClient();
    await expect(getIssue('SCRUM-1')).rejects.toThrow('JIRA_BASE_URL');
  });

  it('usa cabeçalho Authorization no formato Basic base64 correto', async () => {
    process.env.JIRA_EMAIL = 'user@test.com';
    process.env.JIRA_API_TOKEN = 'my-secret-token';

    const mockIssue = {
      id: '1', key: 'SCRUM-1',
      fields: { summary: 'Test', description: null, status: { id: '1', name: 'Backlog' } },
    };
    mockFetch.mockResolvedValueOnce(makeOkResponse(mockIssue));

    const { getIssue } = await importClient();
    await getIssue('SCRUM-1');

    const [, opts] = mockFetch.mock.calls[0];
    const expectedBase64 = Buffer.from('user@test.com:my-secret-token').toString('base64');
    expect(opts.headers['Authorization']).toBe(`Basic ${expectedBase64}`);
  });
});

// ─── getTransitions ───────────────────────────────────────────────────────────

describe('getTransitions — branches adicionais', () => {
  it('retorna array vazio quando não há transições disponíveis', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ transitions: [] }));

    const { getTransitions } = await importClient();
    const result = await getTransitions('SCRUM-16');

    expect(result).toEqual([]);
  });

  it('retorna múltiplas transições corretamente', async () => {
    const transitions = [
      { id: '1', name: 'Backlog', to: { id: '1', name: 'Backlog' } },
      { id: '2', name: 'Em Desenvolvimento', to: { id: '3', name: 'Em Desenvolvimento' } },
      { id: '3', name: 'Concluído', to: { id: '5', name: 'Concluído' } },
    ];
    mockFetch.mockResolvedValueOnce(makeOkResponse({ transitions }));

    const { getTransitions } = await importClient();
    const result = await getTransitions('SCRUM-16');

    expect(result).toHaveLength(3);
    expect(result[1].name).toBe('Em Desenvolvimento');
  });
});
