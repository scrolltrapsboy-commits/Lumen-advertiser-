const express = require('express');
const path = require('path');
const router = express.Router();

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const PAGE_MAP = {
  '/': 'index.html',
  '/login': 'login.html',
  '/signup': 'signup.html',
  '/forgot-password': 'forgot-password.html',
  '/dashboard': 'dashboard.html',
  '/admin': 'admin.html',
  '/display': 'display.html',
  '/upload': 'upload.html',
  '/history': 'history.html',
  '/settings': 'settings.html'
};

Object.entries(PAGE_MAP).forEach(([route, file]) => {
  router.get(route, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, file));
  });
});

module.exports = router;
