const fs = require('fs');
const path = require('path');
const adService = require('../services/ad.service');
const screenService = require('../services/screen.service');
const settingsService = require('../services/settings.service');
const pricingService = require('../services/pricing.service');
const { validateFileSize, validateImageDuration, mediaTypeFromMime } = require('../services/validation.service');
const { slotAvailability } = require('../services/slots.service');
const { isWithinOperatingHours, nextOpeningLabel, currentTimeLabel } = require('../services/date.util');
const { UPLOAD_DIR } = require('../config/multer');
const verificationService = require('../services/verification.service');

async function list(req, res, next) {
  try {
    const ads = await adService.listAll();
    res.json({ ok: true, ads });
  } catch (err) {
    next(err);
  }
}

function safeUnlink(filePath) {
  fs.unlink(filePath, () => {});
}

async function upload(req, res, next) {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ ok: false, message: 'Select a file to continue.' });
    }

    const settings = await settingsService.get();
    const mediaType = mediaTypeFromMime(file.mimetype, settings);
    if (!mediaType) {
      safeUnlink(file.path);
      return res.status(400).json({ ok: false, message: 'Unsupported file format. Use PNG, JPG, WEBP, MP4, MOV or WEBM.' });
    }

    const sizeCheck = validateFileSize(file.size, mediaType, settings);
    if (!sizeCheck.ok) {
      safeUnlink(file.path);
      return res.status(400).json(sizeCheck);
    }

    const { screenId, days } = req.body;
    let duration = Number(req.body.duration);

    if (mediaType === 'video') {
      const maxVideoSeconds = settings.maxVideoSeconds || 60;
      // The video itself is never rejected for being "too long" - playback
      // duration is capped server-side at MIN(admin's configured maximum,
      // client-reported actual length), the same rule enforced on the
      // frontend. This also guards against a client sending an inflated
      // duration value, since we never trust it outright.
      if (!duration || duration < 1) duration = maxVideoSeconds;
      duration = Math.min(duration, maxVideoSeconds);
    } else {
      const durationCheck = validateImageDuration(duration);
      if (!durationCheck.ok) {
        safeUnlink(file.path);
        return res.status(400).json(durationCheck);
      }
      if (!duration) {
        duration = 1;
      }
    }

    // Parse screenId - can be 'all', a JSON-encoded array of screen IDs
    // (sent by Admin's multi-screen targeting - see advertisement.service.js
    // upload(), since multipart form fields can't carry real arrays), or a
    // single screen ID string.
    let screenIds = screenId;
    if (typeof screenId === 'string') {
      if (screenId === 'all') {
        screenIds = 'all';
      } else if (screenId.trim().startsWith('[')) {
        try {
          const parsed = JSON.parse(screenId);
          screenIds = Array.isArray(parsed) ? parsed : [screenId];
        } catch (e) {
          screenIds = [screenId];
        }
      } else {
        screenIds = [screenId];
      }
    }

    // Validate screens and check availability
    let targetScreens = [];
    if (screenIds === 'all') {
      const allScreens = await screenService.list();
      targetScreens = allScreens.filter(s => s.activeState === 'active');
      if (targetScreens.length === 0) {
        safeUnlink(file.path);
        return res.status(400).json({ ok: false, message: 'No active screens available.' });
      }
    } else if (Array.isArray(screenIds)) {
      for (const id of screenIds) {
        const screen = await screenService.get(String(id).toUpperCase());
        if (!screen) {
          safeUnlink(file.path);
          return res.status(404).json({ ok: false, message: `Screen ${id} was not found.` });
        }
        if (screen.activeState === 'disabled') {
          safeUnlink(file.path);
          return res.status(400).json({ ok: false, message: `Screen ${id} is currently disabled.` });
        }
        targetScreens.push(screen);
      }
    } else {
      safeUnlink(file.path);
      return res.status(400).json({ ok: false, message: 'Select at least one display screen.' });
    }

    // Check slot availability for all target screens
    const ads = await adService.listAll();
    for (const screen of targetScreens) {
      const availability = slotAvailability(screen, ads, duration || 10);
      if (availability.full) {
        safeUnlink(file.path);
        return res.status(409).json({ ok: false, message: `No Slots Available For Screen ${screen.id}` });
      }
    }

    const dayCount = Number(days) || (settings.dayOptions && settings.dayOptions[2]) || 7;
    const pricing = await pricingService.getPrice(mediaType, duration || 1, dayCount);
    const price = pricing.totalPrice;

    // Advertiser-only content-safety + business-match verification. Never
    // runs for admin (sourceType below is server-derived from the session
    // role - see line further down), matching the spec's explicit "two
    // separate upload flows" requirement.
    //
    // IMPORTANT: this only actually enforces anything once a real
    // moderation/OCR provider is configured (AI_MODERATION_API_KEY /
    // OCR_API_KEY in .env - see verification.service.js for exactly what
    // to implement). Until then, checkContentSafety()/
    // extractBusinessIdentifiers() would always return 'UNAVAILABLE', and
    // hard-blocking on that would reject every single advertiser upload
    // permanently - a regression of the currently-working upload flow with
    // zero actual safety benefit. So verification is skipped (not
    // silently faked as passing) when no provider is configured, and the
    // ad is created exactly as it was before this feature existed. Once a
    // real provider is wired in, this same code path enforces it exactly
    // per the spec (reject on unsafe content or a business mismatch, hold
    // rather than approve if the provider itself is unreachable).
    let verificationResult = null;
    const isAdvertiserUpload = req.session.user.role !== 'admin';
    const verificationConfigured = Boolean(process.env.AI_MODERATION_API_KEY);
    if (isAdvertiserUpload && verificationConfigured) {
      const safety = await verificationService.checkContentSafety(file.path, mediaType);
      if (safety.status !== 'SAFE') {
        safeUnlink(file.path);
        return res.status(422).json({
          ok: false,
          code: safety.status === 'UNAVAILABLE' ? 'VERIFICATION_UNAVAILABLE' : 'CONTENT_REJECTED',
          message: safety.status === 'UNAVAILABLE'
            ? 'Advertisement verification is temporarily unavailable. Please try again.'
            : 'This advertisement could not be approved. Please upload appropriate promotional content.'
        });
      }

      let businessMatch = null;
      const selectedBusinessName = req.body.businessName ? String(req.body.businessName).trim() : '';
      if (selectedBusinessName) {
        const ocr = await verificationService.extractBusinessIdentifiers(file.path, mediaType);
        if (ocr.status !== 'OK') {
          safeUnlink(file.path);
          return res.status(422).json({ ok: false, code: 'VERIFICATION_UNAVAILABLE', message: 'Advertisement verification is temporarily unavailable. Please try again.' });
        }
        businessMatch = verificationService.matchBusiness(ocr.text, selectedBusinessName);
        if (businessMatch.status !== 'MATCH') {
          safeUnlink(file.path);
          return res.status(422).json({
            ok: false,
            code: 'BUSINESS_MISMATCH',
            message: 'Advertisement does not appear to match the selected business.',
            selectedBusiness: selectedBusinessName,
            confidence: businessMatch.confidence
          });
        }
      }

      verificationResult = {
        verificationStatus: 'VERIFIED',
        contentSafetyStatus: safety.status,
        businessMatchStatus: businessMatch ? businessMatch.status : null,
        businessName: selectedBusinessName || null,
        businessId: req.body.businessId ? String(req.body.businessId) : null,
        verificationConfidence: businessMatch ? businessMatch.confidence : null,
        verifiedAt: Date.now()
      };
    }

    // Store the CANONICAL screen ID(s) actually resolved above (targetScreens),
    // not the raw client-submitted `screenIds`. screenIds === 'all' stays as
    // the literal string 'all' (not a real screen ID, no case concern), but
    // for the array case the validation loop above (line ~99) already looked
    // each ID up via screenService.get(String(id).toUpperCase()) - if the
    // raw screenIds value were stored directly instead, any client that ever
    // submitted a non-uppercase screen ID would validate successfully
    // (validation normalizes case) but then get persisted with its
    // original casing. adService.listPlayable()/listByScreen() always
    // upper-cases the *query* screenId (from the display route) but compares
    // it verbatim against the stored ad.screenId - so a case mismatch here
    // would make an otherwise-valid, successfully-uploaded ad silently
    // invisible on the display for that screen, with no error anywhere in
    // the chain. Deriving the stored value from targetScreens instead
    // guarantees it's always in the exact casing screens.json uses.
    const normalizedScreenId = screenIds === 'all' ? 'all' : targetScreens.map(s => s.id);

    // No approval step: the ad is validated above and goes live immediately.
    // sourceType is derived from the authenticated session role, never from
    // client input, so a request can't spoof itself as an admin ad.
    const ad = await adService.create({
      userId: req.session.user.id,
      userEmail: req.session.user.email,
      mediaType,
      mediaUrl: `/uploads/${file.filename}`,
      fileName: file.originalname,
      duration: duration || 1,
      days: dayCount,
      screenId: normalizedScreenId,
      price,
      sourceType: req.session.user.role === 'admin' ? 'ADMIN' : 'ADVERTISER',
      verification: verificationResult
    });

    res.status(201).json({ ok: true, ad });
  } catch (err) {
    if (req.file) safeUnlink(req.file.path);
    next(err);
  }
}

async function setStatus(req, res, next) {
  try {
    const { status } = req.body;
    if (!['active', 'expired'].includes(status)) {
      return res.status(400).json({ ok: false, message: 'Invalid status.' });
    }
    const result = await adService.setStatus(req.params.id, status);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function renew(req, res, next) {
  try {
    const ad = await adService.get(req.params.id);
    if (!ad) return res.status(404).json({ ok: false, message: 'Advertisement not found.' });

    const isOwner = req.session.user && (req.session.user.id === ad.userId || req.session.user.email === ad.userEmail);
    const isAdmin = req.session.user && req.session.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ ok: false, message: 'Not permitted to modify this advertisement.' });
    }

    const days = Number(req.body.days) || 7;
    const result = await adService.renew(req.params.id, days);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function duplicate(req, res, next) {
  try {
    const ad = await adService.get(req.params.id);
    if (!ad) return res.status(404).json({ ok: false, message: 'Advertisement not found.' });

    const isOwner = req.session.user && (req.session.user.id === ad.userId || req.session.user.email === ad.userEmail);
    const isAdmin = req.session.user && req.session.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ ok: false, message: 'Not permitted to duplicate this advertisement.' });
    }

    const result = await adService.duplicate(req.params.id);
    if (!result.ok) return res.status(404).json(result);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const ad = await adService.get(req.params.id);
    if (!ad) return res.status(404).json({ ok: false, message: 'Advertisement not found.' });

    const isOwner = req.session.user && req.session.user.id === ad.userId;
    const isAdmin = req.session.user && req.session.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ ok: false, message: 'Not permitted to delete this advertisement.' });
    }

    const result = await adService.remove(req.params.id);
    if (result.removed && result.removed.mediaUrl) {
      const filePath = path.join(UPLOAD_DIR, path.basename(result.removed.mediaUrl));
      safeUnlink(filePath);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

async function updateDuration(req, res, next) {
  try {
    const ad = await adService.get(req.params.id);
    if (!ad) return res.status(404).json({ ok: false, message: 'Advertisement not found.' });

    if (ad.mediaType !== 'video') {
      return res.status(400).json({ ok: false, message: 'Duration can only be edited for video advertisements.' });
    }

    const newDuration = Number(req.body.duration);
    if (!newDuration || newDuration < 1) {
      return res.status(400).json({ ok: false, message: 'Invalid duration value.' });
    }

    // Validate against the actual measured video length, captured once at
    // upload time (see ad.service.js#create). Older ads created before this
    // field existed fall back to their current duration as a best-effort cap.
    // No artificial 60s ceiling here - a video can be longer than 60s (e.g.
    // an Admin-uploaded ad), so playback duration is capped only by the
    // video's own real length, matching the frontend edit dialog.
    const actualDuration = ad.actualDurationSeconds || ad.duration || 60;

    const maxAllowed = actualDuration;
    if (newDuration > maxAllowed) {
      return res.status(400).json({ ok: false, message: `Duration cannot exceed the actual video length (${actualDuration}s).` });
    }

    const result = await adService.updateDuration(req.params.id, newDuration);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function display(req, res, next) {
  try {
    const screenId = String(req.params.screenId || '').toUpperCase();
    const screen = await screenService.get(screenId);
    if (!screen) {
      return res.status(404).json({ ok: false, message: `No display is registered with ID "${screenId}".` });
    }
    const ads = await adService.listPlayable(screenId);
    const settings = await settingsService.get();
    const timezone = settings.timezone || 'Asia/Kolkata';
    const isOpen = screen.activeState !== 'disabled' && isWithinOperatingHours(screen.openTime, screen.closeTime, timezone);

    res.json({
      ok: true,
      screen,
      ads,
      status: {
        isOpen,
        currentTime: currentTimeLabel(timezone),
        nextOpening: nextOpeningLabel(screen.openTime, timezone),
        timezone
      },
      config: {
        appName: settings.appName,
        siteUrl: settings.siteUrl,
        transitionMs: settings.transitionMs,
        transitionStyles: settings.transitionStyles,
        logoCycleSeconds: settings.logoCycleSeconds,
        logoVisibleSeconds: settings.logoVisibleSeconds,
        qrCycleSeconds: settings.qrCycleSeconds,
        qrVisibleSeconds: settings.qrVisibleSeconds
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, upload, setStatus, renew, duplicate, remove, display, updateDuration };
