import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { rateLimitMiddleware } from './middleware/rate-limit.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import healthRouter from './modules/health/health.route.js';
import apiRouter from './routes/index.js';

const app = express();

// Security headers & CORS
app.use(helmet());
app.use(cors());

// Request parsing & ID tagging
app.use(express.json({ limit: '1mb' }));
app.use(requestIdMiddleware);

// Rate limiting
app.use(rateLimitMiddleware);

// Public health check routes
app.use('/health', healthRouter);
app.use('/api/v1/health', healthRouter);

// Main V1 API routes (support both /v1 and /api/v1)
app.use('/v1', apiRouter);
app.use('/api/v1', apiRouter);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.path}`,
      requestId: req.id,
    },
  });
});

// Error handling middleware
app.use(errorMiddleware);

export default app;
