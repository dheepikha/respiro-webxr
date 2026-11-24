// Tiny dependency-free WebGL2 renderer: scene nodes, materials, geometry builders, particles,
// MSAA render targets and the Cardboard distortion pass. Premultiplied-alpha throughout.
import { mat4, mat4Mul, mat4FromTRS, mat4Invert } from './math.js';
import { PROGRAMS } from './shaders.js';

// ---------------------------------------------------------------- geometry builders
function finish(pos, nor, uv, idx) {
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
}
export const Geo = {
  /** Quad centred on origin in the XY plane, facing +Z. */
  quad(w = 1, h = 1) {
    const x = w / 2, y = h / 2;
    return finish([-x, -y, 0, x, -y, 0, x, y, 0, -x, y, 0], [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], [0, 0, 1, 0, 1, 1, 0, 1], [0, 1, 2, 0, 2, 3]);
  },
  /** Horizontal plane in XZ facing +Y. */
  plane(w, d) {
    const x = w / 2, z = d / 2;
    return finish([-x, 0, -z, x, 0, -z, x, 0, z, -x, 0, z], [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], [0, 2, 1, 0, 3, 2]);
  },
  /** Cylinder from y=0 to y=1 (scale Y to fill). */
  cylinder(r = 1, seg = 40, caps = true) {
    const pos = [], nor = [], uv = [], idx = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(c * r, 0, s * r, c * r, 1, s * r); nor.push(c, 0, s, c, 0, s); uv.push(i / seg, 0, i / seg, 1);
    }
    for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    if (caps) {
      const base = pos.length / 3;
      pos.push(0, 1, 0); nor.push(0, 1, 0); uv.push(0.5, 0.5);
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        pos.push(Math.cos(a) * r, 1, Math.sin(a) * r); nor.push(0, 1, 0); uv.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
      }
      for (let i = 0; i < seg; i++) idx.push(base, base + 2 + i, base + 1 + i);
    }
    return finish(pos, nor, uv, idx);
  },
  sphere(r = 1, wSeg = 32, hSeg = 20) {
    const pos = [], nor = [], uv = [], idx = [];
    for (let y = 0; y <= hSeg; y++) {
      const v = y / hSeg, th = v * Math.PI;
      for (let x = 0; x <= wSeg; x++) {
        const u = x / wSeg, ph = u * Math.PI * 2;
        const nx = Math.cos(ph) * Math.sin(th), ny = Math.cos(th), nz = Math.sin(ph) * Math.sin(th);
        pos.push(nx * r, ny * r, nz * r); nor.push(nx, ny, nz); uv.push(u, 1 - v);
      }
    }
    for (let y = 0; y < hSeg; y++) for (let x = 0; x < wSeg; x++) {
      const a = y * (wSeg + 1) + x, b = a + wSeg + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    return finish(pos, nor, uv, idx);
  },
  /** Flat ring in the XY plane. */
  ring(r0, r1, seg = 64) {
    const pos = [], nor = [], uv = [], idx = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(c * r0, s * r0, 0, c * r1, s * r1, 0); nor.push(0, 0, 1, 0, 0, 1); uv.push(i / seg, 0, i / seg, 1);
    }
    for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    return finish(pos, nor, uv, idx);
  },
};

// ---------------------------------------------------------------- scene graph
export class Material {
  constructor(prog, opts = {}) {
    this.prog = prog;
    this.u = opts.u || {};          // uniform values: number | array | Texture
    this.blend = opts.blend || 'none'; // 'none' | 'alpha' | 'add'
    this.depthTest = opts.depthTest !== false;
    this.depthWrite = opts.depthWrite !== undefined ? opts.depthWrite : this.blend === 'none';
    this.cull = opts.cull || 'back';   // 'back' | 'front' | 'none'
    this.order = opts.order !== undefined ? opts.order : (this.blend === 'none' ? 1000 : 3000);
  }
}

let _id = 0;
export class Node {
  constructor(geo = null, mat = null) {
    this.id = ++_id;
    this.geo = geo; this.mat = mat;
    this.pos = [0, 0, 0]; this.quat = [0, 0, 0, 1]; this.scale = [1, 1, 1];
    this.parent = null; this.children = [];
    this.visible = true;
    this.world = mat4();
    this.renderOrder = 0;
    this.points = null; // PointCloud
  }
  add(c) { if (c.parent) c.parent.remove(c); c.parent = this; this.children.push(c); return c; }
  remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; }
  setPos(x, y, z) { this.pos[0] = x; this.pos[1] = y; this.pos[2] = z; return this; }
  setScale(x, y, z) { this.scale[0] = x; this.scale[1] = y === undefined ? x : y; this.scale[2] = z === undefined ? x : z; return this; }
  update(parentWorld) {
    mat4FromTRS(this.pos, this.quat, this.scale, this.world);
    if (parentWorld) mat4Mul(parentWorld, this.world, this.world);
    for (const c of this.children) c.update(this.world);
  }
  worldPos() { return [this.world[12], this.world[13], this.world[14]]; }
}

/** Dynamic additive point sprites. set(i, x,y,z, r,g,b,a, size) then upload(count). */
export class PointCloud {
  constructor(max) {
    this.max = max; this.count = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vao = null;
  }
  set(i, x, y, z, r, g, b, a, s) {
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a; this.size[i] = s;
  }
}

// ---------------------------------------------------------------- render target (MSAA + resolve)
export class RenderTarget {
  constructor(gl, w, h, samples = 4) {
    this.gl = gl; this.w = w; this.h = h;
    const maxS = gl.getParameter(gl.MAX_SAMPLES);
    this.samples = Math.min(samples, maxS);
    this.msaa = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaa);
    this.cRb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.cRb);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA8, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.cRb);
    this.dRb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.dRb);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.dRb);
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.resolve = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolve);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  finish() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaa);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolve);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  dispose() {
    const gl = this.gl;
    gl.deleteFramebuffer(this.msaa); gl.deleteFramebuffer(this.resolve);
    gl.deleteRenderbuffer(this.cRb); gl.deleteRenderbuffer(this.dRb); gl.deleteTexture(this.tex);
  }
}

// ---------------------------------------------------------------- renderer
export class Renderer {
  constructor(canvas, opts = {}) {
    const attrs = { antialias: true, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve, xrCompatible: !!opts.xr };
    const gl = canvas.getContext('webgl2', attrs);
    if (!gl) throw new Error('WebGL2 is not available on this browser.');
    this.gl = gl; this.canvas = canvas;
    this.progs = {}; this.time = 0;
    this._geoCache = new WeakMap();
    this.drawCalls = 0;
    // fullscreen quad for the distortion pass
    this._fsGeo = this.upload(Geo.quad(2, 2));
    this.targets = null;
  }

  // ---- resources
  upload(g) {
    const gl = this.gl;
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const mk = (data, loc, size) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    mk(g.pos, 0, 3); mk(g.nor, 1, 3); mk(g.uv, 2, 2);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: g.idx.length };
  }
  /** Geometry -> GPU mesh (cached per geometry object). */
  mesh(g) { let m = this._geoCache.get(g); if (!m) { m = this.upload(g); this._geoCache.set(g, m); } return m; }

  program(name) {
    if (this.progs[name]) return this.progs[name];
    const gl = this.gl, src = PROGRAMS[name];
    if (!src) throw new Error('Unknown program ' + name);
    const sh = (type, code) => {
      const s = gl.createShader(type); gl.shaderSource(s, code); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(name + ' shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, src.vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, src.fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ' link: ' + gl.getProgramInfoLog(p));
    const rec = { p, loc: {} };
    this.progs[name] = rec; return rec;
  }
  _loc(rec, name) {
    if (!(name in rec.loc)) rec.loc[name] = this.gl.getUniformLocation(rec.p, name);
    return rec.loc[name];
  }
  _set(rec, name, v, unit) {
    const gl = this.gl, l = this._loc(rec, name);
    if (l === null) return unit;
    if (typeof v === 'number') gl.uniform1f(l, v);
    else if (typeof v === 'boolean') gl.uniform1f(l, v ? 1 : 0);
    else if (v && v.isTexture) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v.tex); gl.uniform1i(l, unit); return unit + 1; }
    else if (v.length === 2) gl.uniform2fv(l, v);
    else if (v.length === 3) gl.uniform3fv(l, v);
    else if (v.length === 4) gl.uniform4fv(l, v);
    else if (v.length === 16) gl.uniformMatrix4fv(l, false, v);
    return unit;
  }

  /** Texture from a canvas / image. Premultiplied alpha. */
  texture(src, opts = {}) {
    const gl = this.gl, tex = gl.createTexture();
    const t = { isTexture: true, tex, src, w: src.width, h: src.height, mip: !!opts.mip };
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (opts.mip) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  /** Re-upload a canvas texture after its canvas was redrawn. */
  refresh(t) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (t.mip) gl.generateMipmap(gl.TEXTURE_2D);
    t.w = t.src.width; t.h = t.src.height;
  }
  deleteTexture(t) { if (t && t.tex) { this.gl.deleteTexture(t.tex); t.tex = null; } }

  // ---- draw state
  _state(m) {
    const gl = this.gl;
    if (m.depthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
    gl.depthMask(!!m.depthWrite);
    if (m.blend === 'none') gl.disable(gl.BLEND);
    else { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, m.blend === 'add' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA); }
    if (m.cull === 'none') gl.disable(gl.CULL_FACE);
    else { gl.enable(gl.CULL_FACE); gl.cullFace(m.cull === 'front' ? gl.FRONT : gl.BACK); }
  }

  _collect(node, list, camPosFn) {
    if (!node.visible) return;
    if ((node.geo && node.mat) || node.points) list.push(node);
    for (const c of node.children) this._collect(c, list);
  }

  /**
   * Draw `scene` once per view. view = { view: Float32Array, proj: Float32Array, camPos:[x,y,z],
   * vp:{x,y,w,h} }. fbo = framebuffer (null = canvas). Clears each view's viewport.
   */
  drawScene(scene, views, fbo, clearColor = [0, 0, 0, 1]) {
    const gl = this.gl;
    scene.update(null);
    const list = []; this._collect(scene, list);
    this.drawCalls = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    for (const v of views) {
      gl.enable(gl.SCISSOR_TEST);
      gl.viewport(v.vp.x, v.vp.y, v.vp.w, v.vp.h); gl.scissor(v.vp.x, v.vp.y, v.vp.w, v.vp.h);
      gl.depthMask(true); gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.SCISSOR_TEST);
      // sort: material order, then renderOrder, then back-to-front for blended
      const cp = v.camPos;
      const keyed = list.map(n => {
        const m = n.mat || n.pointMat;
        const dx = n.world[12] - cp[0], dy = n.world[13] - cp[1], dz = n.world[14] - cp[2];
        return { n, m, o: m.order, r: n.renderOrder, d: dx * dx + dy * dy + dz * dz };
      });
      keyed.sort((a, b) => a.o - b.o || a.r - b.r || (a.m.blend === 'none' ? a.d - b.d : b.d - a.d));
      for (const k of keyed) this._draw(k.n, k.m, v);
    }
    gl.bindVertexArray(null);
  }

  _draw(n, m, v) {
    const gl = this.gl;
    this._state(m);
    const rec = this.program(m.prog);
    gl.useProgram(rec.p);
    let unit = 0;
    this._set(rec, 'uView', v.view, 0); this._set(rec, 'uProj', v.proj, 0);
    this._set(rec, 'uCamPos', v.camPos, 0); this._set(rec, 'uTime', this.time, 0);
    if (n.points) {
      const pc = n.points;
      if (!pc.vao) {
        pc.vao = gl.createVertexArray(); gl.bindVertexArray(pc.vao);
        pc.bufs = [gl.createBuffer(), gl.createBuffer(), gl.createBuffer()];
        gl.bindBuffer(gl.ARRAY_BUFFER, pc.bufs[0]); gl.bufferData(gl.ARRAY_BUFFER, pc.pos.byteLength, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, pc.bufs[1]); gl.bufferData(gl.ARRAY_BUFFER, pc.col.byteLength, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, pc.bufs[2]); gl.bufferData(gl.ARRAY_BUFFER, pc.size.byteLength, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
      }
      gl.bindVertexArray(pc.vao);
      // upload once per frame (first view); cheap for a few hundred points
      if (pc._frame !== this._frame) {
        pc._frame = this._frame;
        gl.bindBuffer(gl.ARRAY_BUFFER, pc.bufs[0]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pc.pos.subarray(0, pc.count * 3));
        gl.bindBuffer(gl.ARRAY_BUFFER, pc.bufs[1]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pc.col.subarray(0, pc.count * 4));
        gl.bindBuffer(gl.ARRAY_BUFFER, pc.bufs[2]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pc.size.subarray(0, pc.count));
      }
      this._set(rec, 'uScale', v.pointScale || 600, 0);
      gl.drawArrays(gl.POINTS, 0, pc.count); this.drawCalls++;
      return;
    }
    this._set(rec, 'uModel', n.world, 0);
    for (const k in m.u) unit = this._set(rec, k, m.u[k], unit);
    if (n.u) for (const k in n.u) unit = this._set(rec, k, n.u[k], unit);   // per-node overrides
    const mesh = this.mesh(n.geo);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0); this.drawCalls++;
  }

  beginFrame(t) { this.time = t; this._frame = (this._frame || 0) + 1; }

  // ---- Cardboard stereo (flat canvas, two eyes, lens distortion)
  /** Make sure the two eye targets exist for the current canvas size. */
  ensureTargets(eyeW, eyeH, samples) {
    if (this.targets && this.targets[0].w === eyeW && this.targets[0].h === eyeH) return;
    if (this.targets) this.targets.forEach(t => t.dispose());
    this.targets = [new RenderTarget(this.gl, eyeW, eyeH, samples), new RenderTarget(this.gl, eyeW, eyeH, samples)];
  }
  /** Draw a distortion pass for an eye texture into viewport vp of the canvas. */
  distortPass(tex, vp, params) {
    const gl = this.gl, rec = this.program('distort');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(vp.x, vp.y, vp.w, vp.h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.depthMask(false);
    gl.useProgram(rec.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(this._loc(rec, 'uMap'), 0);
    for (const k in params) this._set(rec, k, params[k], 1);
    gl.bindVertexArray(this._fsGeo.vao);
    gl.drawElements(gl.TRIANGLES, this._fsGeo.count, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }
  clearCanvas(w, h, color = [0, 0, 0, 1]) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h); gl.disable(gl.SCISSOR_TEST); gl.depthMask(true);
    gl.clearColor(color[0], color[1], color[2], color[3]); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }
}

/** Build view/proj for a head pose: headWorld = TRS of the head, eyeOffsetX in metres (+right). */
export function viewFromPose(headWorld, eyeOffsetX = 0) {
  const w = new Float32Array(headWorld);
  w[12] += w[0] * eyeOffsetX; w[13] += w[1] * eyeOffsetX; w[14] += w[2] * eyeOffsetX;
  return { view: mat4Invert(w) || mat4(), camPos: [w[12], w[13], w[14]] };
}
