require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const morgan = require('morgan');
const session = require('express-session');

const authRoutes = require('./routes/auth.routes');
const screenRoutes = require('./routes/screen.routes');
const adRoutes = require('./routes/ad.routes');
const userRoutes = require('./routes/user.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const settingsRoutes = require('./routes/settings.routes');
const metaRoutes = require('./routes/meta.routes');
const pageRoutes = require('./routes/page.routes');
const placesRoutes = require('./routes/places.routes');
const weatherRoutes = require('./routes/weather.routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { UPLOAD_DIR } = require('./config/multer');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);

// --- Security & performance middleware ---
app.use(
  helmet({
    frameguard: false,
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);
app.use(compression());
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(morgan(IS_PRODUCTION ? 'combined' : 'dev'));

// --- Body parsing ---
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// --- Sessions (temporary in-memory store) ---
app.use(
  session({
    name: 'lumen.sid',
    secret: process.env.SESSION_SECRET || 'lumen-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 12 // 12 hours
    }
  })
);

// --- Static assets ---
// JS/CSS get no-cache (always revalidate with the server) so that a fix
// shipped in any file - including ones only reached via an ES module
// `import` statement deep in the dependency graph, which browsers cache by
// their own exact URL regardless of the entry script's query string - is
// guaranteed to reach the browser on next load instead of being served
// from a stale cache indefinitely.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));
app.use('/uploads', express.static(UPLOAD_DIR));

// --- API routes ---
app.use('/api/auth', authRoutes);
app.use('/api/screens', screenRoutes);
app.use('/api/users', userRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/places', placesRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api', adRoutes); // exposes /api/ads, /api/upload, /api/display/:screenId

// --- Direct page routes (so refreshing any page works) ---
app.use(pageRoutes);

// --- 404 + error handling (never crash) ---
app.use('/api', notFoundHandler);
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(errorHandler);

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Lumen server running on port ${PORT}`);
});

module.exports = app;
