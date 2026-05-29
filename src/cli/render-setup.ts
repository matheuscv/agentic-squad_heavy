// ─── Render API: validação, listagem de serviços e set de env vars ────────────
//
// Documentação: https://api-docs.render.com/reference/
// Base URL: https://api.render.com/v1
// Auth: Authorization: Bearer <apiKey>

const RENDER_API = 'https://api.render.com/v1';
const TIMEOUT_MS = 12_000;

function renderHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type ValidationResult = { ok: boolean; detail?: string };

export type RenderService = {
  id: string;
  name: string;
  type: string;
  serviceDetailsType?: string;
};

export type EnvVarResult = { ok: boolean; count?: number; detail?: string };

// ─── Validação da API Key ─────────────────────────────────────────────────────

export async function validateRenderAccess(apiKey: string): Promise<ValidationResult> {
  try {
    const res = await fetch(`${RENDER_API}/services?limit=1`, {
      headers: renderHeaders(apiKey),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 401) return { ok: false, detail: 'API Key inválida (401 Unauthorized)' };
    if (res.status === 403) return { ok: false, detail: 'Sem permissão (403 Forbidden)' };
    if (!res.ok)            return { ok: false, detail: `HTTP ${res.status}` };

    return { ok: true };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

// ─── Listagem de serviços ─────────────────────────────────────────────────────
//
// Retorna apenas Web Services e Background Workers (tipos que aceitam env vars).
// Render pagina com cursor — percorre até 200 serviços (suficiente para qualquer conta).

export async function listRenderServices(apiKey: string): Promise<RenderService[]> {
  const services: RenderService[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 4; page++) {
    const url = new URL(`${RENDER_API}/services`);
    url.searchParams.set('limit', '50');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url.toString(), {
      headers: renderHeaders(apiKey),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} ao listar serviços`);

    type ServiceItem = { service: { id: string; name: string; type: string } };
    const items = (await res.json()) as ServiceItem[];

    if (!Array.isArray(items) || items.length === 0) break;

    for (const item of items) {
      const svc = item.service;
      // Filtra apenas tipos que aceitam variáveis de ambiente
      if (['web_service', 'background_worker', 'private_service'].includes(svc.type)) {
        services.push({ id: svc.id, name: svc.name, type: svc.type });
      }
    }

    // Render usa cursor implícito no último item retornado
    if (items.length < 50) break;
    cursor = items[items.length - 1]?.service?.id;
  }

  return services;
}

// ─── Definição de variáveis de ambiente ──────────────────────────────────────
//
// PUT /services/{id}/env-vars substitui TODAS as env vars do serviço.
// Para não apagar vars que o usuário possa ter criado manualmente,
// fazemos GET primeiro e fazemos merge: vars coletadas sobrescrevem,
// as demais são preservadas.

export async function setRenderEnvVars(
  apiKey: string,
  serviceId: string,
  vars: Record<string, string>,
): Promise<EnvVarResult> {
  try {
    // 1. Busca vars existentes
    const getRes = await fetch(`${RENDER_API}/services/${serviceId}/env-vars`, {
      headers: renderHeaders(apiKey),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    type ExistingVar = { key: string; value: string };
    let existingVars: ExistingVar[] = [];

    if (getRes.ok) {
      existingVars = (await getRes.json()) as ExistingVar[];
    }

    // 2. Merge: existentes + novas (novas sobrescrevem)
    const merged: Record<string, string> = {};
    for (const { key, value } of existingVars) {
      merged[key] = value;
    }
    for (const [key, value] of Object.entries(vars)) {
      if (value !== '') merged[key] = value;   // não grava chaves vazias
    }

    const body = Object.entries(merged).map(([key, value]) => ({ key, value }));

    // 3. PUT com o conjunto completo
    const putRes = await fetch(`${RENDER_API}/services/${serviceId}/env-vars`, {
      method: 'PUT',
      headers: renderHeaders(apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!putRes.ok) {
      const detail = await putRes.text().catch(() => '');
      return { ok: false, detail: `HTTP ${putRes.status}: ${detail.slice(0, 200)}` };
    }

    // Conta apenas as vars que foram enviadas pelo wizard
    const count = Object.values(vars).filter((v) => v !== '').length;
    return { ok: true, count };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}
