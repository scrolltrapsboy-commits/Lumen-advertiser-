const express = require('express');
const router = express.Router();
const adController = require('../controllers/ad.controller');
const { requireAuth, requireAdmin, requireAdvertiser, requireAdvertiserOrAdmin } = require('../middleware/auth.middleware');
const { upload } = require('../config/multer');

router.get('/ads', requireAuth, adController.list);
router.put('/ads/:id/status', requireAdmin, adController.setStatus);
router.put('/ads/:id/renew', requireAuth, adController.renew);
router.put('/ads/:id/duration', requireAdmin, adController.updateDuration);
router.post('/ads/:id/duplicate', requireAuth, adController.duplicate);
router.delete('/ads/:id', requireAuth, adController.remove);

router.post('/upload', requireAdvertiserOrAdmin, upload.single('file'), adController.upload);

router.get('/display/:screenId', adController.display);

module.exports = router;
