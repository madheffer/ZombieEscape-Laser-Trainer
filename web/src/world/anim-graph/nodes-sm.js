// State machines of CS2's anim graphs: states, transitions (timed blends, optionally synchronized) and the state
// conditions, after Esoterica's StateMachine / State / Transition / StateConditions nodes.
import { PoseNode, ValueNode, ease } from './nodes-base.js';
import { SyncTrack, syncedDuration, DEFAULT_TRACK } from './sync-track.js';
import { blend, Pose } from './pose.js';
import { joinEvents, fallbackPose } from './nodes-pose.js';
import { lerpMask } from './nodes-mask.js';

// Esoterica TransitionOptions bits
const OPT = { Clamp: 1, Sync: 2, MatchSource: 4, MatchIndex: 8, MatchID: 16, MatchPct: 32, PreferClosest: 64, MatchSeconds: 128, OffsetSeconds: 256 };
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const loopPct = (v) => { const f = v - Math.trunc(v); return v > 0 && f === 0 ? 1 : f; };

class State extends PoseNode {
  get child() { return this.n(this.d.m_nChildNodeIdx); }
  get isOff() { return !!this.d.m_bIsOffState; }
  valid() { return !!this.child?.valid(); }
  syncTrack() { return this.valid() ? this.child.syncTrack() : DEFAULT_TRACK; }
  onInit(ctx, t) {
    super.onInit(ctx, t);
    this.trans = 'none';
    this.elapsed = 0;
    this.eventRange = [0, 0];
    const c = this.child;
    if (c) { c.init(ctx, t); if (c.valid()) this.takeTime(c); }
    if (this.d.m_nLayerBoneMaskNodeIdx >= 0) this.n(this.d.m_nLayerBoneMaskNodeIdx).init(ctx);
    if (this.d.m_nLayerWeightNodeIdx >= 0) this.n(this.d.m_nLayerWeightNodeIdx).init(ctx);
    this.firstUpdate = true;
  }
  onShutdown(ctx) {
    if (this.d.m_nLayerBoneMaskNodeIdx >= 0) this.n(this.d.m_nLayerBoneMaskNodeIdx).shutdown(ctx);
    if (this.d.m_nLayerWeightNodeIdx >= 0) this.n(this.d.m_nLayerWeightNodeIdx).shutdown(ctx);
    this.child?.shutdown(ctx);
    this.trans = 'none';
    this.sm?.transitioning.delete(this.smIndex);
  }
  setTrans(s) {
    this.trans = s;
    if (this.sm) { if (s === 'none') this.sm.transitioning.delete(this.smIndex); else this.sm.transitioning.add(this.smIndex); }
  }
  startTransitionOut(ctx) {
    this.setTrans('out');
    for (let i = this.eventRange[0]; i < this.eventRange[1]; i++) if (ctx.events[i]) ctx.events[i].active = false;
    return this.eventRange;
  }
  sampleStateEvents(ctx) {
    const d = this.d;
    if (this.firstUpdate || (this.trans === 'in' && ctx.active)) for (const id of d.m_entryEvents || []) ctx.graphEvent(this, id, 'Entry');
    else if (this.trans === 'none' && ctx.active) for (const id of d.m_executeEvents || d.m_fullyInStateEvents || []) ctx.graphEvent(this, id, 'FullyInState');
    else if (this.trans === 'out') for (const id of d.m_exitEvents || []) ctx.graphEvent(this, id, 'Exit');
    const elapsed = d.m_bUseActualElapsedTimeInStateForTimedEvents ? this.elapsed : this.duration * this.cur;
    for (const e of d.m_timedElapsedEvents || []) if (cmp(e, elapsed)) ctx.graphEvent(this, e.m_ID, 'Timed');
    const remaining = (1 - this.cur) * this.duration;
    for (const e of d.m_timedRemainingEvents || []) if (cmp(e, remaining)) ctx.graphEvent(this, e.m_ID, 'Timed');
    this.eventRange[1] = ctx.events.length;
  }
  updateLayer(ctx) {
    const L = ctx.layer;
    if (!L) return;
    if (this.isOff) { L.weight = 0; L.rmWeight = 0; }
    else if (this.d.m_nLayerWeightNodeIdx >= 0) L.weight *= clamp01(this.n(this.d.m_nLayerWeightNodeIdx).value(ctx) ?? 0);
    if (this.d.m_nLayerBoneMaskNodeIdx >= 0) {
      const m = this.n(this.d.m_nLayerBoneMaskNodeIdx).value(ctx);
      if (m) {
        if (!L.mask) L.mask = m;
        else { const out = new Float32Array(m.length); for (let i = 0; i < m.length; i++) out[i] = L.mask[i] * m[i]; L.mask = out; }
      }
    }
  }
  update(ctx, range) {
    this.elapsed += ctx.dt;
    let res = { pose: null, events: ctx.emptyRange() };
    this.eventRange = ctx.emptyRange();
    const c = this.child;
    if (c?.valid()) { res = c.update(ctx, range); this.takeTime(c); this.eventRange = [res.events[0], res.events[1]]; }
    this.sampleStateEvents(ctx);
    this.updateLayer(ctx);
    this.firstUpdate = false;
    return { pose: res.pose, events: [Math.min(this.eventRange[0], res.events[0]), this.eventRange[1]] };
  }
}
// a timed state event (CS2 spells it m_comparisionOperator, m_flTimeValueSeconds)
function cmp(e, v) {
  const t = e.m_flTimeValueSeconds ?? e.m_flTimeValue ?? 0;
  return (e.m_comparisionOperator ?? e.m_comparisonOperator) === 'LessThanEqual' ? v <= t : v >= t;
}

class Transition extends PoseNode {
  get target() { return this.n(this.d.m_nTargetStateNodeIdx); }
  get flags() { return this.d.m_transitionOptions?.m_flags || 0; }
  onInit(ctx, t) {
    super.onInit(ctx, t);
    this.syncOffset = 0;
    const o = this.d.m_nDurationOverrideNodeIdx;
    if (o >= 0) { const n = this.n(o); n.init(ctx); this.tDur = Math.min(10, Math.max(0, n.value(ctx) ?? 0)); n.shutdown(ctx); }
    else this.tDur = this.d.m_flDuration || 0;
    this.progress = 0; this.w = 0;
    this.source = null; this.sourceType = 'state'; this.cached = null;
  }
  onShutdown(ctx) {
    this.target.setTrans('none');
    this.cur = 1;
    if (this.source) {
      if (this.sourceType === 'transition') this.endSourceTransition(ctx);
      this.source.shutdown(ctx);
      this.source = null;
    }
  }
  calcWeight() { this.w = this.tDur === 0 ? 1 : clamp01(ease(this.d.m_blendWeightEasing, this.progress)); }
  isComplete(ctx) { return this.tDur <= 0 || this.progress + ctx.dt / this.tDur >= 1; }
  endSourceTransition(ctx) {
    const st = this.source.target;
    this.source.shutdown(ctx);
    this.source = st;
    this.sourceType = 'state';
    st.setTrans('out');
  }
  // the machine starts this transition from `source` (a state or a transition) whose result this frame is srcRes
  start(ctx, source, isTransition, srcRes, extRange) {
    this.source = source;
    this.sourceType = isTransition ? 'transition' : 'state';
    const f = this.flags, synced = !!(f & OPT.Sync) || !!extRange;
    let srcEvents = srcRes.events;
    const outForSource = () => {
      const instant = this.tDur === 0;
      if (this.sourceType === 'state') srcEvents = this.source.startTransitionOut(ctx);
      else this.source.target.startTransitionOut(ctx);
      if (instant) {
        if (this.sourceType === 'transition') this.endSourceTransition(ctx);
        this.source.shutdown(ctx);
        this.source = null;
        srcRes = { pose: null, events: srcEvents };
      }
    };
    const outerLayer = ctx.layer, tgtLayer = outerLayer ? { weight: 1, rmWeight: 1, mask: null, additive: outerLayer.additive } : null;
    if (tgtLayer) ctx.layer = tgtLayer;
    let tgtRes, tgtRange = null;
    if (synced) {
      const st = source.syncTrack();
      const srcRange = { start: st.time(source.prev), end: st.time(source.cur) };
      if (f & OPT.Clamp) {
        const realEnd = st.percentage(st.endTime()), now = st.percentage(srcRange.start);
        const delta = realEnd > now ? realEnd - now : 1 - (now - realEnd);
        if (source.duration > 0) this.tDur = Math.min(this.tDur, source.duration * delta);
      }
      this.syncOffset = extRange ? 0 : Math.floor(this.timeOffset(ctx));
      tgtRange = { start: { ...srcRange.start, idx: srcRange.start.idx + this.syncOffset }, end: { ...srcRange.end, idx: srcRange.end.idx + this.syncOffset } };
      outForSource();
      this.target.init(ctx, tgtRange.start);
      this.target.setTrans('in');
      tgtRes = this.target.update(ctx, tgtRange);
    } else {
      this.syncOffset = this.timeOffset(ctx);
      if (f & OPT.Clamp && source.duration > 0) this.tDur = Math.min(this.tDur, (1 - source.cur) * source.duration);
      if (f & OPT.MatchSource || Math.abs(this.syncOffset) > 1e-4) {
        let start = { idx: 0, pct: 0 };
        if (f & (OPT.MatchSeconds | OPT.OffsetSeconds)) {
          const srcSec = f & OPT.MatchSeconds ? source.duration * source.cur : 0;
          const want = srcSec + this.syncOffset;
          this.syncOffset = 0;
          this.target.init(ctx, { idx: 0, pct: 0 });
          const td = this.target.duration;
          start = this.target.syncTrack().time(td === 0 ? 0 : clamp01(want / td));
          this.target.shutdown(ctx);
        } else {
          if (f & OPT.MatchSource) {
            const st = source.syncTrack(), from = st.time(source.cur);
            if (f & OPT.MatchIndex) start.idx = from.idx;
            else if (f & OPT.MatchID) {
              const id = st.event(from.idx)?.id;
              if (id) { this.target.init(ctx, start); start.idx = this.target.syncTrack().eventIndexForId(id); this.target.shutdown(ctx); }
            }
            if (f & OPT.MatchPct) start.pct = from.pct;
          }
          const v = start.idx + start.pct + this.syncOffset, i = Math.trunc(v);
          start = { idx: i, pct: Math.abs(v - i) };
        }
        outForSource();
        this.target.init(ctx, start);
        this.target.setTrans('in');
        const dt = ctx.dt; ctx.dt = 0;
        tgtRes = this.target.update(ctx, null);
        ctx.dt = dt;
      } else {
        outForSource();
        this.target.init(ctx, { idx: 0, pct: 0 });
        this.target.setTrans('in');
        tgtRes = this.target.update(ctx, null);
      }
    }
    this.calcWeight();
    const res = this.mix(ctx, srcRes, tgtRes);
    if (tgtLayer) { this.mixLayer(outerLayer, tgtLayer); ctx.layer = outerLayer; }
    if (!this.source) { this.prev = this.cur = 0; this.blendedDuration = this.target.duration; this.track = this.target.syncTrack(); }
    else if (synced) {
      const s = this.source.syncTrack(), t = this.target.syncTrack();
      this.track = SyncTrack.blend(s, t, this.w);
      this.blendedDuration = syncedDuration(this.source.duration, this.target.duration, s.count, t.count, this.track.count, this.w);
      this.prev = this.track.percentage(tgtRange.start); this.cur = this.track.percentage(tgtRange.end);
    } else {
      this.prev = this.cur = 0;
      this.blendedDuration = (this.sourceType === 'off' || this.sourceType === 'cached' ? 0 : this.source.duration) * (1 - this.w) + this.target.duration * this.w;
      this.track = this.target.syncTrack();
    }
    this.duration = this.target.duration;
    return { pose: res, events: joinEvents(ctx, srcEvents, tgtRes.events, this.w) };
  }
  timeOffset(ctx) {
    const o = this.d.m_timeOffsetOverrideNodeIdx;
    if (o >= 0) { const n = this.n(o); n.init(ctx); const v = n.value(ctx) ?? 0; n.shutdown(ctx); return v; }
    return this.d.m_flTimeOffset || 0;
  }
  mix(ctx, src, tgt) {
    if (src.pose && this.source) this.cached = (this.cached || new Pose(ctx.skel)).copy(src.pose); // for a forced return
    const sp = this.sourceType === 'cached' ? this.cached : src.pose;
    if (!this.source && this.sourceType !== 'cached' && this.sourceType !== 'off') return tgt.pose;
    if (sp && tgt.pose) {
      let w = this.w, mask = null;
      if (this.d.m_startBoneMaskNodeIdx >= 0) {
        const p = this.d.m_boneMaskBlendInTimePercentage?.m_flValue ?? 0.33;
        let mw;
        if (this.progress >= p) { w = 1; mw = (this.progress - p) / (1 - p); } else { w = this.progress / p; mw = 0; }
        const m = this.n(this.d.m_startBoneMaskNodeIdx).value(ctx);
        if (m) { mask = new Float32Array(m.length); for (let i = 0; i < m.length; i++) mask[i] = m[i] + (1 - m[i]) * mw; }
      }
      return blend(ctx.pose(), sp, tgt.pose, w, mask);
    }
    return sp || tgt.pose;
  }
  mixLayer(src, tgt) {
    src.weight += (tgt.weight - src.weight) * this.w;
    src.rmWeight += (tgt.rmWeight - src.rmWeight) * this.w;
    if (src.mask && tgt.mask) src.mask = lerpMask(src.mask, tgt.mask, this.w, new Float32Array(src.mask.length));
    else if (src.mask) {
      if (!this.target.isOff) { const ones = new Float32Array(src.mask.length).fill(1); src.mask = lerpMask(src.mask, ones, this.w, ones); }
    } else if (tgt.mask) {
      if (this.source && this.sourceType === 'state' && this.source.isOff) src.mask = tgt.mask;
      else { const ones = new Float32Array(tgt.mask.length).fill(1); src.mask = lerpMask(ones, tgt.mask, this.w, ones); }
    }
  }
  // a new transition is starting from this one (Esoterica NotifyNewTransitionStarting, without cached-pose forcing)
  notifyNewTransition(ctx, targetState) {
    if (this.sourceType === 'transition') {
      const sts = this.source.target;
      if (sts === targetState) {
        this.sourceType = this.cached ? 'cached' : 'off';
        sts.shutdown(ctx);
        this.source.shutdown(ctx);
        this.source = null;
      } else this.source.notifyNewTransition(ctx, targetState);
    } else if (this.sourceType === 'state' && this.source === targetState) {
      this.sourceType = this.cached ? 'cached' : 'off';
      this.source.shutdown(ctx);
      this.source = null;
    }
  }
  update(ctx, extRange) {
    const f = this.flags;
    let sync = false, range = null;
    if (extRange) { sync = true; range = extRange; }
    else if (this.source && this.sourceType !== 'off' && this.sourceType !== 'cached' && f & OPT.Sync) {
      sync = true;
      const d = this.blendedDuration > 0 ? ctx.dt / this.blendedDuration : 0;
      range = { start: this.track.time(this.cur), end: this.track.time(Math.min(1, loopPct(this.cur + d))) };
    }
    if (this.sourceType === 'transition' && this.source.isComplete(ctx)) this.endSourceTransition(ctx);
    if (sync && f & OPT.Clamp) this.progress += this.track.percentageCovered(range.start, range.end) / (this.tDur || 1e-6);
    else this.progress += this.tDur > 0 ? ctx.dt / this.tDur : 1;
    this.progress = clamp01(this.progress);
    this.calcWeight();
    let src = { pose: null, events: ctx.emptyRange() };
    if (this.source && this.sourceType !== 'off' && this.sourceType !== 'cached') {
      const was = ctx.active;
      ctx.active = false;
      if (sync) {
        const o = Math.trunc(this.syncOffset);
        const sr = { start: { idx: range.start.idx - o, pct: range.start.pct }, end: { idx: range.end.idx - o, pct: range.end.pct } };
        if (f & OPT.Clamp && this.progress === 1) sr.end = { idx: sr.start.idx, pct: 1 };
        src = this.source.update(ctx, sr);
      } else src = this.source.update(ctx, null);
      ctx.active = was;
    }
    const outerLayer = ctx.layer, tgtLayer = outerLayer ? { weight: 1, rmWeight: 1, mask: null, additive: outerLayer.additive } : null;
    if (tgtLayer) ctx.layer = tgtLayer;
    const tgt = this.target.update(ctx, sync ? range : null);
    if (tgtLayer) { this.mixLayer(outerLayer, tgtLayer); ctx.layer = outerLayer; }
    const pose = this.mix(ctx, src, tgt);
    if (sync && this.source && this.sourceType !== 'off' && this.sourceType !== 'cached') {
      const s = this.source.syncTrack(), t = this.target.syncTrack();
      this.track = SyncTrack.blend(s, t, this.w);
      this.blendedDuration = syncedDuration(this.source.duration, this.target.duration, s.count, t.count, this.track.count, this.w);
      this.prev = this.track.percentage(range.start); this.cur = this.track.percentage(range.end);
    } else {
      const sd = this.source && this.sourceType !== 'off' && this.sourceType !== 'cached' ? this.source.duration : 0;
      this.blendedDuration = sd * (1 - this.w) + this.target.duration * this.w;
      if (this.blendedDuration > 0) { this.prev = this.cur; this.cur = Math.min(1, loopPct(this.cur + ctx.dt / this.blendedDuration)); }
      else this.prev = this.cur = 1;
    }
    this.duration = this.target.duration;
    return { pose, events: joinEvents(ctx, src.events, tgt.events, this.w) };
  }
}

class StateMachine extends PoseNode {
  constructor(...a) {
    super(...a);
    this.transitioning = new Set();
    this.states = this.d.m_stateDefinitions.map((s, i) => {
      const node = this.n(s.m_nStateNodeIdx);
      node.sm = this; node.smIndex = i;
      return { node, entry: s.m_nEntryConditionNodeIdx, transitions: s.m_transitionDefinitions || [] };
    });
  }
  valid() { return this.active >= 0 && this.active < this.states.length; }
  syncTrack() { return this.tr ? this.tr.track || this.tr.target.syncTrack() : this.states[this.active]?.node.syncTrack() || DEFAULT_TRACK; }
  selectDefault(ctx) {
    let sel = this.d.m_nDefaultStateIndex || 0;
    for (const s of this.states) if (s.entry >= 0) this.n(s.entry).init(ctx);
    for (let i = 0; i < this.states.length; i++) if (this.states[i].entry >= 0 && this.n(this.states[i].entry).value(ctx)) { sel = i; break; }
    for (const s of this.states) if (s.entry >= 0) this.n(s.entry).shutdown(ctx);
    return sel;
  }
  conds(ctx, i, on) { for (const t of this.states[i].transitions) { const c = this.n(t.m_nConditionNodeIdx); if (c) on ? c.init(ctx) : c.shutdown(ctx); } }
  onInit(ctx, t) {
    super.onInit(ctx, t);
    this.transitioning.clear();
    this.tr = null;
    this.pendingShutdown = -1;
    this.active = this.selectDefault(ctx);
    const s = this.states[this.active].node;
    s.init(ctx, t);
    this.takeTime(s);
    this.conds(ctx, this.active, true);
  }
  onShutdown(ctx) {
    if (this.tr) this.tr.shutdown(ctx);
    if (this.pendingShutdown >= 0) { this.conds(ctx, this.pendingShutdown, false); this.pendingShutdown = -1; }
    this.conds(ctx, this.active, false);
    this.states[this.active].node.shutdown(ctx);
    this.active = -1;
    this.tr = null;
    this.transitioning.clear();
  }
  update(ctx, range) {
    if (this.pendingShutdown >= 0) { this.conds(ctx, this.pendingShutdown, false); this.pendingShutdown = -1; }
    if (this.tr && this.tr.isComplete(ctx)) { this.tr.shutdown(ctx); this.tr = null; }
    let res;
    if (!this.tr) { const s = this.states[this.active].node; res = s.update(ctx, range); this.takeTime(s); }
    else { res = this.tr.update(ctx, range); this.duration = this.tr.duration; this.prev = this.tr.prev; this.cur = this.tr.cur; }
    if (ctx.active) res = this.evaluate(ctx, range, res);
    return res;
  }
  evaluate(ctx, range, res) {
    const st = this.states[this.active];
    let pick = null;
    for (const t of st.transitions) {
      if (!t.m_bCanBeForced && this.transitioning.has(t.m_nTargetStateIdx)) continue;
      const c = this.n(t.m_nConditionNodeIdx);
      if (c && c.value(ctx)) { pick = t; break; }
    }
    if (!pick) return res;
    const target = this.states[pick.m_nTargetStateIdx];
    if (this.tr) this.tr.notifyNewTransition(ctx, target.node);
    const tr = this.n(pick.m_nTransitionNodeIdx);
    if (tr.initialized) tr.shutdown(ctx);
    tr.init(ctx, { idx: 0, pct: 0 });
    const src = this.tr || st.node;
    res = tr.start(ctx, src, !!this.tr, res, range);
    this.tr = tr;
    this.pendingShutdown = this.active;
    this.active = pick.m_nTargetStateIdx;
    this.conds(ctx, this.active, true);
    const ns = target.node;
    this.duration = ns.duration; this.prev = ns.prev; this.cur = ns.cur;
    return res;
  }
}

class StateCompletedCondition extends ValueNode {
  compute(ctx) {
    const s = this.n(this.d.m_nSourceStateNodeIdx);
    if (!s?.initialized) return false;
    let td = this.d.m_flTransitionDurationSeconds ?? 0;
    if (this.d.m_nTransitionDurationOverrideNodeIdx >= 0) td = this.n(this.d.m_nTransitionDurationOverrideNodeIdx).value(ctx) ?? td;
    if (s.duration === 0) return true;
    if (Math.abs(td) < 1e-4) return Math.abs(s.cur - 1) < 1e-4 || s.cur < s.prev;
    return s.cur >= 1 - td / s.duration;
  }
}
class TimeCondition extends ValueNode {
  compute(ctx) {
    const s = this.n(this.d.m_sourceStateNodeIdx);
    if (!s?.initialized) return false;
    const c = this.d.m_nInputValueNodeIdx >= 0 ? this.n(this.d.m_nInputValueNodeIdx).value(ctx) : this.d.m_flComparand;
    let v;
    switch (this.d.m_type) {
      case 'PercentageThroughState': v = s.cur; break;
      case 'PercentageThroughSyncEvent': v = s.syncTrack().time(s.cur).pct; break;
      case 'ElapsedTime': v = s.elapsed ?? s.duration * s.cur; break;
      default: v = s.duration * s.cur; // CurrentTime
    }
    switch (this.d.m_operator) {
      case 'LessThan': return v < c;
      case 'LessThanEqual': return v <= c;
      case 'GreaterThan': return v > c;
      default: return v >= c;
    }
  }
}

export const SM_NODES = {
  StateMachineNode: StateMachine, StateNode: State, TransitionNode: Transition,
  StateCompletedConditionNode: StateCompletedCondition, TimeConditionNode: TimeCondition,
};
export { fallbackPose };
