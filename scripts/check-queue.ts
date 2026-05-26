import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const rawUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const redisUrl =
  rawUrl.includes('upstash.io') && rawUrl.startsWith('redis://')
    ? rawUrl.replace('redis://', 'rediss://')
    : rawUrl;

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const queue = new Queue('orchestrator', { connection });

async function main() {
  const [waiting, active, completed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ]);

  console.log('\n📊 Estado da fila "orchestrator":');
  console.log(`   waiting:   ${waiting}`);
  console.log(`   active:    ${active}`);
  console.log(`   completed: ${completed}`);
  console.log(`   failed:    ${failed}`);

  const jobs = await queue.getJobs(['waiting', 'active', 'completed', 'failed'], 0, 10);

  if (jobs.length === 0) {
    console.log('\n   Nenhum job encontrado — webhook ainda não chegou.\n');
  } else {
    console.log(`\n📋 Últimos ${jobs.length} job(s):`);
    for (const job of jobs) {
      console.log(`\n   Job ID : ${job.id}`);
      console.log(`   Nome   : ${job.name}`);
      console.log(`   Status : ${await job.getState()}`);
      console.log(`   Data   : ${JSON.stringify(job.data, null, 2).replace(/\n/g, '\n           ')}`);
    }
  }

  await queue.close();
  await connection.quit();
}

main().catch((err: Error) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
