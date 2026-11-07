// A Source 1 map's HDR auto-exposure: the tonemap scale its lightmapped surfaces and models are drawn with
// (source1-light.js source1Exposure), as CS:GO's client.dll computes it (csgo legacy bin, Ghidra /client.dll.3), within
// the map's env_tonemap_controller limits (entities/classes/tonemap-controller.js).
//   The histogram (FUN_10399220, mat_tonemap_algorithm 1, the default): 16 bins of linear luminance, bin i from
//     (i/16)^2.5 to ((i+1)/16)^2.5, counted over the screen's centre region (mat_exposure_center_region_x 0.9,
//     _y 0.85) of the frame as drawn with the current scale (the integer HDR frame buffer: colour clamped to 1).
//   FindLocationOfPercentBrightPixels(pct, snap) (FUN_10398750): from the brightest bin down, the first bin where the
//     share of pixels counted so far reaches pct %: snap % if it falls inside that bin, else max - (max - min) x
//     (pct% - share above) / the bin's share, kept inside the bin; -1 with no pixels.
//   The target (FUN_103988f0): L = location(percentBright, percentTarget) (-1 -> percentTarget %), at least 0.0001;
//     scalar = percentTarget % / L; the median m = location(50, no snap): with m > 0, scalar is at least minAvgLum % / m;
//     new = max(current x scalar, 0.001). percentTarget 65, percentBright 2, minAvgLum 3 unless the controller (or
//     mat_force_tonemap_*) says otherwise (TONEMAP_DEFAULTS).
//   SetToneMapScale(new, min, max) (FUN_1039abb0): a ring of the last 10 values; once full, the goal is their
//     weighted mean (weights 1 .8 .6 .4 .2 0 .2 .4 .6 .8 from the oldest, x 0.2) clamped to [min, max]; before that
//     the goal is the new value as it is. Each frame: rate = the controller's tonemap rate (1) x 2 (algorithm 1); going
//     down, accel = mat_accelerate_adjust_exposure_down (40) x rate and rate = (current - goal) x (accel - rate) x 2/3
//     + rate, at most accel; step = rate x frame time, at most 1/64; current = lerp(current, goal, step).
//   [min, max] = mat_autoexposure_min / max (0.5 / 2) or the controller's custom values. The scale starts at 1
//     (FUN_10398440); a new stage starts it at 1 again with an empty ring.
// UNSETTLED: the luminance weights of dev/lumcompare (Rec. 709 here); the histogram is read back from a 64 x 32
// downsample every frame we can (CS:GO counts it with occlusion queries a frame or two late); whether a stage start
// matches where CS:GO resets the scale (it was 1 at map load).
import * as THREE from 'three';
import { tonemapSettings } from './entities/classes/tonemap-controller.js';
import { setSource1Exposure } from './source1-light.js';

export const TONEMAP_DEFAULTS = {
  exposureMin: 0.5, exposureMax: 2, // mat_autoexposure_min / max
  // client.dll FUN_10226ef0 writes these every frame: the player's controller's networked values (CS:GO server.dll's
  // CEnvTonemapController constructor FUN_1026dbd0: 65 / 2 / 3, rate 1), or with none the same 65 / 2 / 3 / 1
  // (mat_force_tonemap_* overrides default -1: "Old default was 60.")
  percentTarget: 65, percentBright: 2, minAvgLum: 3,
  rate: 1, // the controller's tonemap rate (client.dll static 0x10db51f0)
};
const CENTER = [0.9, 0.85]; // mat_exposure_center_region_x / _y
const ACCEL_DOWN = 40; // mat_accelerate_adjust_exposure_down
const MAX_STEP = 1 / 64;
const BINS = 16;
const EDGES = Array.from({ length: BINS + 1 }, (_, i) => (i / BINS) ** 2.5);
const RING = 10;
const RING_WEIGHTS = [1, 0.8, 0.6, 0.4, 0.2, 0, 0.2, 0.4, 0.6, 0.8]; // oldest first
const W = 64, H = 32;
const LUM = 'vec3(0.2125, 0.7154, 0.0721)';

const FS = `uniform sampler2D tHdr; uniform vec2 uRegion; varying vec2 vUv;
vec3 tap(vec2 uv) { return clamp(texture2D(tHdr, uv).rgb, 0.0, 1.0); }
void main() {
  // 4 taps per destination texel across the part of the centre region it covers, each clamped to 1 first
  vec2 uv = 0.5 + (vUv - 0.5) * uRegion, d = uRegion / vec2(${W}.0, ${H}.0) * 0.25;
  vec3 c = tap(uv + vec2(-d.x, -d.y)) + tap(uv + vec2(d.x, -d.y)) + tap(uv + vec2(-d.x, d.y)) + tap(uv + vec2(d.x, d.y));
  gl_FragColor = vec4(vec3(dot(c * 0.25, ${LUM})), 1.0);
}`;

// FindLocationOfPercentBrightPixels over bin counts: the luminance with pct % of the pixels above it
export function percentLocation(counts, pct, snap) {
  const total = counts.reduce((s, n) => s + n, 0);
  if (!total) return -1;
  let above = 0;
  for (let i = BINS - 1; i >= 0; i--) {
    const share = counts[i] / total;
    if (share >= pct * 0.01 - above) {
      const lo = EDGES[i], hi = EDGES[i + 1];
      if (snap >= 0 && lo <= snap * 0.01 && snap * 0.01 <= hi) return snap * 0.01;
      const loc = hi - (hi - lo) * ((pct * 0.01 - above) / share);
      return Math.max(lo, Math.min(hi, loc));
    }
    above += share;
  }
  return -1;
}

export class Source1AutoExposure {
  constructor() {
    this.target = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, depthBuffer: false });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tHdr: { value: null }, uRegion: { value: new THREE.Vector2(...CENTER) } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FS, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.pixels = new Float32Array(W * H * 4);
    this.counts = new Array(BINS).fill(0);
    this.busy = false;
    this.reset();
  }

  // a new stage: the scale back to 1, the ring empty
  reset() {
    this.current = 1;
    this.goal = 1;
    this.ring = [];
    this.lastTime = null;
    this.gen = (this.gen || 0) + 1; // a read-back still in flight belongs to the last stage
    setSource1Exposure(1);
  }

  // engine: the run's (null between runs: the defaults); renderer.hdr: the frame drawn last
  update(renderer, engine, now = performance.now() / 1000) {
    const s = { ...TONEMAP_DEFAULTS, ...(tonemapSettings(engine) || {}) };
    this.settings = s;
    const dt = this.lastTime == null ? 0 : Math.max(0, now - this.lastTime);
    this.lastTime = now;
    let rate = Math.max(0, s.rate) * 2;
    if (rate === 0) this.current = this.goal;
    else {
      if (this.goal < this.current) {
        const accel = ACCEL_DOWN * rate;
        rate = Math.min(accel, (this.current - this.goal) * (accel - rate) * (2 / 3) + rate);
      }
      const step = Math.min(MAX_STEP, Math.max(0, rate * dt));
      const next = (1 - step) * this.current + this.goal * step;
      if (Number.isFinite(next)) this.current = next;
    }
    setSource1Exposure(this.current);
    if (!this.busy && renderer?.hdr) this.read(renderer);
  }

  read(R) {
    const r = R.renderer;
    this.mat.uniforms.tHdr.value = R.hdr.texture;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.target);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
    const drawnWith = this.current, gen = this.gen;
    this.busy = true;
    r.readRenderTargetPixelsAsync(this.target, 0, 0, W, H, this.pixels)
      .then((px) => { if (gen === this.gen) this.measure(px, drawnWith); })
      .catch(() => {})
      .finally(() => { this.busy = false; });
  }

  measure(px, scale) {
    const s = this.settings || TONEMAP_DEFAULTS;
    const counts = this.counts.fill(0);
    for (let i = 0; i < W * H; i++) {
      const l = px[i * 4];
      if (!(l >= 0)) continue;
      let b = 0;
      while (b < BINS - 1 && l >= EDGES[b + 1]) b++;
      counts[b]++;
    }
    let L = percentLocation(counts, s.percentBright, s.percentTarget);
    if (L < 0) L = s.percentTarget * 0.01;
    L = Math.max(L, 0.0001);
    let scalar = (s.percentTarget * 0.01) / L;
    const median = percentLocation(counts, 50, -1);
    if (median > 0) scalar = Math.max((s.minAvgLum * 0.01) / median, scalar);
    this.toneMapScale(Math.max(scale * scalar, 0.001), s);
  }

  // SetToneMapScale: the ring of 10, its weighted mean clamped once full
  toneMapScale(value, s) {
    if (!Number.isFinite(value)) return;
    this.ring.push(value);
    if (this.ring.length > RING) this.ring.shift();
    if (this.ring.length < RING) { this.goal = value; return; }
    const lo = Math.max(0.001, s.exposureMin), hi = Math.max(lo, s.exposureMax);
    const mean = this.ring.reduce((sum, v, i) => sum + v * RING_WEIGHTS[i], 0) * 0.2;
    this.goal = Math.min(hi, Math.max(lo, mean));
  }

  dispose() { this.target.dispose(); this.mat.dispose(); }
}
