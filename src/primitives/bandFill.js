// Fills the area between pairs of lines (Lightweight Charts has no built-in
// "fill between"). Attach to any series: series.attachPrimitive(new BandFill()).
//
//   fill.setData(times, bands, labels)
//   bands:  [{ color, upper: (number|null)[], lower: (number|null)[] }]  (same length as times)
//   labels: [{ price, text, color }]  drawn as a small scale right of the last bar
export class BandFill {
  constructor() {
    this._times = []; this._bands = []; this._labels = [];
    this._chart = null; this._series = null; this._request = null;
    const self = this;
    this._view = {
      zOrder: () => 'bottom',
      renderer: () => ({ draw: (target) => self._draw(target) }),
    };
  }
  attached({ chart, series, requestUpdate }) { this._chart = chart; this._series = series; this._request = requestUpdate; }
  detached() { this._chart = this._series = this._request = null; }
  paneViews() { return [this._view]; }
  updateAllViews() {}

  setData(times, bands, labels = []) {
    this._times = times; this._bands = bands; this._labels = labels;
    this._request?.();
  }

  _draw(target) {
    if (!this._chart || !this._series) return;
    const ts = this._chart.timeScale(), s = this._series;
    const xs = this._times.map((t) => ts.timeToCoordinate(t));
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      for (const b of this._bands) {
        ctx.fillStyle = b.color;
        let seg = [];
        const flush = () => {
          if (seg.length > 1) {
            ctx.beginPath();
            seg.forEach((p, k) => (k ? ctx.lineTo(p.x, p.u) : ctx.moveTo(p.x, p.u)));
            for (let k = seg.length - 1; k >= 0; k--) ctx.lineTo(seg[k].x, seg[k].l);
            ctx.closePath(); ctx.fill();
          }
          seg = [];
        };
        for (let i = 0; i < xs.length; i++) {
          const x = xs[i], u = b.upper[i], l = b.lower[i];
          if (x == null || u == null || l == null) { flush(); continue; }
          const yu = s.priceToCoordinate(u), yl = s.priceToCoordinate(l);
          if (yu == null || yl == null) { flush(); continue; }
          seg.push({ x, u: yu, l: yl });
        }
        flush();
      }
      // Range scale at the right edge of the data
      const lastX = [...xs].reverse().find((x) => x != null);
      if (lastX == null || !this._labels.length) return;
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.textBaseline = 'middle';
      const used = [];
      for (const lb of this._labels) {
        const y = s.priceToCoordinate(lb.price);
        if (y == null || y < 0 || y > mediaSize.height) continue;
        if (used.some((u) => Math.abs(u - y) < 12)) continue; // skip labels that would overlap
        used.push(y);
        ctx.strokeStyle = lb.color; ctx.fillStyle = lb.color; ctx.lineWidth = 1;
        // keep the label on screen when the last bar is close to the price scale
        const x0 = Math.min(lastX + 6, mediaSize.width - ctx.measureText(lb.text).width - 24);
        ctx.fillStyle = 'rgba(0,0,0,.6)';
        ctx.fillRect(x0 + 18, y - 6, ctx.measureText(lb.text).width + 6, 12);
        ctx.fillStyle = lb.color;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + 16, y); ctx.stroke();
        ctx.fillText(lb.text, x0 + 21, y);
      }
    });
  }
}
