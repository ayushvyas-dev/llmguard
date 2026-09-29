import { Router } from 'express';

const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  return res.status(200).json({
    status: 'ok',
    service: 'llm-guard',
    timestamp: new Date().toISOString(),
  });
});

export default healthRouter;
