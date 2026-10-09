// Moving averages. Input: array of numbers. Output: array of same length,
// with `null` where there isn't enough history yet.

export function sma(values, length) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= length) sum -= values[i - length];
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

// EMA seeded with the SMA of the first `length` values (same as TradingView).
export function ema(values, length) {
  const out = new Array(values.length).fill(null);
  if (values.length < length) return out;
  const k = 2 / (length + 1);
  let prev = 0;
  for (let i = 0; i < length; i++) prev += values[i];
  prev /= length;
  out[length - 1] = prev;
  for (let i = length; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function movingAverage(type, values, length) {
  return type === 'EMA' ? ema(values, length) : sma(values, length);
}
