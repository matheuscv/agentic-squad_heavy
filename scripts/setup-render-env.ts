/**
 * Lê o .env local e envia todas as variáveis para o serviço no Render via API.
 *
 * Pré-requisitos no .env:
 *   RENDER_API_KEY=rnd_...
 *   RENDER_SERVICE_ID=srv-...
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/setup-render-env.ts
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── Chaves que NÃO devem ser enviadas ao Render ─────────────────────────────
const SKIP_KEYS = new Set([
  'RENDER_API_KEY',
  'RENDER_SERVICE_ID',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseEnvFile(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, 'utf-8');
  const result: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    result[key] = value;
  }

  return result;
}

async function setRenderEnvVars(
  apiKey: string,
  serviceId: string,
  vars: Array<{ key: string; value: string }>,
): Promise<void> {
  const url = `https://api.render.com/v1/services/${serviceId}/env-vars`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(vars),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Render API erro ${response.status}: ${body}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID;

  if (!apiKey) {
    console.error('❌  RENDER_API_KEY não encontrada no .env');
    process.exit(1);
  }
  if (!serviceId) {
    console.error('❌  RENDER_SERVICE_ID não encontrada no .env');
    process.exit(1);
  }

  const envPath = resolve(process.cwd(), '.env');
  const envVars = parseEnvFile(envPath);

  const payload = Object.entries(envVars)
    .filter(([key]) => !SKIP_KEYS.has(key))
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => ({ key, value }));

  console.log(`\n📋 Variáveis a enviar para o Render (${payload.length}):`);
  for (const { key } of payload) {
    console.log(`   • ${key}`);
  }

  console.log(`\n🚀 Enviando para serviço ${serviceId}...`);
  await setRenderEnvVars(apiKey, serviceId, payload);

  console.log('✅ Variáveis de ambiente configuradas com sucesso no Render!');
  console.log('   O serviço será redeploy automaticamente.\n');
}

main().catch((err: Error) => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
