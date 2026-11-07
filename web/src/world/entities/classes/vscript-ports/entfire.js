// What every VScript port does: EntFire as the script entity (the caller), and Squirrel's rand().
//
//   fire(e, target, input, param, delay)   EntFire(target, input, param, delay)
//   timeline(e, rows)                      a run of EntFire lines, rows = [target, input, delay, param?]
//   rand(e)                                rand(): an int 0..RAND_MAX (32767, the Windows CRT CS:GO's srcds links)
//   randomInt(e, lo, hi), shuffle(e, a)    RandomInt(), lzyorha's shuffle()
//   spawnAt(e, maker, origin, angles)      maker.SpawnEntityAtLocation(origin, angles)
import { poseMatrix, angleQuat } from '../../math.js';

export const RAND_MAX = 32767;

export const fire = (e, target, input, param = '', delay = 0, activator = null) =>
  e.engine.fire(target, input, param == null ? '' : String(param), delay, activator, e);

export function timeline(e, rows) {
  for (const [target, input, delay, param] of rows) fire(e, target, input, param, delay);
}

export const rand = (e) => Math.floor(e.engine.random() * (RAND_MAX + 1));

// activator.SetOrigin(Vector(x, y, z)) on whoever the call came from (Source 1's AddOutput origin = KeyValue)
export const setOrigin = (e, act, [x, y, z]) => act && fire(e, '!activator', 'AddOutput', `origin ${x} ${y} ${z}`, 0, act);

// RandomInt(lo, hi): inclusive
export const randomInt = (e, lo, hi) => lo + Math.floor(e.engine.random() * (hi - lo + 1));

// lzyorha's shuffle(Array): each slot swapped with a RandomInt pick (not Fisher-Yates), in place
export function shuffle(e, a) {
  for (let i = 0; i < a.length; i++) {
    const j = randomInt(e, 0, a.length - 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// maker.SpawnEntityAtLocation(Vector(origin), Vector(angles)): the env_entity_maker's template, placed at origin and
// turned by angles (CEnvEntityMaker::SpawnEntityAtLocation), the maker's OnEntitySpawned after
export function spawnAt(e, maker, origin, angles) {
  const m = e.engine.findOne(maker), t = m && e.engine.findOne(m.kv.entitytemplate);
  if (!t) { e.engine.warnOnce(`vs-maker:${maker}`, `SpawnEntityAtLocation: no maker/template ${maker}`); return; }
  e.engine.spawnTemplate(t, poseMatrix(origin, angleQuat(angles)), null, m);
}
