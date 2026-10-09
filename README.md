# PM Terminal

A Bloomberg-style charting terminal built with open-source tools. It looks and works like a small personal TradingView.

- **Charts:** [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0)
- **Crypto:** Binance public market data, real time over WebSocket, no API key needed
- **Stocks:** [Twelve Data](https://twelvedata.com), free API key, refreshed every 60 s
- **Studies:** SMA / EMA (SMA 9 and SMA 200 on by default), SMA 9 × SMA 200 crossover signals, HPDR-style bands
- **Terminal UI:** command line, function keys, watchlist, signals panel

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # indicator unit tests
npm run build    # production build in dist/
```

Deploy to Netlify by connecting the repo. `netlify.toml` is already set up.

## Using it

| Input | What it does |
|---|---|
| `BTCUSDT 1D` | Load a symbol and timeframe |
| `4H` | Change only the timeframe (`1m` = minute, `1M` = month) |
| `AAPL 1W` | Load a stock (needs a Twelve Data key: press **F8**) |
| `HPDR` | Toggle the HPDR bands |
| `/` or **F2** | Focus the command line |
| **F1** | Help |
| **F3** | Studies |
| **F4** | HPDR on/off |
| **F8** | Settings |

## Make it yours

Everything brand-related lives in [`src/config.js`](src/config.js): name, logo tag, colors of each MA, crossover pair, HPDR settings, watchlist. The color theme is in the `:root` variables at the top of [`src/style.css`](src/style.css).

## About accuracy

- SMA and EMA values match TradingView when the data source is the same. Binance BTCUSDT will differ slightly from TradingView's `BTCUSD INDEX`, which averages several exchanges.
- Crossover signals are only drawn on **closed** candles, so they never appear and then disappear while a bar is still forming.
- A monthly SMA 200 needs 200 months of history. Binance data starts in 2017, so that line can't be drawn on the monthly chart; use daily or weekly instead.
- **HPDR~ is an approximation.** The original *HPDR Bands Indicator* by afonso_77 is open source on TradingView, but its formula is only available inside the Pine code. To match it exactly, port that code into `computeHpdr()` in [`src/indicators/hpdr.js`](src/indicators/hpdr.js) and keep the same return shape. Credit the original author if you publish it.

This is an analysis tool, not financial advice.

## Project structure

```
src/
  config.js            brand + defaults
  main.js              UI, chart and wiring
  style.css            terminal theme
  data/                binance.js, twelvedata.js, index.js (routes by symbol)
  indicators/          ma.js, cross.js, hpdr.js (pure functions, unit-tested)
test/                  node --test
```
