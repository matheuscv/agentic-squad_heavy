import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock IORedis e BullMQ ────────────────────────────────────────────────────

const mockRedisOn = vi.fn();
const mockRedisConstructor = vi.fn().mockReturnValue({
  on: mockRedisOn,
  status: 'ready',
});

const mockQueueConstructor = vi.fn().mockReturnValue({
  add: vi.fn(),
  close: vi.fn(),
});

vi.mock('ioredis', () => ({
  default: mockRedisConstructor,
}));

vi.mock('bullmq', () => ({
  Queue: mockQueueConstructor,
}));

// ─── redisUrl — lógica de TLS ─────────────────────────────────────────────────

describe('redisUrl', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.REDIS_URL;
  });

  it('usa redis://localhost:6379 quando REDIS_URL não está definido', async () => {
    const { redisUrl } = await import('./index');
    expect(redisUrl).toBe('redis://localhost:6379');
  });

  it('mantém URL redis:// para hosts comuns (não upstash)', async () => {
    process.env.REDIS_URL = 'redis://my-redis-host:6379';
    vi.resetModules();
    const { redisUrl } = await import('./index');
    expect(redisUrl).toBe('redis://my-redis-host:6379');
  });

  it('converte redis:// para rediss:// quando host é upstash.io', async () => {
    process.env.REDIS_URL = 'redis://my-project.upstash.io:6380';
    vi.resetModules();
    const { redisUrl } = await import('./index');
    expect(redisUrl).toBe('rediss://my-project.upstash.io:6380');
  });

  it('mantém rediss:// sem alterar quando já está com TLS e é upstash', async () => {
    process.env.REDIS_URL = 'rediss://my-project.upstash.io:6380';
    vi.resetModules();
    const { redisUrl } = await import('./index');
    expect(redisUrl).toBe('rediss://my-project.upstash.io:6380');
  });

  it('não converte para rediss:// quando é upstash mas já tem schema rediss', async () => {
    process.env.REDIS_URL = 'rediss://upstash.io:6380';
    vi.resetModules();
    const { redisUrl } = await import('./index');
    expect(redisUrl).toBe('rediss://upstash.io:6380');
  });
});

// ─── orchestratorQueue ────────────────────────────────────────────────────────

describe('orchestratorQueue', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.REDIS_URL;
  });

  it('cria a fila com nome "orchestrator"', async () => {
    await import('./index');
    expect(mockQueueConstructor).toHaveBeenCalledWith(
      'orchestrator',
      expect.objectContaining({}),
    );
  });

  it('exporta orchestratorQueue com método add', async () => {
    const { orchestratorQueue } = await import('./index');
    expect(orchestratorQueue).toBeDefined();
    expect(typeof orchestratorQueue.add).toBe('function');
  });

  it('configura 3 tentativas com backoff exponencial', async () => {
    vi.resetModules();
    await import('./index');
    const callArgs = mockQueueConstructor.mock.calls[0]?.[1];
    expect(callArgs?.defaultJobOptions?.attempts).toBe(3);
    expect(callArgs?.defaultJobOptions?.backoff?.type).toBe('exponential');
  });

  it('configura removeOnComplete com count: 100', async () => {
    vi.resetModules();
    await import('./index');
    const callArgs = mockQueueConstructor.mock.calls[0]?.[1];
    expect(callArgs?.defaultJobOptions?.removeOnComplete?.count).toBe(100);
  });

  it('configura removeOnFail com count: 50', async () => {
    vi.resetModules();
    await import('./index');
    const callArgs = mockQueueConstructor.mock.calls[0]?.[1];
    expect(callArgs?.defaultJobOptions?.removeOnFail?.count).toBe(50);
  });
});

// ─── redisConnection ──────────────────────────────────────────────────────────

describe('redisConnection', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.REDIS_URL;
  });

  it('cria instância IORedis com maxRetriesPerRequest: null', async () => {
    vi.resetModules();
    await import('./index');
    const callArgs = mockRedisConstructor.mock.calls[0]?.[1];
    expect(callArgs?.maxRetriesPerRequest).toBeNull();
  });

  it('cria instância IORedis com enableReadyCheck: false', async () => {
    vi.resetModules();
    await import('./index');
    const callArgs = mockRedisConstructor.mock.calls[0]?.[1];
    expect(callArgs?.enableReadyCheck).toBe(false);
  });

  it('registra handler de erro no redis connection', async () => {
    vi.resetModules();
    await import('./index');
    expect(mockRedisOn).toHaveBeenCalledWith('error', expect.any(Function));
  });
});
