// The record to beat, for the end card (ui/overlay-parts.js): the stage's leaderboard (its #1, your own best there
// and where this run lands on it; server/api.js /api/leaderboard), fetched as the run starts so the card has it the moment the run ends, with no
// wait. Solo runs rank on the 'solo' board, a room's rounds on the 'coop' one. Offline, or with no runs on the
// stage yet, there is no record: the card leaves its column out.
import { stageBoard } from '../ui/board-data.js';
import { account } from './account.js';
import { formatTime } from '../lib/format.js';

// -> run.board: { top: row | null, me: row | null, rows: the first 100, total: players on it } once the board arrived (null until then, or when it failed)
export function fetchRecordToBeat(run, { map, stage, mode, kind }) {
  run.board = null;
  if (!map || !stage || stage === 'free') return;
  stageBoard(map, stage, { mode, kind, player: account.user?.steamId })
    .then((b) => { run.board = { top: b.rows[0] || null, me: b.me || null, rows: b.rows, total: b.total }; })
    .catch(() => {});
}

// better: an endless run is longer, a clear is faster
export const better = (a, b, endless) => (endless ? a > b : a < b);

// +1.20 s / −0.85 s: this run against another time
const delta = (d) => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(2)} s`;

// The end card's times strip (ui/overlay-parts.js times): this run, your best and the board's #1, with how far off
// each one this run was. time: this run's (a clear's, or how long you lasted); best: your best before this run (or
// null); counts: the run can stand against them (a clear, or any endless run: a death mid-stage has no clear time).
// -> { times, record: beat the board's #1, pb: beat your best }
export function timesStrip({ label, time, best, board, endless, counts }) {
  const top = board?.top || null;
  const record = !!(counts && top && better(time, top.time, endless));
  const pb = !!(counts && (best == null || better(time, best, endless)));
  const vs = (other) => {
    if (!counts || other == null) return {};
    const d = time - other;
    return { note: delta(d), tone: d === 0 ? '' : better(time, other, endless) ? 'good' : 'bad' };
  };
  const times = [{ label, value: formatTime(time), hi: record || (pb && best != null) }];
  if (best != null) times.push({ label: pb ? 'Old best' : 'Your best', value: formatTime(best), ...vs(best) });
  if (top) {
    const v = vs(top.time);
    times.push({ label: record ? 'Old record' : 'Record', value: formatTime(top.time), note: v.note ? `${v.note} · ${top.name}` : `by ${top.name}`, tone: v.tone || 'dim' });
  }
  return { times, record, pb: pb && best != null };
}

// Where this run lands on the board: { rank, of, pct, gap } or null (no board, or a run that can't stand on it).
// The board counts a player once, so your own row is left out and this run takes its place. rank: null when it falls
// past the rows the board sent (the first 100); pct: the share of the other players it beats (null with nobody else
// on it, or past the rows sent); gap: { to, by } the time to the next place up, or to #2 for a run on top.
export function boardPlace(board, time, { endless, counts }) {
  if (!board || !counts) return null;
  const mine = account.user?.steamId;
  const rows = (board.rows || []).filter((r) => !mine || r.steamId !== mine);
  const others = Math.max(rows.length, (board.total || 0) - (board.me ? 1 : 0));
  const ahead = rows.filter((r) => better(r.time, time, endless)).length;
  const level = rows.filter((r) => r.time === time).length;
  const past = ahead === rows.length && rows.length < others; // slower than every row sent, with more beyond them
  const rank = past ? null : ahead + 1;
  const pct = others && !past ? Math.floor(((others - ahead - level) / others) * 100) : null;
  const next = ahead ? rows[ahead - 1] : rows[0] || null; // the place above, or the runner-up under a #1
  const gap = next && !past ? { to: ahead || 2, by: Math.abs(time - next.time) } : null;
  return { rank, of: others + 1, pct, gap, top: rank === 1 };
}

// the card's place block (ui/overlay-parts.js place): '#4 of 37', 'Better than 89% of players', '1.20 s off #3'
export function placeBlock(p) {
  if (!p) return null;
  const value = p.rank ? `#${p.rank}` : '100+';
  const of = `of ${p.of}`;
  const line = p.of === 1 ? 'First on the board' : p.top && p.pct === 100 ? `Ahead of all ${p.of - 1} other players` : p.pct == null ? 'Outside the top 100' : `Better than ${p.pct}% of players`;
  const gap = !p.gap ? '' : p.top ? `${p.gap.by.toFixed(2)} s ahead of #2` : `${p.gap.by.toFixed(2)} s off #${p.gap.to}`;
  return { value, of, line, gap, pct: p.of === 1 ? 100 : p.pct, tone: p.top ? 'gold' : p.pct >= 75 ? 'good' : '' };
}
