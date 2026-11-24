# Respiro VR (WebXR)

A browser version of the respiratory VR app. No install, no build step, no dependencies:
plain ES modules + a small WebGL2 engine written for this project.

Inside: three-cylinder virtual spirometer (Cascade and Flow-orb modes), a spirometer game,
six breathing trainers, five mood rooms with their own sky and soundscape, a live monitor
(volume, flow, phase, breaths/min, FVC/FEV1 estimate, CSV export), belt calibration,
a VR lens/IPD calibration suite and settings.

## Trainers
Resonance 5.5, Box 4-4-4-4, 4-7-8, Belly 4/6, Pursed-lip 2/4, Breath-hold builder.
The orb shows the guide, the ring shows YOUR breath from the belt, SYNC % scores how closely you follow.
The 4-7-8 and breath-hold builder involve long holds: stop any time if you feel dizzy.
This is a relaxation / practice tool, not a medical device. FVC/FEV1 values are rough estimates from belt volume.

## Mood rooms
| Mood | World | Sound |
|---|---|---|
| Calm Ocean | teal waves | surf, warm pad, sparse chimes |
| Rainy Focus | slate blue | steady rain, low drone |
| Aurora Night | violet + aurora, stars | deep pad, soft bells, no noise |
| Sunrise Glow | warm orange | bright pad, wind, chimes |
| Forest Dawn | green | birdsong, wind, open pad |

All sound is generated live with WebAudio (no audio files). The pad opens up as you inhale.

## Run it on the phone
WebXR, motion sensors and Web Bluetooth only work on **HTTPS** (or `localhost`).

**Option A: GitHub Pages (easiest, permanent)**
1. Create a GitHub repo, upload everything in this folder (index.html, style.css, js/).
2. Settings > Pages > Deploy from branch > main / root.
3. Open `https://<you>.github.io/<repo>/` in **Chrome on the S20**.

**Option B: from your PC over USB (no hosting)**
1. On the PC, in this folder: `python -m http.server 8000`
2. Phone: USB debugging on; PC: `adb reverse tcp:8000 tcp:8000`
3. Phone Chrome: `http://localhost:8000` (localhost counts as secure).

## Modes
- **Enter VR (WebXR)** - shown only if the browser offers an immersive-vr session. Phone Chrome may not offer it for Cardboard viewers; that is browser support, not the app.
- **Cardboard mode** - works on any phone: landscape, split view, lens distortion, gyro head tracking. Look at a button for ~1.3 s (gaze select) or tap the screen. Calibrate lens/IPD under *VR Calibration*.
- **Flat preview** - drag to look, click buttons. Good for desktop testing.

## Belt over USB (Arduino sketch printing `ADC:<number>`)
Your sketch (`Serial.println("ADC:" + value)` at 9600 baud, 50 Hz) works unchanged.

**A. Direct, on a PC (simplest test):** open the page in Chrome or Edge on the PC, choose *USB cable: Arduino serial*,
click **Connect USB (Arduino)**, pick the Arduino's COM port, then *Flat preview*. Close the Arduino Serial Monitor first
(only one program can hold the port).

**B. Arduino -> PC -> phone (for Cardboard mode):** the phone cannot read the USB port, so the PC forwards the numbers.
1. `pip install pyserial`
2. `python tools/bridge.py` (auto-detects the port; or `--port COM5`). Test with no Arduino: `python tools/bridge.py --fake`.
3. Serve the page from the PC and tunnel to the phone over USB: `python -m http.server 8000`, then `adb reverse tcp:8000 tcp:8000` and `adb reverse tcp:8765 tcp:8765`.
4. Phone Chrome: `http://localhost:8000`, source = *PC bridge / WebSocket*, address `ws://localhost:8765`.
(A page on https:// cannot open ws:// - that is why this route uses localhost over adb.)

**C. Unity app:** `python tools/bridge.py --udp PHONE_IP:5005` (phone and PC on the same Wi-Fi; allow Python through the Windows firewall).
In the Unity app: Settings > Belt source > UDP, port 5005, then run Breath Calibration. The bridge sends plain numbers, which the UDP source reads directly.

**D. Wireless without a PC:** use an ESP32 and the Bluetooth route below.

## Belt over Bluetooth
1. Flash `esp32_belt_ble/esp32_belt_ble.ino` to an ESP32 (belt amplifier output on GPIO34).
2. Start page > *Connect belt (Bluetooth)* > pick `Respiro-Belt` (do this BEFORE entering Cardboard mode; Chrome needs a real tap for the chooser).
3. Run *Breath Calibration*: breathe out fully, then in fully. The tubes then map 0-100% to your range.
Belt direction wrong? Settings > Belt polarity. Volume scale: Settings > Capacity (mL).
Any device that sends one number per line over the Nordic UART service (6E400001-...) works.
Web Bluetooth: Chrome on Android/desktop only (not iOS, not Firefox).
WebSocket source: ESP32 serving `ws://ip:81` works only from an `http://` page (browsers block ws:// from https).

## Files
`js/gl.js` engine, `shaders.js`, `rig.js` (flat / Cardboard / WebXR presentation), `ui.js` (gaze buttons),
`visuals.js` (spirometer, lungs, waveform, sky), `breath.js` (sources + monitor), `audio.js`, `screens.js`, `main.js`.


---
## v3 additions

**Moods (real scenery):** Calm ocean, Focus rain, Sleep (aurora night), Sunny morning, Clear blue sky, Forest. Pick in *Mood Rooms*.

**Trainers:** Ring Pacer (4-4-8, 4-7-8, Box, 5-5, 4-6, with SYNC %), Wave Rider, plus the six pattern trainers.

**Guided Spirometry:** a ghost ball shows the target; make your own ball follow it. MATCH % is scored.

**Respiratory Monitor:** LIVE / LOOP / TRENDS / REPORT pages (RR, tidal volume, minute ventilation, I:E, flow-volume loop, Poincare plot, CSV export). Volumes are estimates scaled by the Capacity setting, not clinical measurements.

**Breath Flappy:** breath height controls the bird. Demo source plays itself.

### Arduino UNO R4 WiFi (your `Respdata_SV_wifi1.ino`)
In the sketch, enter your own Wi-Fi name and password (placeholders only; never share them). Open the Serial Monitor to read the IP address. The sketch serves `GET /data` -> `{"value":N}`.

An https page cannot read `http://<arduino-ip>`. Choose one route:
1. **Bridge (recommended):** on a PC on the same Wi-Fi run `python tools/bridge.py --http <arduino-ip>`, then in the app pick *Bridge / WebSocket* with `ws://<pc-ip>:8765`.
2. **Direct:** serve this folder over http from the PC (`python -m http.server 8000`), open `http://<pc-ip>:8000` in Chrome after enabling `chrome://flags/#unsafely-treat-insecure-origin-as-secure` for that origin, then choose *Arduino Wi-Fi (HTTP)* and type the IP.
3. **Unity app:** reads the Arduino directly (no browser rules).

Not tested on a real headset/phone: on-device Cardboard behaviour, real serial in bridge.py.
