# PM Terminal

A Bloomberg-style charting terminal built with open-source tools. It looks and works like a small personal TradingView.

- **Charts:** [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0)
- **Crypto:** Binance public market data, real time over WebSocket, no API key needed
- **Stocks / forex:** [Twelve Data](https://twelvedata.com), free API key. Open chart updates every 60 s (plus a **⟳ UPDATE** button); watchlist quotes every 10 min. Nothing is fetched while the tab is hidden or the market is closed, so a full day stays under the free 800 credits.
- **Overlays:** EMA 5/9/21/34/55/100/200, SMA 9/100/200, SMA 9 × SMA 200 crossover signals, Bollinger Bands 20/2, HPDR Bands with coloured fills, range scale and forward projection, AutoFib
- **Panes:** BBWP (13/252, SMA 5, 98/2 extremes), RSI 14 + SMA 14 with 30–70 zone, MACD 12/26/9, HPDRO, HPDRV, Advanced Stoch (forecast + stochastic volatility), RSI divergence (Cutler RSI, pivots, regular + hidden), Jewel~
- **Drawing tools:** trend line (shows % and bars), horizontal line (shows % from price), freehand brush, measure box (change, %, bars, time, volume — like TradingView). Neon color palette with outline + glow so lines stand out on any background. Saved per symbol.
- **Timeframes (like TradingView):** minutes 1m 3m 5m 15m 30m 45m · hours 1H 2H 3H 4H 6H 8H 12H · days 1D 2D 3D 5D · 1W 2W 1M 3M 1Y. Favorites (★) show as buttons, the rest are in the **▾** menu. Anything a data source doesn't offer natively is built from smaller candles.
- **Watchlist:** add/remove any symbol; defaults include altcoins, gold (PAXGUSDT, live), USD/MXN (USDTMXN, live), Coinbase (COIN), Circle (CRCL), gold spot (XAU/USD) and USD/MXN forex
- **Terminal UI:** command line, function keys, watchlist, signals panel
- **Studies guide:** `guide.html` (F9, the **GUIDE** button or the **?** next to each study) explains every indicator in Spanish. Each card has **▶ VER EN EL CHART**, which opens the terminal with that study on (`/?study=hpdr,ema21`).

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
| `BB` `BBWP` `RSI` `MACD` | Toggle Bollinger / BBWP / RSI / MACD |
| `STOCH` `RSIDIV` `JEWEL` | Toggle Advanced Stoch / RSI divergence / Jewel~ + AutoFib |
| `CLEAR` or **ALL OFF** button | Turn every study off at once; again (**RESTORE**) brings back your previous selection |
| `ADD PEPEUSDT` / `DEL COIN` | Add / remove a watchlist symbol (or use the box under the watchlist) |
| **T** / **H** / **B** / **M** | Trend line / horizontal line / brush / measure. **Shift + click** = quick measure. Pick a neon color in the toolbar (recolors the selected drawing too). Click a drawing, then **Delete** |
| `/` or **F2** | Focus the command line |
| **F1** | Help |
| **F3** | Studies |
| **F4** | HPDR on/off |
| **F8** | Settings |
| **F9** | Studies guide |

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
| **BBWP** | Bollinger Band Width Percentile: band width `(upper − lower) / basis` with SMA 13 and 1 stdev, ranked against the last 252 bars (0 = tightest squeeze, 100 = widest), plus an SMA 5. Red bars at ≥ 98, blue bars at ≤ 2. | `BBWP` |
| **RSI / MACD / BB** | Standard formulas (Wilder RSI 14 + SMA 14, MACD 12/26/9, Bollinger 20/2). | `RSISTD`, `MACD`, `BB` |
| **HPDRO** | Percentile rank (0–100) of the current N-bar delta, with an SMA 5. Alert dots fire when it crosses beyond the 95% range. | `HPDRO` |
| **HPDRV** | Percentile rank of the size of the current move (abs(delta)), with an SMA 5. Higher means a more volatile move than usual. | `HPDRV` |
| **Advanced Stoch** | Stochastic with K 14, smoothing 6 and D 3. A dashed forecast extends K and D 3 bars ahead. The coloured line is stochastic volatility: where 14-bar volatility sits in its 255-bar range, smoothed 3. | `STOCH` |
| **RSI Divergence** | Cutler RSI 14 (simple averages) with an SMA 12 signal. Pivots are confirmed 5 bars left and 3 right. Regular and hidden bull/bear divergences are checked within 50 bars. | `RSIDIV` |
| **Jewel~** | *Interpretation:* Fast = RSI 14, Slow = EMA 9 of Fast, High = ADX × DMI factor, an EMA 21/55 trend strip at 110, background shading on EMA crosses, and AutoFib levels over the last 200 bars on the price chart. | `JEWEL` |

Band fills (HPDR, Bollinger, the RSI zone) are drawn by a small canvas plugin in `src/primitives/bandFill.js`, because Lightweight Charts has no built-in fill between two lines.

Not included: *Moon Phases* and *Trend Wave Catalyst [Quant Alchemy]* (hidden on the reference chart).

This is an analysis tool, not financial advice.

## Project structure

```
src/
  config.js            brand + defaults
  main.js              UI, chart and wiring
  style.css            terminal theme
  data/                binance.js, twelvedata.js, index.js (routes by symbol)
  studies.js           pane studies (BBWP, RSI, MACD, HPDRO, HPDRV, Stoch, RSI div, Jewel~)
  primitives/          bandFill.js (fills between lines + HPDR range scale)
  indicators/          ma.js, cross.js, hpdr.js, oscillators.js (pure functions, unit-tested)
test/                  node --test
```
