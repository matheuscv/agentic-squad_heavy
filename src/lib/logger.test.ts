import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Logger ───────────────────────────────────────────────────────────────────

describe('logger', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('exporta objeto logger com método info', async () => {
    const { logger } = await import('./logger');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('exporta childLogger como função', async () => {
    const { childLogger } = await import('./logger');
    expect(typeof childLogger).toBe('function');
  });

  it('childLogger retorna objeto com métodos de log', async () => {
    const { childLogger } = await import('./logger');
    const child = childLogger({ module: 'test-module' });
    expect(typeof child.info).toBe('function');
    expect(typeof child.warn).toBe('function');
    expect(typeof child.error).toBe('function');
    expect(typeof child.debug).toBe('function');
  });

  it('childLogger aceita contexto com múltiplos campos', async () => {
    const { childLogger } = await import('./logger');
    const child = childLogger({ module: 'auth', submodule: 'jwt', version: 2 });
    expect(child).toBeDefined();
    // Não deve lançar erro ao logar
    expect(() => child.info('test message')).not.toThrow();
  });

  it('não lança erro ao invocar logger.info com objeto', async () => {
    const { logger } = await import('./logger');
    expect(() => logger.info({ key: 'value' }, 'mensagem de teste')).not.toThrow();
  });

  it('não lança erro ao invocar logger.warn com erro', async () => {
    const { logger } = await import('./logger');
    const err = new Error('teste');
    expect(() => logger.warn({ err }, 'aviso')).not.toThrow();
  });

  it('não lança erro ao invocar logger.error', async () => {
    const { logger } = await import('./logger');
    expect(() => logger.error('erro crítico')).not.toThrow();
  });

  it('logger usa level "debug" quando NODE_ENV não é production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.resetModules();
    const { logger } = await import('./logger');
    expect(logger.level).toBe('debug');
  });

  it('logger usa level "info" quando NODE_ENV é production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { logger } = await import('./logger');
    expect(logger.level).toBe('info');
  });
});
