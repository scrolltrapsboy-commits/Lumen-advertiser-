/**
 * The server-side twin of public/assets/js/utils/validation.js's
 * isPortrait()/PORTRAIT_REJECTION_MESSAGE - same rule, same message, so
 * a file that passes/fails in the browser passes/fails identically here
 * (this is the copy that actually matters: the client-side check is
 * only a UX convenience, this one is the real enforcement with no
 * bypass for any role).
 *
 * Rule (as of the latest spec): ANY portrait dimension is valid - the
 * only requirement is height > width. There is no longer an exact-9:16
 * (or "close to 9:16") ratio requirement; a 1080x1500 or 800x1200 image
 * is just as valid as 1080x1920.
 */
function isPortrait(width, height) {
  if (!width || !height) return false;
  return height > width;
}

const PORTRAIT_REJECTION_MESSAGE = 'Only portrait images and videos are allowed (height must be greater than width). Landscape and square media are not supported.';

module.exports = { isPortrait, PORTRAIT_REJECTION_MESSAGE };
