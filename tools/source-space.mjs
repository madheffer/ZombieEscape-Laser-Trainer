// glTF (VRF export: metres, y up) <-> Source units, for the tools that cut the world glb (chunk-world.mjs, chunk-vis.mjs).
export const M = 1 / 0.0254; // glTF metres -> Source inches; glTF (x, y, z) = Source (y, z, x)
export const toSrc = (v) => [v[2] * M, v[0] * M, v[1] * M];

// column-major 4x4 times a point
export function xform(m, x, y, z) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}
