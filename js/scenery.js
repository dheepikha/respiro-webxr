// Procedural landscapes (ground, lakes/sea, hills, forests, rain) built once per mood and toggled on demand.
import { Node, Material, Geo } from './gl.js';

const GROUND_Y = -1.7;
const rng = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

/** Merge many transformed geometries into one (so a whole forest is a single draw call). */
function bake(parts) {
  const pos = [], nor = [], uv = [], idx = [];
  for (const p of parts) {
    const g = p.g, base = pos.length / 3, c = Math.cos(p.rot || 0), s = Math.sin(p.rot || 0), sc = p.scale || [1, 1, 1];
    for (let i = 0; i < g.pos.length; i += 3) {
      const x = g.pos[i] * sc[0], y = g.pos[i + 1] * sc[1], z = g.pos[i + 2] * sc[2];
      pos.push(x * c + z * s + p.at[0], y + p.at[1], -x * s + z * c + p.at[2]);
      const nx = g.nor[i], nz = g.nor[i + 2];
      nor.push(nx * c + nz * s, g.nor[i + 1], -nx * s + nz * c);
      uv.push(p.tag, 0);
    }
    for (const k of g.idx) idx.push(base + k);
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
}

function cone(r, h, seg = 8) {
  const pos = [], nor = [], uv = [], idx = [], k = r / Math.hypot(r, h);
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
    pos.push(cx * r, 0, cz * r, 0, h, 0);
    const n = [cx * (1 - k * 0.3), k * 0.9, cz * (1 - k * 0.3)];
    nor.push(...n, ...n); uv.push(0, 0, 0, 0);
  }
  for (let i = 0; i < seg; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1);
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
}

const TRUNK = Geo.cylinder(0.14, 6, false), CONE = cone(1, 1.5, 8), BLOB = Geo.sphere(1, 8, 6);

function forest(kind, n, rmin, rmax, seed) {
  const R = rng(seed), parts = [];
  for (let i = 0; i < n; i++) {
    let x, z, tries = 0;
    do {                                   // keep the area around the stage and menus clear
      const a = R() * Math.PI * 2, d = rmin + Math.sqrt(R()) * (rmax - rmin);
      x = Math.cos(a) * d; z = Math.sin(a) * d - 1; tries++;
    } while (tries < 20 && Math.abs(x) < 6 && z > -8 && z < 2);
    const s = 0.8 + R() * 0.9, rot = R() * 6.28, broad = kind === 'broad' || (kind === 'mixed' && R() < 0.4);
    if (!broad) {
      parts.push({ g: TRUNK, at: [x, GROUND_Y, z], scale: [1, 0.9 * s, 1], tag: 0, rot });
      for (let k = 0; k < 3; k++) parts.push({ g: CONE, at: [x, GROUND_Y + (1.0 + k * 0.95) * s, z], scale: [(1.25 - k * 0.3) * s, s, (1.25 - k * 0.3) * s], tag: 1, rot });
    } else {
      parts.push({ g: TRUNK, at: [x, GROUND_Y, z], scale: [1.2, 0.55 * s, 1.2], tag: 0, rot });
      for (const [ox, oy, oz, r] of [[0, 3.6, 0, 1.5], [0.9, 3.1, 0.3, 1.1], [-0.8, 3.2, -0.4, 1.2]])
        parts.push({ g: BLOB, at: [x + ox * s, GROUND_Y + oy * s * 0.8, z + oz * s], scale: [r * s, r * s * 0.85, r * s], tag: 1, rot });
    }
  }
  return bake(parts);
}

function hillRing(radius, hMin, hMax, seed) {
  const N = 120, pos = [], nor = [], uv = [], idx = [], ph = seed * 1.7;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const w = (Math.sin(a * 3 + ph) + 0.6 * Math.sin(a * 7 + ph * 2) + 0.35 * Math.sin(a * 13 + ph * 3) + 1.95) / 3.9;
    const h = hMin + (hMax - hMin) * w, x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    pos.push(x, GROUND_Y - 1, z, x * 0.97, GROUND_Y + h, z * 0.97);
    nor.push(-Math.cos(a), 0.4, -Math.sin(a), -Math.cos(a), 0.7, -Math.sin(a)); uv.push(1, 0, 1, 1);
  }
  for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
}

function rainGeo(n, seed, radius = 14) {
  const R = rng(seed), pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, d = Math.sqrt(R()) * radius, x = Math.cos(a) * d, z = Math.sin(a) * d, y = R() * 12, ph = R();
    for (const plane of [0, 1]) {
      const b = pos.length / 3;
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { pos.push(x, y, z); nor.push(ph, plane, 0); uv.push(u, v); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
}

export class Scenery {
  /** skyU = the sky material's uniform object (shared so water can reflect exactly what you see). */
  constructor(scene, skyU) {
    this.scene = scene; this.skyU = skyU; this.groups = {}; this.cur = null; this.fogMats = [];
  }

  _build(mood) {
    const sc = mood.scene, g = new Node(); g.visible = false; this.scene.add(g);
    const fogMats = [];
    const fog = u => { const m = u; fogMats.push(m); return m; };
    if (sc.ground) {
      const m = new Material('ground', { order: 100, u: { uColA: sc.ground.a, uColB: sc.ground.b, uFogCol: [0, 0, 0], uFogD: sc.fogD } });
      fogMats.push(m); const n = new Node(Geo.plane(500, 500), m); n.setPos(0, GROUND_Y, 0); g.add(n);
    }
    if (sc.water) {
      const w = sc.water, u = Object.assign(this.skyU, {});          // shared sky uniforms
      const m = new Material('water', { order: 120, u });
      Object.assign(u, { uDeep: w.deep, uWave: w.wave, uRain: w.rain ? 1 : 0, uFogD: sc.fogD });
      m.u = this.skyU;   // keep the shared object so sky changes reach the water at once
      const geo = w.kind === 'full' ? Geo.plane(900, 900) : Geo.cylinder(w.r || 34, 56, true);
      const n = new Node(geo, m);
      if (w.kind === 'full') n.setPos(0, GROUND_Y - 0.15, 0); else n.setPos(w.at ? w.at[0] : 0, GROUND_Y + 0.04, w.at ? w.at[1] : -46).setScale(1, 0.001, 1);
      n.waterMat = m; g.add(n); this.water = this.water || [];
      g.waterNode = n; g.waterCfg = w;
    }
    if (sc.hills) sc.hills.forEach((h, i) => {
      const m = new Material('prop', { order: 150 + i, cull: 'none', u: { uCol: h.col, uTrunk: h.col, uSun: [0, 1, 0], uFogCol: [0, 0, 0], uFogD: sc.fogD * (h.fogMul || 1), uAmb: 0.6 } });
      fogMats.push(m); g.add(new Node(hillRing(h.r, h.h[0], h.h[1], 3 + i * 5), m));
    });
    if (sc.trees) {
      const t = sc.trees, m = new Material('prop', { order: 200, u: { uCol: t.col, uTrunk: t.trunk, uSun: [0, 1, 0], uFogCol: [0, 0, 0], uFogD: sc.fogD, uAmb: sc.amb || 0.45 } });
      fogMats.push(m); g.add(new Node(forest(t.kind, t.n, t.rmin, t.rmax, 11 + t.n), m));
    }
    if (sc.rain) {
      const m = new Material('rain', { blend: 'alpha', order: 3050, depthWrite: false, cull: 'none', u: {} });
      const n = new Node(rainGeo(sc.rain, 5), m); g.add(n);
    }
    g.fogMats = fogMats;
    return g;
  }

  /** Show the scenery of this mood (building it the first time). */
  show(mood) {
    if (this.cur) this.cur.visible = false;
    const id = mood.id;
    if (!this.groups[id]) this.groups[id] = this._build(mood);
    this.cur = this.groups[id]; this.cur.visible = true; this.mood = mood;
    // the shared water uniforms depend on the active mood
    const w = this.cur.waterCfg;
    if (w) Object.assign(this.skyU, { uDeep: w.deep, uWave: w.wave, uRain: w.rain ? 1 : 0, uFogD: mood.scene.fogD });
  }

  /** Per-frame: push fog colour and sun direction into the lit materials. */
  update(cur) {
    if (!this.cur) return;
    const fogCol = cur.bottom, sun = cur.sunDir;
    for (const m of this.cur.fogMats) {
      if ('uFogCol' in m.u) m.u.uFogCol = fogCol;
      if ('uSun' in m.u) m.u.uSun = sun;
    }
  }
}
