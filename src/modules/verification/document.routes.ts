import { Router } from 'express';
import { documentController } from './document.controller.js';

const router = Router();

router.post('/', documentController.create);
router.get('/:documentId', documentController.get);
router.delete('/:documentId', documentController.delete);

export default router;
