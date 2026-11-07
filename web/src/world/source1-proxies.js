// Source 1 material proxies, run each frame for a material that has them (lasers-bake: extras.s1Proxies = { list:
// [{ name, kv }], vars: { "$name": "VMT string" } }, bake/Source1/Materials.cs Proxies). Ported from Source SDK 2013's
// game/client/mathproxy.cpp, functionproxy.cpp and texturescrollmaterialproxy.cpp; TextureTransform from the Alien
// Swarm branch CS:GO grew from. A var is { t: 'int' | 'float' | 'vec' | 'mat' | 'undef', v }; a VMT string becomes:
// "[a b c]" a vector, "{r g b}" a vector / 255, "center .. scale .. rotate .. translate .." a matrix, else a number
// (int when it has no point). "$var[i]" names one component. Results follow CResultProxy::SetFloatResult (a vector
// result without a component takes the float in every component) and CFunctionProxy::ComputeResultType (the result's
// own type, else src1's, else src2's). Time is the page clock in seconds (gpGlobals->curtime: only differences matter).
// Entity proxies (PlayerProximity, EntityRandom, ...) have no entity here: skipped, their vars keep the VMT value.
// UNSETTLED: AnimatedTexture only sets its frame var (multi-frame textures aren't baked); an int var Source would
// truncate in an int-typed op is kept as a float.

const DEFAULTS = { $color: [1, 1, 1], $color2: [1, 1, 1], $alpha: 1, $selfillumtint: [1, 1, 1], $emissiveblendtint: [1, 1, 1] };

// a 2 x 3 affine texture matrix [a b c; d e f]: u' = a u + b v + c, v' = d u + e v + f
const IDENTITY = () => [1, 0, 0, 0, 1, 0];
const mul = (p, q) => [ // p x q
  p[0] * q[0] + p[1] * q[3], p[0] * q[1] + p[1] * q[4], p[0] * q[2] + p[1] * q[5] + p[2],
  p[3] * q[0] + p[4] * q[3], p[3] * q[1] + p[4] * q[4], p[3] * q[2] + p[4] * q[5] + p[5],
];
const translate = (x, y) => [1, 0, x, 0, 1, y];
const scale = (x, y) => [x, 0, 0, 0, y, 0];
const rotate = (deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0]; };

// CMaterialVar's matrix string: T(center + translate) R S T(-center)
function parseMatrix(s) {
  const t = s.toLowerCase().split(/\s+/).filter(Boolean);
  let center = [0.5, 0.5], sc = [1, 1], rot = 0, tr = [0, 0];
  for (let i = 0; i < t.length; i++) {
    const n = (k) => { const x = Number(t[i + k]); return Number.isFinite(x) ? x : 0; };
    if (t[i] === 'center') { center = [n(1), n(2)]; i += 2; } else if (t[i] === 'scale') { sc = [n(1), n(2)]; i += 2; } else if (t[i] === 'rotate') { rot = n(1); i += 1; } else if (t[i] === 'translate') { tr = [n(1), n(2)]; i += 2; }
  }
  return mul(translate(center[0] + tr[0], center[1] + tr[1]), mul(rotate(rot), mul(scale(sc[0], sc[1]), translate(-center[0], -center[1]))));
}

export function parseVar(raw) {
  const s = String(raw ?? '').trim();
  if (/^[[{]/.test(s)) {
    const v = s.slice(1).replace(/[\]}].*$/, '').split(/\s+/).filter(Boolean).map(Number).map((x) => (Number.isFinite(x) ? x : 0));
    return { t: 'vec', v: s[0] === '{' ? v.map((x) => x / 255) : v };
  }
  if (/\b(center|scale|rotate|translate)\b/i.test(s)) return { t: 'mat', v: parseMatrix(s) };
  const x = Number(s);
  if (s !== '' && Number.isFinite(x)) return { t: /^-?\d+$/.test(s) ? 'int' : 'float', v: x };
  return { t: 'undef', v: 0 };
}

const LIMIT = 64; // proxies per material, vars per material: a hostile glb can't make a frame expensive

export class ProxySet {
  constructor(def) {
    this.vars = new Map();
    for (const [k, v] of Object.entries(def?.vars || {}).slice(0, LIMIT)) this.vars.set(k.toLowerCase(), parseVar(v));
    this.list = (Array.isArray(def?.list) ? def.list : []).slice(0, LIMIT)
      .filter((p) => p && typeof p.name === 'string' && p.kv && typeof p.kv === 'object');
    this.writes = new Set();
    for (const p of this.list) for (const k of ['resultvar', 'texturescrollvar', 'animatedtextureframenumvar']) if (typeof p.kv[k] === 'string') this.writes.add(ref(p.kv[k]).name);
    this.last = -1;
  }

  // the var (created undefined when the VMT never set it, as FindVar(..., true) does)
  get(name) {
    let v = this.vars.get(name);
    if (!v) { const d = DEFAULTS[name]; v = d === undefined ? { t: 'undef', v: 0 } : parseVar(Array.isArray(d) ? `[${d.join(' ')}]` : String(d)); this.vars.set(name, v); }
    return v;
  }

  float(s) { // a var ("$x" / "$x[i]") or a literal, as a float
    if (typeof s !== 'string') return 0;
    const r = ref(s);
    if (!r.name.startsWith('$')) { const x = Number(s); return Number.isFinite(x) ? x : 0; }
    const v = this.get(r.name);
    if (v.t === 'vec') return v.v[r.comp >= 0 ? r.comp : 0] ?? 0;
    if (v.t === 'mat') return 0;
    return v.v;
  }

  input(kv, key, dflt) { const s = kv[key]; return typeof s === 'string' ? this.float(s) : dflt; } // CFloatInput

  vec(s, n) { // a var as an n-vector (a float spreads to every component)
    const v = this.get(ref(s).name);
    if (v.t === 'vec') return Array.from({ length: n }, (_, i) => v.v[i] ?? 0);
    return Array(n).fill(v.t === 'mat' ? 0 : v.v);
  }

  setFloat(target, x) { // CResultProxy::SetFloatResult
    const r = ref(target), v = this.get(r.name);
    if (v.t === 'vec') {
      if (r.comp >= 0) { if (r.comp < 4) { while (v.v.length <= r.comp) v.v.push(0); v.v[r.comp] = x; } } else v.v = v.v.map(() => x);
    } else this.vars.set(r.name, { t: 'float', v: x });
  }

  // CFunctionProxy::ComputeResultType: [type, vector size]
  resultType(kv) {
    const r = ref(kv.resultvar || ''), res = this.get(r.name);
    if (res.t === 'vec') return r.comp >= 0 ? ['float', 0] : ['vec', res.v.length];
    if (res.t !== 'undef') return [res.t, 0];
    for (const k of ['srcvar1', 'srcvar2']) {
      if (typeof kv[k] !== 'string') continue;
      const s = this.get(ref(kv[k]).name);
      if (s.t === 'vec') return ['vec', s.v.length];
      if (s.t !== 'undef') return [s.t, 0];
    }
    return ['undef', 0];
  }

  // a two-source op, componentwise on vectors
  binary(kv, op) {
    const [t, n] = this.resultType(kv);
    if (t === 'vec') {
      const a = this.vec(kv.srcvar1, n), b = typeof kv.srcvar2 === 'string' ? this.vec(kv.srcvar2, n) : Array(n).fill(0);
      this.vars.set(ref(kv.resultvar).name, { t: 'vec', v: a.map((x, i) => op(x, b[i])) });
    } else if (t === 'float' || t === 'int') this.setFloat(kv.resultvar, op(this.float(kv.srcvar1), this.float(kv.srcvar2)));
  }

  unary(kv, op) {
    const [t, n] = this.resultType(kv);
    if (t === 'vec') this.vars.set(ref(kv.resultvar).name, { t: 'vec', v: this.vec(kv.srcvar1, n).map(op) });
    else if (t === 'float' || t === 'int') this.setFloat(kv.resultvar, op(this.float(kv.srcvar1)));
  }

  // run every proxy once for time t (seconds); once per frame however many draws use the material
  run(t) {
    if (t === this.last) return;
    this.last = t;
    for (const { name, kv } of this.list) {
      if (typeof kv.resultvar !== 'string' && !['texturescroll', 'animatedtexture'].includes(name)) continue;
      switch (name) {
        case 'add': this.binary(kv, (a, b) => a + b); break;
        case 'subtract': this.binary(kv, (a, b) => a - b); break;
        case 'multiply': this.binary(kv, (a, b) => a * b); break;
        case 'divide': this.binary(kv, (a, b) => (b !== 0 ? a / b : a)); break;
        case 'equals': this.unary(kv, (a) => a); break;
        case 'abs': this.unary(kv, (a) => Math.abs(a)); break;
        case 'frac': this.unary(kv, (a) => a - Math.trunc(a)); break;
        case 'int': this.unary(kv, (a) => Math.trunc(a)); break;
        case 'clamp': {
          let lo = this.input(kv, 'min', 0), hi = this.input(kv, 'max', 1);
          if (lo > hi) [lo, hi] = [hi, lo];
          this.unary(kv, (a) => Math.min(hi, Math.max(lo, a)));
          break;
        }
        case 'selectfirstifnonzero': {
          const [tp, n] = this.resultType(kv);
          if (tp === 'vec') { const a = this.vec(kv.srcvar1, n); this.vars.set(ref(kv.resultvar).name, { t: 'vec', v: a.some((x) => x !== 0) ? a : this.vec(kv.srcvar2, n) }); } else { const a = this.float(kv.srcvar1); this.setFloat(kv.resultvar, a || this.float(kv.srcvar2)); }
          break;
        }
        case 'sine': {
          let per = this.input(kv, 'sineperiod', 1);
          if (per === 0) per = 1;
          const lo = this.input(kv, 'sinemin', 0), hi = this.input(kv, 'sinemax', 1), off = this.input(kv, 'timeoffset', 0);
          this.setFloat(kv.resultvar, (hi - lo) * (Math.sin((2 * Math.PI * (t - off)) / per) * 0.5 + 0.5) + lo);
          break;
        }
        case 'linearramp': this.setFloat(kv.resultvar, this.input(kv, 'rate', 1) * t + this.input(kv, 'initialvalue', 0)); break;
        case 'uniformnoise': { const lo = this.input(kv, 'minval', 0), hi = this.input(kv, 'maxval', 1); this.setFloat(kv.resultvar, lo + Math.random() * (hi - lo)); break; }
        case 'gaussiannoise': {
          let lo = this.input(kv, 'minval', -Infinity), hi = this.input(kv, 'maxval', Infinity);
          if (lo > hi) [lo, hi] = [hi, lo];
          const g = Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
          this.setFloat(kv.resultvar, Math.min(hi, Math.max(lo, this.input(kv, 'mean', 0) + g * this.input(kv, 'halfwidth', 1))));
          break;
        }
        case 'exponential': {
          let lo = this.input(kv, 'minval', 0), hi = this.input(kv, 'maxval', 1);
          if (lo > hi) [lo, hi] = [hi, lo];
          const x = this.input(kv, 'scale', 1) * Math.exp(this.float(kv.srcvar1) + this.input(kv, 'offset', 0));
          this.setFloat(kv.resultvar, Math.min(hi, Math.max(lo, x)));
          break;
        }
        case 'lessorequal': {
          const src = this.float(kv.srcvar1) <= this.float(kv.srcvar2) ? kv.lessequalvar : kv.greatervar;
          if (typeof src !== 'string') break;
          const r = ref(kv.resultvar), res = this.get(r.name), s = this.get(ref(src).name);
          if ((res.t === 'vec' && r.comp < 0) || (res.t === 'undef' && s.t === 'vec')) this.vars.set(r.name, { t: 'vec', v: this.vec(src, res.t === 'vec' ? res.v.length : s.v.length) });
          else this.setFloat(kv.resultvar, this.float(src));
          break;
        }
        case 'wrapminmax': {
          const lo = this.input(kv, 'minval', 0), hi = this.input(kv, 'maxval', 1);
          if (hi <= lo) { this.setFloat(kv.resultvar, lo); break; }
          let f = (this.float(kv.srcvar1) - lo) / (hi - lo);
          f -= f >= 0 ? Math.trunc(f) : Math.trunc(f) - 1;
          this.setFloat(kv.resultvar, f * (hi - lo) + lo);
          break;
        }
        case 'texturescroll': {
          if (typeof kv.texturescrollvar !== 'string') break;
          const rate = this.input(kv, 'texturescrollrate', 1), ang = (this.input(kv, 'texturescrollangle', 0) * Math.PI) / 180, sc = this.input(kv, 'texturescale', 1);
          let s = t * Math.cos(ang) * rate, u = t * Math.sin(ang) * rate;
          if (s < 0) s += 1 + -Math.trunc(s);
          if (u < 0) u += 1 + -Math.trunc(u);
          s -= Math.trunc(s); u -= Math.trunc(u);
          const name = ref(kv.texturescrollvar).name, cur = this.get(name);
          if (cur.t === 'vec') cur.v = [s, u, ...cur.v.slice(2)];
          else this.vars.set(name, { t: 'mat', v: [sc, 0, s, 0, sc, u] });
          break;
        }
        case 'texturetransform': {
          const c = typeof kv.centervar === 'string' ? this.vec(kv.centervar, 2) : [0.5, 0.5];
          let m = translate(-c[0], -c[1]);
          if (typeof kv.scalevar === 'string') { const s = this.vec(kv.scalevar, 2); m = mul(scale(s[0], s[1]), m); }
          if (typeof kv.rotatevar === 'string') m = mul(rotate(this.float(kv.rotatevar)), m);
          m = mul(translate(c[0], c[1]), m);
          if (typeof kv.translatevar === 'string') { const tr = this.vec(kv.translatevar, 2); m = mul(translate(tr[0], tr[1]), m); }
          this.vars.set(ref(kv.resultvar).name, { t: 'mat', v: m });
          break;
        }
        case 'animatedtexture': {
          if (typeof kv.animatedtextureframenumvar !== 'string') break;
          this.setFloat(kv.animatedtextureframenumvar, Math.trunc(t * this.input(kv, 'animatedtextureframerate', 15)));
          break;
        }
        default: break; // an entity proxy, or one the SDK doesn't have
      }
    }
  }

  // the var as an rgb (a float spreads), a float, or a texture matrix; null when the proxies never write it
  rgb(name) { if (!this.writes.has(name)) return null; const v = this.get(name); return v.t === 'vec' ? [v.v[0] ?? 0, v.v[1] ?? 0, v.v[2] ?? 0] : v.t === 'mat' ? null : [v.v, v.v, v.v]; }
  num(name) { if (!this.writes.has(name)) return null; const v = this.get(name); return v.t === 'vec' ? v.v[0] ?? 0 : v.t === 'mat' ? null : v.v; }
  matrix(name) { if (!this.writes.has(name)) return null; const v = this.get(name); return v.t === 'mat' ? v.v : null; }
}

// "$name[2]" -> { name: "$name", comp: 2 } (comp -1 without one)
function ref(s) {
  const m = /^\s*([^[\s]+)\s*(?:\[\s*(\d+)\s*\])?/.exec(String(s));
  return { name: (m?.[1] || '').toLowerCase(), comp: m?.[2] !== undefined ? Number(m[2]) : -1 };
}

export const IDENTITY_MATRIX = IDENTITY;
