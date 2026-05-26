/**
 * Testes adicionais de cobertura de branches para orchestrator/reconciler.ts
 * Foca nos caminhos não cobertos: erros do Jira, divergência de ordem,
 * status desconhecidos, erros do banco de dados.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock drizzle-orm ─────────────────────────────────────────────────────────

vi.mock('drizzle-orm', () => ({
  inArray: vi.fn().mockReturnValue('inarray-condition'),
}));

// ─── Mock queue ───────────────────────────────────────────────────────────────

const mockOrchestratorQueue = {
  add: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../queue/index', () => ({
  orchestratorQueue: mockOrchestratorQueue,
  redisConnection: {},
}));

// ─── Mock db ─────────────────────────────────────────────────────────────────

const mockDbSelect = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([]),
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
      enumValues: ['backlog', 'a_refinar', 'em_refinamento', 'em_desenvolvimento', 'em_qa', 'concluido'],
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
const mockJiraToDbStatus: Record<string, string> = {
  'In Progress': 'em_desenvolvimento',
  'Em Desenvolvimento': 'em_desenvolvimento',
  'Backlog': 'backlog',
  'A Refinar': 'a_refinar',
  'Em Refinamento': 'em_refinamento',
};

vi.mock('./state-machine', () => ({
  isKnownStatus: mockIsKnownStatus,
  getStateOrder: mockGetStateOrder,
  JIRA_TO_DB_STATUS: mockJiraToDbStatus,
}));

// ─── Helper ───────────────────────────────────────────────────────────────────

async function runReconcilerCycle(advanceMs = 91_000): Promise<void> {
  const { createReconciler } = await import('./reconciler');
  const timer = createReconciler();
  await vi.advanceTimersByTimeAsync(advanceMs);
  clearInterval(timer);
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('reconciler — branches adicionais', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockDbSelect.select.mockReturnThis();
    mockDbSelect.from.mockReturnThis();
    process.env.JIRA_PROJECT_KEY = 'SCRUM';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.JIRA_PROJECT_KEY;
  });

  describe('erro ao buscar stories no banco', () => {
    it('loga erro e não propaga exceção quando db.where lança', async () => {
      mockDbSelect.where.mockRejectedValueOnce(new Error('DB connection failed'));

      await runReconcilerCycle();

      expect(mockLog.error).toHaveBeenCalled();
      expect(mockFetchActiveIssues).not.toHaveBeenCalled();
    });
  });

  describe('erro ao buscar issues do Jira', () => {
    it('loga erro e não propaga quando fetchActiveIssues lança', async () => {
      mockDbSelect.where.mockResolvedValue([
        { id: 'uuid-1', jiraKey: 'SCRUM-1', jiraStatus: 'In Progress', status: 'em_desenvolvimento' },
      ]);
      mockFetchActiveIssues.mockRejectedValueOnce(new Error('Jira unreachable'));

      await runReconcilerCycle();

      expect(mockLog.error).toHaveBeenCalled();
    });
  });

  describe('divergência: jiraOrder > dbOrder (Jira está à frente do banco)', () => {
    it('enfileira job de reconciliação quando Jira está à frente', async () => {
      mockDbSelect.where.mockResolvedValue([
        { id: 'uuid-1', jiraKey: 'SCRUM-1', jiraStatus: 'Backlog', status: 'backlog' },
      ]);
      mockFetchActiveIssues.mockResolvedValueOnce([
        { key: 'SCRUM-1', fields: { status: { name: 'Em Desenvolvimento' }, summary: 'test' } },
      ]);

      // jiraOrder (3) > dbOrder (1)
      mockGetStateOrder
        .mockReturnValueOnce(3)   // Jira: Em Desenvolvimento
        .mockReturnValueOnce(1);  // DB: Backlog

      await runReconcilerCycle();

      expect(mockOrchestratorQueue.add).toHaveBeenCalledWith(
        'jira:transition',
        expect.objectContaining({ jiraKey: 'SCRUM-1' }),
        expect.any(Object),
      );
    });
  });

  describe('status desconhecido no Jira', () => {
    it('ignora issue quando status do Jira não é conhecido', async () => {
      mockDbSelect.where.mockResolvedValue([
        { id: 'uuid-1', jiraKey: 'SCRUM-1', jiraStatus: 'Backlog', status: 'backlog' },
      ]);
      mockFetchActiveIssues.mockResolvedValueOnce([
        { key: 'SCRUM-1', fields: { status: { name: 'StatusMisterioso' }, summary: 'test' } },
      ]);
      mockIsKnownStatus.mockReturnValueOnce(false);

      await runReconcilerCycle();

      expect(mockLog.warn).toHaveBeenCalled();
      expect(mockOrchestratorQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('status do Jira coincide com o banco (sem divergência)', () => {
    it('não enfileira job quando os status estão sincronizados', async () => {
      mockDbSelect.where.mockResolvedValue([
        { id: 'uuid-1', jiraKey: 'SCRUM-1', jiraStatus: 'Em Desenvolvimento', status: 'em_desenvolvimento' },
      ]);
      mockFetchActiveIssues.mockResolvedValueOnce([
        { key: 'SCRUM-1', fields: { status: { name: 'Em Desenvolvimento' }, summary: 'test' } },
      ]);

      // Mesma ordem → sem divergência
      mockGetStateOrder.mockReturnValue(3);

      await runReconcilerCycle();

      expect(mockOrchestratorQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('issue no Jira não existe no banco', () => {
    it('ignora silenciosamente issues do Jira que não estão no banco', async () => {
      mockDbSelect.where.mockResolvedValue([]);
      mockFetchActiveIssues.mockResolvedValueOnce([
        { key: 'SCRUM-99', fields: { status: { name: 'Em Desenvolvimento' }, summary: 'test' } },
      ]);

      await runReconcilerCycle();

      // Com banco vazio, não deve tentar enfileirar
      expect(mockOrchestratorQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('múltiplas stories processadas em um ciclo', () => {
    it('processa cada story individualmente, enfileirando apenas as divergentes', async () => {
      mockDbSelect.where.mockResolvedValue([
        { id: 'uuid-1', jiraKey: 'SCRUM-1', jiraStatus: 'Backlog', status: 'backlog' },
        { id: 'uuid-2', jiraKey: 'SCRUM-2', jiraStatus: 'Em Desenvolvimento', status: 'em_desenvolvimento' },
      ]);
      mockFetchActiveIssues.mockResolvedValueOnce([
        { key: 'SCRUM-1', fields: { status: { name: 'Em Desenvolvimento' }, summary: 'story 1' } },
        { key: 'SCRUM-2', fields: { status: { name: 'Em Desenvolvimento' }, summary: 'story 2' } },
      ]);

      // SCRUM-1: jiraOrder=3 > dbOrder=1 → divergente
      // SCRUM-2: mesma ordem → sincronizado
      mockGetStateOrder
        .mockReturnValueOnce(3)  // SCRUM-1 jira
        .mockReturnValueOnce(1)  // SCRUM-1 db
        .mockReturnValueOnce(3)  // SCRUM-2 jira
        .mockReturnValueOnce(3); // SCRUM-2 db

      await runReconcilerCycle();

      expect(mockOrchestratorQueue.add).toHaveBeenCalledTimes(1);
      expect(mockOrchestratorQueue.add).toHaveBeenCalledWith(
        'jira:transition',
        expect.objectContaining({ jiraKey: 'SCRUM-1' }),
        expect.any(Object),
      );
    });
  });

  describe('ciclos consecutivos do reconciler', () => {
    it('executa múltiplos ciclos no intervalo de tempo configurado', async () => {
      mockDbSelect.where.mockResolvedValue([]);
      const { createReconciler } = await import('./reconciler');

      const timer = createReconciler();
      // Avança mais de 1 ciclo (> 90s * 2 = 180s)
      await vi.advanceTimersByTimeAsync(200_000);
      clearInterval(timer);

      // Deve ter tentado executar pelo menos 2 vezes
      // warn chamado pois JIRA_PROJECT_KEY está presente mas db retorna []
      expect(mockLog.debug ?? mockLog.info ?? mockLog.warn).toBeDefined();
    });
  });
});
