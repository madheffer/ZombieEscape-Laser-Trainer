// ze_project_codex_v1_2_css's scripts/vscripts/lzyorha/_mapscripts/ze_project_codex/red.nut, on red_script: the red
// tower's ending, which the Codex escape (codex.nut lvl_c_end()) reuses. Only the tower functions are ported; the red
// level's earlier parts are logged as unhandled.
//
//   r_final_platform_spawn()  the next of nine ed_p_r steps up the tower (190 units up, 45 degrees round, each time)
//   r_laser_spawn()           a rotating red laser rising from the floor (r_final_laser_1 or _2, even odds)
import { timeline, spawnAt, randomInt } from './entfire.js';

const STEPS = [-1240, -1050, -860, -670, -480, -290, -100, 90, 280].map((z) => [0, 13148, z]);
const STEP_YAWS = [0, 45, 90, 135, 180, 225, 270, 315, 0];

const END = [
  ['c_drop_block', 'Disable', 0], ['rfinal_laser_timer', 'Enable', 3],
  ...[0, 8, 16, 24, 32, 40, 48, 56, 64].map((t) => ['red_script', 'RunScriptCode', t, 'r_final_platform_spawn()']),
  ['r_final_platform_breakable', 'Kill', 80], ['r_final_watch_teleport', 'Enable', 80], ['rfinal_laser_timer', 'Disable', 70],
  ['r_tower_ct_up_linear', 'Open', 85], ['stage_fail_check_r', 'Enable', 80], ['stage_complete_check_r', 'Enable', 95],
  ['nuke_r', 'Enable', 100],
];

export default {
  init(s) { s.maker_index = 0; },
  fns: {
    lvl_r_end(e) { timeline(e, END); },
    r_laser_spawn(e) { timeline(e, [[randomInt(e, 0, 9) <= 4 ? 'r_final_laser_1_temp' : 'r_final_laser_2_temp', 'ForceSpawn', 0]]); },
    r_final_platform_spawn(e) {
      const s = e.state.vs;
      if (s.maker_index < 9) {
        spawnAt(e, 'r_final_platform_maker', STEPS[s.maker_index], [0, STEP_YAWS[s.maker_index], 0]);
        s.maker_index += 1;
      }
    },
  },
};
