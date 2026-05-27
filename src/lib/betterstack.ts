// ─── Betterstack Logs API — alertas críticos diretos ─────────────────────────
//
// Logs regulares chegam ao Betterstack via Render log drain (pino → stdout → drain).
// Este módulo envia eventos críticos diretamente via HTTP para garantia de entrega
// imediata, sem depender do pipeline de drain.
//
// Requer: BETTERSTACK_SOURCE_TOKEN no ambiente.
// Se a variável não estiver definida, todas as chamadas são no-op.

export interface BetterstackEvent {
  level: 'info' | 'warn' | 'error';
  message: string;
  event: string;
  [key: string]: unknown;
}

export async function sendBetterstackAlert(payload: BetterstackEvent): Promise<void> {
  const token = process.env.BETTERSTACK_SOURCE_TOKEN;
  if (!token) return;

  try {
    await fetch('https://in.logs.betterstack.com', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dt: new Date().toISOString(),
        service: 'agentic-squad-heavy',
        ...payload,
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // best-effort — nunca bloqueia o fluxo principal
  }
}
