import { Router } from 'express';
import { toolController } from './tool.controller.js';

const router = Router();

router.post('/validate', toolController.validate);
router.post('/', toolController.create);
router.get('/', toolController.list);
router.delete('/:toolId', toolController.delete);

export default router;
