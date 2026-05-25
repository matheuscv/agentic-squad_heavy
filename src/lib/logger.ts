import pino from 'pino';

// ─── Configuração ─────────────────────────────────────────────────────────────
//
// Sempre emite JSON para stdout — zero dependência de worker threads ou
// pino-pretty no container, o que garante compatibilidade com Alpine Linux.
//
// Betterstack ingere via log drain do Render (sem código extra):
//   Dashboard → Sources → Connect source → Render → colar BETTERSTACK_SOURCE_TOKEN
//
// Em desenvolvimento, para output legível:
//   npm run dev | npx pino-pretty --colorize

export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  base: { service: 'agentic-squad-heavy' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// ─── Factory de child loggers com contexto fixo ───────────────────────────────

export function childLogger(ctx: Record<string, unknown>) {
  return logger.child(ctx);
}
