// One entry point for every market. The rest of the app never needs to know
// whether a symbol is crypto or a stock, or whether a timeframe is native.
import * as binance from './binance.js';
import * as twelve from './twelvedata.js';

// Binance pairs end in one of these quote assets (USDTMXN = dollar vs peso, PAXGUSDT = gold).
const CRYPTO_QUOTES = /(USDT|USDC|FDUSD|BUSD|USD1|BTC|ETH|BNB|EUR|TRY|MXN|BRL|JPY)$/;

export function sourceFor(symbol) {
  if (symbol.includes('/')) return 'twelvedata';              // XAU/USD, USD/MXN, EUR/USD…
  return CRYPTO_QUOTES.test(symbol) && symbol.length > 5 ? 'binance' : 'twelvedata';
}

// ── Resampled timeframes (not offered natively by the data sources) ──
const RESAMPLED = { '5D': '1D', '2W': '1W', '3M': '1M', '1Y': '1M' };
const toSec = (t) => (typeof t === 'number' ? t : Date.parse(t + 'T00:00:00Z') / 1000);
const MONDAY_EPOCH = 4 * 86400; // 1970-01-05 was a Monday

export function bucketKey(time, interval) {
  const sec = toSec(time);
  if (interval === '2W') return Math.floor(Math.floor((sec - MONDAY_EPOCH) / 604800) / 2);
  if (interval === '5D') return Math.floor(sec / 86400 / 5);                 // 5-day blocks
  if (interval === '3M') { const d = new Date(sec * 1000); return d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3); } // quarters
  if (interval === '1Y') return new Date(sec * 1000).getUTCFullYear();
  return sec;
}

function merge(group) {
  return {
    time: group[0].time,
    open: group[0].open,
    high: Math.max(...group.map((c) => c.high)),
    low: Math.min(...group.map((c) => c.low)),
    close: group[group.length - 1].close,
    volume: group.reduce((a, c) => a + c.volume, 0),
  };
}

export function resample(candles, interval) {
  const out = [];
  let group = [], key = null;
  for (const c of candles) {
    const k = bucketKey(c.time, interval);
    if (k !== key && group.length) { out.push(merge(group)); group = []; }
    key = k; group.push(c);
  }
  if (group.length) out.push(merge(group));
  return out;
}

const baseCache = new Map(); // `${symbol}|${interval}` → base candles (for live resampling)

async function fetchRaw(symbol, interval, opts) {
  return sourceFor(symbol) === 'binance'
    ? binance.fetchCandles(symbol, interval)
    : twelve.fetchCandles(symbol, interval, opts.apiKey);
}

export async function fetchCandles(symbol, interval, opts = {}) {
  const base = RESAMPLED[interval];
  if (!base) return fetchRaw(symbol, interval, opts);
  const raw = await fetchRaw(symbol, base, opts);
  baseCache.set(`${symbol}|${interval}`, raw);
  return resample(raw, interval);
}

function subscribeRaw(symbol, interval, onCandle, opts) {
  return sourceFor(symbol) === 'binance'
    ? binance.subscribe(symbol, interval, onCandle)
    : twelve.subscribe(symbol, interval, opts.apiKey, onCandle);
}

export function subscribe(symbol, interval, onCandle, opts = {}) {
  const base = RESAMPLED[interval];
  if (!base) return subscribeRaw(symbol, interval, onCandle, opts);
  const raw = baseCache.get(`${symbol}|${interval}`) || [];
  let lastKey = raw.length ? bucketKey(raw[raw.length - 1].time, interval) : null;
  return subscribeRaw(symbol, base, (c) => {
    const last = raw[raw.length - 1];
    if (last && last.time === c.time) raw[raw.length - 1] = c;
    else if (!last || c.time > last.time) raw.push(c);
    else return;
    const key = bucketKey(c.time, interval);
    const bucket = (k) => merge(raw.filter((x) => bucketKey(x.time, interval) === k));
    if (lastKey != null && key !== lastKey) onCandle(bucket(lastKey), true); // previous bucket finished
    lastKey = key;
    onCandle(bucket(key), false);
  }, opts);
}

export const fetchCryptoTickers = binance.fetchTickers;
export const fetchMarketQuotes = twelve.fetchQuotes;
