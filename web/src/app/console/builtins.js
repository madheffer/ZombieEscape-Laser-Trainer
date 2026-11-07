// The console's own commands, CS2's names: help, find, cvarlist, differences, clear, echo, toggle, incrementvar.
// The help texts and usages are engine2.dll / tier0.dll's where CS2 has them.
import { defineCommand, lookup, entries, parseValue, formatValue } from './registry.js';
import { clearOutput } from './output.js';
import { describe } from './exec.js';

const names = () => entries().filter((e) => !e.hidden).map((e) => e.name);
const cvarNames = () => entries().filter((e) => e.kind === 'cvar' && !e.hidden).map((e) => e.name);
const pad = (s, n) => (s.length >= n ? `${s} ` : s + ' '.repeat(n - s.length));

// one row per entry: name, value (a convar's), flags, help
function row(e) {
  const value = e.kind === 'cvar' ? formatValue(e, e.get()) : 'cmd';
  return `${pad(e.name, 28)}: ${pad(value, 10)}: ${pad(e.flags.join(' '), 14)}: ${e.help}`;
}

// `help` alone: how the console works, then every command and convar with its one-line help
function overview() {
  const list = entries().filter((e) => !e.hidden);
  const line = (e) => `  ${pad(e.kind === 'cvar' ? `${e.name} ${formatValue(e, e.get())}` : `${e.name}${e.usage ? ` ${e.usage}` : ''}`, 34)}${e.help}`;
  return [
    'name             print a convar          name value       set it',
    'a; b             run both                Tab / Shift+Tab  step through the suggestions',
    'Up / Down        your history            help <name>      more on one',
    '` or Esc         close the console       find <text>      search names and help',
    '',
    'Commands:', ...list.filter((e) => e.kind === 'command').map(line),
    '',
    'Convars (with their values):', ...list.filter((e) => e.kind === 'cvar').map(line),
  ];
}

export function registerBuiltins() {
  defineCommand({
    name: 'help', usage: '<name>', help: 'Find help about a convar or command.',
    complete: names,
    run(args) {
      if (args.length < 2) return overview();
      const e = lookup(args[1]);
      if (!e) return `help:  no cvar or command named ${args[1]}`;
      if (e.kind === 'cvar') return describe(e);
      return [`"${e.name}"${e.usage ? ` ${e.usage}` : ''}`, `  ${e.flags.join(' ')}${e.flags.length ? ' - ' : ''}${e.help}`];
    },
  });
  defineCommand({
    name: 'find', usage: '<string> [<string>...]', help: 'Find concommands with the specified string in their name/help text.',
    run(args) {
      if (args.length < 2) return 'Usage:  find <string> [<string>...]';
      const words = args.slice(1).map((w) => w.toLowerCase());
      const hits = entries().filter((e) => !e.hidden && words.every((w) => e.name.includes(w) || e.help.toLowerCase().includes(w)));
      return hits.length ? hits.map(row) : `find: nothing matches ${words.join(' ')}`;
    },
  });
  defineCommand({
    name: 'cvarlist', usage: '[ partial ]', help: 'Show the list of convars/concommands.',
    run(args) {
      const q = (args[1] || '').toLowerCase();
      const hits = entries().filter((e) => !e.hidden && e.name.startsWith(q));
      return [...hits.map(row), `${hits.length} convars/concommands for [${q}]`];
    },
  });
  defineCommand({
    name: 'differences', help: 'Show all convars which are not at their default values.',
    run() {
      const hits = entries().filter((e) => e.kind === 'cvar' && e.def !== undefined && e.get() !== e.def);
      return hits.length ? hits.flatMap((e) => describe(e).slice(0, 1)) : 'Every convar is at its default.';
    },
  });
  defineCommand({ name: 'clear', help: 'Clear console output from all views.', run: () => { clearOutput(); } });
  defineCommand({ name: 'echo', usage: '<text>', help: 'Echo text to console.', run: (args) => args.slice(1).join(' ') });
  defineCommand({
    name: 'toggle', usage: '<convar> [value1 value2 ...]', help: 'Toggles a convar on or off, or cycles through a set of values.',
    complete: (args) => (args.length === 2 ? cvarNames() : []),
    run(args, ctx) {
      const e = lookup(args[1]);
      if (!e || e.kind !== 'cvar') return args[1] ? `toggle: no convar named ${args[1]}` : 'Usage:  toggle <convar> [value1 value2 ...]';
      if (e.readonly) return `${e.name} is read only`;
      const why = e.guard?.(ctx);
      if (why) return why;
      const cur = e.get();
      let next;
      if (args.length > 2) {
        const values = args.slice(2).map((v) => parseValue(e, v));
        const i = values.findIndex((v) => v === cur);
        next = values[(i + 1) % values.length];
      } else if (e.type === 'bool') next = !cur;
      else if (typeof cur === 'number') next = parseValue(e, cur ? '0' : '1');
      else return `toggle: ${e.name} needs values to cycle through`;
      e.set(next, ctx);
      return describe(e).slice(0, 1);
    },
  });
  defineCommand({
    name: 'incrementvar', usage: 'varName minValue maxValue delta', help: 'Increment a convar, wrapping between min and max.',
    complete: (args) => (args.length === 2 ? cvarNames() : []),
    run(args, ctx) {
      if (args.length < 5) return 'Usage: incrementvar varName minValue maxValue delta';
      const e = lookup(args[1]);
      if (!e || e.kind !== 'cvar' || typeof e.get() !== 'number') return `incrementvar: cvar "${args[1]}" not found`;
      if (e.readonly) return `${e.name} is read only`;
      const why = e.guard?.(ctx);
      if (why) return why;
      const [lo, hi, d] = args.slice(2, 5).map(Number);
      if (![lo, hi, d].every(Number.isFinite) || hi < lo) return 'Usage: incrementvar varName minValue maxValue delta';
      let v = e.get() + d;
      if (v > hi + 1e-9) v = lo; else if (v < lo - 1e-9) v = hi;
      e.set(parseValue(e, String(v)), ctx);
      return describe(e).slice(0, 1);
    },
  });
}
