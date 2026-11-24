// Boot: renderer, rig, UI, app loop and the start overlay.
import { Renderer, Node } from './gl.js';
import { Rig } from './rig.js';
import { UI } from './ui.js';
import { Environment, Spirometer, Lung, Waveform } from './visuals.js';
import { BreathMonitor } from './breath.js';
import { Settings, MOODS, theme } from './core.js';
import { qRotate } from './math.js';
import * as Audio from './audio.js';
import * as S from './screens.js';

const $ = id => document.getElementById(id);
const canvas = $('gl'), overlay = $('overlay');
const note = msg => { $('note').textContent = msg || ''; };

let renderer;
try { renderer = new Renderer(canvas, { xr: true, preserve: new URLSearchParams(location.search).has('preserve') }); }
catch (e) { note(String(e.message || e)); throw e; }

const scene = new Node();
const rig = new Rig(renderer, canvas, $('stage'));
const ui = new UI(renderer, rig);
const env = new Environment(renderer, scene);
const mon = new BreathMonitor();
const spiro = new Spirometer(renderer, scene, env, ui);
const lung = new Lung(renderer, scene, env);
const wave = new Waveform(renderer, scene);
scene.add(ui.reticle);

const toastTx = ui.text(scene, '', 0, 0, 0, 0.045, [0.4, 1, 0.6, 1], 'center', true, true);
toastTx.node.visible = false; toastTx.node.mat.depthTest = false; toastTx.node.mat.order = 3150;

const app = {
  r: renderer, rig, ui, env, mon, spiro, lung, wave, scene, th: theme(), screen: null, toastT: 0, S,
  home() { this.show(new S.MenuScreen(this)); },
  show(screen) {
    if (this.screen) { try { this.screen.exit(); } catch (e) { console.error(e); } scene.remove(this.screen.root); }
    ui.reset();
    this.screen = screen;
    scene.add(screen.root);
    spiro.highlight = -1; spiro.resetHolds(); spiro.onTop = null; spiro.ghost = null; mon.setGuide(null);
    screen.enter();                      // enter() decides stage / lungWave
    spiro.setVisible(!!screen.stage); lung.setVisible(!!(screen.stage || screen.lungWave)); wave.setVisible(!!(screen.stage || screen.lungWave));
  },
  applyMood() {
    this.th = theme();
    Audio.setMood(Settings.mood);
    spiro.applyTheme(this.th); lung.applyTheme(this.th); wave.applyTheme(this.th);
    toastTx.color(this.th.good);
  },
  toast(msg, secs = 2.2) { toastTx.set(msg); toastTx.node.visible = true; this.toastT = secs; },
};
window.__app = app; window.__S = S;

// ---------------------------------------------------------------- loop
let last = 0;
function frame(t, xrFrame) {
  const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016); last = t;
  renderer.beginFrame(t / 1000);
  mon.update(dt);
  const th = app.th;
  env.update(dt, th, mon.fill);
  spiro.update(dt, mon); lung.update(dt, mon.fill); wave.update(dt, mon);
  Audio.update(dt, mon.fill, true);
  if (app.screen) app.screen.tick(dt);
  // head-locked toast
  if (app.toastT > 0) {
    app.toastT -= dt; if (app.toastT <= 0) toastTx.node.visible = false;
    const p = qRotate(rig.headQuat, [0, -0.3, -1.2]);
    toastTx.node.pos = [rig.headPos[0] + p[0], rig.headPos[1] + p[1], rig.headPos[2] + p[2]]; toastTx.node.quat = rig.headQuat.slice();
  }
  scene.update(null);
  ui.update(dt);
  rig.render(scene, xrFrame, [0, 0, 0, 1]);
}
let gen = 0;
const chain = g => (t, f) => { if (g !== gen) return; try { frame(t, f); } catch (e) { console.error(e); } rig.raf(chain(g)); };
function startLoop() { gen++; last = 0; rig.raf(chain(gen)); }

// ---------------------------------------------------------------- overlay wiring
const srcSel = $('source'), moodSel = $('mood');
MOODS.forEach((m, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${m.mood} - ${m.name}`; moodSel.appendChild(o); });
srcSel.value = Settings.source; moodSel.value = Settings.mood;
mon.setSource(Settings.source);
app.applyMood = app.applyMood.bind(app);
app.th = theme(); spiro.applyTheme(app.th); lung.applyTheme(app.th); wave.applyTheme(app.th); toastTx.color(app.th.good);
app.show(new S.MenuScreen(app));
startLoop();

const wsRow = $('wsRow'), wsUrl = $('wsurl');
wsUrl.value = Settings.wsUrl;
const ipRow = $('ipRow'), ipIn = $('arduinoip'); ipIn.value = Settings.arduinoIp;
ipIn.onchange = () => { Settings.arduinoIp = ipIn.value.trim(); if (srcSel.value === 'http') mon.setSource('http'); };
const showWs = () => { wsRow.hidden = srcSel.value !== 'ws'; ipRow.hidden = srcSel.value !== 'http'; };
srcSel.onchange = () => { mon.setSource(srcSel.value); showWs(); updateBle(); };
wsUrl.onchange = () => { Settings.wsUrl = wsUrl.value.trim(); if (srcSel.value === 'ws') mon.setSource('ws'); };
showWs();
moodSel.onchange = () => { Settings.mood = +moodSel.value; app.applyMood(); };
function updateBle() { const s = mon.src; $('bleStatus').textContent = ['ble', 'serial', 'ws', 'http'].includes(srcSel.value) && s ? 'Belt: ' + (s.status || '-') : ''; }
setInterval(updateBle, 800);

$('serial').onclick = async () => {
  try { await mon.serial.connect(); srcSel.value = 'serial'; mon.setSource('serial'); showWs(); }
  catch (e) { note(String(e.message || e)); }
  updateBle();
};
$('ble').onclick = async () => {
  try { await mon.ble.connect(); srcSel.value = 'ble'; mon.setSource('ble'); }
  catch (e) { note(String(e.message || e)); }
  updateBle();
};

const begin = async (how) => {
  note('');
  try {
    Audio.start(); app.applyMood();
    if (how === 'xr') await rig.startXR();
    else if (how === 'cardboard') await rig.startCardboard();
    else await rig.startFlat();
    overlay.classList.add('hidden');
    app.show(new S.MenuScreen(app));
    startLoop();
  } catch (e) { note(String(e.message || e)); }
};
$('xr').onclick = () => begin('xr');
$('cardboard').onclick = () => begin('cardboard');
$('flat').onclick = () => begin('flat');
rig.onExit = () => { overlay.classList.remove('hidden'); startLoop(); };

// WebXR availability
const xrBtn = $('xr');
if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr').then(ok => {
    xrBtn.disabled = !ok;
    if (!ok) note('WebXR VR is not offered by this browser/device. Use Cardboard mode instead.');
  }).catch(() => { note('Could not query WebXR. Use Cardboard mode.'); });
} else note('No WebXR here (needs HTTPS in Chrome). Cardboard mode still works.');
if (!window.isSecureContext) note('This page is not on HTTPS, so sensors, WebXR and Bluetooth are blocked. Host it on HTTPS (see README).');
if (!navigator.bluetooth) $('ble').textContent = 'Bluetooth: Chrome only';
if (!navigator.serial) $('serial').textContent = 'USB: Chrome on PC only';

addEventListener('keydown', e => { if (e.key === 'Escape' && app.screen && !(app.screen instanceof S.MenuScreen)) app.show(new S.MenuScreen(app)); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { last = 0; if (Audio.running()) Audio.start(); } });
