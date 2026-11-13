// One entry point for every market. The rest of the app never needs to know
// whether a symbol is crypto or a stock, or whether a timeframe is native.
import * as binance from './binance.js';
import * as twelve from './twelvedata.js';
import { parseTf, intervalSeconds as secs } from '../config.js';

// Binance pairs end in one of these quote assets (USDTMXN = dollar vs peso, PAXGUSDT = gold).
const CRYPTO_QUOTES = /(USDT|USDC|FDUSD|BUSD|USD1|BTC|ETH|BNB|EUR|TRY|MXN|BRL|JPY)$/;

export function sourceFor(symbol) {
  if (symbol.includes('/')) return 'twelvedata';              // XAU/USD, USD/MXN, EUR/USD…
  return CRYPTO_QUOTES.test(symbol) && symbol.length > 5 ? 'binance' : 'twelvedata';
}

// ── Resampled timeframes (not offered natively by the data source) ──
const NATIVE = {
  binance: new Set(Object.keys(binance.INTERVAL_MAP)),
  twelvedata: new Set(Object.keys(twelve.INTERVAL_MAP)),
};
const toSec = (t) => (typeof t === 'number' ? t : Date.parse(t + 'T00:00:00Z') / 1000);
const MONDAY_EPOCH = 4 * 86400; // 1970-01-05 was a Monday

// Which native interval to build `interval` from (null = it's native already).
//   N days → daily candles · N weeks → weekly · N months / years → monthly
//   minutes / hours → the largest native intraday interval that divides it
export function baseInterval(symbol, interval) {
  const native = NATIVE[sourceFor(symbol)];
  if (native.has(interval)) return null;
  const tf = parseTf(interval);
  if (!tf) throw new Error(`Unknown timeframe "${interval}"`);
  if (tf.unit === 'D') return '1D';
  if (tf.unit === 'W') return '1W';
  if (tf.unit === 'M' || tf.unit === 'Y') return '1M';
  const target = secs(interval);
  return [...native]
    .filter((iv) => 'mH'.includes(parseTf(iv).unit) && secs(iv) < target && target % secs(iv) === 0)
    .sort((a, b) => secs(b) - secs(a))[0] || '1m';
}

// Monday–Friday days since 1970-01-05 (Saturday / Sunday count as that week's Friday).
// Stable no matter how much history is loaded, so N-day stock candles never regroup.
export function weekdayIndex(sec) {
  const d = Math.floor((sec - MONDAY_EPOCH) / 86400), week = Math.floor(d / 7);
  return week * 5 + Math.min(d - week * 7, 4);
}

// Candles with the same key belong to the same resampled candle.
// sessions = true (stocks / forex): N-day candles hold N trading days instead of N calendar days,
// so a 5D candle is a full trading week and not "whatever fell inside a 5-day block".
export function bucketKey(time, interval, sessions = false) {
  const sec = toSec(time), tf = parseTf(interval);
  if (!tf) return sec;
  if (tf.unit === 'Y' || tf.unit === 'M') {
    const d = new Date(sec * 1000), months = d.getUTCFullYear() * 12 + d.getUTCMonth();
    return Math.floor(months / (tf.unit === 'Y' ? tf.n * 12 : tf.n));   // 3M = calendar quarters, 1Y = calendar years
  }
  if (tf.unit === 'W') return Math.floor(Math.floor((sec - MONDAY_EPOCH) / 604800) / tf.n);
  if (tf.unit === 'D' && sessions) return Math.floor(weekdayIndex(sec) / tf.n);
  return Math.floor(sec / secs(interval)); // fixed-length blocks: 3m, 45m, 3H, 2D, 7D…
}

function merge(group) {
  let high = -Infinity, low = Infinity, volume = 0;
  for (const c of group) { if (c.high > high) high = c.high; if (c.low < low) low = c.low; volume += c.volume; }
  return { time: group[0].time, open: group[0].open, high, low, close: group[group.length - 1].close, volume };
}

export function resample(candles, interval, sessions = false) {
  const out = [];
  let group = [], key = null;
  for (const c of candles) {
    const k = bucketKey(c.time, interval, sessions);
    if (k !== key && group.length) { out.push(merge(group)); group = []; }
    key = k; group.push(c);
  }
  if (group.length) out.push(merge(group));
  return out;
}

// How many base candles to load for a resampled timeframe: enough for ~1000 candles,
// capped so a 15D chart costs a few requests (Binance) or one bigger request (Twelve Data).
const MAX_BASE_BARS = { binance: 8000, twelvedata: 5000 };
export function baseBars(symbol, interval, base) {
  const perCandle = Math.max(1, Math.ceil(secs(interval) / secs(base)));
  return Math.min(perCandle * 1000, MAX_BASE_BARS[sourceFor(symbol)]);
}

const baseCache = new Map(); // `${symbol}|${interval}` → base candles (for live resampling)

async function fetchRaw(symbol, interval, opts, bars = 1000) {
  return sourceFor(symbol) === 'binance'
    ? binance.fetchCandles(symbol, interval, bars)
    : twelve.fetchCandles(symbol, interval, opts.apiKey, bars);
}

export async function fetchCandles(symbol, interval, opts = {}) {
  const base = baseInterval(symbol, interval);
  if (!base) return fetchRaw(symbol, interval, opts);
  const raw = await fetchRaw(symbol, base, opts, baseBars(symbol, interval, base));
  baseCache.set(`${symbol}|${interval}`, raw);
  return resample(raw, interval, sourceFor(symbol) !== 'binance');
}

function subscribeRaw(symbol, interval, onCandle, opts) {
  return sourceFor(symbol) === 'binance'
    ? binance.subscribe(symbol, interval, onCandle)
    : twelve.subscribe(symbol, interval, opts.apiKey, onCandle);
}

export function subscribe(symbol, interval, onCandle, opts = {}) {
  const base = baseInterval(symbol, interval);
  if (!base) return subscribeRaw(symbol, interval, onCandle, opts);
  const sessions = sourceFor(symbol) !== 'binance';
  const keyOf = (c) => bucketKey(c.time, interval, sessions);
  const raw = baseCache.get(`${symbol}|${interval}`) || [];
  let lastKey = raw.length ? keyOf(raw[raw.length - 1]) : null;
  // merge the run of base candles that ends just before `end` (only the tail is touched on each tick)
  const bucketEndingAt = (end) => {
    const k = keyOf(raw[end - 1]);
    let i = end - 1;
    while (i > 0 && keyOf(raw[i - 1]) === k) i--;
    return merge(raw.slice(i, end));
  };
  return subscribeRaw(symbol, base, (c) => {
    const last = raw[raw.length - 1];
    let isNew = false;
    if (last && last.time === c.time) raw[raw.length - 1] = c;
    else if (!last || c.time > last.time) { raw.push(c); isNew = true; }
    else return;
    const key = keyOf(c);
    if (isNew && lastKey != null && key !== lastKey && raw.length > 1) onCandle(bucketEndingAt(raw.length - 1), true); // previous candle finished
    lastKey = key;
    onCandle(bucketEndingAt(raw.length), false);
  }, opts);
}

export const fetchCryptoTickers = binance.fetchTickers;
export const fetchMarketQuotes = twelve.fetchQuotes;
