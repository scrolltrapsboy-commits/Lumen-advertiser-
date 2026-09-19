const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settings.controller');
const { requireAdmin } = require('../middleware/auth.middleware');

router.get('/', settingsController.get);
router.put('/', requireAdmin, settingsController.updatePricing);

module.exports = router;
