const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { todayISO, addDays, isExpired } = require('./date.util');

// No manual approval: an ad is either currently running ("active") or has
// naturally run out its campaign length ("expired"). Admins can still pull
// an ad down early by flipping it to "expired", or delete it outright.
const AD_STATUS = { ACTIVE: 'active', EXPIRED: 'expired' };

async function refreshExpiry() {
  const ads = await db.read('ads.json');
  let changed = false;
  ads.forEach(ad => {
    if (ad.status === AD_STATUS.ACTIVE && isExpired(ad.endDate)) {
      ad.status = AD_STATUS.EXPIRED;
      changed = true;
    }
  });
  if (changed) await db.write('ads.json', ads);
  return ads;
}

async function listAll() {
  return refreshExpiry();
}

async function listByUser(userId) {
  const ads = await listAll();
  return ads.filter(ad => ad.userId === userId);
}

async function listByScreen(screenId) {
  const ads = await listAll();
  return ads.filter(ad => {
    if (ad.screenId === 'all') return true;
    if (Array.isArray(ad.screenId)) return ad.screenId.includes(screenId);
    return ad.screenId === screenId;
  });
}

async function listPlayable(screenId) {
  const ads = await listAll();
  const eligible = ads.filter(ad => {
    if (ad.status !== AD_STATUS.ACTIVE) return false;
    if (ad.screenId === 'all') return true;
    if (Array.isArray(ad.screenId)) return ad.screenId.includes(screenId);
    return ad.screenId === screenId;
  });

  const normalAds = eligible.filter(ad => ad.sourceType !== 'ADMIN');
  const adminAds = eligible.filter(ad => ad.sourceType === 'ADMIN');

  // No admin ads assigned to this screen: play normal ads only, unchanged.
  if (adminAds.length === 0) return normalAds;
  // No normal ads on this screen at all: just surface the admin ad(s) so
  // the screen isn't left empty, still respecting its own assignment.
  if (normalAds.length === 0) return adminAds;

  // Interleave: after every 3 normal ads, insert the next admin ad in
  // rotation (cycling through if this screen has more than one admin ad).
  // This never shows an admin ad twice in a row, and never touches a
  // screen the admin ad wasn't assigned to, since `eligible` was already
  // filtered to this screen above.
  //
  // Edge case: if there are FEWER than 3 normal ads total, (i+1) % 3 === 0
  // can never be true for any i, so the old code never inserted an admin
  // ad at all in that case - a screen with only 1 or 2 normal ads would
  // never show its assigned admin ad(s), even though listPlayable's own
  // caller loops this returned array indefinitely. Fixed by also
  // inserting after the LAST normal ad whenever the total set is under 3,
  // so looping the resulting array produces the required
  // N1 -> ADMIN -> N1 -> ADMIN (1 normal ad) or
  // N1 -> N2 -> ADMIN -> N1 -> N2 -> ADMIN (2 normal ads) pattern.
  const result = [];
  let adminIndex = 0;
  for (let i = 0; i < normalAds.length; i++) {
    result.push(normalAds[i]);
    const isEveryThird = (i + 1) % 3 === 0;
    const isLastOfShortSet = normalAds.length < 3 && i === normalAds.length - 1;
    if (isEveryThird || isLastOfShortSet) {
      result.push(adminAds[adminIndex % adminAds.length]);
      adminIndex++;
    }
  }
  return result;
}

async function get(id) {
  const ads = await listAll();
  return ads.find(a => a.id === id) || null;
}

/** Creates and immediately activates an advertisement (no approval step). */
async function create({ userId, userEmail, mediaType, mediaUrl, fileName, duration, days, screenId, price, sourceType, verification }) {
  const startDate = todayISO();
  const endDate = addDays(startDate, days);
  // Normalize screenId to array or 'all'
  let normalizedScreenId = screenId;
  if (screenId === 'all' || (Array.isArray(screenId) && screenId.length === 0)) {
    normalizedScreenId = 'all';
  } else if (Array.isArray(screenId)) {
    normalizedScreenId = screenId;
  }
  return db.update('ads.json', (ads) => {
    const ad = {
      id: uuidv4(),
      userId,
      userEmail,
      mediaType,
      mediaUrl,
      fileName,
      duration: Number(duration),
      // For videos, the duration captured at upload time is the actual measured
      // length of the file (probed client-side). Keep it immutable here so that
      // later admin edits to playback duration can always be validated against
      // the real video length, not against whatever the duration was last set to.
      actualDurationSeconds: mediaType === 'video' ? Number(duration) : null,
      days: Number(days),
      screenId: normalizedScreenId,
      price: Number(price),
      // Distinguishes an ad uploaded from the Admin panel (system ad, rotated
      // into the playlist per the interleave rule in listPlayable) from a
      // normal advertiser-purchased ad. Defaults to advertiser for every
      // existing/legacy ad record that predates this field.
      sourceType: sourceType === 'ADMIN' ? 'ADMIN' : 'ADVERTISER',
      status: AD_STATUS.ACTIVE,
      startDate,
      endDate,
      createdAt: Date.now(),
      // Advertiser-only verification metadata (see verification.service.js
      // and places.service.js). null for every admin ad and for any
      // advertiser ad created before this field existed - never assume its
      // presence when reading old records.
      verification: sourceType === 'ADMIN' ? null : (verification || null)
    };
    ads.push(ad);
    return { data: ads, result: ad };
  });
}

async function setStatus(id, status) {
  return db.update('ads.json', (ads) => {
    const idx = ads.findIndex(a => a.id === id);
    if (idx === -1) return { data: ads, result: { ok: false } };
    ads[idx].status = status;
    return { data: ads, result: { ok: true, ad: ads[idx] } };
  });
}

async function remove(id) {
  return db.update('ads.json', (ads) => {
    const target = ads.find(a => a.id === id);
    const next = ads.filter(a => a.id !== id);
    return { data: next, result: { ok: true, removed: target } };
  });
}

async function renew(id, additionalDays = 7) {
  return db.update('ads.json', (ads) => {
    const idx = ads.findIndex(a => a.id === id);
    if (idx === -1) return { data: ads, result: { ok: false } };
    const base = isExpired(ads[idx].endDate) ? todayISO() : ads[idx].endDate;
    ads[idx].endDate = addDays(base, additionalDays);
    ads[idx].days = Number(ads[idx].days || 0) + Number(additionalDays);
    ads[idx].status = AD_STATUS.ACTIVE;
    return { data: ads, result: { ok: true, ad: ads[idx] } };
  });
}

async function duplicate(id) {
  return db.update('ads.json', (ads) => {
    const source = ads.find(a => a.id === id);
    if (!source) return { data: ads, result: { ok: false } };
    const startDate = todayISO();
    const endDate = addDays(startDate, source.days);
    const copy = {
      ...source,
      id: uuidv4(),
      status: AD_STATUS.ACTIVE,
      startDate,
      endDate,
      createdAt: Date.now()
    };
    ads.push(copy);
    return { data: ads, result: { ok: true, ad: copy } };
  });
}

async function updateDuration(id, duration) {
  return db.update('ads.json', (ads) => {
    const idx = ads.findIndex(a => a.id === id);
    if (idx === -1) return { data: ads, result: { ok: false } };
    ads[idx].duration = Number(duration);
    return { data: ads, result: { ok: true, ad: ads[idx] } };
  });
}

module.exports = {
  AD_STATUS,
  listAll,
  listByUser,
  listByScreen,
  listPlayable,
  get,
  create,
  setStatus,
  remove,
  renew,
  duplicate,
  updateDuration
};
