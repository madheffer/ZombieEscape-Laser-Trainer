// A running instance of one of CS2's compiled anim graphs (tools/tp-graph.mjs bakes them), ported from Esoterica's
// GraphInstance / GraphContext (the runtime CS2's NmGraph comes from):
//   - nodes are created from the compiled definitions on first use (`node(i)`), keyed by class (nodes-*.js)
//   - value nodes compute once per update; pose nodes are initialized at a sync time, updated with an optional sync
//     range (the parent keeping them in step), and return { pose, events: [start, end) } (pose null = no pose)
//   - control parameters are set by name (`set`); a referenced graph (another graph file) reads its parent's
//     parameters of the same name, as Esoterica's ReferencedGraphNode reflects them
//   - sampled events (clip ID events, state / graph events) live in a per-update buffer that event conditions search
// Not done (not needed for a player you watch): root motion, pose caching for forced transitions, ragdoll, recording.
import { Pose } from './pose.js';
import { Clip } from './clip.js';
import { NODE_TYPES } from './nodes.js';

// the per-update scratch shared by a graph and the graphs it references
export class Context {
  constructor(skel) {
    this.skel = skel;
    this.dt = 0;
    this.updateId = 0;
    this.active = true; // Esoterica's BranchState: false while updating a transition's source
    this.layer = null; // { weight, rmWeight, mask: Float32Array|null, additive }
    this.events = []; // { anim: bool, id, type, active, ignored, weight, node }
    this._pool = [];
    this._used = 0;
  }
  begin(dt) { this.dt = dt; this.updateId++; this.events.length = 0; this._used = 0; this.active = true; this.layer = null; }
  pose() { // a pose buffer for this update (Esoterica's task system pose pool)
    if (this._used === this._pool.length) this._pool.push(new Pose(this.skel));
    return this._pool[this._used++];
  }
  emptyRange() { return [this.events.length, this.events.length]; }
  graphEvent(node, id, type) { if (id) this.events.push({ anim: false, id, type, active: this.active, ignored: false, weight: 1, node }); }
}

export class GraphInstance {
  // file: { graph, clips } (one baked graph); lib: { skel, graph(name) -> file | null } for referenced graphs
  constructor(file, lib, parent = null) {
    this.def = file.graph;
    this.lib = lib;
    this.skel = lib.skel;
    this.parent = parent;
    this.nodes = new Array(this.def.m_nodes.length);
    // data slots: clips by resource path (a slot index is an index into m_resources)
    this.clips = new Map();
    for (const [p, c] of Object.entries(file.clips || {})) this.clips.set(p, new Clip(p, c, this.skel.count));
    // parameters: control params are the first nodes, in m_controlParameterIDs order; virtual ones map to a node
    this.paramIndex = new Map();
    this.def.m_controlParameterIDs.forEach((id, i) => this.paramIndex.set(id, i));
    (this.def.m_virtualParameterIDs || []).forEach((id, i) => this.paramIndex.set(id, this.def.m_virtualParameterNodeIndices[i]));
    this.values = new Map(); // control parameter values by node index
    this.referenced = new Map(); // referenced graph slot -> GraphInstance | null
  }

  node(i) {
    if (i == null || i < 0) return null;
    let n = this.nodes[i];
    if (!n) {
      const d = this.def.m_nodes[i];
      const cls = String(d._class).replace(/^CNm/, '').replace(/::CDefinition$/, '');
      const T = NODE_TYPES[cls] || NODE_TYPES.Unknown;
      n = this.nodes[i] = new T(this, d, i, cls);
    }
    return n;
  }

  clipForSlot(slot) {
    const p = this.def.m_resources[slot];
    return typeof p === 'string' ? this.clips.get(p) || null : null;
  }

  referencedGraph(slotIdx) {
    if (this.referenced.get(slotIdx)) return this.referenced.get(slotIdx); // a null (not loaded yet) is asked again
    const slot = this.def.m_referencedGraphSlots?.[slotIdx];
    const path = slot ? this.def.m_resources[slot.m_dataSlotIdx] : null;
    const file = typeof path === 'string' ? this.lib.graph(path) : null;
    const g = file ? new GraphInstance(file, this.lib, this) : null;
    this.referenced.set(slotIdx, g);
    return g;
  }

  // a control parameter's value: set on this graph, else (a referenced graph) its parent's parameter of that name
  paramValue(nodeIdx) {
    if (this.values.has(nodeIdx)) return this.values.get(nodeIdx);
    if (this.parent) {
      const id = this.def.m_controlParameterIDs[nodeIdx];
      const pi = this.parent.paramIndex.get(id);
      if (pi != null) {
        if (pi < this.parent.def.m_controlParameterIDs.length) return this.parent.paramValue(pi);
        return this.parent.node(pi)?.value(this._ctx);
      }
    }
    return undefined;
  }

  set(name, value) {
    const i = this.paramIndex.get(name);
    if (i != null && i < this.def.m_controlParameterIDs.length) this.values.set(i, value);
  }

  get root() { return this.node(this.def.m_nRootNodeIdx); }
  get pathOf() { return (i) => this.def.m_nodePaths?.[i] ?? `#${i}`; }

  // one frame: dt seconds; returns the root's pose (or null)
  update(ctx, dt, top = true) {
    this._ctx = ctx;
    if (top) ctx.begin(dt);
    const root = this.root;
    if (!root.initialized) root.init(ctx, { idx: 0, pct: 0 });
    const res = root.update(ctx, null);
    return res.pose || ctx.pose().setRef();
  }
}

// the skeleton tools/tp-graph.mjs writes -> what poses need
export function makeSkeleton(json) {
  const count = json.bones.length;
  const ref = new Float32Array(count * 8);
  json.refPose.forEach((t, i) => ref.set(t, i * 8)); // [tx, ty, tz, s, qx, qy, qz, qw]
  const index = new Map(json.bones.map((b, i) => [b, i]));
  return { count, bones: json.bones, parents: Int16Array.from(json.parents), ref, index, masks: json.masks || {} };
}
