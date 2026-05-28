import { describe, it, expect } from 'vitest';
import {
  parseCommit,
  parseGitLog,
  determineVersionBump,
  groupCommits,
  formatChangelogEntry,
  upsertChangelog,
} from './changelog';

// ─── parseCommit ─────────────────────────────────────────────────────────────

describe('parseCommit', () => {
  const H = 'abc1234def5678';

  it('analisa feat simples', () => {
    const c = parseCommit(H, 'feat: adiciona endpoint de métricas');
    expect(c.type).toBe('feat');
    expect(c.scope).toBeUndefined();
    expect(c.breaking).toBe(false);
    expect(c.subject).toBe('adiciona endpoint de métricas');
    expect(c.shortHash).toBe('abc1234');
  });

  it('analisa feat com scope', () => {
    const c = parseCommit(H, 'feat(api): novo endpoint POST /webhooks');
    expect(c.type).toBe('feat');
    expect(c.scope).toBe('api');
    expect(c.subject).toBe('novo endpoint POST /webhooks');
  });

  it('detecta breaking change via "!"', () => {
    const c = parseCommit(H, 'feat!: remove suporte à API v1');
    expect(c.breaking).toBe(true);
    expect(c.type).toBe('feat');
  });

  it('detecta breaking change via scope + "!"', () => {
    const c = parseCommit(H, 'refactor(db)!: renomeia coluna jira_key');
    expect(c.breaking).toBe(true);
    expect(c.scope).toBe('db');
  });

  it('detecta BREAKING CHANGE no subject', () => {
    const c = parseCommit(H, 'feat: BREAKING CHANGE: migra autenticação para OAuth2');
    expect(c.breaking).toBe(true);
  });

  it('analisa fix', () => {
    const c = parseCommit(H, 'fix(webhook): corrige validação de secret');
    expect(c.type).toBe('fix');
    expect(c.scope).toBe('webhook');
  });

  it('analisa chore, ci, docs', () => {
    expect(parseCommit(H, 'chore: atualiza dependências').type).toBe('chore');
    expect(parseCommit(H, 'ci: adiciona step de cobertura').type).toBe('ci');
    expect(parseCommit(H, 'docs: atualiza README').type).toBe('docs');
  });

  it('classifica como unknown quando não é conventional', () => {
    const c = parseCommit(H, 'WIP: trabalho em progresso');
    expect(c.type).toBe('unknown');
    expect(c.subject).toBe('WIP: trabalho em progresso');
  });

  it('classifica como unknown tipo desconhecido', () => {
    const c = parseCommit(H, 'wip: algo');
    expect(c.type).toBe('unknown');
  });

  it('shortHash tem 7 caracteres', () => {
    const c = parseCommit('abcdef1234567890', 'feat: test');
    expect(c.shortHash).toHaveLength(7);
    expect(c.shortHash).toBe('abcdef1');
  });
});

// ─── parseGitLog ─────────────────────────────────────────────────────────────

describe('parseGitLog', () => {
  it('analisa output com tab como separador', () => {
    const output = [
      'abc1234def5678\tfeat: nova funcionalidade',
      'bcd2345ef67890\tfix: corrige bug crítico',
      'cde3456f789012\tchore: lint',
    ].join('\n');

    const commits = parseGitLog(output);
    expect(commits).toHaveLength(3);
    expect(commits[0]!.type).toBe('feat');
    expect(commits[1]!.type).toBe('fix');
    expect(commits[2]!.type).toBe('chore');
  });

  it('ignora linhas vazias', () => {
    const output = '\nabc1234def5678\tfeat: algo\n\n';
    expect(parseGitLog(output)).toHaveLength(1);
  });

  it('ignora linhas sem tab', () => {
    const output = 'linha sem tab\nabc1234def5678\tfeat: algo';
    expect(parseGitLog(output)).toHaveLength(1);
  });

  it('retorna array vazio para output vazio', () => {
    expect(parseGitLog('')).toHaveLength(0);
    expect(parseGitLog('\n\n\n')).toHaveLength(0);
  });
});

// ─── determineVersionBump ────────────────────────────────────────────────────

describe('determineVersionBump', () => {
  const makeCommit = (type: string, breaking = false) =>
    parseCommit('abc1234567890', breaking ? `${type}!: algo` : `${type}: algo`);

  it('major quando há breaking change', () => {
    expect(determineVersionBump([makeCommit('feat', true)])).toBe('major');
  });

  it('major mesmo que seja apenas fix breaking', () => {
    expect(determineVersionBump([makeCommit('fix', true)])).toBe('major');
  });

  it('minor quando há feat sem breaking', () => {
    expect(determineVersionBump([makeCommit('feat'), makeCommit('fix')])).toBe('minor');
  });

  it('patch quando há fix sem feat', () => {
    expect(determineVersionBump([makeCommit('fix'), makeCommit('perf')])).toBe('patch');
  });

  it('patch para refactor sem feat', () => {
    expect(determineVersionBump([makeCommit('refactor')])).toBe('patch');
  });

  it('none para apenas chore/docs/test/ci', () => {
    expect(determineVersionBump([
      makeCommit('chore'), makeCommit('docs'), makeCommit('test'), makeCommit('ci'),
    ])).toBe('none');
  });

  it('none para lista vazia', () => {
    expect(determineVersionBump([])).toBe('none');
  });

  it('major tem prioridade sobre feat', () => {
    expect(determineVersionBump([makeCommit('feat'), makeCommit('fix', true)])).toBe('major');
  });
});

// ─── groupCommits ─────────────────────────────────────────────────────────────

describe('groupCommits', () => {
  const c = (type: string, breaking = false) =>
    parseCommit('abc1234567890', breaking ? `${type}!: algo` : `${type}: algo`);

  it('breaking changes aparecem como primeira seção', () => {
    const sections = groupCommits([c('fix', true), c('feat'), c('fix')]);
    expect(sections[0]!.label).toContain('BREAKING');
    expect(sections[0]!.commits).toHaveLength(1);
  });

  it('feat aparece antes de fix', () => {
    const sections = groupCommits([c('fix'), c('feat')]);
    const labels = sections.map((s) => s.label);
    expect(labels.indexOf('Novas Funcionalidades')).toBeLessThan(
      labels.indexOf('Correções de Bugs'),
    );
  });

  it('commits unknown não aparecem', () => {
    const sections = groupCommits([c('feat'), parseCommit('abc1234567890', 'WIP')]);
    expect(sections.every((s) => !s.label.includes('unknown'))).toBe(true);
  });

  it('retorna array vazio para lista vazia', () => {
    expect(groupCommits([])).toHaveLength(0);
  });

  it('commits breaking não duplicam na seção de tipo', () => {
    const commits = [c('feat', true), c('feat')];
    const sections = groupCommits(commits);
    const breaking = sections.find((s) => s.label.includes('BREAKING'));
    const feats    = sections.find((s) => s.label === 'Novas Funcionalidades');
    expect(breaking?.commits).toHaveLength(1);
    expect(feats?.commits).toHaveLength(1); // feat não-breaking
  });
});

// ─── formatChangelogEntry ─────────────────────────────────────────────────────

describe('formatChangelogEntry', () => {
  const commits = [
    parseCommit('abc1234567890', 'feat(api): novo endpoint'),
    parseCommit('bcd2345678901', 'fix: corrige timeout'),
    parseCommit('cde3456789012', 'chore: atualiza deps'),
  ];

  it('inclui versão e data no header', () => {
    const entry = formatChangelogEntry('1.2.0', '2026-05-28', commits);
    expect(entry).toContain('[1.2.0]');
    expect(entry).toContain('2026-05-28');
  });

  it('inclui shortHash de cada commit', () => {
    const entry = formatChangelogEntry('1.0.0', '2026-05-28', commits);
    expect(entry).toContain('`abc1234`');
    expect(entry).toContain('`bcd2345`');
  });

  it('inclui scope em negrito', () => {
    const entry = formatChangelogEntry('1.0.0', '2026-05-28', commits);
    expect(entry).toContain('**api**:');
  });

  it('retorna string vazia para commits sem seções visíveis', () => {
    const unknownOnly = [parseCommit('abc1234567890', 'WIP trabalho')];
    expect(formatChangelogEntry('1.0.0', '2026-05-28', unknownOnly)).toBe('');
  });
});

// ─── upsertChangelog ──────────────────────────────────────────────────────────

describe('upsertChangelog', () => {
  const entry = '## [1.0.0] — 2026-05-28\n\n### Novas Funcionalidades\n\n- feat: algo (`abc1234`)';

  it('cria arquivo do zero quando não há conteúdo existente', () => {
    const result = upsertChangelog(null, entry);
    expect(result).toContain('# Changelog');
    expect(result).toContain('[Unreleased]');
    expect(result).toContain('[1.0.0]');
  });

  it('insere nova entrada após [Unreleased]', () => {
    const existing = '# Changelog\n\n## [Unreleased]\n\n## [0.9.0] — 2026-01-01\n\n- old entry';
    const result = upsertChangelog(existing, entry);
    const v1Idx   = result.indexOf('[1.0.0]');
    const v09Idx  = result.indexOf('[0.9.0]');
    expect(v1Idx).toBeGreaterThan(-1);
    expect(v1Idx).toBeLessThan(v09Idx);
  });

  it('preserva entradas anteriores', () => {
    const existing = '# Changelog\n\n## [Unreleased]\n\n## [0.9.0] — 2026-01-01\n\n- old';
    const result = upsertChangelog(existing, entry);
    expect(result).toContain('[0.9.0]');
    expect(result).toContain('old');
  });

  it('cria arquivo com header quando não há marker [Unreleased]', () => {
    const existing = '# Changelog\n\n## [0.9.0] — 2026-01-01\n\n- old';
    const result = upsertChangelog(existing, entry);
    expect(result).toContain('[1.0.0]');
    expect(result).toContain('[0.9.0]');
  });

  it('não duplica entrada se chamado duas vezes com mesma versão', () => {
    const first  = upsertChangelog(null, entry);
    const second = upsertChangelog(first, entry);
    const count  = (second.match(/\[1\.0\.0\]/g) ?? []).length;
    expect(count).toBe(2); // aparece na entrada E não duplica header
  });
});
