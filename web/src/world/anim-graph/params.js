// What the player's state means to CS2's anim graph: the control parameters CCS2PawnGraphController::ReflectPawnState
// feeds it (server.dll 2026-11-05 FUN_180ae0aa0 and its parts FUN_180ae02f0 aim, FUN_180ae0760 move type / ground
// action, FUN_180ab6190 locomotion), read from CCSPlayerAnimationState (anim-state.js), run here at CS2's 64 ticks a
// second whatever the frame rate:
//   - move_direction_id: the velocity's direction in the body's frame; ground_action_direction_id: the start's /
//     plant's direction (none while moving)
//   - move_speed_x / _y: the (eased) velocity in the body's frame; move_speed_horizontal(_previous): its length
//   - ground_turn_angle_or_velocity: the turn angle on the spot, the turn rate (deg/s) in the loop, else 0
//   - aim_angle_yaw: the aim against the body yaw (the pawn's angles ARE the body yaw); aim_angle_pitch: the pitch
// The weapon's deploy time is UNSETTLED (CS2 plays the weapon's own deploy state).
import { AnimState, GROUND, AIR, MOVE_TYPE, DIRS, dirId } from './anim-state.js';

const TICK = 1 / 64;
const DEPLOY_TIME = 0.5; // UNSETTLED: how long action_deploy is held after a weapon swap (CS2: the weapon's deploy state)

// a weapon's graph identity: CS2's weapon_category_* / weapon_type (the vdata name)
const CATEGORY = [
  [/^weapon_knife|^weapon_bayonet/, 'weapon_category_knife'],
  [/^weapon_(usp_silencer|hkp2000|glock|p250|fiveseven|tec9|cz75a|deagle|revolver|elite)$/, 'weapon_category_pistol'],
  [/^weapon_(m249|negev)$/, 'weapon_category_machinegun'],
  [/^weapon_(nova|xm1014|sawedoff|mag7)$/, 'weapon_category_shotgun'],
  [/^weapon_(mp7|mp9|mp5sd|mac10|p90|bizon|ump45)$/, 'weapon_category_smg'],
  [/^weapon_(awp|ssg08|g3sg1|scar20)$/, 'weapon_category_sniper'],
];
export function weaponParams(name) {
  const type = name || 'weapon_knife';
  const cat = CATEGORY.find(([re]) => re.test(type))?.[1] || 'weapon_category_rifle';
  return { weapon_type: type, weapon_category: cat };
}

const norm = (a) => { a %= 360; if (a > 180) a -= 360; else if (a < -180) a += 360; return a; };

export class PawnParams {
  constructor() {
    this.state = new AnimState();
    this.acc = 0; // s toward the next tick
    this.wasOnGround = true;
    this.air = 0;
    this.weapon = null;
    this.deploy = Infinity; // s since the last weapon swap
  }

  // the body's yaw (deg): where the model faces (CS2 turns the pawn by it)
  get bodyYaw() { return this.state.body; }

  // s: { velocity [x, y, z], yaw (the view's), pitch (deg), duck (0..1), onGround, ladder, walking,
  //   wish [forward, side] (keys -1..1, side + = right; null = not known), maxSpeed, weapon (vdata name), dt }
  // -> { name: value } for GraphInstance.set
  update(s) {
    const st = this.state, v = s.velocity || [0, 0, 0];
    const onGround = s.onGround !== false;
    // leaving the ground going up is a jump (CS2 flags it from the jump itself)
    let jump = this.wasOnGround && !onGround && (v[2] || 0) > 0;
    this.wasOnGround = onGround;
    const wish = s.wish ? [s.wish[0] || 0, -(s.wish[1] || 0)] : null; // CS2's: forward, left
    // this frame's ticks; an air action is a one-tick pulse, held for the frame it happened in
    this.acc += s.dt || 0;
    let ticked = false;
    for (let n = 0; this.acc >= TICK && n < 8; n++) {
      this.acc -= TICK;
      st.step({ aim: s.yaw, pitch: s.pitch, velocity: v, onGround, ladder: !!s.ladder, jump, wish, duck: s.duck, maxSpeed: s.maxSpeed });
      if (!ticked) this.air = 0;
      ticked = true;
      jump = false;
      if (st.air) this.air = st.air;
    }
    if (this.acc > TICK) this.acc = 0; // a long stall doesn't replay
    if (st.body == null) st.step({ aim: s.yaw, pitch: s.pitch, velocity: [0, 0, 0], onGround });

    // a weapon swap plays the new weapon's deploy (the graph's Weapons layer picks the weapon graph by weapon_type)
    const weapon = s.weapon || 'weapon_knife';
    if (this.weapon !== null && weapon !== this.weapon) this.deploy = 0;
    this.weapon = weapon;
    this.deploy += s.dt || 0;
    const action = s.action || (this.deploy < DEPLOY_TIME ? 'action_deploy' : 'action_idle');

    const g = st.ground;
    return {
      move_type: MOVE_TYPE[st.moveType],
      move_direction_id: DIRS[dirId(st.velDir[0], st.velDir[1])],
      ground_action: GROUND[g],
      ground_action_direction_id: DIRS[st.dir] || '',
      ground_turn_angle_or_velocity: g === 4 ? st.turnAngle : g === 5 ? st.turnVel : 0,
      move_speed_horizontal_previous: st.prevSpeed,
      move_speed_horizontal: st.speed,
      move_speed_x: st.vel[0],
      move_speed_y: st.vel[1],
      move_crouch_amount: s.duck || 0,
      move_is_walking: !!s.walking,
      air_action: AIR[this.air],
      air_height_above_ground: onGround ? 0 : Math.max(0, s.heightAboveGround ?? 64),
      aim_angle_pitch: st.pitch ?? (s.pitch || 0),
      aim_angle_yaw: norm((st.aim ?? s.yaw ?? 0) - st.body),
      action,
      ...weaponParams(weapon),
    };
  }
}
