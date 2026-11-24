// Settings (localStorage), mood themes and breathing-trainer patterns.

const KEY = 'respirovr.';
const DEFAULTS = {
  mood: 0,            // index into MOODS
  source: 'demo',     // demo | touch | mic | ble | ws
  wsUrl: 'ws://localhost:8765', baud: 9600, arduinoIp: '',
  mode: 0,            // 0 cascade, 1 flow orbs
  level: 1,           // 0 easy 1 normal 2 hard
  difficulty: 1.0,
  direction: 0,       // 0 inhale raises raw, 1 exhale raises raw
  capacityMl: 3500,
  holdGoal: 3,
  dwell: 1.3,         // gaze dwell seconds (0 = off)
  volume: 0.7,        // master
  ambience: 1, music: 1, cues: 1,
  ipd: 0.063, k1: 0.34, k2: 0.55, zoom: 1.15, shift: 0.0,
  calLo: null, calHi: null,
};
const store = {};
try { Object.assign(store, JSON.parse(localStorage.getItem(KEY + 'v1') || '{}')); } catch (e) { /* storage blocked */ }
export const Settings = new Proxy(store, {
  get(t, k) { return k in t ? t[k] : DEFAULTS[k]; },
  set(t, k, v) {
    t[k] = v;
    try { localStorage.setItem(KEY + 'v1', JSON.stringify(t)); } catch (e) { /* ignore */ }
    return true;
  },
});
export const calibrated = () => Settings.calLo !== null && Settings.calHi !== null;

const c = (r, g, b, a = 1) => [r, g, b, a];

/** Six mood worlds: real landscapes (sea, rain, night lake, morning meadow, clear sky, forest) with matching sound. */
export const MOODS = [
  {
    id: 'calm', name: 'Calm Ocean', mood: 'CALM', blurb: 'Open sea, soft swell, warm late-afternoon light.',
    day: 1, top: [0.20, 0.52, 0.80], bottom: [0.72, 0.86, 0.92], accent: [0.25, 0.85, 0.85], accent2: [0.4, 0.6, 1.0],
    sun: { el: 24, az: -25, col: [1.0, 0.82, 0.55] }, clouds: 0.3, stars: 0, pattern: 'coherent', moteA: 0.15,
    scene: { fogD: 0.006, water: { kind: 'full', deep: [0.02, 0.17, 0.27], wave: 1.2 } },
    sound: { chord: [220, 277.18, 329.63, 493.88], noise: 'ocean', noiseGain: 0.5, chimes: 0.15, scale: [0, 2, 4, 7, 9], root: 440, birds: 0.04 },
  },
  {
    id: 'focus', name: 'Rainy Focus', mood: 'FOCUS', blurb: 'Grey sky, rain on a still lake, pines in the mist.',
    day: 1, top: [0.34, 0.40, 0.46], bottom: [0.58, 0.63, 0.68], accent: [0.55, 0.78, 1.0], accent2: [0.7, 0.9, 0.95],
    sun: { el: 40, az: 0, col: [0.06, 0.06, 0.07] }, clouds: 1, stars: 0, pattern: 'box', moteA: 0,
    scene: {
      fogD: 0.02, amb: 0.65, rain: 700, ground: { a: [0.10, 0.18, 0.12], b: [0.14, 0.24, 0.16] },
      water: { kind: 'lake', r: 40, at: [0, -42], deep: [0.05, 0.09, 0.12], wave: 0.5, rain: true },
      hills: [{ r: 90, h: [8, 16], col: [0.28, 0.38, 0.38] }, { r: 74, h: [5, 10], col: [0.20, 0.30, 0.27] }],
      trees: { kind: 'pine', n: 110, rmin: 12, rmax: 60, col: [0.07, 0.17, 0.12], trunk: [0.15, 0.10, 0.07] },
    },
    sound: { chord: [110, 164.81, 220], noise: 'rain', noiseGain: 0.55, chimes: 0.04, scale: [0, 3, 5, 7, 10], root: 392, birds: 0 },
  },
  {
    id: 'sleep', name: 'Aurora Night', mood: 'SLEEP', blurb: 'Still lake under stars and a slow aurora.',
    day: 0, top: [0.03, 0.01, 0.12], bottom: [0.0, 0.0, 0.03], accent: [0.45, 1.0, 0.7], accent2: [0.7, 0.5, 1.0],
    sun: { el: 35, az: 40, col: [0.22, 0.26, 0.40] }, clouds: 0, stars: 1.6, pattern: '478', moteA: 0.5,
    scene: {
      fogD: 0.01, amb: 0.55, ground: { a: [0.02, 0.04, 0.05], b: [0.03, 0.06, 0.07] },
      water: { kind: 'lake', r: 38, at: [0, -44], deep: [0.0, 0.01, 0.04], wave: 0.3 },
      hills: [{ r: 90, h: [8, 18], col: [0.04, 0.06, 0.11] }, { r: 74, h: [4, 9], col: [0.03, 0.05, 0.08] }],
      trees: { kind: 'pine', n: 90, rmin: 12, rmax: 55, col: [0.02, 0.05, 0.06], trunk: [0.03, 0.03, 0.04] },
    },
    sound: { chord: [98, 146.83, 196, 246.94], noise: 'none', noiseGain: 0, chimes: 0.08, scale: [0, 2, 4, 7, 9], root: 349.23, birds: 0 },
  },
  {
    id: 'morning', name: 'Sunny Morning', mood: 'ENERGISE', blurb: 'Low golden sun over a dewy meadow and lake.',
    day: 1, top: [0.35, 0.60, 0.90], bottom: [1.0, 0.80, 0.62], accent: [1.0, 0.65, 0.3], accent2: [1.0, 0.4, 0.6],
    sun: { el: 11, az: 20, col: [1.0, 0.72, 0.40] }, clouds: 0.35, stars: 0, pattern: 'belly', moteA: 0.35,
    scene: {
      fogD: 0.012, amb: 0.55, ground: { a: [0.30, 0.52, 0.20], b: [0.42, 0.62, 0.26] },
      water: { kind: 'lake', r: 30, at: [6, -44], deep: [0.10, 0.28, 0.36], wave: 0.5 },
      hills: [{ r: 92, h: [6, 14], col: [0.45, 0.55, 0.50] }, { r: 72, h: [4, 9], col: [0.30, 0.48, 0.30] }],
      trees: { kind: 'broad', n: 70, rmin: 14, rmax: 55, col: [0.22, 0.45, 0.14], trunk: [0.28, 0.18, 0.10] },
    },
    sound: { chord: [174.61, 220, 261.63, 329.63], noise: 'wind', noiseGain: 0.2, chimes: 0.2, scale: [0, 2, 4, 7, 9], root: 523.25, birds: 0.45 },
  },
  {
    id: 'sky', name: 'Clear Blue Sky', mood: 'UPLIFT', blurb: 'Bright blue sky, small clouds, green hills and a lake.',
    day: 1, top: [0.10, 0.36, 0.85], bottom: [0.62, 0.80, 0.97], accent: [0.40, 0.80, 1.0], accent2: [1.0, 0.95, 0.6],
    sun: { el: 58, az: -20, col: [1.0, 0.97, 0.90] }, clouds: 0.25, stars: 0, pattern: 'pursed', moteA: 0.2,
    scene: {
      fogD: 0.008, amb: 0.55, ground: { a: [0.20, 0.50, 0.16], b: [0.30, 0.62, 0.22] },
      water: { kind: 'lake', r: 34, at: [0, -46], deep: [0.05, 0.25, 0.45], wave: 0.6 },
      hills: [{ r: 95, h: [8, 20], col: [0.42, 0.58, 0.66] }, { r: 76, h: [4, 10], col: [0.25, 0.50, 0.30] }],
      trees: { kind: 'mixed', n: 60, rmin: 14, rmax: 55, col: [0.18, 0.48, 0.15], trunk: [0.26, 0.17, 0.09] },
    },
    sound: { chord: [196, 246.94, 293.66, 392], noise: 'wind', noiseGain: 0.3, chimes: 0.15, scale: [0, 2, 4, 7, 9], root: 587.33, birds: 0.14 },
  },
  {
    id: 'forest', name: 'Forest Dawn', mood: 'NATURE', blurb: 'Tall trees, low sun through mist, birdsong.',
    day: 1, top: [0.45, 0.65, 0.70], bottom: [0.80, 0.88, 0.78], accent: [0.6, 1.0, 0.5], accent2: [0.95, 0.9, 0.5],
    sun: { el: 16, az: 30, col: [1.0, 0.88, 0.60] }, clouds: 0.4, stars: 0, pattern: 'coherent', moteA: 0.55,
    scene: {
      fogD: 0.028, amb: 0.5, ground: { a: [0.07, 0.16, 0.07], b: [0.14, 0.24, 0.10] },
      hills: [{ r: 85, h: [8, 16], col: [0.30, 0.45, 0.40] }],
      trees: { kind: 'mixed', n: 230, rmin: 7, rmax: 48, col: [0.08, 0.28, 0.10], trunk: [0.20, 0.13, 0.08] },
    },
    sound: { chord: [146.83, 185, 220, 277.18], noise: 'wind', noiseGain: 0.25, chimes: 0.06, scale: [0, 2, 4, 7, 9], root: 587.33, birds: 0.38 },
  },
];

export function theme() {
  const m = MOODS[Settings.mood % MOODS.length], el = m.sun.el * Math.PI / 180, az = m.sun.az * Math.PI / 180;
  const a = m.accent;
  return {
    ...m,
    panel: [0.05 + a[0] * 0.04, 0.09 + a[1] * 0.04, 0.14 + a[2] * 0.04, 1],
    text: c(0.95, 0.98, 1.0), dim: c(0.72, 0.82, 0.9),
    good: c(0.4, 1.0, 0.6), warn: c(1.0, 0.8, 0.3), bad: c(1.0, 0.4, 0.4),
    acc: [...m.accent, 1], acc2: [...m.accent2, 1],
    cyl: [[0.2, 0.8, 1.0, 1], [0.45, 1.0, 0.65, 1], [1.0, 0.55, 0.9, 1]],
    sunDir: [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)], sunCol: m.sun.col,
  };
}

/** Guided-breathing trainers. Phase list: [label, seconds, target fill at the END of the phase 0..1]. */
export const PATTERNS = {
  coherent: { name: 'Resonance 5.5', desc: 'Coherent breathing, about 5.5 breaths per minute.', phases: [['INHALE', 5.5, 1], ['EXHALE', 5.5, 0]], cycles: 12 },
  box: { name: 'Box 4-4-4-4', desc: 'Inhale, hold, exhale, hold - four seconds each.', phases: [['INHALE', 4, 1], ['HOLD', 4, 1], ['EXHALE', 4, 0], ['HOLD', 4, 0]], cycles: 8 },
  '478': { name: '4-7-8 Wind-down', desc: 'Long hold and a slow exhale. Common before sleep.', phases: [['INHALE', 4, 1], ['HOLD', 7, 1], ['EXHALE', 8, 0]], cycles: 6 },
  belly: { name: 'Belly breathing 4/6', desc: 'Deep diaphragmatic breaths, longer out than in.', phases: [['INHALE', 4, 1], ['EXHALE', 6, 0]], cycles: 10 },
  pursed: { name: 'Pursed-lip 2/4', desc: 'Breathe in through the nose, out slowly through pursed lips.', phases: [['INHALE', 2, 0.8], ['EXHALE', 4, 0]], cycles: 14 },
  hold: { name: 'Breath-hold builder', desc: 'Deep breath in, hold as long as comfortable. Safe: stop any time.', phases: [['INHALE', 4, 1], ['HOLD', 15, 1], ['EXHALE', 6, 0], ['REST', 6, 0]], cycles: 5 },
};
export const PATTERN_ORDER = ['coherent', 'box', '478', 'belly', 'pursed', 'hold'];
