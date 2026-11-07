// What the console logs by itself: the co-op connection and room (who came and went, the round's start and end,
// a slow round trip), script errors, and console.warn / console.error (the game's own warnings: a shader, a load).
// app/state.js log() (the map's warnings, load failures) prints here too, as [Debug].
import { con } from './output.js';

const SLOW_RTT = 150; // ms: a round trip above this is said once ...
const SLOW_EVERY_MS = 30_000; // ... at most this often

export function installFeeds(net) {
  net.on('status', (s, detail) => con.net(`${s}${detail ? `: ${detail}` : ''}`));
  net.on('error', (msg) => con.net(`error: ${msg}`));
  net.on('left', (why) => con.net(why === 'kicked' ? 'removed from the room' : why === 'disconnected' ? 'lost the connection to the room' : 'left the room'));
  net.on('room', (room, prev) => {
    const name = (m) => `${m.name}${m.id === room.you ? ' (you)' : ''}`;
    if (!prev || prev.code !== room.code) {
      con.net(`joined room ${room.code}: ${room.members.map(name).join(', ')}`);
      return;
    }
    const before = new Set(prev.members.map((m) => m.id));
    const now = new Set(room.members.map((m) => m.id));
    for (const m of room.members) if (!before.has(m.id)) con.net(`${m.name} joined`);
    for (const m of prev.members) if (!now.has(m.id)) con.net(`${m.name} left`);
    if (prev.owner !== room.owner) con.net(`${room.members.find((m) => m.id === room.owner)?.name || 'someone'} owns the room now`);
  });
  net.on('game', (m) => {
    const r = Number.isInteger(m.r) ? ` ${m.r}` : '';
    if (m.t === 'start') con.net(`round${r}: loading`);
    else if (m.t === 'go') con.net(`round${r}: go`);
    else if (m.t === 'end') con.net(`round${r}: over${typeof m.result === 'string' ? ` (${m.result.slice(0, 20)})` : ''}`);
  });
  let slowAt = -Infinity;
  setInterval(() => {
    if (!net.inRoom || net.rtt <= SLOW_RTT || performance.now() - slowAt < SLOW_EVERY_MS) return;
    slowAt = performance.now();
    con.net(`slow connection: ${net.rtt} ms round trip`);
  }, 2000);

  addEventListener('error', (e) => con.error(`${e.message || 'error'} (${String(e.filename || '').split('/').pop()}:${e.lineno || 0})`));
  addEventListener('unhandledrejection', (e) => con.error(`unhandled: ${e.reason?.message || String(e.reason)}`));
  for (const level of ['warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...a) => {
      orig(...a);
      try { con[level](a.map((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : safeJson(x))).join(' ')); } catch { /* never break the caller */ }
    };
  }
}

function safeJson(x) {
  try { return JSON.stringify(x)?.slice(0, 300) ?? String(x); } catch { return String(x); }
}
