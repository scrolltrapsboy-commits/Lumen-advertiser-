/**
 * The ONE daily-quote system shared by the Big Display (display.js) and
 * the portrait display system (portrait-display-overlay.js). One quote
 * per calendar day, derived purely from the date - it never changes on
 * ad changes, screen changes, weather refreshes, or rerenders, only
 * when the calendar day itself rolls over.
 */
const QUOTES = [
  'Start where you are, use what you have.',
  'Small steps become meaningful distance.',
  'Make today useful.',
  'Clarity creates momentum.'
];

export function dailyQuote() {
  const day = Math.floor(Date.now() / 86400000);
  return QUOTES[((day % QUOTES.length) + QUOTES.length) % QUOTES.length];
}
