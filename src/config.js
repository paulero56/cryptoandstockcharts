// ─────────────────────────────────────────────────────────────
//  Brand + defaults. Change these to make the terminal yours.
// ─────────────────────────────────────────────────────────────
export const BRAND = {
  name: 'PM TERMINAL',      // full name shown in the top bar
  ticker: 'PMT',            // short tag shown in the logo box
  tagline: 'MARKET ANALYTICS',
};

export const DEFAULTS = {
  symbol: 'BTCUSDT',
  interval: '1D',
};

// Moving averages drawn on the price chart. Add / remove freely.
export const MOVING_AVERAGES = [
  { id: 'sma9',   type: 'SMA', length: 9,   color: '#00d7ff', visible: true },
  { id: 'ema21',  type: 'EMA', length: 21,  color: '#c77dff', visible: false },
  { id: 'ema55',  type: 'EMA', length: 55,  color: '#f5e663', visible: false },
  { id: 'sma200', type: 'SMA', length: 200, color: '#ffa028', visible: true },
];

// Crossover signals: fast MA crossing slow MA (only on CLOSED candles).
export const CROSS = { fast: 'sma9', slow: 'sma200', enabled: true };

// ── HPDR family (Historical Price Delta Range) — see src/indicators/hpdr.js ──
export const HPDR = {
  enabled: true,
  source: 'close',
  length: 7,            // "Sampling Length"
  maxArray: 100000,     // "Max Array Size"
  project: false,       // "Project Bands Forward"
  lineAlpha: 0.6,       // "Line Transparency 40"
  median: '#ffffff',
  ranges: [
    { p: 38.2, color: '#2950ff' },
    { p: 50,   color: '#6ef5ff' },
    { p: 61.8, color: '#5bbf6a' },
    { p: 78.6, color: '#7dff4f' },
    { p: 88.3, color: '#ffff55' },
    { p: 95,   color: '#f2c14e' },
    { p: 97.5, color: '#f08a3c' },
    { p: 100,  color: '#e8392c' },
  ],
};
export const HPDRO = { enabled: true,  lineWidth: 2, ma: { on: true, type: 'SMA', length: 5, color: '#e84a4a', width: 2 }, alerts: true };
export const HPDRV = { enabled: false, lineWidth: 2, ma: { on: true, type: 'SMA', length: 5, color: '#ffffff', width: 2 } };

// ── Advanced Stoch ──
export const STOCH = {
  enabled: true,
  k: 14, d: 3, smooth: 6,
  forecastK: true, forecastD: true, forecastBars: 3,
  volatility: { enabled: true, lookback: 255, smooth: 3 },
  colors: { k: '#00d7ff', d: '#ffa028' },
};

// ── RSI divergence ──
export const RSIDIV = {
  enabled: true,
  length: 14, type: 'cutler',          // 'cutler' (SMA) or 'wilder' (RMA)
  signal: 12, signalType: 'SMA',
  pivots: true, left: 5, right: 3,     // pivot confirmation bars
  lookback: 50,                        // "Divergence lookback bars"
  colors: { rsi: '#00d7ff', signal: '#ffffff', pivot: '#b0b4bd', regBull: '#7dff4f', regBear: '#e8392c', hidBull: '#2950ff', hidBear: '#f08a3c' },
};

// ── Jewel-style composite (interpretation — see README) ──
export const JEWEL = {
  enabled: false,
  autoFib: true, fibLookback: 200,
  emaCross: true, emaShort: 21, emaLong: 55, emaLinePos: 110,
  bgAlerts: true,
  showFast: true, showSlow: true, showHigh: true,
  smoothing: 1, smoothingEma: true,
  useClose: true,
  dmiFactor: 1,
};

export const WATCHLIST = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];

export const INTERVALS = ['1m', '5m', '15m', '1H', '4H', '1D', '1W', '1M'];
export const INTERVAL_SECONDS = { '1m': 60, '5m': 300, '15m': 900, '1H': 3600, '4H': 14400, '1D': 86400, '1W': 604800, '1M': 2592000 };
