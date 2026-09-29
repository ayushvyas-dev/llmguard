import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import scanRouter from '../modules/scan/scan.routes.js';
import toolRouter from '../modules/tool-security/tool.routes.js';
import verificationRouter from '../modules/verification/verification.routes.js';
import documentRouter from '../modules/verification/document.routes.js';
import auditRouter from '../modules/audit/audit.routes.js';

const apiRouter = Router();

// Protected V1 API routes
apiRouter.use('/scan', authMiddleware, scanRouter);
apiRouter.use('/tools', authMiddleware, toolRouter);
apiRouter.use('/verify', authMiddleware, verificationRouter);
apiRouter.use('/documents', authMiddleware, documentRouter);
apiRouter.use('/audit-events', authMiddleware, auditRouter);

export default apiRouter;
