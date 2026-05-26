import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock IORedis ─────────────────────────────────────────────────────────────

const mockEval = vi.fn();
const mockRedis = {
  eval: mockEval,
} as unknown as import('ioredis').default;

// ─── Helpers de tempo ─────────────────────────────────────────────────────────

function advanceTimers(ms: number) {
  return vi.advanceTimersByTimeAsync(ms);
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('waitForAnthropicCapacity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retorna imediatamente quando Redis retorna -1 (capacidade disponível)', async () => {
    mockEval.mockResolvedValueOnce(-1);

    const { waitForAnthropicCapacity } = await import('./anthropic-rate-limiter');

    const promise = waitForAnthropicCapacity(mockRedis);
    await promise;

    expect(mockEval).toHaveBeenCalledOnce();
  });

  it('retorna imediatamente com tokens estimados padrão (sem parâmetro)', async () => {
    mockEval.mockResolvedValueOnce(-1);

    const { waitForAnthropicCapacity } = await import('./anthropic-rate-limiter');

    await waitForAnthropicCapacity(mockRedis);
    expect(mockEval).toHaveBeenCalledOnce();
  });

  it('retorna imediatamente com tokens estimados personalizados', async () => {
    mockEval.mockResolvedValueOnce(-1);

    const { waitForAnthropicCapacity } = await import('./anthropic-rate-limiter');

    await waitForAnthropicCapacity(mockRedis, 5_000);
    expect(mockEval).toHaveBeenCalledOnce();
  });

  it('tenta novamente quando Redis retorna capacidade insuficiente, e sucede na 2ª tentativa', async () => {
    // 1ª chamada: capacidade insuficiente (retorna valor positivo)
    mockEval.mockResolvedValueOnce(20_000);
    // 2ª chamada: sucesso
    mockEval.mockResolvedValueOnce(-1);

    const { waitForAnthropicCapacity } = await import('./anthropic-rate-limiter');

    const promise = waitForAnthropicCapacity(mockRedis);

    // Avança o timer para a janela de espera (WINDOW_MS / 4 = ~15.5s, capped em 15s)
    await advanceTimers(16_000);
    await promise;

    expect(mockEval).toHaveBeenCalledTimes(2);
  });

  it('tenta novamente múltiplas vezes antes de conseguir capacidade', async () => {
    // 3 falhas, depois sucesso
    mockEval
      .mockResolvedValueOnce(22_000)
      .mockResolvedValueOnce(21_000)
      .mockResolvedValueOnce(23_000)
      .mockResolvedValueOnce(-1);

    const { waitForAnthropicCapacity } = await import('./anthropic-rate-limiter');

    const promise = waitForAnthropicCapacity(mockRedis);

    // Avança timers para cobrir os 3 sleep(15000)
    await advanceTimers(16_000);
    await advanceTimers(16_000);
    await advanceTimers(16_000);
    await promise;

    expect(mockEval).toHaveBeenCalledTimes(4);
  });

  it('passa após deadline de 3 minutos sem capacidade (fallback)', async () => {
    // Redis sempre retorna capacidade insuficiente — deve expirar o deadline e retornar
    mockEval.mockResolvedValue(24_000);

    const { waitForAnthropicCapacity } = await import('./anthropic-rate-limiter');

    const promise = waitForAnthropicCapacity(mockRedis);

    // Avança além de 180s (3 min = deadline)
    await advanceTimers(200_000);
    await promise; // deve resolver sem lançar erro

    // Chamou eval pelo menos uma vez
    expect(mockEval).toHaveBeenCalled();
  });

  it('chama redis.eval com os parâmetros corretos', async () => {
    mockEval.mockResolvedValueOnce(-1);

    const { waitForAnthropicCapacity } = await import('./anthropic-rate-limiter');

    await waitForAnthropicCapacity(mockRedis, 1_000);

    // Verifica que eval foi chamado com: script, numKeys=1, key, now, window, tokens, max, eid
    const callArgs = mockEval.mock.calls[0];
    expect(callArgs).toBeDefined();
    // Primeiro arg: script Lua (string)
    expect(typeof callArgs[0]).toBe('string');
    // numKeys
    expect(callArgs[1]).toBe(1);
    // key
    expect(callArgs[2]).toBe('anthropic:tpm:window');
    // now (timestamp em ms como string)
    expect(typeof callArgs[3]).toBe('string');
    // window
    expect(callArgs[4]).toBe('62000');
    // tokens personalizados
    expect(callArgs[5]).toBe('1000');
    // max
    expect(callArgs[6]).toBe('24000');
  });

  it('chama redis.eval com tokens padrão (8000) quando não especificado', async () => {
    mockEval.mockResolvedValueOnce(-1);

    const { waitForAnthropicCapacity } = await import('./anthropic-rate-limiter');

    await waitForAnthropicCapacity(mockRedis);

    const callArgs = mockEval.mock.calls[0];
    // tokens padrão = 8_000
    expect(callArgs[5]).toBe('8000');
  });

  it('não lança erro mesmo que Redis falhe (capacidade fica esgotada por deadline)', async () => {
    mockEval.mockRejectedValue(new Error('Redis connection refused'));

    const { waitForAnthropicCapacity } = await import('./anthropic-rate-limiter');

    const promise = waitForAnthropicCapacity(mockRedis);
    // Avança para o deadline
    await advanceTimers(200_000);

    await expect(promise).resolves.toBeUndefined();
  });
});
