// Oscillators: Stochastic (+forecast, stochastic volatility), Cutler's RSI
// with divergences, DMI/ADX, and helpers. Pure functions, arrays in → arrays out
// (null where not enough history).
import { sma, ema } from './ma.js';

// SMA that tolerates leading nulls.
export function smaN(values, length) {
  const out = new Array(values.length).fill(null);
  let sum = 0, count = 0;
  const win = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) { win.length = 0; sum = 0; count = 0; continue; }
    win.push(v); sum += v; count++;
    if (win.length > length) { sum -= win.shift(); count--; }
    if (count === length) out[i] = sum / length;
  }
  return out;
}
export function emaN(values, length) {
  const first = values.findIndex((v) => v != null);
  if (first < 0) return values.map(() => null);
  const tail = ema(values.slice(first), length);
  return [...new Array(first).fill(null), ...tail];
}

function rollingMinMax(values, length) {
  const lo = new Array(values.length).fill(null), hi = new Array(values.length).fill(null);
  for (let i = length - 1; i < values.length; i++) {
    let mn = Infinity, mx = -Infinity, ok = true;
    for (let j = i - length + 1; j <= i; j++) {
      const v = values[j]; if (v == null) { ok = false; break; }
      if (v < mn) mn = v; if (v > mx) mx = v;
    }
    if (ok) { lo[i] = mn; hi[i] = mx; }
  }
  return { lo, hi };
}

// ── Stochastic ──
export function stochastic({ high, low, close }, { k = 14, d = 3, smooth = 6 }) {
  const { lo } = rollingMinMax(low, k), { hi } = rollingMinMax(high, k);
  const raw = close.map((c, i) => (lo[i] == null ? null : hi[i] === lo[i] ? 50 : ((c - lo[i]) / (hi[i] - lo[i])) * 100));
  const K = smaN(raw, smooth);
  const D = smaN(K, d);
  return { k: K, d: D };
}

// Linear extrapolation of the last `fit` values, `ahead` steps forward, clamped 0–100.
export function forecast(values, ahead = 3, fit = 3) {
  const tail = values.slice(-fit);
  if (tail.length < fit || tail.some((v) => v == null)) return [];
  const slope = (tail[fit - 1] - tail[0]) / (fit - 1);
  return Array.from({ length: ahead }, (_, i) => Math.max(0, Math.min(100, tail[fit - 1] + slope * (i + 1))));
}

// Stochastic of volatility: where today's volatility sits in its own
// `lookback` range (0 = calmest, 100 = most volatile), smoothed.
export function stochVolatility(close, { lookback = 255, smooth = 3, volLength = 14 }) {
  const rets = close.map((c, i) => (i === 0 ? null : Math.log(c / close[i - 1])));
  const vol = rets.map((_, i) => {
    if (i < volLength) return null;
    const w = rets.slice(i - volLength + 1, i + 1);
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length);
  });
  const { lo, hi } = rollingMinMax(vol, lookback);
  const st = vol.map((v, i) => (lo[i] == null ? null : hi[i] === lo[i] ? 50 : ((v - lo[i]) / (hi[i] - lo[i])) * 100));
  return smaN(st, smooth);
}

// ── RSI ──
// "Cutler" RSI uses simple averages of gains/losses (Wilder uses RMA).
export function rsi(close, length = 14, type = 'cutler') {
  const n = close.length, out = new Array(n).fill(null);
  const gains = [0], losses = [0];
  for (let i = 1; i < n; i++) { const ch = close[i] - close[i - 1]; gains.push(Math.max(ch, 0)); losses.push(Math.max(-ch, 0)); }
  let ag, al;
  if (type === 'cutler') {
    ag = sma(gains.slice(1), length); al = sma(losses.slice(1), length);
    ag.unshift(null); al.unshift(null);
  } else { // wilder
    ag = new Array(n).fill(null); al = new Array(n).fill(null);
    if (n > length) {
      let g = 0, l = 0;
      for (let i = 1; i <= length; i++) { g += gains[i]; l += losses[i]; }
      ag[length] = g / length; al[length] = l / length;
      for (let i = length + 1; i < n; i++) {
        ag[i] = (ag[i - 1] * (length - 1) + gains[i]) / length;
        al[i] = (al[i - 1] * (length - 1) + losses[i]) / length;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (ag[i] == null) continue;
    out[i] = al[i] === 0 ? (ag[i] === 0 ? 50 : 100) : 100 - 100 / (1 + ag[i] / al[i]);
  }
  return out;
}

// Pivot detection on an oscillator: confirmed `right` bars later (no repaint).
export function pivots(values, left = 5, right = 3) {
  const highs = [], lows = [];
  for (let i = left; i < values.length - right; i++) {
    const v = values[i]; if (v == null) continue;
    let isH = true, isL = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i || values[j] == null) continue;
      if (values[j] >= v) isH = false;
      if (values[j] <= v) isL = false;
    }
    if (isH) highs.push(i);
    if (isL) lows.push(i);
  }
  return { highs, lows };
}

// Regular + hidden divergences between price (close) and an oscillator,
// comparing each pivot with the previous one within `lookback` bars.
export function divergences(close, osc, { left = 5, right = 3, lookback = 50 } = {}) {
  const { highs, lows } = pivots(osc, left, right);
  const out = [];
  for (let a = 1; a < lows.length; a++) {
    const i = lows[a], j = lows[a - 1];
    if (i - j > lookback) continue;
    if (close[i] < close[j] && osc[i] > osc[j]) out.push({ index: i, from: j, type: 'regBull' });
    else if (close[i] > close[j] && osc[i] < osc[j]) out.push({ index: i, from: j, type: 'hidBull' });
  }
  for (let a = 1; a < highs.length; a++) {
    const i = highs[a], j = highs[a - 1];
    if (i - j > lookback) continue;
    if (close[i] > close[j] && osc[i] < osc[j]) out.push({ index: i, from: j, type: 'regBear' });
    else if (close[i] < close[j] && osc[i] > osc[j]) out.push({ index: i, from: j, type: 'hidBear' });
  }
  return { list: out.sort((x, y) => x.index - y.index), highs, lows };
}

// ── DMI / ADX (Wilder) ──
export function dmi({ high, low, close }, length = 14) {
  const n = close.length;
  const tr = [0], pdm = [0], mdm = [0];
  for (let i = 1; i < n; i++) {
    const up = high[i] - high[i - 1], dn = low[i - 1] - low[i];
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  }
  const rma = (arr) => {
    const out = new Array(n).fill(null);
    if (n <= length) return out;
    let s = 0; for (let i = 1; i <= length; i++) s += arr[i];
    out[length] = s / length;
    for (let i = length + 1; i < n; i++) out[i] = (out[i - 1] * (length - 1) + arr[i]) / length;
    return out;
  };
  const atr = rma(tr), sp = rma(pdm), sm = rma(mdm);
  const plus = atr.map((a, i) => (a ? (sp[i] / a) * 100 : null));
  const minus = atr.map((a, i) => (a ? (sm[i] / a) * 100 : null));
  const dx = plus.map((p, i) => (p == null || p + minus[i] === 0 ? null : (Math.abs(p - minus[i]) / (p + minus[i])) * 100));
  const first = dx.findIndex((v) => v != null);
  const adx = new Array(n).fill(null);
  if (first >= 0 && first + length <= n) {
    let s = 0; for (let i = first; i < first + length; i++) s += dx[i];
    adx[first + length - 1] = s / length;
    for (let i = first + length; i < n; i++) adx[i] = (adx[i - 1] * (length - 1) + dx[i]) / length;
  }
  return { plus, minus, adx };
}

// Auto Fibonacci from the highest high / lowest low of the last `lookback` bars.
export function autoFib({ high, low }, lookback = 200, levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]) {
  const s = Math.max(0, high.length - lookback);
  let hi = -Infinity, lo = Infinity, hiI = 0, loI = 0;
  for (let i = s; i < high.length; i++) {
    if (high[i] > hi) { hi = high[i]; hiI = i; }
    if (low[i] < lo) { lo = low[i]; loI = i; }
  }
  const upTrend = loI < hiI; // swing went low → high: retracements measured down from the high
  return levels.map((l) => ({ level: l, price: upTrend ? hi - (hi - lo) * l : lo + (hi - lo) * l }));
}
