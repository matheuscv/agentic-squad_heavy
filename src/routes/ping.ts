import { Router, type Request, type Response } from 'express';
import { childLogger } from '../lib/logger';

// ─── Versão do liveness probe ─────────────────────────────────────────────────
// Atualize este valor a cada bump de release (ex: v1.1.0, v2.0.0)
const VERSION = '1.0.0';

const log = childLogger({ module: 'ping' });

const pingRouter = Router();

// GET / — liveness probe sem dependências externas
pingRouter.get('/', (_req: Request, res: Response): void => {
  log.debug({ route: '/ping' }, 'ping recebido');
  res.status(200).json({ status: 'ok', version: VERSION });
});

export default pingRouter;
