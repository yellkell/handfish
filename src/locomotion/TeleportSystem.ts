/**
 * TeleportSystem — what's left of FIRE FIGHT 2's club movement now the island is travelled by the
 * map alone (locomotion/TravelMap.ts: point at where you want to be, and you're there). There's
 * no arc and no stepping; this keeps the moves underneath:
 *
 *  - `teleportPlayer` / `teleportView.travel`: put your head over a spot, on its floor, facing
 *    where it says (the map's spots, the field guide's chart, the helter skelter's stairs).
 *  - An isolated sideways flick of a thumbstick is a snap turn (ff2's 35°), for anyone playing
 *    seated. (Forward on the stick is the map's now.)
 *  - A headset RECENTRE (the reference space's `reset` event) is honoured: the rig folds the new
 *    origin in so you stay exactly where you stood (the recentre redefines your NEUTRAL, not your
 *    spot).
 *
 * `locomotion.enabled` still says whether you may go anywhere (closed mid-fight, landing a fish,
 * the backpack open, up the helter skelter): the map asks it before it sends you.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Quaternion, Vector3 } from 'three';
import type { XROrigin } from '@iwsdk/xr-input';
import { TELEPORT } from './config.ts';
import * as sfx from '../audio/sfx.ts';
import type { Surfaces } from '../world/surfaces.ts';
import { introActive } from '../experience/introGate.ts';

const _dir = new Vector3();
const _quat = new Quaternion();
const _head = new Vector3();

/**
 * Move the rig so the player's head lands over (x, z) at floor height `y`,
 * facing `yaw` (three.js convention: yaw 0 looks down −z).
 */
export function teleportPlayer(player: XROrigin, x: number, z: number, yaw: number, y = 0): void {
  player.head.getWorldPosition(_head);
  player.head.getWorldQuaternion(_quat);
  _dir.set(0, 0, -1).applyQuaternion(_quat);
  const headYaw = Math.atan2(-_dir.x, -_dir.z);

  const dYaw = yaw - headYaw;
  player.rotation.y += dYaw;
  player.position.y = y;

  // Rotate the head's offset from the rig origin by the turn we just made,
  // then position the rig so the head ends up exactly on target.
  const offX = _head.x - player.position.x;
  const offZ = _head.z - player.position.z;
  const cos = Math.cos(dYaw);
  const sin = Math.sin(dYaw);
  player.position.x = x - (offX * cos + offZ * sin);
  player.position.z = z - (-offX * sin + offZ * cos);
}

/**
 * Snap-turn the rig by `deltaYaw` radians about the player's HEAD, so your
 * physical spot stays put and the world spins around you (rotating about
 * the rig origin would swing your head through an arc).
 */
export function snapTurn(player: XROrigin, deltaYaw: number): void {
  player.head.getWorldPosition(_head);
  const hx = _head.x;
  const hz = _head.z;
  player.rotation.y += deltaYaw;
  const offX = hx - player.position.x;
  const offZ = hz - player.position.z;
  const cos = Math.cos(deltaYaw);
  const sin = Math.sin(deltaYaw);
  player.position.x = hx - (offX * cos + offZ * sin);
  player.position.z = hz - (-offX * sin + offZ * cos);
}

/** The island's walkable model; set once the world has loaded. `onTeleport` hears every move
 *  the system makes (head positions before and after), e.g. to blink through a doorway. */
export const locomotion: {
  surfaces: Surfaces | null;
  enabled: boolean;
  onTeleport: ((from: Vector3, to: Vector3) => void)[];
} = {
  surfaces: null,
  enabled: true,
  onTeleport: [],
};

/** Tell the listeners the head moved from `from` to wherever it is now. */
function moved(player: XROrigin, from: Vector3): void {
  if (!locomotion.onTeleport.length) return;
  const to = player.head.getWorldPosition(new Vector3());
  for (const fn of locomotion.onTeleport) fn(from, to);
}

/** The moves, for the map and the chart to call, and the dev harness (`__fish.move`). */
export const teleportView: {
  snapTurn?: (dir: -1 | 1) => void;
  to?: (x: number, z: number, yaw: number) => void;
  /** go straight to (x, z) facing `yaw`, onto the floor there nearest `nearY` (the chart) */
  travel?: (x: number, z: number, yaw: number, nearY: number) => void;
} = {};

export class TeleportSystem extends createSystem({}) {
  /** Snap turn fires once per flick: armed again after the stick recentres. */
  private snapArmed = true;
  /** The reference space we're watching for `reset` (headset recentre). */
  private refSpace: XRReferenceSpace | null = null;
  /** A recentre happened; fold it in on the next tick (see onRecenter). */
  private recentered = false;
  private recenterPose = { x: 0, z: 0, yaw: 0, y: 0 };

  /**
   * A headset recentre fires `reset` BETWEEN frames, before any pose uses
   * the moved origin — so the head still holds where the player stands in
   * the world RIGHT NOW. Bank that pose; the next update re-plants on it.
   */
  private onRecenter = (): void => {
    this.player.head.getWorldPosition(_head);
    this.player.head.getWorldQuaternion(_quat);
    _dir.set(0, 0, -1).applyQuaternion(_quat);
    this.recenterPose.x = _head.x;
    this.recenterPose.z = _head.z;
    this.recenterPose.yaw = Math.atan2(-_dir.x, -_dir.z);
    this.recenterPose.y = this.player.position.y;
    this.recentered = true;
  };

  init(): void {
    teleportView.snapTurn = (dir) => snapTurn(this.player, dir > 0 ? -TELEPORT.snapAngle : TELEPORT.snapAngle);
    teleportView.to = (x, z, yaw) => {
      const s = locomotion.surfaces;
      teleportPlayer(this.player, x, z, yaw, s ? s.floorYAt(x, z, this.player.position.y) : 0);
    };
    teleportView.travel = (x, z, yaw, nearY) => {
      const s = locomotion.surfaces;
      const from = this.player.head.getWorldPosition(new Vector3());
      teleportPlayer(this.player, x, z, yaw, s ? s.floorYAt(x, z, nearY) : 0);
      moved(this.player, from);
    };
  }

  update(): void {
    this.watchRecenter();

    // A recentre moved the reference-space origin under our feet: re-plant
    // the rig on the banked pose so you stay exactly where you stood.
    if (this.recentered) {
      this.recentered = false;
      const p = this.recenterPose;
      teleportPlayer(this.player, p.x, p.z, p.yaw, p.y);
    }

    if (!locomotion.enabled || introActive()) return;
    this.trySnap();
  }

  /**
   * A left/right flick yaws the rig by snapAngle. One turn per flick — the stick has to spring
   * back below snapReset to re-arm — so holding it doesn't spin you, and a push that's more
   * forward than sideways (the map's) never turns you.
   */
  private trySnap(): void {
    let sx = 0;
    let sy = 0;
    let mag = 0;
    for (const hand of ['left', 'right'] as const) {
      const a = this.input.xr.gamepads[hand]?.getAxesValues(InputComponent.Thumbstick);
      if (!a) continue;
      const m = Math.hypot(a.x, a.y);
      if (m > mag) {
        mag = m;
        sx = a.x;
        sy = a.y;
      }
    }
    if (mag < TELEPORT.snapReset) {
      this.snapArmed = true;
      return;
    }
    if (!this.snapArmed) return;
    // (stick right yaws you right: a NEGATIVE rotation about +y)
    if (Math.abs(sx) >= TELEPORT.snapEngage && Math.abs(sx) > Math.abs(sy)) {
      this.snapArmed = false;
      snapTurn(this.player, sx > 0 ? -TELEPORT.snapAngle : TELEPORT.snapAngle);
      sfx.uiClick();
    } else if (Math.abs(sy) >= TELEPORT.snapEngage) this.snapArmed = false;
  }

  /**
   * Keep a `reset` listener on the session's live reference space (it only
   * exists once a session is up, and each new session mints a new one).
   */
  private watchRecenter(): void {
    const space = this.renderer.xr.getReferenceSpace();
    if (space === this.refSpace) return;
    this.refSpace?.removeEventListener('reset', this.onRecenter);
    this.refSpace = space;
    space?.addEventListener('reset', this.onRecenter);
  }
}
