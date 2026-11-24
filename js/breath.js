// Breath input sources (demo / touch / mic / Bluetooth belt / WebSocket) and the BreathMonitor.
import { Settings, calibrated } from './core.js';
import { clamp, lerp } from './math.js';

const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'; // Nordic UART service
const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // notify (device -> phone)

/** Pull the sample out of a text line: "512", "ADC:512", "A1=512" or "512,400" (first value). */
export function parseNum(line) {
  const m = line.match(/[:=]\s*(-?\d+(?:\.\d+)?)/) || line.match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[1] !== undefined ? m[1] : m[0]) : NaN;
}

// ------------------------------------------------------------------ sources
/** Each source exposes: label, normalized (already 0..1?), value, ok, update(dt), stop(). */
class DemoSource {
  constructor() { this.label = 'Demo breathing'; this.normalized = true; this.value = 0; this.ok = true; this.t = 0; this.ph = 0; this.rate = 0.2; this.follow = null; this.followFlow = null; }
  update(dt) {
    this.t += dt;
    if (this.followFlow !== null) {   // guided spirometry: integrate a target flow (mL/s) into volume
      this.value = clamp(this.value + this.followFlow / Settings.capacityMl * dt + (Math.random() - 0.5) * 0.002, 0, 1);
      return;
    }
    if (this.follow !== null) {      // guided session: a "perfect" breather following the pacer, with a little noise
      this.value = clamp(this.value + (this.follow - this.value) * Math.min(1, dt / 0.9) + (Math.random() - 0.5) * 0.004, 0, 1);
      return;
    }
    // slowly wandering rate between ~9 and ~16 breaths / min, with an occasional deep breath
    this.rate = 0.2 + 0.05 * Math.sin(this.t * 0.07) + 0.02 * Math.sin(this.t * 0.31);
    this.ph += dt * this.rate * Math.PI * 2;
    const depth = 0.55 + 0.25 * Math.sin(this.t * 0.11) + (Math.sin(this.t * 0.043) > 0.97 ? 0.3 : 0);
    this.value = clamp(0.12 + depth * (0.5 - 0.5 * Math.cos(this.ph)), 0, 1);
  }
  stop() {}
}

class TouchSource {
  constructor() { this.label = 'Touch (hold = inhale)'; this.normalized = true; this.value = 0; this.ok = true; this.down = false; this._d = e => { this.down = true; }; this._u = e => { this.down = false; };
    this._k = e => { if (e.code === 'Space') this.down = e.type === 'keydown'; };
    addEventListener('pointerdown', this._d); addEventListener('pointerup', this._u); addEventListener('pointercancel', this._u);
    addEventListener('keydown', this._k); addEventListener('keyup', this._k); }
  update(dt) { this.value = clamp(this.value + (this.down ? 0.28 : -0.34) * dt, 0, 1); }
  stop() { removeEventListener('pointerdown', this._d); removeEventListener('pointerup', this._u); removeEventListener('pointercancel', this._u); removeEventListener('keydown', this._k); removeEventListener('keyup', this._k); }
}

class MicSource {
  constructor() {
    this.label = 'Microphone (blow)'; this.normalized = true; this.value = 0; this.ok = false; this.err = '';
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(stream => {
      this.stream = stream;
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = this.ctx.createMediaStreamSource(stream);
      this.an = this.ctx.createAnalyser(); this.an.fftSize = 1024; src.connect(this.an);
      this.buf = new Float32Array(1024); this.ok = true;
    }).catch(e => { this.err = String(e.message || e); });
  }
  update(dt) {
    if (!this.an) return;
    this.an.getFloatTimeDomainData(this.buf);
    let s = 0; for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(s / this.buf.length);
    const eff = clamp((rms - 0.012) / 0.12, 0, 1);       // blowing strength
    this.value = clamp(this.value + (eff * 0.9 - (1 - eff) * 0.30) * dt, 0, 1);
  }
  stop() { try { this.stream && this.stream.getTracks().forEach(t => t.stop()); this.ctx && this.ctx.close(); } catch (e) { /* ignore */ } }
}

/** Belt over Web Bluetooth (Nordic UART). The ESP32 sketch prints one number per line. */
class BleSource {
  constructor() { this.label = 'Bluetooth belt'; this.normalized = false; this.value = 0; this.ok = false; this.last = 0; this.status = 'not connected'; this.dev = null; this.buf = ''; }
  async connect() {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth is not available. Use Chrome on Android over HTTPS.');
    this.status = 'choosing device';
    const dev = await navigator.bluetooth.requestDevice({
      filters: [{ services: [NUS] }, { namePrefix: 'Respiro' }, { namePrefix: 'ESP32' }, { namePrefix: 'HC-' }],
      optionalServices: [NUS],
    });
    this.dev = dev;
    dev.addEventListener('gattserverdisconnected', () => { this.ok = false; this.status = 'disconnected'; });
    this.status = 'connecting';
    const server = await dev.gatt.connect();
    const svc = await server.getPrimaryService(NUS);
    const ch = await svc.getCharacteristic(NUS_TX);
    await ch.startNotifications();
    const dec = new TextDecoder();
    ch.addEventListener('characteristicvaluechanged', e => {
      this.buf += dec.decode(e.target.value);
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        const v = parseNum(line);
        if (Number.isFinite(v)) { this.value = v; this.last = performance.now(); this.ok = true; }
      }
      if (this.buf.length > 200) this.buf = '';
    });
    this.status = 'connected: ' + (dev.name || 'belt');
  }
  update() { if (this.ok && performance.now() - this.last > 2000) this.status = 'no data'; }
  stop() { try { this.dev && this.dev.gatt.connected && this.dev.gatt.disconnect(); } catch (e) { /* ignore */ } }
}

/** Arduino over USB cable using Web Serial (Chrome / Edge on a PC). Reads lines like "ADC:512". */
class SerialSource {
  constructor() { this.label = 'USB serial belt'; this.normalized = false; this.value = 0; this.ok = false; this.last = 0; this.status = 'not connected'; this.port = null; }
  async connect() {
    if (!navigator.serial) throw new Error('Web Serial is not available. Use Chrome or Edge on a PC (HTTPS or localhost).');
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: Settings.baud || 9600 });
    this.port = port; this.status = 'connected, waiting for data';
    this._read(port);
  }
  async _read(port) {
    const dec = new TextDecoder(); let buf = '', first = true;
    try {
      this.reader = port.readable.getReader();
      for (;;) {
        const { value, done } = await this.reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (first) { first = false; continue; }                 // first line may be cut in half
          const v = parseNum(line);
          if (Number.isFinite(v)) { this.value = v; this.last = performance.now(); this.ok = true; }
        }
        if (buf.length > 200) buf = '';
      }
    } catch (e) { this.status = 'error: ' + (e.message || e); }
    this.ok = false; if (!this.status.startsWith('error')) this.status = 'disconnected';
  }
  update() { if (this.ok) this.status = performance.now() - this.last > 2000 ? 'no data' : 'connected'; }
  stop() { try { this.reader && this.reader.cancel(); this.port && this.port.close(); } catch (e) { /* ignore */ } }
}

/** Arduino UNO R4 WiFi (or any board) that answers GET /data with {"value":N}. Polls at ~20 Hz. */
class HttpSource {
  constructor(host) {
    this.label = 'Arduino Wi-Fi (HTTP)'; this.normalized = false; this.value = 0; this.ok = false; this.last = 0; this.status = 'connecting'; this.run = true;
    this.url = 'http://' + String(host || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '') + '/data';
    if (location.protocol === 'https:') this.status = 'blocked: https page cannot read http:// (see README)';
    this._loop();
  }
  async _loop() {
    while (this.run) {
      const t0 = performance.now();
      try {
        const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 1500);
        const r = await fetch(this.url, { cache: 'no-store', signal: ctl.signal }); clearTimeout(to);
        const txt = await r.text(); let v = NaN;
        try { v = parseFloat(JSON.parse(txt).value); } catch (e) { v = parseNum(txt); }
        if (Number.isFinite(v)) { this.value = v; this.last = performance.now(); this.ok = true; this.status = 'connected'; }
      } catch (e) { if (this.ok || this.status === 'connecting') this.status = location.protocol === 'https:' ? this.status : 'no reply from ' + this.url; this.ok = false; }
      await new Promise(r => setTimeout(r, Math.max(5, 50 - (performance.now() - t0))));
    }
  }
  update() { if (this.ok && performance.now() - this.last > 2000) { this.ok = false; this.status = 'no data'; } }
  stop() { this.run = false; }
}

/** Belt over WebSocket (ESP32 WebSocketsServer). Only works from http:// pages or localhost. */
class WsSource {
  constructor(url) {
    this.label = 'WebSocket belt'; this.normalized = false; this.value = 0; this.ok = false; this.last = 0; this.status = 'connecting';
    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => { this.status = 'connected'; };
      this.ws.onclose = () => { this.ok = false; this.status = 'closed'; };
      this.ws.onerror = () => { this.status = 'error (https pages cannot use ws://)'; };
      this.ws.onmessage = e => { for (const ln of String(e.data).split(/\r?\n/)) { const v = parseNum(ln); if (Number.isFinite(v)) { this.value = v; this.last = performance.now(); this.ok = true; } } };
    } catch (e) { this.status = String(e.message || e); }
  }
  update() { if (this.ok && performance.now() - this.last > 2000) this.status = 'no data'; }
  stop() { try { this.ws && this.ws.close(); } catch (e) { /* ignore */ } }
}

// ------------------------------------------------------------------ monitor
export class BreathMonitor {
  constructor() {
    this.src = null; this.srcKind = '';
    this.serial = new SerialSource();
    this.ble = new BleSource();           // kept across source switches so the pairing survives
    this.fill = 0; this.volumeMl = 0; this.flow = 0; this.smoothFlow = 0; this.raw = 0; this.rawSmooth = 0;
    this.lo = 0; this.hi = 1; this.autoInit = false;
    this.phase = 'rest';
    this.resetSession();
    this.history = []; this._hT = 0;
  }

  setSource(kind) {
    if (this.src && this.src !== this.ble && this.src !== this.serial) this.src.stop();
    this.srcKind = kind; this.autoInit = false;
    if (kind === 'demo') this.src = new DemoSource();
    else if (kind === 'touch') this.src = new TouchSource();
    else if (kind === 'mic') this.src = new MicSource();
    else if (kind === 'ble') this.src = this.ble;
    else if (kind === 'serial') this.src = this.serial;
    else if (kind === 'ws') this.src = new WsSource(Settings.wsUrl);
    else if (kind === 'http') this.src = new HttpSource(Settings.arduinoIp);
    else this.src = new DemoSource();
    Settings.source = kind;
  }
  /** Guided sessions tell the demo source what to follow (null = free breathing). */
  setGuide(x) { if (this.src && 'follow' in this.src) { this.src.follow = x; this.src.followFlow = null; } }
  /** Guided spirometry: the demo source inhales/exhales at this flow (mL/s); null = off. */
  setGuideFlow(f) { if (this.src && 'followFlow' in this.src) { this.src.followFlow = f; if (f !== null) this.src.follow = null; } }
  get status() { return this.src ? (this.src.status || (this.src.ok ? 'ok' : (this.src.err || 'waiting'))) : '-'; }
  get label() { return this.src ? this.src.label : '-'; }

  resetSession() {
    this.sessionTime = 0; this.peakMl = 0; this.bestHold = 0; this.holdT = 0;
    this.lastFvcMl = 0; this.lastFev1Ml = 0; this.lastFev1Ratio = 0;
    this.breaths = []; this.bpm = 0; this._ex = null; this._stillT = 0; this._prevPhase = 'rest';
    // per-breath analysis (peak/trough detection on the smoothed volume)
    this.an = { x: this.fill, dir: 0, ext: 0, extT: 0, peak: null, lastTrough: null, list: [], fi: 0, fe: 0, lastEvent: 0, inPause: false, pauses: 0, longestPause: 0, maxIn: 0, maxEx: 0 };
  }

  /** Normalise the raw sample to 0..1 (calibration -> else slow auto-range). */
  _normalise(raw) {
    const s = this.src;
    if (s.normalized) return raw;
    if (calibrated()) { const lo = Settings.calLo, hi = Settings.calHi; return (raw - lo) / Math.max(1e-6, hi - lo); }
    if (!this.autoInit) { this.lo = raw - 1; this.hi = raw + 1; this.autoInit = true; }
    this.lo = Math.min(this.lo, raw); this.hi = Math.max(this.hi, raw);
    const span = this.hi - this.lo, k = 0.002 * span;               // forget extremes slowly
    if (raw > this.lo + k) this.lo += k * 0.5;
    if (raw < this.hi - k) this.hi -= k * 0.5;
    return (raw - this.lo) / Math.max(1e-6, this.hi - this.lo);
  }

  update(dt) {
    dt = Math.min(dt, 0.1);
    const s = this.src; if (!s) return;
    s.update(dt);
    this.raw = s.value;
    this.rawSmooth += (this.raw - this.rawSmooth) * Math.min(1, dt / 0.12);
    let n = this._normalise(this.raw);
    if (Settings.invert) n = 1 - n;
    n = clamp(n, 0, 1);
    const prevV = this.volumeMl;
    this.fill += (n - this.fill) * Math.min(1, dt / 0.08);
    this.volumeMl = this.fill * Settings.capacityMl;
    const f = dt > 0 ? (this.volumeMl - prevV) / dt : 0;
    this.flow = f;
    this.smoothFlow += (f - this.smoothFlow) * Math.min(1, dt / 0.15);
    this.sessionTime += dt;
    if (this.volumeMl > this.peakMl) this.peakMl = this.volumeMl;

    // phase detection
    const sf = this.smoothFlow;
    let ph;
    if (sf > 140) ph = 'inhale'; else if (sf < -140) ph = 'exhale';
    else { this._stillT += dt; ph = (this._stillT > 0.6 && this.fill > 0.45) ? 'hold' : 'rest'; }
    if (Math.abs(sf) > 140) this._stillT = 0;
    if (ph === 'hold') { this.holdT += dt; this.bestHold = Math.max(this.bestHold, this.holdT); } else this.holdT = 0;
    if (ph === 'inhale' && this._prevPhase !== 'inhale') {
      const t = this.sessionTime; this.breaths.push(t); if (this.breaths.length > 8) this.breaths.shift();
      if (this.breaths.length >= 2) {
        const span = (this.breaths[this.breaths.length - 1] - this.breaths[0]) / (this.breaths.length - 1);
        this.bpm = span > 0.8 ? 60 / span : 0;
      }
    }
    // forced exhale -> FVC / FEV1 estimate
    if (ph === 'exhale' && this._prevPhase !== 'exhale') this._ex = { v0: this.volumeMl, t0: this.sessionTime, v1: null, maxF: 0 };
    if (this._ex) {
      this._ex.maxF = Math.max(this._ex.maxF, -sf);
      if (this._ex.v1 === null && this.sessionTime - this._ex.t0 >= 1) this._ex.v1 = this.volumeMl;
      if (ph !== 'exhale') {
        const e = this._ex, fvc = e.v0 - this.volumeMl;
        if (fvc > 800 && e.maxF > 1500) {
          this.lastFvcMl = fvc; this.lastFev1Ml = e.v1 === null ? fvc : e.v0 - e.v1;
          this.lastFev1Ratio = clamp(this.lastFev1Ml / Math.max(1, fvc), 0, 1);
        }
        this._ex = null;
      }
    }
    this._prevPhase = this.phase = ph;

    this._analyse(dt);
    this._hT += dt;
    if (this._hT >= 0.05) {
      this._hT = 0; this.history.push([this.fill, clamp(sf / 2500, -1, 1)]);
      if (this.history.length > 1200) this.history.shift();      // 60 s at 20 Hz
    }
  }

  /** Find breaths: a trough -> peak -> trough cycle with a minimum size becomes one breath record. */
  _analyse(dt) {
    const a = this.an, t = this.sessionTime, x0 = this.fill, sf = this.smoothFlow, H = 0.045, cap = Settings.capacityMl;
    a.x += (x0 - a.x) * Math.min(1, dt / 0.12);
    const x = a.x;
    if (sf > 0) { a.fi = Math.max(a.fi, sf); if (t > 2) a.maxIn = Math.max(a.maxIn, sf); } else { a.fe = Math.max(a.fe, -sf); if (t > 2) a.maxEx = Math.max(a.maxEx, -sf); }
    const event = () => { a.lastEvent = t; a.inPause = false; };
    if (a.dir === 0) { a.ext = x; a.extT = t; a.dir = 1; a.lastEvent = t; }
    else if (a.dir > 0) {
      if (x > a.ext) { a.ext = x; a.extT = t; }
      else if (a.ext - x > H) { a.peak = { v: a.ext, t: a.extT }; a.dir = -1; a.ext = x; a.extT = t; event(); }
    } else {
      if (x < a.ext) { a.ext = x; a.extT = t; }
      else if (x - a.ext > H) {
        const tr = { v: a.ext, t: a.extT }; a.dir = 1; a.ext = x; a.extT = t; event();
        if (a.lastTrough && a.peak && a.peak.t > a.lastTrough.t) {
          const amp = a.peak.v - (a.lastTrough.v + tr.v) / 2;
          if (amp * cap >= 120) {
            const b = { t: tr.t, period: tr.t - a.lastTrough.t, Ti: a.peak.t - a.lastTrough.t, Te: tr.t - a.peak.t, vt: amp * cap, fi: a.fi, fe: a.fe };
            a.list.push(b); if (a.list.length > 300) a.list.shift();
          }
        }
        a.lastTrough = tr; a.fi = 0; a.fe = 0;
      }
    }
    const gap = t - a.lastEvent;                       // time since the last turning point
    if (gap > 10 && !a.inPause) { a.inPause = true; a.pauses++; }
    if (a.inPause) a.longestPause = Math.max(a.longestPause, gap);
  }

  // ---- derived respiratory parameters (last 8 breaths) ----
  get recent() { return this.an.list.slice(-8); }
  _mean(f) { const b = this.recent; return b.length ? b.reduce((s, v) => s + f(v), 0) / b.length : 0; }
  get rr() { return this.recent.length >= 2 ? 60 / this._mean(b => b.period) : 0; }
  get tidalMl() { return this._mean(b => b.vt); }
  get minuteVentL() { return this.rr * this.tidalMl / 1000; }
  get ieRatio() { const te = this._mean(b => b.Te); return te > 0 ? this._mean(b => b.Ti) / te : 0; }
  get periodSd() { const b = this.recent; if (b.length < 3) return 0; const m = this._mean(v => v.period); return Math.sqrt(b.reduce((s, v) => s + (v.period - m) ** 2, 0) / b.length); }
  /** 0-100: how even the breath-to-breath timing is (100 = metronome). */
  get regularity() { const m = this._mean(b => b.period); return m > 0 && this.recent.length >= 3 ? Math.round(100 * (1 - Math.min(1, 2 * this.periodSd / m))) : 0; }
  get sinceBreath() { return this.sessionTime - this.an.lastEvent; }
  get pattern() { const r = this.rr; return !r ? 'collecting...' : r < 12 ? 'slow (below 12/min)' : r <= 20 ? 'within 12-20/min' : 'fast (above 20/min)'; }

  /** Quality 0..1: fresh data and a usable range. */
  get quality() {
    const s = this.src; if (!s) return 0;
    if (!s.ok) return 0;
    if (s.normalized) return 1;
    if (performance.now() - s.last > 1500) return 0.1;
    if (calibrated()) return 1;
    return clamp((this.hi - this.lo) / Math.max(1e-6, Math.abs(this.hi) * 0.02 + 1), 0.2, 1);
  }
  /** Fill 0..1 that drives the tubes for the trained direction. */
  get driveFill() { return Settings.direction === 0 ? this.fill : 1 - this.fill; }
  /** Flow (mL/s, positive = in the trained direction). */
  get driveFlow() { return Settings.direction === 0 ? this.smoothFlow : -this.smoothFlow; }
}
