/**
 * Bare hands: both tracked hands read once a frame (HandSystem, registered before everything that
 * plays on them), into `hands`, world space throughout. FLUX's reader (github.com/yellkell/fff),
 * which is proven in the headset:
 *
 *  - all 25 joints straight off the XRFrame in one `fillPoses` (the session's reference space, then
 *    through the player's rig into the world), from the hand IWSDK calls that side's primary, or,
 *    failing that, any hand on that side among the session's sources;
 *  - the palm's centre (between the wrist and the middle knuckle) and which way it faces: the wrist
 *    joint's −Y, as the WebXR hand model defines it (not worked out from the knuckles, whose cross
 *    product comes out the wrong way round if the runtime's hand is mirrored from the emulator's);
 *  - the hand's shape: CURL (the fingertips' mean reach from the wrist over the palm's length: about
 *    2 open, about 1 a fist) and PINCH (thumb tip to index tip), each with hysteresis, and held
 *    through a moment's lost tracking so a dropout doesn't read as an open hand.
 *
 * Also `rodFrame`: where a rod held in this fist sits and points (the fishing rod's grip).
 */

import { Matrix4, Quaternion, Vector3, type Object3D, type WebGLRenderer } from 'three';

export type Hand = 'left' | 'right';
export const HANDS: readonly Hand[] = ['left', 'right'];

/** the WebXR joints, by their index in an XRHand's iteration order */
const J = {
  wrist: 0,
  thumbTip: 4,
  indexKnuckle: 6,
  indexTip: 9,
  middleKnuckle: 11,
  middleTip: 14,
  ringTip: 19,
  pinkyKnuckle: 21,
  pinkyTip: 24,
} as const;
const JOINTS = 25;

/** the shape's thresholds (FLUX's): curl under fistOn is a fist, back over fistOff open; pinch (m) */
const SHAPE = { fistOn: 1.05, fistOff: 1.3, pinchOn: 0.02, pinchOff: 0.045, dropoutHold: 0.15 };

export interface HandState {
  /** joints arrived THIS frame (positions are only fresh when this is true) */
  fresh: boolean;
  /** fresh, or still inside the dropout hold (the shape's held) */
  tracked: boolean;
  wrist: Vector3;
  /** the palm's middle, between the wrist and the middle knuckle */
  palm: Vector3;
  /** out of the palm (the wrist joint's −Y) */
  palmNormal: Vector3;
  /** wrist → middle knuckle (unit) */
  fingers: Vector3;
  /** little-finger knuckle → index knuckle (unit, square to `fingers`): toward the thumb */
  across: Vector3;
  indexTip: Vector3;
  thumbTip: Vector3;
  /** the fingertips' reach over the palm's length (≈2 open, ≈1 a fist), and thumb to index (m) */
  curl: number;
  pinch: number;
  fist: boolean;
  pinching: boolean;
  /** seconds since the joints were last fresh */
  lostFor: number;
}

const make = (): HandState => ({
  fresh: false,
  tracked: false,
  wrist: new Vector3(),
  palm: new Vector3(),
  palmNormal: new Vector3(0, -1, 0),
  fingers: new Vector3(0, 0, -1),
  across: new Vector3(1, 0, 0),
  indexTip: new Vector3(),
  thumbTip: new Vector3(),
  curl: 2,
  pinch: 1,
  fist: false,
  pinching: false,
  lostFor: Infinity,
});

export const hands: Record<Hand, HandState> = { left: make(), right: make() };

/** A tracked hand that's open: not a fist, not a pinch. */
export const openHand = (s: HandState): boolean => s.tracked && !s.fist && !s.pinching;

/** XRFrame.fillPoses (WebXR Hand Input), missing from the DOM typings */
type HandFrame = XRFrame & { fillPoses?: (spaces: XRSpace[], base: XRSpace, out: Float32Array) => boolean };
type Input = { xr: { getPrimaryInputSource(h: Hand): XRInputSource | undefined } };

const buffers: Record<Hand, Float32Array> = { left: new Float32Array(JOINTS * 16), right: new Float32Array(JOINTS * 16) };
const _m = new Matrix4();
const _a = new Vector3();
const _k = new Vector3();

/** The XRHand for this side: IWSDK's primary for it if that's a hand, else any hand on that side. */
function handFor(input: Input, session: XRSession, h: Hand): XRHand | null {
  const p = input.xr.getPrimaryInputSource(h);
  if (p?.hand) return p.hand;
  const lists = [session.inputSources, (session as XRSession & { trackedSources?: XRInputSourceArray }).trackedSources];
  for (const list of lists) if (list) for (const src of list) if (src.handedness === h && src.hand) return src.hand;
  return null;
}

/** Fill `buf` with this frame's 25 joint matrices; false if the hand isn't tracked. */
function fill(frame: HandFrame, ref: XRReferenceSpace, hand: XRHand, buf: Float32Array): boolean {
  if (hand.size < JOINTS) return false;
  if (frame.fillPoses) return frame.fillPoses(Array.from(hand.values()), ref, buf);
  // (a runtime without fillPoses: a joint at a time)
  let i = 0;
  for (const space of hand.values()) {
    const pose = frame.getJointPose?.(space, ref);
    if (!pose) return false;
    buf.set(pose.transform.matrix, i * 16);
    if (++i >= JOINTS) break;
  }
  return true;
}

/** Read both hands for this frame (HandSystem calls it before anything plays on them). */
export function readHands(ctx: { renderer: WebGLRenderer; input: Input; player: Object3D }, dt: number): void {
  const frame = ctx.renderer.xr.getFrame() as HandFrame | null;
  const ref = ctx.renderer.xr.getReferenceSpace();
  const session = ctx.renderer.xr.getSession();
  ctx.player.updateMatrixWorld();
  const rig = ctx.player.matrixWorld;
  for (const h of HANDS) {
    const s = hands[h];
    s.fresh = false;
    const buf = buffers[h];
    const hand = frame && ref && session ? handFor(ctx.input, session, h) : null;
    const at = (j: number, out: Vector3): Vector3 => out.set(buf[j * 16 + 12], buf[j * 16 + 13], buf[j * 16 + 14]).applyMatrix4(rig);
    let ok = !!(frame && ref && hand && fill(frame, ref, hand, buf));
    let palmLen = 0;
    if (ok) {
      at(J.wrist, s.wrist);
      palmLen = at(J.middleKnuckle, _k).distanceTo(s.wrist);
      ok = palmLen > 0.02; // (all zeros, or garbage, isn't a hand)
    }
    if (!ok) {
      // hold the last shape a moment: a dropout mustn't read as an open hand
      s.lostFor += dt;
      s.tracked = s.lostFor <= SHAPE.dropoutHold;
      if (!s.tracked) s.fist = s.pinching = false;
      continue;
    }
    s.fresh = true;
    s.tracked = true;
    s.lostFor = 0;
    s.palm.copy(s.wrist).add(_k).multiplyScalar(0.5);
    s.fingers.copy(_k).sub(s.wrist).normalize();
    at(J.indexKnuckle, s.across).sub(at(J.pinkyKnuckle, _a));
    s.across.addScaledVector(s.fingers, -s.across.dot(s.fingers)).normalize();
    // the palm faces along the wrist joint's −Y in the WebXR hand model
    _m.fromArray(buf, J.wrist * 16).premultiply(rig);
    s.palmNormal.set(-_m.elements[4], -_m.elements[5], -_m.elements[6]).normalize();
    at(J.indexTip, s.indexTip);
    at(J.thumbTip, s.thumbTip);
    let reach = 0;
    for (const t of [J.indexTip, J.middleTip, J.ringTip, J.pinkyTip]) reach += at(t, _a).distanceTo(s.wrist);
    s.curl = reach / 4 / palmLen;
    s.pinch = s.thumbTip.distanceTo(s.indexTip);
    s.fist = s.fist ? s.curl < SHAPE.fistOff : s.curl < SHAPE.fistOn;
    s.pinching = s.pinching ? s.pinch < SHAPE.pinchOff : s.pinch < SHAPE.pinchOn;
  }
}

/* ── the rod in your fist ───────────────────────────────────────────────── */

/** how far round from the knuckle line toward the fingers a rod lies in the fist (rad): 30° off the
 *  fingers, so a neutral fist holds it up at about the angle a controller does (rod.ts ROD_TILT) */
const ROD_DIAGONAL = (60 * Math.PI) / 180;
/** how far in front of the palm the rod's middle lies, inside the closed fingers (m) */
const ROD_IN_FIST = 0.03;

const _f = new Vector3();
const _t = new Vector3();
const _x = new Vector3();
const _u = new Vector3();
const _z = new Vector3();
const _rm = new Matrix4();
const _q = new Quaternion();

/**
 * Where a rod held in this fist sits and which way it runs, as the controller's ray would give it:
 * the blank lies diagonally across the palm from the heel of the hand up between thumb and index
 * (round from the knuckle line toward the fingers by ROD_DIAGONAL), just inside the closed fingers,
 * the thumb on top. The ray's −Z is pitched down from the blank by `tilt` (the rod's own tilt up off
 * the ray, fishing/rod.ts ROD_TILT), so the rod lies along it. Into `grip` (position) and `ray`
 * (orientation). False if the hand's joints aren't fresh this frame.
 */
export function rodFrame(h: Hand, tilt: number, grip: Object3D, ray: Object3D): boolean {
  const s = hands[h];
  if (!s.fresh) return false;
  _f.copy(s.across).multiplyScalar(Math.cos(ROD_DIAGONAL)).addScaledVector(s.fingers, Math.sin(ROD_DIAGONAL)).normalize();
  // the thumb's side of the blank: the knuckle line, square to the blank
  _t.copy(s.across).addScaledVector(_f, -s.across.dot(_f)).normalize();
  const c = Math.cos(tilt);
  const sn = Math.sin(tilt);
  _x.copy(_f).multiplyScalar(c).addScaledVector(_t, -sn); // the ray's −Z
  _u.copy(_f).multiplyScalar(sn).addScaledVector(_t, c); // the ray's +Y
  _z.copy(_x).negate();
  const x = _x.copy(_u).cross(_z).normalize();
  _q.setFromRotationMatrix(_rm.makeBasis(x, _u, _z));
  grip.position.copy(hands[h].palm).addScaledVector(s.palmNormal, ROD_IN_FIST);
  ray.position.copy(grip.position);
  ray.quaternion.copy(_q);
  grip.quaternion.copy(_q);
  return true;
}
