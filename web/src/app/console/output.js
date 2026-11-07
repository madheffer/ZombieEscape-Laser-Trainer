// What the console shows: a capped list of lines, and whoever draws them (ui/console.js) listening for new ones.
// No DOM here, so anything can print without the console window being built (or ever opened).
//
//   print('text')                      a plain line (several, split on \n)
//   print('text', 'warn')              a tone: '' | 'echo' | 'warn' | 'error' | 'net' | 'debug' | 'good' | 'head' | 'dim'
//   con.net('connected')               tone shorthands, with a channel tag for the feeds: "[Net] connected"
//   onLines((added) => ...)            every batch of new lines; onClear(() => ...) when `clear` empties it
//
// A line is { text, tone }. Text is drawn with textContent only: map names and chat come through here.
const MAX_LINES = 2000;
const MAX_CHARS = 2000; // per line: a runaway message can't make the window crawl

export const lines = [];
const listeners = { lines: [], clear: [] };

export function print(text, tone = '') {
  const added = String(text ?? '').split('\n').map((t) => ({ text: t.length > MAX_CHARS ? `${t.slice(0, MAX_CHARS)}…` : t, tone }));
  lines.push(...added);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  for (const fn of listeners.lines) fn(added);
}

export function clearOutput() {
  lines.length = 0;
  for (const fn of listeners.clear) fn();
}

export const onLines = (fn) => listeners.lines.push(fn);
export const onClear = (fn) => listeners.clear.push(fn);

// channel-tagged prints for the feeds (app/console/feeds.js) and anything else that wants to report
const tagged = (tag, tone) => (text) => print(`[${tag}] ${text}`, tone);
export const con = {
  log: (text) => print(text),
  warn: (text) => print(text, 'warn'),
  error: (text) => print(text, 'error'),
  net: tagged('Net', 'net'),
  debug: tagged('Debug', 'debug'),
  game: tagged('Game', ''),
};
