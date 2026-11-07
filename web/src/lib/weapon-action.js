// A player's weapon action on the co-op position batch (app/coop.js -> server/coop-round.js -> the others'
// world/peers.js), so a teammate's body shoots, swings and reloads (world/body-actions.js):
//   f: shots + swings so far (a running count, wrapping), fs: 1 when the last was a knife stab, rl: 1 while reloading
const WRAP = 1 << 20;

// your own, from the viewmodel (weapons/viewmodel.js shots / lastAttack / reloading)
export function weaponAction(vm) {
  if (!vm) return {};
  return { f: (vm.shots || 0) % WRAP, fs: /heavy/.test(vm.lastAttack || '') ? 1 : 0, rl: vm.held && vm.reloading ? 1 : 0 };
}

// someone else's, as it came off the wire: the fields that are valid, nothing else
export function cleanWeaponAction(m) {
  const out = {};
  if (Number.isInteger(m?.f) && m.f >= 0 && m.f < WRAP) out.f = m.f;
  if (m?.fs === 1) out.fs = 1;
  if (m?.rl === 1) out.rl = 1;
  return out;
}

// a count that wrapped since the last one still reads as going up (body-actions.js wants a monotonic count)
export function unwrapCount(prev, f) {
  if (!Number.isInteger(f)) return prev;
  if (prev == null) return f;
  const base = prev - (prev % WRAP);
  let n = base + f;
  if (n < prev - WRAP / 2) n += WRAP;
  return n;
}

export const stabOrSwing = (fs) => (fs ? 'attack_knife_heavymiss' : 'attack_knife_lightmiss');
