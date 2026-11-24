// Head pose + presentation: flat preview, Cardboard-style stereo (DeviceOrientation + lens distortion) or real WebXR.
import { DEG, clamp, qMul, qAxisAngle, qFromEulerYXZ, qRotate, mat4FromTRS, mat4Perspective, mat4Invert } from './math.js';
import { viewFromPose } from './gl.js';
import { Settings } from './core.js';

export class Rig {
  constructor(renderer, canvas, container) {
    this.r = renderer; this.canvas = canvas; this.container = container;
    this.mode = 'flat';
    this.headPos = [0, 0, 0]; this.headQuat = [0, 0, 0, 1];
    this.ray = { o: [0, 0, 0], d: [0, 0, -1] };
    this._select = 0;
    this.yaw = 0; this.pitch = 0;               // flat-preview look angles
    this.devQuat = [0, 0, 0, 1]; this.hasDevice = false; this.yawOff = [0, 0, 0, 1];
    this.pointer = { x: 0.5, y: 0.5, active: false };
    this.onExit = null;
    this.xr = null; this.xrOk = false;
    this.fovFlat = 70 * DEG;
    this._bindInput();
    if (navigator.xr && navigator.xr.isSessionSupported) navigator.xr.isSessionSupported('immersive-vr').then(ok => { this.xrOk = ok; }).catch(() => {});
  }

  /** A tap stays valid for 250 ms so the hover (computed next frame) can pick it up. */
  takeSelect() { const ok = this._select && performance.now() - this._select < 250; if (ok) this._select = 0; return !!ok; }

  // ---------------------------------------------------------------- input
  _bindInput() {
    const cv = this.canvas; let drag = null;
    cv.addEventListener('pointerdown', e => {
      if (this.mode === 'xr') return;
      drag = { x: e.clientX, y: e.clientY, moved: false, yaw: this.yaw, pitch: this.pitch };
      this._setPointer(e);
    });
    cv.addEventListener('pointermove', e => {
      this._setPointer(e);
      if (drag && this.mode === 'flat' && e.buttons) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.hypot(dx, dy) > 6) drag.moved = true;
        if (drag.moved) { this.yaw = drag.yaw - dx * 0.005; this.pitch = clamp(drag.pitch - dy * 0.005, -1.4, 1.4); }
      }
    });
    const up = e => {
      if (drag && !drag.moved && this.mode !== 'xr') { this._setPointer(e); this._select = performance.now(); }
      drag = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', () => { drag = null; });
    addEventListener('deviceorientation', e => this._onOrient(e));
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && this.mode === 'cardboard') this.exit(); });
  }
  _setPointer(e) {
    const rc = this.canvas.getBoundingClientRect();
    this.pointer.x = (e.clientX - rc.left) / rc.width; this.pointer.y = (e.clientY - rc.top) / rc.height; this.pointer.active = true;
  }
  _onOrient(e) {
    if (e.alpha === null || e.alpha === undefined) return;
    const orient = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * DEG;
    let q = qFromEulerYXZ(e.beta * DEG, e.alpha * DEG, -e.gamma * DEG);
    q = qMul(q, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    q = qMul(q, qAxisAngle(0, 0, 1, -orient));
    this.devQuat = q; this.hasDevice = true;
  }

  recenter() {
    if (this.mode === 'cardboard') {
      const f = qRotate(this.devQuat, [0, 0, -1]);
      this.yawOff = qAxisAngle(0, 1, 0, -Math.atan2(-f[0], -f[2]));
    } else if (this.mode === 'xr' && this._lastViewer) {
      const q = this._lastViewer.q, p = this._lastViewer.p, f = qRotate(q, [0, 0, -1]), yaw = Math.atan2(-f[0], -f[2]);
      try {
        this.refSpace = this.refSpace.getOffsetReferenceSpace(new XRRigidTransform({ x: p[0], y: 0, z: p[2] }, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }));
      } catch (e) { /* ignore */ }
    } else { this.yaw = 0; this.pitch = 0; }
  }

  // ---------------------------------------------------------------- entering / leaving
  async startFlat() { this.mode = 'flat'; this.recenter(); }

  async startCardboard() {
    // iOS needs an explicit permission prompt for motion sensors
    try {
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') await DeviceOrientationEvent.requestPermission();
    } catch (e) { /* user declined: gaze falls back to drag */ }
    try { await this.container.requestFullscreen({ navigationUI: 'hide' }); } catch (e) { /* not fatal */ }
    try { await screen.orientation.lock('landscape'); } catch (e) { /* not fatal */ }
    try { this.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* not fatal */ }
    this.mode = 'cardboard';
    setTimeout(() => this.recenter(), 600);
  }

  async startXR() {
    if (!navigator.xr) throw new Error('WebXR is not available in this browser.');
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    const gl = this.r.gl;
    await gl.makeXRCompatible();
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl, { antialias: true, alpha: false }) });
    this.refSpace = await session.requestReferenceSpace('local');
    this.xr = session; this.mode = 'xr';
    session.addEventListener('select', () => { this._select = performance.now(); });
    session.addEventListener('end', () => { this.xr = null; this.mode = 'flat'; this.r.gl.bindFramebuffer(this.r.gl.FRAMEBUFFER, null); if (this.onExit) this.onExit(); });
    return session;
  }

  async exit() {
    if (this.xr) { try { await this.xr.end(); } catch (e) { /* ignore */ } return; }
    if (this.mode === 'cardboard') {
      try { if (document.fullscreenElement) await document.exitFullscreen(); } catch (e) { /* ignore */ }
      try { screen.orientation.unlock(); } catch (e) { /* ignore */ }
      try { this.wake && this.wake.release(); } catch (e) { /* ignore */ }
    }
    this.mode = 'flat';
    if (this.onExit) this.onExit();
  }

  /** Request animation frames from the right source (window or XR session). */
  raf(fn) { return this.xr ? this.xr.requestAnimationFrame(fn) : requestAnimationFrame(t => fn(t, null)); }

  // ---------------------------------------------------------------- per-frame
  _headFromState() {
    if (this.mode === 'cardboard' && this.hasDevice) this.headQuat = qMul(this.yawOff, this.devQuat);
    else this.headQuat = qMul(qAxisAngle(0, 1, 0, -this.yaw), qAxisAngle(1, 0, 0, -this.pitch));
    this.headPos = [0, 0, 0];
  }

  /** Update head pose + gaze ray, then render the scene. */
  render(scene, frame, clear) {
    const gl = this.r.gl, cv = this.canvas;
    if (this.mode === 'xr' && frame) return this._renderXR(scene, frame, clear);
    // canvas sizing
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(2, Math.round(cv.clientWidth * dpr)), H = Math.max(2, Math.round(cv.clientHeight * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    this._headFromState();
    const hq = this.headQuat, hm = mat4FromTRS(this.headPos, hq, [1, 1, 1]);

    if (this.mode === 'cardboard') {
      this.ray = { o: this.headPos.slice(), d: qRotate(hq, [0, 0, -1]) };
      const ew = Math.floor(W / 2), scale = 0.85, tw = Math.max(64, Math.round(ew * scale)), th = Math.max(64, Math.round(H * scale));
      this.r.ensureTargets(tw, th, 4);
      const proj = mat4Perspective(100 * DEG, tw / th, 0.05, 200);
      const ipd = Settings.ipd;
      [-1, 1].forEach((side, i) => {
        const v = viewFromPose(hm, side * ipd / 2);
        this.r.drawScene(scene, [{ view: v.view, proj, camPos: v.camPos, vp: { x: 0, y: 0, w: tw, h: th }, pointScale: th * 0.9 }], this.r.targets[i].msaa, clear);
        this.r.targets[i].finish();
      });
      this.r.clearCanvas(W, H);
      const common = { uK1: Settings.k1, uK2: Settings.k2, uZoom: Settings.zoom, uChroma: 0.012, uAspect: ew / H };
      this.r.distortPass(this.r.targets[0].tex, { x: 0, y: 0, w: ew, h: H }, { ...common, uShift: Settings.shift });
      this.r.distortPass(this.r.targets[1].tex, { x: W - ew, y: 0, w: ew, h: H }, { ...common, uShift: -Settings.shift });
      return;
    }
    // flat preview (also used while XR session is starting)
    const fov = this.fovFlat, proj = mat4Perspective(fov, W / H, 0.05, 200);
    const v = viewFromPose(hm, 0);
    // pointer ray through the cursor
    const nx = (this.pointer.active ? this.pointer.x : 0.5) * 2 - 1, ny = 1 - (this.pointer.active ? this.pointer.y : 0.5) * 2;
    const t = Math.tan(fov / 2), dc = [nx * t * (W / H), ny * t, -1], l = Math.hypot(...dc);
    this.ray = { o: this.headPos.slice(), d: qRotate(hq, [dc[0] / l, dc[1] / l, dc[2] / l]) };
    this.r.drawScene(scene, [{ view: v.view, proj, camPos: v.camPos, vp: { x: 0, y: 0, w: W, h: H }, pointScale: H * 0.9 }], null, clear);
  }

  _renderXR(scene, frame, clear) {
    const session = frame.session, layer = session.renderState.baseLayer;
    const pose = frame.getViewerPose(this.refSpace);
    if (!pose) return;
    const tp = pose.transform.position, to = pose.transform.orientation;
    const q = [to.x, to.y, to.z, to.w], p = [tp.x, tp.y, tp.z];
    this._lastViewer = { q, p }; this.headQuat = q; this.headPos = p;
    // gaze ray; a tracked controller (if any) takes over as the pointer
    this.ray = { o: p.slice(), d: qRotate(q, [0, 0, -1]) };
    for (const src of session.inputSources) {
      if (src.targetRayMode === 'tracked-pointer' && src.targetRaySpace) {
        const cp = frame.getPose(src.targetRaySpace, this.refSpace);
        if (cp) { const c = cp.transform; this.ray = { o: [c.position.x, c.position.y, c.position.z], d: qRotate([c.orientation.x, c.orientation.y, c.orientation.z, c.orientation.w], [0, 0, -1]) }; break; }
      }
    }
    const views = pose.views.map(v => {
      const vp = layer.getViewport(v), pos = v.transform.position;
      return { view: new Float32Array(v.transform.inverse.matrix), proj: new Float32Array(v.projectionMatrix), camPos: [pos.x, pos.y, pos.z], vp: { x: vp.x, y: vp.y, w: vp.width, h: vp.height }, pointScale: vp.height * 0.9 };
    });
    this.r.drawScene(scene, views, layer.framebuffer, clear);
  }
}
