// What every VScript port does: EntFire as the script entity (the caller), and Squirrel's rand().
//
//   fire(e, target, input, param, delay)   EntFire(target, input, param, delay)
//   timeline(e, rows)                      a run of EntFire lines, rows = [target, input, delay, param?]
//   rand(e)                                rand(): an int 0..RAND_MAX (32767, the Windows CRT CS:GO's srcds links)
export const RAND_MAX = 32767;

export const fire = (e, target, input, param = '', delay = 0, activator = null) =>
  e.engine.fire(target, input, param == null ? '' : String(param), delay, activator, e);

export function timeline(e, rows) {
  for (const [target, input, delay, param] of rows) fire(e, target, input, param, delay);
}

export const rand = (e) => Math.floor(e.engine.random() * (RAND_MAX + 1));

// activator.SetOrigin(Vector(x, y, z)) on whoever the call came from (Source 1's AddOutput origin = KeyValue)
export const setOrigin = (e, act, [x, y, z]) => act && fire(e, '!activator', 'AddOutput', `origin ${x} ${y} ${z}`, 0, act);
