import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type JournalEntry = {
  idx: number;
  tag: string;
  when: number;
  breakpoints: boolean;
};

export type RiskLevel = 'high' | 'medium';

export type DestructiveOp = {
  tag: string;
  statement: string;
  risk: RiskLevel;
};

export type MigrationStatus = 'applied' | 'pending';

export type MigrationInfo = {
  idx: number;
  tag: string;
  appliedAt?: Date;
  status: MigrationStatus;
  destructiveOps: DestructiveOp[];
};

export type MigrationReport = {
  total: number;
  applied: number;
  pending: number;
  pendingMigrations: MigrationInfo[];
  appliedMigrations: MigrationInfo[];
  hasDestructive: boolean;
  destructiveOps: DestructiveOp[];
};

// ─── Padrões de operações destrutivas ────────────────────────────────────────

const DESTRUCTIVE_PATTERNS: Array<{ re: RegExp; risk: RiskLevel; label: string }> = [
  { re: /\bDROP\s+TABLE\b/i,       risk: 'high',   label: 'DROP TABLE'      },
  { re: /\bTRUNCATE\b/i,           risk: 'high',   label: 'TRUNCATE'        },
  { re: /\bDROP\s+SCHEMA\b/i,      risk: 'high',   label: 'DROP SCHEMA'     },
  { re: /\bDROP\s+COLUMN\b/i,      risk: 'medium', label: 'DROP COLUMN'     },
  { re: /\bDROP\s+INDEX\b/i,       risk: 'medium', label: 'DROP INDEX'      },
  { re: /\bDROP\s+CONSTRAINT\b/i,  risk: 'medium', label: 'DROP CONSTRAINT' },
  { re: /\bALTER\s+COLUMN\b/i,     risk: 'medium', label: 'ALTER COLUMN'    },
  { re: /\bDROP\s+TYPE\b/i,        risk: 'medium', label: 'DROP TYPE'       },
];

// ─── Leitura do journal e SQL ─────────────────────────────────────────────────

type JournalFile = {
  version: string;
  dialect: string;
  entries: Array<{ idx: number; tag: string; when: number; breakpoints: boolean }>;
};

export function readJournal(migrationsDir: string): JournalEntry[] {
  const journalPath = join(migrationsDir, 'meta', '_journal.json');
  if (!existsSync(journalPath)) return [];
  const raw = JSON.parse(readFileSync(journalPath, 'utf-8')) as JournalFile;
  return raw.entries.map((e) => ({
    idx:        e.idx,
    tag:        e.tag,
    when:       e.when,
    breakpoints: e.breakpoints,
  }));
}

export function readMigrationSql(migrationsDir: string, tag: string): string {
  const sqlPath = join(migrationsDir, `${tag}.sql`);
  if (!existsSync(sqlPath)) throw new Error(`Arquivo de migração não encontrado: ${sqlPath}`);
  return readFileSync(sqlPath, 'utf-8');
}

// ─── Detecção de operações destrutivas ───────────────────────────────────────

export function detectDestructiveOps(sql: string, tag: string): DestructiveOp[] {
  const ops: DestructiveOp[] = [];

  // Quebra em statements pelo marker do drizzle-kit
  const statements = sql.split('--> statement-breakpoint').concat(sql.split(';'));

  // Deduplicação — verifica cada padrão uma vez por SQL
  const found = new Set<string>();

  for (const { re, risk, label } of DESTRUCTIVE_PATTERNS) {
    const key = `${tag}:${label}`;
    if (found.has(key)) continue;

    // Busca o statement que contém o padrão
    const stmt = statements.find((s) => re.test(s));
    if (stmt) {
      found.add(key);
      ops.push({
        tag,
        risk,
        statement: stmt.trim().split('\n')[0]?.trim() ?? label, // primeira linha do statement
      });
    }
  }

  return ops;
}

// ─── Consulta ao banco de dados ───────────────────────────────────────────────
//
// Drizzle armazena migrações aplicadas em drizzle.__drizzle_migrations.
// A tabela é criada automaticamente na primeira execução de migrate().

export async function countAppliedMigrations(pool: Pool): Promise<number> {
  try {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM drizzle."__drizzle_migrations"`,
    );
    return parseInt(result.rows[0]!.count, 10);
  } catch {
    // Tabela não existe — nenhuma migração aplicada ainda
    return 0;
  }
}

export async function getAppliedMigrationTimestamps(pool: Pool): Promise<number[]> {
  try {
    const result = await pool.query<{ created_at: string }>(
      `SELECT created_at FROM drizzle."__drizzle_migrations" ORDER BY created_at`,
    );
    return result.rows.map((r) => parseInt(r.created_at, 10));
  } catch {
    return [];
  }
}

// ─── Geração do relatório ─────────────────────────────────────────────────────

export async function getMigrationReport(opts: {
  migrationsDir: string;
  pool: Pool;
}): Promise<MigrationReport> {
  const { migrationsDir, pool } = opts;

  const journal       = readJournal(migrationsDir);
  const appliedCount  = await countAppliedMigrations(pool);
  const appliedTs     = await getAppliedMigrationTimestamps(pool);

  // Drizzle aplica sempre em ordem — os primeiros N do journal são os aplicados
  const appliedEntries = journal.slice(0, appliedCount);
  const pendingEntries = journal.slice(appliedCount);

  const toInfo = (entry: JournalEntry, status: MigrationStatus, tsMs?: number): MigrationInfo => {
    let destructiveOps: DestructiveOp[] = [];
    if (status === 'pending') {
      try {
        const sql = readMigrationSql(migrationsDir, entry.tag);
        destructiveOps = detectDestructiveOps(sql, entry.tag);
      } catch {
        // arquivo SQL ausente — continua sem ops
      }
    }
    return {
      idx:       entry.idx,
      tag:       entry.tag,
      status,
      appliedAt: tsMs ? new Date(tsMs) : undefined,
      destructiveOps,
    };
  };

  const applied = appliedEntries.map((e, i) => toInfo(e, 'applied', appliedTs[i]));
  const pending = pendingEntries.map((e) => toInfo(e, 'pending'));

  const allDestructive = pending.flatMap((m) => m.destructiveOps);

  return {
    total:              journal.length,
    applied:            applied.length,
    pending:            pending.length,
    appliedMigrations:  applied,
    pendingMigrations:  pending,
    hasDestructive:     allDestructive.length > 0,
    destructiveOps:     allDestructive,
  };
}

// ─── Formatação do relatório ──────────────────────────────────────────────────

export function formatMigrationReport(report: MigrationReport): string {
  const lines: string[] = [];

  lines.push(`Migrações: ${report.total} total | ${report.applied} aplicadas | ${report.pending} pendentes`);
  lines.push('');

  if (report.applied > 0) {
    lines.push('✓ Aplicadas:');
    for (const m of report.appliedMigrations) {
      const ts = m.appliedAt ? ` (${m.appliedAt.toISOString().slice(0, 10)})` : '';
      lines.push(`  [${String(m.idx).padStart(4, '0')}] ${m.tag}${ts}`);
    }
    lines.push('');
  }

  if (report.pending > 0) {
    lines.push('⏳ Pendentes:');
    for (const m of report.pendingMigrations) {
      lines.push(`  [${String(m.idx).padStart(4, '0')}] ${m.tag}`);
      for (const op of m.destructiveOps) {
        const icon = op.risk === 'high' ? '🔴' : '🟡';
        lines.push(`         ${icon} ${op.risk.toUpperCase()}: ${op.statement}`);
      }
    }
    lines.push('');
  }

  if (report.hasDestructive) {
    lines.push('⚠️  Operações destrutivas detectadas nas migrações pendentes.');
    lines.push('   Verifique os SQL acima antes de aplicar em produção.');
  }

  return lines.join('\n');
}

// ─── Aplicação controlada de migrações ───────────────────────────────────────
//
// Usa drizzle-orm/node-postgres/migrator diretamente, sem drizzle-kit CLI.
// Aplica apenas migrações pendentes, de forma atômica por statement.

export async function applyMigrations(opts: {
  migrationsDir: string;
  pool: Pool;
  dryRun?: boolean;
  force?: boolean;
}): Promise<{ applied: number; skipped: number }> {
  const { migrationsDir, pool, dryRun = false, force = false } = opts;

  const report = await getMigrationReport({ migrationsDir, pool });

  if (report.pending === 0) {
    return { applied: 0, skipped: 0 };
  }

  if (report.hasDestructive && !force && !dryRun) {
    const ops = report.destructiveOps
      .map((o) => `  ${o.risk === 'high' ? '🔴' : '🟡'} ${o.statement}`)
      .join('\n');
    throw new Error(
      `Operações destrutivas detectadas. Use --force para prosseguir:\n${ops}`,
    );
  }

  if (dryRun) {
    // Apenas imprime o SQL pendente sem executar
    for (const m of report.pendingMigrations) {
      const sql = readMigrationSql(migrationsDir, m.tag);
      console.log(`\n-- [DRY-RUN] ${m.tag}`);
      console.log(sql);
    }
    return { applied: 0, skipped: report.pending };
  }

  // Aplica via drizzle migrator
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate }  = await import('drizzle-orm/node-postgres/migrator');

  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: migrationsDir });

  return { applied: report.pending, skipped: 0 };
}
