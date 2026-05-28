#!/usr/bin/env tsx
/**
 * Runner de migrações Drizzle com controle de segurança.
 *
 * Subcomandos:
 *   npm run migrate:status   — lista migrações aplicadas e pendentes
 *   npm run migrate:check    — detecta operações destrutivas nas pendentes
 *   npm run migrate:dry-run  — imprime SQL pendente sem executar
 *   npm run migrate:run      — aplica migrações (bloqueia se houver ops destrutivas)
 *   npm run migrate:run -- --force   — aplica mesmo com ops destrutivas (use com cuidado)
 */

import { config } from 'dotenv';
config();

import { Pool } from 'pg';
import { resolve } from 'path';
import {
  getMigrationReport,
  formatMigrationReport,
  applyMigrations,
} from '../src/db/migrate-runner';

// ─── Configuração ─────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = resolve(process.cwd(), 'src/db/migrations');

function createPool(): Pool {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL não configurada no .env');
  return new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 2,
    connectionTimeoutMillis: 10_000,
  });
}

// ─── Subcomandos ──────────────────────────────────────────────────────────────

async function cmdStatus(pool: Pool): Promise<void> {
  console.log('Consultando estado das migrações...\n');
  const report = await getMigrationReport({ migrationsDir: MIGRATIONS_DIR, pool });
  console.log(formatMigrationReport(report));
}

async function cmdCheck(pool: Pool): Promise<void> {
  console.log('Verificando operações destrutivas nas migrações pendentes...\n');
  const report = await getMigrationReport({ migrationsDir: MIGRATIONS_DIR, pool });

  if (report.pending === 0) {
    console.log('✓ Nenhuma migração pendente.');
    return;
  }

  if (!report.hasDestructive) {
    console.log(`✓ ${report.pending} migrações pendentes sem operações destrutivas.`);
    for (const m of report.pendingMigrations) {
      console.log(`  [${String(m.idx).padStart(4, '0')}] ${m.tag}`);
    }
    return;
  }

  console.log(`⚠️  Operações destrutivas nas migrações pendentes:\n`);
  for (const op of report.destructiveOps) {
    const icon = op.risk === 'high' ? '🔴' : '🟡';
    console.log(`${icon} [${op.risk.toUpperCase()}] ${op.tag}`);
    console.log(`   ${op.statement}`);
    console.log('');
  }
  process.exit(1);
}

async function cmdDryRun(pool: Pool): Promise<void> {
  console.log('[DRY-RUN] SQL das migrações pendentes:\n');
  const result = await applyMigrations({
    migrationsDir: MIGRATIONS_DIR,
    pool,
    dryRun: true,
  });

  if (result.skipped === 0) {
    console.log('Nenhuma migração pendente.');
  }
}

async function cmdRun(pool: Pool, force: boolean): Promise<void> {
  const report = await getMigrationReport({ migrationsDir: MIGRATIONS_DIR, pool });

  if (report.pending === 0) {
    console.log('✓ Banco de dados já está atualizado. Nenhuma migração pendente.');
    return;
  }

  console.log(`Aplicando ${report.pending} migração(ões) pendente(s)...`);

  if (report.hasDestructive && !force) {
    console.log('');
    console.log('⚠️  Operações destrutivas detectadas:');
    for (const op of report.destructiveOps) {
      const icon = op.risk === 'high' ? '🔴' : '🟡';
      console.log(`  ${icon} [${op.risk.toUpperCase()}] ${op.tag}: ${op.statement}`);
    }
    console.log('');
    console.log('Use --force para aplicar mesmo assim: npm run migrate:run -- --force');
    process.exit(1);
  }

  if (report.hasDestructive && force) {
    console.log('⚠️  --force ativo: aplicando com operações destrutivas.');
  }

  const result = await applyMigrations({
    migrationsDir: MIGRATIONS_DIR,
    pool,
    dryRun: false,
    force,
  });

  console.log(`✓ ${result.applied} migração(ões) aplicada(s) com sucesso.`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args       = process.argv.slice(2);
  const subcommand = args[0];
  const force      = args.includes('--force');

  if (!subcommand) {
    console.log('Uso: npm run migrate:<status|check|dry-run|run> [--force]');
    process.exit(1);
  }

  const pool = createPool();

  try {
    switch (subcommand) {
      case 'status':   await cmdStatus(pool);           break;
      case 'check':    await cmdCheck(pool);            break;
      case 'dry-run':  await cmdDryRun(pool);           break;
      case 'run':      await cmdRun(pool, force);       break;
      default:
        console.error(`Subcomando desconhecido: ${subcommand}`);
        process.exit(1);
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main().catch((err: Error) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
