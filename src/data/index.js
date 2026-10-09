// One entry point for every market. The rest of the app never needs to know
// whether a symbol is crypto or a stock.
import * as binance from './binance.js';
import * as twelve from './twelvedata.js';

const CRYPTO_QUOTES = /(USDT|USDC|FDUSD|BUSD|BTC|ETH|BNB|EUR|TRY)$/;

export function sourceFor(symbol) {
  return CRYPTO_QUOTES.test(symbol) && symbol.length > 5 ? 'binance' : 'twelvedata';
}

export function fetchCandles(symbol, interval, opts = {}) {
  return sourceFor(symbol) === 'binance'
    ? binance.fetchCandles(symbol, interval)
    : twelve.fetchCandles(symbol, interval, opts.apiKey);
}

export function subscribe(symbol, interval, onCandle, opts = {}) {
  return sourceFor(symbol) === 'binance'
    ? binance.subscribe(symbol, interval, onCandle)
    : twelve.subscribe(symbol, interval, opts.apiKey, onCandle);
}

export const fetchCryptoTickers = binance.fetchTickers;
