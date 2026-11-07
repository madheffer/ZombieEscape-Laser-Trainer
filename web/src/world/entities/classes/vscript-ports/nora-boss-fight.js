// ze_nora_v1_11's scripts/vscripts/lzyorha/_mapscripts/ze_nora/boss_fight.nut, on boss_fight_atks: the warmup boss
// (Map_LVL 1 / 11), 165 s on the round platform to Megalovania. 01B_Start_trigger calls zero_one_b_boss_fight() as
// the first human lands; every attack is a template the script ForceSpawns on a fixed clock (the pushes are
// trigger_push Enable / Disable, the floor drops at 110 s are 01B_Platform_0-3 Open). Every line of the function as
// written, in the file's order (the lines the author commented out are left out, as the game skips them).
import { timeline } from './entfire.js';

const FIGHT = [
  ['01B_1_1_ATK', 'Enable', 5], ['01B_Push_1_Particle', 'Start', 5], ['01B_1_1_ATK', 'Disable', 15], ['01B_Push_1_Particle', 'Stop', 15],
  ['01B_1_2_ATK', 'Enable', 17], ['01B_Push_2_Particle', 'Start', 17], ['01B_1_2_ATK', 'Disable', 27], ['01B_Push_2_Particle', 'Stop', 27],
  ['01B_2_8_Temp', 'ForceSpawn', 27.25], ['01B_2_A_Temp', 'ForceSpawn', 28], ['01B_2_9_Temp', 'ForceSpawn', 28.75], ['01B_2_6_Temp', 'ForceSpawn', 29.5],
  ['01B_2_7_Temp', 'ForceSpawn', 30.25], ['01B_2_5_Temp', 'ForceSpawn', 31], ['01B_2_4_Temp', 'ForceSpawn', 31.75], ['01B_2_3_Temp', 'ForceSpawn', 32.5],
  ['01B_2_1_Temp', 'ForceSpawn', 33.25], ['01B_2_2_Temp', 'ForceSpawn', 34], ['01B_2_4_Temp', 'ForceSpawn', 34.75], ['01B_2_5_Temp', 'ForceSpawn', 35.5],
  ['01B_2_4_Temp', 'ForceSpawn', 36.25], ['01B_2_6_Temp', 'ForceSpawn', 37], ['01B_2_5_Temp', 'ForceSpawn', 37.75], ['01B_3_S_Indi_Temp', 'ForceSpawn', 40],
  ['01B_3_X_Indi_Temp', 'ForceSpawn', 42], ['01B_3_S_Indi_Temp', 'ForceSpawn', 44], ['01B_3_L1_Indi_Temp', 'ForceSpawn', 46], ['01B_3_L2_Indi_Temp', 'ForceSpawn', 49],
  ['01B_3_X_Indi_Temp', 'ForceSpawn', 67], ['01B_3_S_Indi_Temp', 'ForceSpawn', 69], ['01B_3_L2_Indi_Temp', 'ForceSpawn', 71], ['01B_3_L1_Indi_Temp', 'ForceSpawn', 74],
  ['01B_8_1_1_Temp', 'ForceSpawn', 80], ['01B_8_2_1_Temp', 'ForceSpawn', 82], ['01B_8_1_1_Temp', 'ForceSpawn', 84], ['01B_8_2_1_Temp', 'ForceSpawn', 86],
  ['01B_8_1_1_Temp', 'ForceSpawn', 88], ['01B_8_2_1_Temp', 'ForceSpawn', 90], ['01B_4_1_1_Temp', 'ForceSpawn', 92], ['01B_4_2_1_Temp', 'ForceSpawn', 92],
  ['01B_3_L1_Indi_Temp', 'ForceSpawn', 122], ['01B_3_L2_Indi_Temp', 'ForceSpawn', 122], ['01B_4_1_1_Temp', 'ForceSpawn', 54], ['01B_4_2_1_Temp', 'ForceSpawn', 54],
  ['01B_4_1_1_Temp', 'ForceSpawn', 55], ['01B_4_2_1_Temp', 'ForceSpawn', 55], ['01B_4_1_3_Temp', 'ForceSpawn', 56], ['01B_4_2_3_Temp', 'ForceSpawn', 56],
  ['01B_4_1_2_Temp', 'ForceSpawn', 57], ['01B_4_2_2_Temp', 'ForceSpawn', 57], ['01B_4_1_3_Temp', 'ForceSpawn', 58], ['01B_4_2_3_Temp', 'ForceSpawn', 58],
  ['01B_4_1_3_Temp', 'ForceSpawn', 59], ['01B_4_2_3_Temp', 'ForceSpawn', 59], ['01B_4_1_1_Temp', 'ForceSpawn', 60], ['01B_4_2_1_Temp', 'ForceSpawn', 60],
  ['01B_4_1_2_Temp', 'ForceSpawn', 61], ['01B_4_2_2_Temp', 'ForceSpawn', 61], ['01B_4_1_3_Temp', 'ForceSpawn', 62], ['01B_4_2_3_Temp', 'ForceSpawn', 62],
  ['01B_4_1_2_Temp', 'ForceSpawn', 63], ['01B_4_2_2_Temp', 'ForceSpawn', 63], ['01B_4_1_1_Temp', 'ForceSpawn', 64], ['01B_4_2_1_Temp', 'ForceSpawn', 64],
  ['01B_4_1_3_Temp', 'ForceSpawn', 65], ['01B_4_2_3_Temp', 'ForceSpawn', 65], ['01B_5_Temp', 'ForceSpawn', 79], ['01B_5_Temp', 'ForceSpawn', 80.5],
  ['01B_5_Temp', 'ForceSpawn', 82], ['01B_5_Temp', 'ForceSpawn', 83.5], ['01B_5_Temp', 'ForceSpawn', 85], ['01B_5_Temp', 'ForceSpawn', 86.5],
  ['01B_5_Temp', 'ForceSpawn', 88], ['01B_5_Temp', 'ForceSpawn', 89.5], ['01B_5_Temp', 'ForceSpawn', 91], ['01B_5_Temp', 'ForceSpawn', 92.5],
  ['01B_Platform_0', 'Open', 110], ['01B_Platform_1', 'Open', 110], ['01B_Platform_2', 'Open', 110], ['01B_Platform_3', 'Open', 110],
  ['01B_6_Push', 'Enable', 112], ['01B_Push_3_Particle', 'Start', 112], ['01B_6_Push', 'Disable', 122], ['01B_Push_3_Particle', 'Stop', 122],
  ['01B_7_1_Temp', 'ForceSpawn', 127], ['01B_7_2_Temp', 'ForceSpawn', 128.5], ['01B_7_3_Temp', 'ForceSpawn', 130], ['01B_7_4_Temp', 'ForceSpawn', 131.5],
  ['01B_7_5_Temp', 'ForceSpawn', 133], ['01B_7_6_Temp', 'ForceSpawn', 134.5], ['01B_7_2_Temp', 'ForceSpawn', 136], ['01B_7_4_Temp', 'ForceSpawn', 137.5],
  ['01B_7_1_Temp', 'ForceSpawn', 139], ['01B_7_5_Temp', 'ForceSpawn', 140.5], ['01B_7_6_Temp', 'ForceSpawn', 142], ['01B_7_3_Temp', 'ForceSpawn', 143.5],
  ['01B_4_1_3_Temp', 'ForceSpawn', 97], ['01B_8_2_3_Temp', 'ForceSpawn', 98], ['01B_4_2_1_Temp', 'ForceSpawn', 99], ['01B_8_1_1_Temp', 'ForceSpawn', 100],
  ['01B_4_1_1_Temp', 'ForceSpawn', 101], ['01B_8_2_2_Temp', 'ForceSpawn', 102], ['01B_4_2_3_Temp', 'ForceSpawn', 103], ['01B_8_1_2_Temp', 'ForceSpawn', 104],
  ['01B_4_1_2_Temp', 'ForceSpawn', 105], ['01B_8_2_1_Temp', 'ForceSpawn', 106], ['01B_4_2_2_Temp', 'ForceSpawn', 107], ['01B_8_1_3_Temp', 'ForceSpawn', 108],
  ['01B_4_1_1_Temp', 'ForceSpawn', 147], ['01B_8_2_3_Temp', 'ForceSpawn', 148], ['01B_4_2_3_Temp', 'ForceSpawn', 149], ['01B_8_1_2_Temp', 'ForceSpawn', 150],
  ['01B_4_1_2_Temp', 'ForceSpawn', 151], ['01B_8_2_3_Temp', 'ForceSpawn', 152], ['01B_4_2_1_Temp', 'ForceSpawn', 153], ['01B_8_1_3_Temp', 'ForceSpawn', 154],
  ['01B_4_1_3_Temp', 'ForceSpawn', 155], ['01B_8_2_1_Temp', 'ForceSpawn', 156], ['01B_4_2_2_Temp', 'ForceSpawn', 157], ['01B_8_1_2_Temp', 'ForceSpawn', 158],
  ['01B_4_1_1_Temp', 'ForceSpawn', 159], ['01B_8_2_1_Temp', 'ForceSpawn', 160], ['01B_4_2_2_Temp', 'ForceSpawn', 161], ['01B_8_1_3_Temp', 'ForceSpawn', 162],
];

export default {
  fns: {
    zero_one_b_boss_fight(e) { timeline(e, FIGHT); },
  },
};
