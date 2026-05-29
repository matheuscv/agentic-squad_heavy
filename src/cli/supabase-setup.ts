// ─── Supabase / PostgreSQL: validação de conexão e migrations ────────────────

import { Pool } from 'pg';

const TIMEOUT_MS = 10_000;

export type ValidationResult = { ok: boolean; detail?: string };

// ─── Validação de conexão ─────────────────────────────────────────────────────

export async function validateDatabaseAccess(databaseUrl: string): Promise<ValidationResult> {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: TIMEOUT_MS,
    max: 1,
  });

  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return { ok: true };
    } finally {
      client.release();
    }
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

// ─── Execução de migrations via migrate-runner ────────────────────────────────

import { join } from 'path';

export type MigrationResult = { ok: boolean; applied?: number; detail?: string };

export async function runMigrations(databaseUrl: string): Promise<MigrationResult> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });

  try {
    const { applyMigrations } = await import('../db/migrate-runner');

    // Resolve o diretório de migrations relativo à raiz do projeto
    const migrationsDir = join(__dirname, '../../src/db/migrations');

    const result = await applyMigrations({ migrationsDir, pool, force: false });
    return { ok: true, applied: result.applied };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  } finally {
    await pool.end().catch(() => undefined);
  }
}
