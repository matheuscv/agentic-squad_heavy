import pino from 'pino';

// ─── Configuração ─────────────────────────────────────────────────────────────
//
// Em produção: JSON para stdout — o Betterstack ingere via log drain do Render.
// Em desenvolvimento: pino-pretty colorido via worker thread.
//
// Para configurar o log drain no Betterstack:
//   Dashboard → Sources → Connect source → Render → colar BETTERSTACK_SOURCE_TOKEN

const isDev = process.env.NODE_ENV !== 'production';

const transport = isDev
  ? pino.transport({
      target: 'pino-pretty',
      options: { colorize: true, ignore: 'pid,hostname', translateTime: 'SYS:HH:MM:ss' },
    })
  : undefined;

export const logger = pino(
  {
    level: isDev ? 'debug' : 'info',
    base: { service: 'agentic-squad-heavy' },
    // Timestamps em ISO-8601 — Betterstack reconhece e indexa automaticamente
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  transport,
);

// ─── Factory de child loggers com contexto fixo ───────────────────────────────

export function childLogger(ctx: Record<string, unknown>) {
  return logger.child(ctx);
}
