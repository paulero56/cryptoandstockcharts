import './style.css';
import { createChart, CrosshairMode, LineStyle, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import { BRAND, DEFAULTS, MOVING_AVERAGES, CROSS, HPDR, HPDRO, HPDRV, STOCH, RSIDIV, JEWEL, BB, BBWP, RSISTD, MACD, WATCHLIST, LABELS, INTERVALS, INTERVAL_SECONDS, INTERVAL_GROUPS, FAVORITE_INTERVALS } from './config.js';
import { fetchCandles, subscribe, sourceFor, fetchCryptoTickers, fetchMarketQuotes } from './data/index.js';
import { createDrawingTools } from './drawings.js';
import { isMarketOpen } from './data/markets.js';
import { movingAverage } from './indicators/ma.js';
import { crossovers } from './indicators/cross.js';
import { computeHpdr } from './indicators/hpdr.js';
import { stochastic, forecast, stochVolatility, rsi, divergences, dmi, autoFib, smaN, emaN, bollinger, bbwp, macd } from './indicators/oscillators.js';
import { BandFill } from './primitives/bandFill.js';
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
    bb: BB.enabled, bbwp: BBWP.enabled, rsistd: RSISTD.enabled, macd: MACD.enabled,
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
// Feedback / bug-report link (built in JS so simple spam bots don't scrape it from the HTML)
if (BRAND.contact) {
  const subject = encodeURIComponent(`${BRAND.name} — feedback / bug`);
  $('contact').href = `mailto:${BRAND.contact}?subject=${subject}`;
  $('contact').innerHTML = `<b>✉</b>FEEDBACK / BUGS: ${BRAND.contact}`;
}

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
const drawTools = createDrawingTools({
  chart, series: candleSeries, toolbar: $('tools'), store, fmt, fmtVol: (v) => fmtVol(v),
  getCandles: () => state.candles, getStep: () => INTERVAL_SECONDS[state.interval],
});

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

// HPDR fills + range scale, drawn under everything on the price pane.
const hpdrFill = new BandFill();
candleSeries.attachPrimitive(hpdrFill);

// Bollinger Bands
const bbSeries = {
  basis: overlayLine({ color: hexA(BB.color, 0.8) }),
  upper: overlayLine({ color: hexA(BB.color, 0.6) }),
  lower: overlayLine({ color: hexA(BB.color, 0.6) }),
};
const bbFill = new BandFill();
bbSeries.upper.attachPrimitive(bbFill);

// Mouse wheel over the PRICE axis zooms prices (like TradingView) instead of time.
// Double-click the price axis to go back to auto-scale.
$('chart').addEventListener('wheel', (e) => {
  const rect = $('chart').getBoundingClientRect();
  if (e.clientX < rect.right - chart.priceScale('right').width()) return; // over the plot → normal time zoom
  const pane = chart.panes().find((p) => {
    const r = p.getHTMLElement()?.getBoundingClientRect();
    return r && e.clientY >= r.top && e.clientY <= r.bottom;
  });
  if (!pane || !e.deltaY) return;
  const series = pane.paneIndex() === 0 ? candleSeries
    : pane.getSeries().find((x) => (x.options().priceScaleId ?? 'right') === 'right');
  const scale = series?.priceScale();
  const range = scale?.getVisibleRange();
  if (!range) return;
  e.preventDefault(); e.stopPropagation();
  const y = e.clientY - pane.getHTMLElement().getBoundingClientRect().top;
  const anchor = series.coordinateToPrice(y) ?? (range.from + range.to) / 2;
  const f = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY / 800))); // ~12% per wheel notch, smooth on trackpads
  scale.setVisibleRange({ from: anchor - (anchor - range.from) * f, to: anchor + (range.to - anchor) * f });
}, { capture: true, passive: false });

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
  if (state.on.bb) d.bb = bollinger(close, BB.length, BB.mult, BB.basisType);
  if (state.on.bbwp) {
    const v = bbwp(close, BBWP);
    d.bbwp = { value: v, ma: d.maOf(v, BBWP.ma) };
  }
  if (state.on.rsistd) {
    const r = rsi(close, RSISTD.length, 'wilder');
    d.rsistd = { rsi: r, ma: d.maOf(r, RSISTD.ma) };
  }
  if (state.on.macd) d.macd = macd(close, MACD.fast, MACD.slow, MACD.signal);
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

  // HPDR fills between consecutive ranges + range scale labels
  if (state.on.hpdr && h && (HPDR.fill || HPDR.scale)) {
    const pt = (arr, projArr) => [...arr, ...(h.projection && fut ? projArr : [])];
    const allTimes = [...computed.times, ...(h.projection && fut ? fut : [])];
    const bands = [];
    if (HPDR.fill) {
      HPDR.ranges.forEach((r, k) => {
        const up = pt(h.upper[r.p], h.projection?.upper[r.p] ?? []), lo = pt(h.lower[r.p], h.projection?.lower[r.p] ?? []);
        const color = hexA(r.color, HPDR.fillAlpha);
        if (k === 0) bands.push({ color, upper: up, lower: lo });
        else {
          const prev = HPDR.ranges[k - 1];
          bands.push({ color, upper: up, lower: pt(h.upper[prev.p], h.projection?.upper[prev.p] ?? []) });
          bands.push({ color, upper: pt(h.lower[prev.p], h.projection?.lower[prev.p] ?? []), lower: lo });
        }
      });
    }
    const i = h.median.length - 1;
    const labels = HPDR.scale ? [...HPDR.ranges].reverse().flatMap((r) => [
      { price: h.upper[r.p][i], text: `${r.p} %`, color: r.color },
      { price: h.lower[r.p][i], text: `${r.p} %`, color: r.color },
    ]).filter((x) => x.price != null) : [];
    hpdrFill.setData(allTimes, bands, labels);
  } else hpdrFill.setData([], []);

  // Bollinger
  for (const k of ['basis', 'upper', 'lower']) setOverlay(bbSeries[k], computed.bb?.[k] ?? [], state.on.bb);
  bbFill.setData(state.on.bb ? computed.times : [], state.on.bb ? [{ color: hexA(BB.color, BB.fillAlpha), upper: computed.bb.upper, lower: computed.bb.lower }] : []);

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
  { key: 'bb', label: `BB ${BB.length} ${BB.mult}`, color: BB.color },
  { key: 'bbwp', label: 'BBWP', color: '#e8392c', pane: true },
  { key: 'rsistd', label: 'RSI', color: '#7e57c2', pane: true },
  { key: 'macd', label: 'MACD', color: '#2962ff', pane: true },
  { key: 'hpdro', label: 'HPDRO', color: '#e84a4a', pane: true },
  { key: 'hpdrv', label: 'HPDRV', color: '#ffffff', pane: true },
  { key: 'stoch', label: 'ADV STOCH', color: '#00d7ff', pane: true },
  { key: 'rsi', label: 'RSI DIV (CUTLER)', color: '#7dff4f', pane: true },
  { key: 'jewel', label: 'JEWEL~ (+AUTOFIB)', color: '#ffa028', pane: true },
];

// Each study links to its section of the guide (guide.html), and the guide links back with ?study=
const GUIDE_ANCHOR = { cross: 'cross', hpdr: 'hpdr', hpdrProject: 'hpdr', bb: 'bb', bbwp: 'bbwp', rsistd: 'rsistd', macd: 'macd', hpdro: 'hpdro', hpdrv: 'hpdrv', stoch: 'stoch', rsi: 'rsidiv', jewel: 'jewel' };
const guideLink = (anchor) => `<a class="st-help" href="./guide.html#${anchor}" target="_blank" rel="noopener" title="How it works (guide)">?</a>`;

function renderStudies() {
  const items = MOVING_AVERAGES.map((m) => `<div class="st-row"><label><input type="checkbox" data-ma="${m.id}" ${state.visible[m.id] ? 'checked' : ''}/>`
    + `<span class="swatch" style="background:${m.color}"></span>${m.type} ${m.length}</label>${guideLink(m.type.toLowerCase())}</div>`);
  for (const t of TOGGLES) {
    items.push(`<div class="st-row"><label><input type="checkbox" data-opt="${t.key}" data-pane="${t.pane ? 1 : ''}" ${state.on[t.key] ? 'checked' : ''}/>`
      + `<span class="swatch" style="background:${t.color}"></span>${t.label}</label>${guideLink(GUIDE_ANCHOR[t.key])}</div>`);
  }
  $('studies').innerHTML = items.join('');
  updateAllButton();
}

function toggle(key, value = !state.on[key]) {
  state.on[key] = value;
  store.set('on', state.on);
  if (TOGGLES.find((t) => t.key === key)?.pane) rebuildPanes();
  renderStudies();
  draw();
}

// ── One click: all studies off / restore the previous selection ──
const anyStudyOn = () => Object.values(state.visible).some(Boolean) || TOGGLES.some((t) => state.on[t.key]);
function updateAllButton() {
  $('studiesAll').textContent = anyStudyOn() ? 'ALL OFF' : (store.get('studiesSnapshot', null) ? 'RESTORE' : 'ALL OFF');
}
function toggleAllStudies() {
  if (anyStudyOn()) {
    store.set('studiesSnapshot', { visible: state.visible, on: state.on });
    state.visible = Object.fromEntries(Object.keys(state.visible).map((k) => [k, false]));
    state.on = Object.fromEntries(Object.keys(state.on).map((k) => [k, false]));
  } else {
    const snap = store.get('studiesSnapshot', null);
    if (!snap) return;
    state.visible = { ...state.visible, ...snap.visible };
    state.on = { ...state.on, ...snap.on };
  }
  store.set('visible', state.visible); store.set('on', state.on);
  rebuildPanes(); renderStudies(); draw();
}
$('studiesAll').addEventListener('click', toggleAllStudies);

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
  // Stocks / forex / gold spot need the user's own free Twelve Data key → ask for it first.
  if (sourceFor(symbol) !== 'binance' && !state.apiKey) {
    state.pendingLoad = { symbol, interval };
    return openSettings(`${symbol} comes from Twelve Data and needs your free API key.`);
  }
  const id = ++state.loadId;
  state.unsubscribe?.();
  state.symbol = symbol; state.interval = interval;
  store.set('symbol', symbol); store.set('interval', interval);
  renderIntervals(); renderWatch();
  drawTools.setSymbol(symbol);
  setStatus('', 'LOADING');
  showMsg(`LOADING ${symbol} ${interval}…`);
  try {
    const candles = await fetchCandles(symbol, interval, { apiKey: state.apiKey });
    if (id !== state.loadId) return;
    state.candles = candles;
    state.lastOpen = true;
    // new symbol → back to automatic price scaling (undo any manual price-axis zoom)
    for (const pane of chart.panes()) for (const s of pane.getSeries()) s.priceScale().setAutoScale(true);
    candleSeries.setData(candles);
    volumeSeries.setData(candles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(38,208,124,.35)' : 'rgba(255,67,61,.35)' })));
    candleSeries.applyOptions({ priceFormat: { type: 'price', precision: decimals(candles.at(-1).close), minMove: 1 / 10 ** decimals(candles.at(-1).close) } });
    draw();
    chart.timeScale().fitContent();
    showMsg('');
    const live = sourceFor(symbol) === 'binance';
    setStatus(live ? 'live' : 'poll', live ? 'LIVE' : (isMarketOpen(symbol) ? 'UPDATES EVERY 60s' : 'MARKET CLOSED'));
    $('refreshNow').hidden = live;
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
// Timeframes: favorites as buttons + a ▾ menu with every timeframe (★ = toggle favorite)
state.favIntervals = store.get('favIntervals', FAVORITE_INTERVALS);
function renderIntervals() {
  const favs = INTERVALS.filter((iv) => state.favIntervals.includes(iv));
  if (!favs.includes(state.interval)) favs.push(state.interval);
  $('intervals').innerHTML = favs.map((iv) => `<button data-iv="${iv}" class="${iv === state.interval ? 'on' : ''}">${iv}</button>`).join('')
    + `<button class="tf-more" data-menu="1" title="All timeframes">▾</button>`;
  $('tfMenu').innerHTML = INTERVAL_GROUPS.map((g) => `<div class="tf-group"><div class="tf-label">${g.label}</div>`
    + g.items.map((iv) => `<div class="tf-item ${iv === state.interval ? 'on' : ''}"><button data-iv="${iv}">${iv}</button>`
      + `<button class="star ${state.favIntervals.includes(iv) ? 'fav' : ''}" data-star="${iv}" title="Show as a button">★</button></div>`).join('')
    + '</div>').join('');
}
function closeTfMenu() { $('tfMenu').hidden = true; }
document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  const inBar = e.target.closest('#intervals'), inMenu = e.target.closest('#tfMenu');
  if (!inBar && !inMenu) return closeTfMenu();
  if (!t) return;
  if (t.dataset.menu) { $('tfMenu').hidden = !$('tfMenu').hidden; return; }
  if (t.dataset.star) {
    const iv = t.dataset.star;
    state.favIntervals = state.favIntervals.includes(iv) ? state.favIntervals.filter((x) => x !== iv) : [...state.favIntervals, iv];
    store.set('favIntervals', state.favIntervals);
    return renderIntervals();
  }
  if (t.dataset.iv) { closeTfMenu(); load(state.symbol, t.dataset.iv); }
});

// ── Watchlist (editable, saved in this browser) ──
state.watch = store.get('watch', WATCHLIST);
const tickers = {};
const label = (s) => LABELS[s] || s.replace(/USDT$/, '');
const isCrypto = (s) => sourceFor(s) === 'binance';
function row(s) {
  const t = tickers[s];
  const price = t ? fmt(t.last) : isCrypto(s) ? '…' : (state.apiKey ? '…' : '<span class="dim">F8 KEY</span>');
  return `<tr data-sym="${s}" class="${s === state.symbol ? 'on' : ''}"><td>${label(s)}</td>`
    + `<td>${price}</td><td class="${t ? (t.changePct >= 0 ? 'up' : 'down') : ''}">${t ? fmtPct(t.changePct) : ''}</td>`
    + `<td class="x" data-del="${s}" title="Remove">×</td></tr>`;
}
function renderWatch() {
  $('watch').innerHTML = state.watch.filter(isCrypto).map(row).join('');
  $('watchStocks').innerHTML = state.watch.filter((s) => !isCrypto(s)).map(row).join('');
}
async function refreshTickers() {
  const list = state.watch.filter(isCrypto);
  if (!list.length) return;
  try { for (const t of await fetchCryptoTickers(list)) tickers[t.symbol] = t; renderWatch(); } catch { /* offline */ }
}
// Twelve Data quotes (1 credit per symbol): every 10 min, only while the tab is
// visible and only for markets that are open. force = fetch all once (startup).
let lastQuotes = 0;
async function refreshQuotes(force = false, only = null) {
  let list = only || state.watch.filter((s) => !isCrypto(s));
  if (!force) {
    if (document.hidden) return;
    list = list.filter((s) => isMarketOpen(s));
  }
  if (!list.length || !state.apiKey) return;
  lastQuotes = Date.now();
  try { for (const t of await fetchMarketQuotes(list, state.apiKey)) tickers[t.symbol] = t; renderWatch(); } catch { /* no key / limit */ }
}
function saveWatch() { store.set('watch', state.watch); renderWatch(); }
async function addSymbol(raw) {
  const s = raw.toUpperCase().replace(/[^A-Z0-9.:/]/g, '');
  if (!s || state.watch.includes(s)) return;
  try {
    await fetchCandles(s, '1D', { apiKey: state.apiKey }); // validate before adding
    state.watch.push(s); saveWatch();
    isCrypto(s) ? refreshTickers() : refreshQuotes(true, [s]);
  } catch (err) {
    showMsg(`CAN'T ADD ${s}: ${err.message}`); setTimeout(() => showMsg(''), 3500);
  }
}
function removeSymbol(s) { state.watch = state.watch.filter((x) => x !== s); delete tickers[s]; saveWatch(); }
for (const id of ['watch', 'watchStocks']) {
  $(id).addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]')?.dataset.del;
    if (del) return removeSymbol(del);
    const s = e.target.closest('tr')?.dataset.sym; if (s) load(s, state.interval);
  });
}
$('addForm').addEventListener('submit', (e) => { e.preventDefault(); addSymbol($('addInput').value); $('addInput').value = ''; $('addInput').blur(); });

// ── Command line ──
function parseInterval(tok) {
  if (INTERVALS.includes(tok)) return tok;               // exact: 1m vs 1M
  const up = tok.toUpperCase();
  if (up === '1MO' || up === 'MONTHLY') return '1M';
  if (up === 'DAILY') return '1D';
  if (up === 'WEEKLY') return '1W';
  if (up === 'YEARLY' || up === '12M') return '1Y';
  if (up === '3M' || up === '3MO' || up === 'QUARTERLY') return '3M';
  if (/^\d+[DHWY]$/.test(up) && INTERVALS.includes(up)) return up;
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
  if ((head === 'CLEAR' || head === 'CLEAN') && toks.length === 1) return toggleAllStudies();
  if (head === 'ADD' && toks[1]) return addSymbol(toks[1]);
  if ((head === 'DEL' || head === 'REMOVE') && toks[1]) return removeSymbol(toks[1].toUpperCase());
  if (head === 'KEY') { state.apiKey = toks[1] || ''; store.set('apiKey', state.apiKey); return load(state.symbol, state.interval); }
  const STUDY_CMDS = { BB: 'bb', BBWP: 'bbwp', MACD: 'macd', RSIDIV: 'rsi', HPDR: 'hpdr', HPDRO: 'hpdro', HPDRV: 'hpdrv', STOCH: 'stoch', RSI: 'rsistd', JEWEL: 'jewel', FIB: 'jewel', CROSS: 'cross' };
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
      <tr><td><code>CLEAR</code></td><td>All studies off with one click — again to restore them (same as the ALL OFF button)</td></tr>
      <tr><td><code>ADD PEPEUSDT</code> <code>DEL COIN</code></td><td>Add / remove a watchlist symbol (or use the box under the watchlist)</td></tr>
      <tr><td><code>5D</code> <code>2W</code> <code>3M</code> <code>1Y</code></td><td>5-day, 2-week, quarterly and yearly candles (built from daily / weekly / monthly data)</td></tr>
      <tr><td><b>N</b></td><td>Text: click on the chart, type, <b>Enter</b> to place. Double-click a text (or select it + Enter) to edit it; empty it to delete.</td></tr>
      <tr><td><b>Ctrl/⌘ + Z</b></td><td>Undo the last drawing change (or the ↶ button). <b>Ctrl/⌘ + Shift + Z</b> = redo. The trash can is undoable too.</td></tr>
      <tr><td><b>P</b></td><td>Hide / show the right panel (or the HIDE PANEL button, top right)</td></tr>
      <tr><td><b>T</b> / <b>H</b> / <b>B</b> / <b>N</b> / <b>M</b></td><td>Trend line / horizontal line / brush (click and drag) / text / measure box. <b>Shift + click</b> = quick measure. Pick a neon color in the toolbar (also recolors the selected drawing). Click a drawing + <b>Delete</b> to remove it.</td></tr>
      <tr><td><code>KEY abc123</code></td><td>Set your Twelve Data API key</td></tr>
    </table>
    <div><a class="amber" href="./guide.html" target="_blank" rel="noopener">▶ STUDIES GUIDE (F9)</a> <span class="dim">— how every indicator works, with a link back to the chart</span></div>
    <div class="dim">Crypto pairs ending in USDT / USDC / BTC… load from Binance (live). Everything else loads from Twelve Data (polled every 60s).<br>
    Cross and divergence signals use closed candles only. HPDR, Stoch, RSI-div and Jewel~ are own implementations built from each indicator's concept and your settings — values can differ from the originals (see README).<br>
    This tool is for analysis, not financial advice.</div>`);
}

function openSettings(reason = '') {
  openModal('SETTINGS', `
    ${reason ? `<div class="amber">${reason}</div>` : ''}
    <div>TWELVE DATA API KEY <span class="dim">— for stocks (COIN, CRCL…), forex (USD/MXN) and gold spot (XAU/USD)</span></div>
    <input id="keyInput" placeholder="paste your key" value="${state.apiKey.replace(/"/g, '')}" />
    <div class="dim">Free at <a href="https://twelvedata.com/account/api-keys" target="_blank" rel="noopener" class="amber">twelvedata.com → Account → API Keys</a>.
    Saved only in this browser (enter it once per browser / device). Crypto, PAXG gold and USDT/MXN work without a key.</div>
    <button class="btn" id="keySave">SAVE</button>`);
  $('keySave').onclick = () => {
    state.apiKey = $('keyInput').value.trim();
    store.set('apiKey', state.apiKey);
    closeModal();
    refreshQuotes(true);
    const next = state.pendingLoad; state.pendingLoad = null;
    if (next && state.apiKey) load(next.symbol, next.interval);
    else if (sourceFor(state.symbol) !== 'binance') load(state.symbol, state.interval);
  };
}

// ── Hide / show the right panel (watchlist, studies, signals) ──
function setSideHidden(hidden) {
  document.querySelector('.main').classList.toggle('side-hidden', hidden);
  $('sideToggle').innerHTML = hidden ? '◀ SHOW PANEL' : 'HIDE PANEL ▶';
  store.set('sideHidden', hidden);
}
setSideHidden(store.get('sideHidden', false));
$('sideToggle').addEventListener('click', () => setSideHidden(!store.get('sideHidden', false)));
document.addEventListener('keydown', (e) => {
  if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey && document.activeElement.tagName !== 'INPUT') setSideHidden(!store.get('sideHidden', false));
});

// ── Function keys (keyboard + footer buttons) ──
const actions = {
  F1: openHelp,
  F2: () => $('cmdInput').focus(),
  F3: () => document.querySelector('#studies input')?.focus(),
  F4: () => toggle('hpdr'),
  F8: openSettings,
  F9: () => window.open('./guide.html', '_blank', 'noopener'),
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

// ── Links from the guide: ./?study=hpdr,ema21 turns those studies on ──
(function applyStudyParam() {
  const params = new URLSearchParams(location.search);
  const list = (params.get('study') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return;
  for (const k of list) {
    if (k in state.visible) state.visible[k] = true;
    else if (TOGGLES.some((t) => t.key === k)) state.on[k] = true;
  }
  store.set('visible', state.visible); store.set('on', state.on);
  history.replaceState(null, '', location.pathname); // clean URL so a reload doesn't re-apply it
})();

// ── Boot ──
renderStudies();
rebuildPanes();
renderIntervals();
renderWatch();
refreshTickers();
setInterval(refreshTickers, 10_000);
refreshQuotes(true);
setInterval(() => refreshQuotes(), 600_000); // every 10 min — Twelve Data free plan: 800 credits/day

// ⟳ UPDATE: refresh a Twelve Data chart right now (1 credit)
$('refreshNow').addEventListener('click', async () => {
  const btn = $('refreshNow');
  btn.classList.add('busy');
  try { await state.unsubscribe?.refresh?.(); } finally { setTimeout(() => btn.classList.remove('busy'), 600); }
});
// Back to the tab → update right away instead of waiting for the next tick
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (sourceFor(state.symbol) !== 'binance' && isMarketOpen(state.symbol)) state.unsubscribe?.refresh?.();
  if (Date.now() - lastQuotes > 600_000) refreshQuotes();
});
load(state.symbol, state.interval);
