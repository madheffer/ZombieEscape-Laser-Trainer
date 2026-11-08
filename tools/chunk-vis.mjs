// CS2 visibility for the world chunks (tools/chunk-world.mjs, from lasers-bake's vis.bin: web/src/lib/vis-table.js).
//
// visGroup(node, prim): the vis sub-cell (JOIN units) of a primitive's centre. Lightmapped primitives are joined by
// material within a chunk; with vis they join only within one sub-cell too, so a joined mesh stays small enough for
// its clusters to say something (one mesh across a whole 4096 chunk touches nearly every cluster in it).
// tagVis(vis, scene): every mesh node gets extras.vis = the sorted clusters its triangles' cells touch (an instanced
// node: every instance's box). The game hides a node none of whose clusters the camera's cells can see
// (web/src/world/vis.js). Conservative throughout: a triangle's whole box counts, and a node with a triangle wider
// than TRI_CELLS cells, more than MAX_IDS clusters or none at all gets no tag (always drawn).
import { MathUtils } from '@gltf-transform/core';
import { toSrc, xform } from './source-space.mjs';

const JOIN = 1024;
const TRI_CELLS = 512;
const MAX_IDS = 2048;

// a primitive's Source-space box under matrix m (its POSITION accessor's min / max corners)
function primBox(prim, m) {
  const a = prim.getAttribute('POSITION');
  const lo = a.getMin([]), hi = a.getMax([]);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < 8; k++) {
    const p = toSrc(xform(m, k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2]));
    for (let j = 0; j < 3; j++) { if (p[j] < min[j]) min[j] = p[j]; if (p[j] > max[j]) max[j] = p[j]; }
  }
  return { min, max };
}

export function visGroup(node, prim) {
  const { min, max } = primBox(prim, node.getWorldMatrix());
  return [0, 1, 2].map((k) => Math.floor((min[k] + max[k]) / 2 / JOIN)).join(',');
}

// -> { tagged, untagged } node counts
export function tagVis(vis, scene) {
  const stats = { tagged: 0, untagged: 0 };
  for (const node of scene.listChildren()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const lists = new Set();
    const add = (l) => lists.add(l);
    let ok = true;
    const inst = node.getExtension('EXT_mesh_gpu_instancing');
    if (inst) {
      const t = inst.getAttribute('TRANSLATION'), r = inst.getAttribute('ROTATION'), s = inst.getAttribute('SCALE');
      const count = (t || r || s)?.getCount() ?? 0;
      const base = node.getWorldMatrix(), m = new Array(16), local = new Array(16);
      for (let i = 0; ok && i < count; i++) {
        MathUtils.compose(t ? t.getElement(i, []) : [0, 0, 0], r ? r.getElement(i, []) : [0, 0, 0, 1], s ? s.getElement(i, []) : [1, 1, 1], local);
        multiply(m, base, local);
        for (const p of mesh.listPrimitives()) {
          const { min, max } = primBox(p, m);
          if (!vis.boxLists(min, max, add, TRI_CELLS)) { ok = false; break; }
        }
      }
    } else {
      const m = node.getWorldMatrix(), v = [0, 0, 0];
      for (const p of mesh.listPrimitives()) {
        if (!ok) break;
        const pos = p.getAttribute('POSITION'), idx = p.getIndices()?.getArray();
        const n = idx ? idx.length : pos.getCount();
        const corner = (i) => { pos.getElement(idx ? idx[i] : i, v); return toSrc(xform(m, v[0], v[1], v[2])); };
        for (let i = 0; i + 2 < n; i += 3) {
          const a = corner(i), b = corner(i + 1), c = corner(i + 2);
          const min = [0, 1, 2].map((k) => Math.min(a[k], b[k], c[k])), max = [0, 1, 2].map((k) => Math.max(a[k], b[k], c[k]));
          if (!vis.boxLists(min, max, add, TRI_CELLS)) { ok = false; break; }
        }
      }
    }
    const ids = new Set();
    if (ok) for (const l of lists) for (const c of vis.listIds(l)) ids.add(c);
    if (!ok || !ids.size || ids.size > MAX_IDS) { stats.untagged++; continue; }
    node.setExtras({ ...node.getExtras(), vis: [...ids].sort((x, y) => x - y) });
    stats.tagged++;
  }
  return stats;
}

// out = a * b (column-major 4x4)
function multiply(out, a, b) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}
