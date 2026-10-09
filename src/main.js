import './style.css';
import { createChart, CrosshairMode, LineStyle } from 'lightweight-charts';
import { BRAND, DEFAULTS, MOVING_AVERAGES, CROSS, HPDR, WATCHLIST, INTERVALS } from './config.js';
import { fetchCandles, subscribe, sourceFor, fetchCryptoTickers } from './data/index.js';
import { movingAverage } from './indicators/ma.js';
import { crossovers } from './indicators/cross.js';
import { computeHpdr } from './indicators/hpdr.js';

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
  hpdrOn: store.get('hpdrOn', HPDR.enabled),
  crossOn: store.get('crossOn', CROSS.enabled),
  candles: [],
  lastOpen: true,      // is the last candle still forming?
  unsubscribe: null,
  loadId: 0,
};

// ── Formatting ──
const decimals = (p) => (p >= 1000 ? 2 : p >= 1 ? 2 : p >= 0.01 ? 4 : 8);
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
  layout: { background: { color: '#000000' }, textColor: '#9a9a9a', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 },
  grid: { vertLines: { color: '#111111' }, horzLines: { color: '#111111' } },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: '#ffa028', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#ffa028' },
    horzLine: { color: '#ffa028', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#ffa028' },
  },
  rightPriceScale: { borderColor: '#2e2e2e' },
  timeScale: { borderColor: '#2e2e2e', timeVisible: true, secondsVisible: false, rightOffset: 8 },
});

const candleSeries = chart.addCandlestickSeries({
  upColor: '#26d07c', downColor: '#ff433d', borderUpColor: '#26d07c', borderDownColor: '#ff433d',
  wickUpColor: '#26d07c', wickDownColor: '#ff433d',
});

const volumeSeries = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

const maSeries = Object.fromEntries(MOVING_AVERAGES.map((m) => [m.id, chart.addLineSeries({
  color: m.color, lineWidth: 2, priceLineVisible: false, crosshairMarkerVisible: false, lastValueVisible: true,
})]));

const hpdrSeries = Object.fromEntries(HPDR.levels.map((lvl) => {
  const edge = lvl === 0 || lvl === 100, mid = lvl === 50;
  return [lvl, chart.addLineSeries({
    color: mid ? 'rgba(255,160,40,.55)' : edge ? 'rgba(200,200,200,.45)' : 'rgba(140,140,140,.28)',
    lineWidth: 1,
    lineStyle: edge || mid ? LineStyle.Solid : LineStyle.Dashed,
    priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
  })];
}));

let computed = { ma: {}, hpdr: null, signals: [] };

function toLine(values) {
  const out = [];
  for (let i = 0; i < values.length; i++) if (values[i] != null) out.push({ time: state.candles[i].time, value: values[i] });
  return out;
}

function recompute() {
  const c = state.candles;
  const close = c.map((x) => x.close);
  for (const m of MOVING_AVERAGES) computed.ma[m.id] = movingAverage(m.type, close, m.length);
  computed.hpdr = computeHpdr({ high: c.map((x) => x.high), low: c.map((x) => x.low), close }, HPDR);
  const lastClosed = state.lastOpen ? c.length - 2 : c.length - 1;
  computed.signals = crossovers(computed.ma[CROSS.fast], computed.ma[CROSS.slow], lastClosed);
}

function draw() {
  recompute();
  for (const m of MOVING_AVERAGES) {
    const on = !!state.visible[m.id];
    maSeries[m.id].applyOptions({ visible: on });
    maSeries[m.id].setData(on ? toLine(computed.ma[m.id]) : []);
  }
  for (const lvl of HPDR.levels) {
    hpdrSeries[lvl].applyOptions({ visible: state.hpdrOn });
    hpdrSeries[lvl].setData(state.hpdrOn ? toLine(computed.hpdr.levels[lvl]) : []);
  }
  candleSeries.setMarkers(state.crossOn ? computed.signals.map((s) => ({
    time: state.candles[s.index].time,
    position: s.type === 'bull' ? 'belowBar' : 'aboveBar',
    color: s.type === 'bull' ? '#26d07c' : '#ff433d',
    shape: s.type === 'bull' ? 'arrowUp' : 'arrowDown',
    text: s.type === 'bull' ? 'X▲' : 'X▼',
  })) : []);
  renderSignals();
  renderHpdrPanel();
  renderHeader();
  renderLegend(state.candles.length - 1);
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
  if (!c) return;
  const cls = c.close >= c.open ? 'up' : 'down';
  $('ohlc').innerHTML = `<span class="dim">${fmtTime(c.time)}</span>`
    + ['O', 'H', 'L', 'C'].map((k, j) => `<span><b>${k}</b><span class="${cls}">${fmt([c.open, c.high, c.low, c.close][j])}</span></span>`).join('')
    + `<span><b>V</b>${fmtVol(c.volume)}</span>`;
  const rows = MOVING_AVERAGES.filter((m) => state.visible[m.id]).map((m) =>
    `<div class="row"><span style="color:${m.color}">${m.type} ${m.length}</span><span>${fmt(computed.ma[m.id]?.[i])}</span></div>`);
  if (state.hpdrOn && computed.hpdr) {
    const pos = computed.hpdr.position[i];
    rows.push(`<div class="row"><span class="dim">HPDR~</span><span class="dim">${pos == null ? '—' : pos.toFixed(1) + '% of range'}</span></div>`);
  }
  $('legend').innerHTML = rows.join('');
}

function renderHpdrPanel() {
  const pos = computed.hpdr?.position.at(-1);
  if (!state.hpdrOn || pos == null) {
    $('hpdrPos').textContent = state.hpdrOn ? 'NEED MORE DATA' : 'OFF';
    $('hpdrZone').textContent = '—';
    $('hpdrFill').style.left = '0';
    return;
  }
  $('hpdrFill').style.left = `calc(${pos}% - 1px)`;
  $('hpdrPos').textContent = pos.toFixed(1) + '%';
  const zone = pos >= 88.3 ? ['EXTREME HIGH', 'down'] : pos >= 61.8 ? ['UPPER', 'amber'] : pos > 38.2 ? ['MID', ''] : pos > 11.7 ? ['LOWER', 'amber'] : ['EXTREME LOW', 'up'];
  $('hpdrZone').textContent = zone[0];
  $('hpdrZone').className = zone[1];
}

function renderSignals() {
  const f = MOVING_AVERAGES.find((m) => m.id === CROSS.fast), s = MOVING_AVERAGES.find((m) => m.id === CROSS.slow);
  $('crossLabel').textContent = `${f.type}${f.length} × ${s.type}${s.length}`;
  const list = computed.signals.slice(-8).reverse();
  $('signals').innerHTML = !state.crossOn ? '<li class="dim">CROSS SIGNALS OFF</li>'
    : list.length ? list.map((x) => `<li><span class="dim">${fmtTime(state.candles[x.index].time).slice(0, 10)}</span>`
      + `<span class="${x.type === 'bull' ? 'up' : 'down'}">${x.type === 'bull' ? '▲ BULL CROSS' : '▼ BEAR CROSS'}</span></li>`).join('')
    : `<li class="dim">NO CROSSES IN ${state.candles.length} BARS</li>`;
}

function renderStudies() {
  const items = MOVING_AVERAGES.map((m) => `<label><input type="checkbox" data-ma="${m.id}" ${state.visible[m.id] ? 'checked' : ''}/>`
    + `<span class="swatch" style="background:${m.color}"></span>${m.type} ${m.length}</label>`);
  items.push(`<label><input type="checkbox" data-opt="hpdrOn" ${state.hpdrOn ? 'checked' : ''}/><span class="swatch" style="background:#8c8c8c"></span>HPDR~ BANDS</label>`);
  items.push(`<label><input type="checkbox" data-opt="crossOn" ${state.crossOn ? 'checked' : ''}/><span class="swatch" style="background:#26d07c"></span>CROSS SIGNALS</label>`);
  $('studies').innerHTML = items.join('');
}

$('studies').addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.ma) { state.visible[t.dataset.ma] = t.checked; store.set('visible', state.visible); }
  if (t.dataset.opt) { state[t.dataset.opt] = t.checked; store.set(t.dataset.opt, t.checked); }
  draw();
});

chart.subscribeCrosshairMove((p) => {
  if (!p.time || !p.logical && p.logical !== 0) return renderLegend(state.candles.length - 1);
  const i = state.candles.findIndex((c) => c.time === p.time);
  renderLegend(i >= 0 ? i : state.candles.length - 1);
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
  if (head === 'HPDR') { state.hpdrOn = !state.hpdrOn; store.set('hpdrOn', state.hpdrOn); renderStudies(); return draw(); }
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
      <tr><td><code>HPDR</code></td><td>Toggle HPDR-style bands</td></tr>
      <tr><td><code>KEY abc123</code></td><td>Set your Twelve Data API key</td></tr>
    </table>
    <div class="dim">Crypto pairs ending in USDT / USDC / BTC… load from Binance (live). Everything else loads from Twelve Data (polled every 60s).<br>
    Cross signals use closed candles only. HPDR~ is an approximation of the TradingView script — see README.<br>
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
  F4: () => { state.hpdrOn = !state.hpdrOn; store.set('hpdrOn', state.hpdrOn); renderStudies(); draw(); },
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
renderIntervals();
renderWatch();
refreshTickers();
setInterval(refreshTickers, 10_000);
load(state.symbol, state.interval);
