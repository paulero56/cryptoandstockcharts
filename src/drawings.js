// ─────────────────────────────────────────────────────────────
//  Drawing tools: trend line, horizontal line, measure (price range).
//  Every drawing shows its % move. Saved per symbol in this browser.
//
//  Use: click a tool, then click on the chart (2 clicks for line/measure).
//  Shift + click = quick measure.  Click a drawing to select it, Delete/⌫
//  removes it.  Esc cancels.
// ─────────────────────────────────────────────────────────────

const COLORS = { line: '#ffa028', hline: '#00d7ff', up: '#26d07c', down: '#ff433d' };
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

  // ── coordinate helpers ──
  const ts = () => chart.timeScale();
  function indexOf(time) {
    const c = getCandles();
    if (!c.length) return null;
    const s = toSec(time), last = c.length - 1;
    if (s > toSec(c[last].time)) return last + (s - toSec(c[last].time)) / getStep();
    let lo = 0, hi = last;
    while (lo < hi) { const m = (lo + hi) >> 1; if (toSec(c[m].time) < s) lo = m + 1; else hi = m; }
    return lo;
  }
  const xOf = (time) => { const i = indexOf(time); return i == null ? null : ts().logicalToCoordinate(i); };
  const yOf = (price) => series.priceToCoordinate(price);
  function anchorAt(point) {
    const c = getCandles();
    const l = Math.round(ts().coordinateToLogical(point.x) ?? 0);
    const price = series.coordinateToPrice(point.y);
    if (!c.length || price == null) return null;
    const last = c.length - 1;
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
  function label(ctx, text, x, y, bg, align = 'left') {
    ctx.font = '11px "IBM Plex Mono", monospace';
    const lines = Array.isArray(text) ? text : [text];
    const w = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 12, h = lines.length * 15 + 6;
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    ctx.fillStyle = bg; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(left, y, w, h, 4); else ctx.rect(left, y, w, h);
    ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    lines.forEach((t, k) => ctx.fillText(t, left + w / 2, y + 4 + k * 15));
    ctx.textAlign = 'left';
    return h;
  }
  function arrow(ctx, x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const a = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x2, y2); ctx.lineTo(x2 - 7 * Math.cos(a - 0.5), y2 - 7 * Math.sin(a - 0.5));
    ctx.moveTo(x2, y2); ctx.lineTo(x2 - 7 * Math.cos(a + 0.5), y2 - 7 * Math.sin(a + 0.5));
    ctx.stroke();
  }
  function handle(ctx, x, y) {
    ctx.fillStyle = '#000'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  function drawOne(ctx, dr, size, isSel) {
    if (dr.type === 'hline') {
      const y = yOf(dr.p1.price); if (y == null) return;
      ctx.strokeStyle = COLORS.hline; ctx.lineWidth = isSel ? 2 : 1; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size.width, y); ctx.stroke(); ctx.setLineDash([]);
      const last = getCandles().at(-1)?.close;
      const dist = last ? ((dr.p1.price - last) / last) * 100 : 0;
      label(ctx, `${fmt(dr.p1.price)}  ${pctStr(dist)}`, size.width - 6, y - 21, 'rgba(0,160,200,.85)', 'right');
      return;
    }
    const x1 = xOf(dr.p1.time), x2 = xOf(dr.p2.time), y1 = yOf(dr.p1.price), y2 = yOf(dr.p2.price);
    if ([x1, x2, y1, y2].some((v) => v == null)) return;
    const st = stats(dr.p1, dr.p2), up = st.d >= 0;
    if (dr.type === 'trend') {
      ctx.strokeStyle = COLORS.line; ctx.lineWidth = isSel ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      label(ctx, `${pctStr(st.pct)} · ${Math.abs(st.bars)} bars`, x2 + 8, y2 - 10, up ? 'rgba(38,160,100,.9)' : 'rgba(220,60,55,.9)');
      if (isSel) { handle(ctx, x1, y1); handle(ctx, x2, y2); }
      return;
    }
    // measure
    const col = up ? COLORS.up : COLORS.down;
    const l = Math.min(x1, x2), r = Math.max(x1, x2), t = Math.min(y1, y2), b = Math.max(y1, y2);
    ctx.fillStyle = up ? 'rgba(38,208,124,.16)' : 'rgba(255,67,61,.16)';
    ctx.fillRect(l, t, r - l, b - t);
    ctx.strokeStyle = col; ctx.lineWidth = 1.2;
    arrow(ctx, x1, (y1 + y2) / 2, x2, (y1 + y2) / 2);
    arrow(ctx, (x1 + x2) / 2, y1, (x1 + x2) / 2, y2);
    const lines = [`${st.d >= 0 ? '+' : ''}${fmt(st.d)} (${pctStr(st.pct)})`, `${Math.abs(st.bars)} bars, ${st.span}`, `Vol ${fmtVol(st.vol)}`];
    const boxY = up ? t - 58 : b + 6;
    label(ctx, lines, (l + r) / 2, boxY, up ? 'rgba(38,160,100,.92)' : 'rgba(220,60,55,.92)', 'center');
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
    symbolKey = sym; drawings = store.get('draw:' + sym, []); selected = null; pending = null; redraw();
  }

  // ── hit testing ──
  function hit(point) {
    const near = 7;
    for (const dr of [...drawings].reverse()) {
      if (dr.type === 'hline') { const y = yOf(dr.p1.price); if (y != null && Math.abs(point.y - y) < near) return dr; continue; }
      const x1 = xOf(dr.p1.time), x2 = xOf(dr.p2.time), y1 = yOf(dr.p1.price), y2 = yOf(dr.p2.price);
      if ([x1, x2, y1, y2].some((v) => v == null)) continue;
      if (dr.type === 'measure') {
        if (point.x >= Math.min(x1, x2) && point.x <= Math.max(x1, x2) && point.y >= Math.min(y1, y2) && point.y <= Math.max(y1, y2)) return dr;
        continue;
      }
      const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1;
      const k = Math.max(0, Math.min(1, ((point.x - x1) * dx + (point.y - y1) * dy) / len2));
      if (Math.hypot(point.x - (x1 + k * dx), point.y - (y1 + k * dy)) < near) return dr;
    }
    return null;
  }

  // ── tool state + toolbar ──
  function setTool(t) {
    tool = t; pending = null;
    toolbar.querySelectorAll('button[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    document.getElementById('chart').style.cursor = t === 'cursor' ? '' : 'crosshair';
    redraw();
  }
  toolbar.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tool) setTool(b.dataset.tool);
    if (b.dataset.act === 'clear' && drawings.length) { drawings = []; selected = null; save(); redraw(); }
  });

  chart.subscribeClick((p) => {
    if (!p.point) return;
    const a = anchorAt(p.point);
    if (!a) return;
    if (pending) {
      drawings.push({ ...pending, p2: a }); pending = null; save(); setTool('cursor'); return;
    }
    const shift = p.sourceEvent?.shiftKey || shiftDown;
    const t = tool === 'cursor' && shift ? 'measure' : tool;
    if (t === 'hline') { drawings.push({ type: 'hline', p1: a }); save(); setTool('cursor'); return; }
    if (t === 'trend' || t === 'measure') { pending = { type: t, p1: a }; hover = a; redraw(); return; }
    selected = hit(p.point); redraw();
  });
  // a fast 2nd click can arrive as a double-click — still finish the drawing
  chart.subscribeDblClick((p) => {
    if (!pending || !p.point) return;
    const a = anchorAt(p.point);
    if (a) { drawings.push({ ...pending, p2: a }); pending = null; save(); setTool('cursor'); }
  });
  chart.subscribeCrosshairMove((p) => {
    if (!pending || !p.point) return;
    hover = anchorAt(p.point) ?? hover; redraw();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Shift') shiftDown = true; });
  document.addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftDown = false; });
  document.addEventListener('keydown', (e) => {
    if (document.activeElement?.tagName === 'INPUT') return;
    if (e.key === 'Escape') { pending = null; selected = null; setTool('cursor'); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      drawings = drawings.filter((d) => d !== selected); selected = null; save(); redraw();
    }
    const keys = { t: 'trend', h: 'hline', m: 'measure' };
    if (!e.metaKey && !e.ctrlKey && keys[e.key]) setTool(keys[e.key]);
  });

  return { setSymbol, redraw, setTool, count: () => drawings.length };
}
