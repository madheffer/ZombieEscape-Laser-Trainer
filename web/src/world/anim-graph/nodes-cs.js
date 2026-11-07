// CS2's own nodes in the player graph (not in Esoterica): Aim IK (CNmAimCSNode, aim-cs.js), Foot IK, Snap Weapon.
// Foot IK and Snap Weapon pass their child's pose through until they're read from CS2.
import { PoseNode } from './nodes-base.js';
import { DEFAULT_TRACK } from './sync-track.js';
import { AimSolver } from './aim-cs.js';

class CsPassthrough extends PoseNode {
  get child() { return this.n(this.d.m_nChildNodeIdx); }
  onInit(ctx, t) { super.onInit(ctx, t); this.child.init(ctx, t); if (this.child.valid()) this.takeTime(this.child); }
  onShutdown(ctx) { this.child.shutdown(ctx); }
  valid() { return this.child.valid(); }
  syncTrack() { return this.child.valid() ? this.child.syncTrack() : DEFAULT_TRACK; }
  update(ctx, range) { const r = this.child.update(ctx, range); this.takeTime(this.child); return r; }
}

class AimCS extends CsPassthrough {
  update(ctx, range) {
    const r = super.update(ctx, range);
    if (!r.pose) return r;
    this.solver ||= new AimSolver(this.g.skel);
    const v = (i) => (i >= 0 ? this.n(i).value(ctx) : undefined);
    const out = ctx.pose().copy(r.pose);
    this.solver.apply(out, {
      pitch: v(this.d.m_nVerticalAngleNodeIdx) ?? 0,
      yaw: v(this.d.m_nHorizontalAngleNodeIdx) ?? 0,
      crouch: v(this.d.m_nCrouchWeightNodeIdx) ?? 0,
      category: v(this.d.m_nWeaponCategoryNodeIdx) ?? '',
      type: v(this.d.m_nWeaponTypeNodeIdx) ?? '',
    });
    return { pose: out, events: r.events };
  }
}

// FootIKNode: a pass-through in CS2 too. Its ik_left_foot / ik_right_foot targets are only set while the anim state's
// foot offsets are over 0.1, and those stay 0: the offset update (client FUN_18088baf0) needs movement-services
// +0x2bc > 0 (server_20261105: FUN_180a7bad0, +0x2c4), which only the constructor writes (FLT_MAX, read as 0).
// README "The player's body".
export const CS_NODES = { AimCSNode: AimCS, FootIKNode: CsPassthrough, SnapWeaponNode: CsPassthrough };
