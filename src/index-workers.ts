import { config } from 'dotenv';
config();

// Render free tier não suporta IPv6 de saída — força resolução DNS para IPv4
import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

import { createPoAgentWorker } from './agents/po';
import { createLtAgentWorker } from './agents/lt';
import { createDevAgentWorker } from './agents/dev-agent';
import { createQaAgentWorker } from './agents/qa-agent';
import { poAgentQueue } from './agents/po';
import { ltAgentQueue } from './agents/lt';
import { devAgentQueue } from './agents/dev-agent';
import { qaAgentQueue } from './agents/qa-agent';
import { agentDlqQueue } from './queue/index';
import { logger } from './lib/logger';
import { recoverInterruptedRuns } from './lib/startup-recovery';

// ─── Inicialização dos workers ────────────────────────────────────────────────

const poAgentWorker   = createPoAgentWorker();
const ltAgentWorker   = createLtAgentWorker();
const devAgentWorker  = createDevAgentWorker();
const qaAgentWorker   = createQaAgentWorker();

logger.info({ env: process.env.NODE_ENV ?? 'development' }, 'workers iniciados — aguardando jobs');

// Recupera jobs interrompidos por crash/restart anterior
void recoverInterruptedRuns({ po: poAgentQueue, lt: ltAgentQueue, dev: devAgentQueue, qa: qaAgentQueue });

// ─── Graceful shutdown ────────────────────────────────────────────────────────
//
// Drena jobs ativos antes de fechar, com timeout de 30s para evitar hang indefinido.

const SHUTDOWN_TIMEOUT_MS = 30_000;

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'sinal recebido — iniciando graceful shutdown dos workers');

  const forceExitTimer = setTimeout(() => {
    logger.warn({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'timeout de graceful shutdown — saindo forçado');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  logger.info('aguardando jobs ativos concluírem...');
  await Promise.allSettled([
    poAgentWorker.close(),
    ltAgentWorker.close(),
    devAgentWorker.close(),
    qaAgentWorker.close(),
  ]);
  logger.info('workers drenados');

  await Promise.allSettled([
    poAgentQueue.close(),
    ltAgentQueue.close(),
    devAgentQueue.close(),
    qaAgentQueue.close(),
    agentDlqQueue.close(),
  ]);

  clearTimeout(forceExitTimer);
  logger.info('workers encerrados com sucesso');
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));
