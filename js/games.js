// Guided trainers and games: Ring Pacer, Wave Rider, Guided Spirometry (chase the ghost ball) and Breath Flappy.
import { Screen } from './screenbase.js';
import { Settings } from './core.js';
import * as Audio from './audio.js';
import { clamp, lerp, smoothstep } from './math.js';

const f0 = Math.round;
const rgba = (a, al = 1) => `rgba(${a.slice(0, 3).map(v => Math.round(clamp(v, 0, 1) * 255)).join(',')},${al})`;
const TAU = Math.PI * 2;

// ======================================================================= ring pacer (circle with a travelling dot)
export const RING_PRESETS = [
  { name: '4 - 4 - 8', ph: [['Breathe in', 'Inhale', 4, 1], ['Hold', 'Hold In', 4, 1], ['Breathe out', 'Exhale', 8, 0]] },
  { name: '4 - 7 - 8', ph: [['Breathe in', 'Inhale', 4, 1], ['Hold', 'Hold In', 7, 1], ['Breathe out', 'Exhale', 8, 0]] },
  { name: 'Box 4-4-4-4', ph: [['Breathe in', 'Inhale', 4, 1], ['Hold', 'Hold In', 4, 1], ['Breathe out', 'Exhale', 4, 0], ['Hold', 'Hold Out', 4, 0]] },
  { name: 'Calm 5 - 5', ph: [['Breathe in', 'Inhale', 5, 1], ['Breathe out', 'Exhale', 5, 0]] },
  { name: 'Slow 4 - 6', ph: [['Breathe in', 'Inhale', 4, 1], ['Breathe out', 'Exhale', 6, 0]] },
];

export class RingPacerScreen extends Screen {
  constructor(app, preset = 0) { super(app); this.preset = preset; this.lungWave = false; }
  enter() {
    const a = this.app, th = this.th;
    this.root.setPos(0, 0.2, -2.6);
    this.bd = this.board(1.6, 1.9, 640, 760, 0, 0.2, 0);
    this.back(-1.25, -1.0); this.nameBtn = this.btn('', -0.3, -1.0, 0.9, 0.24, () => this.cycle(1), { size: 0.06 });
    this.runBtn = this.btn('Start', 0.7, -1.0, 0.7, 0.24, () => { this.running = !this.running; this.runBtn.setText(this.running ? 'Pause' : 'Resume'); if (this.t < 0) this.t = -3; }, { accent: true, size: 0.065 });
    this.btn('Restart', 1.4, -1.0, 0.7, 0.24, () => this.reset(), { size: 0.06 });
    this.running = false; this.reset(); this.acc = 1;
  }
  exit() { this.app.mon.setGuide(null); }
  cycle(d) { this.preset = (this.preset + d + RING_PRESETS.length) % RING_PRESETS.length; this.reset(); }
  reset() {
    this.p = RING_PRESETS[this.preset]; this.total = this.p.ph.reduce((s, q) => s + q[2], 0);
    this.t = 0; this.cycles = 0; this.syncSum = 0; this.syncN = 0; this.lastIdx = -1; this.guide = 0; this.started = false;
    this.nameBtn.setText(this.p.name); this.runBtn.setText(this.running ? 'Pause' : 'Start');
    this.app.mon.resetSession(); this.app.mon.setGuide(null);
  }
  tick(dt) {
    if (this.running) {
      this.started = true; this.t += dt;
      if (this.t >= 0) {
        const cyc = this.t % this.total; let acc = 0, idx = 0;
        for (; idx < this.p.ph.length; idx++) { if (cyc < acc + this.p.ph[idx][2]) break; acc += this.p.ph[idx][2]; }
        idx = Math.min(idx, this.p.ph.length - 1);
        const [, , dur, end] = this.p.ph[idx], prev = idx === 0 ? this.p.ph[this.p.ph.length - 1][3] : this.p.ph[idx - 1][3];
        this.guide = lerp(prev, end, smoothstep(0, 1, (cyc - acc) / dur)); this.idx = idx; this.phT = cyc - acc;
        const key = Math.floor(this.t / this.total) * 10 + idx;
        if (key !== this.lastIdx) { this.lastIdx = key; Audio.cue(this.p.ph[idx][1].includes('in') || this.p.ph[idx][1] === 'Inhale' ? 'INHALE' : this.p.ph[idx][1] === 'Exhale' ? 'EXHALE' : 'HOLD', dur); }
        this.cycles = Math.floor(this.t / this.total);
        this.syncSum += 1 - Math.min(1, Math.abs(this.app.mon.fill - this.guide) / 0.35); this.syncN++;
        this.app.mon.setGuide(this.guide);
      }
    }
    this.acc += dt; if (this.acc < 1 / 30) return; this.acc = 0;
    this.draw();
  }
  draw() {
    const g = this.bd.g, th = this.th, W = 640, cx = 320, cy = 440, R = 235, a0 = -Math.PI / 2;
    g.clearRect(0, 0, W, 760);
    g.fillStyle = 'rgba(6,14,26,0.50)'; g.beginPath(); g.roundRect(0, 0, W, 760, 36); g.fill();
    const counting = this.t < 0, cyc = counting ? 0 : this.t % this.total, ph = this.p.ph;
    const label = !this.started ? 'Press Start' : counting ? 'Get ready' : ph[this.idx][0];
    g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = '700 64px system-ui, sans-serif'; g.lineJoin = 'round'; g.lineWidth = 10; g.strokeStyle = 'rgba(0,12,24,.7)';
    g.strokeText(label, cx, 130); g.fillText(label, cx, 130);
    g.font = '500 24px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText(counting && this.started ? String(Math.ceil(-this.t)) : this.p.name + '   ·   cycle ' + (this.cycles + 1), cx, 176);
    // inner discs: guide (outline) and YOUR breath (filled)
    const m = this.app.mon, rIn = R - 40;
    g.fillStyle = rgba(th.accent, 0.20); g.beginPath(); g.arc(cx, cy, rIn * (0.25 + 0.75 * m.fill), 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 3; g.setLineDash([8, 8]); g.beginPath(); g.arc(cx, cy, rIn * (0.25 + 0.75 * this.guide), 0, TAU); g.stroke(); g.setLineDash([]);
    // ring: one arc per phase, length proportional to its duration
    let acc = 0;
    ph.forEach((q, i) => {
      const s = a0 + (acc / this.total) * TAU, e = a0 + ((acc + q[2]) / this.total) * TAU, active = this.started && !counting && i === this.idx;
      g.lineWidth = 16; g.lineCap = 'butt';
      g.strokeStyle = active ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.22)'; g.beginPath(); g.arc(cx, cy, R, s, e); g.stroke();
      // elapsed part, brighter
      const done = clamp((cyc - acc) / q[2], 0, 1) * (counting ? 0 : 1);
      if (done > 0) { g.strokeStyle = rgba(th.accent, 0.95); g.beginPath(); g.arc(cx, cy, R, s, s + (e - s) * done); g.stroke(); }
      // boundary tick
      g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx + Math.cos(s) * (R - 22), cy + Math.sin(s) * (R - 22)); g.lineTo(cx + Math.cos(s) * (R + 22), cy + Math.sin(s) * (R + 22)); g.stroke();
      // label at the arc midpoint, inside the ring
      const mid = (s + e) / 2; g.font = (active ? '700 ' : '500 ') + '26px system-ui, sans-serif'; g.fillStyle = active ? '#fff' : 'rgba(255,255,255,.55)';
      g.strokeStyle = 'rgba(0,12,24,.65)'; g.lineWidth = 6;
      const lx = cx + Math.cos(mid) * (R - 62), ly = cy + Math.sin(mid) * (R - 62) + 8; g.strokeText(q[1], lx, ly); g.fillText(q[1], lx, ly);
      acc += q[2];
    });
    // travelling dot
    const ang = a0 + (cyc / this.total) * TAU;
    g.fillStyle = '#fff'; g.shadowColor = rgba(th.accent); g.shadowBlur = 22; g.beginPath(); g.arc(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R, 15, 0, TAU); g.fill(); g.shadowBlur = 0;
    // centre readout
    if (this.started && !counting) { g.fillStyle = '#fff'; g.font = '700 84px system-ui, sans-serif'; g.fillText(String(Math.max(1, Math.ceil(ph[this.idx][2] - this.phT))), cx, cy + 28); }
    g.font = '600 22px system-ui, sans-serif'; g.fillStyle = rgba(th.good); g.fillText(this.syncN ? `SYNC ${f0(100 * this.syncSum / this.syncN)}%` : 'Follow the dotted circle with your breath', cx, 742);
    this.bd.refresh();
  }
}

// ======================================================================= wave rider (trace a scrolling curve)
export class WaveScreen extends Screen {
  enter() {
    const a = this.app, th = this.th;
    this.root.setPos(0, 0.25, -2.6);
    this.bd = this.board(3.2, 1.31, 1024, 420, 0, 0.3, 0);
    this.bpm = 6; this.band = 1; this.slow = true; this.state = 'setup'; this.hist = []; this.acc = 1;
    const y = -0.62, set = [];
    set.push(this.btn('', -1.15, y, 0.75, 0.22, () => { this.bpm = clamp(this.bpm - 1, 3, 12); this.lbl(); }, { size: 0.055 }));
    set.push(this.btn('Pace +', -0.35, y, 0.7, 0.22, () => { this.bpm = clamp(this.bpm + 1, 3, 12); this.lbl(); }, { size: 0.055 }));
    this.bandBtn = this.btn('', 0.45, y, 0.8, 0.22, () => { this.band = (this.band + 1) % 3; this.lbl(); }, { size: 0.055 }); set.push(this.bandBtn);
    this.slowBtn = this.btn('', 1.3, y, 0.8, 0.22, () => { this.slow = !this.slow; this.lbl(); }, { size: 0.055 }); set.push(this.slowBtn);
    this.paceBtn = set[0]; this.set = set;
    this.startBtn = this.btn('Start', 0.5, -0.92, 0.9, 0.24, () => this.start(), { accent: true, size: 0.065 });
    this.back(-0.95, -0.92); this.lbl();
  }
  exit() { this.app.mon.setGuide(null); }
  lbl() { this.paceBtn.setText('Pace -'); this.paceBtn.pn.mat.u.uBorderColor = this.th.acc; this.bandBtn.setText('Band: ' + ['Easy', 'Normal', 'Hard'][this.band]); this.slowBtn.setText('Slowing: ' + (this.slow ? 'on' : 'off')); this.dirty = true; }
  start() { this.state = 'play'; this.t = -3; this.inBand = 0; this.total = 0; this.streak = 0; this.best = 0; this.set.forEach(b => { b.grp.visible = false; }); this.startBtn.setText('Stop'); this.startBtn.onClick = () => this.finish(); this.app.mon.resetSession(); this.hist = []; }
  phase(t) {
    const f1 = this.bpm / 60, f0_ = this.slow ? Math.max(f1, 10 / 60) : f1, T = 90;
    if (t < 0) return f0_ * t;
    return t < T ? f0_ * t + (f1 - f0_) * t * t / (2 * T) : f0_ * T + (f1 - f0_) * T / 2 + f1 * (t - T);
  }
  target(t) { return 0.12 + 0.76 * (0.5 - 0.5 * Math.cos(TAU * this.phase(t))); }
  finish() { this.state = 'done'; this.app.mon.setGuide(null); Audio.success(); this.startBtn.setText('Again'); this.startBtn.onClick = () => this.app.show(new WaveScreen(this.app)); }
  tick(dt) {
    const m = this.app.mon, tol = [0.22, 0.15, 0.10][this.band];
    if (this.state === 'play') {
      this.t += dt;
      if (this.t >= 0) {
        m.setGuide(this.target(this.t));
        const ok = Math.abs(m.fill - this.target(this.t)) < tol; this.total += dt; if (ok) { this.inBand += dt; this.streak += dt; this.best = Math.max(this.best, this.streak); } else this.streak = 0;
        if (this.t >= 120) this.finish();
      } else m.setGuide(0);
      this.hist.push([this.t, m.fill]); if (this.hist.length > 400) this.hist.shift();
    }
    this.acc += dt; if (this.acc < 1 / 25) return; this.acc = 0;
    this.draw(tol);
  }
  draw(tol) {
    const g = this.bd.g, th = this.th, W = 1024, H = 420, nowX = 330, pxs = 52, m = this.app.mon;
    g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(6,14,26,0.58)'; g.beginPath(); g.roundRect(0, 0, W, H, 24); g.fill();
    const Y = v => H - 40 - clamp(v, 0, 1) * (H - 100);
    g.strokeStyle = 'rgba(255,255,255,.09)'; g.lineWidth = 1; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, Y(i / 4)); g.lineTo(W, Y(i / 4)); g.stroke(); }
    const t = this.state === 'setup' ? 0 : this.t;
    // band + target
    g.beginPath(); for (let x = 0; x <= W; x += 6) { const v = this.target(t + (x - nowX) / pxs); x ? g.lineTo(x, Y(v + tol)) : g.moveTo(x, Y(v + tol)); }
    for (let x = W; x >= 0; x -= 6) g.lineTo(x, Y(this.target(t + (x - nowX) / pxs) - tol));
    g.closePath(); g.fillStyle = rgba(th.accent, 0.16); g.fill();
    g.beginPath(); for (let x = 0; x <= W; x += 6) { const v = this.target(t + (x - nowX) / pxs); x ? g.lineTo(x, Y(v)) : g.moveTo(x, Y(v)); }
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 4; g.setLineDash([10, 8]); g.stroke(); g.setLineDash([]);
    // your trace
    if (this.state !== 'setup' && this.hist.length > 1) {
      g.lineWidth = 6; g.lineCap = 'round';
      for (let i = 1; i < this.hist.length; i++) {
        const [t1, v1] = this.hist[i], [t0, v0] = this.hist[i - 1], x1 = nowX + (t1 - t) * pxs, x0 = nowX + (t0 - t) * pxs; if (x1 < 0) continue;
        const ok = Math.abs(v1 - this.target(t1)) < tol; g.strokeStyle = ok ? 'rgb(110,255,160)' : 'rgb(255,190,90)'; g.beginPath(); g.moveTo(x0, Y(v0)); g.lineTo(x1, Y(v1)); g.stroke();
      }
    }
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(nowX, 20); g.lineTo(nowX, H - 20); g.stroke();
    g.fillStyle = '#fff'; g.shadowColor = rgba(th.accent); g.shadowBlur = 18; g.beginPath(); g.arc(nowX, Y(m.fill), 11, 0, TAU); g.fill(); g.shadowBlur = 0;
    // header
    g.textAlign = 'left'; g.font = '600 24px system-ui, sans-serif'; g.fillStyle = '#fff';
    if (this.state === 'setup') { g.fillText(`WAVE RIDER   pace ${this.bpm} breaths/min${this.slow ? ' (starts faster, slows down)' : ''}`, 20, 34); g.font = '500 20px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText('Breathe so your trace stays inside the shaded band. Up = in, down = out.', 20, 62); }
    else if (this.state === 'play') { g.fillText(this.t < 0 ? 'Get ready  ' + Math.ceil(-this.t) : `ON TARGET ${this.total ? f0(100 * this.inBand / this.total) : 0}%     streak ${this.streak.toFixed(0)} s     time ${f0(Math.max(0, this.t))}/120 s`, 20, 34); }
    else { g.fillText(`DONE   on target ${this.total ? f0(100 * this.inBand / this.total) : 0}%    best streak ${this.best.toFixed(0)} s    avg rate ${m.rr ? m.rr.toFixed(1) : '--'} /min`, 20, 34); }
    this.bd.refresh();
  }
}

// ======================================================================= guided spirometry: chase the ghost ball
export class GuidedSpiroScreen extends Screen {
  enter() {
    const a = this.app, th = this.th, sp = a.spiro;
    this.stage = true; this.lungWave = true; this.root.setPos(...a.env.stageCenter);
    sp.mode = 1; sp.live = true; sp.levelMult = (Settings.level === 0 ? 0.7 : Settings.level === 1 ? 1 : 1.4) * Settings.difficulty; this.sp = sp;
    this.backdrop(0, 1.52, 3.4, 0.9, 0.05);
    this.banner = this.txt('Chase the ghost ball', 0, 1.78, 0.11, th.acc, 'center', true, 0.1);
    this.sub = this.txt('', 0, 1.58, 0.06, th.text, 'center', false, 0.1);
    this.bd = this.board(2.9, 0.42, 1024, 148, 0, 1.28, 0.1);
    this.score = this.txt('', -1.5, 1.78, 0.06, th.good, 'left', true, 0.1);
    this.back(-1.6, -1.62, 1.1); this.startBtn = this.btn('Start', 1.6, -1.62, 0.8, 0.24, () => this.start(), { z: 1.1, accent: true, size: 0.07 });
    this.state = 'idle'; this.buildScript(); this.t = 0; this.acc = 1; this.hist = [];
    a.mon.resetSession(); this.draw();
  }
  exit() { this.app.mon.setGuideFlow(null); this.sp.ghost = null; }
  buildScript() {
    const hold = Settings.holdGoal, steps = [0, 1, 2, 1, 2, 0], bp = [[0, 0]]; let t = 0; this.segs = [];
    for (const k of steps) {
      const F = this.sp.thresholdOf(k) * 1.1, V = F * (hold + 1.1), G = F * 0.5, pe = V / G - 0.8;
      const t0 = t;
      bp.push([t += 1.2, F], [t += hold, F], [t += 1.0, 0]); this.segs.push({ t0, t1: t, k, F });
      bp.push([t += 0.8, -G], [t += pe, -G], [t += 0.8, 0], [t += 1.0, 0]);
    }
    this.bp = bp; this.dur = t;
  }
  flowAt(t) { const b = this.bp; if (t <= 0) return 0; for (let i = 1; i < b.length; i++) if (t <= b[i][0]) return lerp(b[i - 1][1], b[i][1], (t - b[i - 1][0]) / Math.max(1e-6, b[i][0] - b[i - 1][0])); return 0; }
  start() { this.state = 'play'; this.t = -3; this.inTol = 0; this.tot = 0; this.hist = []; this.startBtn.setText('Stop'); this.startBtn.onClick = () => this.finish(); this.app.mon.resetSession(); }
  finish() {
    if (this.state === 'done') return; this.state = 'done'; this.sp.ghost = null; this.app.mon.setGuideFlow(null); Audio.success();
    const pc = this.tot ? f0(100 * this.inTol / this.tot) : 0; this.banner.set('Session complete'); this.sub.set(`You matched the ghost ${pc}% of the time`);
    this.startBtn.setText('Again'); this.startBtn.onClick = () => this.app.show(new GuidedSpiroScreen(this.app));
    this.app.env.shockwave(this.th.good, 9, 2.8); for (let i = 0; i < 3; i++) this.app.env.burst(this.sp.topOf(i), this.th.cyl[i], 50, 3, 1.8, 0.15);
  }
  tick(dt) {
    const sp = this.sp, m = this.app.mon; let F = 0;
    if (this.state === 'play') {
      this.t += dt; F = this.flowAt(this.t);
      m.setGuideFlow(this.t < 0 ? 0 : F);
      sp.ghost = F > 20 ? [0, 1, 2].map(i => clamp(F / sp.thresholdOf(i), 0, 1)) : [0, 0, 0];
      if (this.t > 0) {
        const seg = this.segs.find(s => this.t >= s.t0 && this.t <= s.t1);
        if (seg) { this.banner.set(`INHALE to ${['LOW', 'MID', 'HIGH'][seg.k]}`); this.sub.set('Keep YOUR ball on the ghost ball'); }
        else { this.banner.set(F < -20 ? 'EXHALE slowly' : 'Relax'); this.sub.set(F < -20 ? 'Let the air out smoothly' : 'Get ready for the next one'); }
        if (F > 0.25 * sp.thresholdOf(0)) { this.tot += dt; if (Math.abs(m.driveFlow - F) < Math.max(130, 0.25 * F)) this.inTol += dt; }
        this.score.set(`MATCH ${this.tot ? f0(100 * this.inTol / this.tot) : 0}%`);
        if (this.t > this.dur) this.finish();
      } else { this.banner.set('Get ready'); this.sub.set(String(Math.ceil(-this.t))); }
      this.hist.push([this.t, m.driveFlow]); if (this.hist.length > 300) this.hist.shift();
    }
    this.acc += dt; if (this.acc >= 1 / 20) { this.acc = 0; this.draw(); }
  }
  draw() {
    const g = this.bd.g, th = this.th, W = 1024, H = 148, nowX = 260, pxs = 38, t = this.state === 'play' ? this.t : 0, mx = this.sp.thresholdOf(2) * 1.35, mn = -this.sp.thresholdOf(1) * 0.7;
    g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(6,14,26,0.58)'; g.beginPath(); g.roundRect(0, 0, W, H, 18); g.fill();
    const Y = v => H - 14 - (clamp(v, mn, mx) - mn) / (mx - mn) * (H - 28);
    g.strokeStyle = 'rgba(255,255,255,.3)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(W, Y(0)); g.stroke();
    [0, 1, 2].forEach(i => { g.strokeStyle = rgba(th.cyl[i], 0.4); g.setLineDash([4, 6]); g.beginPath(); g.moveTo(0, Y(this.sp.thresholdOf(i))); g.lineTo(W, Y(this.sp.thresholdOf(i))); g.stroke(); });
    g.setLineDash([]); g.beginPath();
    for (let x = 0; x <= W; x += 5) { const v = this.flowAt(t + (x - nowX) / pxs); x ? g.lineTo(x, Y(v)) : g.moveTo(x, Y(v)); }
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3.5; g.stroke();
    if (this.hist.length > 1) { g.strokeStyle = 'rgb(110,255,160)'; g.lineWidth = 4; g.beginPath(); this.hist.forEach(([tt, v], i) => { const x = nowX + (tt - t) * pxs; i ? g.lineTo(x, Y(v)) : g.moveTo(x, Y(v)); }); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.moveTo(nowX, 6); g.lineTo(nowX, H - 6); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.7)'; g.font = '13px system-ui, sans-serif'; g.textAlign = 'left'; g.fillText('flow target (white) and your flow (green)', 8, 16);
    this.bd.refresh();
  }
}

// ======================================================================= breath flappy
export class FlappyScreen extends Screen {
  enter() {
    const a = this.app, th = this.th;
    this.root.setPos(0, 0.2, -2.7);
    this.bd = this.board(3.0, 1.6875, 1024, 576, 0, 0.35, 0);
    this.back(-1.0, -0.82); this.startBtn = this.btn('Start', 0.9, -0.82, 0.9, 0.24, () => this.start(), { accent: true, size: 0.065 });
    this.state = 'idle'; this.best = +(localStorage.getItem('respirovr.flappy') || 0); this.acc = 1; this.bird = 0.5; this.pipes = []; this.score = 0; this.lives = 3; this.t = 0;
    this.W = 1024; this.H = 576; this.gap = 0.36; a.mon.resetSession(); this.draw();
  }
  exit() { this.app.mon.setGuide(null); }
  start() {
    this.state = 'play'; this.t = -2; this.pipes = []; this.score = 0; this.lives = 3; this.inv = 0; this.nextX = this.W + 200; this.lastGap = 0.5; this.startBtn.setText('Stop');
    this.startBtn.onClick = () => this.over(); this.app.mon.resetSession();
  }
  over() {
    if (this.state === 'over') return; this.state = 'over'; this.app.mon.setGuide(null);
    if (this.score > this.best) { this.best = this.score; try { localStorage.setItem('respirovr.flappy', String(this.best)); } catch (e) { /* ignore */ } }
    this.startBtn.setText('Again'); this.startBtn.onClick = () => this.app.show(new FlappyScreen(this.app)); Audio.success();
  }
  tick(dt) {
    const m = this.app.mon, W = this.W, H = this.H;
    const want = clamp((m.fill - 0.08) / 0.84, 0, 1);              // breathe in = rise, out = sink
    this.bird += (want - this.bird) * Math.min(1, dt * 12);
    if (this.state === 'play') {
      this.t += dt;
      if (this.t > 0) {
        const speed = 150 + Math.min(60, this.t * 0.8);
        this.nextX -= speed * dt; this.pipes.forEach(p => { p.x -= speed * dt; });
        if (this.nextX < W) { const gc = clamp(this.lastGap + (Math.random() * 0.6 - 0.3), 0.22, 0.78); this.lastGap = gc; this.pipes.push({ x: this.nextX + 40, g: gc, done: false }); this.nextX += 340; }
        this.pipes = this.pipes.filter(p => p.x > -120);
        const bx = 250, by = H - 40 - this.bird * (H - 80); this.inv = Math.max(0, this.inv - dt);
        for (const p of this.pipes) {
          if (!p.done && p.x + 70 < bx) { p.done = true; this.score++; Audio.tick(); }
          if (this.inv <= 0 && bx + 16 > p.x && bx - 16 < p.x + 70) {
            const gy = H - 40 - p.g * (H - 80), half = this.gap * (H - 80) / 2;
            if (by < gy - half + 8 || by > gy + half - 8) { this.lives--; this.inv = 1.5; Audio.back(); if (this.lives <= 0) { this.over(); break; } }
          }
        }
        const nxt = this.pipes.find(p => p.x + 70 > bx - 20);
        m.setGuide(nxt ? 0.08 + nxt.g * 0.84 : 0.5);                // demo source plays by itself
        if (this.t > 90) this.over();
      }
    }
    this.acc += dt; if (this.acc >= 1 / 30) { this.acc = 0; this.draw(); }
  }
  draw() {
    const g = this.bd.g, th = this.th, W = this.W, H = this.H, bx = 250, by = H - 40 - this.bird * (H - 80), tt = performance.now() / 1000;
    g.clearRect(0, 0, W, H); g.save(); g.beginPath(); g.roundRect(0, 0, W, H, 26); g.clip();
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, rgba(th.top.map(v => v * 0.9 + 0.1))); sky.addColorStop(1, rgba(th.bottom.map(v => v * 0.8 + 0.2))); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.55)'; for (let i = 0; i < 5; i++) { const x = ((i * 260 - tt * 12) % (W + 200) + W + 200) % (W + 200) - 100, y = 60 + (i * 53) % 150; g.beginPath(); g.ellipse(x, y, 64, 18, 0, 0, TAU); g.ellipse(x + 30, y - 10, 36, 16, 0, 0, TAU); g.fill(); }
    g.fillStyle = 'rgba(30,80,50,.55)'; g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 16) g.lineTo(x, H - 50 - 34 * Math.sin(x * 0.011 + 1) - 20 * Math.sin(x * 0.027)); g.lineTo(W, H); g.fill();
    for (const p of this.pipes) {
      const gy = H - 40 - p.g * (H - 80), half = this.gap * (H - 80) / 2;
      for (const [y0, y1] of [[0, gy - half], [gy + half, H]]) {
        g.fillStyle = '#3fbf5a'; g.fillRect(p.x, y0, 70, y1 - y0); g.fillStyle = '#2c8f44'; g.fillRect(p.x + 52, y0, 18, y1 - y0); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(p.x + 8, y0, 8, y1 - y0);
        g.fillStyle = '#4ad66a'; g.fillRect(p.x - 6, y0 === 0 ? y1 - 26 : y0, 82, 26);
      }
    }
    g.fillStyle = '#d9b26a'; g.fillRect(0, H - 34, W, 34); g.fillStyle = '#8bd150'; g.fillRect(0, H - 40, W, 8);
    // bird
    const blink = this.inv > 0 && Math.floor(this.inv * 10) % 2 === 0;
    if (!blink) {
      const tilt = clamp((this.bird - (this.prevBird === undefined ? this.bird : this.prevBird)) * 40, -0.5, 0.5); this.prevBird = this.bird;
      g.save(); g.translate(bx, by); g.rotate(-tilt);
      g.fillStyle = '#ffd23f'; g.beginPath(); g.ellipse(0, 0, 24, 19, 0, 0, TAU); g.fill();
      g.fillStyle = '#f2a900'; g.beginPath(); g.ellipse(-6, 4 + Math.sin(tt * 14) * 4, 12, 7, 0.3, 0, TAU); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(10, -6, 7, 0, TAU); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.arc(12, -6, 3, 0, TAU); g.fill();
      g.fillStyle = '#ff6b3d'; g.beginPath(); g.moveTo(20, 0); g.lineTo(36, 4); g.lineTo(20, 9); g.fill(); g.restore();
    }
    g.restore();
    g.textAlign = 'center'; g.lineJoin = 'round'; g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,.6)'; g.fillStyle = '#fff'; g.font = '700 64px system-ui, sans-serif';
    g.strokeText(String(this.score), W / 2, 84); g.fillText(String(this.score), W / 2, 84);
    g.textAlign = 'left'; g.font = '700 30px system-ui, sans-serif'; g.fillStyle = '#ff6b8b'; g.strokeText('♥'.repeat(Math.max(0, this.lives)), 24, 48); g.fillText('♥'.repeat(Math.max(0, this.lives)), 24, 48);
    g.textAlign = 'right'; g.font = '600 22px system-ui, sans-serif'; g.fillStyle = '#fff'; g.fillText('best ' + this.best, W - 24, 44);
    g.textAlign = 'center'; g.font = '600 26px system-ui, sans-serif';
    const msg = this.state === 'idle' ? 'Breathe IN to fly up, OUT to sink. Fly through the gaps.' : this.state === 'over' ? `Game over   score ${this.score}   ${this.score >= this.best && this.score > 0 ? 'NEW BEST!' : ''}` : this.t < 0 ? 'Get ready ' + Math.ceil(-this.t) : '';
    if (msg) { g.strokeText(msg, W / 2, H - 56); g.fillText(msg, W / 2, H - 56); }
    // breath meter on the right edge
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(W - 22, 70, 10, H - 160); g.fillStyle = '#7dffb0'; g.fillRect(W - 22, 70 + (H - 160) * (1 - this.bird), 10, (H - 160) * this.bird);
    this.bd.refresh();
  }
}
