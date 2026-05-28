import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('squadConfig', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    // limpa cache de módulo para cada teste
    Object.assign(process.env, ORIGINAL_ENV);
  });

  afterEach(() => {
    // restaura env original
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it('exporta config com defaults válidos', async () => {
    const { squadConfig } = await import('./squad.config');

    expect(squadConfig.jira.projectKey).toBe('SCRUM');
    expect(squadConfig.github.defaultBranch).toBe('main');
    expect(squadConfig.ci.coverageThreshold).toBe(85);
    expect(squadConfig.agents.devConcurrency).toBe(5);
    expect(squadConfig.agents.timeouts.ciMs).toBe(600_000);
    expect(squadConfig.agents.timeouts.agentMs).toBe(300_000);
    expect(squadConfig.agents.models.default).toBe('claude-sonnet-4-6');
    expect(squadConfig.agents.models.fast).toBe('claude-haiku-4-5-20251001');
  });

  it('statusMap padrão contém todos os 13 status do board', async () => {
    const { squadConfig } = await import('./squad.config');

    const expected = [
      'Backlog', 'A Refinar', 'Em Refinamento', 'Aguardando Aceite PRD',
      'PRD Aceito', 'Aguardando Aceite Plano', 'Plano Validado',
      'Em Desenvolvimento', 'Aguardando Aceite Dev', 'Em QA',
      'Aguardando Aceite QA', 'Validação Final', 'Concluído',
    ];

    for (const status of expected) {
      expect(squadConfig.jira.statusMap).toHaveProperty(status);
    }

    expect(Object.keys(squadConfig.jira.statusMap)).toHaveLength(13);
  });

  it('notifications são undefined quando env não está configurada', async () => {
    const { squadConfig } = await import('./squad.config');

    expect(squadConfig.notifications.onGateReached).toBeUndefined();
    expect(squadConfig.notifications.onError).toBeUndefined();
  });

  it('type inference: SquadConfig tem a forma correta', async () => {
    const { squadConfig } = await import('./squad.config');
    type Keys = keyof typeof squadConfig;

    const keys: Keys[] = ['jira', 'github', 'ci', 'agents', 'notifications'];
    for (const k of keys) {
      expect(squadConfig).toHaveProperty(k);
    }
  });
});
