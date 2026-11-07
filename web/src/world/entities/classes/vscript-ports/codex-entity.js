// ze_project_codex_v1_2_css's scripts/vscripts/lzyorha/_mapscripts/ze_project_codex/entity.nut, on entity_script: the
// countdown texts every level shows (count_down_150() ... count_down_5(), game_text_2 / game_text_1) and the teleport
// into a level's tower (key_to_tower()). Only these are ported; the level teleports and entity cleanups are logged
// as unhandled.
import { timeline, setOrigin, fire } from './entfire.js';

const text = (ent, msg, t) => [[ent, 'AddOutput', t, `message ${msg}`], [ent, 'Display', t + 0.01]];
const step = (msgs, next, nextAt) => (e) => timeline(e, [
  ...msgs.flatMap(([m, t]) => text('game_text_2', m, t)),
  ...(next ? [['entity_script', 'RunScriptCode', nextAt, `${next}()`]] : []),
]);

// main.nut's lvl: 0 b, 1 p, 2 y, 3 r, 4 c (Codex), 5 rtv. Every stage we ship is in the red tower (lvl 3 / 4 / 5).
const TOWER = { 3: [0, 13148, -1444], 4: [0, 13148, -1444], 5: [0, 13148, -1444] };

export default {
  init(s) { s.lvl = 4; },
  fns: {
    count_down_150: step([['1...5...0', 0], ['1...4...0', 10], ['1...3...0', 20]], 'count_down_120', 30),
    count_down_120: step([['1...2...0', 0], ['1...1...0', 10], ['1...0...0', 20]], 'count_down_90', 30),
    count_down_90: step([['0...9...0', 0], ['0...8...0', 10], ['0...7...0', 20]], 'count_down_60', 30),
    count_down_60: step([['0...6...0', 0], ['0...5...0', 10], ['0...4...0', 20]], 'count_down_30', 30),
    count_down_30: step([['0...3...0', 0], ['0...2...0', 10], ['0...1...5', 15]], 'count_down_10', 20),
    count_down_10: step([['0...1...0', 0]], 'count_down_5', 5),
    count_down_5(e) { timeline(e, [1, 2, 3, 4, 5].flatMap((n) => text('game_text_1', `...${6 - n}...`, n - 1))); },
    key_to_tower(e, _, act) {
      const at = TOWER[e.state.vs.lvl];
      if (!at) return;
      fire(e, '!activator', 'AddOutput', 'absvelocity 0 0 0', 0, act);
      setOrigin(e, act, at);
    },
  },
};
