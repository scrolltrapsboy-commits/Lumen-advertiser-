const path = require('path');

/**
 * Produces the canonical, browser-usable HTTP(S) URL for a stored ad's
 * media. The frontend must NEVER receive a filesystem path (Render disk
 * path, Windows drive path, relative project path) - only this function's
 * output is allowed to leave the server as `mediaUrl`.
 *
 * Resolution order:
 *   1. Already an absolute http(s) URL (object storage / CDN / Cloudinary
 *      etc.) -> returned unchanged, so swapping in real object storage
 *      later requires no changes here.
 *   2. Anything that looks like a filesystem path (Windows drive letter,
 *      absolute unix path, relative "./" path, or contains a backslash) is
 *      defensively reduced to just the /uploads/<filename> tail - this is
 *      the only thing besides a real URL that's allowed through.
 *   3. A root-relative path (e.g. "/uploads/x.jpg") is resolved to an
 *      absolute URL. If SITE_URL is explicitly configured, that's used as
 *      the canonical origin (matches the deployment's real public domain).
 *      Otherwise the CURRENT REQUEST's own protocol+host is used - this is
 *      deliberately preferred over a possibly-stale/mismatched SITE_URL
 *      default, since it can never point at the wrong domain.
 */
function resolveMediaUrl(mediaUrl, req) {
  if (!mediaUrl) return mediaUrl;

  if (/^https?:\/\//i.test(mediaUrl)) return mediaUrl;

  let publicPath = mediaUrl;
  const looksLikeFilesystemPath =
    /^[a-zA-Z]:\\/.test(publicPath) ||
    publicPath.startsWith('/var/') ||
    publicPath.startsWith('/opt/') ||
    publicPath.startsWith('./') ||
    publicPath.includes('\\');
  if (looksLikeFilesystemPath) {
    // path.basename() alone assumes POSIX separators on a POSIX server, so
    // a Windows-style path (backslashes) would pass through unsplit. Split
    // on whichever separator style is actually present.
    const parts = publicPath.split(/[\\/]/).filter(Boolean);
    publicPath = `/uploads/${parts[parts.length - 1] || ''}`;
  }
  if (!publicPath.startsWith('/')) publicPath = `/${publicPath}`;

  const configuredSiteUrl = (process.env.SITE_URL || '').trim();
  const origin = configuredSiteUrl
    ? configuredSiteUrl.replace(/\/$/, '')
    : (req ? `${req.protocol}://${req.get('host')}` : '');

  return origin ? `${origin}${publicPath}` : publicPath;
}

module.exports = { resolveMediaUrl };
