import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock drizzle-orm db ───────────────────────────────────────────────────────

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  returning: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  execute: vi.fn(),
};

vi.mock('../db/index', () => ({
  db: mockDb,
}));

vi.mock('../lib/logger', () => ({
  childLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseStory = {
  id: 'uuid-1',
  jiraKey: 'SCRUM-1',
  jiraSummary: 'Minha história',
  jiraDescription: null,
  status: 'backlog' as const,
  jiraStatus: 'Backlog',
  metadata: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

// ─── findStoryByJiraKey ────────────────────────────────────────────────────────

describe('findStoryByJiraKey', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Reconfigura a cadeia de métodos após resetAllMocks
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockReturnThis();
    mockDb.returning.mockReturnThis();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
  });

  it('retorna story quando encontrada', async () => {
    mockDb.where.mockResolvedValueOnce([baseStory]);

    const { findStoryByJiraKey } = await import('./stories');
    const result = await findStoryByJiraKey('SCRUM-1');

    expect(result).toEqual(baseStory);
    expect(mockDb.select).toHaveBeenCalledOnce();
  });

  it('retorna null quando não encontrada', async () => {
    mockDb.where.mockResolvedValueOnce([]);

    const { findStoryByJiraKey } = await import('./stories');
    const result = await findStoryByJiraKey('SCRUM-999');

    expect(result).toBeNull();
  });

  it('propaga erro lançado pelo db', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('connection refused'));

    const { findStoryByJiraKey } = await import('./stories');
    await expect(findStoryByJiraKey('SCRUM-1')).rejects.toThrow('connection refused');
  });
});

// ─── upsertStory ──────────────────────────────────────────────────────────────

describe('upsertStory', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockReturnThis();
    mockDb.returning.mockReturnThis();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
  });

  it('retorna story existente upsertada (INSERT ON CONFLICT / update path)', async () => {
    mockDb.returning.mockResolvedValueOnce([baseStory]);

    const { upsertStory } = await import('./stories');
    const result = await upsertStory({
      jiraKey: 'SCRUM-1',
      jiraSummary: 'Minha história',
      jiraStatus: 'Backlog',
    });

    expect(result).toEqual(baseStory);
  });

  it('aceita upsert com todos os campos opcionais', async () => {
    const storyComTudo = {
      ...baseStory,
      jiraDescription: 'Descrição completa',
      metadata: { custom: true },
      status: 'em_desenvolvimento' as const,
    };
    mockDb.returning.mockResolvedValueOnce([storyComTudo]);

    const { upsertStory } = await import('./stories');
    const result = await upsertStory({
      jiraKey: 'SCRUM-1',
      jiraSummary: 'Minha história',
      jiraStatus: 'Em Desenvolvimento',
      jiraDescription: 'Descrição completa',
      status: 'em_desenvolvimento',
      metadata: { custom: true },
    });

    expect(result.jiraDescription).toBe('Descrição completa');
  });

  it('propaga erro do banco durante upsert', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('unique constraint'));

    const { upsertStory } = await import('./stories');
    await expect(
      upsertStory({ jiraKey: 'SCRUM-1', jiraSummary: 'X', jiraStatus: 'Backlog' }),
    ).rejects.toThrow('unique constraint');
  });
});

// ─── updateStoryStatus ────────────────────────────────────────────────────────

describe('updateStoryStatus', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockReturnThis();
    mockDb.returning.mockReturnThis();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
  });

  it('retorna story atualizada com novo status', async () => {
    const updated = { ...baseStory, status: 'em_desenvolvimento' as const };
    mockDb.returning.mockResolvedValueOnce([updated]);

    const { updateStoryStatus } = await import('./stories');
    const result = await updateStoryStatus('SCRUM-1', 'em_desenvolvimento');

    expect(result.status).toBe('em_desenvolvimento');
    expect(mockDb.update).toHaveBeenCalledOnce();
  });

  it('propaga erro quando story não encontrada (array vazio)', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const { updateStoryStatus } = await import('./stories');
    await expect(updateStoryStatus('SCRUM-999', 'concluido')).rejects.toThrow();
  });

  it('propaga erro do banco durante update', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('db error'));

    const { updateStoryStatus } = await import('./stories');
    await expect(updateStoryStatus('SCRUM-1', 'backlog')).rejects.toThrow('db error');
  });
});
