import { sql, eq } from 'drizzle-orm';
import { db, schema } from '../db/index';
import { addComment } from '../jira/client';

// ─── Tabela de preços por modelo (USD por milhão de tokens) ──────────────────

const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  'claude-opus-4-7':         { inputPerMTok: 15,   outputPerMTok: 75   },
  'claude-sonnet-4-6':       { inputPerMTok: 3,    outputPerMTok: 15   },
  'claude-haiku-4-5-20251001': { inputPerMTok: 0.25, outputPerMTok: 1.25 },
};

const DEFAULT_PRICING = MODEL_PRICING['claude-opus-4-7']!;

export function calculateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return (inputTokens / 1_000_000) * pricing.inputPerMTok
       + (outputTokens / 1_000_000) * pricing.outputPerMTok;
}

export function getCostAlertThresholdUsd(): number {
  return parseFloat(process.env.COST_ALERT_THRESHOLD_USD ?? '1.00');
}

// ─── Alerta de custo por história ────────────────────────────────────────────

export async function checkAndAlertIfOverBudget(
  storyId: string,
  jiraKey: string,
  log: { warn: (obj: object, msg?: string) => void },
): Promise<void> {
  const threshold = getCostAlertThresholdUsd();

  const [row] = await db
    .select({ totalCost: sql<number>`coalesce(sum(${schema.agentRuns.costUsd}), 0)` })
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.storyId, storyId));

  const totalCost = Number(row?.totalCost ?? 0);

  if (totalCost > threshold) {
    log.warn({ jiraKey, totalCost, threshold }, 'custo da história excedeu o threshold');

    const comment =
      `⚠️ *Alerta de Custo — Squad Agêntica*\n\n` +
      `O custo acumulado desta história atingiu *USD ${totalCost.toFixed(4)}*, ` +
      `superando o threshold configurado de *USD ${threshold.toFixed(2)}*.\n\n` +
      `Revise o número de iterações ou aumente o threshold via \`COST_ALERT_THRESHOLD_USD\`.`;

    try {
      await addComment(jiraKey, comment);
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'falha ao enviar alerta de custo no Jira');
    }
  }
}
