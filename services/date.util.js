const TIMEZONE = 'Asia/Kolkata';

/** Current date/time broken into Asia/Kolkata (or configured) local parts, independent of host server timezone. */
function nowInZone(timeZone = TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const get = (type) => parts.find(p => p.type === type).value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    dateISO: `${get('year')}-${get('month')}-${get('day')}`,
    timeHHMM: `${get('hour').padStart(2, '0')}:${get('minute').padStart(2, '0')}`
  };
}

function todayISO(timeZone = TIMEZONE) {
  return nowInZone(timeZone).dateISO;
}

function addDays(dateISO, days) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

function daysRemaining(endDateISO, timeZone = TIMEZONE) {
  const end = new Date(`${endDateISO}T00:00:00Z`);
  const today = new Date(`${todayISO(timeZone)}T00:00:00Z`);
  return Math.round((end - today) / (1000 * 60 * 60 * 24));
}

function isExpired(endDateISO, timeZone = TIMEZONE) {
  return daysRemaining(endDateISO, timeZone) < 0;
}

/** Parses "HH:MM" into total minutes since midnight. */
function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (h % 24) * 60 + (m || 0);
}

/** Whether "now" (in the given timezone) falls within [openTime, closeTime), both "HH:MM" 24h strings. */
function isWithinOperatingHours(openTime, closeTime, timeZone = TIMEZONE) {
  const now = nowInZone(timeZone);
  const nowMinutes = now.hour * 60 + now.minute;
  const openMinutes = timeToMinutes(openTime);
  const closeMinutes = timeToMinutes(closeTime);
  if (closeMinutes > openMinutes) {
    return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
  }
  // Overnight window (close time is after midnight, e.g. 22:00 -> 02:00)
  return nowMinutes >= openMinutes || nowMinutes < closeMinutes;
}

function formatTime12h(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(hour12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

/** Human label for when a screen next opens, relative to "now" in the given timezone. */
function nextOpeningLabel(openTime, timeZone = TIMEZONE) {
  const now = nowInZone(timeZone);
  const nowMinutes = now.hour * 60 + now.minute;
  const openMinutes = timeToMinutes(openTime);
  const isToday = openMinutes > nowMinutes;
  return `${isToday ? 'Today' : 'Tomorrow'} at ${formatTime12h(openTime)}`;
}

function currentTimeLabel(timeZone = TIMEZONE) {
  const now = nowInZone(timeZone);
  return formatTime12h(now.timeHHMM);
}

module.exports = {
  TIMEZONE,
  nowInZone,
  todayISO,
  addDays,
  daysRemaining,
  isExpired,
  timeToMinutes,
  isWithinOperatingHours,
  formatTime12h,
  nextOpeningLabel,
  currentTimeLabel
};
