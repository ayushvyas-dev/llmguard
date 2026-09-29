import { Router } from 'express';
import { auditController } from './audit.controller.js';

const auditRouter = Router();

auditRouter.get('/', auditController.getEvents);

export default auditRouter;
