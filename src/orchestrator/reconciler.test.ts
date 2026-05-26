import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock drizzle-orm ─────────────────────────────────────────────────────────

vi.mock('drizzle-orm', () => ({
  inArray: vi.fn().mockReturnValue('inarray-condition'),
}));

// ─── Mock db ──────────────────────────────────────────────────────────────────

const mockOrchestratorQueue = {
  add: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../queue/index', () => ({
  orchestratorQueue: mockOrchestratorQueue,
  redisConnection: {},
}));

const mockDbSelect = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
};
vi.mock('../db/index', () => ({
  db: mockDbSelect,
  schema: {
    stories: {
      id: 'id',
      jiraKey: 'jiraKey',
      jiraStatus: 'jiraStatus',
      status: 'status',
    },
    storyStatusEnum: {
      enumValues: ['backlog', 'a_refinar', 'em_desenvolvimento'],
    },
  },
}));

// ─── Mock jira/client ─────────────────────────────────────────────────────────

const mockFetchActiveIssues = vi.fn();
vi.mock('../jira/client', () => ({
  fetchActiveIssues: mockFetchActiveIssues,
}));

// ─── Mock logger ──────────────────────────────────────────────────────────────

const mockLog = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};
vi.mock('../lib/logger', () => ({
  childLogger: vi.fn().mockReturnValue(mockLog),
}));

// ─── Mock state-machine ───────────────────────────────────────────────────────

const mockIsKnownStatus = vi.fn().mockReturnValue(true);
const mockGetStateOrder = vi.fn();
const mockJiraToDbStatus = {
  'In Progress': 'em_desenvolvimento',
  'Em Desenvolvimento': 'em_desenvolvimento',
  'Backlog': 'backlog',
  'Em Refinamento': 'em_refinamento',
};

vi.mock('./state-machine', () => ({
  isKnownStatus: mockIsKnownStatus,
  getStateOrder: mockGetStateOrder,
  JIRA_TO_DB_STATUS: mockJiraToDbStatus,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const dbStories = [
  {
    id: 'uuid-1',
    jiraKey: 'SCRUM-1',
    jiraStatus: 'In Progress',
    status: 'em_desenvolvimento',
  },
  {
    id: 'uuid-2',
    jiraKey: 'SCRUM-2',
    jiraStatus: 'Em Refinamento',
    status: 'em_refinamento',
  },
];

// ─── Suite ────────────────────────────────────────────────────────────────────

// Helper: cria reconciler, avança timers e limpa
async function runReconcilerCycle(advanceMs = 91_000): Promise<ReturnType<typeof clearInterval>> {
  const { createReconciler } = await import('./reconciler');
  const timer = createReconciler();
  await vi.advanceTimersByTimeAsync(advanceMs);
  clearInterval(timer);
  return timer;
}

describe('reconciler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Configura a cadeia do db
    mockDbSelect.select.mockReturnThis();
    mockDbSelect.from.mockReturnThis();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.JIRA_PROJECT_KEY;
  });

  describe('createReconciler', () => {
    it('retorna NodeJS.Timeout ao ser criado', async () => {
      mockDbSelect.where.mockResolvedValue([]);
      const { createReconciler } = await import('./reconciler');
      const timer = createReconciler();
      expect(timer).toBeDefined();
      clearInterval(timer);
    });
  });

  describe('ciclo de reconciliação', () => {
    it('ignora ciclo quando JIRA_PROJECT_KEY não está definido', async () => {
      delete process.env.JIRA_PROJECT_KEY;
      mockDbSelect.where.mockResolvedValue([]);

      await runReconcilerCycle();

      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('JIRA_PROJECT_KEY'),
      );
    });

    it('encerra ciclo quando não há stories em andamento', async () => {
      process.env.JIRA_PROJECT_KEY = 'SCRUM';
      mockDbSelect.where.mockResolvedValue([]);

      await runReconcilerCycle();

      expect(mockFetchActiveIssues).not.toHaveBeenCalled();
      expect(mockLog.debug).toHaveBeenCalledWith(
        expect.stringContaining('nenhuma story'),
      );
    });

    it('reenfileira story quando Jira está à frente do banco', async () => {
      process.env.JIRA_PROJECT_KEY = 'SCRUM';

      const storyAhead = [{ ...dbStories[0], jiraStatus: 'In Progress' }];
      const jiraAhead = [
        {
          id: '10001',
          key: 'SCRUM-1',
          fields: { summary: 'História 1', status: { name: 'Em Desenvolvimento' } },
        },
      ];

      mockDbSelect.where.mockResolvedValue(storyAhead);
      mockFetchActiveIssues.mockResolvedValue(jiraAhead);

      mockGetStateOrder.mockImplementation((status: string) => {
        if (status === 'In Progress') return 2;
        if (status === 'Em Desenvolvimento') return 3;
        return 0;
      });
      mockIsKnownStatus.mockReturnValue(true);

      await runReconcilerCycle();

      expect(mockOrchestratorQueue.add).toHaveBeenCalledWith(
        'jira:transition',
        expect.objectContaining({ jiraKey: 'SCRUM-1' }),
        expect.any(Object),
      );
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.objectContaining({ jiraKey: 'SCRUM-1' }),
        expect.stringContaining('divergência'),
      );
    });

    it('loga warn quando banco está à frente do Jira', async () => {
      process.env.JIRA_PROJECT_KEY = 'SCRUM';

      const storyDbAhead = [{ ...dbStories[0], jiraStatus: 'Em Desenvolvimento' }];
      const jiraBehind = [
        {
          id: '10001',
          key: 'SCRUM-1',
          fields: { summary: 'História 1', status: { name: 'In Progress' } },
        },
      ];

      mockDbSelect.where.mockResolvedValue(storyDbAhead);
      mockFetchActiveIssues.mockResolvedValue(jiraBehind);

      mockGetStateOrder.mockImplementation((status: string) => {
        if (status === 'Em Desenvolvimento') return 3;
        if (status === 'In Progress') return 2;
        return 0;
      });
      mockIsKnownStatus.mockReturnValue(true);

      await runReconcilerCycle();

      expect(mockOrchestratorQueue.add).not.toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('banco à frente'),
      );
    });

    it('loga warn para status Jira desconhecido', async () => {
      process.env.JIRA_PROJECT_KEY = 'SCRUM';

      const story = [{ ...dbStories[0], jiraStatus: 'In Progress' }];
      const jiraUnknown = [
        {
          id: '10001',
          key: 'SCRUM-1',
          fields: { summary: 'História 1', status: { name: 'Unknown Status XYZ' } },
        },
      ];

      mockDbSelect.where.mockResolvedValue(story);
      mockFetchActiveIssues.mockResolvedValue(jiraUnknown);
      mockGetStateOrder.mockReturnValue(0);
      mockIsKnownStatus.mockReturnValue(false);

      await runReconcilerCycle();

      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Unknown Status XYZ' }),
        expect.stringContaining('desconhecido'),
      );
    });

    it('loga error e interrompe ciclo quando fetchActiveIssues falha', async () => {
      process.env.JIRA_PROJECT_KEY = 'SCRUM';

      mockDbSelect.where.mockResolvedValue([dbStories[0]]);
      mockFetchActiveIssues.mockRejectedValue(new Error('Jira unreachable'));

      await runReconcilerCycle();

      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: 'Jira unreachable' }),
        expect.stringContaining('falha'),
      );
      expect(mockOrchestratorQueue.add).not.toHaveBeenCalled();
    });

    it('ignora story sem correspondência no Jira (resolvida ou em backlog)', async () => {
      process.env.JIRA_PROJECT_KEY = 'SCRUM';

      mockDbSelect.where.mockResolvedValue([dbStories[0]]);
      mockFetchActiveIssues.mockResolvedValue([]);

      await runReconcilerCycle();

      expect(mockOrchestratorQueue.add).not.toHaveBeenCalled();
      expect(mockLog.debug).toHaveBeenCalledWith(
        expect.objectContaining({ jiraKey: 'SCRUM-1' }),
        expect.stringContaining('concluída ou backlog'),
      );
    });

    it('não reenfileira quando status Jira e banco são iguais', async () => {
      process.env.JIRA_PROJECT_KEY = 'SCRUM';

      mockDbSelect.where.mockResolvedValue([dbStories[0]]);
      mockFetchActiveIssues.mockResolvedValue([
        {
          id: '10001',
          key: 'SCRUM-1',
          fields: { summary: 'História 1', status: { name: 'In Progress' } },
        },
      ]);

      await runReconcilerCycle();

      expect(mockOrchestratorQueue.add).not.toHaveBeenCalled();
    });
  });
});
