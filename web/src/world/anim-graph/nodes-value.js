// Value nodes of CS2's anim graphs (Esoterica's Parameters / Bools / IDs / Floats / CachedValues / ConstValues):
// definitions are the compiled CNm*::CDefinition fields (m_n...NodeIdx point at other nodes).
import { ValueNode, ease } from './nodes-base.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

// control parameters: what the game sets (graph.set); unset ones read as the type's zero
class ControlParameter extends ValueNode {
  compute() { return this.g.paramValue(this.idx) ?? this.zero; }
}
class ControlParameterFloat extends ControlParameter { get zero() { return 0; } }
class ControlParameterBool extends ControlParameter { get zero() { return false; } }
class ControlParameterID extends ControlParameter { get zero() { return ''; } }
class ControlParameterTarget extends ControlParameter { get zero() { return null; } }

class ConstFloat extends ValueNode { compute() { return this.d.m_flValue ?? 0; } }
class ConstID extends ValueNode { compute() { return this.d.m_value ?? this.d.m_ID ?? ''; } }
class ConstBool extends ValueNode { compute() { return !!this.d.m_bValue; } }

class And extends ValueNode {
  onInit(ctx) { for (const i of this.d.m_conditionNodeIndices) this.n(i).init(ctx); }
  onShutdown(ctx) { for (const i of this.d.m_conditionNodeIndices) this.n(i).shutdown(ctx); }
  compute(ctx) { for (const i of this.d.m_conditionNodeIndices) if (!this.n(i).value(ctx)) return false; return true; }
}
class Or extends And {
  compute(ctx) { for (const i of this.d.m_conditionNodeIndices) if (this.n(i).value(ctx)) return true; return false; }
}
class Not extends ValueNode {
  onInit(ctx) { this.n(this.d.m_nInputValueNodeIdx).init(ctx); }
  onShutdown(ctx) { this.n(this.d.m_nInputValueNodeIdx).shutdown(ctx); }
  compute(ctx) { return !this.n(this.d.m_nInputValueNodeIdx).value(ctx); }
}

// one input node, initialized with this one
class Unary extends ValueNode {
  get input() { return this.n(this.d.m_nInputValueNodeIdx); }
  onInit(ctx) { this.input?.init(ctx); }
  onShutdown(ctx) { this.input?.shutdown(ctx); }
}

class IDComparison extends Unary {
  compute(ctx) {
    const v = this.input.value(ctx) ?? '';
    const hit = (this.d.m_comparisionIDs || []).includes(v);
    return this.d.m_comparison === 'DoesntMatch' ? !hit : hit;
  }
}
class IDToFloat extends Unary {
  compute(ctx) {
    const i = (this.d.m_IDs || []).indexOf(this.input.value(ctx));
    return i < 0 ? this.d.m_defaultValue ?? 0 : this.d.m_values[i];
  }
}

class FloatComparison extends Unary {
  compute(ctx) {
    const a = this.input.value(ctx) ?? 0;
    const c = this.d.m_nComparandValueNodeIdx >= 0 ? this.n(this.d.m_nComparandValueNodeIdx).value(ctx) : this.d.m_flComparisonValue;
    const e = this.d.m_flEpsilon || 0;
    switch (this.d.m_comparison) {
      case 'GreaterThanEqual': return a >= c;
      case 'LessThanEqual': return a <= c;
      case 'NearEqual': return Math.abs(a - c) <= e;
      case 'GreaterThan': return a > c;
      case 'LessThan': return a < c;
      default: return false;
    }
  }
}
class FloatRangeComparison extends Unary {
  compute(ctx) {
    const v = this.input.value(ctx) ?? 0, r = this.d.m_range;
    return this.d.m_bIsInclusiveCheck ? v >= r.m_flMin && v <= r.m_flMax : v > r.m_flMin && v < r.m_flMax;
  }
}
class FloatRemap extends Unary {
  compute(ctx) {
    const v = this.input.value(ctx) ?? 0, i = this.d.m_inputRange, o = this.d.m_outputRange;
    const t = i.m_flEnd === i.m_flBegin ? 0 : (v - i.m_flBegin) / (i.m_flEnd - i.m_flBegin);
    // Esoterica Math::RemapRange clamps to the output range
    const out = o.m_flBegin + (o.m_flEnd - o.m_flBegin) * t;
    return clamp(out, Math.min(o.m_flBegin, o.m_flEnd), Math.max(o.m_flBegin, o.m_flEnd));
  }
}
class FloatClamp extends Unary {
  compute(ctx) { const r = this.d.m_clampRange; return clamp(this.input.value(ctx) ?? 0, r.m_flMin, r.m_flMax); }
}
class FloatSwitch extends ValueNode {
  compute(ctx) {
    const on = this.n(this.d.m_nSwitchValueNodeIdx).value(ctx);
    const i = on ? this.d.m_nTrueValueNodeIdx : this.d.m_nFalseValueNodeIdx;
    return i >= 0 ? this.n(i).value(ctx) : on ? this.d.m_flTrueValue : this.d.m_flFalseValue;
  }
}
// eases towards the input over m_flEaseTime (Esoterica FloatEaseNode)
class FloatEase extends Unary {
  get needsInit() { return true; }
  onInit(ctx) {
    super.onInit(ctx);
    const v = this.d.m_bUseStartValue ? this.d.m_flStartValue : this.input.value(ctx) ?? 0;
    this.begin = this.end = this.cur = v;
    this.t = 0;
  }
  compute(ctx) {
    const target = this.input.value(ctx) ?? 0;
    if (near(this.cur, target, 0.01)) { this.begin = this.end = this.cur = target; this.t = 0; }
    else {
      if (target !== this.end) { this.end = target; this.begin = this.cur; this.t = 0; }
      this.t += ctx.dt;
      const T = clamp(this.t / (this.d.m_flEaseTime || 1e-6), 0, 1);
      this.cur = this.begin + ease(this.d.m_easingOp, T) * (this.end - this.begin);
    }
    return this.cur;
  }
}
// a critically-damped style spring towards the input (Esoterica FloatSpringNode)
class FloatSpring extends Unary {
  get needsInit() { return true; }
  onInit(ctx) {
    super.onInit(ctx);
    this.pos = this.d.m_bUseStartValue ? this.d.m_flStartValue : this.input.value(ctx) ?? 0;
    this.vel = 0;
  }
  compute(ctx) {
    const target = this.input.value(ctx) ?? 0, dt = ctx.dt;
    const omega = 2 * Math.PI * this.d.m_flHertz, od = omega * dt;
    const scale = 1 / (1 + od * (2 * this.d.m_flDampingRatio + od));
    this.vel = scale * (this.vel - od * omega * (this.pos - target));
    this.pos += dt * this.vel;
    return this.pos;
  }
}
// a piecewise curve (CS2's compiled spline: points with slopes; linear tangents in every curve CS2's graphs carry)
class FloatCurve extends Unary {
  compute(ctx) {
    const x = this.input.value(ctx) ?? 0, pts = this.d.m_curve?.m_spline || [];
    if (!pts.length) return 0;
    if (x <= pts[0].x) return pts[0].y;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (x > b.x) continue;
      const h = b.x - a.x, t = h > 0 ? (x - a.x) / h : 0;
      // cubic Hermite with the stored slopes (linear tangents give the straight line)
      const t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * a.y + (t3 - 2 * t2 + t) * h * a.m_flSlopeOutgoing + (-2 * t3 + 3 * t2) * b.y + (t3 - t2) * h * b.m_flSlopeIncoming;
    }
    return pts[pts.length - 1].y;
  }
}
// holds its input's value from when it was initialized (OnEntry) or keeps the latest until shut down (OnExit)
class CachedValue extends Unary {
  get needsInit() { return true; }
  onInit(ctx) { super.onInit(ctx); this.held = this.input.value(ctx); this.fresh = true; }
  compute(ctx) {
    if (this.d.m_mode === 'OnExit') this.held = this.input.value(ctx);
    return this.held;
  }
}

export const VALUE_NODES = {
  ControlParameterFloatNode: ControlParameterFloat, ControlParameterBoolNode: ControlParameterBool,
  ControlParameterIDNode: ControlParameterID, ControlParameterTargetNode: ControlParameterTarget,
  ConstFloatNode: ConstFloat, ConstIDNode: ConstID, ConstBoolNode: ConstBool,
  AndNode: And, OrNode: Or, NotNode: Not,
  IDComparisonNode: IDComparison, IDToFloatNode: IDToFloat,
  FloatComparisonNode: FloatComparison, FloatRangeComparisonNode: FloatRangeComparison, FloatRemapNode: FloatRemap,
  FloatClampNode: FloatClamp, FloatSwitchNode: FloatSwitch, FloatEaseNode: FloatEase, FloatSpringNode: FloatSpring,
  FloatCurveNode: FloatCurve, CachedFloatNode: CachedValue, CachedIDNode: CachedValue, CachedBoolNode: CachedValue,
};
