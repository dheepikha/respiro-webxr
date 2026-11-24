// Respiratory Monitor viewer: physiological graphs and parameters derived from the belt.
import { Node, Material, Geo } from './gl.js';
import { Screen } from './screenbase.js';
import { Settings } from './core.js';
import { clamp } from './math.js';

const W = 1024, Hh = 576;
const f0 = v => Math.round(v);
const rgba = (a, al = 1) => `rgba(${a.slice(0, 3).map(v => Math.round(clamp(v, 0, 1) * 255)).join(',')},${al})`;
const TABS = ['LIVE', 'LOOP', 'TRENDS', 'REPORT'];

function box(g, x, y, w, h, th, title) {
  g.fillStyle = 'rgba(7,14,26,0.62)'; g.beginPath(); g.roundRect(x, y, w, h, 14); g.fill();
  g.strokeStyle = rgba(th.accent, 0.35); g.lineWidth = 2; g.stroke();
  if (title) { g.fillStyle = rgba(th.accent, 0.95); g.font = '700 17px system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(title, x + 12, y + 23); }
}

/** Generic line plot inside a rect. ys = numbers; opts: min,max,color,fill,unit,xs(optional 0..1 positions),band:[lo,hi]. */
function plot(g, r, ys, o) {
  const [x, y, w, h] = r, min = o.min, max = o.max, X = i => x + (o.xs ? o.xs[i] : i / Math.max(1, ys.length - 1)) * w, Y = v => y + h - (clamp(v, min, max) - min) / (max - min) * h;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.strokeStyle = 'rgba(255,255,255,0.09)'; g.lineWidth = 1; g.font = '14px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.6)'; g.textAlign = 'right';
  const ticks = o.ticks || [min, (min + max) / 2, max];
  for (const t of ticks) { g.beginPath(); g.moveTo(x, Y(t)); g.lineTo(x + w, Y(t)); g.stroke(); }
  if (o.zero !== undefined) { g.strokeStyle = 'rgba(255,255,255,0.28)'; g.beginPath(); g.moveTo(x, Y(o.zero)); g.lineTo(x + w, Y(o.zero)); g.stroke(); }
  if (o.band) { g.fillStyle = 'rgba(90,230,150,0.13)'; g.fillRect(x, Y(o.band[1]), w, Y(o.band[0]) - Y(o.band[1])); }
  g.restore();
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = '14px system-ui, sans-serif'; g.textAlign = 'right';
  for (const t of ticks) g.fillText(o.fmt ? o.fmt(t) : String(f0(t)), x - 6, Y(t) + 4);
  if (ys.length < 2) return;
  g.save(); g.beginPath(); g.rect(x, y - 2, w, h + 4); g.clip();
  if (o.fill) { g.beginPath(); g.moveTo(X(0), Y(min)); ys.forEach((v, i) => g.lineTo(X(i), Y(v))); g.lineTo(X(ys.length - 1), Y(min)); g.fillStyle = o.fill; g.fill(); }
  g.beginPath(); ys.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
  g.strokeStyle = o.color; g.lineWidth = o.lw || 2.5; g.lineJoin = 'round'; g.shadowColor = o.color; g.shadowBlur = 6; g.stroke(); g.restore();
}

function card(g, x, y, w, h, label, value, unit, col) {
  g.fillStyle = 'rgba(255,255,255,0.05)'; g.beginPath(); g.roundRect(x, y, w, h, 12); g.fill();
  g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = '600 16px system-ui, sans-serif'; g.fillText(label, x + w / 2, y + 22);
  g.fillStyle = col; g.font = '700 38px system-ui, sans-serif'; g.fillText(value, x + w / 2, y + 66);
  g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '14px system-ui, sans-serif'; g.fillText(unit, x + w / 2, y + 88);
}

export class RespMonitorScreen extends Screen {
  enter() {
    const a = this.app, th = this.th, r = a.r;
    this.stage = false; this.lungWave = false;
    this.root.setPos(0, 0.12, -3.0);
    this.cv = document.createElement('canvas'); this.cv.width = W; this.cv.height = Hh; this.g = this.cv.getContext('2d');
    this.tex = r.texture(this.cv); this.ui.owned.push(this.tex);
    const board = new Node(Geo.quad(3.4, 3.4 * Hh / W), new Material('tex', { blend: 'alpha', order: 3010, depthWrite: false, u: { uMap: this.tex, uColor: [1, 1, 1, 1], uIntensity: 1 } }));
    board.setPos(0, 0.2, 0); this.root.add(board);
    this.page = 0; this.frozen = false; this.acc = 0;
    this.tabBtns = TABS.map((t, i) => this.btn(t, -1.2 + i * 0.8, -0.86, 0.74, 0.22, () => { this.page = i; this.acc = 1; this.sync(); }, { size: 0.06 }));
    this.back(-1.3, -1.14);
    this.btn('Reset', -0.45, -1.14, 0.7, 0.22, () => { a.mon.resetSession(); a.mon.history.length = 0; a.toast('Monitor reset'); }, { size: 0.06 });
    this.frzBtn = this.btn('Freeze', 0.4, -1.14, 0.7, 0.22, () => { this.frozen = !this.frozen; this.frzBtn.setText(this.frozen ? 'Resume' : 'Freeze'); }, { size: 0.06 });
    this.btn('Save CSV', 1.25, -1.14, 0.8, 0.22, () => this.save(), { size: 0.06, accent: true });
    this.sync(); this.acc = 1;
  }
  sync() { this.tabBtns.forEach((b, i) => { b.pn.mat.u.uBorderColor = i === this.page ? this.th.good : this.th.acc; }); }

  tick(dt) {
    if (this.frozen) return;
    this.acc += dt; if (this.acc < 1 / 12) return; this.acc = 0;
    const g = this.g, m = this.app.mon, th = this.th;
    g.clearRect(0, 0, W, Hh);
    if (this.page === 0) this.live(g, m, th); else if (this.page === 1) this.loop(g, m, th); else if (this.page === 2) this.trends(g, m, th); else this.report(g, m, th);
    // header: signal quality + units note
    g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,0.45)'; g.font = '12px system-ui, sans-serif';
    g.fillText(`${m.label}  |  signal ${f0(clamp(m.quality, 0, 1) * 100)}%  |  volumes are ESTIMATES scaled to capacity ${Settings.capacityMl} mL`, W - 14, Hh - 8);
    this.app.r.refresh(this.tex);
  }

  rrColor(r, th) { return !r ? rgba(th.accent) : r < 12 || r > 20 ? 'rgb(255,205,90)' : 'rgb(110,255,160)'; }

  live(g, m, th) {
    const cw = 160, gap = 8, y0 = 8, cap = Settings.capacityMl;
    const rr = m.rr, ok = m.recent.length >= 2;
    const vals = [
      ['RESP RATE', ok ? rr.toFixed(1) : '--', 'breaths / min', this.rrColor(rr, th)],
      ['TIDAL VOLUME', ok ? f0(m.tidalMl) : '--', 'mL per breath', rgba(th.accent)],
      ['MINUTE VENT.', ok ? m.minuteVentL.toFixed(1) : '--', 'L / min', rgba(th.accent2)],
      ['I : E RATIO', ok && m.ieRatio ? '1 : ' + (1 / m.ieRatio).toFixed(1) : '--', 'insp : exp time', 'rgb(235,240,255)'],
      ['PEAK INSP FLOW', f0(m.an.maxIn), 'mL/s (session max)', 'rgb(120,200,255)'],
      ['PEAK EXP FLOW', f0(m.an.maxEx), 'mL/s (session max)', 'rgb(255,170,130)'],
    ];
    box(g, 0, 0, W, 114, th, null);
    vals.forEach((v, i) => card(g, 8 + i * (cw + gap) + (W - 16 - 6 * cw - 5 * gap) / 2, y0, cw, 100, ...v));
    // traces: last 30 s
    const h = m.history.slice(-600), n = h.length;
    box(g, 8, 118, W - 16, 205, th, 'VOLUME (mL)   last 30 s');
    box(g, 8, 331, W - 16, 205, th, 'FLOW (mL/s)   + inhale / - exhale');
    const xs = h.map((_, i) => (600 - n + i) / 599);
    const rx = 62, rw = W - 90;
    plot(g, [rx, 140, rw, 168], h.map(e => e[0] * cap), { min: 0, max: cap, color: rgba(th.accent), fill: rgba(th.accent, 0.14), xs, ticks: [0, cap / 2, cap] });
    plot(g, [rx, 352, rw, 170], h.map(e => e[1] * 2500), { min: -2500, max: 2500, color: rgba(th.accent2), xs, zero: 0, ticks: [-2000, 0, 2000] });
    // breath markers + time axis
    g.fillStyle = 'rgba(255,255,255,0.65)'; g.font = '14px system-ui, sans-serif'; g.textAlign = 'center';
    for (let s = 0; s <= 30; s += 5) g.fillText(s === 30 ? 'now' : '-' + (30 - s) + 's', rx + (s / 30) * rw, 534);
    g.strokeStyle = 'rgba(255,255,255,0.16)'; g.setLineDash([4, 5]);
    for (const b of m.an.list) {
      const age = m.sessionTime - b.t; if (age > 30) continue;
      const x = rx + (1 - age / 30) * rw; g.beginPath(); g.moveTo(x, 140); g.lineTo(x, 308); g.stroke();
    }
    g.setLineDash([]);
    g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,0.82)'; g.font = '600 15px system-ui, sans-serif';
    const gap2 = m.sinceBreath;
    g.fillText(`Pattern: ${m.pattern}    Regularity ${m.regularity || '--'}%    Breaths ${m.an.list.length}    ${gap2 > 10 ? 'NO BREATH ' + gap2.toFixed(0) + ' s' : 'last turn ' + gap2.toFixed(1) + ' s ago'}`, 16, 556);
  }

  loop(g, m, th) {
    const cap = Settings.capacityMl;
    box(g, 8, 8, 470, 552, th, 'FLOW - VOLUME LOOP   (last ~10 s)');
    const h = m.history.slice(-200), px = 74, py = 40, pw = 380, ph = 490;
    g.strokeStyle = 'rgba(255,255,255,0.09)'; g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(px + i * pw / 4, py); g.lineTo(px + i * pw / 4, py + ph); g.stroke(); g.beginPath(); g.moveTo(px, py + i * ph / 4); g.lineTo(px + pw, py + i * ph / 4); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,0.3)'; g.beginPath(); g.moveTo(px, py + ph / 2); g.lineTo(px + pw, py + ph / 2); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = '12px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('volume 0 → ' + cap + ' mL', px + pw / 2, py + ph + 16);
    g.textAlign = 'right'; g.fillText('+2500', px - 6, py + 4); g.fillText('0', px - 6, py + ph / 2 + 4); g.fillText('-2500', px - 6, py + ph + 4);
    for (let i = 1; i < h.length; i++) {
      const t = i / h.length, X = v => px + v[0] * pw, Y = v => py + ph / 2 - v[1] * (ph / 2);
      g.strokeStyle = rgba(th.accent, 0.12 + 0.88 * t); g.lineWidth = 2 + 2 * t; g.beginPath(); g.moveTo(X(h[i - 1]), Y(h[i - 1])); g.lineTo(X(h[i]), Y(h[i])); g.stroke();
    }
    if (h.length) { const e = h[h.length - 1]; g.fillStyle = '#fff'; g.beginPath(); g.arc(px + e[0] * pw, py + ph / 2 - e[1] * ph / 2, 6, 0, 7); g.fill(); }
    // tidal volume bars
    box(g, 488, 8, 528, 270, th, 'TIDAL VOLUME PER BREATH (mL)');
    const list = m.an.list.slice(-14), bw = 520 / 14;
    const vmax = Math.max(cap * 0.5, ...list.map(b => b.vt)) * 1.1;
    list.forEach((b, i) => {
      const hgt = (b.vt / vmax) * 200, x = 506 + i * (bw + 0.5) * 0.97;
      g.fillStyle = rgba(th.accent, 0.8); g.beginPath(); g.roundRect(x, 252 - hgt, bw * 0.7, hgt, 4); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = '11px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(f0(b.vt), x + bw * 0.35, 246 - hgt);
    });
    if (!list.length) { g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = '15px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('waiting for breaths...', 750, 150); }
    // Poincare of breath periods
    box(g, 488, 288, 528, 272, th, 'BREATH TIMING   period n  vs  n+1  (s)');
    const per = m.an.list.slice(-40).map(b => b.period);
    const qx = 540, qy = 316, qs = 220, pmax = Math.max(8, ...per) * 1.05;
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.strokeRect(qx, qy, qs, qs);
    g.beginPath(); g.moveTo(qx, qy + qs); g.lineTo(qx + qs, qy); g.stroke();
    for (let i = 0; i + 1 < per.length; i++) { g.fillStyle = rgba(th.accent2, 0.85); g.beginPath(); g.arc(qx + per[i] / pmax * qs, qy + qs - per[i + 1] / pmax * qs, 4, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = '14px system-ui, sans-serif'; g.textAlign = 'left';
    const lines = ['A tight cluster on the diagonal', 'means even, regular breathing.', '', `Mean period  ${per.length ? (per.reduce((s, v) => s + v, 0) / per.length).toFixed(1) : '--'} s`, `Spread (SD)  ${m.periodSd ? m.periodSd.toFixed(2) : '--'} s`, `Regularity   ${m.regularity || '--'} %`];
    lines.forEach((t, i) => g.fillText(t, 790, 340 + i * 22));
  }

  trends(g, m, th) {
    const L = m.an.list.slice(-40), n = L.length, cap = Settings.capacityMl;
    const cols = [
      ['RESP RATE  (breaths/min)', L.map(b => 60 / b.period), { min: 0, max: 30, ticks: [0, 10, 20, 30], band: [12, 20], color: 'rgb(110,255,160)' }],
      ['TIDAL VOLUME  (mL)', L.map(b => b.vt), { min: 0, max: Math.max(cap * 0.5, ...L.map(b => b.vt)) * 1.1, color: rgba(th.accent), fmt: v => f0(v) }],
      ['I : E   (insp ÷ exp time)', L.map(b => b.Ti / Math.max(0.1, b.Te)), { min: 0, max: 2, ticks: [0, 0.5, 1, 1.5, 2], color: rgba(th.accent2), fmt: v => v.toFixed(1) }],
    ];
    cols.forEach(([title, ys, o], i) => {
      const x = 8 + i * 340;
      box(g, x, 8, 330, 470, th, title);
      plot(g, [x + 50, 40, 260, 400], ys, { ...o, fill: undefined, lw: 3 });
      if (n < 2) { g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = '15px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('collecting breaths...', x + 165, 240); }
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = '12px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('last ' + n + ' breaths  →', x + 180, 462);
    });
    box(g, 8, 486, W - 16, 78, th, null);
    g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = '15px system-ui, sans-serif';
    g.fillText('Green band = 12-20 breaths/min, the usual resting adult range. Slow, steady breathing (about 6/min) shows as a low, flat line.', 20, 514);
    g.fillText('Rate and timing are reliable from a belt; volumes are relative estimates unless you calibrate against a known volume.', 20, 540);
  }

  report(g, m, th) {
    const L = m.an.list, mean = (f) => (L.length ? L.reduce((s, b) => s + f(b), 0) / L.length : 0);
    const sd = (f) => { if (L.length < 2) return 0; const mu = mean(f); return Math.sqrt(L.reduce((s, b) => s + (f(b) - mu) ** 2, 0) / L.length); };
    const rrAll = L.length ? 60 / mean(b => b.period) : 0, vt = mean(b => b.vt);
    box(g, 8, 8, W - 16, 552, th, 'SESSION REPORT');
    const rows = [
      ['Duration', `${f0(m.sessionTime / 60)} min ${f0(m.sessionTime % 60)} s`],
      ['Breaths detected', String(L.length)],
      ['Breathing rate', L.length ? `${rrAll.toFixed(1)} /min   (breath period ${mean(b => b.period).toFixed(1)} ± ${sd(b => b.period).toFixed(1)} s)` : '--'],
      ['Tidal volume (est.)', L.length ? `${f0(vt)} ± ${f0(sd(b => b.vt))} mL   (largest ${f0(Math.max(...L.map(b => b.vt)))} mL)` : '--'],
      ['Minute ventilation (est.)', L.length ? `${(rrAll * vt / 1000).toFixed(1)} L/min` : '--'],
      ['Inspiration : expiration', L.length ? `${mean(b => b.Ti).toFixed(1)} s : ${mean(b => b.Te).toFixed(1)} s   (I:E 1 : ${(mean(b => b.Te) / Math.max(0.1, mean(b => b.Ti))).toFixed(1)})` : '--'],
      ['Peak flow in / out', `${f0(m.an.maxIn)} / ${f0(m.an.maxEx)} mL/s`],
      ['Breath-to-breath regularity', m.regularity ? m.regularity + ' %' : '--'],
      ['Pauses over 10 s', `${m.an.pauses}   (longest ${m.an.longestPause.toFixed(0)} s)`],
      ['Best breath hold', m.bestHold.toFixed(1) + ' s'],
      ['Last forced exhale', m.lastFvcMl > 1 ? `FVC ${f0(m.lastFvcMl)} mL   FEV1 ${f0(m.lastFev1Ml)} mL   ratio ${f0(m.lastFev1Ratio * 100)} %` : 'none yet'],
    ];
    g.textAlign = 'left';
    rows.forEach(([k, v], i) => {
      const y = 62 + i * 41;
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)'; g.fillRect(24, y - 24, W - 48, 38);
      g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '600 17px system-ui, sans-serif'; g.fillText(k, 40, y);
      g.fillStyle = 'rgba(255,255,255,0.95)'; g.font = '700 19px system-ui, sans-serif'; g.fillText(v, 330, y);
    });
    g.fillStyle = 'rgba(255,205,120,0.9)'; g.font = '13px system-ui, sans-serif';
    g.fillText('For practice and research only, not a medical device. Volumes come from belt stretch scaled to the capacity setting.', 40, 538);
  }

  save() {
    const a = this.app, L = a.mon.an.list;
    const rows = ['breath,time_s,period_s,rate_per_min,insp_s,exp_s,ie_ratio,tidal_ml_est,peak_insp_flow_ml_s,peak_exp_flow_ml_s'];
    L.forEach((b, i) => rows.push([i + 1, b.t.toFixed(2), b.period.toFixed(2), (60 / b.period).toFixed(1), b.Ti.toFixed(2), b.Te.toFixed(2), (b.Ti / Math.max(0.1, b.Te)).toFixed(2), f0(b.vt), f0(b.fi), f0(b.fe)].join(',')));
    try {
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' }), el = document.createElement('a');
      el.href = URL.createObjectURL(blob); el.download = 'respiro_breaths_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.csv';
      document.body.appendChild(el); el.click(); el.remove(); a.toast('Saved ' + L.length + ' breaths');
    } catch (e) { a.toast('Save failed'); }
  }
}
