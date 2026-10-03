import { Router } from 'express';
import { scanController } from './scan.controller.js';

const router = Router();

router.post('/', scanController.scan);
router.post('/content', scanController.scanContent);

export default router;
