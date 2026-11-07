// A player's move keys as the co-op state message carries them (`mv`: [forward, side], each -1..1, side + = right):
// their body's plant and turn reads them (world/anim-graph/anim-state.js). Untrusted on both ends: null unless valid.
export function moveKeys(v) {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const ok = (x) => typeof x === 'number' && Number.isFinite(x) && x >= -1 && x <= 1;
  return ok(v[0]) && ok(v[1]) ? [v[0], v[1]] : null;
}
