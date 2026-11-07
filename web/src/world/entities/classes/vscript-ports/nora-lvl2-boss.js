// ze_nora_v1_11's scripts/vscripts/lzyorha/_mapscripts/ze_nora/lvl2_boss_control.nut, on 20B_Boss_Script: level 2's
// boss, which backs down the arena in three stages, and the laser ending after it. Every function of the file, its
// numbers as written.
//
// HP: each stage's 20B_Boss_Hp_<n> (a func_breakable the humans shoot) gets 1000 + 1200 per human: the stage's
// 20B_Boss_Hp_<n>_Controller calls hp_<n>_cal() on every human's OnStartTouch (a per-human add: the engine repeats
// it per simulated human, `adds` below) and set_hp_<n>() a second after the stage starts. A human leaving the zone
// (OnEndTouch: a death, a fall) calls hp_<n>_dec(): 1200 off, or the break once 1300 or less is left.
// Attacks: 20B_Boss_Picker_<n> (logic_case) PickRandom -> one of push / diamond / walls / flame / c_atk; each
// function fires its stage's templates and picks again 6-10 s later (sooner in later stages).
// Ending: 20B_laser_picker picks two_laser_*() every 2.5 s: one of three east and one of three west lasers.
import { fire, rand } from './entfire.js';

const STAGES = ['one', 'two', 'thr'];
const WALLS = (n) => ['w', 'e'].map((side) => Array.from({ length: 7 }, (_, i) => `20B_Walls_${side}_${n}_${i + 1}`));
const WALL_MAKERS = { one: WALLS(1), two: WALLS(2), thr: WALLS(3) };
// the picker's next PickRandom after each attack, per stage (as written: push 10/9/8, diamond 8/7/6, walls 10/9/8,
// flame 10/9/8, c_atk 10/9/8)
const NEXT = { push: [10, 9, 8], diamond: [8, 7, 6], walls: [10, 9, 8], flame: [10, 9, 8], c_atk: [10, 9, 8] };

const say = (e, text) => fire(e, 'server_command_main', 'Command', `say ${text}`);
const randomFromList = (e, list) => list[rand(e) % list.length];
const repick = (e, i, attack) => fire(e, `20B_Boss_Picker_${i + 1}`, 'PickRandom', '', NEXT[attack][i]);

function hpDec(e, n) {
  const h = e.engine.findOne(`20B_Boss_Hp_${n}`);
  if (!h) return; // Entities.FindByName found nothing: the .nut would throw here and do nothing
  const current = h.state.health ?? 0;
  // hp_handle.SetHealth(): CBaseEntity::SetHealth sets m_iHealth straight away, no OnHealthChanged
  if (current > 1300) h.state.health = current - 1200;
  else fire(e, `20B_Boss_Hp_${n}`, 'Break');
}

const fns = {};
STAGES.forEach((st, i) => {
  const n = i + 1;
  fns[`set_hp_${st}`] = (e) => fire(e, `20B_Boss_Hp_${n}`, 'SetHealth', e.state.vs.hp[i]);
  fns[`hp_${st}_cal`] = (e) => { e.state.vs.hp[i] += 1200; };
  fns[`hp_${st}_dec`] = (e) => hpDec(e, n);

  fns[`two_push_${st}`] = (e) => {
    const push = `20B_Push_trigger_push${i ? i : ''}`;
    say(e, 'Pull');
    fire(e, push, 'Enable', '', 0);
    fire(e, push, 'Disable', '', 5);
    repick(e, i, 'push');
  };
  fns[`two_diamond_${st}`] = (e) => {
    say(e, 'Diamond');
    fire(e, `20B_Diamond_${n}_1_${rand(e) % 2 === 0 ? 1 : 2}`, 'ForceSpawn');
    fire(e, `20B_Diamond_${n}_2_${rand(e) % 2 === 0 ? 1 : 2}`, 'ForceSpawn');
    repick(e, i, 'diamond');
  };
  fns[`two_walls_${st}`] = (e) => {
    const [w, east] = WALL_MAKERS[st];
    say(e, 'Wall');
    for (let k = 0; k < 3; k++) {
      fire(e, randomFromList(e, w), 'ForceSpawn', '', 1);
      fire(e, randomFromList(e, east), 'ForceSpawn', '', 1);
    }
    repick(e, i, 'walls');
  };
  fns[`two_flame_${st}`] = (e) => {
    say(e, 'Flame');
    fire(e, `20B_Flame_Indi_${n}`, 'ForceSpawn');
    fire(e, `20B_Flame_${n}`, 'ForceSpawn', '', 3);
    repick(e, i, 'flame');
  };
  fns[`two_c_atk_${st}`] = (e) => {
    say(e, 'Push');
    fire(e, `20B_C_ATK_pt1_${n}`, 'ForceSpawn');
    fire(e, `20B_C_ATK_pt2_${n}`, 'ForceSpawn');
    repick(e, i, 'c_atk');
  };
});

// two_laser_one .. two_laser_nin: east (k / 3) + west (k % 3), then the next pick 2.5 s later
['one', 'two', 'thr', 'fou', 'fiv', 'six', 'sev', 'eig', 'nin'].forEach((name, k) => {
  fns[`two_laser_${name}`] = (e) => {
    fire(e, `20B_end_laser_east_${Math.floor(k / 3) + 1}`, 'ForceSpawn');
    fire(e, `20B_end_laser_west_${(k % 3) + 1}`, 'ForceSpawn');
    fire(e, '20B_laser_picker', 'PickRandom', '', 2.5);
  };
});

export default {
  init(s) { s.hp = [1000, 1000, 1000]; }, // HP_One, HP_Two, HP_Thr
  adds: ['hp_one_cal', 'hp_two_cal', 'hp_thr_cal'],
  fns,
};
