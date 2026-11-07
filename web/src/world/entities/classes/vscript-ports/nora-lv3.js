// ze_nora_v1_11's scripts/vscripts/lzyorha/_mapscripts/ze_nora/lv3_controller.nut, on lv3_script: level 3's ending,
// the run up the rising path to the tree. 3_2_trigger calls three_two() as the first human lands. Every platform
// of the path is a template on a fixed clock (3_2_rise_* every 0.75 s, then 3_2_rise_end_* every 0.5 s after the
// first path is killed at 38 s); the tree goes at 61 s. Map_LVL 4 (level 3) adds the C / J laser picks and the wall
// lasers and opens the win check at 120 s; Map_LVL 12 (the RTV pick, "ending only") fires them faster and ends in
// 3_2_troll_nuke instead. Map_LVL's health is read when the script loads (mp_lvl), as the file does: func_brush is
// one of the entities CS:GO keeps across rounds, which is how the map remembers its level.
import { timeline } from './entfire.js';

const PATH = [
  ['01B_4_1_1_ATK_M', 'Kill', 0], ['3_2_fall_1', 'ForceSpawn', 5], ['3_2_1', 'ForceSpawn', 10], ['3_2_rise_1', 'ForceSpawn', 10],
  ['3_2_rise_2', 'ForceSpawn', 10.75], ['3_2_rise_3', 'ForceSpawn', 11.5], ['3_2_rise_4', 'ForceSpawn', 12.25], ['3_2_rise_8', 'ForceSpawn', 13],
  ['3_2_rise_7', 'ForceSpawn', 13.75], ['3_2_rise_6', 'ForceSpawn', 14.5], ['3_2_rise_5', 'ForceSpawn', 15.25], ['3_2_rise_9', 'ForceSpawn', 16],
  ['3_2_rise_10', 'ForceSpawn', 16.75], ['3_2_rise_11', 'ForceSpawn', 17.5], ['3_2_rise_12', 'ForceSpawn', 18.25], ['3_2_rise_16', 'ForceSpawn', 19],
  ['3_2_rise_15', 'ForceSpawn', 19.75], ['3_2_rise_14', 'ForceSpawn', 20.5], ['3_2_rise_13', 'ForceSpawn', 21.25], ['3_2_rise_17', 'ForceSpawn', 22],
  ['3_2_rise_18', 'ForceSpawn', 22.75], ['3_2_rise_19', 'ForceSpawn', 23.5], ['3_2_rise_20', 'ForceSpawn', 24.25], ['3_2_rise_24', 'ForceSpawn', 25],
  ['3_2_rise_23', 'ForceSpawn', 25.75], ['3_2_rise_22', 'ForceSpawn', 26.5], ['3_2_rise_21', 'ForceSpawn', 27.25], ['3_2_rise_25', 'ForceSpawn', 28],
  ['3_2_rise_26', 'ForceSpawn', 28.75], ['3_2_rise_27', 'ForceSpawn', 29.5], ['3_2_rise_28', 'ForceSpawn', 30.25], ['3_2_rise_32', 'ForceSpawn', 31],
  ['3_2_rise_31', 'ForceSpawn', 31.75], ['3_2_rise_30', 'ForceSpawn', 32.5], ['3_2_rise_29', 'ForceSpawn', 33.25], ['3_2_fall_2', 'ForceSpawn', 34],
  ['3_2_rise_pt', 'kill', 38], ['3_2_1_tracktrain', 'kill', 38], ['3_2_1_2', 'kill', 38], ['3_2_fall_tp_1', 'Enable', 40],
  ['3_2_rise_end_1', 'ForceSpawn', 40], ['3_2_rise_end_2', 'ForceSpawn', 40.5], ['3_2_rise_end_3', 'ForceSpawn', 41], ['3_2_rise_end_4', 'ForceSpawn', 41.5],
  ['3_2_rise_end_8', 'ForceSpawn', 42], ['3_2_rise_end_7', 'ForceSpawn', 42.5], ['3_2_rise_end_6', 'ForceSpawn', 43], ['3_2_rise_end_5', 'ForceSpawn', 43.5],
  ['3_2_rise_end_9', 'ForceSpawn', 44], ['3_2_rise_end_10', 'ForceSpawn', 44.5], ['3_2_rise_end_11', 'ForceSpawn', 45], ['3_2_rise_end_12', 'ForceSpawn', 45.5],
  ['3_2_rise_end_16', 'ForceSpawn', 46], ['3_2_rise_end_15', 'ForceSpawn', 46.5], ['3_2_rise_end_14', 'ForceSpawn', 47], ['3_2_rise_end_13', 'ForceSpawn', 47.5],
  ['3_2_rise_end_17', 'ForceSpawn', 48], ['3_2_rise_end_18', 'ForceSpawn', 48.5], ['3_2_rise_end_19', 'ForceSpawn', 49], ['3_2_rise_end_20', 'ForceSpawn', 49.5],
  ['3_2_rise_end_24', 'ForceSpawn', 50], ['3_2_rise_end_23', 'ForceSpawn', 50.5], ['3_2_rise_end_22', 'ForceSpawn', 51], ['3_2_rise_end_21', 'ForceSpawn', 51.5],
  ['3_2_rise_end_25', 'ForceSpawn', 52], ['3_2_rise_end_26', 'ForceSpawn', 52.5], ['3_2_rise_end_27', 'ForceSpawn', 53], ['3_2_rise_end_28', 'ForceSpawn', 53.5],
  ['3_2_rise_end_32', 'ForceSpawn', 54], ['3_2_rise_end_31', 'ForceSpawn', 54.5], ['3_2_rise_end_30', 'ForceSpawn', 55], ['3_2_rise_end_29', 'ForceSpawn', 55.5],
  ['3_2_rise_end_33', 'ForceSpawn', 56], ['3_2_rise_end_34', 'ForceSpawn', 56.5], ['3_2_rise_end_35', 'ForceSpawn', 57], ['3_2_rise_end_36', 'ForceSpawn', 57.5],
  ['3_2_rise_end_40', 'ForceSpawn', 58], ['3_2_rise_end_39', 'ForceSpawn', 58.5], ['3_2_rise_end_38', 'ForceSpawn', 59], ['3_2_rise_end_37', 'ForceSpawn', 59.5],
  ['3_2_rise_end_41', 'ForceSpawn', 60], ['3_2_Tree', 'Kill', 61], ['Tree_explo', 'Start', 61], ['3_2_rise_end_42', 'ForceSpawn', 60.5],
  ['3_2_rise_end_43', 'ForceSpawn', 61], ['3_2_rise_end_44', 'ForceSpawn', 61.5], ['3_2_rise_end_48', 'ForceSpawn', 62], ['3_2_rise_end_47', 'ForceSpawn', 62.5],
  ['3_2_rise_end_46', 'ForceSpawn', 63], ['3_2_rise_end_45', 'ForceSpawn', 63.5], ['3_2_rise_end_49', 'ForceSpawn', 64], ['3_2_rise_end_50', 'ForceSpawn', 64.5],
  ['3_2_rise_end_51', 'ForceSpawn', 65], ['3_2_rise_end_52', 'ForceSpawn', 65.5], ['3_2_rise_end_56', 'ForceSpawn', 66], ['3_2_rise_end_55', 'ForceSpawn', 66.5],
  ['3_2_rise_end_54', 'ForceSpawn', 67], ['3_2_rise_end_53', 'ForceSpawn', 67.5], ['3_2_rise_end_57', 'ForceSpawn', 68], ['3_2_rise_end_58', 'ForceSpawn', 68.5],
  ['3_2_rise_end_59', 'ForceSpawn', 69], ['3_2_rise_end_60', 'ForceSpawn', 69.5], ['3_2_rise_end_64', 'ForceSpawn', 70], ['3_2_rise_end_63', 'ForceSpawn', 70.5],
  ['3_2_rise_end_62', 'ForceSpawn', 71], ['3_2_rise_end_61', 'ForceSpawn', 71.5], ['3_2_rise_end_65', 'ForceSpawn', 72], ['3_2_rise_end_66', 'ForceSpawn', 72.5],
  ['3_2_rise_end_67', 'ForceSpawn', 73], ['3_2_rise_end_68', 'ForceSpawn', 73.5], ['3_2_rise_end_72', 'ForceSpawn', 74], ['3_2_rise_end_71', 'ForceSpawn', 74.5],
  ['3_2_rise_end_70', 'ForceSpawn', 75], ['3_2_rise_end_69', 'ForceSpawn', 75.5], ['3_2_rise_end_73', 'ForceSpawn', 76], ['3_2_rise_end_74', 'ForceSpawn', 76.5],
  ['3_2_rise_end_75', 'ForceSpawn', 77], ['3_2_rise_end_76', 'ForceSpawn', 77.5], ['3_2_rise_end_80', 'ForceSpawn', 78], ['3_2_rise_end_79', 'ForceSpawn', 78.5],
  ['3_2_rise_end_78', 'ForceSpawn', 79], ['3_2_rise_end_77', 'ForceSpawn', 79.5], ['3_2_rise_end_81', 'ForceSpawn', 80], ['3_2_rise_end_82', 'ForceSpawn', 80.5],
  ['3_2_rise_end_83', 'ForceSpawn', 81], ['3_2_rise_end_84', 'ForceSpawn', 81.5], ['3_2_rise_end_88', 'ForceSpawn', 82], ['3_2_rise_end_87', 'ForceSpawn', 82.5],
  ['3_2_rise_end_86', 'ForceSpawn', 83], ['3_2_rise_end_85', 'ForceSpawn', 83.5], ['3_2_rise_end_89', 'ForceSpawn', 84], ['3_2_rise_end_90', 'ForceSpawn', 84.5],
  ['3_2_rise_end_91', 'ForceSpawn', 85], ['3_2_rise_end_92', 'ForceSpawn', 85.5], ['3_2_rise_end_96', 'ForceSpawn', 86], ['3_2_rise_end_95', 'ForceSpawn', 86.5],
  ['3_2_rise_end_94', 'ForceSpawn', 87], ['3_2_rise_end_93', 'ForceSpawn', 87.5], ['3_2_rise_end_97', 'ForceSpawn', 88], ['3_2_rise_end_98', 'ForceSpawn', 88.5],
  ['3_2_rise_end_99', 'ForceSpawn', 89], ['3_2_rise_end_100', 'ForceSpawn', 89.5], ['3_2_fall_3', 'ForceSpawn', 90], ['3_2_rise_pt', 'kill', 110],
  ['3_2_fall_tp_2', 'Enable', 120], ['lv_3_nuke', 'Enable', 130], ['sp_nuke_temp', 'ForceSpawn', 130],
];

// if (mp_lvl == 4)
const LEVEL3 = [
  ['3_2_final_move_laser', 'ForceSpawn', 45], ['3_2_CJ_laser_picker', 'PickRandom', 45], ['3_2_CJ_laser_picker1', 'PickRandom', 50], ['3_2_CJ_laser_picker1', 'PickRandom', 55],
  ['3_2_CJ_laser_picker2', 'PickRandom', 60], ['3_2_CJ_laser_picker2', 'PickRandom', 63], ['3_2_CJ_laser_picker2', 'PickRandom', 66], ['3_2_CJ_laser_picker2', 'PickRandom', 69],
  ['3_2_CJ_laser_picker3', 'PickRandom', 72], ['3_2_CJ_laser_picker3', 'PickRandom', 75], ['3_2_CJ_laser_picker3', 'PickRandom', 78], ['3_2_CJ_laser_picker3', 'PickRandom', 81],
  ['3_2_CJ_laser_picker', 'PickRandom', 84], ['3_2_CJ_laser_picker', 'PickRandom', 87], ['3_2_CJ_laser_picker', 'PickRandom', 90], ['3_2_CJ_laser_picker1', 'PickRandom', 93],
  ['3_2_CJ_laser_picker1', 'PickRandom', 96], ['3_2_CJ_laser_picker1', 'PickRandom', 97.5], ['3_2_CJ_laser_picker1', 'PickRandom', 99], ['3_2_CJ_laser_picker1', 'PickRandom', 100.5],
  ['3_2_CJ_laser_picker2', 'PickRandom', 102], ['3_2_CJ_laser_picker2', 'PickRandom', 103.5], ['3_2_CJ_laser_picker2', 'PickRandom', 105], ['3_2_CJ_laser_picker2', 'PickRandom', 106.5],
  ['3_2_CJ_laser_picker2', 'PickRandom', 108], ['3_2_Wall_laser_picker', 'PickRandom', 60], ['3_2_Wall_laser_picker', 'PickRandom', 66], ['3_2_Wall_laser_picker', 'PickRandom', 72],
  ['3_2_Wall_laser_picker', 'PickRandom', 78], ['3_2_Wall_laser_picker', 'PickRandom', 84], ['3_2_Wall_laser_picker', 'PickRandom', 90], ['3_2_Wall_laser_picker', 'PickRandom', 96],
  ['3_2_Wall_laser_picker', 'PickRandom', 102], ['3_2_Wall_laser_picker', 'PickRandom', 105], ['3_2_Wall_laser_picker', 'PickRandom', 108], ['3_2_Wall_laser_picker', 'PickRandom', 111],
  ['3_2_Wall_laser_picker', 'PickRandom', 114], ['lv_3_human_win_check', 'Enable', 120],
];

// else if (mp_lvl == 12)
const RTV = [
  ['3_2_final_move_laser', 'ForceSpawn', 45], ['3_2_CJ_laser_picker', 'PickRandom', 45], ['3_2_CJ_laser_picker1', 'PickRandom', 50], ['3_2_CJ_laser_picker1', 'PickRandom', 55],
  ['3_2_CJ_laser_picker2', 'PickRandom', 60], ['3_2_CJ_laser_picker2', 'PickRandom', 62], ['3_2_CJ_laser_picker2', 'PickRandom', 64], ['3_2_CJ_laser_picker2', 'PickRandom', 66],
  ['3_2_CJ_laser_picker2', 'PickRandom', 68], ['3_2_CJ_laser_picker3', 'PickRandom', 70], ['3_2_CJ_laser_picker3', 'PickRandom', 72], ['3_2_CJ_laser_picker3', 'PickRandom', 74],
  ['3_2_CJ_laser_picker3', 'PickRandom', 76], ['3_2_CJ_laser_picker3', 'PickRandom', 78], ['3_2_CJ_laser_picker', 'PickRandom', 80], ['3_2_CJ_laser_picker', 'PickRandom', 82],
  ['3_2_CJ_laser_picker', 'PickRandom', 84], ['3_2_CJ_laser_picker', 'PickRandom', 86], ['3_2_CJ_laser_picker', 'PickRandom', 88], ['3_2_CJ_laser_picker1', 'PickRandom', 90],
  ['3_2_CJ_laser_picker1', 'PickRandom', 92], ['3_2_CJ_laser_picker1', 'PickRandom', 94], ['3_2_CJ_laser_picker1', 'PickRandom', 96], ['3_2_CJ_laser_picker1', 'PickRandom', 97],
  ['3_2_CJ_laser_picker1', 'PickRandom', 98], ['3_2_CJ_laser_picker1', 'PickRandom', 99], ['3_2_CJ_laser_picker2', 'PickRandom', 100], ['3_2_CJ_laser_picker2', 'PickRandom', 101],
  ['3_2_CJ_laser_picker2', 'PickRandom', 102], ['3_2_CJ_laser_picker2', 'PickRandom', 103], ['3_2_CJ_laser_picker2', 'PickRandom', 104], ['3_2_CJ_laser_picker2', 'PickRandom', 105],
  ['3_2_CJ_laser_picker2', 'PickRandom', 106], ['3_2_CJ_laser_picker2', 'PickRandom', 107], ['3_2_CJ_laser_picker2', 'PickRandom', 108], ['3_2_Wall_laser_picker', 'PickRandom', 60],
  ['3_2_Wall_laser_picker', 'PickRandom', 64], ['3_2_Wall_laser_picker', 'PickRandom', 68], ['3_2_Wall_laser_picker', 'PickRandom', 72], ['3_2_Wall_laser_picker', 'PickRandom', 76],
  ['3_2_Wall_laser_picker', 'PickRandom', 80], ['3_2_Wall_laser_picker', 'PickRandom', 84], ['3_2_Wall_laser_picker', 'PickRandom', 88], ['3_2_Wall_laser_picker', 'PickRandom', 92],
  ['3_2_Wall_laser_picker', 'PickRandom', 96], ['3_2_Wall_laser_picker', 'PickRandom', 100], ['3_2_Wall_laser_picker', 'PickRandom', 102], ['3_2_Wall_laser_picker', 'PickRandom', 104],
  ['3_2_Wall_laser_picker', 'PickRandom', 106], ['3_2_Wall_laser_picker', 'PickRandom', 108], ['3_2_Wall_laser_picker', 'PickRandom', 110], ['3_2_Wall_laser_picker', 'PickRandom', 112],
  ['3_2_Wall_laser_picker', 'PickRandom', 114], ['3_2_Wall_laser_picker', 'PickRandom', 116], ['3_Troll_tele', 'Disable', 120], ['3_2_troll_nuke', 'Enable', 130],
];

export default {
  init(s, e) {
    const lvl = e.engine.findOne('Map_LVL');
    s.mp_lvl = Number(lvl?.kv.health) || 0;
  },
  fns: {
    three_two(e) {
      timeline(e, PATH);
      const lvl = e.state.vs.mp_lvl;
      if (lvl === 4) timeline(e, LEVEL3);
      else if (lvl === 12) timeline(e, RTV);
    },
  },
};
