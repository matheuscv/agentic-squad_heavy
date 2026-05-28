// ─── Gerador de changelog baseado em Conventional Commits ────────────────────
//
// Suporta: feat | fix | perf | refactor | docs | test | chore | ci | build | style | revert
// BREAKING CHANGE: detectado via "!" no tipo (feat!:) ou footer "BREAKING CHANGE:"

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type CommitType =
  | 'feat' | 'fix' | 'perf' | 'refactor'
  | 'docs' | 'test' | 'chore' | 'ci' | 'build'
  | 'style' | 'revert' | 'unknown';

export type ParsedCommit = {
  hash: string;
  shortHash: string;
  type: CommitType;
  scope: string | undefined;
  breaking: boolean;
  subject: string;
  raw: string;
};

export type VersionBump = 'major' | 'minor' | 'patch' | 'none';

export type ChangelogSection = {
  label: string;
  commits: ParsedCommit[];
};

// ─── Mapeamento type → label (em português) ───────────────────────────────────

const TYPE_LABELS: Record<CommitType, string | null> = {
  feat:     'Novas Funcionalidades',
  fix:      'Correções de Bugs',
  perf:     'Melhorias de Performance',
  refactor: 'Refatorações',
  docs:     'Documentação',
  test:     'Testes',
  chore:    'Manutenção',
  ci:       'CI/CD',
  build:    'Build',
  style:    'Estilo de Código',
  revert:   'Revertidos',
  unknown:  null, // ignorado no changelog
};

// Ordem de exibição das seções
const SECTION_ORDER: CommitType[] = [
  'feat', 'fix', 'perf', 'refactor', 'docs',
  'test', 'chore', 'ci', 'build', 'style', 'revert',
];

const KNOWN_TYPES = new Set<string>(Object.keys(TYPE_LABELS));

// ─── Parser de commit individual ─────────────────────────────────────────────

const CONVENTIONAL_RE = /^(\w+)(\(([^)]+)\))?(!)?: (.+)$/;

export function parseCommit(hash: string, rawSubject: string): ParsedCommit {
  const subject = rawSubject.trim();
  const match = CONVENTIONAL_RE.exec(subject);

  const shortHash = hash.slice(0, 7);

  if (!match) {
    return { hash, shortHash, type: 'unknown', scope: undefined, breaking: false, subject, raw: subject };
  }

  const rawType   = match[1]!.toLowerCase();
  const scope     = match[3] ?? undefined;
  const breaking  = match[4] === '!' || subject.includes('BREAKING CHANGE:');
  const desc      = match[5]!.trim();
  const type      = (KNOWN_TYPES.has(rawType) ? rawType : 'unknown') as CommitType;

  // Para tipos desconhecidos preserva a mensagem raw inteira — o prefix "WIP:" etc. tem significado
  const resolvedSubject = type === 'unknown' ? subject : desc;

  return { hash, shortHash, type, scope, breaking, subject: resolvedSubject, raw: subject };
}

// ─── Parser do output de git log ─────────────────────────────────────────────
//
// Espera linhas no formato "HASH<TAB>subject" produzidas por:
//   git log --format="%H%x09%s"

export function parseGitLog(output: string): ParsedCommit[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const tab = line.indexOf('\t');
      if (tab === -1) return null;
      const hash    = line.slice(0, tab).trim();
      const subject = line.slice(tab + 1).trim();
      if (!hash || hash.length < 7) return null;
      return parseCommit(hash, subject);
    })
    .filter((c): c is ParsedCommit => c !== null);
}

// ─── Determinação do tipo de bump semântico ───────────────────────────────────

export function determineVersionBump(commits: ParsedCommit[]): VersionBump {
  if (commits.length === 0) return 'none';
  if (commits.some((c) => c.breaking)) return 'major';
  if (commits.some((c) => c.type === 'feat')) return 'minor';
  if (commits.some((c) => ['fix', 'perf', 'refactor'].includes(c.type))) return 'patch';
  return 'none';
}

// ─── Agrupamento por tipo ─────────────────────────────────────────────────────

export function groupCommits(commits: ParsedCommit[]): ChangelogSection[] {
  const breaking = commits.filter((c) => c.breaking);
  const byType   = new Map<CommitType, ParsedCommit[]>();

  for (const c of commits) {
    if (!byType.has(c.type)) byType.set(c.type, []);
    byType.get(c.type)!.push(c);
  }

  const sections: ChangelogSection[] = [];

  if (breaking.length > 0) {
    sections.push({ label: '⚠️ BREAKING CHANGES', commits: breaking });
  }

  for (const type of SECTION_ORDER) {
    const label = TYPE_LABELS[type];
    if (!label) continue;
    const typeCommits = (byType.get(type) ?? []).filter((c) => !c.breaking);
    if (typeCommits.length > 0) {
      sections.push({ label, commits: typeCommits });
    }
  }

  return sections;
}

// ─── Formatação de entrada do changelog ──────────────────────────────────────

function formatCommitLine(c: ParsedCommit): string {
  const scope = c.scope ? `**${c.scope}**: ` : '';
  return `- ${scope}${c.subject} (\`${c.shortHash}\`)`;
}

export function formatChangelogEntry(
  version: string,
  date: string,
  commits: ParsedCommit[],
): string {
  const sections = groupCommits(commits);
  if (sections.length === 0) return '';

  const lines: string[] = [`## [${version}] — ${date}`, ''];

  for (const section of sections) {
    lines.push(`### ${section.label}`);
    lines.push('');
    for (const c of section.commits) {
      lines.push(formatCommitLine(c));
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// ─── Atualização incremental do CHANGELOG.md ─────────────────────────────────

const HEADER = `# Changelog\n\nTodas as mudanças notáveis neste projeto são documentadas neste arquivo.\nFormato baseado em [Keep a Changelog](https://keepachangelog.com/).\n`;
const UNRELEASED_MARKER = '## [Unreleased]';

export function upsertChangelog(
  existingContent: string | null,
  newEntry: string,
): string {
  const base = existingContent?.trim() ?? '';

  if (!base) {
    // Arquivo novo
    return `${HEADER}\n${UNRELEASED_MARKER}\n\n${newEntry}\n`;
  }

  const unreleasedIdx = base.indexOf(UNRELEASED_MARKER);
  if (unreleasedIdx === -1) {
    // Sem marker — insere após o header
    const firstH2 = base.indexOf('\n## ');
    if (firstH2 === -1) {
      return `${base}\n\n${newEntry}\n`;
    }
    return `${base.slice(0, firstH2)}\n\n${UNRELEASED_MARKER}\n\n${newEntry}\n${base.slice(firstH2)}`;
  }

  // Insere logo após o bloco [Unreleased]
  const afterUnreleased = base.indexOf('\n## ', unreleasedIdx + 1);
  if (afterUnreleased === -1) {
    return `${base}\n\n${newEntry}\n`;
  }

  return `${base.slice(0, afterUnreleased)}\n\n${newEntry}\n${base.slice(afterUnreleased)}`;
}
