/**
 * The rod in your hand: Tidewater's 7 ft spinning combo, held by the reel seat in whichever
 * controller has it, the reel hanging under your fingers.
 *
 * Everything that made it feel alive in Tidewater (game/FishingRod.js) carries over — the blank
 * is a damped spring that loads toward the line (only the tip for a nibble, deep into the butt
 * for a big fish), the bail flips open while your finger's on the line, the crank and rotor turn
 * as line comes in, the spool slips back when a fish takes drag. What's new is that the pose
 * isn't animated: it IS your hand, so the tip's speed is real and the cast and the strike read it.
 *
 * It's painted for the gear you've bought (fishing/rodLook.ts): the blank, grips, wraps and
 * metalwork for your rod, the reel's body and trim for your reel, the line on the spool and
 * through the guides for your line.
 *
 * And it carries the reel you bought, as the tackle shop shows it: a spinning reel hangs under
 * your fingers, a conventional reel (the top two) sits on top of the rod with the guides turned up
 * to it. That one works as it should: no bail or rotor, the handle cranks forward over the top
 * and the spool winds the line in, the spool spins out paying line on the cast and backs off when
 * a fish takes drag, the line on it thins as it goes out, and the big-game reel's red lever pulls
 * back to free spool as you cast and pushes up to strike.
 */

import { BufferAttribute, BufferGeometry, Color, Matrix3, Matrix4, Mesh, Quaternion, Vector2, Vector3, type Object3D } from 'three';
import { stalk } from '../village/craft.ts';
import { conventionalReel, type ReelPaint } from './conventionalReel.ts';
import { bendAt, bendPower, BODY_Y, CONV_TAG, CRANK, GUIDE1, REEL_Z, ROD_L, SEAT_Y, type Props, type RodTags, type RodUniforms } from './props.ts';
import { isConventional, LINE, REEL_KNOB, REEL_LEVER, REELS, rodPaint, type GearLevels } from './rodLook.ts';

/** The rod rides this far up from the controller's pointing axis (a relaxed wrist). */
export const ROD_TILT = 0.38;
const GEAR = 5.2; // rotor turns per crank turn
/** a conventional reel's spool turns per crank turn */
const CONV_GEAR = 4.4;
export const LINE_PER_CRANK = 0.8; // m of line per crank turn
/** the spinning reel's spool (m): what turns it back a radian when the drag gives */
const SPIN_SPOOL_R = 0.023;
/** The fastest a spool is shown turning (turns / s): any faster and it would strobe. */
const SHOWN_TURNS = 3.1;
/** A conventional reel's foot sits on the seat's top: its underside this far above the rod's axis. */
const CONV_FOOT_Z = 0.0084;

/* The blank is a damped 2-D spring across its axis (~2.5 Hz, lightly damped). */
const K = 250;
const C = 8;
/** What the blank's own weight bends it when it's held level. */
const SAG = 0.012;
/** How much of the hand's swing the tip lags by (1 = all of its mass at the tip). */
const INERTIA = 0.7;
/** The hand's acceleration is clamped here (m/s²): a tracking glitch mustn't fold the rod. */
const MAX_ACC = 120;
/**
 * The tip jumping this far in a frame (m, or m/s times the frame) is a tracking glitch, not a
 * swing. It's read in the rig's frame, so a teleport or a snap turn never gets here, and it's well
 * past any swing: a hard cast's tip runs 30 m/s and more, over half a metre in one slow frame.
 */
const GLITCH = 1.5;
const GLITCH_SPEED = 80;
const MAX_BEND = 0.75;
/** The unbent tip-top, rod space. */
const TIP0 = new Vector3(0, ROD_L, 0);

const _m = new Matrix4();
const _inv = new Matrix4();
const _v = new Vector3();
const _b = { lat: 0, drop: 0 };
const _p = new Vector3();
const _q = new Quaternion();
const _one = new Vector3(1, 1, 1);
const _g = new Vector3();
const _a = new Vector3();
const _t = new Vector2();
const _rot = new Matrix3();
const _rigInv = new Matrix4();

/**
 * Add the part of a pull that bends the blank to `out` (rod space x, z). `d` is the pull's unit
 * direction in rod space, `amount` what it would bend a blank it pulls square across. Along the
 * blank a pull only compresses it: pointing the rod at the fish takes the bend out of it. Across it
 * bends it by the sine of the angle, and a line running back past the tip (a rod held high over a
 * fish below) hooks the tip over with all of it.
 */
function addPull(d: Vector3, amount: number, out: Vector2): void {
  const s = Math.hypot(d.x, d.z);
  if (amount <= 0 || s < 1e-4) return;
  const f = d.y >= 0 ? s : Math.min(1, s / 0.2);
  out.x += (d.x / s) * f * amount;
  out.y += (d.z / s) * f * amount;
}

/** Hand → rod: rod +Y along the blank (tilted up from the pointing −Z), rod −Z (the reel) hanging below. */
const HOLD = new Matrix4()
  .makeBasis(
    new Vector3(1, 0, 0),
    new Vector3(0, Math.sin(ROD_TILT), -Math.cos(ROD_TILT)),
    new Vector3(0, Math.cos(ROD_TILT), Math.sin(ROD_TILT)),
  )
  .multiply(new Matrix4().makeTranslation(0, -SEAT_Y, 0));

interface TipSample {
  t: number;
  v: Vector3;
}

/** what a conventional reel's pieces are painted, by their index in its `paint` */
const PAINTS: ReelPaint[] = ['body', 'trim', 'knob', 'line', 'lever'];

/** A conventional reel on the rod (rod space), drawn with the rod's own material. */
interface FittedReel {
  mesh: Mesh;
  /** per vertex: what it's painted (an index into PAINTS), and how light (the line's bands) */
  paint: Uint8Array;
  shade: Float32Array;
  axle: { y: number; z: number };
  lineR: number;
  coreR: number;
  /** the handle's knob, and its angle about the axle at rest */
  knob: Vector3;
  knobAt: number;
}

/**
 * The shop's conventional reel of this level (fishing/conventionalReel.ts) fitted on top of the
 * rod: its frame turned half round about the rod (the shop's reel stands off toward −z with its
 * handle on +x; on the rod it's on top, +z, and the handle's on the left for your other hand, as
 * the spinning reel's is), its foot on the seat. The line runs off the top of its spool to the
 * first guide, which the shader turns to the top with it.
 */
function fitConventional(level: number, rod: Mesh): FittedReel {
  const r = conventionalReel(level);
  const axle = { y: SEAT_Y + r.axle.y, z: CONV_FOOT_Z - r.axle.z };
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const anim: number[] = [];
  const paint: number[] = [];
  const add = (g: BufferGeometry, p: ReelPaint, tag: number, fromShop: boolean): void => {
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    const base = pos.length / 3;
    for (let i = 0; i < P.count; i++) {
      if (fromShop) {
        pos.push(-P.getX(i), SEAT_Y + P.getY(i), CONV_FOOT_Z - P.getZ(i));
        nor.push(-N.getX(i), N.getY(i), -N.getZ(i));
      } else {
        pos.push(P.getX(i), P.getY(i), P.getZ(i));
        nor.push(N.getX(i), N.getY(i), N.getZ(i));
      }
      anim.push(tag);
      paint.push(PAINTS.indexOf(p));
    }
    const I = g.index;
    for (let i = 0; i < (I ? I.count : P.count); i++) idx.push(base + (I ? I.getX(i) : i));
  };
  for (const p of r.pieces) add(p.g, p.paint, CONV_TAG[p.move], true);
  add(stalk([new Vector3(0, axle.y, axle.z + r.lineR), new Vector3(0, GUIDE1.y, -GUIDE1.z - 0.0005)], 0.0003, 0.0003, 4, 1), 'line', CONV_TAG.lead, false);

  const n = anim.length;
  // the line on the spool in bands, so you see it turn
  const shade = new Float32Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    if (anim[i] !== CONV_TAG.line) continue;
    const a = Math.atan2(pos[i * 3 + 2] - axle.z, pos[i * 3 + 1] - axle.y);
    shade[i] = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 12 + 0.5) % 2 ? 0.72 : 1;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new BufferAttribute(new Uint8Array(n * 3), 3, true));
  g.setAttribute('anim', new BufferAttribute(new Float32Array(anim), 1));
  g.setAttribute('fit', new BufferAttribute(new Float32Array(n), 1));
  g.setIndex(idx);
  const mesh = new Mesh(g, rod.material);
  mesh.name = `reel${level}`;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  rod.add(mesh);
  const knob = new Vector3(-r.knob.x, SEAT_Y + r.knob.y, CONV_FOOT_Z - r.knob.z);
  return { mesh, paint: Uint8Array.from(paint), shade, axle, lineR: r.lineR, coreR: r.coreR, knob, knobAt: Math.atan2(knob.z - axle.z, knob.y - axle.y) };
}

export class Rod {
  readonly mesh: Mesh;
  private readonly u: RodUniforms;
  /** world position of the tip-top (the line leaves from here) */
  readonly tip = new Vector3();
  /** smoothed world velocity of the tip as your hand swings it (the unbent tip: the blank's wobble isn't your swing) (m/s) */
  readonly tipVel = new Vector3();
  /**
   * The swing as the rig sees it (the unbent tip, its smoothed velocity and acceleration, in the
   * rig's frame): a teleport or a snap turn moves the rig, not your hand, so it isn't a swing.
   */
  private readonly lastTip = new Vector3();
  private readonly vel = new Vector3();
  private readonly lastVel = new Vector3();
  private readonly acc = new Vector3();
  /** the rig's turn, to bring the swing back into the world */
  private readonly rigQ = new Quaternion();
  private hasLast = false;
  private hasVel = false;
  /** the rig-frame velocity over the last moments, for the cast */
  private readonly samples: TipSample[] = [];

  bend = 0;
  /** the tip's deflection across the blank (rod space x, z; its length is `bend`) and its rate */
  private readonly bendXZ = new Vector2();
  private readonly bendVel = new Vector2();
  private load = 0.15;
  private readonly bendDir = new Vector3(0, 0, -1);
  private shapeP = bendPower(0.15);

  rotor = 0;
  crank = 0;
  spoolAng = 0;
  private bail = 0;
  /** crank turns / s (smoothed): animates the handle and drives the reel's sound */
  crankRate = 0;
  lineFill = 1;

  private readonly tags: RodTags | null;
  /** the colours as baked (Tidewater's), and the ones it wears now */
  private readonly baked: Uint8Array;
  private readonly paint: BufferAttribute;
  private dressed = '';
  /** the conventional reels, fitted as they're first needed, and the one on the rod (null: the spinning reel) */
  private readonly fitted = new Map<number, FittedReel>();
  private conv: FittedReel | null = null;

  constructor(props: Props) {
    const { mesh, uniforms } = props.makeRod();
    this.mesh = mesh;
    this.u = uniforms;
    this.mesh.visible = false;
    this.tags = props.rodTags;
    // its own colours, so repainting it leaves the shared geometry alone
    const col = mesh.geometry.getAttribute('color') as BufferAttribute;
    this.baked = (col.array as Uint8Array).slice();
    this.paint = new BufferAttribute((col.array as Uint8Array).slice(), 3, true);
    mesh.geometry = mesh.geometry.clone();
    mesh.geometry.setAttribute('color', this.paint);
  }

  /** Paint it for these gear levels (cheap to call every frame: it only repaints on a change). */
  dress(g: GearLevels): void {
    const key = `${g.rod}/${g.reel}/${g.line}`;
    if (key === this.dressed || !this.tags) return;
    this.dressed = key;
    this.fitReel(g);
    const { names, mat, reel } = this.tags;
    // each material's colour on the rod and on the reel, as the vertex colours hold them (linear)
    const lut = new Map<number, [number, number, number] | null>();
    const c = new Color();
    const out = this.paint.array as Uint8Array;
    for (let i = 0; i < mat.length; i++) {
      const k = mat[i] * 2 + reel[i];
      let rgb = lut.get(k);
      if (rgb === undefined) {
        const hex = rodPaint(names[mat[i]], reel[i] === 1, g);
        rgb = hex ? (c.set(hex), [c.r, c.g, c.b].map((v) => Math.round(Math.min(1, v) * 255)) as [number, number, number]) : null;
        lut.set(k, rgb);
      }
      for (let j = 0; j < 3; j++) out[i * 3 + j] = rgb ? rgb[j] : this.baked[i * 3 + j];
    }
    this.paint.needsUpdate = true;
  }

  /** A conventional reel on the rod for those levels (the shader takes the spinning reel off), painted. */
  private fitReel(g: GearLevels): void {
    const level = Math.max(0, Math.min(REELS.length - 1, g.reel | 0));
    let conv: FittedReel | null = null;
    if (isConventional(level) && this.tags?.fit) {
      conv = this.fitted.get(level) ?? null;
      if (!conv) this.fitted.set(level, (conv = fitConventional(level, this.mesh)));
    }
    for (const f of this.fitted.values()) f.mesh.visible = f === conv;
    this.conv = conv;
    if (!conv) return;
    this.u.reelAxle.value.set(conv.axle.y, conv.axle.z, conv.coreR, 0);
    const look = REELS[level];
    const hex: Record<ReelPaint, string> = { body: look.body, trim: look.trim, knob: REEL_KNOB, line: LINE[Math.max(0, Math.min(LINE.length - 1, g.line | 0))], lever: REEL_LEVER };
    const rgb = PAINTS.map((p) => new Color(hex[p]));
    const col = conv.mesh.geometry.getAttribute('color') as BufferAttribute;
    const out = col.array as Uint8Array;
    for (let i = 0; i < conv.paint.length; i++) {
      const c = rgb[conv.paint[i]];
      const s = conv.shade[i];
      out[i * 3] = Math.round(Math.min(1, c.r * s) * 255);
      out[i * 3 + 1] = Math.round(Math.min(1, c.g * s) * 255);
      out[i * 3 + 2] = Math.round(Math.min(1, c.b * s) * 255);
    }
    col.needsUpdate = true;
  }

  /**
   * Pose the rod on the hand and step its spring. It sits in the palm (the GRIP space's origin)
   * but points where the controller points (the RAY space's −Z): on Quest the grip frame is
   * pitched ~45° up from the ray, and a rod follows where you aim, not the angle of the handle. `towards`: where the line pulls (world), or
   * null for a line hanging straight down. `bendT` / `loadT`: Tidewater's targets for the state.
   * `rig`: the player's rig (the hands' parent), whose frame the swing is read in.
   */
  update(dt: number, time: number, grip: Object3D, ray: Object3D, o: { bendT: number; loadT: number; towards: Vector3 | null; bailOpen: boolean; rig?: Object3D }): void {
    grip.updateWorldMatrix(true, false);
    ray.updateWorldMatrix(true, false);
    grip.getWorldPosition(_p);
    ray.getWorldQuaternion(_q);
    this.mesh.matrix.compose(_p, _q, _one).multiply(HOLD);
    this.mesh.matrixWorldNeedsUpdate = true;
    _inv.copy(this.mesh.matrix).invert();

    // the hand's swing, read off the unbent tip in the rig's frame (the cast and the strike read this too)
    if (o.rig) {
      o.rig.updateWorldMatrix(true, false);
      _rigInv.copy(o.rig.matrixWorld).invert();
      o.rig.getWorldQuaternion(this.rigQ);
    } else {
      _rigInv.identity();
      this.rigQ.identity();
    }
    _p.copy(TIP0).applyMatrix4(this.mesh.matrix).applyMatrix4(_rigInv);
    let swung = false;
    if (this.hasLast && dt > 0) {
      _v.copy(_p).sub(this.lastTip);
      if (_v.length() > Math.max(GLITCH, GLITCH_SPEED * dt)) {
        this.resetMotion();
      } else {
        this.lastVel.copy(this.vel);
        this.vel.lerp(_v.divideScalar(dt), 1 - Math.exp(-dt * 30));
        this.samples.push({ t: time, v: this.vel.clone() });
        while (this.samples.length && time - this.samples[0].t > 0.15) this.samples.shift();
        if (this.hasVel) {
          _a.copy(this.vel).sub(this.lastVel).divideScalar(dt);
          this.acc.lerp(_a, 1 - Math.exp(-dt * 20));
          swung = true;
        }
        this.hasVel = true;
      }
    }
    this.lastTip.copy(_p);
    this.hasLast = true;
    this.tipVel.copy(this.vel).applyQuaternion(this.rigQ);

    // where it's pulled (rod space, across the blank): its own weight toward the ground, and the
    // line from the tip-top toward the bob (a fish hanging off it, or the rod loaded in the
    // back-cast, pulls straight down)
    _g.set(0, -1, 0).transformDirection(_inv);
    _t.set(0, 0);
    addPull(_g, SAG, _t);
    const lineLoad = Math.max(0, o.bendT - SAG);
    if (!o.towards) addPull(_g, lineLoad, _t);
    else if (_v.copy(o.towards).applyMatrix4(_inv).sub(TIP0).lengthSq() > 1e-6) addPull(_v.normalize(), lineLoad, _t);

    // the spring: toward the pull, and the tip lagging behind the hand when you swing it
    let ax = 0;
    let az = 0;
    if (swung) {
      _rot.setFromMatrix4(_inv);
      _a.copy(this.acc).clampLength(0, MAX_ACC).applyQuaternion(this.rigQ).applyMatrix3(_rot);
      ax = (-_a.x * INERTIA) / ROD_L;
      az = (-_a.z * INERTIA) / ROD_L;
    }
    const b = this.bendXZ;
    const bv = this.bendVel;
    const h = Math.min(dt, 0.05); // a long frame mustn't blow the spring up
    bv.x += ((_t.x - b.x) * K - bv.x * C + ax) * h;
    bv.y += ((_t.y - b.y) * K - bv.y * C + az) * h;
    b.addScaledVector(bv, h).clampLength(0, MAX_BEND);
    this.bend = b.length();
    if (this.bend > 1e-5) this.bendDir.set(b.x / this.bend, 0, b.y / this.bend);
    this.load += (o.loadT - this.load) * (1 - Math.exp(-dt * 6));
    const P = bendPower(this.load);
    this.shapeP = P;
    this.u.rodBend.value.set(this.bendDir.x, 0, this.bendDir.z, this.bend);
    this.u.rodShape.value.set(P, 0, 0, 0);

    // the tip, on the same curve as the shader
    bendAt(ROD_L, this.bend, P, _b);
    this.tip.set(this.bendDir.x * _b.lat, ROD_L - _b.drop, this.bendDir.z * _b.lat).applyMatrix4(this.mesh.matrix);

    // reel: bail (a conventional reel's drag lever, back for free spool), rotor (GEAR× the crank,
    // shown at most ~3 turns/s), spool
    const bailT = o.bailOpen ? 1 : 0;
    const rate = bailT > this.bail ? 6 : 16;
    this.bail += Math.sign(bailT - this.bail) * Math.min(Math.abs(bailT - this.bail), rate * dt);
    this.u.reelAnim.value.set(this.rotor, this.bail, this.crank, this.spoolAng);
    this.u.reelAnim2.value.set(this.conv ? 0 : Math.sin(this.crank * 0.5) * 0.0035, this.lineFill, this.conv ? 1 : 0, 0);
  }

  /**
   * Turn the crank by `turns` (from the reel's line speed or your other hand): a spinning reel's
   * rotor spins round its spool, a conventional reel's spool winds the line in.
   */
  turnCrank(turns: number, dt: number): void {
    const d = turns * Math.PI * 2;
    this.crank += d;
    const shown = SHOWN_TURNS * Math.PI * 2 * dt;
    if (this.conv) this.spoolAng += Math.min(d * CONV_GEAR, shown);
    else this.rotor += Math.min(d * GEAR, shown);
  }

  /**
   * `m` of line going out off the spool, which turns back to pay it: the drag giving to a fish,
   * or (`cast`) the cast running it off. A spinning reel's spool stands still on the cast (the
   * line slips off over its lip); a conventional reel's spool spins out in free spool.
   */
  payOut(m: number, dt: number, cast = false): void {
    const c = this.conv;
    if (m <= 0 || (cast && !c)) return;
    const a = m / (c ? c.coreR + (c.lineR - c.coreR) * this.lineFill : SPIN_SPOOL_R);
    this.spoolAng -= cast ? Math.min(a, SHOWN_TURNS * Math.PI * 2 * dt) : a;
  }

  /** The fastest the tip moved in the last ~0.15 s (a cast is released just after its peak), in the world. */
  peakTipVelocity(out: Vector3): Vector3 {
    out.set(0, 0, 0);
    let best = -1;
    for (const s of this.samples) {
      const l = s.v.lengthSq();
      if (l > best) {
        best = l;
        out.copy(s.v);
      }
    }
    return out.applyQuaternion(this.rigQ);
  }

  /** Where the bent blank's axis is at rod height `y`, relative to the straight rod (rod space). */
  blankOffset(y: number, out: Vector3): Vector3 {
    bendAt(y, this.bend, this.shapeP, _b);
    return out.set(this.bendDir.x * _b.lat, -_b.drop, this.bendDir.z * _b.lat);
  }

  /** World → rod space. */
  toRod(world: Vector3, out: Vector3): Vector3 {
    return out.copy(world).applyMatrix4(_m.copy(this.mesh.matrix).invert());
  }

  /** World position of the crank's axis (where your other hand reaches for the handle). */
  crankCentre(out: Vector3): Vector3 {
    const c = this.conv;
    return (c ? out.set(c.knob.x, c.axle.y, c.axle.z) : out.set(CRANK.x, BODY_Y, REEL_Z)).applyMatrix4(this.mesh.matrix);
  }

  /** The crank angle your hand is at (rod space, same convention as the shader), in radians. */
  crankAngleOf(world: Vector3): number {
    this.toRod(world, _v);
    const c = this.conv;
    // a conventional reel's handle turns forward over the top (the shader turns it by −crank)
    if (c) return c.knobAt - Math.atan2(_v.z - c.axle.z, _v.y - c.axle.y);
    const qy = _v.y - BODY_Y;
    const qz = _v.z - REEL_Z;
    // the knob at rest hangs below the axis: (y, z) = (−r cos a, −r sin a)
    return Math.atan2(-qz, -qy);
  }

  resetMotion(): void {
    this.hasLast = false;
    this.hasVel = false;
    this.samples.length = 0;
    this.tipVel.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.acc.set(0, 0, 0);
  }
}
