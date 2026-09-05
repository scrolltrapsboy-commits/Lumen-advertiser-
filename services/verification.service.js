/**
 * Advertiser-only upload verification: content safety, OCR business-name
 * extraction, and business-name matching.
 *
 * IMPORTANT - READ BEFORE WIRING THIS INTO THE UPLOAD ROUTE:
 *
 * checkContentSafety() and extractBusinessIdentifiers() below are
 * INTENTIONALLY UNIMPLEMENTED STUBS. They require a real external
 * provider - an image/video moderation API (e.g. Google Cloud Vision
 * SafeSearch, AWS Rekognition, Azure Content Moderator, Hive, Sightengine)
 * for content safety, and an OCR API (e.g. Google Cloud Vision OCR, AWS
 * Textract, Azure Computer Vision) for business-name extraction. This
 * environment has no network access and no vision/OCR model available to
 * call, so there is no way to actually inspect image/video pixels here.
 *
 * Both stubs deliberately return status: 'UNAVAILABLE' rather than a fake
 * 'SAFE'/'MATCH' result. A fabricated pass would be actively dangerous for
 * a safety-critical check like adult-content detection - it would look
 * like a real moderation gate while doing nothing. The calling code (see
 * ad.controller.js) treats 'UNAVAILABLE' as "do not publish" per the
 * spec's own failure-handling rule ("If moderation fails: Do NOT
 * automatically approve"), so as shipped, advertiser uploads are held
 * until a real provider is wired into these two functions.
 *
 * matchBusiness() below is fully implemented - it's plain string
 * normalization/comparison, no external service required.
 */

/**
 * STUB - requires a real moderation provider. See file header.
 * @param {string} mediaPath - absolute path to the uploaded file on disk.
 * @param {'image'|'video'} mediaType
 * @returns {Promise<{status: 'SAFE'|'REJECTED'|'UNAVAILABLE', reason?: string}>}
 */
async function checkContentSafety(mediaPath, mediaType) {
  // TODO: call the chosen moderation provider here, using
  // process.env.AI_MODERATION_API_KEY. For video, sample multiple frames
  // across the clip (not just the first frame) per the spec - most
  // moderation APIs only accept still images, so this typically means
  // extracting frames (e.g. via ffmpeg) and calling the image endpoint
  // once per frame.
  return { status: 'UNAVAILABLE', reason: 'Content moderation provider is not configured.' };
}

/**
 * STUB - requires a real OCR provider. See file header.
 * @param {string} mediaPath
 * @param {'image'|'video'} mediaType
 * @returns {Promise<{status: 'OK'|'UNAVAILABLE', text: string[], reason?: string}>}
 */
async function extractBusinessIdentifiers(mediaPath, mediaType) {
  // TODO: call the chosen OCR provider here, using process.env.OCR_API_KEY.
  // Return every distinct text fragment found (business name, phone,
  // address, website, etc.) - matchBusiness() below checks all of them
  // against the selected business, not just one field.
  return { status: 'UNAVAILABLE', text: [], reason: 'OCR provider is not configured.' };
}

/**
 * Real, working normalized comparison - no external service needed.
 * Lowercases, strips punctuation/common legal suffixes (Pvt Ltd, LLC,
 * Inc, ...), collapses whitespace, then checks for a substring/token-
 * overlap match in either direction so "ABC Bakery" matches
 * "ABC Bakery Pvt Ltd" and vice versa.
 *
 * @param {string[]} extractedTexts - text fragments from OCR.
 * @param {string} selectedBusinessName
 * @returns {{status: 'MATCH'|'NO_MATCH', confidence: number, matchedText: string|null}}
 */
function matchBusiness(extractedTexts, selectedBusinessName) {
  const normalize = (s) => String(s || '')
    .toLowerCase()
    .replace(/\b(pvt\.?|private|ltd\.?|limited|llc|inc\.?|corp\.?|co\.?)\b/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const target = normalize(selectedBusinessName);
  if (!target) return { status: 'NO_MATCH', confidence: 0, matchedText: null };

  let best = { status: 'NO_MATCH', confidence: 0, matchedText: null };

  for (const raw of (extractedTexts || [])) {
    const candidate = normalize(raw);
    if (!candidate) continue;

    let confidence = 0;
    if (candidate === target) {
      confidence = 100;
    } else if (candidate.includes(target) || target.includes(candidate)) {
      confidence = 90;
    } else {
      // Token overlap: how many of the target's significant words appear
      // in the candidate text.
      const targetTokens = target.split(' ').filter((t) => t.length > 2);
      const candidateTokens = new Set(candidate.split(' ').filter((t) => t.length > 2));
      if (targetTokens.length > 0) {
        const overlap = targetTokens.filter((t) => candidateTokens.has(t)).length;
        confidence = Math.round((overlap / targetTokens.length) * 100);
      }
    }

    if (confidence > best.confidence) {
      best = { status: confidence >= 60 ? 'MATCH' : 'NO_MATCH', confidence, matchedText: raw };
    }
  }

  return best;
}

module.exports = { checkContentSafety, extractBusinessIdentifiers, matchBusiness };
