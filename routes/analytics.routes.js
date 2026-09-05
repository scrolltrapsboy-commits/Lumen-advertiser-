const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analytics.controller');
const { requireAdmin } = require('../middleware/auth.middleware');

router.get('/', requireAdmin, analyticsController.get);

module.exports = router;
