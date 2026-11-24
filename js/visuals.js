// 3D content: sky/floor environment, sparks, shockwaves, the three-cylinder spirometer, lung hologram, waveform board.
import { Node, Material, Geo, PointCloud } from './gl.js';
import { clamp, lerp, qAxisAngle, qMul } from './math.js';
import { Settings } from './core.js';
import * as Audio from './audio.js';
import { Scenery } from './scenery.js';

const FLAT = qAxisAngle(1, 0, 0, -Math.PI / 2);        // quad facing +Z -> facing +Y
const mixA = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

function softTexture(r, kind) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d');
  if (kind === 'ring') {
    const gr = g.createRadialGradient(64, 64, 40, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  } else {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  return r.texture(cv);
}

// ======================================================================= environment
export class Environment {
  constructor(r, scene) {
    this.r = r; this.scene = scene; this.t = 0;
    this.cur = null; this.fill = 0;
    this.stageCenter = [0, 0, -3.2];
    this.sky = new Node(Geo.sphere(80, 48, 24), new Material('sky', { cull: 'front', order: 0, u: { uTop: [0, 0, 0], uBottom: [0, 0, 0], uAccent: [0, 0, 0], uStars: 1, uPulse: 0, uOcean: 0, uDay: 0, uClouds: 0, uSun: [0, 1, 0], uSunCol: [1, 1, 1] } }));
    this.floor = new Node(Geo.plane(120, 120), new Material('floor', { blend: 'add', order: 2900, u: { uColor: [0, 1, 1, 0.5], uCenter: [0, -3.2] } }));
    this.floor.setPos(0, -1.7, 0);
    this.floor.visible = false;          // neon grid is replaced by real landscapes
    scene.add(this.sky); scene.add(this.floor);
    this.scenery = new Scenery(scene, this.sky.mat.u); this.moodId = null;

    // shockwaves
    this.ringTex = softTexture(r, 'ring'); this.dotTex = softTexture(r, 'dot');
    this.waves = [];
    for (let i = 0; i < 6; i++) {
      const n = new Node(Geo.quad(1, 1), new Material('tex', { blend: 'add', order: 2910, depthWrite: false, u: { uMap: this.ringTex, uColor: [1, 1, 1, 0], uIntensity: 1 } }));
      n.quat = FLAT.slice(); n.visible = false; n.setPos(this.stageCenter[0], -1.68, this.stageCenter[2]); scene.add(n);
      this.waves.push({ n, t: 1, dur: 1, max: 6, col: [1, 1, 1] });
    }
    // sparks / motes
    this.N = 560; this.M = 160;
    this.pc = new PointCloud(this.N);
    this.p = { x: new Float32Array(this.N), y: new Float32Array(this.N), z: new Float32Array(this.N), vx: new Float32Array(this.N), vy: new Float32Array(this.N), vz: new Float32Array(this.N), life: new Float32Array(this.N), max: new Float32Array(this.N), col: new Float32Array(this.N * 3), size: new Float32Array(this.N) };
    for (let i = 0; i < this.M; i++) this._mote(i, true);
    const pn = new Node(); pn.points = this.pc; pn.pointMat = new Material('points', { blend: 'add', order: 3200, depthWrite: false }); scene.add(pn);
    this.nextBurst = this.M;
  }

  _mote(i, init) {
    const p = this.p, a = Math.random() * Math.PI * 2, d = 2 + Math.random() * 10;
    p.x[i] = Math.cos(a) * d; p.z[i] = Math.sin(a) * d - 1; p.y[i] = init ? -1.6 + Math.random() * 5 : -1.7;
    p.vx[i] = (Math.random() - 0.5) * 0.12; p.vy[i] = 0.06 + Math.random() * 0.12; p.vz[i] = (Math.random() - 0.5) * 0.12;
    p.life[i] = 1e9; p.size[i] = 0.03 + Math.random() * 0.05;
  }

  burst(pos, col, n = 60, speed = 2.5, life = 1.6, size = 0.12) {
    const p = this.p;
    for (let k = 0; k < n; k++) {
      const i = this.nextBurst; this.nextBurst = this.nextBurst + 1 >= this.N ? this.M : this.nextBurst + 1;
      const a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1), s = speed * (0.3 + Math.random() * 0.7);
      p.x[i] = pos[0]; p.y[i] = pos[1]; p.z[i] = pos[2];
      p.vx[i] = Math.sin(b) * Math.cos(a) * s; p.vy[i] = Math.cos(b) * s + 0.6; p.vz[i] = Math.sin(b) * Math.sin(a) * s;
      p.life[i] = p.max[i] = life * (0.5 + Math.random() * 0.5); p.size[i] = size * (0.5 + Math.random());
      p.col[i * 3] = col[0]; p.col[i * 3 + 1] = col[1]; p.col[i * 3 + 2] = col[2];
    }
  }
  shockwave(col, max = 8, dur = 2.5) {
    const w = this.waves.find(w => w.t >= w.dur) || this.waves[0];
    w.t = 0; w.dur = dur; w.max = max; w.col = col.slice(0, 3); w.n.visible = true;
  }

  /** Smoothly head toward the theme and pulse with the breath. */
  update(dt, th, fill) {
    this.t += dt;
    const target = { top: th.top, bottom: th.bottom, accent: th.accent, stars: th.stars, clouds: th.clouds, sunDir: th.sunDir, sunCol: th.sunCol };
    if (!this.cur) this.cur = JSON.parse(JSON.stringify(target));
    if (this.moodId !== th.id) { this.moodId = th.id; this.scenery.show(th); }
    const k = Math.min(1, dt * 1.2), c = this.cur;
    c.top = mixA(c.top, target.top, k); c.bottom = mixA(c.bottom, target.bottom, k); c.accent = mixA(c.accent, target.accent, k);
    c.sunDir = mixA(c.sunDir, target.sunDir, k); c.sunCol = mixA(c.sunCol, target.sunCol, k);
    c.stars = lerp(c.stars, target.stars, k); c.clouds = lerp(c.clouds, target.clouds, k); c.day = th.day;
    this.fill += (fill - this.fill) * Math.min(1, dt * 4);
    const u = this.sky.mat.u;
    u.uTop = c.top; u.uBottom = c.bottom; u.uAccent = c.accent; u.uStars = c.stars; u.uPulse = this.fill; u.uDay = c.day;
    u.uClouds = c.clouds; u.uSun = c.sunDir; u.uSunCol = c.sunCol; u.uOcean = 0;
    this.scenery.update(c);
    this.moteCol = c.day ? [1.0, 0.96, 0.8] : c.accent; this.moteA = th.moteA === undefined ? 0.5 : th.moteA;

    // waves
    for (const w of this.waves) {
      if (!w.n.visible) continue;
      w.t += dt; const f = w.t / w.dur;
      if (f >= 1) { w.n.visible = false; continue; }
      const s = 0.5 + f * w.max * 2;
      w.n.setScale(s, s, 1); w.n.u = { uColor: [w.col[0], w.col[1], w.col[2], (1 - f) * (1 - f) * 0.9] };
    }
    // particles
    const p = this.p, pc = this.pc;
    for (let i = 0; i < this.N; i++) {
      if (i >= this.M && p.life[i] <= 0) { pc.set(i, 0, -50, 0, 0, 0, 0, 0, 0); continue; }
      if (i < this.M) {
        p.x[i] += p.vx[i] * dt; p.y[i] += p.vy[i] * dt; p.z[i] += p.vz[i] * dt;
        if (p.y[i] > 4.5) this._mote(i, false);
        const tw = 0.4 + 0.3 * Math.sin(this.t * 1.7 + i);
        pc.set(i, p.x[i], p.y[i], p.z[i], this.moteCol[0], this.moteCol[1], this.moteCol[2], tw * (0.5 + this.fill * 0.7) * this.moteA * 2, p.size[i]);
      } else {
        p.life[i] -= dt; p.vy[i] -= 1.1 * dt;
        p.x[i] += p.vx[i] * dt; p.y[i] += p.vy[i] * dt; p.z[i] += p.vz[i] * dt;
        const a = clamp(p.life[i] / p.max[i], 0, 1);
        pc.set(i, p.x[i], p.y[i], p.z[i], p.col[i * 3], p.col[i * 3 + 1], p.col[i * 3 + 2], a, p.size[i]);
      }
    }
    pc.count = this.N;
  }
}

// ======================================================================= spirometer
const BASE_Y = -1.45, H = 2.0, TUBE_X = [-1.05, 0, 1.05];
export const NAMES = ['LOW', 'MID', 'HIGH'];
const FLOW_T = [450, 800, 1150];

export class Spirometer {
  constructor(r, parent, env, ui) {
    this.r = r; this.env = env; this.ui = ui;
    this.root = new Node(); this.root.setPos(...env.stageCenter); parent.add(this.root);
    this.mode = 0; this.levelMult = 1; this.highlight = -1; this.live = true; this.t = 0;
    this.level = [0, 0, 0]; this.holds = [0, 0, 0]; this.top = [false, false, false];
    this.smoothFlow = 0; this.onTop = null; this.ghost = null;
    this.tubes = [];
    const dark = (a, ord) => new Material('liquid', { blend: 'alpha', order: ord, u: { uColor: [0.02, 0.04, 0.07, 1], uColor2: [0.02, 0.04, 0.07, 1], uBaseY: -2, uHeight: 1, uGlow: 0.05, uAlpha: a, uFlow: 0 } });
    const plat = new Node(Geo.cylinder(1.9, 56, true), dark(0.36, 2930)); plat.setPos(0, -1.69, 0).setScale(1, 0.02, 1); this.root.add(plat);
    TUBE_X.forEach((x, i) => {
      const grp = new Node(); grp.setPos(x, 0, 0); this.root.add(grp);
      const glass = new Node(Geo.cylinder(0.38, 40, false), new Material('glass', { blend: 'add', cull: 'none', order: 3000, u: { uColor: [1, 1, 1, 1], uPower: 2.4, uIntensity: 0.9, uBase: 0.05 } }));
      glass.setPos(0, BASE_Y, 0).setScale(1, H, 1);
      const liquid = new Node(Geo.cylinder(0.34, 40, true), new Material('liquid', { blend: 'alpha', order: 2950, u: { uColor: [0, 0, 0, 1], uColor2: [1, 1, 1, 1], uBaseY: BASE_Y, uHeight: H, uGlow: 1.2, uAlpha: 0.72, uFlow: 0.3 } }));
      liquid.setPos(0, BASE_Y, 0).setScale(1, 0.001, 1);
      const base = new Node(Geo.cylinder(0.5, 40, true), new Material('glass', { blend: 'add', order: 2960, u: { uColor: [1, 1, 1, 1], uPower: 1.5, uIntensity: 0.4, uBase: 0.35 } }));
      base.setPos(0, BASE_Y - 0.08, 0).setScale(1, 0.08, 1);
      const marker = new Node(Geo.quad(1, 1), new Material('tex', { blend: 'add', order: 2970, depthWrite: false, u: { uMap: env.ringTex, uColor: [1, 1, 1, 0.5], uIntensity: 1 } }));
      marker.quat = FLAT.slice(); marker.setPos(0, BASE_Y + H, 0).setScale(1.0, 1.0, 1);
      const ball = new Node(Geo.sphere(0.17, 24, 14), new Material('liquid', { blend: 'alpha', order: 2980, u: { uColor: [1, 1, 1, 1], uColor2: [1, 1, 1, 1], uBaseY: BASE_Y, uHeight: H, uGlow: 1.7, uAlpha: 0.95, uFlow: 0 } }));
      ball.visible = false;
      const halo = new Node(Geo.quad(1, 1), new Material('tex', { blend: 'add', order: 2990, depthWrite: false, depthTest: false, u: { uMap: env.dotTex, uColor: [1, 1, 1, 0.6], uIntensity: 1 } }));
      halo.setScale(0.7); halo.visible = false;
      const back = new Node(Geo.cylinder(0.37, 40, true), dark(0.32, 2940)); back.setPos(0, BASE_Y, 0).setScale(1, H, 1);
      const ghost = new Node(Geo.sphere(0.2, 24, 14), new Material('glass', { blend: 'add', cull: 'none', order: 3005, depthTest: false, u: { uColor: [1, 1, 0.8, 1], uPower: 2.2, uIntensity: 1.3, uBase: 0.03 } }));
      ghost.visible = false; grp.add(ghost);
      grp.add(back); grp.add(base); grp.add(liquid); grp.add(marker); grp.add(ball); grp.add(halo); grp.add(glass);
      const lab = ui.text(grp, NAMES[i], 0, -1.62, 0.5, 0.075, [1, 1, 1, 1], 'center', true, true);
      lab.node.quat = FLAT.slice(); lab.node.quat = qMul(qAxisAngle(1, 0, 0, -1.1), [0, 0, 0, 1]);
      this.tubes.push({ grp, glass, liquid, base, marker, ball, halo, lab, ghost });
    });
    this.applyTheme(null);
  }

  thresholdOf(i) { return FLOW_T[i] * this.levelMult; }
  topOf(i) { const c = this.env.stageCenter; return [c[0] + TUBE_X[i], BASE_Y + H + 0.1, c[2]]; }
  resetHolds() { this.holds = [0, 0, 0]; this.top = [false, false, false]; }
  setVisible(v) { this.root.visible = v; }

  applyTheme(th) {
    if (!th) return;
    this.th = th;
    this.tubes.forEach((t, i) => {
      const c = th.cyl[i];
      t.glass.mat.u.uColor = [c[0] * 0.6 + 0.4, c[1] * 0.6 + 0.4, c[2] * 0.6 + 0.4, 1];
      t.base.mat.u.uColor = c;
      t.liquid.mat.u.uColor = [c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, 1]; t.liquid.mat.u.uColor2 = c;
      t.ball.mat.u.uColor = c; t.ball.mat.u.uColor2 = [1, 1, 1, 1];
      t.marker.mat.u.uColor = [c[0], c[1], c[2], 0.5]; t.halo.mat.u.uColor = [c[0], c[1], c[2], 0.6];
      t.lab.color(c);
    });
  }

  update(dt, mon) {
    if (!this.root.visible) return;
    this.t += dt;
    const fill = mon.driveFill, flow = mon.driveFlow;
    this.smoothFlow = flow;
    const k = clamp(0.75 + 0.15 * this.levelMult, 0.8, 0.98);
    for (let i = 0; i < 3; i++) {
      let tgt;
      if (this.mode === 0) tgt = clamp((fill - (i / 3) * k) / (k / 3), 0, 1);
      else tgt = clamp(flow / this.thresholdOf(i), 0, 1);
      if (!this.live) tgt = 0;
      this.level[i] += (tgt - this.level[i]) * Math.min(1, dt / 0.07);
      const t = this.tubes[i], L = this.level[i], hi = this.highlight === i;
      const ballMode = this.mode === 1;
      const y = BASE_Y + 0.17 + L * (H - 0.34);
      const liqH = ballMode ? Math.max(0.001, (y - BASE_Y) * 0.9) : Math.max(0.001, L * H);
      t.liquid.setScale(1, liqH, 1); t.liquid.mat.u.uAlpha = ballMode ? 0.35 : 0.72;
      t.ball.visible = ballMode; t.halo.visible = ballMode;
      if (ballMode) { t.ball.setPos(0, y, 0); t.halo.setPos(0, y, 0.2); t.halo.quat = this._facing(t.halo); t.halo.setScale(0.55 + 0.25 * L); }
      const pulse = hi ? 0.55 + 0.45 * Math.sin(this.t * 6) : 0;
      const s = 1 + (hi ? 0.18 + 0.1 * Math.sin(this.t * 6) : 0);
      t.marker.setScale(s * 1.05, s * 1.05, 1);
      t.marker.mat.u.uColor = [...this.th.cyl[i].slice(0, 3), hi ? 0.9 + pulse * 0.1 : 0.28];
      t.glass.mat.u.uIntensity = 0.9 + (hi ? 0.9 : 0) + L * 0.4;

      const gh = this.ghost && this.ghost[i] !== undefined;
      t.ghost.visible = !!gh;
      if (gh) t.ghost.setPos(0, BASE_Y + 0.17 + clamp(this.ghost[i], 0, 1) * (H - 0.34), 0);
      const full = L > 0.96;
      if (full && !this.top[i]) { this.top[i] = true; if (this.onTop) this.onTop(i); }
      if (!full && L < 0.85) this.top[i] = false;
      this.holds[i] = full ? this.holds[i] + dt : 0;
    }
  }
  _facing() { return [0, 0, 0, 1]; }
}

// ======================================================================= lung hologram
export class Lung {
  constructor(r, parent, env) {
    this.root = new Node(); this.root.setPos(3.2, -0.15, -3.0); parent.add(this.root);
    this.env = env; this.t = 0;
    const shell = () => new Material('glass', { blend: 'add', cull: 'none', order: 3000, u: { uColor: [0.4, 1, 1, 1], uPower: 1.8, uIntensity: 1.0, uBase: 0.07 } });
    const inner = () => new Material('liquid', { blend: 'alpha', order: 2950, u: { uColor: [0, 0.3, 0.4, 1], uColor2: [0.2, 1, 1, 1], uBaseY: -1, uHeight: 2, uGlow: 1.0, uAlpha: 0.28, uFlow: 0.1 } });
    this.lobes = [];
    for (const sx of [-1, 1]) {
      const g = new Node(); g.setPos(sx * 0.42, 0, 0); this.root.add(g);
      const a = new Node(Geo.sphere(0.5, 32, 20), shell()); const b = new Node(Geo.sphere(0.5, 24, 16), inner());
      a.setScale(0.8, 1.15, 0.62); b.setScale(0.7, 1.0, 0.52);
      g.add(b); g.add(a); this.lobes.push({ g, a, b });
    }
    this.trachea = new Node(Geo.cylinder(0.06, 16, false), shell()); this.trachea.setPos(0, 0.45, 0).setScale(1, 0.7, 1); this.root.add(this.trachea);
    this.label = null;
  }
  setVisible(v) { this.root.visible = v; }
  applyTheme(th) {
    for (const l of this.lobes) {
      l.a.mat.u.uColor = [th.accent[0] * 0.5 + 0.5, th.accent[1] * 0.5 + 0.5, th.accent[2] * 0.5 + 0.5, 1];
      l.b.mat.u.uColor2 = th.acc; l.b.mat.u.uColor = [th.accent[0] * 0.2, th.accent[1] * 0.2, th.accent[2] * 0.2, 1];
    }
    this.trachea.mat.u.uColor = [th.accent[0] * 0.5 + 0.5, th.accent[1] * 0.5 + 0.5, th.accent[2] * 0.5 + 0.5, 1];
  }
  update(dt, fill) {
    if (!this.root.visible) return;
    this.t += dt;
    const s = 0.78 + 0.4 * fill;
    this.root.quat = qAxisAngle(0, 1, 0, Math.sin(this.t * 0.3) * 0.5 - 0.6);
    for (const l of this.lobes) { l.g.setScale(s, s * 1.04, s); }
    this.lobes[0].b.mat.u.uAlpha = this.lobes[1].b.mat.u.uAlpha = 0.2 + 0.3 * fill;
  }
}

// ======================================================================= waveform board
export class Waveform {
  constructor(r, parent) {
    this.r = r; this.cv = document.createElement('canvas'); this.cv.width = 512; this.cv.height = 256; this.g = this.cv.getContext('2d');
    this.tex = r.texture(this.cv);
    this.root = new Node(); this.root.setPos(-3.2, 0, -3.0); this.root.quat = qAxisAngle(0, 1, 0, -0.6); parent.add(this.root);
    this.board = new Node(Geo.quad(2.4, 1.2), new Material('tex', { blend: 'alpha', order: 3010, depthWrite: false, u: { uMap: this.tex, uColor: [1, 1, 1, 1], uIntensity: 1 } }));
    this.root.add(this.board); this.acc = 0; this.th = null;
  }
  setVisible(v) { this.root.visible = v; }
  applyTheme(th) { this.th = th; }
  update(dt, mon) {
    if (!this.root.visible) return;
    this.acc += dt; if (this.acc < 1 / 15) return; this.acc = 0;
    const g = this.g, W = 512, Hh = 256, th = this.th; if (!th) return;
    const rgb = a => `rgb(${a.slice(0, 3).map(v => Math.round(clamp(v, 0, 1) * 255)).join(',')})`;
    g.clearRect(0, 0, W, Hh);
    g.fillStyle = 'rgba(6,12,22,0.62)'; g.beginPath(); g.roundRect(0, 0, W, Hh, 22); g.fill();
    g.strokeStyle = rgb(th.accent); g.globalAlpha = 0.5; g.lineWidth = 3; g.stroke(); g.globalAlpha = 1;
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(14, i * Hh / 4); g.lineTo(W - 14, i * Hh / 4); g.stroke(); }
    const h = mon.history.slice(-400), n = h.length; if (n < 2) return;
    const line = (idx, col, mid, amp) => {
      g.strokeStyle = col; g.lineWidth = 3; g.beginPath();
      for (let i = 0; i < n; i++) { const x = 14 + (i / 399) * (W - 28), y = mid - h[i][idx] * amp; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    };
    g.shadowColor = rgb(th.accent); g.shadowBlur = 8;
    line(0, rgb(th.accent), Hh - 22, Hh - 56);
    g.shadowColor = rgb(th.accent2); line(1, rgb(th.accent2), Hh * 0.5, 50);
    g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = '600 18px system-ui, sans-serif';
    g.fillText('VOLUME', 20, 26); g.fillStyle = rgb(th.accent2); g.fillText('FLOW', 100, 26);
    this.r.refresh(this.tex);
  }
}
