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
