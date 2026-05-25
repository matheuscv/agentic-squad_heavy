/**
 * Dispara um deploy no Render e monitora até concluir.
 * Ao final, valida o endpoint /health.
 *
 * Uso:
 *   npm run render:deploy
 */

const POLL_INTERVAL_MS = 8_000;
const TIMEOUT_MS = 10 * 60 * 1_000; // 10 min

function getEnvOrFail(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`❌  ${key} não encontrada no .env`);
    process.exit(1);
  }
  return val;
}

function normalizeServiceId(raw: string): string {
  const withPrefix = raw.match(/srv-[a-z0-9]+/i);
  if (withPrefix) return withPrefix[0];
  const bare = raw.match(/([a-z0-9]{16,})/i);
  const id = bare ? bare[0] : raw.split('/')[0];
  return id.startsWith('srv-') ? id : `srv-${id}`;
}

async function renderRequest<T>(
  method: string,
  path: string,
  apiKey: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`https://api.render.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Render API ${method} ${path} → ${res.status}: ${text}`);
  }

  return (text ? JSON.parse(text) : {}) as T;
}

// Render API retorna array de { deploy: {...}, service: {...} }
type DeployItem = { deploy: { id: string; status: string; finishedAt: string | null } };

async function getLatestDeploy(apiKey: string, serviceId: string): Promise<DeployItem['deploy']> {
  const items = await renderRequest<DeployItem[]>(
    'GET',
    `/services/${serviceId}/deploys?limit=1`,
    apiKey,
  );
  if (!items.length) throw new Error('Nenhum deploy encontrado para este serviço.');
  return items[0].deploy;
}

async function triggerDeploy(apiKey: string, serviceId: string): Promise<string> {
  // Tenta criar um novo deploy; se já houver um em progresso, usa o mais recente
  try {
    const raw = await renderRequest<Record<string, unknown>>(
      'POST',
      `/services/${serviceId}/deploys`,
      apiKey,
      { clearCache: 'do_not_clear' },
    );
    const id =
      (raw['id'] as string | undefined) ??
      ((raw['deploy'] as Record<string, unknown> | undefined)?.['id'] as string | undefined);
    if (id) return id;
  } catch {
    // ignora — provavelmente já há deploy em progresso
  }

  console.log('   ℹ️  Deploy em progresso detectado — monitorando o mais recente...');
  const latest = await getLatestDeploy(apiKey, serviceId);
  return latest.id;
}

async function getDeployStatus(
  apiKey: string,
  serviceId: string,
  deployId: string,
): Promise<{ status: string; finishedAt: string | null }> {
  // Render retorna { deploy: {...}, service: {...} } ou { status, finishedAt } diretamente
  const raw = await renderRequest<Record<string, unknown>>(
    'GET',
    `/services/${serviceId}/deploys/${deployId}`,
    apiKey,
  );
  const d = (raw['deploy'] as Record<string, unknown> | undefined) ?? raw;
  return { status: d['status'] as string, finishedAt: (d['finishedAt'] as string) ?? null };
}

async function getServiceUrl(apiKey: string, serviceId: string): Promise<string> {
  const svc = await renderRequest<{ serviceDetails: { url: string } }>(
    'GET',
    `/services/${serviceId}`,
    apiKey,
  );
  return svc.serviceDetails.url;
}

async function validateHealth(url: string): Promise<void> {
  const healthUrl = `${url}/health`;
  console.log(`\n🔍 Validando ${healthUrl}...`);

  const res = await fetch(healthUrl);
  const body = await res.json();

  console.log(`   HTTP ${res.status}`);
  console.log(`   ${JSON.stringify(body, null, 3).replace(/\n/g, '\n   ')}`);

  if (res.status === 200) {
    console.log('\n✅ /health OK — Fase 0 concluída!\n');
  } else {
    console.warn('\n⚠️  /health retornou status degraded — verifique as conexões.\n');
  }
}

async function main(): Promise<void> {
  const apiKey = getEnvOrFail('RENDER_API_KEY');
  const serviceId = normalizeServiceId(getEnvOrFail('RENDER_SERVICE_ID'));

  console.log(`\n🚀 Disparando deploy em ${serviceId}...`);
  const deployId = await triggerDeploy(apiKey, serviceId);
  console.log(`   Deploy ID: ${deployId}`);

  const deadline = Date.now() + TIMEOUT_MS;
  let lastStatus = '';

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const { status } = await getDeployStatus(apiKey, serviceId, deployId);

    if (status !== lastStatus) {
      console.log(`   [${new Date().toLocaleTimeString()}] status: ${status}`);
      lastStatus = status;
    }

    if (status === 'live') {
      const url = await getServiceUrl(apiKey, serviceId);
      await validateHealth(url);
      return;
    }

    if (['deactivated', 'build_failed', 'update_failed', 'canceled'].includes(status)) {
      console.error(`\n❌ Deploy falhou com status: ${status}`);
      process.exit(1);
    }
  }

  console.error('\n❌ Timeout — deploy não concluiu em 10 minutos.');
  process.exit(1);
}

main().catch((err: Error) => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
