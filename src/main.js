import './style.css';
import { createChart, CrosshairMode, LineStyle, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import { BRAND, DEFAULTS, MOVING_AVERAGES, CROSS, HPDR, HPDRO, HPDRV, STOCH, RSIDIV, JEWEL, WATCHLIST, INTERVALS, INTERVAL_SECONDS } from './config.js';
import { fetchCandles, subscribe, sourceFor, fetchCryptoTickers } from './data/index.js';
import { movingAverage } from './indicators/ma.js';
import { crossovers } from './indicators/cross.js';
import { computeHpdr } from './indicators/hpdr.js';
import { stochastic, forecast, stochVolatility, rsi, divergences, dmi, autoFib, smaN, emaN } from './indicators/oscillators.js';
import { PANE_STUDIES, toLine, hexA } from './studies.js';

const $ = (id) => document.getElementById(id);

// ── Persisted settings (browser storage can be unavailable → fall back) ──
const store = {
  get(k, d) { try { const v = localStorage.getItem('pmt:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pmt:' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

const state = {
  symbol: store.get('symbol', DEFAULTS.symbol),
  interval: store.get('interval', DEFAULTS.interval),
  apiKey: store.get('apiKey', ''),
  visible: store.get('visible', Object.fromEntries(MOVING_AVERAGES.map((m) => [m.id, m.visible]))),
  on: {
    cross: CROSS.enabled, hpdr: HPDR.enabled, hpdrProject: HPDR.project, hpdro: HPDRO.enabled, hpdrv: HPDRV.enabled,
    stoch: STOCH.enabled, rsi: RSIDIV.enabled, jewel: JEWEL.enabled,
    ...store.get('on', {}),
  },
  candles: [],
  lastOpen: true,      // is the last candle still forming?
  unsubscribe: null,
  loadId: 0,
};

// ── Formatting ──
const decimals = (p) => (p === 0 || p >= 1 ? 2 : p >= 0.01 ? 4 : 8);
const fmt = (p) => (p == null || isNaN(p) ? '—' : p.toLocaleString('en-US', { minimumFractionDigits: decimals(Math.abs(p)), maximumFractionDigits: decimals(Math.abs(p)) }));
const fmtPct = (p) => (p >= 0 ? '+' : '') + p.toFixed(2) + '%';
const fmtVol = (v) => (v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(2) + 'K' : v.toFixed(2));
const fmtTime = (t) => (typeof t === 'string' ? t : new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' '));

// ── Brand ──
$('brandTag').textContent = BRAND.ticker;
$('brandName').textContent = BRAND.name;
document.title = BRAND.name;

// ── Chart ──
const chart = createChart($('chart'), {
  autoSize: true,
  localization: { locale: 'en-US', priceFormatter: (p) => fmt(p) },
  layout: {
    background: { color: '#000000' }, textColor: '#9a9a9a', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
    panes: { separatorColor: '#2e2e2e', separatorHoverColor: 'rgba(255,160,40,.25)', enableResize: true },
  },
  grid: { vertLines: { color: '#111111' }, horzLines: { color: '#111111' } },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: '#ffa028', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#ffa028' },
    horzLine: { color: '#ffa028', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#ffa028' },
  },
  rightPriceScale: { borderColor: '#2e2e2e' },
  timeScale: { borderColor: '#2e2e2e', timeVisible: true, secondsVisible: false, rightOffset: 8 },
});

const candleSeries = chart.addSeries(CandlestickSeries, {
  upColor: '#26d07c', downColor: '#ff433d', borderUpColor: '#26d07c', borderDownColor: '#ff433d',
  wickUpColor: '#26d07c', wickDownColor: '#ff433d',
});
const crossMarkers = createSeriesMarkers(candleSeries, []);

const volumeSeries = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

const overlayLine = (opts) => chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...opts });

const maSeries = Object.fromEntries(MOVING_AVERAGES.map((m) => [m.id, overlayLine({ color: m.color, lineWidth: 2, lastValueVisible: true })]));

// HPDR bands: median + upper/lower line per range.
const hpdrSeries = {
  median: overlayLine({ color: hexA(HPDR.median, HPDR.lineAlpha), lineWidth: 1, lineStyle: LineStyle.Dashed }),
  upper: Object.fromEntries(HPDR.ranges.map((r) => [r.p, overlayLine({ color: hexA(r.color, HPDR.lineAlpha) })])),
  lower: Object.fromEntries(HPDR.ranges.map((r) => [r.p, overlayLine({ color: hexA(r.color, HPDR.lineAlpha) })])),
};

// ── Pane studies (HPDRO, HPDRV, Stoch, RSI, Jewel) ──
let paneHandles = []; // [{study, handle}]
function rebuildPanes() {
  for (const { handle } of paneHandles) handle.destroy();
  paneHandles = [];
  for (let i = chart.panes().length - 1; i > 0; i--) { try { chart.removePane(i); } catch { /* already gone */ } }
  let pane = 1;
  for (const study of PANE_STUDIES) {
    if (!state.on[study.id]) continue;
    paneHandles.push({ study, handle: study.create(chart, pane++, { candleSeries }) });
  }
  layoutPanes();
}
function layoutPanes() {
  const panes = chart.panes(), n = panes.length - 1;
  panes[0].setStretchFactor(n ? Math.max(2.5, n * 1.4) : 1);
  for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1);
  requestAnimationFrame(placePaneLegends);
}
function placePaneLegends() {
  const host = $('paneLegends');
  const base = $('chart').getBoundingClientRect();
  const panes = chart.panes();
  host.innerHTML = paneHandles.map((_, k) => {
    const el = panes[k + 1]?.getHTMLElement();
    if (!el) return '';
    const top = el.getBoundingClientRect().top - base.top + 3;
    return `<div class="pane-legend" style="top:${top}px" data-k="${k}"></div>`;
  }).join('');
  renderLegend(hoverIndex ?? state.candles.length - 1);
}
new ResizeObserver(() => requestAnimationFrame(placePaneLegends)).observe($('chart'));

let computed = null;
let hoverIndex = null;

const times = () => state.candles.map((c) => c.time);
function futureTimes(k) {
  const last = state.candles.at(-1)?.time;
  if (typeof last !== 'number') return null; // business-day strings (stocks daily+) → no projection
  const step = INTERVAL_SECONDS[state.interval];
  return Array.from({ length: k }, (_, i) => last + step * (i + 1));
}

function compute() {
  const c = state.candles;
  const close = c.map((x) => x.close), high = c.map((x) => x.high), low = c.map((x) => x.low);
  const lastClosed = state.lastOpen ? c.length - 2 : c.length - 1;
  const d = {
    times: times(), lastClosed, future: futureTimes,
    maOf: (vals, m) => (m.type === 'EMA' ? emaN(vals, m.length) : smaN(vals, m.length)),
    ma: {},
  };
  for (const m of MOVING_AVERAGES) d.ma[m.id] = movingAverage(m.type, close, m.length);
  d.signals = crossovers(d.ma[CROSS.fast], d.ma[CROSS.slow], lastClosed);

  if (state.on.hpdr || state.on.hpdro || state.on.hpdrv) {
    const src = HPDR.source === 'close' ? close : c.map((x) => (x.high + x.low + x.close) / 3);
    d.hpdr = computeHpdr(src, { length: HPDR.length, maxArray: HPDR.maxArray, ranges: HPDR.ranges.map((r) => r.p), project: state.on.hpdrProject });
  }
  if (state.on.stoch) {
    const s = stochastic({ high, low, close }, STOCH);
    d.stoch = { ...s, fk: forecast(s.k, STOCH.forecastBars), fd: forecast(s.d, STOCH.forecastBars), vol: stochVolatility(close, STOCH.volatility) };
  }
  if (state.on.rsi) {
    const r = rsi(close, RSIDIV.length, RSIDIV.type);
    const closedR = r.slice(0, lastClosed + 1); // divergences on closed candles only
    d.rsi = {
      rsi: r,
      signal: RSIDIV.signalType === 'EMA' ? emaN(r, RSIDIV.signal) : smaN(r, RSIDIV.signal),
      div: divergences(close.slice(0, lastClosed + 1), closedR, RSIDIV),
    };
  }
  if (state.on.jewel) {
    const src = JEWEL.useClose ? close : c.map((x) => (x.high + x.low + x.close) / 3);
    const base = rsi(src, 14, 'wilder');
    const smooth = (v, n) => (n <= 1 ? v : JEWEL.smoothingEma ? emaN(v, n) : smaN(v, n));
    const fast = smooth(base, JEWEL.smoothing);
    const emaS = movingAverage('EMA', close, JEWEL.emaShort), emaL = movingAverage('EMA', close, JEWEL.emaLong);
    d.jewel = {
      fast,
      slow: emaN(fast, 9),
      high: dmi({ high, low, close }, 14).adx.map((v) => (v == null ? null : v * JEWEL.dmiFactor)),
      emaState: emaS.map((v, i) => (v == null || emaL[i] == null ? null : Math.sign(v - emaL[i]) || 1)),
      crosses: crossovers(emaS, emaL, lastClosed),
      fib: autoFib({ high, low }, JEWEL.fibLookback),
    };
  }
  return d;
}

function setOverlay(series, values, on, extra = []) {
  series.applyOptions({ visible: on });
  series.setData(on ? [...toLine(values, computed.times), ...extra] : []);
}

function draw() {
  if (!state.candles.length) return;
  computed = compute();
  for (const m of MOVING_AVERAGES) setOverlay(maSeries[m.id], computed.ma[m.id], !!state.visible[m.id]);

  const h = computed.hpdr, fut = futureTimes(HPDR.length);
  const proj = (arr) => (h?.projection && fut ? arr.map((v, j) => ({ time: fut[j], value: v })) : []);
  setOverlay(hpdrSeries.median, h?.median ?? [], state.on.hpdr, proj(h?.projection?.median ?? []));
  for (const r of HPDR.ranges) {
    setOverlay(hpdrSeries.upper[r.p], h?.upper[r.p] ?? [], state.on.hpdr, proj(h?.projection?.upper[r.p] ?? []));
    setOverlay(hpdrSeries.lower[r.p], h?.lower[r.p] ?? [], state.on.hpdr, proj(h?.projection?.lower[r.p] ?? []));
  }

  crossMarkers.setMarkers(state.on.cross ? computed.signals.map((s) => ({
    time: computed.times[s.index],
    position: s.type === 'bull' ? 'belowBar' : 'aboveBar',
    color: s.type === 'bull' ? '#26d07c' : '#ff433d',
    shape: s.type === 'bull' ? 'arrowUp' : 'arrowDown',
    text: s.type === 'bull' ? 'X▲' : 'X▼',
  })) : []);

  for (const { handle } of paneHandles) handle.update(computed);
  renderSignals();
  renderHpdrPanel();
  renderHeader();
  renderLegend(hoverIndex ?? state.candles.length - 1);
}

// ── Header / legend / panels ──
function renderHeader() {
  const c = state.candles;
  if (!c.length) return;
  const last = c[c.length - 1], prev = c[c.length - 2] || last;
  const chg = ((last.close - prev.close) / prev.close) * 100;
  $('symName').textContent = state.symbol;
  $('symSource').textContent = sourceFor(state.symbol) === 'binance' ? 'BINANCE' : 'TWELVE DATA';
  $('symLast').textContent = fmt(last.close);
  $('symLast').className = 'big ' + (chg >= 0 ? 'up' : 'down');
  $('symChange').textContent = `${fmtPct(chg)} ${state.interval}`;
  $('symChange').className = chg >= 0 ? 'up' : 'down';
}

function renderLegend(i) {
  const c = state.candles[i];
  if (!c || !computed) return;
  const cls = c.close >= c.open ? 'up' : 'down';
  $('ohlc').innerHTML = `<span class="dim">${fmtTime(c.time)}</span>`
    + ['O', 'H', 'L', 'C'].map((k, j) => `<span><b>${k}</b><span class="${cls}">${fmt([c.open, c.high, c.low, c.close][j])}</span></span>`).join('')
    + `<span><b>V</b>${fmtVol(c.volume)}</span>`;
  const rows = MOVING_AVERAGES.filter((m) => state.visible[m.id]).map((m) =>
    `<div class="row"><span style="color:${m.color}">${m.type} ${m.length}</span><span>${fmt(computed.ma[m.id]?.[i])}</span></div>`);
  if (state.on.hpdr && computed.hpdr) {
    rows.push(`<div class="row"><span class="dim">HPDR ${HPDR.length}</span><span style="color:${HPDR.median}">MED ${fmt(computed.hpdr.median[i])}</span></div>`);
  }
  $('legend').innerHTML = rows.join('');
  document.querySelectorAll('.pane-legend').forEach((el) => {
    const h = paneHandles[+el.dataset.k];
    if (h) el.innerHTML = h.handle.legend(i);
  });
}

function renderHpdrPanel() {
  const pos = computed?.hpdr?.osc.at(-1);
  if (pos == null) {
    $('hpdrPos').textContent = computed?.hpdr ? 'NEED MORE DATA' : 'OFF';
    $('hpdrZone').textContent = '—';
    $('hpdrFill').style.left = '0';
    return;
  }
  $('hpdrFill').style.left = `calc(${pos}% - 1px)`;
  $('hpdrPos').textContent = pos.toFixed(1) + ' pctl';
  // which range band is the current move inside?
  const dist = Math.abs(pos - 50) * 2; // 0 = median move, 100 = most extreme ever
  const band = HPDR.ranges.find((r) => dist <= r.p) || HPDR.ranges.at(-1);
  $('hpdrZone').innerHTML = `<span style="color:${band.color}">${pos >= 50 ? '▲' : '▼'} INSIDE ${band.p}%</span>`;
}

function renderSignals() {
  const f = MOVING_AVERAGES.find((m) => m.id === CROSS.fast), s = MOVING_AVERAGES.find((m) => m.id === CROSS.slow);
  $('crossLabel').textContent = `${f.type}${f.length} × ${s.type}${s.length}`;
  const list = computed.signals.slice(-8).reverse();
  $('signals').innerHTML = !state.on.cross ? '<li class="dim">CROSS SIGNALS OFF</li>'
    : list.length ? list.map((x) => `<li><span class="dim">${fmtTime(state.candles[x.index].time).slice(0, 10)}</span>`
      + `<span class="${x.type === 'bull' ? 'up' : 'down'}">${x.type === 'bull' ? '▲ BULL CROSS' : '▼ BEAR CROSS'}</span></li>`).join('')
    : `<li class="dim">NO CROSSES IN ${state.candles.length} BARS</li>`;
}

const TOGGLES = [
  { key: 'cross', label: 'CROSS SIGNALS', color: '#26d07c' },
  { key: 'hpdr', label: 'HPDR BANDS', color: '#6ef5ff' },
  { key: 'hpdrProject', label: '└ PROJECT FWD', color: '#6ef5ff' },
  { key: 'hpdro', label: 'HPDRO', color: '#e84a4a', pane: true },
  { key: 'hpdrv', label: 'HPDRV', color: '#ffffff', pane: true },
  { key: 'stoch', label: 'ADV STOCH', color: '#00d7ff', pane: true },
  { key: 'rsi', label: 'RSI DIVERGENCE', color: '#7dff4f', pane: true },
  { key: 'jewel', label: 'JEWEL~ (+AUTOFIB)', color: '#ffa028', pane: true },
];

function renderStudies() {
  const items = MOVING_AVERAGES.map((m) => `<label><input type="checkbox" data-ma="${m.id}" ${state.visible[m.id] ? 'checked' : ''}/>`
    + `<span class="swatch" style="background:${m.color}"></span>${m.type} ${m.length}</label>`);
  for (const t of TOGGLES) {
    items.push(`<label><input type="checkbox" data-opt="${t.key}" data-pane="${t.pane ? 1 : ''}" ${state.on[t.key] ? 'checked' : ''}/>`
      + `<span class="swatch" style="background:${t.color}"></span>${t.label}</label>`);
  }
  $('studies').innerHTML = items.join('');
}

function toggle(key, value = !state.on[key]) {
  state.on[key] = value;
  store.set('on', state.on);
  if (TOGGLES.find((t) => t.key === key)?.pane) rebuildPanes();
  renderStudies();
  draw();
}

$('studies').addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.ma) { state.visible[t.dataset.ma] = t.checked; store.set('visible', state.visible); draw(); }
  if (t.dataset.opt) toggle(t.dataset.opt, t.checked);
});

chart.subscribeCrosshairMove((p) => {
  if (p.time == null) { hoverIndex = null; return renderLegend(state.candles.length - 1); }
  const i = state.candles.findIndex((c) => c.time === p.time);
  hoverIndex = i >= 0 ? i : null;
  renderLegend(hoverIndex ?? state.candles.length - 1);
});

// ── Status ──
function setStatus(kind, text) {
  $('liveDot').className = 'dot ' + kind;
  $('liveText').textContent = text;
}
function showMsg(text) { $('chartMsg').textContent = text; $('chartMsg').classList.toggle('show', !!text); }

// ── Loading a symbol ──
async function load(symbol, interval) {
  const id = ++state.loadId;
  state.unsubscribe?.();
  state.symbol = symbol; state.interval = interval;
  store.set('symbol', symbol); store.set('interval', interval);
  renderIntervals(); renderWatch();
  setStatus('', 'LOADING');
  showMsg(`LOADING ${symbol} ${interval}…`);
  try {
    const candles = await fetchCandles(symbol, interval, { apiKey: state.apiKey });
    if (id !== state.loadId) return;
    state.candles = candles;
    state.lastOpen = true;
    candleSeries.setData(candles);
    volumeSeries.setData(candles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(38,208,124,.35)' : 'rgba(255,67,61,.35)' })));
    candleSeries.applyOptions({ priceFormat: { type: 'price', precision: decimals(candles.at(-1).close), minMove: 1 / 10 ** decimals(candles.at(-1).close) } });
    draw();
    chart.timeScale().fitContent();
    showMsg('');
    const live = sourceFor(symbol) === 'binance';
    setStatus(live ? 'live' : 'poll', live ? 'LIVE' : 'POLLING 60s');
    state.unsubscribe = subscribe(symbol, interval, onLiveCandle, { apiKey: state.apiKey });
  } catch (err) {
    if (id !== state.loadId) return;
    setStatus('err', 'ERROR');
    const stockHint = sourceFor(symbol) !== 'binance' && !state.apiKey ? '\nStocks need a free Twelve Data API key → press F8.' : '';
    showMsg(`${err.message}${stockHint}`);
  }
}

function onLiveCandle(c, isClosed) {
  const arr = state.candles;
  if (!arr.length) return;
  const last = arr[arr.length - 1];
  if (c.time === last.time) arr[arr.length - 1] = c;
  else if (c.time > last.time) arr.push(c);
  else return;
  state.lastOpen = !(isClosed && c.time === arr[arr.length - 1].time);
  candleSeries.update(c);
  volumeSeries.update({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(38,208,124,.35)' : 'rgba(255,67,61,.35)' });
  draw();
}

// ── Intervals ──
function renderIntervals() {
  $('intervals').innerHTML = INTERVALS.map((iv) => `<button data-iv="${iv}" class="${iv === state.interval ? 'on' : ''}">${iv}</button>`).join('');
}
$('intervals').addEventListener('click', (e) => { const iv = e.target.dataset.iv; if (iv) load(state.symbol, iv); });

// ── Watchlist ──
const tickers = {};
const STOCKS = ['AAPL'];
function renderWatch() {
  $('watch').innerHTML = WATCHLIST.map((s) => {
    const t = tickers[s];
    return `<tr data-sym="${s}" class="${s === state.symbol ? 'on' : ''}"><td>${s.replace('USDT', '')}</td>`
      + `<td>${t ? fmt(t.last) : '…'}</td><td class="${t ? (t.changePct >= 0 ? 'up' : 'down') : ''}">${t ? fmtPct(t.changePct) : ''}</td></tr>`;
  }).join('');
  $('watchStocks').innerHTML = STOCKS.map((s) => `<tr data-sym="${s}" class="${s === state.symbol ? 'on' : ''}"><td>${s}</td><td class="dim">CLICK TO LOAD</td></tr>`).join('');
}
async function refreshTickers() {
  try { for (const t of await fetchCryptoTickers(WATCHLIST)) tickers[t.symbol] = t; renderWatch(); } catch { /* offline */ }
}
for (const id of ['watch', 'watchStocks']) {
  $(id).addEventListener('click', (e) => { const s = e.target.closest('tr')?.dataset.sym; if (s) load(s, state.interval); });
}

// ── Command line ──
function parseInterval(tok) {
  if (INTERVALS.includes(tok)) return tok;               // exact: 1m vs 1M
  const up = tok.toUpperCase();
  if (up === '1MO' || up === 'MONTHLY') return '1M';
  if (up === 'DAILY') return '1D';
  if (up === 'WEEKLY') return '1W';
  if (/^\d+[DHW]$/.test(up) && INTERVALS.includes(up)) return up;
  if (/^\d+M$/.test(tok) && INTERVALS.includes(tok.toLowerCase())) return tok.toLowerCase();
  return null;
}

$('cmdForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = $('cmdInput').value.trim();
  $('cmdInput').value = '';
  if (!raw) return;
  const toks = raw.split(/\s+/);
  const head = toks[0].toUpperCase();
  if (head === 'HELP') return openHelp();
  if (head === 'KEY') { state.apiKey = toks[1] || ''; store.set('apiKey', state.apiKey); return load(state.symbol, state.interval); }
  const STUDY_CMDS = { HPDR: 'hpdr', HPDRO: 'hpdro', HPDRV: 'hpdrv', STOCH: 'stoch', RSI: 'rsi', JEWEL: 'jewel', FIB: 'jewel', CROSS: 'cross' };
  if (STUDY_CMDS[head] && toks.length === 1) return toggle(STUDY_CMDS[head]);
  let symbol = state.symbol, interval = state.interval;
  for (const t of toks) {
    const iv = parseInterval(t);
    if (iv) interval = iv; else symbol = t.toUpperCase().replace(/[^A-Z0-9.:/]/g, '');
  }
  load(symbol, interval);
  $('cmdInput').blur();
});

// ── Modal: help + settings ──
function openModal(title, html) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = html;
  $('modal').hidden = false;
}
function closeModal() { $('modal').hidden = true; }
$('modalClose').onclick = closeModal;
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

function openHelp() {
  openModal('HELP', `
    <table>
      <tr><td><code>BTCUSDT 1D</code></td><td>Load a symbol + timeframe</td></tr>
      <tr><td><code>ETHUSDT</code></td><td>Change symbol, keep timeframe</td></tr>
      <tr><td><code>4H</code></td><td>Change timeframe (<code>1m</code> = minute, <code>1M</code> = month)</td></tr>
      <tr><td><code>AAPL 1W</code></td><td>Stocks via Twelve Data (needs key, F8)</td></tr>
      <tr><td><code>HPDR</code> <code>HPDRO</code> <code>HPDRV</code></td><td>Toggle HPDR bands / oscillator / volatility</td></tr>
      <tr><td><code>STOCH</code> <code>RSI</code> <code>JEWEL</code></td><td>Toggle Advanced Stoch / RSI divergence / Jewel~ + AutoFib</td></tr>
      <tr><td><code>KEY abc123</code></td><td>Set your Twelve Data API key</td></tr>
    </table>
    <div class="dim">Crypto pairs ending in USDT / USDC / BTC… load from Binance (live). Everything else loads from Twelve Data (polled every 60s).<br>
    Cross and divergence signals use closed candles only. HPDR, Stoch, RSI-div and Jewel~ are own implementations built from each indicator's concept and your settings — values can differ from the originals (see README).<br>
    This tool is for analysis, not financial advice.</div>`);
}

function openSettings() {
  openModal('SETTINGS', `
    <div>TWELVE DATA API KEY <span class="dim">(free at twelvedata.com — for stocks)</span></div>
    <input id="keyInput" placeholder="paste your key" value="${state.apiKey.replace(/"/g, '')}" />
    <div class="dim">Saved only in this browser. Leave empty to use the limited "demo" key (AAPL only).</div>
    <button class="btn" id="keySave">SAVE</button>`);
  $('keySave').onclick = () => {
    state.apiKey = $('keyInput').value.trim();
    store.set('apiKey', state.apiKey);
    closeModal();
    if (sourceFor(state.symbol) !== 'binance') load(state.symbol, state.interval);
  };
}

// ── Function keys (keyboard + footer buttons) ──
const actions = {
  F1: openHelp,
  F2: () => $('cmdInput').focus(),
  F3: () => document.querySelector('#studies input')?.focus(),
  F4: () => toggle('hpdr'),
  F8: openSettings,
};
document.addEventListener('keydown', (e) => {
  if (actions[e.key]) { e.preventDefault(); actions[e.key](); }
  else if (e.key === 'Escape') closeModal();
  else if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); $('cmdInput').focus(); }
});
document.querySelector('.fkeys').addEventListener('click', (e) => { const k = e.target.closest('button')?.dataset.key; if (k) actions[k](); });

// ── Clock ──
function tick() {
  const d = new Date();
  $('clockLocal').textContent = d.toLocaleTimeString('en-GB');
  $('clockUtc').textContent = d.toISOString().slice(11, 19) + ' UTC';
}
setInterval(tick, 1000); tick();

// ── Boot ──
renderStudies();
rebuildPanes();
renderIntervals();
renderWatch();
refreshTickers();
setInterval(refreshTickers, 10_000);
load(state.symbol, state.interval);
