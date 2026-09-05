const path = require('path');

/**
 * Single source of truth for where persistent data lives.
 *
 * On Render, DATA_ROOT should point at the mounted disk (see render.yaml,
 * mountPath: /var/data) so that data/*.json and uploaded media survive
 * restarts, redeploys, and free-tier spin-downs - none of which preserve
 * the regular container filesystem.
 *
 * Locally (no DATA_ROOT set), this falls back to the project's existing
 * ./data and ./public/uploads folders, so local dev is unaffected.
 */
const DATA_ROOT = process.env.DATA_ROOT
  ? path.resolve(process.env.DATA_ROOT)
  : path.resolve(__dirname, '..');

const DATA_DIR = process.env.DATA_ROOT
  ? DATA_ROOT
  : path.join(DATA_ROOT, 'data');

const UPLOAD_DIR = process.env.DATA_ROOT
  ? path.join(DATA_ROOT, 'uploads')
  : path.join(DATA_ROOT, 'public', 'uploads');

module.exports = { DATA_ROOT, DATA_DIR, UPLOAD_DIR };
