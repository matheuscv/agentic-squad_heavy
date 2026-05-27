import Anthropic from '@anthropic-ai/sdk';
import type IORedis from 'ioredis';
import { waitForAnthropicCapacity } from './anthropic-rate-limiter';

// ─── Logger estrutural mínimo — aceita pino.Logger e child loggers ────────────

export interface LoopLogger {
  debug: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_KEEP_LAST_TURNS = 5;
const RATE_LIMIT_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Retry em rate limit (429) ────────────────────────────────────────────────
//
// O contexto cresce a cada turno; nos turnos finais uma única chamada pode
// consumir quase toda a janela de 30k tokens/min. Em 429, aguarda a janela
// resetar (65s, 130s, 195s) e tenta de novo em vez de derrubar o job.

async function callClaudeWithRetry(
  create: () => Promise<Anthropic.Message>,
  onRateLimit: (attempt: number, waitMs: number) => void,
): Promise<Anthropic.Message> {
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
    try {
      return await create();
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 429 && attempt < RATE_LIMIT_RETRIES) {
        const waitMs = 65_000 * (attempt + 1);
        onRateLimit(attempt + 1, waitMs);
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
  throw new Error('unreachable');
}

// ─── Poda de contexto ─────────────────────────────────────────────────────────
//
// Substitui por placeholder o conteúdo de turnos antigos para evitar explosão de
// contexto. Poda os dois lados de cada turno antigo:
//   • tool_results (mensagens user) — saída das ferramentas
//   • tool_use inputs (mensagens assistant) — ex: o conteúdo completo de arquivos
//     escritos via write_github_file, que de outra forma acumula indefinidamente
// Mantém intactos os últimos keepLastTurns turnos e a mensagem inicial do usuário.

const PRUNED_PLACEHOLDER = '[omitido — conteúdo removido para controle de contexto]';

function pruneOldTurns(messages: Anthropic.MessageParam[], keepLastTurns: number): void {
  const keepCount = keepLastTurns * 2 + 1;
  if (messages.length <= keepCount) return;
  const pruneUntil = messages.length - keepCount;
  for (let i = 1; i < pruneUntil; i++) {
    const msg = messages[i];
    if (!msg || !Array.isArray(msg.content)) continue;

    if (msg.role === 'user') {
      msg.content = (msg.content as Anthropic.ContentBlockParam[]).map((block) =>
        block.type === 'tool_result' ? { ...block, content: PRUNED_PLACEHOLDER } : block,
      );
    } else if (msg.role === 'assistant') {
      msg.content = (msg.content as Anthropic.ContentBlockParam[]).map((block) =>
        block.type === 'tool_use' ? { ...block, input: { pruned: true } } : block,
      );
    }
  }
}

// ─── Loop de tool-use compartilhado ───────────────────────────────────────────

export type ToolDispatcher = (block: Anthropic.ToolUseBlock) => Promise<string>;

export interface RunAgentLoopOptions<T> {
  anthropic: Anthropic;
  redis: IORedis;
  model: string;
  system: string;
  tools: Anthropic.Tool[];
  /** Seeded com a mensagem inicial do usuário; é mutado in-place ao longo do loop. */
  messages: Anthropic.MessageParam[];
  maxTurns: number;
  log: LoopLogger;
  /** Executa uma ferramenta solicitada pelo Claude e retorna o resultado textual. */
  dispatchTool: ToolDispatcher;
  /** Chamado quando stop_reason === 'end_turn'. Retorna o resultado final do agente. */
  onEndTurn: (response: Anthropic.Message) => T;
  /** Nome do agente, usado em mensagens de erro (ex: "DEV", "QA"). */
  label?: string;
  maxTokens?: number;
  keepLastTurns?: number;
  /** Limite de caracteres por tool_result — rede de segurança contra contexto gigante. */
  maxToolResultChars?: number;
}

export async function runAgentLoop<T>(opts: RunAgentLoopOptions<T>): Promise<T> {
  const {
    anthropic, redis, model, system, tools, messages, maxTurns, log,
    dispatchTool, onEndTurn,
    label = 'agente',
    maxTokens = DEFAULT_MAX_TOKENS,
    keepLastTurns = DEFAULT_KEEP_LAST_TURNS,
    maxToolResultChars,
  } = opts;

  let lastInputTokens = 8_000;

  for (let turn = 0; turn < maxTurns; turn++) {
    await waitForAnthropicCapacity(redis, lastInputTokens);

    const response = await callClaudeWithRetry(
      () => anthropic.messages.create({ model, max_tokens: maxTokens, system, tools, messages }),
      (attempt, waitMs) => log.warn({ turn, attempt, waitMs }, 'rate limit 429 — aguardando janela de tokens'),
    );
    lastInputTokens = response.usage.input_tokens;

    log.debug(
      { turn, stop_reason: response.stop_reason, usage: response.usage },
      'resposta do Claude recebida',
    );

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      return onEndTurn(response);
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        let result: string;
        try {
          result = await dispatchTool(block);
        } catch (err) {
          result = `Erro ao executar ${block.name}: ${(err as Error).message}`;
          log.warn({ tool: block.name, err: (err as Error).message }, 'ferramenta retornou erro');
        }

        if (maxToolResultChars && result.length > maxToolResultChars) {
          result =
            result.slice(0, maxToolResultChars) +
            `\n\n[... truncado — ${result.length - maxToolResultChars} chars omitidos para controle de contexto ...]`;
        }

        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      }

      messages.push({ role: 'user', content: toolResults });
      if (keepLastTurns > 0) pruneOldTurns(messages, keepLastTurns);
      continue;
    }

    throw new Error(`stop_reason inesperado: ${response.stop_reason}`);
  }

  throw new Error(`Agente ${label} excedeu o limite de ${maxTurns} turnos`);
}
