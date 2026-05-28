import IORedis from 'ioredis';
import { Queue } from 'bullmq';

// Mesma lógica TLS do index.ts — Upstash exige rediss://
const rawUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
export const redisUrl =
  rawUrl.includes('upstash.io') && rawUrl.startsWith('redis://')
    ? rawUrl.replace('redis://', 'rediss://')
    : rawUrl;

// BullMQ exige maxRetriesPerRequest: null
export const redisConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  connectTimeout: 8_000,
});

redisConnection.on('error', (err: Error) => {
  console.error('[queue] redis error:', err.message);
});

export const orchestratorQueue = new Queue('orchestrator', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

export const agentDlqQueue = new Queue('agent-dlq', {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 200 },
  },
});

export type DlqJobData = {
  originalQueue: string;
  jobId: string | undefined;
  jobData: unknown;
  failedAt: string;
  errorMessage: string;
  attemptsMade: number;
};

export type OrchestratorJobData = {
  jiraKey: string;
  issueId: string;
  summary: string;
  fromStatus: string | null;
  toStatus: string | null;
  currentStatus: string;
  receivedAt: string;
};
