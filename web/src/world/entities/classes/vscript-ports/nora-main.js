// ze_nora_v1_11's scripts/vscripts/lzyorha/_mapscripts/ze_nora/main.nut, on sp_logic_script: the level switch
// (Map_LVL's health is the level: 1 warmup, 2-4 levels 1-3, 11 / 12 the RTV picks), the teleports that put each team
// in place, and level 3's breaking floors. Every function of the file, its numbers as written. Team 3 is CT (you).
import { timeline, rand, setOrigin } from './entfire.js';

const BREAK_SIDES = [
  ['3_1_1_to_2_tp', 'kill', 0], ['3_1_1_1', 'break', 2], ['3_1_1_2', 'break', 4], ['3_1_1_to_2_elevator', 'kill', 6],
  ['3_1_2_0', 'break', 8], ['3_1_2_1', 'break', 10], ['3_1_2_2', 'break', 12], ['3_1_2_tp', 'kill', 12],
  ['3_1_2_movelinear', 'kill', 14], ['3_1_2_3', 'break', 16], ['3_1_2_4', 'break', 18], ['3_1_2_5', 'break', 20],
  ['3_1_3_0', 'break', 22], ['3_1_2_to_3_tp', 'kill', 22], ['3_1_2_to_3_move', 'kill', 24], ['3_1_4_0', 'break', 26],
  ['3_1_4_1', 'break', 28], ['3_1_4_2', 'break', 28.5], ['3_1_4_3', 'break', 29], ['3_1_4_4', 'break', 29.5],
  ['3_1_4_5', 'break', 30], ['3_1_mid_6', 'break', 30], ['3_1_4_6', 'break', 30.5], ['3_1_4_7', 'break', 31],
  ['3_1_4_8', 'break', 31.5], ['3_1_4_9', 'break', 32],
];

const BREAK_MIDDLE = [
  ['3_1_1_0', 'break', 0], ['3_1_four_side_tp', 'Enable', 0], ['3_1_push_5', 'Enable', 8], ['3_1_mid_5', 'Break', 10],
  ['3_1_push_4', 'Enable', 18], ['3_1_mid_4', 'Break', 20], ['3_1_push_3', 'Enable', 28], ['3_1_mid_3', 'Break', 30],
  ['3_1_push_2', 'Enable', 38], ['3_1_mid_2', 'Break', 40], ['3_1_push_1', 'Enable', 48], ['3_1_push_1', 'Disable', 50],
  ['3_1_to_2_human_tp', 'Enable', 50], ['3_1_to_2_tp', 'Enable', 55],
];

const lvlEnt = (e) => e.engine.findOne('Map_LVL');
// mv_lvl_handle.SetHealth(n): the func_brush keeps it as its health keyvalue (read back by the scripts that load next)
const setLvl = (e, n) => { const l = lvlEnt(e); if (l) l.kv.health = String(n); };
const ct = (act) => act?.team == null || act.team === 3;

// spawn_tp(): where each level puts a team when it leaves the spawn room (the T spots picked by rand() % n)
const SPAWNS = {
  1: { ct: [-1023, 1024, 921], t: [[-1923, 1024, 921], [-123, 1024, 921], [-1023, 1924, 921], [-1023, 124, 921]] },
  12: { ct: [-2253, -11386, 1201], t: [[-906, -10984, 1201], [-3605, -10985, 1201]] },
  2: { ct: [-1215, 348, -3033], t: [[-1215, 348, -3033]] },
  3: { ct: [-3059, 504, 544], t: [[-3954, 137, 544], [-2164, 137, 544]] },
  4: { ct: [264, 520, -1034], t: [[-1784, 1800, -1034], [2312, 1800, -1034]] },
};
SPAWNS[11] = SPAWNS[1];

export default {
  init(s, e) { s.mp_lvl = Number(lvlEnt(e)?.kv.health) || 0; },
  fns: {
    spawn_tp(e, _, act) {
      const sp = SPAWNS[e.state.vs.mp_lvl];
      if (!sp) return;
      if (ct(act)) setOrigin(e, act, sp.ct);
      else setOrigin(e, act, sp.t[rand(e) % sp.t.length]);
    },
    zero_one_b_end_tp(e, _, act) { setOrigin(e, act, ct(act) ? [-1023, 926, 2010] : [-1023, 1150, 2010]); },
    warmup_lvl_switch(e) {
      const to = { 1: 2, 11: 12, 12: 11 }[e.state.vs.mp_lvl];
      if (to) setLvl(e, to);
    },
    // three separate ifs on the value read at load, as written (2 -> 3, 3 -> 4, 4 -> 11)
    lvl_switch(e) {
      const to = { 2: 3, 3: 4, 4: 11 }[e.state.vs.mp_lvl];
      if (to) setLvl(e, to);
    },
    lvl_one_ct_tp_to_end(e, _, act) { if (ct(act)) setOrigin(e, act, [-3516, 564, -1216]); },
    lvl_twp_boss_tp_ct(e, _, act) { if (ct(act)) setOrigin(e, act, [-2313, 521, 2774]); },
    lvl_three_break_sides(e) { timeline(e, BREAK_SIDES); },
    lvl_three_break_midle(e) { timeline(e, BREAK_MIDDLE); },
    lvl_wu_set(e) { setLvl(e, 11); },
    lvl_one_set(e) { setLvl(e, 2); },
    lvl_two_set(e) { setLvl(e, 3); },
    lvl_thr_set(e) { setLvl(e, 4); },
    lvl_rtv_set(e) { setLvl(e, 12); },
  },
};
