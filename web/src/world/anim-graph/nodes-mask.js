// Bone masks (per-bone weights, Float32Array over the skeleton) and the event conditions, after Esoterica's
// AnimationBoneMask / BoneMasks nodes and Events nodes.
import { ValueNode } from './nodes-base.js';

// a skeleton mask definition -> weights; bones the definition doesn't list are feathered along their chain the way
// Esoterica's BoneMask::ResetWeights does (between two listed bones: a lerp; below a listed bone: its weight)
const built = new WeakMap();
export function maskWeights(skel, id) {
  let byId = built.get(skel);
  if (!byId) built.set(skel, byId = new Map());
  if (byId.has(id)) return byId.get(id);
  const def = skel.masks[id];
  const n = skel.count, P = skel.parents;
  const w = new Float32Array(n);
  if (!def || !Object.keys(def).length) { w.fill(1); byId.set(id, w); return w; }
  const orig = new Float32Array(n).fill(-1);
  for (const [b, v] of Object.entries(def)) { const i = skel.index.get(b); if (i != null) orig[i] = v; }
  w.set(orig);
  for (let i = n - 1; i > 0; i--) {
    if (w[i] === -1) {
      const chain = [i];
      let chainWeight = 0, p = P[i];
      while (p >= 0) {
        if (orig[p] !== -1) { chainWeight = orig[p]; break; }
        chain.push(p);
        p = P[p];
      }
      if (p < 0) chain.pop();
      for (const c of chain) w[c] = chainWeight;
    } else if (P[i] >= 0 && w[P[i]] === -1) {
      const end = w[i];
      let start = -1;
      const chain = [i];
      let p = P[i];
      while (p >= 0) {
        chain.push(p);
        if (orig[p] !== -1) { start = orig[p]; break; }
        p = P[p];
      }
      for (let k = chain.length - 2; k > 0; k--) {
        const t = k / (chain.length - 1);
        w[chain[k]] = start !== -1 ? end + (start - end) * t : 0;
      }
    }
  }
  if (w[0] === -1) w[0] = 0;
  byId.set(id, w);
  return w;
}

export function lerpMask(a, b, t, out) {
  for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

class BoneMask extends ValueNode {
  compute() { return maskWeights(this.g.skel, this.d.m_boneMaskID); }
}

// picks a mask by a parameter (an ID matched against m_parameterValues, else the default), blending over a time
class MaskBlender extends ValueNode {
  get needsInit() { return true; }
  onInit(ctx) { this.current = this.pick(ctx); this.from = null; this.t = 1; this.out = new Float32Array(this.g.skel.count); }
  compute(ctx) {
    const want = this.pick(ctx);
    if (want !== this.current && (this.d.m_bSwitchDynamically ?? true)) {
      this.from = this.blendedOrCurrent();
      this.current = want;
      this.t = 0;
    }
    const bt = this.d.m_flBlendTimeSeconds || 0;
    if (this.from && bt > 0 && this.t < 1) {
      this.t = Math.min(1, this.t + ctx.dt / bt);
      return lerpMask(this.from, this.current, this.t, this.out);
    }
    this.from = null;
    return this.current;
  }
  blendedOrCurrent() { return this.from ? Float32Array.from(this.out) : this.current; }
}
class BoneMaskSelector extends MaskBlender {
  pick(ctx) {
    const v = this.n(this.d.m_parameterValueNodeIdx)?.value(ctx);
    const k = (this.d.m_parameterValues || []).indexOf(v);
    const idx = k >= 0 ? this.d.m_maskNodeIndices[k] : this.d.m_defaultMaskNodeIdx;
    return this.n(idx)?.value(ctx) ?? null;
  }
}
class BoneMaskSwitch extends MaskBlender {
  pick(ctx) {
    const on = this.n(this.d.m_nSwitchValueNodeIdx)?.value(ctx);
    return this.n(on ? this.d.m_nTrueValueNodeIdx : this.d.m_nFalseValueNodeIdx)?.value(ctx) ?? null;
  }
}

// --- event conditions: search this update's sampled events (Esoterica EventConditionRules bits)
const RULE = { LimitToSource: 1, IgnoreInactive: 2, OperatorOr: 16, OnlyGraph: 64, OnlyAnim: 128, Both: 256 };
function searchRange(ctx, src, flags) {
  if (src && flags & RULE.LimitToSource && src.eventRange) return src.eventRange;
  return [0, ctx.events.length];
}
class IDEventCondition extends ValueNode {
  compute(ctx) {
    const f = this.d.m_eventConditionRules?.m_flags || 0, ids = this.d.m_eventIDs || [];
    const anim = !!(f & (RULE.Both | RULE.OnlyAnim)), graph = !!(f & (RULE.Both | RULE.OnlyGraph)), or = !!(f & RULE.OperatorOr);
    const found = new Array(ids.length).fill(false);
    const [s, e] = searchRange(ctx, this.n(this.d.m_nSourceStateNodeIdx), f);
    for (let i = s; i < e; i++) {
      const ev = ctx.events[i];
      if (!ev || ev.ignored || (f & RULE.IgnoreInactive && !ev.active)) continue;
      if (ev.anim ? !anim : !graph) continue;
      const k = ids.indexOf(ev.id);
      if (k < 0) continue;
      if (or) return true;
      found[k] = true;
    }
    return ids.length > 0 && found.every(Boolean);
  }
}
class GraphEventCondition extends ValueNode {
  compute(ctx) {
    const f = this.d.m_eventConditionRules?.m_flags || 0, conds = this.d.m_conditions || [], or = !!(f & RULE.OperatorOr);
    const found = new Array(conds.length).fill(false);
    const [s, e] = searchRange(ctx, this.n(this.d.m_nSourceStateNodeIdx), f);
    for (let i = s; i < e; i++) {
      const ev = ctx.events[i];
      if (!ev || ev.anim || ev.ignored || (f & RULE.IgnoreInactive && !ev.active)) continue;
      for (let k = 0; k < conds.length; k++) {
        const c = conds[k];
        if (c.m_eventID !== ev.id) continue;
        const tc = c.m_eventTypeCondition;
        if (tc && tc !== 'Any' && tc !== ev.type) continue;
        if (or) return true;
        found[k] = true;
      }
    }
    return conds.length > 0 && found.every(Boolean);
  }
}
// the ID of the sync event the source state is in
class CurrentSyncEventID extends ValueNode {
  compute(ctx) {
    const s = this.n(this.d.m_nSourceStateNodeIdx);
    if (!s?.initialized) return '';
    const tr = s.syncTrack(), t = tr.time(s.cur);
    return tr.event(t.idx)?.id ?? '';
  }
}

export const MASK_NODES = {
  BoneMaskNode: BoneMask, BoneMaskSelectorNode: BoneMaskSelector, BoneMaskSwitchNode: BoneMaskSwitch,
  IDEventConditionNode: IDEventCondition, GraphEventConditionNode: GraphEventCondition,
  CurrentSyncEventIDNode: CurrentSyncEventID,
};
