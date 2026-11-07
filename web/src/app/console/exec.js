// Running a console line and completing one, the way CS2's console does: `name` alone prints a convar, `name value`
// sets it, a command runs with its args; `;` separates several, "quotes" keep spaces in an arg. Unknown names get
// engine2.dll's own "Unknown command '%s'!".
//
//   execute(line, ctx)    echoes "] line" and runs it; ctx goes to every command (app/console/index.js builds it)
//   complete(line)        [{ line, name, detail }]: what Tab / the suggestion list offers for what is typed
//   describe(cvar)        the lines `name` alone prints
import { lookup, entries, parseValue, formatValue } from './registry.js';
import { print } from './output.js';

const MAX_LINE = 512;
const MAX_SUGGESTIONS = 40;

// statements (split on ; outside quotes), each a list of args
export function tokenize(line) {
  const out = [];
  let args = [], cur = '', inQuote = false, has = false;
  const endArg = () => { if (has) args.push(cur); cur = ''; has = false; };
  const endStatement = () => { endArg(); if (args.length) out.push(args); args = []; };
  for (const ch of String(line).slice(0, MAX_LINE)) {
    if (ch === '"') { inQuote = !inQuote; has = true; continue; }
    if (!inQuote && ch === ';') { endStatement(); continue; }
    if (!inQuote && /\s/.test(ch)) { endArg(); continue; }
    cur += ch; has = true;
  }
  endStatement();
  return out;
}

export function describe(cvar) {
  const range = [];
  if (cvar.def !== undefined) range.push(`default ${formatValue(cvar, cvar.def)}`);
  if (cvar.min != null) range.push(`min ${formatValue(cvar, cvar.min)}`);
  if (cvar.max != null) range.push(`max ${formatValue(cvar, cvar.max)}`);
  if (cvar.choices) range.push(`one of ${cvar.choices.join(' / ')}`);
  const out = [`${cvar.name} = ${formatValue(cvar, cvar.get())}${range.length ? ` (${range.join(', ')})` : ''}`];
  const flags = cvar.flags.join(' ');
  if (flags || cvar.help) out.push(`  ${flags}${flags && cvar.help ? ' - ' : ''}${cvar.help}`);
  return out;
}

const printAll = (out, tone) => { if (out == null) return; for (const l of Array.isArray(out) ? out : [out]) print(l, tone); };

export function execute(line, ctx = {}, { echo = true } = {}) {
  const text = String(line ?? '').trim();
  if (!text) return;
  if (echo) print(`] ${text}`, 'echo');
  for (const args of tokenize(text)) runStatement(args, ctx);
}

function runStatement(args, ctx) {
  const entry = lookup(args[0]);
  if (!entry) { print(`Unknown command '${args[0]}'!`, 'warn'); return; }
  try {
    const why = entry.guard?.(ctx); // a cheat in a room, a command that needs a run...
    if (entry.kind === 'command') {
      if (why) { print(why, 'warn'); return; }
      printAll(entry.run(args, ctx));
      return;
    }
    if (args.length < 2) { printAll(describe(entry)); return; }
    if (entry.readonly) { print(`${entry.name} is read only`, 'warn'); return; }
    if (why) { print(why, 'warn'); return; }
    entry.set(parseValue(entry, args.slice(1).join(' ')), ctx);
  } catch (e) {
    print(String(e?.message || e), 'error');
  }
}

// The suggestions for what is typed: names while the first word is being typed (those starting with it, then those
// containing it), then the entry's own arg candidates (a bool's 0 / 1, a choice list, a command's complete()).
// Only the last ;-statement is completed; the rest of the line is kept in front.
export function complete(line) {
  const s = String(line ?? '');
  const cut = s.lastIndexOf(';') + 1;
  const head = s.slice(0, cut) + (cut ? ' ' : '');
  const part = s.slice(cut).replace(/^\s+/, '');
  if (!part) return [];
  const words = part.split(/\s+/);
  if (words.length === 1) {
    const q = words[0].toLowerCase();
    const all = entries().filter((e) => !e.hidden);
    const starts = all.filter((e) => e.name.startsWith(q));
    const inside = q.length >= 2 ? all.filter((e) => !e.name.startsWith(q) && e.name.includes(q)) : [];
    return [...starts, ...inside].slice(0, MAX_SUGGESTIONS).map((e) => ({
      line: `${head}${e.name}${e.kind === 'command' && !e.complete ? '' : ' '}`.replace(/^\s+/, ''), name: e.name,
      detail: e.kind === 'cvar' ? formatValue(e, e.get()) : (e.usage || ''),
    }));
  }
  const entry = lookup(words[0]);
  if (!entry) return [];
  const partial = words[words.length - 1].toLowerCase();
  let candidates = [];
  try {
    if (entry.kind === 'cvar' && words.length === 2) candidates = entry.type === 'bool' ? ['0', '1'] : entry.choices || [];
    else if (entry.complete) candidates = entry.complete(words) || [];
  } catch { candidates = []; }
  const before = words.slice(0, -1).join(' ');
  return candidates.filter((c) => String(c).toLowerCase().startsWith(partial)).slice(0, MAX_SUGGESTIONS)
    .map((c) => ({ line: `${head}${before} ${c}`.replace(/^\s+/, ''), name: `${before} ${c}`, detail: '' }));
}
