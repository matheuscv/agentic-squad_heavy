import type IORedis from 'ioredis';

const RATE_LIMIT_KEY = 'anthropic:tpm:window';
const MAX_TPM = 24_000;   // 80% de 30k — margem de segurança
const WINDOW_MS = 62_000; // janela ligeiramente acima de 60s
const DEFAULT_ESTIMATED_TOKENS = 8_000;

// Lua atômico: sliding window token bucket
// Retorna -1 em sucesso, ou o total atual de tokens (capacidade insuficiente)
const ACQUIRE_SCRIPT = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local tokens = tonumber(ARGV[3])
local max    = tonumber(ARGV[4])
local eid    = ARGV[5]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)

local members = redis.call('ZRANGE', key, 0, -1)
local used = 0
for _, m in ipairs(members) do
  local sep = string.find(m, ':')
  if sep then used = used + tonumber(string.sub(m, sep + 1)) end
end

if used + tokens > max then return used end

redis.call('ZADD', key, now, eid .. ':' .. tokens)
redis.call('EXPIRE', key, 130)
return -1
`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Bloqueia até haver capacidade de TPM disponível no Redis compartilhado.
 * Todos os agentes chamam isso antes de cada request à API Anthropic.
 */
export async function waitForAnthropicCapacity(
  redis: IORedis,
  estimatedTokens: number = DEFAULT_ESTIMATED_TOKENS,
): Promise<void> {
  const deadline = Date.now() + 180_000; // máximo 3 min de espera

  while (Date.now() < deadline) {
    const now = Date.now();
    const eid = `${now}-${Math.random().toString(36).slice(2, 9)}`;

    try {
      const result = (await redis.eval(
        ACQUIRE_SCRIPT,
        1,
        RATE_LIMIT_KEY,
        now.toString(),
        WINDOW_MS.toString(),
        estimatedTokens.toString(),
        MAX_TPM.toString(),
        eid,
      )) as number;

      if (result === -1) return; // capacidade reservada
    } catch {
      // Redis indisponível — prossegue após deadline
    }

    // Espera proporcional ao quanto a janela está cheia
    const waitMs = Math.min(15_000, WINDOW_MS / 4);
    await sleep(waitMs);
  }

  // Após 3 min, prossegue mesmo assim — melhor tentar e receber 429 com backoff
}
