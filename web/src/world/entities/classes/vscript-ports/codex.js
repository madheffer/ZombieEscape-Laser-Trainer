// ze_project_codex_v1_2_css's scripts/vscripts/lzyorha/_mapscripts/ze_project_codex/codex.nut, on codex_script: the
// Codex level's escape after the credits boss (lvl_c_end(), which the map calls 20 s after credits_boss_rh_beat() and
// its author tests with "ent_fire codex_script runscriptcode lvl_c_end(); setpos 0 13148 -1444"). Only the ending's
// functions are ported: the spawn-room recovery, credits boss and attack pickers before it are logged as unhandled.
//
//   0-97 s   cfinal_plaser_timer -> p_drop_c(): a pend_laser drops from 1792 at a random yaw (10 degree steps), every
//            4 s, then 2 / 1 / 0.5 / 0.25 s
//   5-69 s   red.nut's r_final_platform_spawn() every 8 s (the spiral up the red tower), its rotating lasers from 8 s
//   90 s     c_y_drop_spawn(): the five y_drop_reverse block sets, shuffled over five heights under the tower; parented
//            to y_tower_drop_linear, they rise 8192 with it from 100 s (512 u/s, killed at 130 s)
//   118 s    c_tower_ct_up_linear opens: the tower top rises 10240 (512 u/s)
//   138 s    c_ending_blaser_start(): horizontal (c_laser_1 / _3) and vertical (c_laser_2) lasers sweep the top
//   153 s    nuke_r: the hurt under the top
import { timeline, rand, spawnAt, randomInt, shuffle } from './entfire.js';

const END = [
  ['c_escape_sound', 'playsound', 0], ['entity_script', 'RunScriptCode', 3, 'count_down_150()'],
  ['key_to_tower_r', 'Enable', 7], ['r_tower_door_linear', 'Kill', 0], ['c_drop_block', 'Disable', 0],
  // plaser_drop
  ['cfinal_plaser_timer', 'Enable', 0], ['cfinal_plaser_timer', 'RefireTime', 10, '2'], ['cfinal_plaser_timer', 'RefireTime', 80, '1'],
  ['cfinal_plaser_timer', 'RefireTime', 90, '0.5'], ['cfinal_plaser_timer', 'RefireTime', 95, '0.25'], ['cfinal_plaser_timer', 'Disable', 97],
  // red laser
  ['rfinal_laser_timer', 'Enable', 8],
  ...[5, 13, 21, 29, 37, 45, 53, 61, 69].map((t) => ['red_script', 'RunScriptCode', t, 'r_final_platform_spawn()']),
  ['rfinal_laser_timer', 'Disable', 80], ['r_final_platform_breakable', 'Kill', 90], ['r_final_watch_teleport', 'Enable', 90],
  // ydrop_reverse
  ['codex_script', 'RunScriptCode', 90, 'c_y_drop_spawn()'], ['c_drop_block', 'Enable', 100],
  ['y_tower_drop_linear', 'Open', 100], ['y_tower_drop_linear', 'Kill', 130],
  // platform go up
  ['c_drop_block', 'Disable', 114.9], ['c_tower_ct_up_linear', 'Open', 118],
  // blaser
  ['codex_script', 'RunScriptCode', 138, 'c_ending_blaser_start()'],
  // stage check
  ['nuke_r', 'Enable', 153],
];

const Y_DROP_ORIGINS = [[0, 13148, -2560], [0, 13148, -3456], [0, 13148, -4352], [0, 13148, -5284], [0, 13148, -6144]];
const Y_DROP_MAKERS = [1, 2, 3, 4, 5].map((i) => `y_drop_reverse_${i}_maker`);

// c_ending_blaser_start(): nine horizontal picks 1 s apart, and two vertical ones every 0.25 s for 8 s
const BLASER = [
  ...Array.from({ length: 9 }, (_, i) => ['codex_script', 'RunScriptCode', i, 'c_blaser_h_spawn()']),
  ...Array.from({ length: 64 }, (_, i) => ['codex_script', 'RunScriptCode', Math.floor(i / 2) * 0.25, 'c_blaser_v_spawn()']),
];

export default {
  fns: {
    lvl_c_end(e) { timeline(e, END); },
    p_drop_c(e) { spawnAt(e, 'pend_laser_maker', [0, 13148, 1792], [0, (rand(e) % 36) * 10, 0]); },
    c_y_drop_spawn(e) {
      const at = shuffle(e, Y_DROP_ORIGINS.slice());
      for (let i = 0; i < 5; i++) spawnAt(e, Y_DROP_MAKERS[i], at[i], [0, 0, 0]);
    },
    c_blaser_h_spawn(e) {
      if (randomInt(e, 0, 9) <= 4) spawnAt(e, 'c_laser_3_maker', randomInt(e, 0, 9) <= 4 ? [0, 10032, 10328] : [0, 10032, 10288], [0, 0, 0]);
      else spawnAt(e, 'c_laser_1_maker', [0, 10032, 10308], randomInt(e, 0, 9) <= 4 ? [0, 0, 0] : [0, 180, 0]);
    },
    c_blaser_v_spawn(e) { spawnAt(e, 'c_laser_2_maker', [randomInt(e, -16, 16) * 32, 10032, 10328], [0, 0, 0]); },
    c_ending_blaser_start(e) { timeline(e, BLASER); },
  },
};
