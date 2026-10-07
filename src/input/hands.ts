/**
 * Bare hands: the tracked hand's joints, in the world, and what they add up to.
 *
 * WebXR only answers a joint's pose inside the frame's callback, so these are for systems'
 * `update` (they run in it). Everything's read in the reference space and carried into the world
 * by the player's rig (the hands' parent).
 *
 *  - `joint`: one joint's position.
 *  - `palm`: the hand as a whole: the palm's centre, which way the fingers run (wrist to middle
 *    knuckle), the knuckle line (little finger to index: toward the thumb), which way the palm
 *    faces, and how open the hand is (0 a fist, 1 flat). Worked once a frame per hand.
 *  - `rodHold`: where a rod held in this fist sits and points (the fishing rod's grip): across the
 *    palm from the heel of the hand to between thumb and index, the way a rod lies in a real grip.
 *  - `pinch`: how far apart the thumb and index tips are.
 */

import { Matrix4, Quaternion, Vector3, type Object3D, type WebGLRenderer } from 'three';

export type Hand = 'left' | 'right';

/** what the helpers need from a system: its renderer, its input, its rig */
export interface HandCtx {
  renderer: WebGLRenderer;
  input: { xr: { getPrimaryInputSource(h: Hand): XRInputSource | undefined } };
  player: Object3D;
}

export interface PalmFrame {
  /** the wrist, and the palm's middle */
  wrist: Vector3;
  centre: Vector3;
  /** wrist → middle knuckle (unit) */
  fingers: Vector3;
  /** little-finger knuckle → index knuckle (unit): toward the thumb */
  across: Vector3;
  /** out of the palm (unit) */
  facing: Vector3;
  /** 0 a fist .. 1 a flat hand */
  open: number;
}

/** The hand's input source, if that hand's a tracked hand (not a controller). */
export function trackedHand(ctx: HandCtx, h: Hand): XRInputSource | null {
  const src = ctx.input.xr.getPrimaryInputSource(h);
  return src?.hand ? src : null;
}

/** A tracked hand's joint, in the world (null: no hand, or not tracked this frame). */
export function joint(ctx: HandCtx, h: Hand, name: XRHandJoint, out: Vector3): Vector3 | null {
  const src = trackedHand(ctx, h);
  const frame = ctx.renderer.xr.getFrame();
  const ref = ctx.renderer.xr.getReferenceSpace();
  const space = src?.hand?.get(name);
  if (!frame || !ref || !space || !frame.getJointPose) return null;
  const pose = frame.getJointPose(space, ref);
  if (!pose) return null;
  const p = pose.transform.position;
  ctx.player.updateMatrixWorld();
  return out.set(p.x, p.y, p.z).applyMatrix4(ctx.player.matrixWorld);
}

/** How far apart the thumb and index tips are (m), or null. */
export function pinch(ctx: HandCtx, h: Hand): number | null {
  const t = joint(ctx, h, 'thumb-tip', _a);
  const i = t ? joint(ctx, h, 'index-finger-tip', _b) : null;
  return t && i ? t.distanceTo(i) : null;
}

const _a = new Vector3();
const _b = new Vector3();
const _k = { w: new Vector3(), i: new Vector3(), m: new Vector3(), r: new Vector3(), l: new Vector3(), ti: new Vector3(), tm: new Vector3(), tr: new Vector3() };
const cache = new Map<Hand, { frame: XRFrame; palm: PalmFrame | null }>();

/** The palm's frame for a tracked hand this frame (worked once a frame per hand), or null. */
export function palm(ctx: HandCtx, h: Hand): PalmFrame | null {
  const frame = ctx.renderer.xr.getFrame();
  if (!frame) return null;
  const hit = cache.get(h);
  if (hit && hit.frame === frame) return hit.palm;
  const k = _k;
  const ok =
    joint(ctx, h, 'wrist', k.w) &&
    joint(ctx, h, 'index-finger-phalanx-proximal', k.i) &&
    joint(ctx, h, 'middle-finger-phalanx-proximal', k.m) &&
    joint(ctx, h, 'ring-finger-phalanx-proximal', k.r) &&
    joint(ctx, h, 'pinky-finger-phalanx-proximal', k.l) &&
    joint(ctx, h, 'index-finger-tip', k.ti) &&
    joint(ctx, h, 'middle-finger-tip', k.tm) &&
    joint(ctx, h, 'ring-finger-tip', k.tr);
  let out: PalmFrame | null = null;
  if (ok) {
    const fingers = k.m.clone().sub(k.w).normalize();
    const across = k.i.clone().sub(k.l);
    across.addScaledVector(fingers, -across.dot(fingers)).normalize();
    // out of the palm: the right hand's knuckle line crossed with its fingers, the left's the other way
    const facing = h === 'right' ? across.clone().cross(fingers) : fingers.clone().cross(across);
    // open: the fingertips' reach from the wrist against the knuckles' (≈1 in a fist, ≈1.9 flat)
    const reach = (k.ti.distanceTo(k.w) + k.tm.distanceTo(k.w) + k.tr.distanceTo(k.w)) / (k.i.distanceTo(k.w) + k.m.distanceTo(k.w) + k.r.distanceTo(k.w));
    const open = Math.max(0, Math.min(1, (reach - 1.25) / 0.5));
    const centre = k.w.clone().lerp(k.m, 0.55);
    out = { wrist: k.w.clone(), centre, fingers, across, facing, open };
  }
  cache.set(h, { frame, palm: out });
  return out;
}

/** how far round from the knuckle line toward the fingers a rod lies in the fist (rad): 30° off the
 *  fingers, so a neutral fist holds it up at about the angle a controller does (rod.ts ROD_TILT) */
const ROD_DIAGONAL = (60 * Math.PI) / 180;
/** how far in front of the palm the rod's middle lies, inside the closed fingers (m) */
const ROD_IN_FIST = 0.03;

const _f = new Vector3();
const _u = new Vector3();
const _x = new Vector3();
const _r = new Vector3();
const _t = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();

/**
 * Where a rod held in this fist sits and which way it runs: it lies diagonally across the palm,
 * from the heel of the hand up between thumb and index (round from the knuckle line toward the
 * fingers by ROD_DIAGONAL), just inside the closed fingers. `pos` gets the grip's middle, `dir` the
 * blank (toward the tip), `top` the side of the rod the thumb's on. False if the hand's not tracked.
 */
export function rodHold(ctx: HandCtx, h: Hand, pos: Vector3, dir: Vector3, top: Vector3): boolean {
  const p = palm(ctx, h);
  if (!p) return false;
  dir.copy(p.across).multiplyScalar(Math.cos(ROD_DIAGONAL)).addScaledVector(p.fingers, Math.sin(ROD_DIAGONAL)).normalize();
  // the thumb's side of the blank: the knuckle line, square to the blank
  top.copy(p.across).addScaledVector(dir, -p.across.dot(dir)).normalize();
  pos.copy(p.centre).addScaledVector(p.facing, ROD_IN_FIST);
  return true;
}

/**
 * The rod's hand frame from `rodHold`, as the controller's ray would give it: its −Z pitched down
 * from the blank by `tilt` (the rod's own upward tilt off the ray, fishing/rod.ts ROD_TILT), so the
 * rod, tilting up off it, lies along the blank. Into `grip` (position) and `ray` (orientation).
 */
export function rodFrame(ctx: HandCtx, h: Hand, tilt: number, grip: Object3D, ray: Object3D): boolean {
  if (!rodHold(ctx, h, _r, _f, _t)) return false;
  // forward = blank·cos − top·sin; up = blank·sin + top·cos (so cos·forward + sin·up is the blank)
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  _x.copy(_f).multiplyScalar(c).addScaledVector(_t, -s); // the ray's −Z
  _u.copy(_f).multiplyScalar(s).addScaledVector(_t, c); // the ray's +Y
  const z = _x.clone().negate();
  const x = _u.clone().cross(z).normalize();
  const m = _q.setFromRotationMatrix(_m.makeBasis(x, _u, z));
  grip.position.copy(_r);
  ray.position.copy(_r);
  ray.quaternion.copy(m);
  grip.quaternion.copy(m);
  grip.updateMatrixWorld(true);
  ray.updateMatrixWorld(true);
  return true;
}
