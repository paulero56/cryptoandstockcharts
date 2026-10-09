// ─────────────────────────────────────────────────────────────
//  HPDR — Historical Price Delta Range  (own implementation)
//
//  Idea (public concept): collect every historical N-bar price change
//  ("delta"), sort them, and read percentiles. A "61.8 range" is the
//  band that contained 61.8% of all past N-bar moves.
//
//    delta[t]   = src[t] / src[t-N] − 1
//    band p (t) = src[t-N] × (1 + percentile(deltas, 50 ± p/2))
//    median (t) = src[t-N] × (1 + percentile(deltas, 50))
//
//  Only deltas known BEFORE bar t are used, so there is no look-ahead.
//
//  HPDRO (oscillator): percentile rank of the current delta (0–100).
//  HPDRV (volatility): percentile rank of |current delta| (0–100).
//
//  This is written from the concept and the visible settings, not from
//  the original (private / paid) scripts, so values can differ from them.
// ─────────────────────────────────────────────────────────────

const MIN_SAMPLES = 30;

function insertSorted(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
  arr.splice(lo, 0, v);
}
function removeSorted(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
  arr.splice(lo, 1);
}
export function percentile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (q / 100) * (sorted.length - 1);
  const i = Math.floor(pos), f = pos - i;
  return i + 1 < sorted.length ? sorted[i] + (sorted[i + 1] - sorted[i]) * f : sorted[i];
}
function rankOf(sorted, v) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  let hi2 = lo;
  while (hi2 < sorted.length && sorted[hi2] === v) hi2++;
  return ((lo + hi2) / 2 / sorted.length) * 100; // mid-rank, 0–100
}

/**
 * @param {number[]} src  price source (e.g. closes)
 * @param {{length:number, maxArray:number, ranges:number[], project?:boolean}} o
 * @returns {{
 *   median:(number|null)[], upper:Record<number,(number|null)[]>, lower:Record<number,(number|null)[]>,
 *   osc:(number|null)[], vol:(number|null)[],
 *   projection: null | {median:number[], upper:Record<number,number[]>, lower:Record<number,number[]>}
 * }}
 */
export function computeHpdr(src, { length: N, maxArray = 100000, ranges, project = false }) {
  const n = src.length;
  const median = new Array(n).fill(null), osc = new Array(n).fill(null), vol = new Array(n).fill(null);
  const upper = {}, lower = {};
  for (const p of ranges) { upper[p] = new Array(n).fill(null); lower[p] = new Array(n).fill(null); }

  const sorted = [], sortedAbs = [], fifo = [];
  for (let t = N; t < n; t++) {
    const base = src[t - N];
    const d = src[t] / base - 1;

    if (sorted.length >= MIN_SAMPLES) {
      median[t] = base * (1 + percentile(sorted, 50));
      for (const p of ranges) {
        upper[p][t] = base * (1 + percentile(sorted, 50 + p / 2));
        lower[p][t] = base * (1 + percentile(sorted, 50 - p / 2));
      }
      osc[t] = rankOf(sorted, d);
      vol[t] = rankOf(sortedAbs, Math.abs(d));
    }

    insertSorted(sorted, d); insertSorted(sortedAbs, Math.abs(d)); fifo.push(d);
    if (fifo.length > maxArray) { const old = fifo.shift(); removeSorted(sorted, old); removeSorted(sortedAbs, Math.abs(old)); }
  }

  // Forward projection: where the next N bars "should" land, from known bases.
  let projection = null;
  if (project && sorted.length >= MIN_SAMPLES) {
    projection = { median: [], upper: {}, lower: {} };
    for (const p of ranges) { projection.upper[p] = []; projection.lower[p] = []; }
    for (let k = 1; k <= N; k++) {
      const base = src[n - 1 - N + k];
      projection.median.push(base * (1 + percentile(sorted, 50)));
      for (const p of ranges) {
        projection.upper[p].push(base * (1 + percentile(sorted, 50 + p / 2)));
        projection.lower[p].push(base * (1 + percentile(sorted, 50 - p / 2)));
      }
    }
  }
  return { median, upper, lower, osc, vol, projection };
}
