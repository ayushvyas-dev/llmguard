import { Router } from 'express';
import { verificationController } from './verification.controller.js';

const router = Router();

router.post('/', verificationController.createJob);
router.get('/:jobId', verificationController.getJob);

export default router;
