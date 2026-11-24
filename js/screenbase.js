// Base class for every VR page.
import { Node, Material, Geo } from './gl.js';
export class Screen {
  constructor(app) { this.app = app; this.th = app.th; this.root = new Node(); this.stage = false; this.lungWave = false; }
  get ui() { return this.app.ui; }
  txt(s, x, y, h, col, align = 'center', bold = false, z = 0) { return this.ui.text(this.root, s, x, y, z, h, col || this.th.text, align, bold); }
  btn(label, x, y, w, h, fn, opts = {}) { return this.ui.button(this.root, label, x, y, opts.z || 0, w, h, fn, this.th, opts); }
  glass(x, y, w, h, z = -0.02, a = 0.82) {
    const t = this.th.panel.slice(0, 3).map(v => v * 1.5 + 0.02), b = this.th.panel.slice(0, 3);
    return this.ui.panel(this.root, x, y, z, w, h, [...t, a], [...b, a + 0.06], this.th.acc, 0.07, 0.012);
  }
  /** Dark glass behind a page's text so it stays readable on bright skies. */
  backdrop(x, y, w, h, z = -0.06) { return this.glass(x, y, w, h, z, 0.55); }
  back(x = -0.95, y = -0.82, z = 0) { return this.btn('< MENU', x, y, 0.8, 0.24, () => this.app.home(), { z, size: 0.07 }); }
  /** Canvas-drawn board (charts, games). Returns { cv, g, node, refresh() }. wM,hM metres; pw,ph pixels. */
  board(wM, hM, pw, ph, x = 0, y = 0, z = 0) {
    const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph;
    const tex = this.app.r.texture(cv); this.ui.owned.push(tex);
    const node = new Node(Geo.quad(wM, hM), new Material('tex', { blend: 'alpha', order: 3010, depthWrite: false, u: { uMap: tex, uColor: [1, 1, 1, 1], uIntensity: 1 } }));
    node.setPos(x, y, z); this.root.add(node);
    return { cv, g: cv.getContext('2d'), node, refresh: () => this.app.r.refresh(tex) };
  }
  enter() {} tick() {} exit() {}
}
