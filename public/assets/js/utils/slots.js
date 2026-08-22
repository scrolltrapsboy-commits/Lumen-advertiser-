/**
 * Slot math for a display screen (client-side mirror of services/slots.service.js).
 * A screen operates for (closeTime - openTime) minutes per day, where both are
 * "HH:MM" 24h strings. Handles an overnight window (close after midnight).
 */
function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (h % 24) * 60 + (m || 0);
}

export function operatingSeconds(screen) {
  const openMinutes = timeToMinutes(screen.openTime);
  const closeMinutes = timeToMinutes(screen.closeTime);
  const minutes = closeMinutes > openMinutes ? closeMinutes - openMinutes : (1440 - openMinutes) + closeMinutes;
  return Math.max(0, minutes) * 60;
}

export function maxDailySlots(screen, adDurationSeconds) {
  const seconds = operatingSeconds(screen);
  if (!adDurationSeconds) return 0;
  return Math.floor(seconds / adDurationSeconds);
}

export function usedSlots(ads, screenId) {
  return ads.filter(ad => ad.screenId === screenId && ad.status === 'active').length;
}

export function slotAvailability(screen, ads, referenceDurationSeconds = 10) {
  const max = maxDailySlots(screen, referenceDurationSeconds);
  const used = usedSlots(ads, screen.id);
  return { max, used, remaining: Math.max(0, max - used), full: used >= max };
}
