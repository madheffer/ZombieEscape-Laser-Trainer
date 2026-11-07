// A body's weapon actions for CS2's player anim graph (world/body.js): the shot and the reload, on top of the
// locomotion / deploy parameters (anim-graph/params.js).
//
// What the graph reads (worldmodel.vnmgraph and the weapon graphs it references):
//   - action = action_attack with attack_type (attack_gun_primaryfire, attack_knife_lightmiss / heavymiss ...) plays
//     the root graph's shoot_<gun> / the knife graph's swing; each further shot pulses action_reset, which the graph
//     turns into its own virtual attack_shoot_reset (action_reset AND attack_is_gun) to restart the shot.
//   - action = action_reload plays the weapon graph's reload_<gun> (its crouch variant by move_crouch_amount);
//     weapon_ammo 0 picks the empty variants where a graph has them.
// WHEN CS2 drops the action back to idle is CCSPlayerAnimationState's (server.dll), not read yet: UNSETTLED.
const ATTACK_HOLD = 0.35; // UNSETTLED: s action_attack is held after the last shot (CS2: the weapon's attack state)

export const GUN_ATTACK = 'attack_gun_primaryfire';

export class BodyActions {
  constructor() {
    this.shots = null; // the last shot count seen (null: none yet, so a body that appears mid-fight doesn't fire)
    this.attack = GUN_ATTACK;
    this.sinceShot = Infinity;
  }

  // s: { shots (a count that goes up by one per shot / swing), attack (the last one's attack_type), reloading,
  //   clip (rounds in the magazine, undefined on the knife), dt }
  // -> parameter overrides for GraphInstance.set, or null when no weapon action is playing
  update(s) {
    const dt = s.dt || 0;
    const shots = Number.isFinite(s.shots) ? s.shots : 0;
    const fired = this.shots !== null && shots > this.shots;
    if (fired) { this.sinceShot = 0; this.attack = s.attack || GUN_ATTACK; }
    else this.sinceShot += dt;
    this.shots = shots;
    // the root graph's Weapons/State/Speed Scale reads it: unset (0) freezes every weapon action on its first frame.
    // 1 is CS2's own reset value (client.dll FUN_1808fc970, the weapon graph controller's constructor);
    // UNSETTLED: whether CS2 changes it later per weapon / action
    const out = { weapon_action_speedscale: 1 };
    if (Number.isFinite(s.clip)) { out.weapon_ammo = s.clip; out.attack_is_final_bullets = s.clip <= 1; }
    if (s.reloading) { out.action = 'action_reload'; out.action_reset = false; return out; }
    if (this.sinceShot < ATTACK_HOLD) {
      out.action = 'action_attack';
      out.attack_type = this.attack;
      out.action_reset = fired; // one frame per shot: the graph restarts the shot from it
      return out;
    }
    out.action_reset = false; // `action` stays params.js's (deploy / idle)
    return out;
  }
}
