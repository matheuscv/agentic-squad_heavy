import { describe, it, expect } from 'vitest';
import { detectDestructiveOps, formatMigrationReport } from './migrate-runner';
import type { MigrationReport } from './migrate-runner';

// ─── detectDestructiveOps ─────────────────────────────────────────────────────

describe('detectDestructiveOps', () => {
  it('não detecta nada em SQL aditivo', () => {
    const sql = `
      CREATE TABLE "users" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL);
      --> statement-breakpoint
      ALTER TABLE "users" ADD COLUMN "name" text NOT NULL;
      --> statement-breakpoint
      CREATE INDEX "users_name_idx" ON "users" USING btree ("name");
    `;
    expect(detectDestructiveOps(sql, '0001_add_users')).toHaveLength(0);
  });

  it('detecta DROP TABLE como risco alto', () => {
    const sql = 'DROP TABLE IF EXISTS "legacy_table";';
    const ops = detectDestructiveOps(sql, '0002_drop_legacy');
    expect(ops).toHaveLength(1);
    expect(ops[0]!.risk).toBe('high');
    expect(ops[0]!.tag).toBe('0002_drop_legacy');
    expect(ops[0]!.statement.toLowerCase()).toContain('drop table');
  });

  it('detecta TRUNCATE como risco alto', () => {
    const sql = 'TRUNCATE TABLE "logs" RESTART IDENTITY;';
    const ops = detectDestructiveOps(sql, '0003_truncate');
    expect(ops.some((o) => o.risk === 'high')).toBe(true);
  });

  it('detecta DROP SCHEMA como risco alto', () => {
    const sql = 'DROP SCHEMA IF EXISTS "old_schema" CASCADE;';
    const ops = detectDestructiveOps(sql, '0004_drop_schema');
    expect(ops.some((o) => o.risk === 'high')).toBe(true);
  });

  it('detecta DROP COLUMN como risco médio', () => {
    const sql = 'ALTER TABLE "users" DROP COLUMN "deprecated_field";';
    const ops = detectDestructiveOps(sql, '0005_drop_col');
    expect(ops).toHaveLength(1);
    expect(ops[0]!.risk).toBe('medium');
  });

  it('detecta DROP INDEX como risco médio', () => {
    const sql = 'DROP INDEX IF EXISTS "old_idx";';
    const ops = detectDestructiveOps(sql, '0006_drop_idx');
    expect(ops.some((o) => o.risk === 'medium')).toBe(true);
  });

  it('detecta DROP CONSTRAINT como risco médio', () => {
    const sql = 'ALTER TABLE "orders" DROP CONSTRAINT "fk_old";';
    const ops = detectDestructiveOps(sql, '0007_drop_fk');
    expect(ops.some((o) => o.risk === 'medium')).toBe(true);
  });

  it('detecta ALTER COLUMN como risco médio', () => {
    const sql = 'ALTER TABLE "users" ALTER COLUMN "age" TYPE bigint;';
    const ops = detectDestructiveOps(sql, '0008_alter_col');
    expect(ops.some((o) => o.risk === 'medium')).toBe(true);
  });

  it('detecta DROP TYPE como risco médio', () => {
    const sql = 'DROP TYPE IF EXISTS "old_status";';
    const ops = detectDestructiveOps(sql, '0009_drop_type');
    expect(ops.some((o) => o.risk === 'medium')).toBe(true);
  });

  it('não duplica operações do mesmo tipo', () => {
    const sql = `
      ALTER TABLE "a" DROP COLUMN "x";
      ALTER TABLE "b" DROP COLUMN "y";
    `;
    const ops = detectDestructiveOps(sql, '0010_multi');
    const dropColOps = ops.filter((o) => o.statement.toLowerCase().includes('drop column'));
    expect(dropColOps).toHaveLength(1); // deduplicado por tipo
  });

  it('detecta múltiplos tipos diferentes no mesmo SQL', () => {
    const sql = `
      DROP TABLE "old";
      ALTER TABLE "users" DROP COLUMN "col";
      DROP INDEX "idx";
    `;
    const ops = detectDestructiveOps(sql, '0011_mixed');
    const risks = new Set(ops.map((o) => o.risk));
    expect(risks.has('high')).toBe(true);
    expect(risks.has('medium')).toBe(true);
    expect(ops.length).toBeGreaterThanOrEqual(2);
  });

  it('é case-insensitive', () => {
    const sql = 'drop table IF EXISTS "test";';
    const ops = detectDestructiveOps(sql, '0012_lower');
    expect(ops.some((o) => o.risk === 'high')).toBe(true);
  });
});

// ─── formatMigrationReport ────────────────────────────────────────────────────

describe('formatMigrationReport', () => {
  const makeReport = (overrides: Partial<MigrationReport> = {}): MigrationReport => ({
    total: 2,
    applied: 1,
    pending: 1,
    appliedMigrations: [
      { idx: 0, tag: '0000_init', status: 'applied', appliedAt: new Date('2026-01-01'), destructiveOps: [] },
    ],
    pendingMigrations: [
      { idx: 1, tag: '0001_add_col', status: 'pending', destructiveOps: [] },
    ],
    hasDestructive: false,
    destructiveOps: [],
    ...overrides,
  });

  it('inclui contadores no header', () => {
    const report = formatMigrationReport(makeReport());
    expect(report).toContain('2 total');
    expect(report).toContain('1 aplicadas');
    expect(report).toContain('1 pendentes');
  });

  it('mostra tag das migrações aplicadas', () => {
    const report = formatMigrationReport(makeReport());
    expect(report).toContain('0000_init');
  });

  it('mostra tag das migrações pendentes', () => {
    const report = formatMigrationReport(makeReport());
    expect(report).toContain('0001_add_col');
  });

  it('alerta sobre operações destrutivas', () => {
    const report = formatMigrationReport(makeReport({
      hasDestructive: true,
      destructiveOps: [{ tag: '0001_add_col', risk: 'high', statement: 'DROP TABLE "x"' }],
    }));
    expect(report).toContain('destrutivas');
  });

  it('não alerta quando não há ops destrutivas', () => {
    const report = formatMigrationReport(makeReport());
    expect(report).not.toContain('destrutivas');
  });

  it('formata índice com zero-padding', () => {
    const report = formatMigrationReport(makeReport());
    expect(report).toMatch(/\[0000\]/);
    expect(report).toMatch(/\[0001\]/);
  });

  it('não lista seção "Aplicadas" quando não há', () => {
    const report = formatMigrationReport(makeReport({
      applied: 0,
      appliedMigrations: [],
      total: 1,
    }));
    expect(report).not.toContain('✓ Aplicadas');
  });

  it('não lista seção "Pendentes" quando não há', () => {
    const report = formatMigrationReport(makeReport({
      pending: 0,
      pendingMigrations: [],
      total: 1,
    }));
    expect(report).not.toContain('⏳ Pendentes');
  });
});
