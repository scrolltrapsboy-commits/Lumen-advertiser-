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

// Rule (latest spec): ANY portrait dimension is valid - the only
// requirement is height > width. There is no exact-9:16 (or "close to
// 9:16") ratio requirement anymore: 1080x1500, 1000x1800, and 800x1200
// are all accepted, exactly like 1080x1920 - only landscape (width >
// height) and square (width === height) are rejected.
export function isPortrait(width, height) {
  if (!width || !height) return false;
  return height > width;
}

export const PORTRAIT_REJECTION_MESSAGE = 'Only portrait images and videos are allowed (height must be greater than width). Landscape and square media are not supported.';

/**
 * Reads the file's REAL rendered dimensions (naturalWidth/naturalHeight
 * for images, videoWidth/videoHeight for video) - never the filename,
 * extension, MIME type, or any manually-entered value - and checks that
 * height > width. Works from an already-created object URL so callers
 * that already made one (upload.js/admin.js do, for the TV preview)
 * don't need to create a second one.
 *
 * @param {string} url - object URL for the file.
 * @param {'image'|'video'} type
 * @returns {Promise<{ok:true,width:number,height:number}|{ok:false,message:string}>}
 */
export function validatePortraitDimensions(url, type) {
  return new Promise((resolve) => {
    if (type === 'video') {
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.src = url;
      const finish = () => {
        const width = probe.videoWidth;
        const height = probe.videoHeight;
        if (!width || !height) {
          resolve({ ok: false, message: "Could not read this video's dimensions. Please try a different file." });
          return;
        }
        resolve(isPortrait(width, height)
          ? { ok: true, width, height }
          : { ok: false, message: PORTRAIT_REJECTION_MESSAGE });
      };
      probe.onloadedmetadata = finish;
      probe.onerror = () => resolve({ ok: false, message: "Could not read this video's dimensions. Please try a different file." });
    } else {
      const img = new Image();
      img.onload = () => {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        if (!width || !height) {
          resolve({ ok: false, message: "Could not read this image's dimensions. Please try a different file." });
          return;
        }
        resolve(isPortrait(width, height)
          ? { ok: true, width, height }
          : { ok: false, message: PORTRAIT_REJECTION_MESSAGE });
      };
      img.onerror = () => resolve({ ok: false, message: "Could not read this image's dimensions. Please try a different file." });
      img.src = url;
    }
  });
}

export function validateImageDuration(seconds) {
  const allowedDurations = [5, 6, 7, 8, 9, 10];
  if (!allowedDurations.includes(Number(seconds))) {
    return { ok: false, message: 'Image duration must be between 5 and 10 seconds.' };
  }
  return { ok: true };
}
