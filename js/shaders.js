// GLSL ES 3.00 shader sources. Every fragment shader writes PREMULTIPLIED colour: o = vec4(rgb * a, a).
// Blend 'alpha' = (ONE, ONE_MINUS_SRC_ALPHA), blend 'add' = (ONE, ONE).

const H = '#version 300 es\nprecision highp float;\nprecision highp sampler2D;\n';

const STD_VS = H + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uModel, uView, uProj;
out vec3 vWorld; out vec3 vLocal; out vec3 vNormal; out vec2 vUV;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz; vLocal = aPos; vNormal = mat3(uModel) * aNormal; vUV = aUV;
  gl_Position = uProj * uView * w;
}`;

const FS_IN = `in vec3 vWorld; in vec3 vLocal; in vec3 vNormal; in vec2 vUV; out vec4 o;
uniform vec3 uCamPos; uniform float uTime;\n`;

const HASH = `
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash13(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i+vec3(0,0,0)),hash13(i+vec3(1,0,0)),f.x), mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x), mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z);
}`;


const SKYFN = `
uniform vec3 uTop, uBottom, uAccent, uSun, uSunCol; uniform float uStars, uPulse, uOcean, uDay, uClouds;
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
vec3 skyColor(vec3 d){
  if (uDay > 0.5) {
    float up = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uBottom, uTop, pow(up, 0.55));
    if (d.y < 0.0) col = mix(uBottom, uBottom * 0.75, clamp(-d.y * 3.0, 0.0, 1.0));
    float sd = max(dot(d, normalize(uSun)), 0.0);
    col += uSunCol * (pow(sd, 6.0) * 0.18 + pow(sd, 120.0) * 0.55 + smoothstep(0.9993, 0.9998, sd) * 2.5);
    if (d.y > 0.0) {
      vec2 cuv = d.xz / (d.y + 0.14) * 0.9 + vec2(uTime * 0.012, 0.0);
      float n = fbm(vec3(cuv * 1.25, uTime * 0.015));
      float thr = mix(0.70, 0.36, uClouds);
      float c = smoothstep(thr, thr + 0.2, n) * smoothstep(0.0, 0.16, d.y);
      vec3 shade = mix(vec3(1.0), vec3(0.50, 0.55, 0.62), uClouds * 0.85);
      vec3 cc = mix(shade * 0.82, shade, clamp(0.55 + sd * 0.5, 0.0, 1.0));
      cc += uSunCol * pow(sd, 5.0) * 0.28;
      col = mix(col, cc, c * mix(0.85, 0.97, uClouds));
    }
    return col;
  }
  float h = d.y * 0.5 + 0.5;
  vec3 col = mix(uBottom, uTop, smoothstep(0.1, 0.9, h));
  float t = uTime * 0.05;
  float n1 = vnoise(d * 3.0 + vec3(t, 0.0, t * 0.7));
  float n2 = vnoise(d * 7.0 - vec3(0.0, t * 1.3, 0.0));
  float ribbon = smoothstep(0.45, 0.85, n1) * smoothstep(0.2, 0.9, n2);
  float band = exp(-pow((d.y - 0.25) * 2.2, 2.0));
  col += uAccent * ribbon * band * (0.35 + 0.5 * uPulse);
  vec2 suv = vec2(atan(d.z, d.x) * 45.0, asin(clamp(d.y, -1.0, 1.0)) * 90.0);
  vec2 cell = floor(suv), f = fract(suv) - 0.5;
  vec2 jit = (vec2(h21(cell + 3.1), h21(cell + 9.7)) - 0.5) * 0.5;
  float s = h21(cell + 7.7);
  float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 50.0);
  col += step(1.0 - 0.025 * uStars, s) * smoothstep(0.13, 0.0, length(f - jit)) * tw * 1.4 * step(0.0, d.y);
  float sd = max(dot(d, normalize(uSun)), 0.0);
  col += uSunCol * (pow(sd, 400.0) * 1.2 + pow(sd, 12.0) * 0.06);
  col += uAccent * 0.08 * exp(-abs(d.y) * 6.0) * (1.0 + uPulse);
  return col;
}`;

export const PROGRAMS = {

  // textured quad (canvas text, soft dots, rings). Texture is premultiplied.
  tex: {
    vs: STD_VS,
    fs: H + FS_IN + `
uniform sampler2D uMap; uniform vec4 uColor; uniform float uIntensity;
void main(){
  vec4 t = texture(uMap, vUV);
  o = vec4(t.rgb * uColor.rgb * uColor.a * uIntensity, t.a * uColor.a);
}`,
  },

  // rounded glass UI panel with hover glow and dwell-progress bar
  panel: {
    vs: STD_VS,
    fs: H + FS_IN + `
uniform vec4 uTop, uBottom, uBorderColor;
uniform float uRadius, uBorderW, uHover, uProgress, uAspect;
void main(){
  vec2 halfSize = vec2(uAspect * 0.5, 0.5);
  vec2 p = (vUV - 0.5) * vec2(uAspect, 1.0);
  vec2 q = abs(p) - (halfSize - uRadius);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float aa = 0.012;
  float shape = 1.0 - smoothstep(-aa, aa, d);
  if (shape < 0.001) discard;
  vec4 fill = mix(uBottom, uTop, vUV.y);
  fill.rgb += uHover * 0.18 * uBorderColor.rgb;
  float edge = smoothstep(-uBorderW - aa, -uBorderW + aa, d);
  vec4 col = mix(fill, uBorderColor, edge * (0.45 + 0.55 * uHover));
  float bar = step(vUV.x, uProgress) * step(vUV.y, 0.09) * step(0.001, uProgress);
  col.rgb = mix(col.rgb, vec3(1.0), bar * 0.85);
  col.a = max(col.a, bar) * shape;
  o = vec4(col.rgb * col.a, col.a);
}`,
  },

  // sky dome: daytime (sun, clouds) or night (stars, aurora)
  sky: {
    vs: STD_VS,
    fs: H + FS_IN + HASH + SKYFN + `
void main(){
  vec3 d = normalize(vWorld - uCamPos);
  o = vec4(skyColor(d), 1.0);
}`,
  },

  // lakes / sea / wet ground: reflects the sky, ripples, rain rings
  water: {
    vs: STD_VS,
    fs: H + FS_IN + HASH + SKYFN + `
uniform vec3 uDeep; uniform float uWave, uRain, uFogD;
float rings(vec2 p){
  vec2 g = p * 2.2, id = floor(g), f = fract(g) - 0.5;
  float ph = fract(uTime * 0.8 + h21(id));
  vec2 c = (vec2(h21(id + 1.0), h21(id + 2.0)) - 0.5) * 0.5;
  float r = length(f - c);
  return smoothstep(0.07, 0.0, abs(r - ph * 0.55)) * (1.0 - ph) * step(0.3, h21(id + 5.0));
}
void main(){
  vec3 V = normalize(uCamPos - vWorld);
  vec2 p = vWorld.xz; float t = uTime;
  vec2 g = vec2(sin(p.x*0.7+t*0.9) + sin(p.y*0.9-t*0.7) + 0.5*sin((p.x+p.y)*1.3+t*1.3),
                cos(p.x*0.8-t*0.6) + cos(p.y*0.6+t*1.1) + 0.5*cos((p.x-p.y)*1.1-t)) * 0.035 * uWave;
  float rp = uRain > 0.5 ? rings(p) : 0.0;
  vec3 N = normalize(vec3(g.x + rp * 0.5, 1.0, g.y + rp * 0.5));
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 refl = skyColor(normalize(R));
  float fres = 0.12 + 0.88 * pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
  vec3 w = mix(uDeep, refl, fres) + rp * 0.2;
  float fog = 1.0 - exp(-length(vWorld - uCamPos) * uFogD);
  w = mix(w, skyColor(normalize(vec3(-V.x, 0.015, -V.z))), fog);
  o = vec4(w, 1.0);
}`,
  },

  // grass / forest floor with fog
  ground: {
    vs: STD_VS,
    fs: H + FS_IN + HASH + `
uniform vec3 uColA, uColB, uFogCol; uniform float uFogD;
void main(){
  vec2 p = vWorld.xz;
  float n = vnoise(vec3(p * 0.3, 0.0)) * 0.6 + vnoise(vec3(p * 1.8, 1.0)) * 0.4;
  vec3 col = mix(uColA, uColB, n) * (0.84 + 0.32 * vnoise(vec3(p * 9.0, 3.0)));
  float fog = 1.0 - exp(-length(vWorld - uCamPos) * uFogD);
  o = vec4(mix(col, uFogCol, fog), 1.0);
}`,
  },

  // lit, fogged props (trees, hills): uv.x < 0.5 = trunk colour, otherwise foliage colour
  prop: {
    vs: STD_VS,
    fs: H + FS_IN + `
uniform vec3 uCol, uTrunk, uSun, uFogCol; uniform float uFogD, uAmb;
void main(){
  vec3 N = normalize(vNormal);
  float l = max(dot(N, normalize(uSun)), 0.0);
  vec3 base = vUV.x < 0.5 ? uTrunk : uCol;
  float hg = clamp((vWorld.y + 1.7) / 9.0, 0.0, 1.0);
  vec3 col = base * (uAmb + (1.0 - uAmb) * l) * (0.72 + 0.4 * hg);
  float fog = 1.0 - exp(-length(vWorld - uCamPos) * uFogD);
  o = vec4(mix(col, uFogCol, fog), 1.0);
}`,
  },

  // falling rain streaks (positions animated on the GPU)
  rain: {
    vs: H + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNormal; layout(location=2) in vec2 aUV;
uniform mat4 uView, uProj; uniform float uTime;
out vec2 vUV;
void main(){
  float ph = aNormal.x, Hh = 12.0;
  float y = mod(aPos.y - uTime * (8.0 + ph * 4.0), Hh) - 1.7;
  vec3 w = vec3(aPos.x + (y + 1.7) * 0.12, y, aPos.z);
  w += (aNormal.y < 0.5 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0)) * (aUV.x - 0.5) * 0.022;
  w.y -= aUV.y * 0.6;
  vUV = aUV;
  gl_Position = uProj * uView * vec4(w, 1.0);
}`,
    fs: H + `
in vec2 vUV; out vec4 o;
void main(){
  float a = (1.0 - vUV.y) * 0.42 * (1.0 - abs(vUV.x - 0.5) * 1.6);
  o = vec4(vec3(0.78, 0.85, 0.95) * a, a);
}`,
  },

  // neon floor grid (additive)
  floor: {
    vs: STD_VS,
    fs: H + FS_IN + `
uniform vec4 uColor; uniform vec2 uCenter;
void main(){
  vec2 g = vWorld.xz / 2.0;
  vec2 w = fwidth(g);
  vec2 gr = abs(fract(g - 0.5) - 0.5) / max(w, vec2(1e-4));
  float line = 1.0 - min(min(gr.x, gr.y), 1.0);
  float fade = exp(-length(vWorld.xz - uCenter) / 16.0);
  float a = line * uColor.a * fade;
  o = vec4(uColor.rgb * a, a);
}`,
  },

  // fresnel glass shell (additive)
  glass: {
    vs: STD_VS,
    fs: H + FS_IN + `
uniform vec4 uColor; uniform float uPower, uIntensity, uBase;
void main(){
  vec3 V = normalize(uCamPos - vWorld);
  float fres = pow(1.0 - clamp(abs(dot(normalize(vNormal), V)), 0.0, 1.0), uPower);
  float streak = smoothstep(0.92, 1.0, sin(vWorld.y * 3.0 + atan(vLocal.z, vLocal.x) * 2.0 + uTime * 0.6) * 0.5 + 0.5);
  float a = clamp(uBase + fres * uIntensity + streak * 0.15, 0.0, 1.0) * uColor.a;
  o = vec4(uColor.rgb * a, a);
}`,
  },

  // glowing liquid with rising bubbles (alpha blended)
  liquid: {
    vs: STD_VS,
    fs: H + FS_IN + HASH + `
uniform vec4 uColor, uColor2; uniform float uBaseY, uHeight, uGlow, uAlpha, uFlow;
void main(){
  float g = clamp((vWorld.y - uBaseY) / max(0.001, uHeight), 0.0, 1.0);
  vec3 col = mix(uColor.rgb, uColor2.rgb, g);
  vec3 V = normalize(uCamPos - vWorld);
  vec3 N = normalize(vNormal);
  float fres = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.0);
  vec2 uv = vec2(atan(vLocal.z, vLocal.x) * 3.0, vWorld.y * 6.0 - uTime * uFlow * 6.0);
  vec2 cell = floor(uv); vec2 f = fract(uv) - 0.5;
  float bubble = step(0.82, h21(cell)) * (1.0 - smoothstep(0.12, 0.22, length(f + (h21(cell + 7.0) - 0.5) * 0.4)));
  col += fres * uColor2.rgb * 0.8;
  col += bubble * 0.7;
  col *= uGlow;
  float cap = step(0.9, N.y);
  col += cap * uColor2.rgb * 0.3;
  float a = clamp(uAlpha + fres * 0.3 + cap * 0.2, 0.0, 1.0);
  o = vec4(col * a, a);
}`,
  },

  // gaze reticle: dot + faint ring + dwell progress arc
  reticle: {
    vs: STD_VS,
    fs: H + FS_IN + `
uniform float uProgress;
void main(){
  vec2 p = (vUV - 0.5) * 2.0;
  float r = length(p);
  float dotA = 1.0 - smoothstep(0.10, 0.20, r);
  float ring = smoothstep(0.78, 0.82, r) * (1.0 - smoothstep(0.92, 0.96, r));
  float ang = atan(p.x, p.y);
  float t = (ang < 0.0 ? ang + 6.2831853 : ang) / 6.2831853;
  float arc = step(t, uProgress) * step(0.001, uProgress) * smoothstep(0.70, 0.76, r) * (1.0 - smoothstep(0.98, 1.0, r));
  float a = clamp(dotA * 0.9 + ring * 0.3 + arc, 0.0, 1.0);
  vec3 c = mix(vec3(1.0), vec3(0.4, 1.0, 0.9), clamp(arc * 2.0, 0.0, 1.0));
  o = vec4(c * a, a);
}`,
  },

  // billboard point sprites for particles (additive)
  points: {
    vs: H + `
layout(location=0) in vec3 aPos; layout(location=1) in vec4 aCol; layout(location=2) in float aSize;
uniform mat4 uView, uProj; uniform float uScale;
out vec4 vCol;
void main(){
  vec4 mv = uView * vec4(aPos, 1.0);
  gl_Position = uProj * mv;
  gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 96.0);
  vCol = aCol;
}`,
    fs: H + `
in vec4 vCol; out vec4 o;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a *= a * vCol.a;
  o = vec4(vCol.rgb * a, a);
}`,
  },

  // lens-distortion pass for the Cardboard-style stereo mode
  distort: {
    vs: H + `
layout(location=0) in vec3 aPos; layout(location=2) in vec2 aUV;
out vec2 vUV;
void main(){ vUV = aUV; gl_Position = vec4(aPos.xy, 0.0, 1.0); }`,
    fs: H + `
in vec2 vUV; out vec4 o;
uniform sampler2D uMap; uniform float uK1, uK2, uZoom, uShift, uChroma, uAspect;
vec2 warp(vec2 p, float scale){
  vec2 q = vec2(p.x * uAspect, p.y);
  float r2 = dot(q, q);
  float f = 1.0 + (uK1 * r2 + uK2 * r2 * r2) * scale;
  return p * f / max(0.05, uZoom);
}
void main(){
  vec2 p = (vUV - 0.5) * 2.0;
  p.x -= uShift * 2.0;
  vec2 sr = warp(p, 1.0 + uChroma * 8.0) * 0.5 + 0.5;
  vec2 sg = warp(p, 1.0) * 0.5 + 0.5;
  vec2 sb = warp(p, 1.0 - uChroma * 8.0) * 0.5 + 0.5;
  vec3 col = vec3(texture(uMap, sr).r, texture(uMap, sg).g, texture(uMap, sb).b);
  vec2 ins = step(vec2(0.0), sg) * step(sg, vec2(1.0));
  float m = ins.x * ins.y;
  vec2 q = vec2(p.x * uAspect, p.y);
  float vig = 1.0 - smoothstep(0.82, 1.18, length(q));
  o = vec4(col * m * vig, 1.0);
}`,
  },
};
