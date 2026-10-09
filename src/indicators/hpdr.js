// ─────────────────────────────────────────────────────────────
//  HPDR-STYLE BANDS  —  APPROXIMATION
//
//  The original "HPDR Bands Indicator" by afonso_77 on TradingView is
//  open source, but its exact formula isn't published outside the Pine
//  code. This is a stand-in built from its public description:
//    • a price range from historical highs/lows, blending a long and a
//      short lookback
//    • Fibonacci-like levels inside that range + a 50% midline
//    • a "range position" value: where the close sits in the range (0–100)
//
//  To match TradingView exactly, open the script's "Source code" on
//  TradingView and replace computeHpdr() with a port of the Pine logic.
//  Keep the same return shape and the rest of the app keeps working.
// ─────────────────────────────────────────────────────────────

function rolling(arr, length, pick) {
  const out = new Array(arr.length).fill(null);
  for (let i = length - 1; i < arr.length; i++) {
    let v = arr[i];
    for (let j = i - length + 1; j < i; j++) v = pick(v, arr[j]);
    out[i] = v;
  }
  return out;
}

/**
 * @param {{high:number[], low:number[], close:number[]}} c
 * @returns {{levels: Record<string,(number|null)[]>, position: (number|null)[]}}
 */
export function computeHpdr(c, { longLength, shortLength, longWeight, levels }) {
  const hiL = rolling(c.high, longLength, Math.max);
  const loL = rolling(c.low, longLength, Math.min);
  const hiS = rolling(c.high, shortLength, Math.max);
  const loS = rolling(c.low, shortLength, Math.min);
  const w = longWeight;

  const top = hiL.map((v, i) => (v == null ? null : w * v + (1 - w) * hiS[i]));
  const bot = loL.map((v, i) => (v == null ? null : w * v + (1 - w) * loS[i]));

  const out = {};
  for (const lvl of levels) {
    out[lvl] = top.map((t, i) => (t == null ? null : bot[i] + (t - bot[i]) * (lvl / 100)));
  }
  const position = c.close.map((cl, i) => {
    if (top[i] == null || top[i] === bot[i]) return null;
    return Math.max(0, Math.min(100, ((cl - bot[i]) / (top[i] - bot[i])) * 100));
  });
  return { levels: out, position };
}
