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

// Moving averages drawn on the chart. Add / remove freely.
export const MOVING_AVERAGES = [
  { id: 'sma9',   type: 'SMA', length: 9,   color: '#00d7ff', visible: true },
  { id: 'ema21',  type: 'EMA', length: 21,  color: '#c77dff', visible: false },
  { id: 'ema55',  type: 'EMA', length: 55,  color: '#f5e663', visible: false },
  { id: 'sma200', type: 'SMA', length: 200, color: '#ffa028', visible: true },
];

// Crossover signals: fast MA crossing slow MA (only on CLOSED candles).
export const CROSS = { fast: 'sma9', slow: 'sma200', enabled: true };

// HPDR-style bands (approximation — see src/indicators/hpdr.js).
export const HPDR = {
  enabled: true,
  longLength: 100,
  shortLength: 20,
  longWeight: 0.5,
  levels: [0, 38.2, 50, 61.8, 78.6, 88.3, 95, 97.5, 100],
};

export const WATCHLIST = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];

export const INTERVALS = ['1m', '5m', '15m', '1H', '4H', '1D', '1W', '1M'];
