#!/usr/bin/env tsx
/**
 * Gerador de Changelog baseado em Conventional Commits.
 *
 * Uso:
 *   npm run changelog                        — gera entrada para commits desde a última tag
 *   npm run changelog -- --from v1.0.0       — desde uma tag/commit específica
 *   npm run changelog -- --version 1.2.0     — força a versão (default: detecta pelo bump)
 *   npm run changelog -- --dry-run           — imprime sem escrever arquivo
 *   npm run changelog -- --stdout            — imprime apenas a nova entrada
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import {
  parseGitLog,
  determineVersionBump,
  formatChangelogEntry,
  upsertChangelog,
} from '../src/versioning/changelog';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function git(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function getLastTag(): string | null {
  const tag = git('git describe --tags --abbrev=0 2>/dev/null');
  return tag || null;
}

function getCurrentVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function bumpVersion(current: string, bump: string): string {
  const parts = current.replace(/^v/, '').split('.').map(Number);
  const [major = 0, minor = 0, patch = 0] = parts;
  switch (bump) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default:      return current;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Parsing de args simples ──────────────────────────────────────────────────

function parseArgs(): {
  from: string | null;
  version: string | null;
  dryRun: boolean;
  stdout: boolean;
} {
  const args = process.argv.slice(2);
  const get  = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1]! : null;
  };
  return {
    from:    get('--from'),
    version: get('--version'),
    dryRun:  args.includes('--dry-run'),
    stdout:  args.includes('--stdout'),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { from, version: versionOverride, dryRun, stdout: stdoutOnly } = parseArgs();

  // 1. Determina o range de commits
  const lastTag = from ?? getLastTag();
  const range   = lastTag ? `${lastTag}..HEAD` : 'HEAD';

  const gitOutput = git(`git log --format="%H%x09%s" ${range}`);

  if (!gitOutput) {
    console.log('Nenhum commit novo encontrado.');
    return;
  }

  // 2. Parseia os commits
  const commits = parseGitLog(gitOutput);

  if (commits.length === 0) {
    console.log('Nenhum commit conventional encontrado no range especificado.');
    return;
  }

  // 3. Determina a versão
  const bump           = determineVersionBump(commits);
  const currentVersion = getCurrentVersion();
  const newVersion     = versionOverride ?? (bump !== 'none' ? bumpVersion(currentVersion, bump) : currentVersion);

  console.log(`Commits analisados : ${commits.length}`);
  console.log(`Range              : ${range}`);
  console.log(`Bump detectado     : ${bump}`);
  console.log(`Versão             : ${currentVersion} → ${newVersion}`);
  console.log('');

  // 4. Gera a entrada
  const entry = formatChangelogEntry(newVersion, today(), commits);

  if (!entry) {
    console.log('Nenhuma entrada relevante para o changelog (apenas commits sem tipo convencional).');
    return;
  }

  if (stdoutOnly) {
    console.log(entry);
    return;
  }

  // 5. Atualiza CHANGELOG.md
  const changelogPath = resolve(process.cwd(), 'CHANGELOG.md');
  const existing      = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf-8') : null;
  const updated       = upsertChangelog(existing, entry);

  if (dryRun) {
    console.log('[DRY-RUN] CHANGELOG.md não foi modificado. Conteúdo gerado:');
    console.log('');
    console.log(entry);
    return;
  }

  writeFileSync(changelogPath, updated, 'utf-8');
  console.log(`✓ CHANGELOG.md atualizado (${changelogPath})`);
  console.log('');
  console.log(entry);
}

main().catch((err: Error) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
