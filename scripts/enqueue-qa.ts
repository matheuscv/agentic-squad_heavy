/**
 * Enfileira manualmente um job para o agente QA.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/enqueue-qa.ts SCRUM-16
 */

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import * as schema from '../src/db/schema';

const jiraKey = process.argv[2];
if (!jiraKey) {
  console.error('Uso: npx tsx --env-file=.env scripts/enqueue-qa.ts <JIRA_KEY>');
  process.exit(1);
}

const rawUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const redisUrl =
  rawUrl.includes('upstash.io') && rawUrl.startsWith('redis://')
    ? rawUrl.replace('redis://', 'rediss://')
    : rawUrl;

const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
const pgClient = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await pgClient.connect();
  const db = drizzle(pgClient, { schema });

  const [story] = await db
    .select()
    .from(schema.stories)
    .where(eq(schema.stories.jiraKey, jiraKey))
    .limit(1);

  if (!story) {
    console.error(`Story ${jiraKey} não encontrada no banco.`);
    process.exit(1);
  }

  const agentRunId = randomUUID();

  const [agentRun] = await db
    .insert(schema.agentRuns)
    .values({
      id: agentRunId,
      storyId: story.id,
      agentType: 'qa',
      status: 'pending',
      startedAt: new Date(),
    })
    .returning();

  const queue = new Queue('agent-qa', { connection });

  const job = await queue.add(
    'qa:run',
    {
      storyId: story.id,
      jiraKey: story.jiraKey,
      agentRunId: agentRun.id,
      summary: story.jiraSummary ?? jiraKey,
      fromStatus: 'Em Desenvolvimento',
    },
    { jobId: `qa-${jiraKey}-${agentRunId}` },
  );

  console.log(`✅ Job enfileirado para ${jiraKey}`);
  console.log(`   job id     : ${job.id}`);
  console.log(`   agentRunId : ${agentRunId}`);
  console.log(`   storyId    : ${story.id}`);

  await queue.close();
  await pgClient.end();
  await connection.quit();
}

main().catch((err: Error) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
