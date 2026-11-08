// CS2's precomputed visibility as the bake ships it (bake/VisBake.cs: vis.bin, gzip): which clusters touch each 256-unit
// cell, and each cluster's PVS row (the clusters visible from it). Read by the game (world/vis.js: what the camera can
// see) and by tools/chunk-world.mjs (which clusters each world mesh lies in). No browser or three.js here.
//
//   const vis = await readVis(gzippedArrayBuffer)    // null: not a vis.bin (or a newer version)
//   vis.cellAt(x, y, z)          -> index of the cell's cluster list, or -1 (outside every cluster: solid / off the map)
//   vis.listIds(i)               -> Uint16Array of that list's clusters
//   vis.boxLists(min, max, fn)   calls fn(listIndex) for every cell the box touches; false when over `cap` cells
//   vis.orRows(ids, out)         out |= the PVS row of each cluster in ids (out: Uint8Array of pvsBytes)
//   visibleIn(row, ids)          whether any cluster of ids is set in row
//
// The file is untrusted (it comes from a map): every count is checked against the bytes it has before use.

const MAGIC = 0x5349564c; // "LVIS" little-endian

export async function readVis(gz) {
  let buf;
  try {
    buf = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  } catch { return null; }
  return parseVis(buf);
}

export function parseVis(buf) {
  const dv = new DataView(buf);
  if (buf.byteLength < 32 || dv.getUint32(0, true) !== MAGIC || dv.getUint32(4, true) !== 1) return null;
  const [clusters, pvsBytes, cell, runs, lists, ids] = [8, 12, 16, 20, 24, 28].map((o) => dv.getUint32(o, true));
  const need = 32 + runs * (2 + 2 + 2 + 2 + 4) + (lists + 1) * 4 + ids * 2 + clusters * pvsBytes;
  if (!(cell > 0) || clusters > 65535 || pvsBytes * 8 < clusters || need > buf.byteLength) return null;
  let o = 32;
  const take = (Type, n) => { const a = new Type(n); for (let i = 0; i < n; i++, o += Type.BYTES_PER_ELEMENT) a[i] = read(Type, o); return a; };
  const read = (Type, at) => (Type === Int16Array ? dv.getInt16(at, true) : Type === Uint16Array ? dv.getUint16(at, true) : dv.getUint32(at, true));
  const rx = take(Int16Array, runs), ry = take(Int16Array, runs), rz = take(Int16Array, runs);
  const rn = take(Uint16Array, runs), rl = take(Uint32Array, runs);
  const start = take(Uint32Array, lists + 1);
  const idArr = take(Uint16Array, ids);
  const pvs = new Uint8Array(buf, o, clusters * pvsBytes);
  for (let i = 0; i < runs; i++) if (rl[i] >= lists) return null;
  for (let i = 0; i < lists; i++) if (start[i] > start[i + 1] || start[i + 1] > ids) return null;
  for (let i = 0; i < ids; i++) if (idArr[i] >= clusters) return null;
  // a column's key, sorted as the runs are (x, then y)
  const col = new Float64Array(runs);
  for (let i = 0; i < runs; i++) col[i] = (rx[i] + 32768) * 65536 + (ry[i] + 32768);
  return new VisTable({ clusters, pvsBytes, cell, rz, rn, rl, start, idArr, pvs, col });
}

class VisTable {
  constructor(t) { Object.assign(this, t); }

  // the list index of cell (cx, cy, cz) in cell units, or -1
  cellList(cx, cy, cz) {
    const key = (cx + 32768) * 65536 + (cy + 32768), col = this.col;
    let lo = 0, hi = col.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (col[m] < key) lo = m + 1; else hi = m; }
    for (let i = lo; i < col.length && col[i] === key; i++) {
      const z = this.rz[i];
      if (cz < z) return -1; // a column's runs go up in z
      if (cz < z + this.rn[i]) return this.rl[i];
    }
    return -1;
  }

  cellAt(x, y, z) { const c = this.cell; return this.cellList(Math.floor(x / c), Math.floor(y / c), Math.floor(z / c)); }

  listIds(i) { return this.idArr.subarray(this.start[i], this.start[i + 1]); }

  // every cell a box (Source units) touches -> fn(list index); false (nothing called) past cap cells
  boxLists(min, max, fn, cap = Infinity) {
    const c = this.cell;
    const x0 = Math.floor(min[0] / c), y0 = Math.floor(min[1] / c), z0 = Math.floor(min[2] / c);
    const x1 = Math.floor(max[0] / c), y1 = Math.floor(max[1] / c), z1 = Math.floor(max[2] / c);
    if (!Number.isFinite(x0 + y0 + z0 + x1 + y1 + z1) || (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > cap) return false;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const l = this.cellList(x, y, z);
      if (l >= 0) fn(l);
    }
    return true;
  }

  orRows(ids, out) {
    const n = this.pvsBytes, pvs = this.pvs;
    for (const c of ids) { const o = c * n; for (let k = 0; k < n; k++) out[k] |= pvs[o + k]; }
    return out;
  }
}

export function visibleIn(row, ids) {
  for (let i = 0; i < ids.length; i++) { const c = ids[i]; if (row[c >> 3] & (1 << (c & 7))) return true; }
  return false;
}
