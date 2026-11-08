// CS2's own visibility culling (its world_visibility PVS, baked to vis.bin: lib/vis-table.js). Each frame the camera's
// 256-unit cell names the clusters it may be in; the union of their PVS rows is what CS2 could draw from there. A world
// node (tools/chunk-vis.mjs tags each with extras.vis, its clusters) or an entity model none of whose clusters is in
// that set is not drawn. Conservative both ways (a cell's clusters, a node's every touched cell), so nothing CS2
// would draw is hidden; the camera outside every cluster (in a wall, off the map) draws everything.
// Rendering only. On top of the stage's view box (view-box.js) and the occlusion queries (occlusion.js).
// ?novis draws everything (comparisons).
import * as THREE from 'three';
import { visibleIn } from '../lib/vis-table.js';

const ENTITY_CELLS = 64; // an entity box over this many cells counts as seen
const _box = new THREE.Box3();

export class WorldVis {
  constructor(table) {
    this.table = table;
    this.row = new Uint8Array(table.pvsBytes);
    this.list = -2; // the camera cell's list the row was built for (-1: outside every cluster: all drawn)
    this.nodes = []; // tagged world nodes: { o, ids }
    this.frame = 0; // bumped whenever the row changes: entities re-test then
  }

  // a streamed chunk came in: its tagged nodes (glTF node extras land in userData)
  track(scene) {
    scene.traverse((o) => {
      const v = o.userData?.vis;
      if (!Array.isArray(v) || !v.length || v.length > 65535) return;
      const ids = Uint16Array.from(v, (c) => (Number.isInteger(c) && c >= 0 && c < this.table.clusters ? c : 0));
      if (o.userData.drawn === undefined) o.userData.drawn = o.visible; // editor-only meshes stay hidden
      this.nodes.push({ o, ids });
      this.show(o, this.allVisible || visibleIn(this.row, ids));
    });
  }

  get allVisible() { return this.list < 0; }

  // the camera (Source units) this frame: rebuild the row when its cell's cluster list changed, then re-sort the nodes
  update(pos) {
    const l = this.table.cellAt(pos.x, pos.y, pos.z);
    if (l === this.list) return;
    this.list = l;
    this.frame++;
    this.row.fill(0);
    if (l >= 0) this.table.orRows(this.table.listIds(l), this.row);
    const all = l < 0;
    for (const n of this.nodes) this.show(n.o, all || visibleIn(this.row, n.ids));
  }

  // visible = drawn (editor-only), inside the view box (render.js fitView: userData.inBox) and in the PVS
  show(o, pvs) {
    o.userData.pvs = pvs;
    o.visible = o.userData.drawn !== false && o.userData.inBox !== false && pvs;
  }

  // an entity model, by its world box (localBox placed by matrix): re-tested when it moves to other cells or the row changes
  entityVisible(g, localBox, matrix) {
    if (this.allVisible || localBox.isEmpty()) return true;
    const u = g.userData;
    _box.copy(localBox).applyMatrix4(matrix);
    const c = this.table.cell, min = _box.min, max = _box.max;
    const key = `${Math.floor(min.x / c)},${Math.floor(min.y / c)},${Math.floor(min.z / c)},${Math.floor(max.x / c)},${Math.floor(max.y / c)},${Math.floor(max.z / c)}`;
    if (u.visKey !== key) {
      u.visKey = key;
      const lists = new Set();
      u.visLists = this.table.boxLists([min.x, min.y, min.z], [max.x, max.y, max.z], (l) => lists.add(l), ENTITY_CELLS) && lists.size ? [...lists].map((l) => this.table.listIds(l)) : null;
      u.visFrame = -1;
    }
    if (!u.visLists) return true; // too big, or in no cluster: drawn
    if (u.visFrame !== this.frame) { u.visFrame = this.frame; u.visSeen = u.visLists.some((ids) => visibleIn(this.row, ids)); }
    return u.visSeen;
  }
}
