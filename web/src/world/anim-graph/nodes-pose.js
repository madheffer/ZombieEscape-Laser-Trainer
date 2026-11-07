// Pose nodes of CS2's anim graphs: clips, blend spaces, selectors, time scaling, layers and referenced graphs,
// after Esoterica's AnimationClip / Blend1D / Blend2D / Selector / SpeedScale / Layers / ReferencedGraph nodes.
// update(ctx, range) -> { pose, events: [start, end) }; `range` is a sync range when a parent drives the timing.
import { PoseNode } from './nodes-base.js';
import { SyncTrack, syncedDuration, DEFAULT_TRACK } from './sync-track.js';
import { blend, additive, modelSpaceBlend } from './pose.js';

const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;
const loopPct = (v) => { const f = v - Math.trunc(v); return v > 0 && f === 0 ? 1 : f; };
const clampPct = (v, loop) => (loop ? loopPct(v) : Math.min(1, Math.max(0, v)));

// a pose for a node that produced none: zero in an additive layer, the reference pose otherwise
export function fallbackPose(ctx) { const p = ctx.pose(); return ctx.layer?.additive ? p.setZero() : p.setRef(); }
export function joinEvents(ctx, a, b, w) {
  for (let i = a[0]; i < a[1]; i++) ctx.events[i].weight *= 1 - w;
  for (let i = b[0]; i < b[1]; i++) ctx.events[i].weight *= w;
  return [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
}

// --- clips
class Clip extends PoseNode {
  get clip() { if (this._clip === undefined) this._clip = this.g.clipForSlot(this.d.m_nDataSlotIdx); return this._clip; }
  valid() { return !!this.clip; }
  syncTrack() {
    if (!this.clip) return DEFAULT_TRACK;
    const off = this.d.m_nStartSyncEventOffset || 0;
    if (!off) return this.clip.sync;
    return (this._track ||= new SyncTrack(this.clip.sync.events, off));
  }
  onInit(ctx, t) {
    super.onInit(ctx, t);
    if (!this.clip) return;
    this.duration = this.clip.duration / (this.d.m_flSpeedMultiplier || 1);
    this.cur = this.prev = this.syncTrack().percentage(t || { idx: 0, pct: 0 });
    this.first = true;
  }
  update(ctx, range) {
    if (!this.clip) return { pose: null, events: ctx.emptyRange() };
    let looped = false;
    if (range) {
      if (this.clip.singleFrame) this.prev = this.cur = 1;
      else {
        const tr = this.syncTrack();
        this.prev = tr.percentage(range.start); this.cur = tr.percentage(range.end);
        looped = this.cur < this.prev;
      }
    } else {
      const reset = this.d.m_nResetTimeValueNodeIdx >= 0 && this.n(this.d.m_nResetTimeValueNodeIdx).value(ctx);
      if (reset) this.prev = this.cur = 0;
      if (this.clip.singleFrame) { this.prev = this.first ? 0 : 1; this.cur = 1; }
      else {
        const d = this.duration > 0 ? ctx.dt / this.duration : 0;
        this.prev = this.cur;
        if (!this.d.m_bAllowLooping) this.cur = Math.min(1, Math.max(0, this.prev + d));
        else { this.cur += d; if (this.cur > 1) { this.cur = loopPct(this.cur); looped = true; } }
      }
    }
    const start = ctx.events.length;
    if (looped) { this.sampleEvents(ctx, this.prev, 1); this.sampleEvents(ctx, 0, this.cur); }
    else this.sampleEvents(ctx, this.prev, this.cur);
    for (const id of this.d.m_graphEvents || []) ctx.graphEvent(this, id, 'Generic');
    this.first = false;
    return { pose: this.clip.sample(this.cur, ctx.pose()), events: [start, ctx.events.length] };
  }
  sampleEvents(ctx, from, to) {
    const trailing = to === 1;
    for (const e of this.clip.events) {
      if (e.t > to) break;
      const end = e.t + e.d;
      if (!(from <= end && e.t <= to)) continue; // FloatRange overlap
      if (!trailing && e.t === to) continue;
      if (e.cls !== 'IDEvent' && e.cls !== 'LegacyEvent' && !e.id) continue;
      ctx.events.push({ anim: true, id: e.id, type: e.cls, active: ctx.active, ignored: false, weight: 1, node: this });
    }
  }
}

// a clip held at one time (a pose): m_flUserSpecifiedTime as a percentage, or frames with m_bUseFramesAsInput
class AnimationPose extends Clip {
  onInit(ctx, t) { super.onInit(ctx, t); this.duration = 0; this.prev = this.cur = 0; }
  update(ctx) {
    if (!this.clip) return { pose: null, events: ctx.emptyRange() };
    let v = this.d.m_nPoseTimeValueNodeIdx >= 0 ? this.n(this.d.m_nPoseTimeValueNodeIdx).value(ctx) : this.d.m_flUserSpecifiedTime;
    const r = this.d.m_inputTimeRemapRange;
    if (r && r.m_flMin < r.m_flMax) v = (v - r.m_flMin) / (r.m_flMax - r.m_flMin);
    let pct = this.d.m_bUseFramesAsInput ? (this.clip.frames > 1 ? v / (this.clip.frames - 1) : 0) : v;
    pct = Math.min(1, Math.max(0, pct || 0));
    return { pose: this.clip.sample(pct, ctx.pose()), events: ctx.emptyRange() };
  }
}

class ZeroPose extends PoseNode {
  update(ctx) { return { pose: ctx.pose().setZero(), events: ctx.emptyRange() }; }
}
class ReferencePose extends PoseNode {
  update(ctx) { return { pose: ctx.pose().setRef(), events: ctx.emptyRange() }; }
}

// --- blend spaces
class Blend1D extends PoseNode {
  get sources() { return this.d.m_sourceNodeIndices.map((i) => this.n(i)); }
  get param() { return this.n(this.d.m_nInputParameterValueNodeIdx); }
  onInit(ctx, t) {
    super.onInit(ctx, t);
    this.param.init(ctx);
    for (const s of this.sources) s.init(ctx, t);
    this.evaluate(ctx, true);
    this.prev = this.cur = this.track.percentage(t || { idx: 0, pct: 0 });
  }
  onShutdown(ctx) { for (const s of this.sources) s.shutdown(ctx); this.param.shutdown(ctx); this.evalId = -1; }
  syncTrack() { return this.track || DEFAULT_TRACK; }
  evaluate(ctx, force = false) {
    if (!force && this.evalId === ctx.updateId) return;
    this.evalId = ctx.updateId;
    const P = this.d.m_parameterization, srcs = this.sources;
    const v = Math.min(P.m_parameterRange.m_flMax, Math.max(P.m_parameterRange.m_flMin, this.param.value(ctx) ?? 0));
    let range = P.m_blendRanges[0], w = 0;
    for (const r of P.m_blendRanges) {
      const a = r.m_parameterValueRange.m_flMin, b = r.m_parameterValueRange.m_flMax;
      if (v >= a && v <= b) { range = r; w = b > a ? (v - a) / (b - a) : 0; break; }
    }
    if (near(w, 0)) { this.s0 = srcs[range.m_nInputIdx0]; this.s1 = null; }
    else if (near(w, 1)) { this.s0 = srcs[range.m_nInputIdx1]; this.s1 = null; }
    else { this.s0 = srcs[range.m_nInputIdx0]; this.s1 = srcs[range.m_nInputIdx1]; }
    this.w = w;
    this.pair(this.s0, this.s1, w);
  }
  pair(s0, s1, w) {
    if (!s1) { this.track = SyncTrack.blend(s0.syncTrack(), s0.syncTrack(), 0); this.duration = s0.duration; return; }
    const t0 = s0.syncTrack(), t1 = s1.syncTrack();
    this.track = SyncTrack.blend(t0, t1, w);
    this.duration = syncedDuration(s0.duration, s1.duration, t0.count, t1.count, this.track.count, w);
  }
  range(ctx, range) {
    if (range) return range;
    const d = this.duration > 0 ? ctx.dt / this.duration : 0;
    return { start: this.track.time(this.cur), end: this.track.time(clampPct(this.cur + d, this.d.m_bAllowLooping)) };
  }
  update(ctx, extRange) {
    this.evaluate(ctx);
    const r = this.range(ctx, extRange);
    let res;
    if (!this.s1) res = this.s0.valid() ? this.s0.update(ctx, r) : { pose: null, events: ctx.emptyRange() };
    else {
      const a = this.s0.valid() ? this.s0.update(ctx, r) : { pose: null, events: ctx.emptyRange() };
      const b = this.s1.valid() ? this.s1.update(ctx, r) : { pose: null, events: ctx.emptyRange() };
      const pa = a.pose || fallbackPose(ctx), pb = b.pose || fallbackPose(ctx);
      res = { pose: blend(ctx.pose(), pa, pb, this.w), events: joinEvents(ctx, a.events, b.events, this.w) };
    }
    this.prev = this.track.percentage(r.start);
    this.cur = this.track.percentage(r.end);
    return res;
  }
}

// barycentric weights in the triangulated blend space, or the closest hull edge outside it (Esoterica Blend2DNode)
function bary(p, a, b, c) {
  const v0x = b[0] - a[0], v0y = b[1] - a[1], v1x = c[0] - a[0], v1y = c[1] - a[1], v2x = p[0] - a[0], v2y = p[1] - a[1];
  const d = v0x * v1y - v1x * v0y;
  if (Math.abs(d) < 1e-9) return null;
  const v = (v2x * v1y - v1x * v2y) / d, w = (v0x * v2y - v2x * v0y) / d, u = 1 - v - w;
  const e = -1e-5;
  return u >= e && v >= e && w >= e ? [u, v, w] : null;
}
class Blend2D extends Blend1D {
  get param() { return this.n(this.d.m_nInputParameterNodeIdx0); }
  onInit(ctx, t) { this.n(this.d.m_nInputParameterNodeIdx1).init(ctx); super.onInit(ctx, t); }
  onShutdown(ctx) { super.onShutdown(ctx); this.n(this.d.m_nInputParameterNodeIdx1).shutdown(ctx); }
  evaluate(ctx, force = false) {
    if (!force && this.evalId === ctx.updateId) return;
    this.evalId = ctx.updateId;
    const V = this.d.m_values, I = this.d.m_indices, H = this.d.m_hullIndices, srcs = this.sources;
    const p = [this.param.value(ctx) ?? 0, this.n(this.d.m_nInputParameterNodeIdx1).value(ctx) ?? 0];
    let idx = [-1, -1, -1], w01 = 0, w12 = 0, found = false;
    for (let i = 0; i < I.length; i += 3) {
      const bc = bary(p, V[I[i]], V[I[i + 1]], V[I[i + 2]]);
      if (!bc) continue;
      const iw = [[I[i], bc[0]], [I[i + 1], bc[1]], [I[i + 2], bc[2]]].sort((x, y) => x[1] - y[1]);
      if (near(iw[2][1], 1)) idx = [iw[2][0], -1, -1];
      else { idx = [iw[0][0], iw[1][0], iw[2][0]]; w01 = iw[1][1] / (iw[0][1] + iw[1][1]); w12 = iw[2][1]; }
      found = true;
      break;
    }
    if (!found) {
      let best = Infinity;
      for (let i = 1; i < H.length; i++) {
        const a = V[H[i - 1]], b = V[H[i]];
        const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
        const t = L > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
        const cx = a[0] + dx * t - p[0], cy = a[1] + dy * t - p[1], dd = cx * cx + cy * cy;
        if (dd < best) { best = dd; idx = [H[i - 1], H[i], -1]; w01 = t; w12 = 0; }
      }
    }
    if (idx[0] >= 0) {
      if (near(w01, 1)) { idx = [idx[1], idx[2], -1]; w01 = w12; w12 = 0; }
      else if (near(w01, 0)) { if (idx[2] < 0) idx[1] = -1; else { idx = [idx[1], idx[2], -1]; w01 = w12; w12 = 0; } }
    }
    this.s0 = srcs[idx[0]] || srcs[0]; this.s1 = idx[1] >= 0 ? srcs[idx[1]] : null; this.s2 = idx[2] >= 0 ? srcs[idx[2]] : null;
    this.w = w01; this.w12 = w12;
    this.pair(this.s0, this.s1, w01);
    if (this.s2) {
      const d2 = this.duration, n2 = this.track.count, t2 = this.s2.syncTrack();
      this.track = SyncTrack.blend(this.track, t2, w12);
      this.duration = syncedDuration(d2, this.s2.duration, n2, t2.count, this.track.count, w12);
    }
  }
  update(ctx, extRange) {
    const res = super.update(ctx, extRange);
    if (!this.s2) return res;
    const r = this.lastRange;
    const c = this.s2.valid() ? this.s2.update(ctx, r) : { pose: null, events: ctx.emptyRange() };
    if (res.pose && c.pose) return { pose: blend(ctx.pose(), res.pose, c.pose, this.w12), events: joinEvents(ctx, res.events, c.events, this.w12) };
    return res.pose ? res : c;
  }
  range(ctx, range) { return (this.lastRange = super.range(ctx, range)); }
}

// --- selectors: one option chosen when initialized
class Selector extends PoseNode {
  get options() { return this.d.m_optionNodeIndices; }
  choose(ctx) {
    const conds = this.d.m_conditionNodeIndices || [];
    for (const c of conds) this.n(c).init(ctx);
    let pick = -1;
    for (let i = 0; i < this.options.length; i++) if (this.n(conds[i])?.value(ctx)) { pick = i; break; }
    for (const c of conds) this.n(c).shutdown(ctx);
    return pick;
  }
  onInit(ctx, t) {
    super.onInit(ctx, t);
    const i = this.choose(ctx);
    this.sel = i >= 0 ? this.n(this.options[i]) : null;
    if (this.sel) {
      this.sel.init(ctx, t);
      if (this.sel.valid()) this.takeTime(this.sel); else { this.sel.shutdown(ctx); this.sel = null; }
    }
  }
  onShutdown(ctx) { this.sel?.shutdown(ctx); this.sel = null; }
  valid() { return !!this.sel; }
  syncTrack() { return this.sel ? this.sel.syncTrack() : DEFAULT_TRACK; }
  get clip() { return this.sel?.clip ?? null; }
  update(ctx, range) {
    if (!this.sel) return { pose: null, events: ctx.emptyRange() };
    const r = this.sel.update(ctx, range);
    this.takeTime(this.sel);
    return r;
  }
}
// an option picked by a parameter: floor(|value|) into the weighted option list (Esoterica SelectWeightedOption)
class ParameterizedSelector extends Selector {
  choose(ctx) {
    const opts = this.options, weights = [], virtual = [];
    opts.forEach((o, i) => { const w = this.d.m_bHasWeightsSet ? this.d.m_optionWeights[i] : 1; for (let k = 0; k < w; k++) virtual.push(i); weights.push(w); });
    if (!virtual.length) return -1;
    const p = this.n(this.d.m_parameterNodeIdx);
    p.init(ctx);
    const v = p.value(ctx) ?? 0;
    p.shutdown(ctx);
    return virtual[Math.floor(Math.abs(v)) % virtual.length];
  }
}

// --- passthrough + time scaling
class Passthrough extends PoseNode {
  get child() { return this.n(this.d.m_nChildNodeIdx); }
  onInit(ctx, t) { super.onInit(ctx, t); this.child.init(ctx, t); if (this.child.valid()) this.takeTime(this.child); }
  onShutdown(ctx) { this.child.shutdown(ctx); }
  valid() { return this.child.valid(); }
  syncTrack() { return this.child.valid() ? this.child.syncTrack() : DEFAULT_TRACK; }
  update(ctx, range) { const r = this.child.update(ctx, range); this.takeTime(this.child); return r; }
}
class SpeedScale extends Passthrough {
  scale(ctx) {
    const i = this.d.m_nInputValueNodeIdx;
    const v = i >= 0 ? this.n(i).value(ctx) : this.d.m_flDefaultInputValue;
    return Math.max(0, v ?? 1);
  }
  update(ctx, range) {
    const s = this.scale(ctx);
    if (range) {
      const r = this.child.update(ctx, range);
      this.prev = this.child.prev; this.cur = this.child.cur;
      this.duration = near(s, 0) ? 0 : this.child.duration / s;
      return r;
    }
    const dt = ctx.dt;
    ctx.dt = near(s, 0) ? 0 : dt * s;
    const r = this.child.update(ctx, null);
    ctx.dt = dt;
    this.prev = this.child.prev; this.cur = this.child.cur;
    this.duration = near(s, 0) ? 0 : this.child.duration / s;
    return r;
  }
}
class DurationScale extends SpeedScale {
  scale(ctx) {
    const i = this.d.m_nInputValueNodeIdx;
    const want = Math.max(0, (i >= 0 ? this.n(i).value(ctx) : this.d.m_flDefaultInputValue) ?? 0);
    const cd = this.child.valid() ? this.child.duration : -1;
    return cd > 0 ? (near(want, 0) ? 0 : cd / want) : 1;
  }
}

// --- layers over a base pose
class LayerBlend extends PoseNode {
  get base() { return this.n(this.d.m_nBaseNodeIdx); }
  get layers() { return this.d.m_layerDefinition; }
  onInit(ctx, t) {
    super.onInit(ctx, t);
    this.base.init(ctx, t);
    if (this.base.valid()) { this.cur = this.base.cur; this.duration = this.base.duration; }
    for (const L of this.layers) {
      this.n(L.m_nInputNodeIdx).init(ctx, L.m_bIsSynchronized ? t : { idx: 0, pct: 0 });
      if (L.m_nWeightValueNodeIdx >= 0) this.n(L.m_nWeightValueNodeIdx).init(ctx);
      if (L.m_nBoneMaskValueNodeIdx >= 0) this.n(L.m_nBoneMaskValueNodeIdx).init(ctx);
    }
  }
  onShutdown(ctx) {
    for (const L of this.layers) {
      if (L.m_nWeightValueNodeIdx >= 0) this.n(L.m_nWeightValueNodeIdx).shutdown(ctx);
      if (L.m_nBoneMaskValueNodeIdx >= 0) this.n(L.m_nBoneMaskValueNodeIdx).shutdown(ctx);
      this.n(L.m_nInputNodeIdx).shutdown(ctx);
    }
    this.base.shutdown(ctx);
  }
  valid() { return this.base.valid(); }
  syncTrack() { return this.base.valid() ? this.base.syncTrack() : DEFAULT_TRACK; }
  update(ctx, range) {
    const b = this.base;
    let res;
    if (range) { res = b.update(ctx, range); this.prev = this.syncTrack().percentage(range.start); }
    else { this.prev = b.cur; res = b.update(ctx, null); }
    this.cur = b.cur; this.duration = b.duration;
    let pose = res.pose || fallbackPose(ctx);
    const tr = b.syncTrack(), layerRange = { start: tr.time(b.prev), end: tr.time(b.cur) };
    const outer = ctx.layer;
    let events = res.events;
    for (const L of this.layers) {
      const lc = ctx.layer = { weight: 1, rmWeight: 1, mask: null, additive: L.m_blendMode === 'Additive' };
      if (!L.m_bIsStateMachineLayer) {
        if (L.m_nWeightValueNodeIdx >= 0) lc.weight = Math.min(1, Math.max(0, this.n(L.m_nWeightValueNodeIdx).value(ctx) ?? 0));
        if (L.m_nBoneMaskValueNodeIdx >= 0) lc.mask = this.n(L.m_nBoneMaskValueNodeIdx).value(ctx) || null;
      }
      let lr = null;
      const input = this.n(L.m_nInputNodeIdx);
      if (L.m_bIsStateMachineLayer || lc.weight > 0) lr = input.update(ctx, L.m_bIsSynchronized ? layerRange : null);
      if (lr?.pose && lc.weight > 1e-3) {
        let mode = L.m_blendMode;
        if (mode === 'ModelSpace' && !lc.mask) mode = 'Overlay';
        const out = ctx.pose();
        if (mode === 'Additive') pose = additive(out, pose, lr.pose, lc.weight, lc.mask);
        else if (mode === 'ModelSpace') pose = modelSpaceBlend(out, pose, lr.pose, lc.weight, lc.mask, ctx.pose());
        else pose = blend(out, pose, lr.pose, lc.weight, lc.mask, true);
      } else if (lr) for (let i = lr.events[0]; i < lr.events[1]; i++) ctx.events[i].ignored = true;
      if (lr && lr.events[1] > lr.events[0]) {
        for (let i = lr.events[0]; i < lr.events[1]; i++) { ctx.events[i].weight *= lc.weight; if (L.m_bIgnoreEvents) ctx.events[i].ignored = true; }
        events = [Math.min(events[0], lr.events[0]), Math.max(events[1], lr.events[1])];
      }
    }
    ctx.layer = outer;
    return { pose, events };
  }
}

// another graph file (a weapon's actions, a class's locomotion) run inside this one
class ReferencedGraph extends PoseNode {
  get inner() { if (!this._g) this._g = this.g.referencedGraph(this.d.m_nReferencedGraphIdx); return this._g; }
  get fallback() { return this.n(this.d.m_nFallbackNodeIdx); }
  valid() { return !!this.inner || !!this.fallback?.valid(); }
  syncTrack() {
    if (this.inner) { const r = this.inner.root; return r.valid() ? r.syncTrack() : DEFAULT_TRACK; }
    return this.fallback?.valid() ? this.fallback.syncTrack() : DEFAULT_TRACK;
  }
  onInit(ctx, t) {
    super.onInit(ctx, t);
    if (this.inner) {
      this.inner._ctx = ctx;
      const r = this.inner.root;
      if (r.initialized) r.shutdown(ctx);
      r.init(ctx, t);
      this.prev = this.cur = r.cur; this.duration = r.duration;
    } else if (this.fallback) { this.fallback.init(ctx, t); this.takeTime(this.fallback); }
  }
  onShutdown(ctx) {
    if (this.inner) this.inner.root.shutdown(ctx);
    else this.fallback?.shutdown(ctx);
  }
  update(ctx, range) {
    if (this.inner) {
      this.inner._ctx = ctx;
      const r = this.inner.root;
      if (!r.initialized) { this.fallback?.initialized && this.fallback.shutdown(ctx); r.init(ctx, { idx: 0, pct: 0 }); } // it arrived after this node started
      const res = r.update(ctx, range);
      this.takeTime(r);
      return res;
    }
    if (this.fallback) { const res = this.fallback.update(ctx, range); this.takeTime(this.fallback); return res; }
    return { pose: null, events: ctx.emptyRange() };
  }
}

export const POSE_NODES = {
  ClipNode: Clip, AnimationPoseNode: AnimationPose, ZeroPoseNode: ZeroPose, ReferencePoseNode: ReferencePose,
  Blend1DNode: Blend1D, Blend2DNode: Blend2D,
  SelectorNode: Selector, ClipSelectorNode: Selector, ParameterizedClipSelectorNode: ParameterizedSelector,
  ParameterizedSelectorNode: ParameterizedSelector,
  SpeedScaleNode: SpeedScale, DurationScaleNode: DurationScale, LayerBlendNode: LayerBlend,
  ReferencedGraphNode: ReferencedGraph,
};
