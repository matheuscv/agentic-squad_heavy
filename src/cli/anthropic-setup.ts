// ─── Anthropic API: validação de chave e seleção de modelos por agente ────────

import Anthropic from '@anthropic-ai/sdk';

// ─── Modelos disponíveis ──────────────────────────────────────────────────────

export const AVAILABLE_MODELS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-3-5',
] as const;

export type AnthropicModel = (typeof AVAILABLE_MODELS)[number];

export const MODEL_DEFAULTS: Record<string, AnthropicModel> = {
  MODEL_ORCHESTRATOR: 'claude-opus-4-7',
  MODEL_PO:           'claude-opus-4-7',
  MODEL_LT:           'claude-opus-4-7',
  MODEL_QA:           'claude-opus-4-7',
  MODEL_DEV:          'claude-sonnet-4-6',
};

export type ValidationResult = { ok: boolean; detail?: string };

// ─── Validação da chave de API ────────────────────────────────────────────────
//
// Faz a menor chamada possível (1 token de entrada, 1 de saída) apenas para
// confirmar que a chave é válida. Usa claude-haiku-3-5 para minimizar custo (~$0.00003).

export async function validateAnthropicAccess(apiKey: string): Promise<ValidationResult> {
  const client = new Anthropic({ apiKey });

  try {
    await client.messages.create({
      model:      'claude-haiku-3-5',
      max_tokens: 1,
      messages:   [{ role: 'user', content: 'ping' }],
    });
    return { ok: true };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    // AuthenticationError → chave inválida
    if (msg.includes('401') || msg.toLowerCase().includes('auth')) {
      return { ok: false, detail: 'Chave de API inválida (401 Unauthorized)' };
    }
    // Qualquer outro erro (rate limit, rede) — não bloqueia
    return { ok: false, detail: msg };
  }
}

// ─── Normaliza entrada de modelo ──────────────────────────────────────────────
//
// Aceita o nome completo ou um atalho (opus, sonnet, haiku).

export function resolveModel(input: string, fallback: AnthropicModel): AnthropicModel {
  const lower = input.trim().toLowerCase();
  if (!lower) return fallback;
  if (lower === 'opus'   || lower.startsWith('claude-opus'))   return 'claude-opus-4-7';
  if (lower === 'sonnet' || lower.startsWith('claude-sonnet')) return 'claude-sonnet-4-6';
  if (lower === 'haiku'  || lower.startsWith('claude-haiku'))  return 'claude-haiku-3-5';
  // Aceita o modelo verbatim se parecer válido
  if (AVAILABLE_MODELS.includes(lower as AnthropicModel)) return lower as AnthropicModel;
  return fallback;
}
