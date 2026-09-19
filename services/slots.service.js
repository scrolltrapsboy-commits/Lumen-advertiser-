const { timeToMinutes } = require('./date.util');

/**
 * Slot math for a display screen.
 * A screen operates for (closeTime - openTime) minutes per day (handles an
 * overnight window where closeTime is after midnight, e.g. 22:00 -> 02:00).
 * Each advertisement occupies its own duration in seconds within a rotating loop.
 * Maximum daily slots = operating seconds / reference ad duration.
 */
function operatingSeconds(screen) {
  const openMinutes = timeToMinutes(screen.openTime);
  const closeMinutes = timeToMinutes(screen.closeTime);
  const minutes = closeMinutes > openMinutes ? closeMinutes - openMinutes : (1440 - openMinutes) + closeMinutes;
  return Math.max(0, minutes) * 60;
}

function maxDailySlots(screen, adDurationSeconds) {
  const seconds = operatingSeconds(screen);
  if (!adDurationSeconds) return 0;
  return Math.floor(seconds / adDurationSeconds);
}

function usedSlots(ads, screenId) {
  return ads.filter(ad => ad.screenId === screenId && ad.status === 'active').length;
}

function slotAvailability(screen, ads, referenceDurationSeconds = 10) {
  const max = maxDailySlots(screen, referenceDurationSeconds);
  const used = usedSlots(ads, screen.id);
  return { max, used, remaining: Math.max(0, max - used), full: used >= max };
}

module.exports = { operatingSeconds, maxDailySlots, usedSlots, slotAvailability };
