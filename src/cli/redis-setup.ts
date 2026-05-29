// ─── Upstash Redis: validação de conexão via ioredis ─────────────────────────

import Redis from 'ioredis';

const CONNECT_TIMEOUT_MS = 8_000;

export type ValidationResult = { ok: boolean; detail?: string };

// ─── Validação de conexão ─────────────────────────────────────────────────────
//
// Suporta URLs no formato:
//   redis://..., rediss:// (TLS — Upstash exige), redis://:password@host:port

export async function validateRedisAccess(redisUrl: string): Promise<ValidationResult> {
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: CONNECT_TIMEOUT_MS,
    lazyConnect: true,
    tls: redisUrl.startsWith('rediss://') ? {} : undefined,
  });

  return new Promise<ValidationResult>((resolve) => {
    const timer = setTimeout(() => {
      void redis.quit().catch(() => undefined);
      resolve({ ok: false, detail: `timeout após ${CONNECT_TIMEOUT_MS}ms` });
    }, CONNECT_TIMEOUT_MS + 500);

    redis
      .connect()
      .then(() => redis.ping())
      .then((pong) => {
        clearTimeout(timer);
        void redis.quit().catch(() => undefined);
        resolve(pong === 'PONG' ? { ok: true } : { ok: false, detail: `PING retornou: ${pong}` });
      })
      .catch((err: Error) => {
        clearTimeout(timer);
        void redis.quit().catch(() => undefined);
        resolve({ ok: false, detail: err.message });
      });
  });
}
