// Stocks / ETFs / forex via Twelve Data (free plan: 8 requests/min, 800/day).
// Get a free key at https://twelvedata.com and enter it with F8 in the app.
// The "demo" key only works for a few symbols such as AAPL.
import { isMarketOpen } from './markets.js';

const REST = 'https://api.twelvedata.com';

// Native Twelve Data intervals (anything else is built by resampling in data/index.js)
export const INTERVAL_MAP = {
  '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min', '45m': '45min',
  '1H': '1h', '2H': '2h', '4H': '4h', '1D': '1day', '1W': '1week', '1M': '1month',
};
const INTRADAY = new Set(['1m', '5m', '15m', '30m', '45m', '1H', '2H', '4H']);

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

// No free websocket on the basic plan → poll every 60 s (1 credit each).
// Skips while the tab is hidden or the market is closed, to save credits.
// The returned stop() also has .refresh() to update right now (⟳ button).
// The previous bar is reported as closed so crossover signals stay honest.
export function subscribe(symbol, interval, apiKey, onCandle, everyMs = 60_000) {
  const poll = async (force = false) => {
    if (!force && (document.hidden || !isMarketOpen(symbol))) return;
    try {
      const bars = await fetchCandles(symbol, interval, apiKey, 2);
      if (bars.length === 2) onCandle(bars[0], true);
      if (bars.length) onCandle(bars[bars.length - 1], false);
    } catch { /* keep the last good data on screen */ }
  };
  const id = setInterval(poll, everyMs);
  const stop = () => clearInterval(id);
  stop.refresh = () => poll(true);
  return stop;
}

// Latest price + daily % change for several symbols in one request.
// Each symbol costs 1 API credit, so the app refreshes these slowly.
export async function fetchQuotes(symbols, apiKey) {
  if (!symbols.length || !apiKey) return [];
  const res = await fetch(`${REST}/quote?symbol=${encodeURIComponent(symbols.join(','))}&apikey=${encodeURIComponent(apiKey)}`);
  const json = await res.json();
  const map = symbols.length === 1 ? { [symbols[0]]: json } : json;
  return symbols.flatMap((s) => {
    const q = map[s];
    return q && q.close ? [{ symbol: s, last: +q.close, changePct: +q.percent_change }] : [];
  });
}
