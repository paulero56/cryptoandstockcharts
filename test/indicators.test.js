import test from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema } from '../src/indicators/ma.js';
import { crossovers } from '../src/indicators/cross.js';
import { computeHpdr, percentile } from '../src/indicators/hpdr.js';
import { stochastic, rsi, divergences, dmi, smaN, forecast, autoFib, stochVolatility } from '../src/indicators/oscillators.js';

const close = n => Array.from({ length: n }, (_, i) => 100 + 10 * Math.sin(i / 7) + i * 0.2);

test('SMA', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test('EMA seeded with SMA', () => {
  assert.deepEqual(ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(ema([2, 4, 6, 10], 3), [null, null, 4, 7]);
});

test('crossovers ignore the open candle', () => {
  const fast = [1, 1, 3, 3, 1], slow = [2, 2, 2, 2, 2];
  assert.deepEqual(crossovers(fast, slow), [{ index: 2, type: 'bull' }, { index: 4, type: 'bear' }]);
  assert.deepEqual(crossovers(fast, slow, 3), [{ index: 2, type: 'bull' }]);
});

test('percentile interpolates', () => {
  assert.equal(percentile([0, 10], 50), 5);
  assert.equal(percentile([1, 2, 3, 4, 5], 100), 5);
  assert.equal(percentile([1, 2, 3, 4, 5], 0), 1);
});

test('HPDR: constant growth → all bands equal the expected price', () => {
  const src = Array.from({ length: 80 }, (_, i) => 100 * 1.01 ** i);
  const r = computeHpdr(src, { length: 7, ranges: [50, 100] });
  const t = 70, expect = src[t];
  for (const v of [r.median[t], r.upper[50][t], r.lower[100][t]]) assert.ok(Math.abs(v - expect) < 1e-6);
  assert.equal(r.median[20], null); // not enough samples yet
});

test('HPDR: bands are ordered and oscillators stay 0–100', () => {
  const r = computeHpdr(close(400), { length: 7, ranges: [38.2, 61.8, 95, 100], project: true });
  const t = 399;
  assert.ok(r.lower[100][t] <= r.lower[95][t] && r.lower[95][t] <= r.lower[61.8][t] && r.lower[61.8][t] <= r.median[t]);
  assert.ok(r.median[t] <= r.upper[38.2][t] && r.upper[38.2][t] <= r.upper[100][t]);
  for (const v of [...r.osc, ...r.vol]) if (v != null) assert.ok(v >= 0 && v <= 100);
  assert.equal(r.projection.median.length, 7);
});

test('HPDR maxArray caps the history used', () => {
  const r = computeHpdr(close(300), { length: 7, maxArray: 40, ranges: [100] });
  assert.ok(r.upper[100][299] != null);
});

test('Stochastic K/D in range', () => {
  const c = close(100), h = c.map(x => x + 1), l = c.map(x => x - 1);
  const s = stochastic({ high: h, low: l, close: c }, { k: 14, d: 3, smooth: 6 });
  const firstK = s.k.findIndex(v => v != null);
  assert.equal(firstK, 13 + 5);
  assert.equal(s.d.findIndex(v => v != null), firstK + 2);
  for (const v of [...s.k, ...s.d]) if (v != null) assert.ok(v >= 0 && v <= 100);
  assert.equal(forecast(s.k, 3).length, 3);
});

test('Cutler RSI: all-up = 100, all-down = 0, flat = 50', () => {
  assert.equal(rsi([1, 2, 3, 4, 5, 6], 3).at(-1), 100);
  assert.equal(rsi([6, 5, 4, 3, 2, 1], 3).at(-1), 0);
  assert.equal(rsi([1, 1, 1, 1, 1], 3).at(-1), 50);
  const w = rsi(close(100), 14, 'wilder'), c = rsi(close(100), 14, 'cutler');
  assert.notEqual(w.at(-1), c.at(-1));
});

test('Divergence: lower price low + higher osc low = regular bull', () => {
  //            0  1  2  3  4  5  6  7  8  9 10 11 12
  const price = [9, 8, 7, 5, 7, 8, 9, 8, 6, 4, 6, 7, 8];
  const osc =   [50, 45, 40, 20, 40, 50, 55, 45, 35, 30, 40, 50, 55];
  const d = divergences(price, osc, { left: 2, right: 2, lookback: 50 });
  assert.deepEqual(d.lows, [3, 9]);
  assert.deepEqual(d.list, [{ index: 9, from: 3, type: 'regBull' }]);
});

test('DMI/ADX produce values', () => {
  const c = close(120), r = dmi({ high: c.map(x => x + 1), low: c.map(x => x - 1), close: c }, 14);
  assert.ok(r.adx.at(-1) > 0 && r.adx.at(-1) <= 100);
});

test('smaN skips leading nulls; autoFib endpoints; stochVol range', () => {
  assert.deepEqual(smaN([null, 2, 4, 6], 2), [null, null, 3, 5]);
  const f = autoFib({ high: [1, 5, 10], low: [0, 2, 3] }, 3);
  assert.equal(f[0].price, 10); assert.equal(f.at(-1).price, 0);
  for (const v of stochVolatility(close(300), { lookback: 100 })) if (v != null) assert.ok(v >= 0 && v <= 100);
});

import { bollinger, bbwp, macd } from '../src/indicators/oscillators.js';

test('Bollinger: flat series → bands collapse onto basis', () => {
  const b = bollinger(new Array(30).fill(5), 20, 2);
  assert.equal(b.upper.at(-1), 5); assert.equal(b.lower.at(-1), 5);
});

test('BBWP stays 0–100 and reaches 100 on the widest bar', () => {
  const v = [...close(300), ...Array.from({ length: 20 }, (_, i) => 200 + (i % 2 ? 40 : -40))];
  const r = bbwp(v, { length: 13, lookback: 252 });
  for (const x of r) if (x != null) assert.ok(x >= 0 && x <= 100);
  assert.ok(Math.max(...r.filter(x => x != null)) === 100);
});

test('MACD hist = macd − signal', () => {
  const m = macd(close(200));
  const i = 199;
  assert.ok(Math.abs(m.hist[i] - (m.macd[i] - m.signal[i])) < 1e-9);
});

import { resample, bucketKey, sourceFor } from '../src/data/index.js';

test('2W / 1Y resampling', () => {
  const wk = (d, o, h, l, c, v) => ({ time: Date.parse(d + 'T00:00:00Z') / 1000, open: o, high: h, low: l, close: c, volume: v });
  const weeks = [wk('2026-01-05', 1, 5, 1, 2, 10), wk('2026-01-12', 2, 3, 0.5, 3, 20), wk('2026-01-19', 3, 9, 3, 8, 5)];
  const r = resample(weeks, '2W');
  assert.equal(r.length, 2);
  assert.deepEqual({ ...r[0], time: 0 }, { time: 0, open: 1, high: 5, low: 0.5, close: 3, volume: 30 });
  const months = ['2024-11-01', '2024-12-01', '2025-01-01'].map((d, i) => wk(d, i, i + 1, i, i + 0.5, 1));
  const y = resample(months, '1Y');
  assert.equal(y.length, 2); assert.equal(y[0].close, 1.5); assert.equal(y[1].open, 2);
  assert.equal(bucketKey('2025-03-01', '1Y'), 2025);
});

test('symbol routing', () => {
  assert.equal(sourceFor('PAXGUSDT'), 'binance');
  assert.equal(sourceFor('USDTMXN'), 'binance');
  assert.equal(sourceFor('XAU/USD'), 'twelvedata');
  assert.equal(sourceFor('COIN'), 'twelvedata');
  assert.equal(sourceFor('CRCL'), 'twelvedata');
});

test('5D / 3M resampling', () => {
  const day = (d, c) => ({ time: d, open: c, high: c + 1, low: c - 1, close: c, volume: 1 });
  const days = Array.from({ length: 12 }, (_, i) => day(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), i));
  const five = resample(days, '5D');
  assert.ok(five.length >= 3 && five.length <= 4);
  assert.equal(five.reduce((a, c) => a + c.volume, 0), 12);
  const months = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'].map((d, i) => day(d, i));
  const q = resample(months, '3M');
  assert.equal(q.length, 2); assert.equal(q[0].close, 2); assert.equal(q[1].open, 3);
});


import { isMarketOpen } from '../src/data/markets.js';

test('market hours (New York)', () => {
  const at = (iso) => new Date(iso);
  assert.equal(isMarketOpen('COIN', at('2026-10-14T15:00:00Z')), true);   // Wed 11:00 NY
  assert.equal(isMarketOpen('COIN', at('2026-10-14T21:00:00Z')), false);  // Wed 17:00 NY
  assert.equal(isMarketOpen('COIN', at('2026-10-17T15:00:00Z')), false);  // Saturday
  assert.equal(isMarketOpen('USD/MXN', at('2026-10-14T03:00:00Z')), true); // Tue 23:00 NY
  assert.equal(isMarketOpen('XAU/USD', at('2026-10-17T15:00:00Z')), false); // Saturday
  assert.equal(isMarketOpen('USD/MXN', at('2026-10-18T22:00:00Z')), true);  // Sun 18:00 NY
});

import { baseInterval } from '../src/data/index.js';

test('every timeframe has a source: native or resampled', () => {
  assert.equal(baseInterval('BTCUSDT', '4H'), null);   // native on Binance
  assert.equal(baseInterval('BTCUSDT', '3H'), '1H');
  assert.equal(baseInterval('BTCUSDT', '45m'), '15m');
  assert.equal(baseInterval('BTCUSDT', '2D'), '1D');
  assert.equal(baseInterval('BTCUSDT', '3D'), null);   // native on Binance
  assert.equal(baseInterval('COIN', '3D'), '1D');      // not native on Twelve Data
  assert.equal(baseInterval('COIN', '12H'), '4H');
  assert.equal(baseInterval('COIN', '3m'), '1m');
  assert.equal(bucketKey(10800 * 5 + 100, '3H'), 5);
});

// ── Data layer: timeframes built from daily / weekly / monthly candles ──
import { weekdayIndex, baseBars } from '../src/data/index.js';
import { fetchCandles as binanceCandles } from '../src/data/binance.js';
import { parseTf, intervalSeconds, INTERVALS } from '../src/config.js';
import { normTime, sanitizeDrawings } from '../src/drawings.js';

const day = (iso) => Date.parse(iso + 'T00:00:00Z') / 1000;
const bar = (time, v = 1) => ({ time, open: v, high: v + 1, low: v - 1, close: v + 0.5, volume: 10 });

test('timeframe parsing and lengths', () => {
  assert.deepEqual(parseTf('15D'), { n: 15, unit: 'D' });
  assert.deepEqual(parseTf('1m'), { n: 1, unit: 'm' });
  assert.equal(parseTf('0D'), null);
  assert.equal(parseTf('BTCUSDT'), null);
  assert.equal(intervalSeconds('7D'), 7 * 86400);
  assert.equal(intervalSeconds('3W'), 3 * 604800);
  for (const iv of ['4D', '6D', '7D', '15D', '3W', '8W', '2M', '6M']) assert.ok(INTERVALS.includes(iv), iv);
});

test('base interval: days from 1D, weeks from 1W, months from 1M', () => {
  assert.equal(baseInterval('BTCUSDT', '1D'), null);
  assert.equal(baseInterval('BTCUSDT', '3D'), null);          // native on Binance
  assert.equal(baseInterval('NVDA', '3D'), '1D');
  assert.equal(baseInterval('BTCUSDT', '6D'), '1D');
  assert.equal(baseInterval('BTCUSDT', '15D'), '1D');
  assert.equal(baseInterval('BTCUSDT', '5W'), '1W');
  assert.equal(baseInterval('NVDA', '4M'), '1M');
  assert.equal(baseInterval('BTCUSDT', '1Y'), '1M');
  assert.equal(baseInterval('BTCUSDT', '45m'), '15m');
  assert.equal(baseInterval('NVDA', '3H'), '1H');
  assert.equal(baseBars('BTCUSDT', '4D', '1D'), 4000);
  assert.equal(baseBars('BTCUSDT', '15D', '1D'), 8000);       // capped
  assert.equal(baseBars('NVDA', '15D', '1D'), 5000);          // one Twelve Data request
});

test('crypto N-day candles are fixed calendar blocks', () => {
  const t0 = Math.floor(day('2026-01-01') / (7 * 86400)) * 7 * 86400; // start of a 7-day block
  const days = Array.from({ length: 21 }, (_, i) => bar(t0 + i * 86400, i));
  const out = resample(days, '7D');
  assert.equal(out.length, 3);
  assert.equal(out[1].time, t0 + 7 * 86400);
  assert.equal(out[1].open, 7); assert.equal(out[1].close, 13.5);
  assert.equal(out[1].high, 14); assert.equal(out[1].low, 6);
  assert.equal(out[1].volume, 70);
});

test('stock N-day candles hold N trading days (weekends do not split them)', () => {
  assert.equal(weekdayIndex(day('1970-01-05')), 0);                                   // a Monday
  assert.equal(weekdayIndex(day('2026-11-16')) - weekdayIndex(day('2026-11-13')), 1); // Fri → Mon = next session
  const sessions = [];
  for (let t = day('2026-09-07'); sessions.length < 20; t += 86400) { // 4 full weeks, Mon–Fri
    const iso = new Date(t * 1000).toISOString().slice(0, 10);
    if (new Date(t * 1000).getUTCDay() % 6 !== 0) sessions.push(bar(iso, sessions.length));
  }
  const five = resample(sessions, '5D', true);
  assert.deepEqual(five.map((c) => c.time), ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
  assert.ok(five.every((c) => c.volume === 50));
  assert.ok(resample(sessions, '4D', true).slice(1, -1).every((c) => c.volume === 40)); // only the edges can be partial
  // the old calendar-block rule cut the same weeks into uneven pieces
  assert.ok(resample(sessions, '5D', false).some((c) => c.volume !== 50));
});

test('weeks and months group by calendar', () => {
  assert.equal(bucketKey('2026-01-05', '2W'), bucketKey('2026-01-12', '2W'));
  assert.notEqual(bucketKey('2026-01-12', '2W'), bucketKey('2026-01-19', '2W'));
  assert.equal(bucketKey('2026-01-01', '3M'), bucketKey('2026-03-01', '3M'));   // Q1
  assert.notEqual(bucketKey('2026-03-01', '3M'), bucketKey('2026-04-01', '3M'));
  assert.equal(bucketKey('2026-01-01', '6M'), bucketKey('2026-06-01', '6M'));
  assert.equal(bucketKey('2026-01-01', '1Y'), bucketKey('2026-12-01', '1Y'));
  assert.notEqual(bucketKey('2025-12-01', '1Y'), bucketKey('2026-01-01', '1Y'));
});

test('Binance history is paged backwards and stops when the pair runs out', async () => {
  const urls = [], realFetch = globalThis.fetch;
  const total = 2300, t0 = 1_600_000_000_000; // the pair only has 2300 candles
  globalThis.fetch = async (url) => {
    urls.push(url);
    const q = new URL(url).searchParams, limit = +q.get('limit');
    const end = q.has('endTime') ? Math.floor((+q.get('endTime') - t0) / 86_400_000) : total - 1;
    const rows = [];
    for (let i = Math.max(0, end - limit + 1); i <= end; i++) rows.push([t0 + i * 86_400_000, '1', '2', '0.5', '1.5', '10']);
    return { ok: true, json: async () => rows };
  };
  try {
    const c = await binanceCandles('BTCUSDT', '1D', 4000);
    assert.equal(c.length, total);
    assert.equal(urls.length, 3);
    assert.ok(c.every((x, i) => i === 0 || x.time - c[i - 1].time === 86400)); // in order, no gaps or repeats
  } finally { globalThis.fetch = realFetch; }
});

// ── Drawings saved by older versions ──
test('broken saved drawings are repaired or dropped', () => {
  assert.equal(normTime({ year: 2026, month: 3, day: 9 }), '2026-03-09');
  assert.equal(normTime('2026-03-09'), '2026-03-09');
  assert.equal(normTime(1_700_000_000), 1_700_000_000);
  assert.equal(normTime(null), null);
  assert.equal(normTime('[object Object]'), null);
  const out = sanitizeDrawings([
    { type: 'trend', p1: { time: '2026-01-02', price: 10 }, p2: { time: { year: 2026, month: 11, day: 13 }, price: 12 } },
    { type: 'brush', pts: [{ time: null, price: 1 }, { time: null, price: 2 }] },
    { type: 'hline', p1: { time: 1_700_000_000, price: 5 } },
    { type: 'channel', p1: { time: 1, price: 1 }, p2: { time: 2, price: 2 }, off: 0.5 },
    { type: 'channel', p1: { time: 1, price: 1 }, p2: { time: 2, price: 2 } },
    { type: 'nope' }, null,
  ]);
  assert.deepEqual(out.map((d) => d.type), ['trend', 'hline', 'channel']);
  assert.equal(out[0].p2.time, '2026-11-13');
});
