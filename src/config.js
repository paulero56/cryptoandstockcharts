// ─────────────────────────────────────────────────────────────
//  Brand + defaults. Change these to make the terminal yours.
// ─────────────────────────────────────────────────────────────
export const BRAND = {
  name: 'PM TERMINAL',      // full name shown in the top bar
  ticker: 'PMT',            // short tag shown in the logo box
  tagline: 'MARKET ANALYTICS',
  contact: 'montanopaul@gmail.com', // shown in the footer for feedback / bug reports
};

export const DEFAULTS = {
  symbol: 'BTCUSDT',
  interval: '1D',
};

// Moving averages drawn on the price chart. Add / remove freely.
export const MOVING_AVERAGES = [
  { id: 'sma9',   type: 'SMA', length: 9,   color: '#00d7ff', visible: false },
  { id: 'ema5',   type: 'EMA', length: 5,   color: '#ef9a9a', visible: false },
  { id: 'ema9',   type: 'EMA', length: 9,   color: '#448aff', visible: true },
  { id: 'ema21',  type: 'EMA', length: 21,  color: '#9575cd', visible: true },
  { id: 'ema34',  type: 'EMA', length: 34,  color: '#f48fb1', visible: true },
  { id: 'ema55',  type: 'EMA', length: 55,  color: '#f5e663', visible: true },
  { id: 'ema100', type: 'EMA', length: 100, color: '#81c784', visible: true },
  { id: 'sma100', type: 'SMA', length: 100, color: '#4db6ac', visible: false },
  { id: 'ema200', type: 'EMA', length: 200, color: '#ff8a65', visible: false },
  { id: 'sma200', type: 'SMA', length: 200, color: '#ffffff', visible: true },
];

// Bollinger Bands overlay ("BB 20 SMA close 2")
export const BB = { enabled: false, length: 20, mult: 2, basisType: 'SMA', color: '#2196f3', fillAlpha: 0.06 };

// Crossover signals: fast MA crossing slow MA (only on CLOSED candles).
export const CROSS = { fast: 'sma9', slow: 'sma200', enabled: true }; // SMA 9 is computed even when hidden

// ── HPDR family (Historical Price Delta Range) — see src/indicators/hpdr.js ──
export const HPDR = {
  enabled: true,
  source: 'close',
  length: 7,            // "Sampling Length"
  maxArray: 100000,     // "Max Array Size"
  project: false,       // "Project Bands Forward"
  lineAlpha: 0.6,       // "Line Transparency 40"
  fill: true,           // "Linefill On"
  fillAlpha: 0.10,      // "Fill Transparency 90"
  scale: true,          // "Scale On" + "Text On": range labels right of the last bar
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
export const HPDRO = { enabled: false,  lineWidth: 2, ma: { on: true, type: 'SMA', length: 5, color: '#e84a4a', width: 2 }, alerts: true };
export const HPDRV = { enabled: false, lineWidth: 2, ma: { on: true, type: 'SMA', length: 5, color: '#ffffff', width: 2 } };

// ── BBWP — Bollinger Band Width Percentile ("BBWP close SMA 13 252 … SMA 5 98 2") ──
export const BBWP = {
  enabled: true,
  length: 13, basisType: 'SMA', lookback: 252,
  ma: { on: true, type: 'SMA', length: 5, color: '#ffffff' },
  extremeHigh: 98, extremeLow: 2,   // red / blue bars when reached
};

// ── RSI (standard Wilder) with MA and 30–70 zone ──
export const RSISTD = { enabled: true, length: 14, ma: { type: 'SMA', length: 14 }, colors: { rsi: '#7e57c2', ma: '#f2c14e', zone: 'rgba(126,87,194,.10)' } };

// ── MACD ──
export const MACD = { enabled: true, fast: 12, slow: 26, signal: 9, colors: { macd: '#2962ff', signal: '#ff6d00', upStrong: '#26a69a', upWeak: '#b2dfdb', downStrong: '#ff5252', downWeak: '#ffcdd2' } };

// ── Advanced Stoch ──
export const STOCH = {
  enabled: false,
  k: 14, d: 3, smooth: 6,
  forecastK: true, forecastD: true, forecastBars: 3,
  volatility: { enabled: true, lookback: 255, smooth: 3 },
  colors: { k: '#00d7ff', d: '#ffa028' },
};

// ── RSI divergence ──
export const RSIDIV = {
  enabled: false,
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

// Default watchlist (you can add/remove symbols in the app; your list is saved in the browser).
// Binance pairs update live. Symbols with "/" or plain tickers (COIN, CRCL…) use Twelve Data (key: F8).
export const WATCHLIST = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'SUIUSDT',
  'PAXGUSDT',   // gold (PAX Gold token, tracks 1 oz) — live, no key
  'USDTMXN',    // dollar vs Mexican peso (USDT/MXN) — live, no key
  'COIN',       // Coinbase (stock)
  'CRCL',       // Circle (stock)
  'XAU/USD',    // gold spot
  'USD/MXN',    // forex
];
// Friendly names shown in the watchlist
export const LABELS = {
  PAXGUSDT: 'GOLD·PAXG', USDTMXN: 'USD/MXN·T', COIN: 'COINBASE', CRCL: 'CIRCLE', 'XAU/USD': 'GOLD', 'USD/MXN': 'USD/MXN',
};

export const INTERVALS = ['1m', '5m', '15m', '1H', '4H', '1D', '5D', '1W', '2W', '1M', '3M', '1Y'];
export const INTERVAL_SECONDS = { '1m': 60, '5m': 300, '15m': 900, '1H': 3600, '4H': 14400, '1D': 86400, '5D': 432000, '1W': 604800, '2W': 1209600, '1M': 2592000, '3M': 7776000, '1Y': 31557600 };
