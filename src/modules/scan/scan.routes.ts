import { Router } from 'express';
import { scanController } from './scan.controller.js';

const router = Router();

router.post('/', scanController.scan);

export default router;
