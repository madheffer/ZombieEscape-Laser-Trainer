// The console's names: convars (a value you read and set) and commands (something you run), in one table, as CS2's
// ICvar keeps them. Each module registers its own (app/console/builtins.js, game.js, ...); nothing here knows the game.
//
//   defineCvar({ name, help, flags, type, def, min, max, choices, get, set })
//     type 'float' | 'int' | 'bool' | 'string'; get() -> the value; set(v) stores an already parsed + range-clamped v.
//     flags: words shown with the help ('archive' = kept in this browser, 'cheat' = solo only, 'readonly' = no set)
//   defineCommand({ name, help, usage, flags, run(args, ctx), complete(args) -> string[] })
//     args[0] is the name; run returns nothing, or lines to print (string | string[]).
//     complete(args): candidates for the last arg being typed (args[args.length - 1], maybe '').
//   lookup(name), entries(), parseValue(cvar, text), formatValue(cvar, v)
const table = new Map(); // lower-case name -> entry

const NAME = /^[a-z0-9_+\-.]{1,64}$/;

function add(entry) {
  const key = String(entry.name).toLowerCase();
  if (!NAME.test(key)) throw new Error(`console: bad name ${entry.name}`);
  table.set(key, { help: '', flags: [], ...entry, name: key });
}

export function defineCvar(def) {
  if (typeof def.get !== 'function') throw new Error(`console: ${def.name} needs get()`);
  add({ kind: 'cvar', type: 'float', ...def, readonly: !def.set || def.flags?.includes('readonly') });
}

export function defineCommand(def) {
  if (typeof def.run !== 'function') throw new Error(`console: ${def.name} needs run()`);
  add({ kind: 'command', ...def });
}

export const lookup = (name) => table.get(String(name ?? '').toLowerCase()) || null;
export const entries = () => [...table.values()].sort((a, b) => (a.name < b.name ? -1 : 1));

// Text -> the cvar's type, clamped to its range. Throws on what it can't take (shown to the user as is).
export function parseValue(cvar, text) {
  const s = String(text ?? '').trim();
  switch (cvar.type) {
    case 'bool': {
      const l = s.toLowerCase();
      if (l === '1' || l === 'true') return true;
      if (l === '0' || l === 'false') return false;
      const n = Number(s);
      if (Number.isFinite(n)) return n !== 0;
      throw new Error(`${cvar.name}: expected 0 or 1`);
    }
    case 'int': case 'float': {
      let n = Number(s);
      if (!s || !Number.isFinite(n)) throw new Error(`${cvar.name}: expected a number`);
      if (cvar.type === 'int') n = Math.trunc(n);
      if (cvar.min != null) n = Math.max(cvar.min, n);
      if (cvar.max != null) n = Math.min(cvar.max, n);
      return n;
    }
    default:
      if (cvar.choices && !cvar.choices.includes(s)) throw new Error(`${cvar.name}: one of ${cvar.choices.join(', ')}`);
      return s;
  }
}

export function formatValue(cvar, v) {
  if (cvar.type === 'bool') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
  return String(v ?? '');
}
