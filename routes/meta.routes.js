const express = require('express');
const router = express.Router();
const metaController = require('../controllers/meta.controller');

router.get('/', metaController.get);

module.exports = router;
