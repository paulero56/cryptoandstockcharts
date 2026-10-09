// Binance public market data — free, no API key, real time.
// data-api.binance.vision / data-stream.binance.vision are Binance's
// market-data-only endpoints.
const REST = 'https://data-api.binance.vision/api/v3';
const WS = 'wss://data-stream.binance.vision/ws';

const INTERVAL_MAP = { '1m': '1m', '5m': '5m', '15m': '15m', '1H': '1h', '4H': '4h', '1D': '1d', '1W': '1w', '1M': '1M' };

const toCandle = (k) => ({
  time: Math.floor(k[0] / 1000),
  open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
});

export async function fetchCandles(symbol, interval, limit = 1000) {
  const url = `${REST}/klines?symbol=${symbol}&interval=${INTERVAL_MAP[interval]}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ${res.status}: unknown symbol "${symbol}"?`);
  return (await res.json()).map(toCandle);
}

// Live updates. onCandle(candle, isClosed). Returns an unsubscribe fn.
export function subscribe(symbol, interval, onCandle) {
  let ws, closed = false, retry;
  const open = () => {
    ws = new WebSocket(`${WS}/${symbol.toLowerCase()}@kline_${INTERVAL_MAP[interval]}`);
    ws.onmessage = (e) => {
      const k = JSON.parse(e.data).k;
      onCandle({ time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v }, k.x);
    };
    ws.onclose = () => { if (!closed) retry = setTimeout(open, 3000); };
  };
  open();
  return () => { closed = true; clearTimeout(retry); ws?.close(); };
}

export async function fetchTickers(symbols) {
  const res = await fetch(`${REST}/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`);
  if (!res.ok) return [];
  return (await res.json()).map((t) => ({
    symbol: t.symbol, last: +t.lastPrice, changePct: +t.priceChangePercent,
  }));
}
