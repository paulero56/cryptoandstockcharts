# PM Terminal

A Bloomberg-style charting terminal built with open-source tools. It looks and works like a small personal TradingView.

- **Charts:** [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0)
- **Crypto:** Binance public market data, real time over WebSocket, no API key needed
- **Stocks:** [Twelve Data](https://twelvedata.com), free API key, refreshed every 60 s
- **Overlays:** SMA / EMA (SMA 9 and SMA 200 on by default), SMA 9 × SMA 200 crossover signals, HPDR Bands (+ forward projection), AutoFib
- **Panes:** HPDRO, HPDRV, Advanced Stoch (forecast + stochastic volatility), RSI divergence (Cutler RSI, pivots, regular + hidden), Jewel~
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
| `HPDR` `HPDRO` `HPDRV` | Toggle HPDR bands / oscillator / volatility |
| `STOCH` `RSI` `JEWEL` | Toggle Advanced Stoch / RSI divergence / Jewel~ + AutoFib |
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
- Divergences and alerts are only marked on closed candles, and pivots are confirmed a few bars later, so they never repaint.

## About the indicators

The HPDR family, Advanced Stoch, CT RSI Div and The Jewel used on TradingView are third-party scripts, several of them private or paid. **None of their code is copied here.** Each study below is a from-scratch implementation of the published concept, using the same inputs, so values can differ from the originals.

| Study | How it's calculated here | Settings in `src/config.js` |
|---|---|---|
| **HPDR Bands** | Every past N-bar price change ("delta") is collected and sorted. Each range *p* is the band that held *p*% of those moves: `price[t−N] × (1 + percentile(deltas, 50 ± p/2))`. The median is the 50th percentile. Only past deltas are used. | `HPDR` (sampling 7, max array 100000, ranges 38.2…100) |
| **HPDRO** | Percentile rank (0–100) of the current N-bar delta, with an SMA 5. Alert dots fire when it crosses beyond the 95% range. | `HPDRO` |
| **HPDRV** | Percentile rank of the size of the current move (abs(delta)), with an SMA 5. Higher means a more volatile move than usual. | `HPDRV` |
| **Advanced Stoch** | Stochastic with K 14, smoothing 6 and D 3. A dashed forecast extends K and D 3 bars ahead. The coloured line is stochastic volatility: where 14-bar volatility sits in its 255-bar range, smoothed 3. | `STOCH` |
| **RSI Divergence** | Cutler RSI 14 (simple averages) with an SMA 12 signal. Pivots are confirmed 5 bars left and 3 right. Regular and hidden bull/bear divergences are checked within 50 bars. | `RSIDIV` |
| **Jewel~** | *Interpretation:* Fast = RSI 14, Slow = EMA 9 of Fast, High = ADX × DMI factor, an EMA 21/55 trend strip at 110, background shading on EMA crosses, and AutoFib levels over the last 200 bars on the price chart. | `JEWEL` |

Fills between bands aren't drawn; Lightweight Charts has no fill between two lines. That can be added later with a custom series plugin.

This is an analysis tool, not financial advice.

## Project structure

```
src/
  config.js            brand + defaults
  main.js              UI, chart and wiring
  style.css            terminal theme
  data/                binance.js, twelvedata.js, index.js (routes by symbol)
  studies.js           pane studies (HPDRO, HPDRV, Stoch, RSI, Jewel~)
  indicators/          ma.js, cross.js, hpdr.js, oscillators.js (pure functions, unit-tested)
test/                  node --test
```
