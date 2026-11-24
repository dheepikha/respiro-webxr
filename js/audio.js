// WebAudio: procedural mood soundscapes (pad, ocean/rain/wind/birds, chimes) + UI and breathing cues.
import { Settings, MOODS } from './core.js';

let ctx = null, master, bus, ambBus, musBus, cueBus, noiseBuf;
let scene = null;           // currently running soundscape { stop() }
let padFilter = null;       // follows the breath
let chimeTimer = 0, birdTimer = 0;
let moodIdx = -1;

const mtof = (root, semi) => root * Math.pow(2, semi / 12);

function makeNoise() {
  const len = ctx.sampleRate * 4, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;               // pink-ish noise (Paul Kellet)
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  return b;
}

/** Must be called from a user gesture (tap / click). */
export function start() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = Settings.volume; master.connect(ctx.destination);
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4; comp.connect(master);
  bus = comp;
  ambBus = ctx.createGain(); musBus = ctx.createGain(); cueBus = ctx.createGain();
  ambBus.connect(bus); musBus.connect(bus); cueBus.connect(bus);
  noiseBuf = makeNoise();
  applyLevels();
  setMood(Settings.mood);
}
export function applyLevels() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(Settings.volume, t, 0.1);
  ambBus.gain.setTargetAtTime(Settings.ambience ? 1 : 0, t, 0.3);
  musBus.gain.setTargetAtTime(Settings.music ? 1 : 0, t, 0.3);
  cueBus.gain.setTargetAtTime(Settings.cues ? 1 : 0, t, 0.1);
}
export const running = () => !!ctx;

function noiseSrc(rate = 1) { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.playbackRate.value = rate; s.start(); return s; }
function lfo(freq, depth, target) {
  const o = ctx.createOscillator(); o.frequency.value = freq; const g = ctx.createGain(); g.gain.value = depth;
  o.connect(g); g.connect(target); o.start(); return o;
}

export function setMood(i) {
  if (!ctx) return;
  if (i === moodIdx && scene) return;
  moodIdx = i;
  const old = scene; scene = null;
  if (old) old.stop();
  const m = MOODS[i % MOODS.length].sound;
  const nodes = [], t0 = ctx.currentTime;

  // --- pad: detuned triangle/sine voices through a breath-controlled low-pass
  const pf = ctx.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 500; pf.Q.value = 0.6;
  const padG = ctx.createGain(); padG.gain.value = 0.0;
  pf.connect(padG); padG.connect(musBus);
  m.chord.forEach((f, k) => {
    for (const det of [-6, 5]) {
      const o = ctx.createOscillator(); o.type = k % 2 ? 'triangle' : 'sine'; o.frequency.value = f; o.detune.value = det + k * 1.5;
      const g = ctx.createGain(); g.gain.value = 0.11 / m.chord.length * 2; o.connect(g); g.connect(pf); o.start(); nodes.push(o);
    }
  });
  const swell = lfo(0.07, 0.04, padG.gain); nodes.push(swell);
  padG.gain.setTargetAtTime(0.28, t0, 2.5);
  padFilter = pf;

  // --- noise layer
  let nsrc = null;
  if (m.noise !== 'none') {
    nsrc = noiseSrc(m.noise === 'rain' ? 1.6 : 1);
    const f = ctx.createBiquadFilter(), g = ctx.createGain(); g.gain.value = m.noiseGain * 0.5;
    if (m.noise === 'ocean') {
      f.type = 'lowpass'; f.frequency.value = 650; f.Q.value = 0.4;
      lfo(0.11, 0.35 * m.noiseGain, g.gain);                     // slow surf: one wave every ~9 s
      lfo(0.09, 220, f.frequency);
    } else if (m.noise === 'rain') {
      f.type = 'highpass'; f.frequency.value = 1400; f.Q.value = 0.3; g.gain.value = m.noiseGain * 0.35;
    } else {
      f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.8;
      lfo(0.05, 0.3 * m.noiseGain, g.gain); lfo(0.04, 260, f.frequency);
    }
    nsrc.connect(f); f.connect(g); g.connect(ambBus); nodes.push(nsrc);
    if (m.noise === 'rain') {                                     // soft low rumble under the rain
      const lf = ctx.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = 220;
      const lg = ctx.createGain(); lg.gain.value = 0.25; const s2 = noiseSrc(0.4); s2.connect(lf); lf.connect(lg); lg.connect(ambBus); nodes.push(s2);
    }
  }

  scene = {
    mood: m,
    stop() {
      padG.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      nodes.forEach(n => { try { n.stop(ctx.currentTime + 2.5); } catch (e) { /* ignore */ } });
    },
  };
}

/** Called every frame: fill 0..1 opens the pad filter; schedules chimes and birds. */
export function update(dt, fill, active) {
  if (!ctx || !scene) return;
  const t = ctx.currentTime;
  if (padFilter) padFilter.frequency.setTargetAtTime(380 + fill * 1500, t, 0.25);
  const m = scene.mood;
  chimeTimer -= dt; birdTimer -= dt;
  if (chimeTimer <= 0 && m.chimes > 0) {
    chimeTimer = (1 / m.chimes) * (0.6 + Math.random() * 1.2);
    const semi = m.scale[Math.floor(Math.random() * m.scale.length)] + (Math.random() < 0.3 ? 12 : 0);
    chime(mtof(m.root, semi), 0.06 + Math.random() * 0.05);
  }
  if (birdTimer <= 0 && m.birds > 0) {
    birdTimer = (1 / m.birds) * (0.5 + Math.random() * 1.5);
    bird();
  }
}

function env(g, t, a, peak, d) {
  g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
export function chime(f, vol = 0.08) {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const [mul, v, dec] of [[1, 1, 3.5], [2.01, 0.35, 2.2], [3.97, 0.12, 1.2]]) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f * mul;
    env(g, t, 0.005, vol * v, dec); o.connect(g); g.connect(musBus); o.start(t); o.stop(t + dec + 0.1);
  }
}
function bird() {
  const t = ctx.currentTime, base = 2200 + Math.random() * 1800, n = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const o = ctx.createOscillator(), g = ctx.createGain(), ts = t + i * 0.13;
    o.type = 'sine'; o.frequency.setValueAtTime(base, ts); o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.5), ts + 0.09);
    env(g, ts, 0.01, 0.035, 0.1); o.connect(g); g.connect(ambBus); o.start(ts); o.stop(ts + 0.2);
  }
}

// ---- UI + breathing cues
function tone(f0, f1, dur, vol, type = 'sine', bus_ = cueBus) {
  if (!ctx) return; const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, 0.02, vol, dur); o.connect(g); g.connect(bus_); o.start(t); o.stop(t + dur + 0.1);
}
export const tick = () => tone(900, 700, 0.07, 0.10, 'triangle');
export const select = () => tone(520, 780, 0.12, 0.14, 'sine');
export const back = () => tone(600, 400, 0.12, 0.12, 'sine');
export function success() { if (!ctx) return; [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() => tone(f, f * 1.001, 0.5, 0.12), i * 90)); }
/** Soft guide tones for the pacer: rising on inhale, falling on exhale, tick on hold. */
export function cue(kind, secs) {
  const d = Math.min(secs, 3);
  if (kind === 'INHALE') tone(260, 420, d, 0.07, 'sine');
  else if (kind === 'EXHALE') tone(420, 240, d, 0.07, 'sine');
  else tone(330, 330, 0.25, 0.05, 'sine');
}
