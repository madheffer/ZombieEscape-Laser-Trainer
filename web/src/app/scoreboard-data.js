// What the scoreboard (ui/scoreboard.js, Tab in a co-op room) shows. Each player's numbers are the room's totals
// (server/coop-tally.js), plus this round's lasers / balls dodged while the round is still on (the server's copies of
// the runs count them: app/coop.js 'score'). Once the round's totals reach the room, those replace that live count.
//
// Where a player stands follows GFL's ZE: a human who dies is struck off where they are (CS2's elimination X, the row
// dimmed) and moves to the zombies when ZR would respawn them as one, zr_respawn_delay (CS2Fixes zombiereborn.cpp:
// 5 s) later. Here nobody respawns, so they stay there dead, like the zombies in CS2's own board after the humans win.
// Room members who aren't in the round watch it: CS2's spectators, under the teams.
import { S } from './state.js';
import { net } from './coop.js';
import { laserScore, emptyTally } from '../lib/laser-score.js';

const ZR_RESPAWN_DELAY_MS = 5000;
const FLASH_MS = 1000; // CS2's sb-player-pulse-death: the row flashes red as it dies

let mapName = '', mapSince = 0; // CS2's map-elapsed clock, top right

const sameTally = (a, b) => !!a && !!b && Object.keys(a).every((k) => a[k] === b[k]);

function row(id, name, ping, tally, extra) {
  const t = { ...tally };
  return { id, name, ping, you: id === net.you, ...t, score: laserScore(t), ...extra };
}

// -> { title, time, score: { humans, zombies }, humans: [row], zombies: [row], spec: [row], alive, total } or null
// row: { id, name, ping, you, dead, flash (ms into its death flash, or null), lasers, balls, wins, losses, mvps, score }
export function scoreboardData(now = performance.now()) {
  const room = net.room;
  if (!room) return null;
  const map = S.map?.name || room.map || '';
  if (map !== mapName) { mapName = map; mapSince = now; }
  const members = new Map(room.members.map((m) => [m.id, m]));
  const humans = [], zombies = [], spec = [];
  const mp = S.mp;
  const inRound = new Set();
  if (mp) {
    for (const p of mp.players.values()) {
      const m = members.get(p.id);
      if (!m) continue; // left the room: CS2 drops a disconnected player from the board
      inRound.add(p.id);
      const base = mp.tallyBase.get(p.id) || emptyTally();
      // the round counted into the room already (its end): the room's totals; until then the start's + this round's
      const tally = mp.ended && !sameTally(m.tally, base) ? m.tally : { ...base, lasers: base.lasers + p.lasers, balls: base.balls + p.balls };
      const since = p.alive ? 0 : now - p.diedWall; // how long they've been dead
      const r = row(p.id, m.name, m.ping, tally, { dead: !p.alive, flash: !p.alive && since < FLASH_MS ? Math.round(since) : null });
      (!p.alive && since >= ZR_RESPAWN_DELAY_MS ? zombies : humans).push(r);
    }
  }
  for (const m of room.members) {
    if (inRound.has(m.id)) continue;
    // between rounds everyone is a human; during one, whoever isn't in it watches
    if (mp) spec.push(row(m.id, m.name, m.ping, m.tally, { dead: false, flash: null }));
    else humans.push(row(m.id, m.name, m.ping, m.tally, { dead: false, flash: null }));
  }
  // CS2 lists each team by score, best first
  const byScore = (a, b) => b.score - a.score || a.name.localeCompare(b.name);
  humans.sort(byScore); zombies.sort(byScore);
  const secs = Math.floor((now - mapSince) / 1000);
  return {
    title: `Casual | ${map || 'lobby'}`, // GFL's ZE servers run CS2's Casual mode: "{gamemode} | {map}"
    time: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
    score: room.score, humans, zombies, spec,
    alive: humans.filter((r) => !r.dead).length, total: humans.length,
  };
}
