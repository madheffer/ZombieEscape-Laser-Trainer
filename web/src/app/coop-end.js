// The end card of a multiplayer round (the server's verdict, server/coop-round.js end): did the stage get cleared,
// how this round's time stands against your best and the co-op board's record, the room's awards (most lasers /
// balls dodged, who lasted longest, who went down first, fewest hits) and a table of everyone, best run first. One
// mode: together on the same stage, and against each other. The room owner's card has "Play again" (the server
// starts the next round for everyone); everyone has "Back to room" (the room screen, where the owner picks the next
// stage). Every number is the server's: its copies of the runs counted the hits and dodges (coop-check.js).
import { S, G } from './state.js';
import { formatTime, plural } from '../lib/format.js';
import { reportRun } from './console/run-report.js';
import { timesStrip, boardPlace, placeBlock } from './record-to-beat.js';

const MAX_NAMES = 2; // an award shared by more: "A & B +2"

export function showRoundEnd(round, d) {
  const me = round.me;
  const won = d.winners.includes(me);
  const top = d.best.includes(me);
  const watching = !!round.watcher; // a spectator's card: the round's verdict and table, nothing of theirs
  const solo = round.players.size === 1 && !watching;
  const endless = round.mode === 'endless';
  const names = (ids) => ids.map((id) => (id === me ? 'You' : round.name(id))).join(' & ');
  const hitsOf = (id) => d.stats.find((s) => s.id === id)?.hits ?? 0;
  const aliveFor = (s) => (s.alive ? d.at : s.at ?? d.at);
  const scenario = S.scenario;
  // the console's report (a death already had one): your part of the round
  const mine = d.stats.find((s) => s.id === me);
  if (S.run && S.map && !watching) reportRun(S.run, { result: d.result === 'win' && won ? 'win' : d.result === 'over' ? 'over' : 'lose', scenario, map: S.map.name, time: mine?.at ?? d.at });
  let kind, title, subtitle;
  if (d.result === 'win') {
    kind = 'win';
    const survivors = d.winners;
    // you survived and had the best run: the round is yours; survived: cleared; down while others cleared it: theirs
    title = solo ? 'STAGE CLEARED' : top && won ? 'VICTORY' : won ? 'STAGE CLEARED' : 'TEAM CLEARED';
    subtitle = solo ? 'Cleared'
      : survivors.length === 1 ? `${names(survivors)} cleared it, the last one alive`
        : `${names(survivors)} cleared it · best run: ${names(d.best)} (${plural(hitsOf(d.best[0]), 'hit')})`;
  } else if (d.result === 'over') {
    kind = 'endless';
    title = solo ? 'RUN OVER' : top ? 'LASTED LONGEST' : 'RUN OVER';
    subtitle = solo ? 'Survived to the end' : `${names(d.best)} lasted the longest`;
  } else if (d.reason === 'wiped') {
    kind = 'dead';
    title = solo ? 'YOU DIED' : top ? 'LASTED LONGEST' : 'EVERYONE DOWN';
    subtitle = solo ? 'Nobody survived' : `Nobody cleared it · ${names(d.best)} lasted the longest`;
  } else {
    kind = 'dead';
    title = 'STAGE FAILED';
    subtitle = d.best.length ? `The stage was lost · best run: ${names(d.best)}` : 'The stage was lost';
  }

  // the round's time against your best and the co-op board's #1 (both the round's time: server/activity.js round)
  const counts = endless || (d.result === 'win' && won);
  const board = S.run?.board;
  const strip = timesStrip({
    label: endless ? 'Round lasted' : counts ? 'Clear time' : 'You survived', time: counts ? d.at : aliveFor(mine || { alive: true }),
    best: board?.me?.time ?? null, board, endless, counts,
  });
  const badges = strip.record ? [{ text: 'New co-op record', tone: 'gold' }] : strip.pb ? [{ text: 'New personal best', tone: 'good' }] : [];

  // best run first, then who survived, then who lasted longer; the anti-cheat's removals last
  const order = [...d.stats].sort((a, b) => (a.cheat - b.cheat) || (d.best.includes(b.id) - d.best.includes(a.id)) || (b.alive - a.alive)
    || (aliveFor(b) - aliveFor(a)) || (a.hits - b.hits));
  const fair = order.filter((s) => !s.cheat);
  const label = (s) => (s.id === me ? `${round.name(s.id)} (you)` : round.name(s.id));

  const card = {
    kind,
    kicker: `${scenario?.name || 'Free roam'} · online${endless ? ' · endless' : ''}${watching ? ' · spectating' : ''}`,
    title, subtitle, badges: watching ? [] : badges, times: watching ? [] : strip.times, place: watching ? null : placeBlock(boardPlace(board, d.at, { endless, counts })),
    note: round.isHost ? '' : 'Waiting for the room owner to start the next round',
    buttons: buttons(round),
  };
  if (solo || (!mine && !watching)) {
    card.stats = mine ? [['Hits taken', String(mine.hits)], ['Lasers dodged', String(mine.dl)], ['Balls dodged', String(mine.db)]] : [];
  } else {
    card.awards = awards(fair, { me, endless, aliveFor, names });
    card.table = playerTable(order, fair, { me, d, aliveFor, label });
  }
  G.overlay.show(card);
  G.menu.update();
}

// back to the room screen (ui/room.js), where the owner picks the next stage; Play again restarts this one
function buttons(round) {
  const room = { label: 'Back to room', key: 'Escape', primary: !round.isHost, onClick: () => { G.overlay.hide(); G.room?.comeBack(); G.menu.update(); } };
  return round.isHost
    ? [{ label: 'Play again', key: 'Enter', primary: true, onClick: () => G.hostStart(S.scenarioIndex, round.mode) }, room]
    : [room];
}

// who holds a number: the players with the highest (or lowest) value, or [] when nobody stands out
function leaders(list, value, { low = false, min = -Infinity } = {}) {
  if (list.length < 2) return [];
  const vals = list.map(value);
  const best = low ? Math.min(...vals) : Math.max(...vals);
  if (!(best > min) || vals.every((v) => v === best)) return [];
  return list.filter((s, i) => vals[i] === best);
}

const who = (ids, names) => (ids.length > MAX_NAMES ? `${names(ids.slice(0, MAX_NAMES))} +${ids.length - MAX_NAMES}` : names(ids));

function awards(fair, { endless, aliveFor, names }) {
  const out = [];
  const add = (label, ss, value, tone) => { if (ss.length) out.push({ label, who: who(ss.map((s) => s.id), names), value: value(ss[0]), tone }); };
  add('Most lasers', leaders(fair, (s) => s.dl, { min: 0 }), (s) => plural(s.dl, 'laser'), 'gold');
  add('Most balls', leaders(fair, (s) => s.db, { min: 0 }), (s) => plural(s.db, 'ball'), 'gold');
  if (fair.some((s) => !s.alive)) {
    add('Lived longest', leaders(fair, aliveFor), (s) => (s.alive && !endless ? 'Survived' : formatTime(aliveFor(s))), 'good');
    const dead = fair.filter((s) => !s.alive);
    const first = Math.min(...dead.map((s) => s.at ?? Infinity));
    add('First down', dead.filter((s) => s.at === first), (s) => `at ${formatTime(s.at)}`, 'bad');
  }
  add('Fewest hits', leaders(fair, (s) => s.hits, { low: true }), (s) => plural(s.hits, 'hit'), 'good');
  return out;
}

// one row a player: place, name (MVP tag), status, time alive, hits, lasers / balls dodged; each column's leader gold
function playerTable(order, fair, { me, d, aliveFor, label }) {
  const lead = {
    alive: new Set(leaders(fair, aliveFor).map((s) => s.id)),
    hits: new Set(leaders(fair, (s) => s.hits, { low: true }).map((s) => s.id)),
    dl: new Set(leaders(fair, (s) => s.dl, { min: 0 }).map((s) => s.id)),
    db: new Set(leaders(fair, (s) => s.db, { min: 0 }).map((s) => s.id)),
  };
  let place = 0;
  return {
    cols: [{ label: '#' }, { label: 'Player' }, { label: 'Status' }, { label: 'Alive', num: true }, { label: 'Hits', num: true }, { label: 'Lasers', num: true }, { label: 'Balls', num: true }],
    rows: order.map((s) => ({
      you: s.id === me, dead: !s.alive,
      cells: [
        { text: s.cheat ? '–' : String(++place) },
        { text: label(s), tag: d.best.includes(s.id) ? 'MVP' : '' },
        s.cheat ? { text: 'Removed', tone: 'dim' } : s.alive ? { text: d.result === 'win' ? 'Cleared' : 'Alive', tone: 'good' } : { text: 'Down', tone: 'bad' },
        { text: formatTime(aliveFor(s)), lead: lead.alive.has(s.id) },
        { text: String(s.hits), lead: lead.hits.has(s.id) },
        { text: String(s.dl), lead: lead.dl.has(s.id) },
        { text: String(s.db), lead: lead.db.has(s.id) },
      ],
    })),
  };
}
