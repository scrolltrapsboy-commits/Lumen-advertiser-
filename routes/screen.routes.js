const express = require('express');
const router = express.Router();
const screenController = require('../controllers/screen.controller');
const { requireAdmin } = require('../middleware/auth.middleware');

router.get('/', screenController.list);
router.get('/:id', screenController.getOne);
router.post('/', requireAdmin, screenController.create);
router.put('/:id', requireAdmin, screenController.update);
router.delete('/:id', requireAdmin, screenController.remove);

module.exports = router;
