const express = require('express');
const router = express.Router();
const placesController = require('../controllers/places.controller');
const { requireAdvertiser } = require('../middleware/auth.middleware');

// Advertiser-only, deliberately NOT requireAdvertiserOrAdmin - the Admin
// Add Advertisement flow must never touch Google Places / nearby-business
// search per the spec's explicit "two separate upload flows" requirement.
router.get('/nearby', requireAdvertiser, placesController.nearby);

module.exports = router;
