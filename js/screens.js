// All VR pages. Forward is -Z; stage-centred pages put their root on the spirometer stage.
import { Node, Material, Geo } from './gl.js';
import { clamp, lerp, smoothstep, qAxisAngle } from './math.js';
import { Settings, MOODS, PATTERNS, PATTERN_ORDER, calibrated } from './core.js';
import * as Audio from './audio.js';
import { Screen } from './screenbase.js';
import { RespMonitorScreen } from './monitorview.js';
import { WaveScreen, RingPacerScreen, GuidedSpiroScreen, FlappyScreen } from './games.js';
export { Screen, RespMonitorScreen, WaveScreen, RingPacerScreen, GuidedSpiroScreen, FlappyScreen };

const QUAD = Geo.quad(1, 1);
const f0 = v => Math.round(v);

// ======================================================================= menu
export class MenuScreen extends Screen {
  enter() {
    const a = this.app, th = this.th;
    this.root.setPos(0, 0.05, -2.6); this.backdrop(0, 0.0, 3.3, 2.5);
    this.txt('RESPIRO VR', 0, 1.04, 0.19, th.acc, 'center', true);
    this.mood = this.txt('', 0, 0.82, 0.062, th.text);
    const items = [
      ['Spirometer Game', () => a.show(new SpiroGameScreen(a))], ['Guided Spirometry', () => a.show(new GuidedSpiroScreen(a))],
      ['Ring Pacer', () => a.show(new RingPacerScreen(a))], ['Breathing Trainers', () => a.show(new TrainersScreen(a))],
      ['Respiratory Monitor', () => a.show(new RespMonitorScreen(a))], ['Mood Rooms', () => a.show(new RelaxScreen(a))],
      ['Breath Flappy', () => a.show(new FlappyScreen(a))], ['Spirometer Live', () => a.show(new MonitorScreen(a))],
      ['Breath Calibration', () => a.show(new BreathCalibScreen(a))], ['VR Calibration', () => a.show(new VrCalibScreen(a))],
      ['Settings', () => a.show(new SettingsScreen(a, 0))], ['Exit VR', () => a.rig.exit()],
    ];
    items.forEach(([l, fn], i) => this.btn(l, (i % 2 ? 1 : -1) * 0.62, 0.52 - Math.floor(i / 2) * 0.265, 1.15, 0.225, fn, { accent: i === 4, size: 0.062 }));
    this.status = this.txt('', 0, -0.98, 0.048, th.dim);
    this.t = 0;
  }
  tick(dt) {
    const a = this.app, m = a.mon;
    this.mood.set(`${MOODS[Settings.mood].name}  -  ${MOODS[Settings.mood].mood}`);
    this.status.set(`Belt: ${m.label} (${m.status})   ${calibrated() ? 'calibrated' : 'not calibrated'}`);
  }
}

// ======================================================================= trainers list
export class TrainersScreen extends Screen {
  enter() {
    const a = this.app, th = this.th;
    this.root.setPos(0, 0.05, -2.6); this.backdrop(0, 0.0, 3.3, 2.5);
    this.txt('BREATHING TRAINERS', 0, 0.98, 0.11, th.acc, 'center', true);
    const list = PATTERN_ORDER.map(k => ({ name: PATTERNS[k].name, sub: PATTERNS[k].phases.map(q => q[0][0] + q[0].slice(1).toLowerCase() + ' ' + q[1] + 's').join('  /  '), go: () => a.show(new PacerScreen(a, k, PATTERNS[k].cycles)), hot: MOODS[Settings.mood].pattern === k }));
    list.push({ name: 'Wave Rider', sub: 'Trace a scrolling breathing curve', go: () => a.show(new WaveScreen(a)) });
    list.push({ name: 'Ring Pacer', sub: 'Circle with a travelling dot (4-4-8 ...)', go: () => a.show(new RingPacerScreen(a)) });
    list.forEach((p, i) => {
      const x = (i % 2 ? 1 : -1) * 0.68, y = 0.66 - Math.floor(i / 2) * 0.38;
      this.btn(p.name, x, y, 1.3, 0.24, p.go, { size: 0.066, accent: p.hot });
      this.txt(p.sub, x, y - 0.18, 0.038, th.dim);
    });
    this.txt('Highlighted = suggested for the current mood', 0, -0.92, 0.042, th.dim);
    this.back(-0.95, -1.04);
  }
}

// ======================================================================= guided pacer
export class PacerScreen extends Screen {
  constructor(app, key, cycles) {
    super(app); this.key = key; this.p = PATTERNS[key]; this.cycles = cycles || this.p.cycles;
    this.lungWave = true;
  }
  enter() {
    const a = this.app, th = this.th, r = a.r;
    this.root.setPos(0, 0.05, -2.8);
    // orb: glass shell + glowing core. Ring: where YOUR breath is.
    this.orb = new Node(Geo.sphere(0.5, 36, 22), new Material('glass', { blend: 'add', cull: 'none', order: 3000, u: { uColor: th.acc, uPower: 1.8, uIntensity: 1.2, uBase: 0.12 } }));
    this.core = new Node(Geo.sphere(0.46, 32, 20), new Material('liquid', { blend: 'alpha', order: 2950, u: { uColor: [th.accent[0] * 0.3, th.accent[1] * 0.3, th.accent[2] * 0.3, 1], uColor2: th.acc, uBaseY: -0.5, uHeight: 1, uGlow: 1.1, uAlpha: 0.4, uFlow: 0.15 } }));
    this.ring = new Node(QUAD, new Material('tex', { blend: 'add', order: 2990, depthWrite: false, u: { uMap: a.env.ringTex, uColor: th.good, uIntensity: 1 } }));
    this.orb.setPos(0, 0.12, 0); this.core.setPos(0, 0.12, 0); this.ring.setPos(0, 0.12, 0.1);
    this.root.add(this.core); this.root.add(this.orb); this.root.add(this.ring);
    this.phaseTx = this.txt('GET READY', 0, 1.08, 0.15, th.acc, 'center', true);
    this.countTx = this.txt('', 0, 0.12, 0.28, [1, 1, 1, 0.9], 'center', true, 0.45);
    this.subTx = this.txt(this.p.name + '  -  ' + MOODS[Settings.mood].name, 0, 0.88, 0.055, th.text);
    this.cycTx = this.txt('', -0.95, 0.88, 0.05, th.dim, 'left');
    this.syncTx = this.txt('', 0.95, 0.88, 0.05, th.good, 'right', true);
    this.back(-0.95, -0.82);
    this.pauseBtn = this.btn('Pause', 0.95, -0.82, 0.7, 0.24, () => { this.paused = !this.paused; this.pauseBtn.setText(this.paused ? 'Resume' : 'Pause'); }, { size: 0.07 });
    this.paused = false; this.t = -3; this.idx = 0; this.cycle = 0; this.phaseT = 0; this.prev = 0; this.guide = 0;
    this.syncSum = 0; this.syncN = 0; this.done = false; this.lastPhase = '';
    a.mon.resetSession();
  }
  exit() { this.app.mon.setGuide(null); }
  tick(dt) {
    const a = this.app, ph = this.p.phases;
    if (this.done) return;
    if (this.paused) return;
    this.t += dt;
    let label, target = this.guide;
    if (this.t < 0) {
      label = 'GET READY'; this.countTx.set(String(Math.ceil(-this.t))); this.guide = 0; target = 0;
    } else {
      this.countTx.set('');
      const [name, dur, end] = ph[this.idx];
      this.phaseT += dt;
      const f = clamp(this.phaseT / dur, 0, 1);
      this.guide = lerp(this.prev, end, smoothstep(0, 1, f));
      label = name;
      this.countTx.set(String(Math.max(0, Math.ceil(dur - this.phaseT))));
      if (this.lastPhase !== name + this.idx + this.cycle) { this.lastPhase = name + this.idx + this.cycle; Audio.cue(name, dur); }
      if (this.phaseT >= dur) {
        this.prev = end; this.phaseT = 0; this.idx++;
        if (this.idx >= ph.length) { this.idx = 0; this.cycle++; if (this.cycle >= this.cycles) return this.finish(); }
      }
      // how closely does the belt follow the guide?
      const err = Math.abs(a.mon.fill - this.guide);
      this.syncSum += 1 - Math.min(1, err / 0.35); this.syncN++;
    }
    a.mon.setGuide(this.guide);
    this.phaseTx.set(label);
    this.cycTx.set(this.t < 0 ? '' : `CYCLE ${Math.min(this.cycle + 1, this.cycles)} / ${this.cycles}`);
    this.syncTx.set(this.syncN ? `SYNC ${f0(100 * this.syncSum / this.syncN)}%` : '');
    // visuals
    const s = 0.55 + 0.75 * this.guide;
    this.orb.setScale(s, s, s); this.core.setScale(s, s, s);
    const user = 0.55 + 0.75 * a.mon.fill, ok = Math.abs(a.mon.fill - this.guide) < 0.18;
    this.ring.setScale(user * 1.2, user * 1.2, 1);
    this.ring.u = { uColor: ok ? this.th.good : this.th.warn };
    this.core.mat.u.uGlow = 0.9 + 0.6 * this.guide;
  }
  finish() {
    const a = this.app; this.done = true; a.mon.setGuide(null);
    const sync = this.syncN ? 100 * this.syncSum / this.syncN : 0;
    this.phaseTx.set('SESSION COMPLETE'); this.countTx.set(''); this.cycTx.set(''); this.syncTx.set('');
    Audio.success(); a.env.shockwave(this.th.good, 10, 3);
    a.env.burst([0, 0.1, -2.8], this.th.accent, 80, 2.4, 1.8);
    this.glass(0, 0.05, 1.9, 0.9, 0.3, 0.94);
    this.txt(`Sync with the guide  ${f0(sync)}%`, 0, 0.30, 0.09, this.th.acc, 'center', true, 0.32);
    this.txt(`${this.cycles} cycles of ${this.p.name}`, 0, 0.14, 0.06, this.th.text, 'center', false, 0.32);
    this.txt(`Breath rate ${a.mon.bpm ? a.mon.bpm.toFixed(1) : '-'} /min    Peak ${f0(a.mon.peakMl)} mL`, 0, 0.02, 0.055, this.th.text, 'center', false, 0.32);
    this.btn('Again', -0.45, -0.18, 0.8, 0.22, () => a.show(new PacerScreen(a, this.key, this.cycles)), { accent: true, z: 0.34, size: 0.065 });
    this.btn('Trainers', 0.45, -0.18, 0.8, 0.22, () => a.show(new TrainersScreen(a)), { z: 0.34, size: 0.065 });
    this.orb.visible = this.core.visible = this.ring.visible = false;
  }
}

// ======================================================================= mood rooms
export class RelaxScreen extends Screen {
  enter() {
    const a = this.app, th = this.th;
    this.root.setPos(0, 0.05, -2.6); this.backdrop(0, 0.0, 3.3, 2.5);
    this.txt('MOOD ROOMS', 0, 1.0, 0.12, th.acc, 'center', true);
    MOODS.forEach((m, i) => this.btn(`${m.mood}  ${m.name}`, -0.72, 0.72 - i * 0.27, 1.25, 0.23, () => { Settings.mood = i; a.applyMood(); a.show(new RelaxScreen(a)); }, { accent: i === Settings.mood, size: 0.062 }));
    const m = MOODS[Settings.mood];
    this.glass(0.78, 0.30, 1.2, 0.86, -0.02);
    this.txt(m.name, 0.78, 0.62, 0.08, th.acc, 'center', true);
    this.txt(m.blurb, 0.78, 0.50, 0.04, th.text);
    this.txt('Suggested trainer', 0.78, 0.36, 0.045, th.dim);
    this.txt(PATTERNS[m.pattern].name, 0.78, 0.26, 0.065, th.text, 'center', true);
    this.btn('Start 5-min session', 0.78, 0.08, 1.05, 0.26, () => a.show(new PacerScreen(a, m.pattern, Math.max(3, Math.round(300 / PATTERNS[m.pattern].phases.reduce((s, q) => s + q[1], 0))))), { accent: true, size: 0.06 });
    // quick sound mixer
    this.txt('SOUND', 0.78, -0.12, 0.05, th.dim);
    const mk = (label, key, x, y) => { const b = this.btn('', x, y, 0.55, 0.2, () => { Settings[key] = Settings[key] ? 0 : 1; Audio.applyLevels(); upd(); }, { size: 0.05 }); const upd = () => b.setText(`${label}: ${Settings[key] ? 'on' : 'off'}`); upd(); };
    mk('Ambience', 'ambience', 0.50, -0.30); mk('Music', 'music', 1.06, -0.30); mk('Guide tones', 'cues', 0.50, -0.54);
    const vb = this.btn('', 1.06, -0.54, 0.55, 0.2, () => { Settings.volume = Settings.volume >= 1 ? 0.2 : Math.min(1, Settings.volume + 0.2); Audio.applyLevels(); vb.setText('Volume ' + f0(Settings.volume * 100) + '%'); }, { size: 0.05 });
    vb.setText('Volume ' + f0(Settings.volume * 100) + '%');
    this.back(-0.95, -0.92);
  }
}

// ======================================================================= spirometer game
export class SpiroGameScreen extends Screen {
  enter() {
    const a = this.app, th = this.th, sp = a.spiro;
    this.stage = true; this.lungWave = true;
    this.root.setPos(...a.env.stageCenter);
    sp.mode = Settings.mode; sp.levelMult = (Settings.level === 0 ? 0.7 : Settings.level === 1 ? 1 : 1.4) * Settings.difficulty;
    sp.live = true; this.sp = sp;
    this.backdrop(0, 1.36, 3.3, 0.62, 0.08);
    this.banner = this.txt('', 0, 1.50, 0.12, th.acc, 'center', true, 0.1);
    this.sub = this.txt('', 0, 1.30, 0.062, th.text, 'center', false, 0.1);
    this.barBack = this.ui.panel(this.root, 0, 1.14, 0.1, 1.6, 0.07, [...th.panel.slice(0, 3), 0.9], [...th.panel.slice(0, 3).map(v => v * 0.6), 0.9], th.acc, 0.03, 0.006);
    this.barFill = this.ui.panel(this.root, -0.8, 1.14, 0.11, 0.001, 0.07, th.good, th.good.map((v, i) => i < 3 ? v * 0.6 : v), th.good, 0.03, 0);
    this.score = this.txt('', -1.25, 1.46, 0.07, th.text, 'left', true, 0.1);
    this.roundTx = this.txt('', 1.25, 1.46, 0.07, th.text, 'right', true, 0.1);
    this.comboTx = this.txt('', -1.25, 1.30, 0.055, th.warn, 'left', true, 0.1);
    this.big = this.txt('', 0, 0.1, 0.5, [1, 1, 1, 1], 'center', true, 0.3);
    this.back(-1.6, -1.62, 1.1); this.btn('Restart', 1.6, -1.62, 0.8, 0.24, () => a.show(new SpiroGameScreen(a)), { z: 1.1, size: 0.07 });
    this.rounds = 5; this.round = 0; this.target = 0; this.combo = 0; this.points = 0; this.successes = 0; this.totalT = 0;
    this.state = 'count'; this.stateT = 0; this.progress = 0; this.required = 3; this.roundT = 0;
    a.mon.resetSession(); sp.resetHolds(); sp.highlight = -1;
  }
  exit() { this.sp.highlight = -1; }
  setBar(v) {
    v = clamp(v, 0, 1); const w = Math.max(0.001, 1.6 * v);
    this.barFill.setScale(w, 0.07, 1); this.barFill.pos[0] = -0.8 + w / 2; this.barFill.mat.u.uAspect = w / 0.07;
  }
  nextRound() {
    this.round++;
    const maxIdx = Settings.level === 0 ? 1 : 2; let t;
    do { t = Math.floor(Math.random() * (maxIdx + 1)); } while (t === this.target && maxIdx > 0 && this.round > 1);
    this.target = t;
    this.required = Settings.mode === 1 ? Math.max(1, Settings.holdGoal * 0.5) : Settings.holdGoal;
    this.progress = 0; this.roundT = 0; this.sp.highlight = t; this.sp.resetHolds(); Audio.tick();
  }
  tick(dt) {
    const sp = this.sp, a = this.app;
    this.stateT += dt;
    this.score.set('SCORE ' + this.points);
    this.roundTx.set(this.state === 'result' ? 'COMPLETE' : `ROUND ${Math.max(1, this.round)} / ${this.rounds}`);
    this.comboTx.set(this.combo > 1 ? 'COMBO x' + this.combo : '');
    const dir = Settings.direction === 0 ? 'INHALE' : 'EXHALE', flow = sp.mode === 1;
    if (this.state === 'count') {
      this.banner.set('GET READY'); this.sub.set(calibrated() || a.mon.src.normalized ? 'Sit comfortably. Breathe normally.' : 'Tip: run Breath Calibration for accurate volumes');
      const n = Math.ceil(3 - this.stateT); this.big.set(n > 0 ? String(n) : ''); this.big.color([1, 1, 1, clamp(1 - (this.stateT % 1), 0, 1)]);
      this.setBar(0);
      if (this.stateT >= 3) { this.big.set(''); this.nextRound(); this.state = 'play'; this.stateT = 0; }
    } else if (this.state === 'play') {
      this.roundT += dt; this.totalT += dt;
      this.banner.set(`${dir} to ${flow ? ['LOW', 'MID', 'HIGH'][this.target] : 'TUBE ' + (this.target + 1)}`);
      this.sub.set(flow ? `Keep the glowing float at the top for ${this.required.toFixed(1)} s  (${f0(sp.thresholdOf(this.target))} mL/s)` : `Fill the tubes up to the marked one and hold for ${this.required.toFixed(1)} s`);
      const ok = sp.level[this.target] > 0.96;
      this.progress = clamp(this.progress + (ok ? dt : -dt * 0.6), 0, this.required);
      this.setBar(this.progress / this.required);
      if (this.progress >= this.required) this.roundDone();
    }
  }
  roundDone() {
    const a = this.app, sp = this.sp;
    this.successes++; this.combo++;
    const pts = f0((100 * (this.target + 1) + Math.max(0, 25 - this.roundT) * 6) * (1 + 0.1 * (this.combo - 1)));
    this.points += pts; Audio.success();
    a.env.burst(sp.topOf(this.target), this.th.cyl[this.target], 70, 2.6, 1.6, 0.15);
    a.env.shockwave(this.th.cyl[this.target], 8, 2.5); a.toast('+' + pts + ' points');
    sp.highlight = -1;
    if (this.round >= this.rounds) this.finish(); else this.nextRound();
  }
  finish() {
    const a = this.app, th = this.th, sp = this.sp, bm = a.mon;
    this.state = 'result'; sp.highlight = -1; this.setBar(1);
    const perfect = this.rounds * (this.required + 6), stars = this.totalT < perfect * 1.2 ? 3 : this.totalT < perfect * 2 ? 2 : 1;
    this.banner.set('SESSION COMPLETE'); this.sub.set('');
    this.glass(0, 0.1, 2.2, 1.7, 0.58, 0.95);
    this.txt('RESULT   ' + '★'.repeat(stars) + '☆'.repeat(3 - stars), 0, 0.75, 0.13, th.acc, 'center', true, 0.6);
    this.txt('Score  ' + this.points, 0, 0.5, 0.1, th.text, 'center', true, 0.6);
    this.txt(`Rounds ${this.successes}/${this.rounds}     Time ${f0(this.totalT)} s`, 0, 0.28, 0.06, th.text, 'center', false, 0.6);
    this.txt(`Peak volume ${f0(bm.peakMl)} mL     Best hold ${bm.bestHold.toFixed(1)} s`, 0, 0.15, 0.06, th.text, 'center', false, 0.6);
    this.txt(bm.lastFvcMl > 1 ? `Last forced exhale: FVC ${f0(bm.lastFvcMl)} mL   FEV1 ${f0(bm.lastFev1Ml)} mL` : `Breath rate ${bm.bpm ? bm.bpm.toFixed(1) : '-'} /min`, 0, 0.02, 0.06, th.text, 'center', false, 0.6);
    this.btn('Play again', -0.55, -0.35, 0.9, 0.22, () => a.show(new SpiroGameScreen(a)), { accent: true, z: 0.62, size: 0.06 });
    this.btn('Menu', 0.55, -0.35, 0.9, 0.22, () => a.show(new MenuScreen(a)), { z: 0.62, size: 0.06 });
    Audio.success(); a.env.shockwave(th.good, 10, 3);
    for (let i = 0; i < 3; i++) a.env.burst(sp.topOf(i), th.cyl[i], 60, 3, 2, 0.16);
  }
}

// ======================================================================= live monitor
export class MonitorScreen extends Screen {
  enter() {
    const a = this.app, th = this.th, sp = a.spiro;
    this.stage = true; this.lungWave = true; sp.mode = 0; sp.live = true; sp.levelMult = 1;
    this.root.setPos(...a.env.stageCenter);
    this.glass(0, 1.42, 3.9, 0.98, 0.0, 0.85);
    const names = ['VOLUME', 'FLOW', 'PHASE', 'BREATHS/MIN', 'PEAK', 'BEST HOLD', 'FVC', 'FEV1', 'FEV1/FVC'];
    this.vals = names.map((n, i) => {
      const x = -1.25 + (i % 3) * 1.3, y = 1.70 - Math.floor(i / 3) * 0.25;
      this.txt(n, x - 0.55, y, 0.042, th.acc, 'left', false, 0.12);
      return this.txt('-', x + 0.6, y, 0.058, th.text, 'right', true, 0.12);
    });
    this.txt('SIGNAL', -1.85, 1.02, 0.04, th.acc, 'left', false, 0.12);
    this.glass(-1.3, 1.02, 0.8, 0.05, 0.1, 0.9);
    this.qual = this.ui.panel(this.root, -1.3, 1.02, 0.11, 0.8, 0.04, th.good, th.good, th.good, 0.02, 0);
    this.recTx = this.txt('', 1.85, 1.02, 0.04, th.warn, 'right', true, 0.12);
    this.back(-1.6, -1.62, 1.1);
    this.btn('Reset', -0.75, -1.62, 0.6, 0.24, () => { a.mon.resetSession(); this.lines = []; this.recT = 0; a.toast('Session reset'); }, { z: 1.1, size: 0.06 });
    this.btn('Save CSV', 0.05, -1.62, 0.8, 0.24, () => this.save(), { z: 1.1, size: 0.06, accent: true });
    this.btn('Direction', 0.95, -1.62, 0.8, 0.24, () => { Settings.direction = 1 - Settings.direction; a.toast(Settings.direction === 0 ? 'Inhale mode' : 'Exhale mode'); }, { z: 1.1, size: 0.055 });
    this.lines = []; this.recT = 0; a.mon.resetSession();
  }
  tick(dt) {
    const m = this.app.mon, v = this.vals, ok = m.lastFvcMl > 1;
    v[0].set(f0(m.volumeMl) + ' mL'); v[1].set(f0(m.smoothFlow) + ' mL/s'); v[2].set(m.phase.toUpperCase());
    v[3].set(m.bpm > 0 ? m.bpm.toFixed(1) : '-'); v[4].set(f0(m.peakMl) + ' mL'); v[5].set(m.bestHold.toFixed(1) + ' s');
    v[6].set(ok ? f0(m.lastFvcMl) + ' mL' : '-'); v[7].set(ok ? f0(m.lastFev1Ml) + ' mL' : '-'); v[8].set(ok ? f0(m.lastFev1Ratio * 100) + ' %' : '-');
    const q = clamp(m.quality, 0, 1), w = Math.max(0.001, 0.8 * q);
    this.qual.setScale(w, 0.04, 1); this.qual.pos[0] = -1.7 + w / 2; this.qual.mat.u.uAspect = w / 0.04;
    this.recTx.set('REC ' + f0(this.lines.length / 10) + ' s');
    this.recT += dt;
    while (this.recT >= 0.1) {
      this.recT -= 0.1;
      this.lines.push([m.sessionTime.toFixed(2), m.raw.toFixed(4), f0(m.volumeMl), f0(m.smoothFlow), m.phase].join(','));
      if (this.lines.length > 36000) this.lines.shift();
    }
  }
  save() {
    const a = this.app, name = 'respiro_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.csv';
    try {
      const blob = new Blob(['time_s,raw,volume_ml,flow_ml_s,phase\n' + this.lines.join('\n')], { type: 'text/csv' });
      const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = name; document.body.appendChild(el); el.click(); el.remove();
      a.toast('Saved ' + name);
    } catch (e) { a.toast('Save failed'); }
  }
}

// ======================================================================= breath calibration
export class BreathCalibScreen extends Screen {
  enter() {
    const a = this.app, th = this.th;
    this.root.setPos(0, 0.05, -2.6); this.backdrop(0, 0.0, 3.3, 2.5);
    this.txt('BREATH CALIBRATION', 0, 1.0, 0.11, th.acc, 'center', true);
    this.title = this.txt('', 0, 0.62, 0.1, th.text, 'center', true);
    this.info = this.txt('', 0, 0.44, 0.05, th.dim);
    this.big = this.txt('', 0, 0.12, 0.3, [1, 1, 1, 0.9], 'center', true);
    this.live = this.txt('', 0, -0.2, 0.05, th.dim);
    this.glass(0, -0.34, 1.6, 0.05, 0.0, 0.9);
    this.bar = this.ui.panel(this.root, 0, -0.34, 0.01, 0.001, 0.05, th.good, th.good, th.good, 0.02, 0);
    this.main = this.btn('Start', 0, -0.6, 0.9, 0.26, () => this.next(), { accent: true, size: 0.07 });
    this.clear = this.btn('Clear saved', 0.75, -0.92, 0.8, 0.22, () => { Settings.calLo = null; Settings.calHi = null; a.toast('Calibration cleared'); }, { size: 0.055 });
    this.back(-0.95, -0.92);
    this.step = 0; this.t = 0; this.lo = null; this.hi = null; this.cap = null;
    this.setStep(0);
  }
  setStep(s) {
    this.step = s; this.t = 0; const m = this.app.mon;
    if (s === 0) { this.title.set('Two quick captures'); this.info.set(m.src.normalized ? 'Demo / touch / mic need no calibration - this is for the belt. You can still try it.' : 'We learn your belt\'s empty and full readings so 0-100% matches YOUR lungs.'); this.main.setText('Start'); }
    if (s === 1) { this.title.set('1. Breathe OUT fully'); this.info.set('Empty your lungs gently and hold it. Capturing...'); this.main.setText('...'); this.lo = Infinity; }
    if (s === 2) { this.title.set('2. Breathe IN fully'); this.info.set('Fill your lungs as deep as is comfortable. Capturing...'); this.main.setText('...'); this.hi = -Infinity; }
    if (s === 3) {
      const span = this.hi - this.lo, okc = span > 1e-6 && Number.isFinite(span);
      this.title.set(okc ? 'Captured' : 'No signal range'); this.big.set('');
      this.info.set(okc ? `Empty ${this.lo.toFixed(3)}   Full ${this.hi.toFixed(3)}   Range ${span.toFixed(3)}` : 'The reading did not change. Check the belt and try again.');
      this.main.setText(okc ? 'Save' : 'Retry');
    }
  }
  next() {
    const a = this.app;
    if (this.step === 0) this.setStep(1);
    else if (this.step === 3) {
      if (this.hi - this.lo > 1e-6) { Settings.calLo = this.lo; Settings.calHi = this.hi; a.toast('Calibration saved'); this.setStep(4); this.title.set('Saved'); this.info.set('Tubes now map 0-100% to your own range.'); this.main.setText('Done'); }
      else this.setStep(0);
    } else if (this.step === 4) a.show(new MenuScreen(a));
  }
  tick(dt) {
    const m = this.app.mon, raw = m.rawSmooth;
    this.live.set('live reading  ' + raw.toFixed(3));
    const w = Math.max(0.001, 1.6 * clamp(m.fill, 0, 1)); this.bar.setScale(w, 0.05, 1); this.bar.pos[0] = -0.8 + w / 2; this.bar.mat.u.uAspect = w / 0.05;
    if (this.step === 1 || this.step === 2) {
      this.t += dt; const D = 6;
      this.big.set(String(Math.max(0, Math.ceil(D - this.t))));
      if (this.t > 1.5) { if (this.step === 1) this.lo = Math.min(this.lo, raw); else this.hi = Math.max(this.hi, raw); }
      if (this.t >= D) { Audio.success(); this.setStep(this.step + 1); }
    }
  }
}

// ======================================================================= VR calibration suite
export class VrCalibScreen extends Screen {
  enter() {
    const a = this.app, th = this.th, r = a.r;
    this.root.setPos(0, 0.05, -2.4); this.backdrop(0, 0.0, 3.5, 2.5);
    // test pattern: straight lines should look straight through the lenses
    const cv = document.createElement('canvas'); cv.width = cv.height = 512; const g = cv.getContext('2d');
    g.fillStyle = 'rgba(5,10,20,0.85)'; g.fillRect(0, 0, 512, 512);
    g.strokeStyle = 'rgba(120,230,255,0.85)'; g.lineWidth = 2;
    for (let i = 0; i <= 16; i++) { const p = i * 32; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 512); g.moveTo(0, p); g.lineTo(512, p); g.stroke(); }
    g.lineWidth = 3; g.strokeStyle = '#ff9'; for (const rr of [64, 128, 192, 250]) { g.beginPath(); g.arc(256, 256, rr, 0, 7); g.stroke(); }
    g.strokeStyle = '#fff'; g.lineWidth = 4; g.strokeRect(2, 2, 508, 508); g.beginPath(); g.moveTo(256, 236); g.lineTo(256, 276); g.moveTo(236, 256); g.lineTo(276, 256); g.stroke();
    this.pat = r.texture(cv, { mip: true }); a.ui.owned.push(this.pat);
    const n = new Node(QUAD, new Material('tex', { blend: 'alpha', order: 3015, depthWrite: false, u: { uMap: this.pat, uColor: [1, 1, 1, 1], uIntensity: 1 } }));
    n.setPos(-0.75, 0.2, 0).setScale(1.5, 1.5, 1); this.root.add(n);
    this.txt('VR CALIBRATION', 0, 1.08, 0.1, th.acc, 'center', true);
    this.txt('Lines should look straight, circles round, centre cross single.', 0, 0.94, 0.04, th.dim);
    const rows = [
      ['IPD', () => (Settings.ipd * 1000).toFixed(0) + ' mm', d => { Settings.ipd = clamp(Settings.ipd + d * 0.001, 0.05, 0.078); }],
      ['Lens k1', () => Settings.k1.toFixed(2), d => { Settings.k1 = clamp(Settings.k1 + d * 0.02, 0, 1); }],
      ['Lens k2', () => Settings.k2.toFixed(2), d => { Settings.k2 = clamp(Settings.k2 + d * 0.05, 0, 1.2); }],
      ['Zoom', () => Settings.zoom.toFixed(2), d => { Settings.zoom = clamp(Settings.zoom + d * 0.02, 0.8, 1.4); }],
      ['Eye shift', () => (Settings.shift * 100).toFixed(1) + '%', d => { Settings.shift = clamp(Settings.shift + d * 0.005, -0.1, 0.1); }],
    ];
    this.vals = [];
    rows.forEach(([l, get, set], i) => {
      const y = 0.62 - i * 0.24;
      this.txt(l, 0.38, y, 0.055, th.text, 'left');
      const v = this.txt(get(), 1.0, y, 0.055, th.acc, 'center', true); this.vals.push([v, get]);
      this.btn('-', 0.78, y, 0.2, 0.2, () => set(-1), { size: 0.1 });
      this.btn('+', 1.3, y, 0.2, 0.2, () => set(1), { size: 0.1 });
    });
    this.btn('Re-centre', -0.55, -0.82, 0.8, 0.24, () => { a.rig.recenter(); a.toast('Re-centred'); }, { accent: true, size: 0.065 });
    this.btn('Reset lens', 0.4, -0.82, 0.8, 0.24, () => { Settings.ipd = 0.063; Settings.k1 = 0.34; Settings.k2 = 0.55; Settings.zoom = 1.15; Settings.shift = 0; }, { size: 0.06 });
    this.back(1.3, -0.82);
    this.txt('Lens and IPD apply in Cardboard mode. Keep your head still while re-centring.', 0, -1.0, 0.04, th.dim);
  }
  tick() { for (const [t, get] of this.vals) t.set(get()); }
}

// ======================================================================= settings
export class SettingsScreen extends Screen {
  constructor(app, page = 0) { super(app); this.page = page; }
  enter() {
    const a = this.app, th = this.th, srcs = ['demo', 'touch', 'mic', 'http', 'serial', 'ble', 'ws'];
    const names = { demo: 'Demo breathing', touch: 'Touch (hold = in)', mic: 'Microphone (blow)', http: 'Arduino Wi-Fi (HTTP)', serial: 'USB serial belt', ble: 'Bluetooth belt', ws: 'PC bridge (WebSocket)' };
    this.root.setPos(0, 0.05, -2.6); this.backdrop(0, 0.0, 3.3, 2.5);
    this.txt('SETTINGS', 0, 1.0, 0.11, th.acc, 'center', true);
    const cyc = (key, n, d) => { Settings[key] = (Settings[key] + d + n) % n; };
    const P = [[
      ['Mood', () => MOODS[Settings.mood].name, d => { cyc('mood', MOODS.length, d); a.applyMood(); a.show(new SettingsScreen(a, this.page)); }],
      ['Belt source', () => names[Settings.source], d => { const i = (srcs.indexOf(Settings.source) + d + srcs.length) % srcs.length; a.mon.setSource(srcs[i]); }],
      ['Spirometer mode', () => ['Cascade', 'Flow orbs'][Settings.mode], d => cyc('mode', 2, d)],
      ['Level', () => ['Easy', 'Normal', 'Hard'][Settings.level], d => cyc('level', 3, d)],
      ['Difficulty', () => Settings.difficulty.toFixed(1) + 'x', d => { Settings.difficulty = clamp(Math.round((Settings.difficulty + d * 0.1) * 10) / 10, 0.5, 1.5); }],
      ['Train', () => Settings.direction === 0 ? 'Inhale' : 'Exhale', d => cyc('direction', 2, d)],
      ['Belt polarity', () => Settings.invert ? 'Inverted' : 'Normal', () => { Settings.invert = !Settings.invert; }],
    ], [
      ['Capacity', () => Settings.capacityMl + ' mL', d => { Settings.capacityMl = clamp(Settings.capacityMl + d * 250, 1500, 6500); }],
      ['Hold goal', () => Settings.holdGoal + ' s', d => { Settings.holdGoal = clamp(Settings.holdGoal + d, 1, 10); }],
      ['Gaze select', () => Settings.dwell > 0 ? Settings.dwell.toFixed(1) + ' s' : 'off', d => { Settings.dwell = clamp(Math.round((Settings.dwell + d * 0.3) * 10) / 10, 0, 3); if (Settings.dwell < 0.6 && Settings.dwell > 0) Settings.dwell = d > 0 ? 0.6 : 0; }],
      ['Volume', () => f0(Settings.volume * 100) + '%', d => { Settings.volume = clamp(Math.round((Settings.volume + d * 0.1) * 10) / 10, 0, 1); Audio.applyLevels(); }],
      ['Ambience', () => Settings.ambience ? 'On' : 'Off', () => { Settings.ambience = Settings.ambience ? 0 : 1; Audio.applyLevels(); }],
      ['Music pad', () => Settings.music ? 'On' : 'Off', () => { Settings.music = Settings.music ? 0 : 1; Audio.applyLevels(); }],
      ['Guide tones', () => Settings.cues ? 'On' : 'Off', () => { Settings.cues = Settings.cues ? 0 : 1; Audio.applyLevels(); }],
    ]];
    this.vals = [];
    P[this.page].forEach(([l, get, set], i) => {
      const y = 0.74 - i * 0.235;
      this.txt(l, -1.3, y, 0.055, th.text, 'left');
      const v = this.txt(get(), 0.55, y, 0.055, th.acc, 'center', true); this.vals.push([v, get]);
      this.btn('<', 1.1, y, 0.2, 0.19, () => set(-1), { size: 0.09 });
      this.btn('>', 1.38, y, 0.2, 0.19, () => set(1), { size: 0.09 });
    });
    this.btn(`Page ${this.page + 1}/2`, 0.2, -0.92, 0.8, 0.22, () => a.show(new SettingsScreen(a, 1 - this.page)), { size: 0.06 });
    this.back(-0.95, -0.92);
    this.stat = this.txt('', 0.0, -1.1, 0.04, th.dim);
  }
  tick() {
    for (const [t, get] of this.vals) t.set(get());
    this.stat.set('Belt: ' + this.app.mon.label + ' (' + this.app.mon.status + ')   Bluetooth is connected from the start screen');
  }
}
