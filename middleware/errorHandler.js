const multer = require('multer');

function notFoundHandler(req, res, next) {
  res.status(404).json({ ok: false, message: 'Resource not found.' });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof multer.MulterError) {
    let message = 'Upload failed.';
    if (err.code === 'LIMIT_FILE_SIZE') message = 'File is too large.';
    return res.status(400).json({ ok: false, message });
  }

  const statusCode = err.statusCode || 500;
  console.error('Unhandled error:', err.message);
  res.status(statusCode).json({
    ok: false,
    message: statusCode === 500 ? 'Something went wrong. Please try again.' : err.message
  });
}

module.exports = { notFoundHandler, errorHandler };
