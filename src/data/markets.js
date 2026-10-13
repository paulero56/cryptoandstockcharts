// Trading hours, in New York time. Used to avoid spending Twelve Data credits
// while a market is closed (the price doesn't move then anyway).
// Note: exchange holidays are not included.
function nyNow(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { day: p.weekday, mins: (+p.hour % 24) * 60 + +p.minute };
}

export function isMarketOpen(symbol, now = new Date()) {
  const { day, mins } = nyNow(now);
  if (symbol.includes('/')) {            // forex & metals (USD/MXN, XAU/USD): Sun 17:00 → Fri 17:00 NY
    if (day === 'Sat') return false;
    if (day === 'Sun') return mins >= 17 * 60;
    if (day === 'Fri') return mins < 17 * 60;
    return true;
  }
  if (day === 'Sat' || day === 'Sun') return false; // US stocks: Mon–Fri 9:30–16:00 NY
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}
