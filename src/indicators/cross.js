// Detect crossovers between a fast and a slow series.
// `lastClosedIndex` lets you ignore the still-forming candle, so signals don't
// appear and disappear while the bar is open ("repainting").
export function crossovers(fast, slow, lastClosedIndex = fast.length - 1) {
  const signals = [];
  for (let i = 1; i <= lastClosedIndex; i++) {
    const f0 = fast[i - 1], s0 = slow[i - 1], f1 = fast[i], s1 = slow[i];
    if (f0 == null || s0 == null || f1 == null || s1 == null) continue;
    if (f0 <= s0 && f1 > s1) signals.push({ index: i, type: 'bull' });
    else if (f0 >= s0 && f1 < s1) signals.push({ index: i, type: 'bear' });
  }
  return signals;
}
