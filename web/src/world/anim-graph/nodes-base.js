// The node base classes of the anim graph runtime (graph.js), after Esoterica's GraphNode / PoseNode / ValueNode:
// initialization is reference counted (several parents can hold one node), value nodes compute once per update.
import { DEFAULT_TRACK } from './sync-track.js';

export class Node {
  constructor(g, d, idx, cls) {
    this.g = g; this.d = d; this.idx = idx; this.cls = cls;
    this.initCount = 0;
    this.lastUpdate = -1;
  }
  get initialized() { return this.initCount > 0; }
  init(ctx, t) { if (this.initCount++ === 0) this.onInit(ctx, t); }
  shutdown(ctx) { if (this.initCount > 0 && --this.initCount === 0) this.onShutdown(ctx); }
  onInit() {}
  onShutdown() {}
  n(i) { return this.g.node(i); }
  get path() { return this.g.def.m_nodePaths?.[this.idx] ?? `#${this.idx}`; }
}

export class ValueNode extends Node {
  value(ctx) {
    if (this.lastUpdate !== ctx.updateId) {
      if (!this.initialized && this.needsInit) this.init(ctx);
      this.lastUpdate = ctx.updateId;
      this.cached = this.compute(ctx);
    }
    return this.cached;
  }
  compute() { return undefined; }
}

export class PoseNode extends Node {
  constructor(...a) { super(...a); this.duration = 0; this.prev = 0; this.cur = 0; }
  valid() { return true; }
  syncTrack() { return DEFAULT_TRACK; }
  onInit() { this.prev = this.cur = 0; this.duration = 0; }
  update(ctx) { return { pose: null, events: ctx.emptyRange() }; }
  // copy a child's timing (state, selector, passthrough ...)
  takeTime(c) { this.duration = c.duration; this.prev = c.prev; this.cur = c.cur; }
}

// an unsupported class: a value node yields nothing, a pose node no pose (logged once per class)
const warned = new Set();
export class UnknownNode extends PoseNode {
  constructor(...a) {
    super(...a);
    if (!warned.has(this.cls)) { warned.add(this.cls); console.warn(`anim-graph: no runtime for ${this.cls} (${this.path})`); }
  }
  value() { return undefined; }
  valid() { return false; }
}

// Esoterica Math::Easing::Evaluate for the ops CS2's graphs use
export function ease(op, t) {
  switch (op) {
    case 'InQuad': return t * t;
    case 'OutQuad': return 1 - (1 - t) * (1 - t);
    case 'InOutQuad': return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    case 'InCubic': return t ** 3;
    case 'OutCubic': return 1 - (1 - t) ** 3;
    case 'InOutCubic': return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    case 'InSine': return 1 - Math.cos((t * Math.PI) / 2);
    case 'OutSine': return Math.sin((t * Math.PI) / 2);
    case 'InOutSine': return -(Math.cos(Math.PI * t) - 1) / 2;
    case 'None': return 1;
    default: return t; // Linear
  }
}
