// ─────────────────────────────────────────────────────────────
//  Drawing tools: trend line, horizontal line, brush (freehand),
//  measure (price range). Lines use neon colors with a dark outline + glow
//  so they stand out on any background. Saved per symbol in this browser.
//
//  Use: pick a tool, then click on the chart (2 clicks for line/measure,
//  click-and-drag for the brush). Shift + click = quick measure.
//  Pick a color from the palette (it also recolors the selected drawing).
//  Click a drawing to select it, Delete/⌫ removes it. Esc cancels.
// ─────────────────────────────────────────────────────────────

export const NEON = ['#39ff14', '#00f0ff', '#ff2bd6', '#ffff00', '#ff6a00', '#ff1744', '#ffffff'];
const MEASURE = { up: '#26d07c', down: '#ff433d' };
const toSec = (t) => (typeof t === 'number' ? t : Date.parse(t + 'T00:00:00Z') / 1000);

function humanSpan(sec) {
  const a = Math.abs(sec);
  if (a < 3600) return `${Math.round(a / 60)}m`;
  if (a < 86400 * 2) return `${Math.round(a / 3600)}h`;
  if (a < 86400 * 60) return `${Math.round(a / 86400)}d`;
  if (a < 86400 * 730) return `${Math.round(a / (86400 * 30.44))}mo`;
  return `${(a / (86400 * 365.25)).toFixed(1)}y`;
}
const pctStr = (p) => `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;

export function createDrawingTools({ chart, series, getCandles, getStep, fmt, fmtVol, store, toolbar }) {
  let drawings = [], pending = null, hover = null, selected = null, tool = 'cursor', symbolKey = null, shiftDown = false;
  let color = store.get('drawColor', NEON[0]);
  let stroke = null; // brush stroke in progress

  // ── toolbar extras: brush button + neon palette ──
  const brushBtn = document.createElement('button');
  brushBtn.dataset.tool = 'brush';
  brushBtn.title = 'Brush — freehand drawing (B)';
  brushBtn.innerHTML = '<svg viewBox="0 0 16 16"><path d="M2 13c2 0 3-1 3-2.5S6 8 7.5 8 10 9.5 10 11 9 14 6 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9 9l5-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  toolbar.querySelector('[data-tool="hline"]')?.after(brushBtn);
  const palette = document.createElement('div');
  palette.className = 'palette';
  palette.innerHTML = NEON.map((c) => `<button class="swatch-btn" data-color="${c}" title="Color" style="--c:${c}"></button>`).join('');
  toolbar.appendChild(palette);
  function renderPalette() {
    palette.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('on', b.dataset.color === color));
  }
  renderPalette();

  // ── coordinate helpers (fractional bar index → smooth freehand + exact placement) ──
  const ts = () => chart.timeScale();
  function indexOf(time) {
    const c = getCandles();
    if (!c.length) return null;
    const s = toSec(time), last = c.length - 1;
    if (s >= toSec(c[last].time)) return last + (s - toSec(c[last].time)) / getStep();
    if (s <= toSec(c[0].time)) return 0;
    let lo = 0, hi = last;
    while (lo < hi) { const m = (lo + hi) >> 1; if (toSec(c[m].time) < s) lo = m + 1; else hi = m; }
    const a = toSec(c[lo - 1].time), b = toSec(c[lo].time);
    return lo - 1 + (b > a ? (s - a) / (b - a) : 0);
  }
  const xOf = (time) => { const i = indexOf(time); return i == null ? null : ts().logicalToCoordinate(i); };
  const yOf = (price) => series.priceToCoordinate(price);
  function anchorAt(point, exact = false) {
    const c = getCandles();
    const lf = ts().coordinateToLogical(point.x) ?? 0;
    const price = series.coordinateToPrice(point.y);
    if (!c.length || price == null) return null;
    const last = c.length - 1;
    if (exact) { // fractional time (seconds) — used by the brush
      const i = Math.max(0, Math.min(last, Math.floor(lf))), f = lf - i;
      const next = i < last ? toSec(c[i + 1].time) : toSec(c[i].time) + getStep();
      return { time: Math.round(toSec(c[i].time) + (lf > last ? (lf - last) * getStep() : f * (next - toSec(c[i].time)))), price };
    }
    const l = Math.round(lf);
    let time;
    if (l <= last) time = c[Math.max(0, l)].time;
    else {
      const sec = toSec(c[last].time) + (l - last) * getStep();
      time = typeof c[last].time === 'number' ? sec : new Date(sec * 1000).toISOString().slice(0, 10);
    }
    return { time, price };
  }

  // ── stats for a 2-point drawing ──
  function stats(p1, p2) {
    const c = getCandles();
    const i1 = indexOf(p1.time), i2 = indexOf(p2.time);
    const d = p2.price - p1.price, pct = (d / p1.price) * 100;
    const bars = Math.round(i2 - i1);
    let vol = 0;
    for (let i = Math.max(0, Math.ceil(Math.min(i1, i2))); i <= Math.min(c.length - 1, Math.floor(Math.max(i1, i2))); i++) vol += c[i].volume;
    return { d, pct, bars, span: humanSpan(toSec(p2.time) - toSec(p1.time)), vol };
  }

  // ── rendering ──
  function label(ctx, text, x, y, bg, align = 'left', fg = '#fff') {
    ctx.font = '600 11px "IBM Plex Mono", monospace';
    const lines = Array.isArray(text) ? text : [text];
    const w = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 12, h = lines.length * 15 + 6;
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    ctx.fillStyle = bg; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(left, y, w, h, 4); else ctx.rect(left, y, w, h);
    ctx.fill();
    ctx.fillStyle = fg; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    lines.forEach((t, k) => ctx.fillText(t, left + w / 2, y + 4 + k * 15));
    ctx.textAlign = 'left';
    return h;
  }
  // Neon stroke: dark outline (contrast on bright areas) + colored glow (contrast on dark areas)
  function neon(ctx, path, col, width, dash = []) {
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash(dash);
    ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.lineWidth = width + 3; path(); ctx.stroke();
    ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.strokeStyle = col; ctx.lineWidth = width; path(); ctx.stroke();
    ctx.restore();
  }
  function arrow(ctx, x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const a = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x2, y2); ctx.lineTo(x2 - 7 * Math.cos(a - 0.5), y2 - 7 * Math.sin(a - 0.5));
    ctx.moveTo(x2, y2); ctx.lineTo(x2 - 7 * Math.cos(a + 0.5), y2 - 7 * Math.sin(a + 0.5));
    ctx.stroke();
  }
  function handle(ctx, x, y, col) {
    ctx.fillStyle = '#000'; ctx.strokeStyle = col || '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  function drawOne(ctx, dr, size, isSel) {
    const col = dr.color || (dr.type === 'hline' ? NEON[1] : NEON[0]); // older drawings had no color
    const w = isSel ? 3.5 : 2.5;
    if (dr.type === 'hline') {
      const y = yOf(dr.p1.price); if (y == null) return;
      neon(ctx, () => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size.width, y); }, col, w, [8, 5]);
      const last = getCandles().at(-1)?.close;
      const dist = last ? ((dr.p1.price - last) / last) * 100 : 0;
      label(ctx, `${fmt(dr.p1.price)}  ${pctStr(dist)}`, size.width - 6, y - 22, col, 'right', '#000');
      return;
    }
    if (dr.type === 'brush') {
      const pts = dr.pts.map((p) => [xOf(p.time), yOf(p.price)]).filter(([x, y]) => x != null && y != null);
      if (pts.length < 2) return;
      neon(ctx, () => { ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); }, col, w);
      if (isSel) { handle(ctx, ...pts[0], col); handle(ctx, ...pts.at(-1), col); }
      return;
    }
    const x1 = xOf(dr.p1.time), x2 = xOf(dr.p2.time), y1 = yOf(dr.p1.price), y2 = yOf(dr.p2.price);
    if ([x1, x2, y1, y2].some((v) => v == null)) return;
    const st = stats(dr.p1, dr.p2), up = st.d >= 0;
    if (dr.type === 'trend') {
      neon(ctx, () => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }, col, w);
      label(ctx, `${pctStr(st.pct)} · ${Math.abs(st.bars)} bars`, x2 + 8, y2 - 10, up ? 'rgba(38,160,100,.95)' : 'rgba(220,60,55,.95)');
      if (isSel) { handle(ctx, x1, y1, col); handle(ctx, x2, y2, col); }
      return;
    }
    // measure (green = up, red = down)
    const mc = up ? MEASURE.up : MEASURE.down;
    const l = Math.min(x1, x2), r = Math.max(x1, x2), t = Math.min(y1, y2), b = Math.max(y1, y2);
    ctx.fillStyle = up ? 'rgba(38,208,124,.18)' : 'rgba(255,67,61,.18)';
    ctx.fillRect(l, t, r - l, b - t);
    ctx.strokeStyle = mc; ctx.lineWidth = 1.5;
    arrow(ctx, x1, (y1 + y2) / 2, x2, (y1 + y2) / 2);
    arrow(ctx, (x1 + x2) / 2, y1, (x1 + x2) / 2, y2);
    const lines = [`${st.d >= 0 ? '+' : ''}${fmt(st.d)} (${pctStr(st.pct)})`, `${Math.abs(st.bars)} bars, ${st.span}`, `Vol ${fmtVol(st.vol)}`];
    label(ctx, lines, (l + r) / 2, up ? t - 58 : b + 6, up ? 'rgba(38,160,100,.95)' : 'rgba(220,60,55,.95)', 'center');
    if (isSel) { handle(ctx, x1, y1); handle(ctx, x2, y2); }
  }

  const primitive = {
    _request: null,
    attached({ requestUpdate }) { this._request = requestUpdate; },
    detached() { this._request = null; },
    updateAllViews() {},
    paneViews() {
      return [{
        zOrder: () => 'top',
        renderer: () => ({
          draw: (target) => target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
            for (const dr of drawings) drawOne(ctx, dr, mediaSize, dr === selected);
            if (pending && hover) drawOne(ctx, { ...pending, p2: hover }, mediaSize, false);
            if (stroke && stroke.pts.length > 1) drawOne(ctx, stroke, mediaSize, false);
          }),
        }),
      }];
    },
  };
  series.attachPrimitive(primitive);
  const redraw = () => primitive._request?.();

  // ── persistence ──
  const save = () => symbolKey && store.set('draw:' + symbolKey, drawings);
  function setSymbol(sym) {
    symbolKey = sym; drawings = store.get('draw:' + sym, []); selected = null; pending = null; stroke = null; redraw();
  }

  // ── hit testing ──
  const segDist = (p, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1;
    const k = Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / len2));
    return Math.hypot(p.x - (x1 + k * dx), p.y - (y1 + k * dy));
  };
  function hit(point) {
    const near = 7;
    for (const dr of [...drawings].reverse()) {
      if (dr.type === 'hline') { const y = yOf(dr.p1.price); if (y != null && Math.abs(point.y - y) < near) return dr; continue; }
      if (dr.type === 'brush') {
        const pts = dr.pts.map((q) => [xOf(q.time), yOf(q.price)]);
        for (let k = 1; k < pts.length; k++) {
          const [a, b] = [pts[k - 1], pts[k]];
          if (a.concat(b).some((v) => v == null)) continue;
          if (segDist(point, ...a, ...b) < near) return dr;
        }
        continue;
      }
      const x1 = xOf(dr.p1.time), x2 = xOf(dr.p2.time), y1 = yOf(dr.p1.price), y2 = yOf(dr.p2.price);
      if ([x1, x2, y1, y2].some((v) => v == null)) continue;
      if (dr.type === 'measure') {
        if (point.x >= Math.min(x1, x2) && point.x <= Math.max(x1, x2) && point.y >= Math.min(y1, y2) && point.y <= Math.max(y1, y2)) return dr;
        continue;
      }
      if (segDist(point, x1, y1, x2, y2) < near) return dr;
    }
    return null;
  }

  // ── tool state + toolbar ──
  const chartEl = document.getElementById('chart');
  function setTool(t) {
    tool = t; pending = null;
    toolbar.querySelectorAll('button[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    chartEl.style.cursor = t === 'cursor' ? '' : 'crosshair';
    // the brush needs the mouse: stop the chart from panning while it's active
    chart.applyOptions({ handleScroll: t !== 'brush', handleScale: t !== 'brush' });
    redraw();
  }
  toolbar.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tool) setTool(b.dataset.tool);
    if (b.dataset.color) {
      color = b.dataset.color; store.set('drawColor', color); renderPalette();
      if (selected && selected.type !== 'measure') { selected.color = color; save(); }
      redraw();
    }
    if (b.dataset.act === 'clear' && drawings.length) { drawings = []; selected = null; save(); redraw(); }
  });

  // ── brush: press, drag, release ──
  const localPoint = (e) => { const r = chartEl.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const inPricePane = (pt) => {
    const h = chart.panes()[0]?.getHeight() ?? 0;
    return pt.y >= 0 && pt.y <= h && pt.x >= 0 && pt.x <= chartEl.clientWidth - chart.priceScale('right').width();
  };
  chartEl.addEventListener('pointerdown', (e) => {
    if (tool !== 'brush' || e.button !== 0) return;
    const pt = localPoint(e);
    if (!inPricePane(pt)) return;
    const a = anchorAt(pt, true); if (!a) return;
    e.preventDefault(); e.stopPropagation();
    stroke = { type: 'brush', color, pts: [a], last: pt };
    chartEl.setPointerCapture?.(e.pointerId);
  }, true);
  chartEl.addEventListener('pointermove', (e) => {
    if (!stroke) return;
    const pt = localPoint(e);
    if (Math.hypot(pt.x - stroke.last.x, pt.y - stroke.last.y) < 3) return;
    const a = anchorAt(pt, true); if (!a) return;
    stroke.pts.push(a); stroke.last = pt; redraw();
  }, true);
  const endStroke = () => {
    if (!stroke) return;
    if (stroke.pts.length > 1) drawings.push({ type: 'brush', color: stroke.color, pts: stroke.pts });
    stroke = null; save(); redraw();
  };
  chartEl.addEventListener('pointerup', endStroke, true);

  // Finish a 2-click drawing on our own pointer events too: the chart library can
  // swallow a quick 2nd click (it treats it as a double-click), which felt flaky.
  let downAt = null, finishedAt = 0;
  chartEl.addEventListener('pointerdown', (e) => { downAt = localPoint(e); }, true);
  chartEl.addEventListener('pointerup', (e) => {
    const pt = localPoint(e);
    if (!pending || !downAt || Math.hypot(pt.x - downAt.x, pt.y - downAt.y) > 5 || !inPricePane(pt)) return;
    if (Date.now() - pending.startedAt < 150) return; // this is the click that started it
    const a = anchorAt(pt);
    if (a) { drawings.push({ ...pending, p2: a }); delete drawings.at(-1).startedAt; pending = null; finishedAt = Date.now(); save(); setTool('cursor'); }
  }, true);
  chartEl.addEventListener('pointercancel', endStroke, true);

  chart.subscribeClick((p) => {
    if (!p.point || tool === 'brush' || Date.now() - finishedAt < 400) return;
    const a = anchorAt(p.point);
    if (!a) return;
    if (pending) {
      drawings.push({ ...pending, p2: a }); delete drawings.at(-1).startedAt; pending = null; finishedAt = Date.now(); save(); setTool('cursor'); return;
    }
    const shift = p.sourceEvent?.shiftKey || shiftDown;
    const t = tool === 'cursor' && shift ? 'measure' : tool;
    if (t === 'hline') { drawings.push({ type: 'hline', color, p1: a }); save(); setTool('cursor'); return; }
    if (t === 'trend' || t === 'measure') { pending = { type: t, color, p1: a, startedAt: Date.now() }; hover = a; redraw(); return; }
    selected = hit(p.point);
    if (selected?.color) { color = selected.color; renderPalette(); }
    redraw();
  });
  // a fast 2nd click can arrive as a double-click — still finish the drawing
  chart.subscribeDblClick((p) => {
    if (!pending || !p.point) return;
    const a = anchorAt(p.point);
    if (a) { drawings.push({ ...pending, p2: a }); delete drawings.at(-1).startedAt; pending = null; finishedAt = Date.now(); save(); setTool('cursor'); }
  });
  chart.subscribeCrosshairMove((p) => {
    if (!pending || !p.point) return;
    hover = anchorAt(p.point) ?? hover; redraw();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Shift') shiftDown = true; });
  document.addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftDown = false; });
  document.addEventListener('keydown', (e) => {
    if (document.activeElement?.tagName === 'INPUT') return;
    if (e.key === 'Escape') { pending = null; selected = null; stroke = null; setTool('cursor'); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      drawings = drawings.filter((d) => d !== selected); selected = null; save(); redraw();
    }
    const keys = { t: 'trend', h: 'hline', m: 'measure', b: 'brush' };
    if (!e.metaKey && !e.ctrlKey && keys[e.key]) setTool(keys[e.key]);
  });

  return { setSymbol, redraw, setTool, count: () => drawings.length };
}
