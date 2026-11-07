// What the HUD's run panel (ui/hud-run.js) shows for the run in play: solo / co-op, the map's title, the stage's level
// and name, the clock and your best for this stage. Called every frame from loop.js updateHud.
import { S } from './state.js';
import { getRecord } from './records.js';
import { mapTitle } from '../ui/board.js';
import { formatTime } from '../lib/format.js';

// a group that says nothing about where in the map you are (the level is in the stage's own name then)
const GENERIC = /^(main stages|stages)$/i;

// the stage's level: its `group`, or its parent's for a boss's single attack
function levelOf(s) {
  const p = s.parent ? S.scenarios.find((x) => x.id === s.parent) : null;
  const g = String(s.group || p?.group || '').trim();
  return GENERIC.test(g) ? '' : g;
}

function party() {
  if (S.replay) return { label: 'REPLAY', cls: 'replay' };
  const mp = S.mp;
  if (!mp) return { label: 'SOLO', cls: 'solo' };
  const n = mp.players.size, a = mp.alive.length;
  return { label: n > 1 ? `CO-OP ${a}/${n}` : 'CO-OP', cls: 'coop' };
}

// t: the stage clock (negative before the start); sub: the small status line (hits, gravity, ...)
export function runPanelData(t, sub) {
  const { run, scenario, map } = S;
  const info = S.mapIndex.find((m) => m.name === map?.name);
  const best = scenario && !S.replay ? getRecord(map.name, scenario.id, run.endless ? 'endless' : 'normal') : null;
  return {
    party: party(),
    map: map ? mapTitle(info, map.name) : '',
    level: scenario ? levelOf(scenario) : '',
    name: scenario ? scenario.name : 'Free roam',
    tag: run.endless ? 'ENDLESS' : '',
    timer: scenario ? (t < 0 ? `starts in ${(-t).toFixed(1)}` : formatTime(t)) : '',
    waiting: !!scenario && t < 0,
    t: run.started ? t : 0,
    best: best?.time ?? null,
    endless: !!run.endless,
    sub,
  };
}
