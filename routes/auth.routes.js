const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

router.post('/login', authController.login);
router.post('/signup', authController.signup);
router.post('/logout', authController.logout);
router.get('/session', authController.getSession);
router.post('/reset-password', authController.resetPassword);
router.put('/profile', authController.updateProfile);

module.exports = router;
