const DEFAULT_TZ = 'Asia/Kolkata';

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(dateISO, days) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

export function formatDate(dateISO) {
  if (!dateISO) return '\u2014';
  const d = new Date(dateISO);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(dateISO) {
  const d = new Date(dateISO);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function daysRemaining(endDateISO) {
  const end = new Date(`${endDateISO}T00:00:00Z`);
  const now = new Date();
  return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
}

export function isExpired(endDateISO) {
  return daysRemaining(endDateISO) < 0;
}

/** Formats a "HH:MM" 24h string as "08:00 AM" style 12h label. */
export function formatTime12h(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(hour12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

/** Current wall-clock time in a given IANA timezone (defaults to Asia/Kolkata), formatted "hh:mm:ss AM/PM". */
export function currentTimeLabel(timeZone = DEFAULT_TZ) {
  return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone });
}
