const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { requireAdmin } = require('../middleware/auth.middleware');

router.get('/', requireAdmin, userController.list);
router.delete('/:id', requireAdmin, userController.remove);

module.exports = router;
