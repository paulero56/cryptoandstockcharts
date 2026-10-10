// Studies drawn in their own pane under the price chart.
// Each study: { id, title, create(chart, paneIndex, ctx) → handle }
// handle: { update(data), legend(i) → html, destroy() }
import { LineSeries, HistogramSeries, LineStyle, createSeriesMarkers } from 'lightweight-charts';
import { HPDR, HPDRO, HPDRV, STOCH, RSIDIV, JEWEL, BBWP, RSISTD, MACD } from './config.js';
import { BandFill } from './primitives/bandFill.js';

export const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const fmt = (v, d = 1) => (v == null || isNaN(v) ? '—' : v.toFixed(d));
const fixed = (min, max) => () => ({ priceRange: { minValue: min, maxValue: max } });

function addLine(chart, pane, opts) {
  return chart.addSeries(LineSeries, {
    lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...opts,
  }, pane);
}
function guides(series, levels) {
  return levels.map(([price, color, style = LineStyle.Dotted]) =>
    series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: false }));
}
// values[] → [{time, value, color?}] skipping nulls
export function toLine(values, times, colorFn) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    const p = { time: times[i], value: v };
    if (colorFn) p.color = colorFn(v, i);
    out.push(p);
  }
  return out;
}
// Low → high colour ramp (blue → cyan → green → yellow → red) for 0–100 values.
const RAMP = ['#2950ff', '#6ef5ff', '#5bbf6a', '#ffff55', '#e8392c'];
export function ramp(v, alpha = 1) {
  const x = Math.max(0, Math.min(100, v)) / 100 * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
  const a = parseInt(RAMP[i].slice(1), 16), b = parseInt(RAMP[i + 1].slice(1), 16);
  const ch = (s) => Math.round(((a >> s) & 255) + ((((b >> s) & 255) - ((a >> s) & 255)) * f));
  return `rgba(${ch(16)},${ch(8)},${ch(0)},${alpha})`;
}
// Divergence / pivot segments → one line series with gaps (whitespace items).
function segmentsData(segs, times, values) {
  const out = [];
  let last = -1;
  for (const s of [...segs].sort((a, b) => a.from - b.from)) {
    if (s.from < last) continue;
    if (s.from !== last) {
      if (last >= 0 && last + 1 < s.from) out.push({ time: times[last + 1] });
      out.push({ time: times[s.from], value: values[s.from] });
    }
    out.push({ time: times[s.index], value: values[s.index] });
    last = s.index;
  }
  return out;
}

// ── HPDRO / HPDRV ──
function rankStudy({ id, title, cfg, key, colorFn }) {
  return {
    id, title,
    create(chart, pane) {
      const main = addLine(chart, pane, { lineWidth: cfg.lineWidth, autoscaleInfoProvider: fixed(0, 100), lastValueVisible: true, color: '#d0d0d0' });
      const ma = addLine(chart, pane, { color: cfg.ma.color, lineWidth: cfg.ma.width, autoscaleInfoProvider: fixed(0, 100) });
      const lv = HPDR.ranges.filter((r) => [61.8, 88.3, 97.5].includes(r.p));
      guides(main, [[50, hexA(HPDR.median, 0.5), LineStyle.Solid], ...lv.flatMap((r) => [[50 + r.p / 2, hexA(r.color, 0.45)], [50 - r.p / 2, hexA(r.color, 0.45)]])]);
      const markers = key === 'osc' && cfg.alerts ? createSeriesMarkers(main, []) : null;
      let last = null;
      return {
        series: [main, ma],
        update(d) {
          const vals = d.hpdr[key], maVals = d.maOf(vals, cfg.ma);
          last = { vals, maVals };
          main.setData(toLine(vals, d.times, colorFn));
          ma.setData(cfg.ma.on ? toLine(maVals, d.times) : []);
          if (markers) {
            const m = [];
            for (let i = 1; i <= d.lastClosed; i++) {
              const v = vals[i], p = vals[i - 1];
              if (v == null || p == null) continue;
              if (v >= 97.5 && p < 97.5) m.push({ time: d.times[i], position: 'aboveBar', color: '#e8392c', shape: 'circle', size: 0.6 });
              if (v <= 2.5 && p > 2.5) m.push({ time: d.times[i], position: 'belowBar', color: '#7dff4f', shape: 'circle', size: 0.6 });
            }
            markers.setMarkers(m);
          }
        },
        legend(i) {
          return `<b>${title}</b> ${HPDR.length} <span style="color:#d0d0d0">${fmt(last?.vals[i])}</span>`
            + (cfg.ma.on ? ` <span style="color:${cfg.ma.color}">${cfg.ma.type}${cfg.ma.length} ${fmt(last?.maVals[i])}</span>` : '');
        },
        destroy() { markers?.detach(); chart.removeSeries(main); chart.removeSeries(ma); },
      };
    },
  };
}

export const HPDRO_STUDY = rankStudy({ id: 'hpdro', title: 'HPDRO', cfg: HPDRO, key: 'osc', colorFn: (v) => ramp(v) });
export const HPDRV_STUDY = rankStudy({ id: 'hpdrv', title: 'HPDRV', cfg: HPDRV, key: 'vol', colorFn: (v) => ramp(v) });

// ── Advanced Stoch ──
export const STOCH_STUDY = {
  id: 'stoch', title: 'STOCH',
  create(chart, pane) {
    const c = STOCH.colors;
    const vol = addLine(chart, pane, { lineWidth: 1, autoscaleInfoProvider: fixed(0, 100) });
    const k = addLine(chart, pane, { color: c.k, lineWidth: 2, autoscaleInfoProvider: fixed(0, 100), lastValueVisible: true });
    const d = addLine(chart, pane, { color: c.d, lineWidth: 2, autoscaleInfoProvider: fixed(0, 100) });
    const fk = addLine(chart, pane, { color: hexA(c.k, 0.8), lineStyle: LineStyle.Dashed, lineWidth: 2, autoscaleInfoProvider: fixed(0, 100) });
    const fd = addLine(chart, pane, { color: hexA(c.d, 0.8), lineStyle: LineStyle.Dashed, lineWidth: 2, autoscaleInfoProvider: fixed(0, 100) });
    guides(k, [[80, 'rgba(232,57,44,.5)'], [20, 'rgba(125,255,79,.5)'], [50, 'rgba(255,255,255,.2)']]);
    let s = null;
    return {
      series: [vol, k, d, fk, fd],
      update(data) {
        s = data.stoch;
        k.setData(toLine(s.k, data.times));
        d.setData(toLine(s.d, data.times));
        vol.setData(STOCH.volatility.enabled ? toLine(s.vol, data.times, (v) => ramp(v, 0.55)) : []);
        const fut = data.future(STOCH.forecastBars);
        const proj = (series, vals, fc, on) => {
          const lastI = vals.length - 1;
          series.setData(on && fut && fc.length && vals[lastI] != null
            ? [{ time: data.times[lastI], value: vals[lastI] }, ...fc.map((v, j) => ({ time: fut[j], value: v }))] : []);
        };
        proj(fk, s.k, s.fk, STOCH.forecastK);
        proj(fd, s.d, s.fd, STOCH.forecastD);
      },
      legend(i) {
        return `<b>STOCH</b> ${STOCH.k} ${STOCH.d} ${STOCH.smooth} <span style="color:${c.k}">K ${fmt(s?.k[i])}</span> <span style="color:${c.d}">D ${fmt(s?.d[i])}</span>`
          + (STOCH.volatility.enabled ? ` <span style="color:${s?.vol[i] != null ? ramp(s.vol[i]) : '#777'}">VOL ${fmt(s?.vol[i])}</span>` : '');
      },
      destroy() { for (const x of [vol, k, d, fk, fd]) chart.removeSeries(x); },
    };
  },
};

// ── RSI divergence ──
export const RSI_STUDY = {
  id: 'rsi', title: 'RSI DIV',
  create(chart, pane) {
    const c = RSIDIV.colors;
    const rsiS = addLine(chart, pane, { color: c.rsi, lineWidth: 2, autoscaleInfoProvider: fixed(0, 100), lastValueVisible: true });
    const sig = addLine(chart, pane, { color: c.signal, lineWidth: 1, autoscaleInfoProvider: fixed(0, 100) });
    const div = Object.fromEntries(['regBull', 'regBear', 'hidBull', 'hidBear'].map((t) =>
      [t, addLine(chart, pane, { color: c[t], lineWidth: 2, lineStyle: t.startsWith('hid') ? LineStyle.Dashed : LineStyle.Solid, autoscaleInfoProvider: fixed(0, 100) })]));
    guides(rsiS, [[70, 'rgba(232,57,44,.5)'], [30, 'rgba(125,255,79,.5)'], [50, 'rgba(255,255,255,.2)']]);
    const markers = createSeriesMarkers(rsiS, []);
    let r = null;
    return {
      series: [rsiS, sig, ...Object.values(div)],
      update(data) {
        r = data.rsi;
        rsiS.setData(toLine(r.rsi, data.times));
        sig.setData(toLine(r.signal, data.times));
        for (const t of Object.keys(div)) div[t].setData(segmentsData(r.div.list.filter((x) => x.type === t), data.times, r.rsi));
        const m = [];
        if (RSIDIV.pivots) {
          for (const i of r.div.highs) m.push({ time: data.times[i], position: 'aboveBar', color: c.pivot, shape: 'arrowDown', size: 0.25 });
          for (const i of r.div.lows) m.push({ time: data.times[i], position: 'belowBar', color: c.pivot, shape: 'arrowUp', size: 0.25 });
        }
        for (const x of r.div.list) {
          const bull = x.type.endsWith('Bull');
          m.push({ time: data.times[x.index], position: bull ? 'belowBar' : 'aboveBar', color: c[x.type], shape: 'circle', size: 0.5 });
        }
        markers.setMarkers(m.sort((a, b) => (a.time > b.time ? 1 : a.time < b.time ? -1 : 0)));
      },
      legend(i) {
        const lastDiv = r?.div.list.at(-1);
        return `<b>RSI</b> ${RSIDIV.length} ${RSIDIV.type.toUpperCase()} <span style="color:${c.rsi}">${fmt(r?.rsi[i])}</span>`
          + ` <span style="color:${c.signal}">${RSIDIV.signalType}${RSIDIV.signal} ${fmt(r?.signal[i])}</span>`
          + (lastDiv ? ` <span class="dim">last:</span> <span style="color:${c[lastDiv.type]}">${lastDiv.type.replace('reg', '').replace('hid', 'H ')}</span>` : '');
      },
      destroy() { markers.detach(); for (const x of [rsiS, sig, ...Object.values(div)]) chart.removeSeries(x); },
    };
  },
};

// ── Jewel-style composite ──
export const JEWEL_STUDY = {
  id: 'jewel', title: 'JEWEL~',
  create(chart, pane, ctx) {
    const range = fixed(0, JEWEL.emaLinePos + 8);
    const bg = chart.addSeries(HistogramSeries, { priceScaleId: 'jewel-bg', lastValueVisible: false, priceLineVisible: false, base: 0 }, pane);
    bg.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
    const fast = addLine(chart, pane, { color: '#00d7ff', lineWidth: 2, autoscaleInfoProvider: range, lastValueVisible: true });
    const slow = addLine(chart, pane, { color: '#ffa028', lineWidth: 2, autoscaleInfoProvider: range });
    const high = addLine(chart, pane, { color: 'rgba(255,255,255,.6)', lineWidth: 1, autoscaleInfoProvider: range });
    const cross = addLine(chart, pane, { lineWidth: 4, autoscaleInfoProvider: range });
    guides(fast, [[70, 'rgba(232,57,44,.45)'], [30, 'rgba(125,255,79,.45)'], [50, 'rgba(255,255,255,.2)']]);
    let fibLines = [], j = null;
    const clearFib = () => { for (const l of fibLines) ctx.candleSeries.removePriceLine(l); fibLines = []; };
    return {
      series: [bg, fast, slow, high, cross],
      update(data) {
        j = data.jewel;
        fast.setData(JEWEL.showFast ? toLine(j.fast, data.times) : []);
        slow.setData(JEWEL.showSlow ? toLine(j.slow, data.times) : []);
        high.setData(JEWEL.showHigh ? toLine(j.high, data.times) : []);
        cross.setData(JEWEL.emaCross ? toLine(j.emaState.map((s) => (s == null ? null : JEWEL.emaLinePos)), data.times,
          (_, i) => (j.emaState[i] > 0 ? '#26d07c' : '#ff433d')) : []);
        bg.setData(JEWEL.bgAlerts ? j.crosses.map((x) => ({ time: data.times[x.index], value: 1, color: x.type === 'bull' ? 'rgba(38,208,124,.28)' : 'rgba(255,67,61,.28)' })) : []);
        clearFib();
        if (JEWEL.autoFib) {
          fibLines = j.fib.map((f) => ctx.candleSeries.createPriceLine({
            price: f.price, color: f.level === 0.5 ? 'rgba(255,160,40,.7)' : 'rgba(255,160,40,.35)', lineWidth: 1,
            lineStyle: LineStyle.SparseDotted, axisLabelVisible: false, title: `${(f.level * 100).toFixed(1)}`,
          }));
        }
      },
      legend(i) {
        const st = j?.emaState[i];
        return `<b>JEWEL~</b> <span style="color:#00d7ff">FAST ${fmt(j?.fast[i])}</span> <span style="color:#ffa028">SLOW ${fmt(j?.slow[i])}</span>`
          + ` <span class="dim">HIGH ${fmt(j?.high[i])}</span> <span style="color:${st > 0 ? '#26d07c' : '#ff433d'}">EMA${JEWEL.emaShort}/${JEWEL.emaLong} ${st == null ? '—' : st > 0 ? '▲' : '▼'}</span>`;
      },
      destroy() { clearFib(); for (const x of [bg, fast, slow, high, cross]) chart.removeSeries(x); },
    };
  },
};


// ── BBWP ──
export const BBWP_STUDY = {
  id: 'bbwp', title: 'BBWP',
  create(chart, pane) {
    const bars = chart.addSeries(HistogramSeries, { priceScaleId: 'bbwp-x', lastValueVisible: false, priceLineVisible: false, base: 0 }, pane);
    bars.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
    const line = addLine(chart, pane, { lineWidth: 2, autoscaleInfoProvider: fixed(0, 100), lastValueVisible: true });
    const ma = addLine(chart, pane, { color: BBWP.ma.color, lineWidth: 1, autoscaleInfoProvider: fixed(0, 100) });
    guides(line, [[100, 'rgba(232,57,44,.8)', LineStyle.Solid], [BBWP.extremeHigh, 'rgba(232,57,44,.35)'], [50, 'rgba(255,255,255,.25)'], [BBWP.extremeLow, 'rgba(41,80,255,.5)'], [0, 'rgba(41,80,255,.8)', LineStyle.Solid]]);
    let b = null;
    return {
      series: [bars, line, ma],
      update(d) {
        b = d.bbwp;
        line.setData(toLine(b.value, d.times, (v) => ramp(v)));
        ma.setData(BBWP.ma.on ? toLine(b.ma, d.times) : []);
        const out = [];
        b.value.forEach((v, i) => {
          if (v == null) return;
          if (v >= BBWP.extremeHigh) out.push({ time: d.times[i], value: 1, color: 'rgba(232,57,44,.85)' });
          else if (v <= BBWP.extremeLow) out.push({ time: d.times[i], value: 1, color: 'rgba(41,80,255,.85)' });
        });
        bars.setData(out);
      },
      legend(i) {
        const v = b?.value[i];
        return `<b>BBWP</b> ${BBWP.length} ${BBWP.lookback} <span style="color:${v == null ? '#777' : ramp(v)}">${fmt(v, 2)}%</span>`
          + (BBWP.ma.on ? ` <span style="color:${BBWP.ma.color}">${BBWP.ma.type}${BBWP.ma.length} ${fmt(b?.ma[i], 2)}%</span>` : '');
      },
      destroy() { for (const x of [bars, line, ma]) chart.removeSeries(x); },
    };
  },
};

// ── RSI (standard) ──
export const RSISTD_STUDY = {
  id: 'rsistd', title: 'RSI',
  create(chart, pane) {
    const c = RSISTD.colors;
    const line = addLine(chart, pane, { color: c.rsi, lineWidth: 2, autoscaleInfoProvider: fixed(20, 80), lastValueVisible: true });
    const ma = addLine(chart, pane, { color: c.ma, lineWidth: 1, autoscaleInfoProvider: fixed(20, 80), lastValueVisible: true });
    guides(line, [[70, 'rgba(255,255,255,.3)', LineStyle.Dashed], [50, 'rgba(255,255,255,.15)', LineStyle.Dashed], [30, 'rgba(255,255,255,.3)', LineStyle.Dashed]]);
    const zone = new BandFill();
    line.attachPrimitive(zone);
    let r = null;
    return {
      series: [line, ma],
      update(d) {
        r = d.rsistd;
        line.setData(toLine(r.rsi, d.times));
        ma.setData(toLine(r.ma, d.times));
        zone.setData(d.times, [{ color: c.zone, upper: d.times.map(() => 70), lower: d.times.map(() => 30) }]);
      },
      legend(i) {
        return `<b>RSI</b> ${RSISTD.length} <span style="color:${c.rsi}">${fmt(r?.rsi[i], 2)}</span> <span style="color:${c.ma}">${RSISTD.ma.type}${RSISTD.ma.length} ${fmt(r?.ma[i], 2)}</span>`;
      },
      destroy() { line.detachPrimitive(zone); chart.removeSeries(line); chart.removeSeries(ma); },
    };
  },
};

// ── MACD ──
export const MACD_STUDY = {
  id: 'macd', title: 'MACD',
  create(chart, pane) {
    const c = MACD.colors;
    const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: true, priceFormat: { type: 'price', precision: 4, minMove: 0.0001 } }, pane);
    const line = addLine(chart, pane, { color: c.macd, lineWidth: 1, lastValueVisible: true });
    const sig = addLine(chart, pane, { color: c.signal, lineWidth: 1, lastValueVisible: true });
    let m = null;
    return {
      series: [hist, line, sig],
      update(d) {
        m = d.macd;
        hist.setData(toLine(m.hist, d.times, (v, i) => {
          const prev = m.hist[i - 1] ?? v;
          return v >= 0 ? (v >= prev ? c.upStrong : c.upWeak) : (v <= prev ? c.downStrong : c.downWeak);
        }));
        line.setData(toLine(m.macd, d.times));
        sig.setData(toLine(m.signal, d.times));
      },
      legend(i) {
        const f = (v) => (v == null ? '—' : Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(4));
        const h = m?.hist[i];
        return `<b>MACD</b> ${MACD.fast} ${MACD.slow} ${MACD.signal} <span style="color:${h >= 0 ? c.upStrong : c.downStrong}">${f(h)}</span>`
          + ` <span style="color:${c.macd}">${f(m?.macd[i])}</span> <span style="color:${c.signal}">${f(m?.signal[i])}</span>`;
      },
      destroy() { for (const x of [hist, line, sig]) chart.removeSeries(x); },
    };
  },
};

export const PANE_STUDIES = [BBWP_STUDY, RSISTD_STUDY, MACD_STUDY, HPDRO_STUDY, HPDRV_STUDY, STOCH_STUDY, RSI_STUDY, JEWEL_STUDY];
