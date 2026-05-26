import { config } from 'dotenv';
config();

// Render free tier não suporta IPv6 de saída — força resolução DNS para IPv4
import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

import { createPoAgentWorker } from './agents/po';
import { createLtAgentWorker } from './agents/lt';
import { createDevAgentWorker } from './agents/dev-agent';
import { createQaAgentWorker } from './agents/qa-agent';
import { logger } from './lib/logger';

// ─── Inicialização dos workers ────────────────────────────────────────────────

const poAgentWorker   = createPoAgentWorker();
const ltAgentWorker   = createLtAgentWorker();
const devAgentWorker  = createDevAgentWorker();
const qaAgentWorker   = createQaAgentWorker();

logger.info({ env: process.env.NODE_ENV ?? 'development' }, 'workers iniciados — aguardando jobs');

// ─── Graceful shutdown ────────────────────────────────────────────────────────

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'sinal recebido — encerrando workers');
  await Promise.allSettled([
    poAgentWorker.close(),
    ltAgentWorker.close(),
    devAgentWorker.close(),
    qaAgentWorker.close(),
  ]);
  logger.info('workers encerrados com sucesso');
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));
