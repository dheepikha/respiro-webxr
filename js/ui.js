// World-space UI: canvas text planes, glass panels, gaze/tap buttons and the reticle.
import { Node, Material, Geo } from './gl.js';
import { mat4Invert, mat4Point, mat4Dir, lerp, clamp } from './math.js';
import { Settings } from './core.js';
import * as Audio from './audio.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const QUAD = Geo.quad(1, 1);

export class UI {
  constructor(renderer, rig) {
    this.r = renderer; this.rig = rig;
    this.owned = [];          // textures of the current screen (freed on reset)
    this.buttons = [];
    this.hover = null; this.dwell = 0; this.cool = 0; this.hitDist = 3;
    // reticle (head-following, only in gaze modes)
    this.reticle = new Node(QUAD, new Material('reticle', { blend: 'alpha', depthTest: false, depthWrite: false, order: 3100, u: { uProgress: 0 } }));
    this.reticle.visible = false;
  }

  reset() {
    for (const t of this.owned) this.r.deleteTexture(t);
    this.owned = []; this.buttons = []; this.hover = null; this.dwell = 0;
  }

  /** Text plane. h = font size in metres. Returns { node, set(str), color(c) }. */
  text(parent, str, x, y, z, h, color, align = 'center', bold = false, persistent = false) {
    h *= 1.15;                // slightly larger text reads better at phone-VR resolution
    const cv = document.createElement('canvas'), g = cv.getContext('2d');
    const PX = 64, font = (bold ? '700 ' : '500 ') + PX + 'px ' + FONT;
    const mat = new Material('tex', { blend: 'alpha', depthWrite: false, order: 3030, u: { uColor: color.slice(), uIntensity: 1 } });
    const node = new Node(QUAD, mat);
    const o = { node, str: null, align, set: null, color: null, tex: null };
    const draw = (s) => {
      g.font = font; const w = Math.max(8, Math.ceil(g.measureText(s).width) + 24), hh = Math.ceil(PX * 1.5);
      cv.width = w; cv.height = hh; g.font = font; g.textBaseline = 'middle'; g.textAlign = 'left';
      g.lineJoin = 'round'; g.lineWidth = 9; g.strokeStyle = 'rgba(0,12,24,0.78)'; g.strokeText(s, 12, hh / 2 + 2);   // dark outline keeps text readable on bright skies
      g.fillStyle = '#fff'; g.fillText(s, 12, hh / 2 + 2);
      const sc = h / PX;                    // metres per texel
      node.setScale(w * sc, hh * sc, 1);
      node.pos[0] = x + (align === 'left' ? w * sc / 2 - 12 * sc : align === 'right' ? -w * sc / 2 + 12 * sc : 0);
      if (!o.tex) { o.tex = this.r.texture(cv, { mip: true }); mat.u.uMap = o.tex; if (!persistent) this.owned.push(o.tex); }
      else this.r.refresh(o.tex);
    };
    o.set = (s) => { s = String(s); if (s === o.str) return; o.str = s; draw(s); };
    o.color = (c) => { mat.u.uColor = c.slice(); };
    node.pos[1] = y; node.pos[2] = z;
    o.set(str);
    parent.add(node);
    return o;
  }

  panel(parent, x, y, z, w, h, top, bottom, border, radiusM = 0.06, borderW = 0.012) {
    const mat = new Material('panel', {
      blend: 'alpha', depthWrite: false, order: 3020,
      u: { uTop: top, uBottom: bottom, uBorderColor: border, uRadius: Math.min(0.5, radiusM / h), uBorderW: borderW / h, uHover: 0, uProgress: 0, uAspect: w / h },
    });
    const n = new Node(QUAD, mat); n.setPos(x, y, z).setScale(w, h, 1); parent.add(n); return n;
  }

  /** Glass button. onClick fires on tap/click or gaze dwell. */
  button(parent, label, x, y, z, w, h, onClick, th, opts = {}) {
    const accent = !!opts.accent;
    const top = accent ? th.acc.map((v, i) => i < 3 ? v * 0.55 : 0.9) : [...th.panel.slice(0, 3).map(v => v * 1.6 + 0.03), 0.82];
    const bot = accent ? th.acc.map((v, i) => i < 3 ? v * 0.3 : 0.92) : [...th.panel.slice(0, 3), 0.9];
    const grp = new Node(); grp.setPos(x, y, z); parent.add(grp);
    const pn = this.panel(grp, 0, 0, 0, w, h, top, bot, th.acc, Math.min(0.08, h * 0.3), 0.01);
    const tx = this.text(grp, label, 0, 0, 0.004, opts.size || Math.min(h * 0.46, 0.1), th.text, 'center', true);
    const b = { grp, pn, tx, w, h, onClick, hover: 0, enabled: true, setText: s => tx.set(s) };
    this.buttons.push(b); return b;
  }

  /** Called once per frame (after scene.update). */
  update(dt, root) {
    const ray = this.rig.ray, gaze = this.rig.mode !== 'flat';
    let best = null, bd = 1e9;
    for (const b of this.buttons) {
      if (!b.enabled || !b.grp.parentVisible()) continue;
      const inv = mat4Invert(b.grp.world); if (!inv) continue;
      const o = mat4Point(inv, ray.o), d = mat4Dir(inv, ray.d);
      if (Math.abs(d[2]) < 1e-6) continue;
      const t = -o[2] / d[2]; if (t <= 0) continue;
      const px = o[0] + d[0] * t, py = o[1] + d[1] * t;
      if (Math.abs(px) <= b.w / 2 && Math.abs(py) <= b.h / 2 && t < bd) { bd = t; best = b; }
    }
    this.hitDist = best ? bd : 3.0;
    if (best !== this.hover) { this.hover = best; this.dwell = 0; if (best) Audio.tick(); }
    this.cool = Math.max(0, this.cool - dt);
    let fire = false;
    if (this.hover) {
      if (this.rig.takeSelect()) fire = true;
      else if (gaze && Settings.dwell > 0 && this.cool <= 0) { this.dwell += dt; if (this.dwell >= Settings.dwell) fire = true; }
    }
    for (const b of this.buttons) {
      const hv = b === this.hover ? 1 : 0;
      b.hover = lerp(b.hover, hv, Math.min(1, dt * 12));
      b.pn.mat.u.uHover = b.hover;
      b.pn.mat.u.uProgress = b === this.hover && gaze && Settings.dwell > 0 && this.cool <= 0 ? clamp(this.dwell / Settings.dwell, 0, 1) : 0;
      const s = 1 + 0.04 * b.hover; b.grp.setScale(s, s, s);
    }
    if (fire && this.hover) { const b = this.hover; this.dwell = 0; this.cool = 0.9; Audio.select(); b.onClick(); }

    // reticle follows the head, sits on whatever is being looked at
    const show = gaze;
    this.reticle.visible = show;
    if (show) {
      const dist = clamp(this.hitDist - 0.02, 0.8, 6), s = 0.035 * dist;
      this.reticle.pos = [ray.o[0] + ray.d[0] * dist, ray.o[1] + ray.d[1] * dist, ray.o[2] + ray.d[2] * dist];
      this.reticle.quat = this.rig.headQuat.slice(); this.reticle.setScale(s * 1.6, s * 1.6, 1);
      this.reticle.mat.u.uProgress = this.hover && Settings.dwell > 0 && this.cool <= 0 ? clamp(this.dwell / Settings.dwell, 0, 1) : 0;
    }
  }
}

// helper used for hit-testing: a node is clickable only if it and all its ancestors are visible
Node.prototype.parentVisible = function () { for (let n = this; n; n = n.parent) if (!n.visible) return false; return true; };
