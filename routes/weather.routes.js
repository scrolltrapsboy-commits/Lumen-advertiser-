const express = require('express');
const router = express.Router();
const weatherController = require('../controllers/weather.controller');

// Public, same as GET /api/display/:screenId - the unauthenticated Big
// Display page itself is the caller, not an admin session.
router.get('/:screenId', weatherController.forScreen);

module.exports = router;
