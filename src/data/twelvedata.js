// Stocks / ETFs / forex via Twelve Data (free plan: 8 requests/min, 800/day).
// Get a free key at https://twelvedata.com and enter it with F8 in the app.
// The "demo" key only works for a few symbols such as AAPL.
const REST = 'https://api.twelvedata.com';

const INTERVAL_MAP = { '1m': '1min', '5m': '5min', '15m': '15min', '1H': '1h', '4H': '4h', '1D': '1day', '1W': '1week', '1M': '1month' };
const INTRADAY = new Set(['1m', '5m', '15m', '1H', '4H']);

export async function fetchCandles(symbol, interval, apiKey, limit = 1000) {
  const url = `${REST}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${INTERVAL_MAP[interval]}`
    + `&outputsize=${limit}&apikey=${encodeURIComponent(apiKey || 'demo')}&timezone=UTC`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== 'ok') throw new Error(`Twelve Data: ${json.message || 'request failed'}`);
  return json.values.reverse().map((v) => ({
    time: INTRADAY.has(interval)
      ? Math.floor(Date.parse(v.datetime.replace(' ', 'T') + 'Z') / 1000)
      : v.datetime.slice(0, 10), // business day string for daily+ bars
    open: +v.open, high: +v.high, low: +v.low, close: +v.close, volume: +(v.volume || 0),
  }));
}

// No free websocket on the basic plan → poll. Re-fetches the last 2 bars.
// The previous bar is reported as closed so crossover signals stay honest.
export function subscribe(symbol, interval, apiKey, onCandle, everyMs = 60_000) {
  const id = setInterval(async () => {
    try {
      const bars = await fetchCandles(symbol, interval, apiKey, 2);
      if (bars.length === 2) onCandle(bars[0], true);
      if (bars.length) onCandle(bars[bars.length - 1], false);
    } catch { /* keep the last good data on screen */ }
  }, everyMs);
  return () => clearInterval(id);
}
