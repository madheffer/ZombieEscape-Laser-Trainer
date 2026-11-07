// A Source 1 map's HDR auto-exposure: the tonemap scale its lightmapped surfaces and models are drawn with
// (source1-light.js source1Exposure), measured from the frame and clamped to the map's env_tonemap_controller limits
// (entities/classes/tonemap-controller.js). Source SDK 2013's "new algorithm" (viewpostprocess.cpp, mat_tonemap_algorithm 1):
//   - a luminance histogram of the screen's centre region (mat_exposure_center_region_x / _y), in linear space
//     ("Histogram luminance is in linear space", CS:GO client.dll), of the frame as drawn with the current scale;
//   - the luminance above which mat_tonemap_percent_bright_pixels % of the pixels lie is brought to
//     mat_tonemap_percent_target %: target = scale x (target% / that luminance);
//   - unless that leaves the average under mat_tonemap_min_avglum %: then target = scale x (min% / average);
//   - clamped to [mat_autoexposure_min, mat_autoexposure_max], or the controller's custom min / max;
//   - the scale moves toward the target at the tonemap rate per second, mat_accelerate_adjust_exposure_down times
//     faster going down.
// CS:GO's client.dll has the controls (mat_autoexposure_min / max, mat_exposure_center_region_x / y,
// mat_accelerate_adjust_exposure_down, mat_force_tonemap_percent_target "Override. Old default was 60.",
// mat_force_tonemap_percent_bright_pixels "Override. Old value was 2.0", the min avglum "Old default was 3.0"): the
// map's controller supplies those three now.
// UNSETTLED: the numbers below are SDK 2013's cvar defaults, not read out of CS:GO's binaries; the histogram's
// bins are replaced by the exact percentile of a 64 x 32 downsample of the centre region, read back 10 times a second.
import * as THREE from 'three';
import { tonemapSettings } from './entities/classes/tonemap-controller.js';
import { source1Exposure, setSource1Exposure } from './source1-light.js';

export const TONEMAP_DEFAULTS = {
  exposureMin: 0.5, exposureMax: 2, // mat_autoexposure_min / max
  percentTarget: 60, percentBright: 2, minAvgLum: 3, // mat_tonemap_percent_target / _bright_pixels / _min_avglum
  rate: 1, // the controller's tonemap rate
};
const CENTER = [0.9, 0.85]; // mat_exposure_center_region_x / _y
const ACCEL_DOWN = 3; // mat_accelerate_adjust_exposure_down
const W = 64, H = 32;
const PERIOD = 0.1; // s between read-backs
const LUM = 'vec3(0.2125, 0.7154, 0.0721)'; // Source's luminance weights (the histogram's)

const FS = `uniform sampler2D tHdr; uniform vec2 uRegion; varying vec2 vUv;
void main() {
  // 4 taps per destination texel across the part of the centre region it covers
  vec2 uv = 0.5 + (vUv - 0.5) * uRegion, d = uRegion / vec2(${W}.0, ${H}.0) * 0.25;
  vec3 c = texture2D(tHdr, uv + vec2(-d.x, -d.y)).rgb + texture2D(tHdr, uv + vec2(d.x, -d.y)).rgb
    + texture2D(tHdr, uv + vec2(-d.x, d.y)).rgb + texture2D(tHdr, uv + vec2(d.x, d.y)).rgb;
  gl_FragColor = vec4(vec3(dot(max(c * 0.25, vec3(0.0)), ${LUM})), 1.0);
}`;

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
    this.lum = new Float32Array(W * H);
    this.goal = null; // the scale the last read-back asked for (null: none yet, the next one snaps)
    this.busy = false;
    this.lastRead = -Infinity;
    this.lastTime = null;
  }

  // engine: the run's (null between runs: the defaults); hdr: the renderer's HDR target from the last frame
  update(renderer, engine, now = performance.now() / 1000) {
    const s = { ...TONEMAP_DEFAULTS, ...(tonemapSettings(engine) || {}) };
    const lo = Math.max(0.001, s.exposureMin), hi = Math.max(lo, s.exposureMax);
    const dt = this.lastTime == null ? 0 : Math.min(0.25, Math.max(0, now - this.lastTime));
    this.lastTime = now;
    let cur = source1Exposure.value;
    if (this.goal != null) {
      const goal = Math.min(hi, Math.max(lo, this.goal));
      const rate = Math.max(0, s.rate) * (goal < cur ? ACCEL_DOWN : 1);
      cur += (goal - cur) * Math.min(1, rate * dt);
    }
    setSource1Exposure(Math.min(hi, Math.max(lo, cur)));
    if (!this.busy && now - this.lastRead >= PERIOD && renderer?.hdr) this.read(renderer, s, lo, hi, now);
  }

  read(R, s, lo, hi, now) {
    const r = R.renderer;
    this.lastRead = now;
    this.mat.uniforms.tHdr.value = R.hdr.texture;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.target);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
    const drawnWith = source1Exposure.value; // the frame was drawn at the scale in force now
    this.busy = true;
    r.readRenderTargetPixelsAsync(this.target, 0, 0, W, H, this.pixels)
      .then((px) => { this.measure(px, drawnWith, s, lo, hi); })
      .catch(() => {})
      .finally(() => { this.busy = false; });
  }

  measure(px, scale, s, lo, hi) {
    const n = W * H, lum = this.lum;
    let sum = 0;
    for (let i = 0; i < n; i++) { const l = px[i * 4]; lum[i] = Number.isFinite(l) ? l : 0; sum += lum[i]; }
    const avg = sum / n;
    lum.sort();
    const bright = lum[Math.min(n - 1, Math.floor(n * (1 - s.percentBright / 100)))];
    let k = bright > 1e-4 ? (s.percentTarget / 100) / bright : hi / Math.max(scale, 1e-4);
    if (avg > 1e-5 && avg * k < s.minAvgLum / 100) k = (s.minAvgLum / 100) / avg;
    const first = this.goal == null;
    this.goal = Math.min(hi, Math.max(lo, scale * k));
    if (first) setSource1Exposure(this.goal); // a map's first frames take the measured scale at once
  }

  // a new map / stage: forget the last measurement (the next one snaps)
  reset() { this.goal = null; this.lastTime = null; }

  dispose() { this.target.dispose(); this.mat.dispose(); }
}
