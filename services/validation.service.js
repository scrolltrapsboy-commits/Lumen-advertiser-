function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function isValidPassword(password) {
  return String(password || '').length >= 6;
}

function validateFileSize(sizeBytes, type, settings) {
  const maxMB = type === 'image' ? (settings.maxImageMB || 10) : (settings.maxVideoMB || 100);
  const maxBytes = maxMB * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    return {
      ok: false,
      message: type === 'image'
        ? `This image exceeds the maximum allowed size of ${maxMB}MB.`
        : `This video exceeds the maximum allowed size of ${maxMB}MB.`
    };
  }
  return { ok: true };
}

function validateImageDuration(seconds) {
  const allowedDurations = [5, 6, 7, 8, 9, 10];
  if (!allowedDurations.includes(Number(seconds))) {
    return { ok: false, message: 'Image duration must be between 5 and 10 seconds.' };
  }
  return { ok: true };
}

function validateVideoDuration(seconds, maxSeconds = 60) {
  if (Number(seconds) > Number(maxSeconds)) {
    return { ok: false, message: `This video exceeds the maximum allowed duration of ${maxSeconds} seconds.` };
  }
  return { ok: true };
}

function mediaTypeFromMime(mimetype, settings) {
  if ((settings.allowedImageTypes || []).includes(mimetype)) return 'image';
  if ((settings.allowedVideoTypes || []).includes(mimetype)) return 'video';
  return null;
}

module.exports = { isValidEmail, isValidPassword, validateFileSize, validateImageDuration, validateVideoDuration, mediaTypeFromMime };
