const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { readSync } = require('./db');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

// Increased hard ceiling to allow large files (per-type limits enforced in controller via settings)
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500MB

function fileFilter(req, file, cb) {
  const settings = readSync('settings.json');
  const allowed = [...(settings.allowedImageTypes || []), ...(settings.allowedVideoTypes || [])];
  if (!allowed.includes(file.mimetype)) {
    const err = new Error('Unsupported file format. Use PNG, JPG, WEBP, MP4, MOV or WEBM.');
    err.statusCode = 400;
    return cb(err);
  }
  cb(null, true);
}

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter
});

module.exports = { upload, UPLOAD_DIR };
