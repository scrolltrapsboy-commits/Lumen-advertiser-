export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

export function isValidPassword(password) {
  return String(password || '').length >= 6;
}

export function validateMediaFile(file, config) {
  if (!file) return { ok: false, message: 'Select a file to continue.' };
  const isImage = config.allowedImageTypes.includes(file.type);
  const isVideo = config.allowedVideoTypes.includes(file.type);
  if (!isImage && !isVideo) {
    return { ok: false, message: 'Unsupported file format. Use PNG, JPG, WEBP, MP4, MOV or WEBM.' };
  }
  const type = isImage ? 'image' : 'video';
  const sizeCheck = validateFileSize(file, type, config);
  if (!sizeCheck.ok) return sizeCheck;
  return { ok: true, type };
}

export function validateFileSize(file, type, config) {
  const maxMB = type === 'image' ? (config.maxImageMB || 10) : (config.maxVideoMB || 100);
  const maxBytes = maxMB * 1024 * 1024;
  if (file.size > maxBytes) {
    return {
      ok: false,
      message: type === 'image'
        ? `This image exceeds the maximum allowed size of ${maxMB}MB.`
        : `This video exceeds the maximum allowed size of ${maxMB}MB.`
    };
  }
  return { ok: true };
}

export function validateVideoDuration(seconds, maxSeconds = 60) {
  if (seconds > maxSeconds) {
    return { ok: false, message: `This video exceeds the maximum allowed duration of ${maxSeconds} seconds.` };
  }
  return { ok: true };
}

export function validateImageDuration(seconds) {
  const allowedDurations = [5, 6, 7, 8, 9, 10];
  if (!allowedDurations.includes(Number(seconds))) {
    return { ok: false, message: 'Image duration must be between 5 and 10 seconds.' };
  }
  return { ok: true };
}
