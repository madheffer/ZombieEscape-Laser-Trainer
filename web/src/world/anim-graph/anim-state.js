// CS2's CCSPlayerAnimationState (inside CCSPlayer_MovementServices), the server-side state the player anim graph's
// locomotion params come from: body yaw, move type, ground / air action, their direction, the turn angle. Ported
// from server.dll 2026-11-05: Update FUN_180a9d5a0, run once a tick (64 Hz) from FUN_180ac4b20.
//   - velocity FUN_180a98310: the horizontal velocity in the body's frame (the pawn's abs angles = the body yaw);
//     a sharp slow-down (> 50 u/s in a tick) eases out 10 % a tick until it settles (within 10 u/s)
//   - the body yaw never trails the aim by more than 70 deg (snapped to 69); in the air and on ladders it IS the aim
//   - ground actions (+0x19), each a handler: 1 idle FUN_180a7c0f0, 2 start 180a7c3e0, 3 move 180a7c2d0,
//     4 turn on spot 180a7c490, 5 turn on spot loop 180a7c710, 6 plant and turn 180a7c360
//   - moving, the body yaw closes on the aim at (speed / max speed * 80 + 55) deg/s, never more than 45 deg off
//     (FUN_180a7b9f0); plant and turn (FUN_180a7bf10): your keys point against a velocity within 30 deg of an axis
//   - air actions (+0x1b) are one-tick pulses: jump, start fall (the first tick off the ground), land
//   - not called: the foot-IK update at Update's end (FUN_180a7bad0): it needs movement services +0x2c4 > 0, which
//     only the constructor writes (FLT_MAX), so CS2's foot offsets stay 0 (README "The player's body", Foot IK)
// Tick counts, thresholds and tables are the binary's own.
const TICK = 1 / 64; // DAT_181784dec
const MOVING = 10; // DAT_181784e0c: u/s above which you move
const START = 15; // DAT_1817a4450: from idle, this fast plays a start
const STILL = 5; // DAT_1817a4438: aim within this of the body (deg) / a yaw rate under this (deg/s) counts as still
const TURN_LOOP = 30; // DAT_18179be7c: further off (deg) turns in the loop
const YAW_FAST = 45; // DAT_18179be8c: deg/s of aim yaw that turns in the loop
const MAX_OFF = 70; // DAT_1817bc120
const PLANT_COS_DEG = 30; // DAT_1819218ac (0.5236 rad)
// velocity direction -> Direction_t (DAT_18192019c, indexed by round(atan2(left, forward) / 45 deg), -4..4)
const DIR_BY_SECTOR = [5, 4, 3, 2, 1, 8, 7, 6, 5];
// plant and turn: moving along an axis of the body (DAT_1819201a8) with your keys toward its opposite (DAT_1819201d8)
const PLANT_AXES = [[1, 0, 5], [-1, 0, 1], [0, -1, 7], [0, 1, 3]];

export const GROUND = ['', 'ground_action_idle', 'ground_action_start', 'ground_action_move', 'ground_action_turn_on_spot',
  'ground_action_turn_on_spot_loop', 'ground_action_plant_and_turn'];
export const AIR = ['', 'air_action_jump', 'air_action_start_fall', 'air_action_land'];
export const MOVE_TYPE = ['', 'move_type_ground', 'move_type_air', 'move_type_ladder'];
export const DIRS = ['', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const norm = (a) => { a %= 360; if (a > 180) a -= 360; else if (a < -180) a += 360; return a; };
const DEG = Math.PI / 180;
export function dirId(x, y) {
  if (x > -0.01 && x < 0.01 && y > -0.01 && y < 0.01) return 0;
  return DIR_BY_SECTOR[Math.round(Math.atan2(y, x) / (Math.PI / 4)) + 4] || 0;
}

export class AnimState {
  constructor() {
    this.tick = 1000; // the server's tick count (0 is the "unset" timer)
    this.moveType = 1; this.ground = 1; this.dir = 0; this.air = 0;
    this.wasOnGround = true;
    this.actionStart = 0; this.stillSince = 0; this.plantTick = -1000; // +0x20, +0x24, +0x28
    this.turnAngle = 0; this.turnVel = 0; // +0x2c, +0xb8
    this.body = null; this.prevAim = 0; // +0xd8, +0x30
    this.speed = 0; this.prevSpeed = 0; this.vel = [0, 0]; this.velDir = [0, 0]; this.easing = false; // +0xa4, +0x34, +0x74, +0x90, +0xbc
    this.wishId = 0; this.duck = 0; this.maxSpeed = 250;
  }

  // one tick. s: { aim (view yaw, deg), pitch, velocity [x, y, z] (world), onGround, ladder, jump (this tick),
  //   wish [forward, left] (your keys, -1..1) or null, duck (0..1), maxSpeed }
  step(s) {
    this.tick++;
    const aim = norm(s.aim || 0);
    if (this.body == null) this.body = aim;
    this._velocity(s);
    this.pitch = Math.max(-89.9, Math.min(89.9, s.pitch || 0));
    this.aim = aim;
    this.yawRate = Math.abs((aim - this.prevAim) * 64); // not wrapped, as the binary has it
    this._diff();
    if (this.absDiff > MAX_OFF) { this.body = this.diff <= 0 ? aim + MAX_OFF - 1 : aim - MAX_OFF + 1; this._diff(); }
    this.air = 0;
    const onGround = !!s.onGround;
    if ((!onGround && !s.ladder) || s.jump) {
      this.body = aim; this.moveType = 2; this.ground = 1;
      this.air = s.jump ? 1 : this.wasOnGround ? 2 : 0;
    } else if (s.ladder) {
      this.body = aim; this.moveType = 3; this.ground = 1;
    } else {
      if (!this.wasOnGround) this.air = 3;
      this.moveType = 1;
      this._ground();
    }
    this.wasOnGround = onGround;
    this.body = norm(this.body);
    this.prevAim = aim;
  }

  _diff() { this.diff = norm(this.aim - this.body); this.absDiff = Math.abs(this.diff); }

  _velocity(s) {
    this.prevSpeed = this.speed;
    const pvx = this.vel[0], pvy = this.vel[1];
    this.maxSpeed = Math.max(s.maxSpeed || 250, 1);
    this.duck = s.duck || 0;
    const w = s.wish;
    const wl = w ? Math.hypot(w[0], w[1]) : 0;
    this.wish = wl > 0 ? [w[0] / wl, w[1] / wl] : [0, 0];
    this.wishId = dirId(this.wish[0], this.wish[1]);
    // the world velocity in the body's frame (x forward, y left)
    const v = s.velocity || [0, 0, 0], b = this.body * DEG, c = Math.cos(b), sn = Math.sin(b);
    const lx = v[0] * c + v[1] * sn, ly = -v[0] * sn + v[1] * c;
    this.vel = [lx, ly];
    if (lx < -0.01 || lx > 0.01 || ly < -0.01 || ly > 0.01) {
      this.speed = Math.hypot(lx, ly);
      this.velDir = [lx / this.speed, ly / this.speed];
    } else { this.speed = 0; this.velDir = [0, 0]; }
    // a sharp slow-down eases out
    const drop = this.speed - this.prevSpeed;
    if (!this.easing) { if (drop >= -50) return; this.easing = true; }
    if (drop > 0 || Math.abs(drop) < MOVING) { this.easing = false; return; }
    const pl = Math.hypot(pvx, pvy), nl = this.speed;
    const pd = pl > 0 ? [pvx / pl, pvy / pl] : [0, 0], nd = nl > 0 ? [lx / nl, ly / nl] : [0, 0];
    const len = (nl - pl) * 0.1 + pl;
    this.vel = [(nd[0] * 0.1 + pd[0] * 0.9) * len, (nd[1] * 0.1 + pd[1] * 0.9) * len];
    this.speed = Math.hypot(this.vel[0], this.vel[1]);
  }

  // the body closes on the aim while moving (FUN_180a7b9f0)
  _follow() {
    let d = norm(this.body - this.aim);
    d = d >= 0 ? Math.min(45, d) : Math.max(-45, d);
    const step = ((this.speed / this.maxSpeed) * 80 + 55) * TICK;
    d = d >= 0 ? Math.max(0, d - step) : Math.min(0, d + step);
    this.body = this.aim + d;
    this.stationary = false;
  }

  // plant and turn: the direction to plant in, or 0 (FUN_180a7bf10)
  _plant() {
    if (!this.wishId || this.duck === 1) return 0;
    const [vx, vy] = this.velDir;
    for (const [ax, ay, opp] of PLANT_AXES) {
      const near = Math.abs(ax - vx) < 0.01 && Math.abs(ay - vy) < 0.01;
      if (!near && Math.acos(Math.max(-1, Math.min(1, ax * vx + ay * vy))) > PLANT_COS_DEG * DEG) continue;
      if (this.wishId !== opp) continue;
      if (this.ground === 6 && this.dir === opp && this.tick - this.plantTick <= 9) return 0;
      return opp;
    }
    return 0;
  }

  _set(ground, dir = 0) { this.ground = ground; this.dir = dir; }

  _ground() {
    switch (this.ground) {
      case 1: return this._idle();
      case 2: return this._start();
      case 3: return this._move();
      case 4: return this._turnOnSpot();
      case 5: return this._turnLoop();
      case 6: return this._plantAndTurn();
      default: this._set(1); return this._idle();
    }
  }

  // moving on from a ground action: move, or plant and turn
  _moveOn() {
    this._set(3);
    const d = this._plant();
    if (d) return this._enterPlant(d);
    this._follow();
  }

  _idle() {
    if (this.speed > MOVING) {
      if (this.speed >= START) { this._set(2, dirId(this.velDir[0], this.velDir[1])); this.actionStart = this.tick; return this._start(); }
      return this._moveOn();
    }
    if (this.absDiff <= STILL) this.stillSince = 0;
    else {
      if (this.absDiff > TURN_LOOP || this.yawRate >= YAW_FAST) return this._enterLoop();
      if (this.yawRate >= STILL || this.stillSince === 0) this.stillSince = this.tick;
      if (this.tick - this.stillSince > 95) {
        if (this.diff < TURN_LOOP && this.yawRate < YAW_FAST) {
          this._set(4); this.actionStart = this.tick; this.turnAngle = this.diff;
          return this._turnOnSpot();
        }
        return this._enterLoop();
      }
    }
    this.stationary = true;
  }

  _start() {
    if (this.tick - this.actionStart > 6) {
      this._set(3);
      if (this.speed <= MOVING) { this.ground = 1; this.stillSince = 0; return this._idle(); }
      const d = this._plant();
      if (d) return this._enterPlant(d);
    }
    this._follow();
  }

  _move() {
    if (this.speed <= MOVING) { this._set(1); this.stillSince = 0; return this._idle(); }
    const d = this._plant();
    if (d) return this._enterPlant(d);
    this._follow();
  }

  _enterPlant(dir) {
    this.actionStart = this.plantTick = this.tick;
    this.ground = 6; this.dir = dir;
    return this._plantAndTurn();
  }

  _plantAndTurn() {
    const d = this._plant();
    if (d) return this._enterPlant(d);
    if (this.tick - this.actionStart > 12) { this._set(3); return this._move(); }
    this._follow();
  }

  // turn on the spot: the body eases through the turn angle over 47 ticks; back to idle after 85
  _turnOnSpot() {
    if (this.speed > MOVING) return this._moveOn();
    if (this.absDiff > TURN_LOOP || this.yawRate >= YAW_FAST) return this._enterLoop();
    const n = this.tick - this.actionStart;
    if (n > 85) { this._set(1); this.stillSince = 0; return this._idle(); }
    // CS2 writes it in two halves (ease in below t = 0.5, out above); both are this curve. Past t = 1 it falls, and
    // a falling step counts 0, so the turn holds
    const ease = (t) => (1 - Math.cos(Math.PI * t)) * 0.5;
    this.stationary = true;
    this.body += Math.max(0, ease((n + 1) / 47) - ease(n / 47)) * this.turnAngle;
  }

  _enterLoop() { this._set(5); this.actionStart = this.tick; this.turnAngle = this.diff; return this._turnLoop(); }

  // the turn loop: the body turns at 8x the angle left (deg/s), ramped in over 12 ticks, until it's under 16 deg/s
  _turnLoop() {
    if (this.speed > MOVING) return this._moveOn();
    const n = this.tick - this.actionStart;
    let rate = this.absDiff * 0.5 * 16;
    if (n < 12) rate *= (n + 1) / 12;
    let step = Math.min(this.absDiff, TICK * rate);
    if (this.diff < 0) step = -step;
    this.body += step;
    this.turnVel = step / TICK;
    if (Math.abs(this.turnVel) < 16) { this._set(1); this.stillSince = 0; return; }
    this.stationary = true;
  }
}
