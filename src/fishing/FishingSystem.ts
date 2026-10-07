/**
 * FishingSystem — How to Fish's loop, played with your hands, on Tidewater's rules.
 *
 *  ROD OUT / AWAY   B (right hand) or Y (left hand): the rod goes into that hand, or away.
 *  CAST             Hold the TRIGGER — your finger on the line, the bail open — swing the rod
 *                   and let go. The bobber leaves the tip at the speed the tip was really moving
 *                   (a lazy lob drops at your feet, a full overhead swing sends it the rod's
 *                   whole range). Where it lands decides what can bite: sand, the shallows, the
 *                   pier piles, the reef, the bay, the deep (Tidewater's habitats).
 *  WAIT             A few nibbles — the bobber bobs and the rod ticks in your hand — then the
 *                   take: the bobber is pulled under and the rod buzzes hard.
 *  STRIKE           Yank the rod back (or pull the trigger) while it's under. Too early, while
 *                   it's only nibbling, and nothing happens but a hint; too late and it's gone.
 *  FIGHT            Tidewater's line-tension fight. Reel with the TRIGGER (pressure = speed), or
 *                   grab the reel's handle with your OTHER hand (grip) and crank it round. Keep
 *                   the tension in the green; ease off when it runs, or the line snaps. The rod
 *                   bows and the controller shakes with every surge. Hooked, it runs first, and
 *                   it won't come to the rod until it's tired (fishing/fight.ts); ease off and it
 *                   swims away, taking line, until it's taken it all. Teleport is closed until
 *                   it's over.
 *  LAND             The fish swings up out of the water and hangs off your rod tip, thrashing,
 *                   with its card beside it; it goes in the cooler (trigger or B/Y, or wait).
 *  REEL IN          With nothing biting, reel (trigger or crank) to skim the bobber back. Let go
 *                   and it sits where it is and fish can find it again.
 *  THE GREAT WHITE  The last catch (fishing/shark.ts): once the field guide is full it takes a
 *                   bait in deep water. It breaches as each run begins; grab the rod's rear grip,
 *                   below your rod hand, with your OTHER hand too and hold on (fishing/sharkShow.ts shows where) until
 *                   the run breaks. Three held runs beat it; it comes up out of the sea and hangs
 *                   off the rod like any catch. Too big for the backpack: grab it, carry it to the
 *                   fish market and sell it on the scale.
 *
 * Teleporting with the line out brings it in.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Group, Mesh, Quaternion, Vector2, Vector3, type Object3D } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Bed, loadSamples, MIX, setListener, shot, surfaceThrash, waterEntrySmall, waterExitFish, waterExitSmall } from '../audio/samples.ts';
import { bigWinHit, catchSting, winFanfare } from '../audio/sfx.ts';
import { Celebration } from '../casino/celebrate.ts';
import type { WaterFx } from '../fx/water.ts';
import { backpackView } from '../backpack/BackpackSystem.ts';
import { pointerView } from '../ui/pointer.ts';
import { fill, GRID_SIZES, type Piece } from '../backpack/logic.ts';
import { pulseHand } from '../input/haptics.ts';
import { rodFrame } from '../input/hands.ts';
import { locomotion } from '../locomotion/TeleportSystem.ts';
import { INK } from '../ui/panel.ts';
import type { WristWallet } from '../ui/wallet.ts';
import type { WorldJson } from '../world/data.ts';
import type { Heightfield } from '../world/heightfield.ts';
import type { Ocean } from '../world/ocean.ts';
import { LineWraps } from '../world/lineWrap.ts';
import type { Surfaces, Vec3 } from '../world/surfaces.ts';
import type { Kit } from '../village/craft.ts';
import { BaitRig } from './baitRig.ts';
import { FishFight } from './fight.ts';
import { CatchCard, Toast } from './hud.ts';
import { CLAMP_Y, RodGauge } from './rodGauge.ts';
import { swim, type FishUniforms, type Props } from './props.ts';
import { LINE_PER_CRANK, ROD_TILT, Rod } from './rod.ts';
import { LINE } from './rodLook.ts';
import { SHARK_HANG, SHARK_ID, SharkFight, sharkUnlocked } from './shark.ts';
import { GRIP_Y, SharkShow } from './sharkShow.ts';
import {
  biteDelay,
  FISH,
  FISH_IDS,
  fishLengthCm,
  habitatAt,
  pickSpecies,
  rollWeight,
  type CaughtFish,
  type GameState,
  type Habitat,
} from './tidewater.ts';
import { introActive } from '../experience/introGate.ts';

type Hand = 'left' | 'right';
type RodState = 'stowed' | 'idle' | 'windup' | 'flying' | 'floating' | 'retrieving' | 'fighting' | 'landing';

/** VR tuning (everything else is Tidewater's). */
export const FISHING = {
  /** time of day for the bites when there's no island clock (fishingDeps.hour) */
  hour: 16,
  /** trigger past this holds the line / reels; below `triggerOff` lets go */
  triggerOn: 0.55,
  triggerOff: 0.25,
  /** bobber on a short drop below the tip while you're not casting */
  dangle: 0.45,
  /** with a fish on, the float's this far up the line from the hook (m) */
  floatUp: 0.45,
  /** cast: tip speed → bobber speed, and the top speed (at the base rod's 22 m) */
  castGain: 1.0,
  castMaxSpeed: 20,
  /** cast assist: launch elevation pulled this fraction of the way to `castElev`, floor `castMinElev` */
  castElev: (30 * Math.PI) / 180,
  castElevAssist: 0.6,
  castMinElev: (10 * Math.PI) / 180,
  /** strike: tip speed back toward you / up (m/s) that sets the hook */
  strikeSpeed: 2.2,
  /** your other hand has to be this close to the crank axis to take hold of the handle */
  crankReach: 0.13,
  /** crank turns / s that count as reeling flat out */
  crankFull: 1.4,
  /** landing: the fish hangs this far below the tip */
  landLine: 0.28,
  /** the catch card stays up this long unless dismissed (s) */
  cardSeconds: 9,
  /** a teleport this far (m) with the line out brings the line in */
  teleportReel: 1.0,
} as const;

/** Everything the system needs from the world; set by main before registration. */
export const fishingDeps: {
  props: Props | null;
  state: GameState | null;
  ocean: Ocean | null;
  terrain: Heightfield | null;
  surfaces: Surfaces | null;
  layout: WorldJson['layout'] | null;
  wallet: WristWallet | null;
  fx: WaterFx | null;
  /** is the player standing inside a building? (the rod goes away indoors and comes back out) */
  indoors: (() => boolean) | null;
  /** the island's hour (world/sky.ts): what bites, and when */
  hour: (() => number) | null;
  /** 0 by day .. 1 after dark (world/sky.ts): the bait's shine fades with the daylight */
  night: { value: number } | null;
} = { props: null, state: null, ocean: null, terrain: null, surfaces: null, layout: null, wallet: null, fx: null, indoors: null, hour: null, night: null };

/** the hour the fish go by: the island's clock, or FISHING.hour without one */
const hourNow = (): number => fishingDeps.hour?.() ?? FISHING.hour;

/** Dev window (`__fish.fishing`). */
export const fishingView: { state?: () => RodState; bite?: () => unknown; fight?: () => unknown; system?: FishingSystem; /** the hand the rod's in (or goes back to) */ hand?: () => 'left' | 'right' } = {};

interface Bite {
  phase: 'wait' | 'nibble' | 'take';
  t: number;
  species?: string;
  kg?: number;
  nibbles?: number;
  pulse?: number;
}

const _v = new Vector3();
const _w = new Vector3();
const _x = new Vector3();
const _h = new Vector3();
const _up = new Vector3(0, 1, 0);
const _q = new Quaternion();
/** and where it comes down outside the pier and in under it, to a fish under it */
const _edgeTop = new Vector3();
const _edgeUnder = new Vector3();
/** the line's points: enough for every corner it can have (16 rests on each of five stretches
 *  between the posts it's round, 8 round each post) and still curve between them */
const LINE_N = 128;
/** the float's radius (Tidewater's buildBobberGeometry), at arm's length where it isn't scaled up */
const BOBBER_R = 0.028;

/**
 * A catch's save entry gets the markings of the fish that was on the line (props.makeFish), so
 * the one in your hand and in the backpack is that fish, not another of its kind. Its id back.
 */
function keepMarkings(state: GameState, fish: CaughtFish | null, seed: number | undefined): number | null {
  if (!fish) return null;
  if (seed !== undefined) {
    fish.seed = seed;
    state.save();
  }
  return fish.id;
}

/** A point `t` along the curve from `a` up through a point `rise` m high over `a`, to `b`. */
function bezier(a: Vector3, rise: number, b: Vector3, t: number, out: Vector3): Vector3 {
  const u = 1 - t;
  out.set(u * u * a.x + 2 * u * t * a.x + t * t * b.x, u * u * a.y + 2 * u * t * rise + t * t * b.y, u * u * a.z + 2 * u * t * a.z + t * t * b.z);
  return out;
}

const dist = (p: Vec3, q: Vec3): number => Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class FishingSystem extends createSystem({}) {
  private rod!: Rod;
  private hand: Hand = 'right';
  private state: RodState = 'stowed';
  private t = 0; // time in state

  private bobber!: Mesh;
  /** the hook and bait hanging under the float (fishing/baitRig.ts) */
  private bait!: BaitRig;
  private readonly baitAnchor = new Vector3();
  private readonly bob = new Vector3();
  private readonly bobVel = new Vector3();
  private dip = 0;
  private lineOut = 0;

  private line!: Line2;
  private lineGeo!: LineGeometry;
  private lineMat!: LineMaterial;
  private readonly lineBuf = new Float32Array((LINE_N + 1) * 3);
  private readonly linePts: Vec3[] = [];
  /** the posts the line's caught round (world/lineWrap.ts) */
  private wraps: LineWraps | null = null;
  /** where the line to a fish under the pier came out from under the deck last frame (it's held
   *  there, sliding along the edge: Surfaces.lineUnder), or null */
  private edgeHeld: Vector3 | null = null;

  private bite: Bite | null = null;
  private fight: FishFight | SharkFight | null = null;
  private readonly fishPos = new Vector3();
  /** the fish on the line, from the strike until it's landed (or gone): hooked by the mouth at
   * `bob`, its head along `yaw`; `run` eases 0..1 as it turns away to run, `slip` how long it's
   * been taking line */
  private hooked: { mesh: Mesh; u: FishUniforms; seed: number; len: number; yaw: number; run: number; slip: number } | null = null;
  private wander = 0;
  private lastDist = 0;
  private splashed = false;
  private hapticT = 0;
  private hintT = 0;

  /** `out`: where it's drawn to first, out from under a deck (for `pre` s), before it's swung in.
   * `face` is where it's turned now; `fit`/`next`/`fitFor`/`twist` its fits of thrashing */
  private landing: {
    species: string;
    kg: number;
    mesh: Mesh;
    u: FishUniforms;
    len: number;
    from: Vector3;
    rise: number;
    time: number;
    yaw: number;
    out: Vector3 | null;
    pre: number;
    face: number;
    fit: number;
    fitFor: number;
    next: number;
    twist: number;
  } | null = null;

  // the other hand on the crank
  private cranking = false;
  private crankA = 0;
  private handCrankRate = 0;
  private crankTick = 0;

  private triggerHeld = false;
  private autoEquipped = false;
  private readonly lastRig = new Vector3();

  private shark!: SharkShow;
  private party!: Celebration;
  /** the other hand on the rear grip, against a shark's run */
  private holding = false;
  /** the first run's word's been said (this visit): after it, no more pop-ups in the fight */
  private sharkTold = false;
  private sharkLanding = false;
  private holdBuzzT = 0;

  private gauge!: RodGauge;
  private toast!: Toast;
  private card!: CatchCard;
  private readonly beds = { wind: new Bed('reel_wind', MIX.reelWind), drag: new Bed('reel_drag', MIX.reelDrag), strain: new Bed('line_strain', MIX.lineStrain) };
  private readonly res = new Vector2();

  init(): void {
    const props = fishingDeps.props!;
    this.rod = new Rod(props);
    this.scene.add(this.rod.mesh);
    this.bobber = props.makeBobber();
    this.bobber.visible = false;
    this.scene.add(this.bobber);
    const kit: Kit = { renderer: this.renderer, props };
    this.bait = new BaitRig(kit, fishingDeps.night);
    this.scene.add(this.bait.group);

    this.lineGeo = new LineGeometry();
    this.lineGeo.setPositions(this.lineBuf);
    this.lineMat = new LineMaterial({ color: 0xd8e2c4, linewidth: 1.6, worldUnits: false, transparent: true, opacity: 0.85 });
    this.line = new Line2(this.lineGeo, this.lineMat);
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.scene.add(this.line);

    this.gauge = new RodGauge();
    this.gauge.group.visible = false;
    this.scene.add(this.gauge.group);
    this.toast = new Toast();
    this.toast.panel.mesh.visible = false;
    this.scene.add(this.toast.panel.mesh);
    this.card = new CatchCard();
    this.scene.add(this.card.group);
    const sea = (x: number, z: number): number => fishingDeps.ocean!.heightAt(x, z);
    this.shark = new SharkShow(this.scene, props, sea, () => fishingDeps.fx);
    this.rod.mesh.add(this.shark.ring);
    this.party = new Celebration(this.scene, sea, () => this.renderer.xr.getSession());

    fishingView.state = () => this.state;
    fishingView.bite = () => this.bite;
    fishingView.fight = () => this.fight;
    fishingView.system = this;
    fishingView.hand = () => this.hand;
    this.lastRig.copy(this.player.position);
  }

  /* ── input ───────────────────────────────────────────────────────────── */

  private pad(h: Hand) {
    return this.input.xr.gamepads[h];
  }
  private trigger(h: Hand): number {
    return this.pad(h)?.getButtonValue(InputComponent.Trigger) ?? 0;
  }
  private squeeze(h: Hand): number {
    return this.pad(h)?.getButtonValue(InputComponent.Squeeze) ?? 0;
  }
  /** B on the right hand, Y on the left: the rod button. */
  private rodButton(h: Hand): boolean {
    return this.pad(h)?.getButtonDown(h === 'right' ? InputComponent.B_Button : InputComponent.Y_Button) ?? false;
  }
  private other(h: Hand): Hand {
    return h === 'right' ? 'left' : 'right';
  }
  private buzz(h: Hand, intensity: number, ms: number): void {
    pulseHand(this.renderer.xr.getSession() ?? undefined, h, Math.min(1, intensity), ms);
  }
  private grip(h: Hand): Object3D {
    return this.player.gripSpaces[h];
  }

  /** a bare hand's rod frame (input/hands.ts rodFrame), smoothed a touch: where the fist holds the rod */
  private readonly fistGrip = new Group();
  private readonly fistRay = new Group();
  private readonly fistRaw = { grip: new Group(), ray: new Group() };
  private fistOn = false;

  /**
   * What the rod's posed on: a controller's grip and ray, or, with a bare hand, the fist itself
   * (the hand's own ray runs from your shoulder through your hand, and has nothing to do with how
   * your fist is turned: a rod on it pointed wherever that line did).
   */
  private rodHands(dt: number): { grip: Object3D; ray: Object3D } {
    const h = this.hand;
    if (!rodFrame(h, ROD_TILT, this.fistRaw.grip, this.fistRaw.ray)) {
      this.fistOn = false;
      return { grip: this.grip(h), ray: this.player.raySpaces[h] };
    }
    // a little smoothing on the tracked joints' jitter (fast enough not to dull a cast)
    const k = this.fistOn ? 1 - Math.exp(-dt * 30) : 1;
    this.fistOn = true;
    this.fistGrip.position.lerp(this.fistRaw.grip.position, k);
    this.fistRay.position.copy(this.fistGrip.position);
    this.fistRay.quaternion.slerp(this.fistRaw.ray.quaternion, k);
    this.fistGrip.quaternion.copy(this.fistRay.quaternion);
    this.fistGrip.updateMatrixWorld(true);
    this.fistRay.updateMatrixWorld(true);
    return { grip: this.fistGrip, ray: this.fistRay };
  }

  private setState(s: RodState): void {
    this.state = s;
    this.t = 0;
    // off the hook: it's gone (a landing takes it over first)
    if (this.hooked && s !== 'fighting') this.dropHooked();
  }

  /* ── frame ───────────────────────────────────────────────────────────── */

  update(delta: number, time: number): void {
    const dt = Math.min(delta, 0.05);
    const deps = fishingDeps;
    if (!deps.state || !deps.ocean || introActive()) return;
    this.t += dt;
    void loadSamples();

    // the ear follows the head
    this.camera.getWorldPosition(_v);
    this.camera.getWorldDirection(_w);
    _x.set(0, 1, 0).applyQuaternion(this.camera.getWorldQuaternion(_q));
    setListener(_v, _w, _x);

    // first time a controller turns up, the rod is already in your right hand
    if (!this.autoEquipped && this.pad('right')) {
      this.autoEquipped = true;
      this.equip('right');
    }

    // rod button: out into this hand, away, or across to the other hand (either way it's yours to
    // say now: nothing brings it back out on its own)
    for (const h of ['left', 'right'] as const) {
      if (!this.rodButton(h) || backpackView.open) continue;
      if (this.state === 'landing') this.endLanding();
      else if (this.state === 'fighting') continue;
      else if (this.state === 'stowed') this.equip(h);
      else if (h === this.hand) {
        this.stow();
        this.toast.show(`Rod away · ${h === 'right' ? 'B' : 'Y'} or trigger for it back`, 2.2, INK.amber, true);
      } else this.equip(h);
      this.autoStowed = false;
      this.keptOut = this.state !== 'stowed' && (deps.indoors?.() ?? false);
    }

    // through a door (or with the axe or the pick out) the rod goes over your shoulder, and back
    // outside it's in your hand again. Held as a state, not caught on the way in: a rod still out
    // when a landing ends indoors goes away then, and it always comes back once you're out.
    const inside = deps.indoors?.() ?? false;
    if (!inside) this.keptOut = false;
    if (inside && !this.keptOut && this.state !== 'stowed' && this.state !== 'landing' && this.state !== 'fighting') {
      this.stow();
      this.autoStowed = true;
    } else if (!inside && this.state === 'stowed' && this.autoStowed) {
      this.autoStowed = false;
      this.equip(this.hand);
    }

    // a teleport with the line out brings it in
    const moved = this.player.position.distanceTo(this.lastRig);
    this.lastRig.copy(this.player.position);
    if (moved > FISHING.teleportReel && (this.state === 'floating' || this.state === 'flying' || this.state === 'retrieving')) {
      this.reelInNow();
    }

    // the backpack has the trigger while it's open
    const held = backpackView.open || pointerView.claimed[this.hand] ? 0 : this.trigger(this.hand);
    const down = !this.triggerHeld && held > FISHING.triggerOn;
    const up = this.triggerHeld && held < FISHING.triggerOff;
    if (down) this.triggerHeld = true;
    if (up) this.triggerHeld = false;

    this.updateCrankHand(dt);
    this.updateHold();
    const reelIn = Math.max(held > FISHING.triggerOff ? held : 0, Math.min(1.3, this.handCrankRate / FISHING.crankFull));

    switch (this.state) {
      case 'stowed':
        // outside with an empty rod hand, the trigger brings the rod back out
        if (down && !inside && backpackView.hand !== this.hand) this.equip(this.hand);
        break;
      case 'idle':
        if (down && backpackView.heavy) {
          // a great white hanging off your other hand: sell it first
          if (this.hintT <= 0) this.toast.show('Your hands are full: take the shark to the fish market', 2.4, INK.amber, true);
          this.hintT = 2;
        } else if (down) {
          this.setState('windup');
          shot('bail_click', MIX.bail, { rate: 1.08 + Math.random() * 0.06 });
        }
        break;
      case 'windup':
        if (up) this.cast();
        break;
      case 'floating':
        this.updateBite(dt);
        if (this.bite?.phase === 'take' && (down || this.yanked())) this.strike();
        else if (this.bite?.phase === 'nibble' && this.yanked() && this.hintT <= 0) {
          this.toast.show('Not yet', 1.4, INK.hot, true);
          this.hintT = 2;
        } else if (reelIn > 0.15 && this.bite?.phase !== 'take') {
          this.bite = null;
          this.setState('retrieving');
        }
        break;
      case 'retrieving':
        if (reelIn <= 0.15 && this.onWater()) {
          // let go: it sits where it is, and something may find it
          this.setState('floating');
          this.bite = { phase: 'wait', t: biteDelay(this.habitat(), hourNow(), fishingDeps.state!.gear) };
        }
        break;
      case 'fighting':
        this.updateFight(dt, reelIn);
        break;
      case 'landing': {
        // take it off the hook: grip it with your free hand (or the rod's trigger / the card timing out)
        const free = this.other(this.hand);
        const grabbed = this.squeeze(free) > 0.6 && this.landing && this.grip(free).getWorldPosition(_h).distanceTo(this.landing.mesh.position) < (this.sharkLanding ? 0.9 : 0.45);
        const lasts = this.sharkLanding ? FISHING.cardSeconds + 5 : FISHING.cardSeconds;
        if (grabbed || (this.t > (this.sharkLanding ? 3 : 1) && down) || this.t > lasts) this.endLanding(free);
        break;
      }
    }
    this.hintT -= dt;

    this.dressGear();
    this.updateRod(dt, time);
    this.updateBobber(dt, reelIn);
    this.updateShark(dt, time);
    this.updateHooked(dt, time);
    this.updateLanding(dt, time);
    this.updateLine();
    this.placeFloat(dt);
    this.updateBait(dt);
    this.updateSound(dt);
    this.updateGauge();
    this.toast.update(dt, this.camera);
    deps.wallet?.update(dt, this.camera);
    deps.fx?.update(dt);

    locomotion.enabled = this.state !== 'fighting' && this.state !== 'landing';
  }

  /* ── rod out / away ──────────────────────────────────────────────────── */

  private equip(h: Hand): void {
    if (this.state !== 'stowed' && this.state !== 'idle') this.reelInNow();
    this.hand = h;
    this.rod.resetMotion();
    this.setState('idle');
    this.rod.mesh.visible = true;
    this.bob.copy(this.rod.tip).y -= FISHING.dangle;
    this.bobVel.set(0, 0, 0);
    this.buzz(h, 0.3, 40);
    shot('bail_click', MIX.bail, { rate: 0.95 });
  }

  /** the rod went over your shoulder by itself (indoors), not by the rod button: it comes back out by itself */
  private autoStowed = false;
  /** you took it out indoors with the rod button: it stays out till you're outside again */
  private keptOut = false;

  private stow(): void {
    this.reelInNow();
    this.setState('stowed');
    this.rod.mesh.visible = false;
  }

  private reelInNow(): void {
    this.bite = null;
    this.fight = null;
    this.cranking = false;
    if (this.state !== 'stowed') this.setState('idle');
    this.bob.copy(this.rod.tip).y -= FISHING.dangle;
    this.bobVel.set(0, 0, 0);
  }

  /* ── cast ────────────────────────────────────────────────────────────── */

  private cast(): void {
    const castM = fishingDeps.state!.stats.castM;
    const vmax = FISHING.castMaxSpeed * Math.sqrt(castM / 22);
    this.rod.peakTipVelocity(_v).multiplyScalar(FISHING.castGain);
    const speed = _v.length();
    if (speed > vmax) _v.multiplyScalar(vmax / speed);
    this.castAssist(_v);
    this.bob.copy(this.rod.tip);
    this.bobVel.copy(_v);
    this.setState('flying');
    const power = Math.min(1, speed / vmax);
    this.buzz(this.hand, 0.3 + power * 0.45, 45 + power * 40);
    shot('bail_click', MIX.bail + 2, { rate: 0.92 + Math.random() * 0.06 });
    if (power > 0.15) {
      shot('rod_swish', MIX.rodSwish - (1 - power) * 9, { rate: 0.9 + power * 0.2 + Math.random() * 0.06 });
      shot('line_out', MIX.lineOut - (1 - power) * 6, { rate: 1.25 - power * 0.35 });
    }
  }

  /**
   * Cast assist: the speed and the heading are yours, the release timing is forgiven. Nearly
   * everyone lets go late in VR (the tip is already moving down), so the launch elevation is
   * pulled most of the way toward a good casting angle and never lower than a flat lob.
   */
  private castAssist(v: Vector3): void {
    const speed = v.length();
    const flat = Math.hypot(v.x, v.z);
    if (speed < 0.5 || flat < 1e-3) return;
    const elev = Math.atan2(v.y, flat);
    const want = Math.max(FISHING.castMinElev, elev + (FISHING.castElev - elev) * FISHING.castElevAssist);
    const k = (Math.cos(want) * speed) / flat;
    v.set(v.x * k, Math.sin(want) * speed, v.z * k);
  }

  /** A sharp pull back on the rod: the tip moving toward you and/or up, fast. */
  private yanked(): boolean {
    _w.copy(this.rod.tip).sub(this.bob).setY(0);
    if (_w.lengthSq() < 1e-6) return false;
    _w.normalize().add(_up).normalize();
    return this.rod.tipVel.dot(_w) > FISHING.strikeSpeed;
  }

  /* ── bites (Tidewater Game.updateBite, with haptics for the cues) ────── */

  /** metres of water under the bobber */
  private depth(): number {
    return Math.max(0, -fishingDeps.terrain!.heightAt(this.bob.x, this.bob.z));
  }

  private habitat(): Habitat {
    const L = fishingDeps.layout!;
    const b = this.bob;
    const depth = this.depth();
    const reefDist = Math.hypot(b.x - L.reef.x, b.z - L.reef.z) - L.reef.radius;
    const P = L.pier;
    const rect = (x0: number, x1: number, z0: number, z1: number): number =>
      Math.hypot(Math.max(x0 - b.x, 0, b.x - x1), Math.max(z0 - b.z, 0, b.z - z1));
    const walk = rect(P.x - P.width / 2, P.x + P.width / 2, P.zStart, P.zEnd);
    const head = rect(P.x - P.headWidth / 2, P.x + P.headWidth / 2, P.zEnd - P.headDepth, P.zEnd);
    return habitatAt({ depth, reefDist, pierDist: Math.min(walk, head) });
  }

  private onLanded(onWater: boolean): void {
    if (!onWater) {
      this.toast.show('Landed on dry ground', 1.4, INK.dim);
      this.setState('retrieving');
      return;
    }
    this.setState('floating');
    waterEntrySmall(this.bob);
    fishingDeps.fx?.splash(this.bob, 0.22);
    this.buzz(this.hand, 0.18, 35);
    this.rippleT = 1.2;
    const h = this.habitat();
    this.bite = { phase: 'wait', t: biteDelay(h, hourNow(), fishingDeps.state!.gear) };
    if (!Number.isFinite(this.bite.t)) this.toast.show('Too shallow: nothing lives here', 2, INK.dim);
  }

  private updateBite(dt: number): void {
    const b = this.bite;
    if (!b) return;
    b.t -= dt;
    if (b.phase === 'nibble') this.dip = Math.max(0, Math.sin(Math.min(1, b.pulse ?? 0) * Math.PI) * 0.45);
    else if (b.phase === 'take') this.dip += (1.4 - this.dip) * (1 - Math.exp(-dt * 14));
    else this.dip = Math.max(0, this.dip - dt * 3);
    if (b.phase === 'nibble') b.pulse = (b.pulse ?? 0) + dt * 3.2;
    if (b.phase === 'take') {
      // the rod buzzes hard for as long as it's under
      this.hapticT -= dt;
      if (this.hapticT <= 0) {
        this.hapticT = 0.22;
        this.buzz(this.hand, 0.85, 160);
      }
    }
    if (b.t > 0) return;
    if (b.phase === 'wait') {
      // the rig: what the trophy fish look at (fishing/trophyFish.ts), and the bait on the hook (fishing/favouriteBait.ts)
      const st = fishingDeps.state!;
      const gear = st.gear;
      const species = pickSpecies(this.habitat(), hourNow(), Math.random, { depth: this.depth(), gear, log: st.log, bait: gear.bait });
      if (!species) {
        b.t = 8;
        return;
      }
      b.species = species;
      b.kg = rollWeight(species);
      b.phase = 'nibble';
      b.nibbles = 1 + Math.floor(Math.random() * 3);
      b.t = 0.7 + Math.random() * 0.8;
      b.pulse = 0;
      this.buzz(this.hand, 0.22, 45);
      fishingDeps.fx?.ripple(this.bob, 0.55, 0, 1.0);
    } else if (b.phase === 'nibble') {
      b.nibbles = (b.nibbles ?? 1) - 1;
      b.pulse = 0;
      if (b.nibbles > 0) {
        b.t = 0.6 + Math.random() * 1.0;
        this.buzz(this.hand, 0.22, 45);
        fishingDeps.fx?.ripple(this.bob, 0.55, 0, 1.0);
      } else {
        b.phase = 'take';
        // big, strong fish give a (slightly) shorter window; sharper hooks a longer one
        b.t = (2.4 - FISH[b.species!].fight * 0.5) * (fishingDeps.state!.stats.strikeMul ?? 1);
        this.hapticT = 0;
        surfaceThrash(this.bob, 0.35);
        fishingDeps.fx?.splash(this.bob, 0.35);
      }
    } else {
      this.toast.show('It took the bait and ran', 1.8, INK.dim);
      this.bite = { phase: 'wait', t: biteDelay(this.habitat(), hourNow(), fishingDeps.state!.gear) };
    }
  }

  private strike(): void {
    const b = this.bite!;
    const g = fishingDeps.state!.stats;
    const shark = b.species === SHARK_ID;
    this.fight = shark
      ? Object.assign(new SharkFight(b.kg!, Math.max(3, this.lineOut)), { reelSpeed: g.reelSpeed })
      : new FishFight({ species: b.species!, kg: b.kg!, lineKg: g.lineKg, reelSpeed: g.reelSpeed, distance: Math.max(3, this.lineOut) });
    this.bite = null;
    this.fishPos.copy(this.bob);
    this.floatAlong = 0;
    this.lastDist = this.fight.distance;
    this.setState('fighting');
    if (!shark) this.hookFish(b.species!, b.kg!);
    if (shark) {
      this.shark.len = fishLengthCm(SHARK_ID, b.kg!) / 100;
      this.shark.hook(this.bob, this.rod.tip);
      this.toast.show('Something HUGE has it…', 2.6, INK.danger);
      this.buzz(this.hand, 1, 400);
      this.buzz(this.other(this.hand), 0.6, 300);
    } else this.toast.show('Fish on!', 1.2, INK.amber, true);
    this.buzz(this.hand, 1, 220);
  }

  /* ── the fight (Tidewater Game.updateFight + FishingRod's fish motion) ── */

  private updateFight(dt: number, reelIn: number): void {
    const f = this.fight!;
    const base = fishingDeps.state!.stats.reelSpeed;
    const reeling = reelIn > 0.15;
    f.reelSpeed = base * Math.min(1.25, Math.max(0.4, 0.4 + 0.8 * reelIn));
    const shark = f instanceof SharkFight ? f : null;
    const st = shark ? shark.update(dt, reeling, this.holding) : f.update(dt, reeling);
    if (shark) this.sharkBeats(shark, dt);

    // line speed → the crank (unless your hand is on it) and the drag slipping
    const dOut = f.distance - this.lastDist;
    this.lastDist = f.distance;
    if (!this.cranking && dOut < 0) this.rod.turnCrank(-dOut / LINE_PER_CRANK, dt);
    this.rod.payOut(Math.min(dOut, 0.5), dt);
    const rateT = dOut < 0 ? Math.min(1.6, -dOut / dt / LINE_PER_CRANK) : 0;
    this.rod.crankRate += (Math.max(rateT, this.cranking ? this.handCrankRate : 0) - this.rod.crankRate) * (1 - Math.exp(-dt * 10));
    this.dragSpeed = dOut > 0 ? dOut / dt : 0;

    // the fish thrashes at the surface as each run starts (the shark breaches instead)
    if (!shark && f.surge > 0.6 && !this.splashed) {
      const strength = Math.min(1, 0.3 + f.kg / 8);
      surfaceThrash(this.bob, strength);
      fishingDeps.fx?.splash(this.bob, 0.35 + strength * 0.6);
      this.buzz(this.hand, 1, 260);
    }
    this.splashed = f.surge > 0.6 ? true : f.surge < 0.3 ? false : this.splashed;

    // the pull, in your hand
    this.hapticT -= dt;
    if (!shark && this.hapticT <= 0) {
      this.hapticT = 0.1;
      const k = f.tension > 1 ? 1 : 0.06 + 0.55 * Math.min(1, f.tension) + 0.2 * f.surge;
      this.buzz(this.hand, k, 110);
    }

    if (st === 'fighting') return;
    this.fight = null;
    this.dip = 0;
    this.dragSpeed = 0;
    const name = FISH[f.species].name;
    if (shark) {
      if (st === 'caught') this.landShark(f.kg);
      else {
        this.shark.stop();
        this.toast.show(st === 'snapped' ? 'SNAP! Never reel against its run' : 'It took all your line, and was gone', 3, INK.danger);
        if (st === 'snapped') shot('line_snap', MIX.lineSnap, { rate: 0.9 });
        this.buzz(this.hand, 1, 120);
        this.reelInNow();
      }
      return;
    }
    if (st === 'caught') {
      const state = fishingDeps.state!;
      const wasUnlocked = sharkUnlocked(state.log, FISH_IDS);
      this.caughtId = keepMarkings(state, state.addFish(f.species, f.kg, hourNow()), this.hooked?.seed);
      waterExitFish(this.bob, f.kg);
      fishingDeps.fx?.splash(this.bob, 0.7 + Math.min(1, f.kg / 8) * 0.6);
      shot('fish_flop', MIX.fishFlop, { rate: 0.9 + Math.random() * 0.2, delay: 0.35 });
      this.buzz(this.hand, 1, 240);
      const info = state.lastCatch;
      window.setTimeout(() => catchSting(!!info && (info.newSpecies || info.record)), 450);
      this.startLanding(f.species, f.kg);
      // that was the last page but one: the great white is out there now
      if (!wasUnlocked && sharkUnlocked(state.log, FISH_IDS))
        window.setTimeout(() => this.toast.show('The book is full… but something huge is circling in the deep past the drop-off', 6, INK.danger), 3500);
    } else if (st === 'snapped') {
      this.toast.show('Snap! The line broke', 2.4, INK.danger);
      shot('line_snap', MIX.lineSnap, { rate: 0.95 + Math.random() * 0.1 });
      this.buzz(this.hand, 1, 80);
      this.reelInNow();
    } else {
      this.toast.show(f instanceof FishFight && f.spooled ? `The ${name.toLowerCase()} took all your line` : `The ${name.toLowerCase()} threw the hook`, 2, INK.dim);
      this.setState(this.lineOut > 3 ? 'retrieving' : 'idle');
    }
  }
  private dragSpeed = 0;
  /** the save entry of the fish on the line, handed to the backpack when the card goes */
  private caughtId: number | null = null;
  private rippleT = 0;

  /** Your other hand on the reel's handle: grip near it, then wind it round. */
  private updateCrankHand(dt: number): void {
    const off = this.other(this.hand);
    const g = this.grip(off);
    g.getWorldPosition(_h);
    const canCrank = this.state !== 'stowed' && this.state !== 'landing' && backpackView.hand !== off;
    const near = this.rod.crankCentre(_v).distanceTo(_h) < FISHING.crankReach;
    const holding = this.squeeze(off) > 0.5;
    if (!this.cranking && canCrank && holding && near) {
      this.cranking = true;
      this.crankA = this.rod.crankAngleOf(_h);
      this.buzz(off, 0.3, 30);
    } else if (this.cranking && (!holding || !canCrank || this.rod.crankCentre(_v).distanceTo(_h) > FISHING.crankReach * 2)) {
      this.cranking = false;
    }
    let rate = 0;
    if (this.cranking) {
      const a = this.rod.crankAngleOf(_h);
      let da = a - this.crankA;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      this.crankA = a;
      // anti-reverse: the handle only turns forward
      if (da > 0) {
        const turns = da / (Math.PI * 2);
        this.rod.turnCrank(turns, dt);
        rate = turns / Math.max(dt, 1e-3);
        this.crankTick += turns * 4;
        if (this.crankTick >= 1) {
          this.crankTick -= 1;
          this.buzz(off, 0.12, 18);
        }
      }
    }
    this.handCrankRate += (rate - this.handCrankRate) * (1 - Math.exp(-dt * 8));
    if (!this.cranking) this.handCrankRate *= Math.exp(-dt * 10);
  }

  /* ── the great white ─────────────────────────────────────────────────── */

  /**
   * Your other hand on the rod's rear grip (just below your rod hand), gripping: that's what holds
   * a shark's run. It only counts while the run wants it, and it takes the hand off the crank.
   */
  private updateHold(): void {
    const f = this.fight;
    const want = this.state === 'fighting' && f instanceof SharkFight && (f.phase === 'warn' || f.phase === 'run');
    if (!want) {
      this.holding = false;
      return;
    }
    const off = this.other(this.hand);
    const hand = this.grip(off).getWorldPosition(_h);
    const grip = _v.set(0, GRIP_Y, 0).applyMatrix4(this.rod.mesh.matrix);
    const d = grip.distanceTo(hand);
    const was = this.holding;
    this.holding = this.squeeze(off) > 0.5 && d < (was ? 0.2 : 0.16) && d < this.rod.crankCentre(_w).distanceTo(hand) + 0.05;
    if (this.holding) {
      this.cranking = false;
      this.handCrankRate = 0;
      if (!was) this.buzz(off, 0.8, 60);
    }
  }

  /** The shark's moments: the turn, the breach, a run held or lost, beaten. And the haptics. */
  private sharkBeats(f: SharkFight, dt: number): void {
    const off = this.other(this.hand);
    for (const e of f.events.splice(0)) {
      // one word, on the first run only: after that the ring, the gauge and the buzz say it
      if (e === 'warn') {
        if (f.broken === 0 && !this.sharkTold) this.toast.show('HE’S RUNNING! Hold the rod BELOW your hand with your other hand', 2.8, INK.danger);
        this.sharkTold = true;
        this.buzz(off, 0.7, 120);
      } else if (e === 'breach') {
        this.shark.breach();
        this.buzz(this.hand, 1, 300);
        this.buzz(off, 1, 300);
      } else if (e === 'broken') {
        catchSting(false);
      } else if (e === 'beaten') {
        catchSting(true);
      }
    }
    // the fight in both hands: the run through the rod, the grip in the other
    this.holdBuzzT -= dt;
    if (this.holdBuzzT > 0) return;
    this.holdBuzzT = 0.1;
    if (f.phase === 'run') {
      this.buzz(this.hand, 1, 110);
      if (this.holding) this.buzz(off, 0.85, 110);
    } else if (f.phase === 'warn') {
      this.buzz(this.hand, 0.7, 90);
      // a tap in the free hand: here, now
      if (Math.floor(f.t * 5) % 2 === 0) this.buzz(off, 0.45, 50);
    } else {
      this.buzz(this.hand, 0.1 + 0.5 * Math.min(1, f.tension), 100);
    }
  }

  /**
   * Beaten: into the log and up out of the sea, to hang off your rod tip like any catch, under a
   * GREAT WHITE! banner. It's too big for any backpack: grip it and you carry it by the tail, all
   * the way to the fish market's scale (village/market.ts), where it's sold.
   */
  private landShark(kg: number): void {
    const state = fishingDeps.state!;
    this.caughtId = keepMarkings(state, state.addFish(SHARK_ID, kg, hourNow()), this.shark.seed);
    this.sharkLanding = true;
    this.shark.stop();
    waterExitFish(this.bob, 400);
    fishingDeps.fx?.splash(this.bob, 1.4);
    this.buzz(this.hand, 1, 400);
    this.buzz(this.other(this.hand), 1, 400);
    catchSting(true);
    bigWinHit();
    window.setTimeout(() => winFanfare(40), 350);
    this.startLanding(SHARK_ID, kg, this.shark.seed);
    const at = this.rod.tip.clone();
    this.party.win({ at: at.clone().add(new Vector3(0, 0.4, 0)), tier: 3, banner: 'GREAT WHITE!', bannerAt: at.clone().add(new Vector3(0, 1.4, 0)), quiet: true, scale: 2, coins: false });
    this.toast.show('Landed! Too big for your backpack: grab it and carry it to the fish market', 5, INK.amber);
  }

  private updateShark(dt: number, time: number): void {
    const f = this.fight;
    this.party.update(dt, this.camera);
    if (this.shark.active) this.shark.update(dt, time, this.bob, this.rod.tip);
    const show = this.state === 'fighting' && f instanceof SharkFight && (f.phase === 'warn' || f.phase === 'run');
    this.shark.updateRing(show, this.holding, f instanceof SharkFight ? f.holdProgress : 0, time);
  }

  /* ── landing ─────────────────────────────────────────────────────────── */

  /** The fish on the line from the strike: in the water at the end of it, fighting. */
  private hookFish(species: string, kg: number): void {
    const { mesh, uniforms, seed } = fishingDeps.props!.makeFish(species);
    const len = fishLengthCm(species, kg) / 100;
    mesh.scale.setScalar(len);
    mesh.rotation.order = 'YXZ';
    this.scene.add(mesh);
    _v.copy(this.rod.tip).sub(this.bob);
    // struck, it turns away from you
    this.hooked = { mesh, u: uniforms, seed, len, yaw: Math.atan2(-_v.x, -_v.z), run: 1, slip: 0 };
  }

  private dropHooked(): void {
    const H = this.hooked;
    if (!H) return;
    this.scene.remove(H.mesh);
    (H.mesh.material as { dispose(): void }).dispose();
    this.hooked = null;
  }

  /** The hooked fish: its mouth on the hook, its head toward you as you reel it in, away as it runs. */
  private updateHooked(dt: number, time: number): void {
    const H = this.hooked;
    const f = this.fight;
    if (!H || !f || this.state !== 'fighting') return;
    // it turns to run on a real run (a surge, or taking line for a moment), not every time you
    // ease off the reel, and keeps running till the surge is spent: no flipping back and forth
    H.slip = this.dragSpeed > 0.05 ? H.slip + dt : 0;
    const running = f.surge > 0.5 || H.slip > 0.5 || (H.run > 0.5 && f.surge > 0.2);
    H.run += ((running ? 1 : 0) - H.run) * (1 - Math.exp(-dt * 3));
    _v.copy(this.rod.tip).sub(this.bob);
    let want = Math.atan2(_v.x, _v.z);
    if (running) want += Math.PI + Math.sin(this.wander * 2) * 0.4;
    const d = Math.atan2(Math.sin(want - H.yaw), Math.cos(want - H.yaw));
    H.yaw += d * (1 - Math.exp(-dt * (running ? 3 : 2)));
    // rolling onto its flank as it fights, and back
    H.mesh.rotation.set(0, H.yaw, Math.sin(this.wander * 2.3) * 0.35 * f.surge);
    H.mesh.position.set(this.bob.x - Math.sin(H.yaw) * H.len * 0.5, this.bob.y, this.bob.z - Math.cos(H.yaw) * H.len * 0.5);
    swim(H.u, 0.07 + 0.11 * f.surge + 0.04 * H.run, 2.4 + 3.2 * f.surge + 0.8 * H.run, dt);
    H.u.uTime.value = time;
  }

  /**
   * While a fish is on, the float rides the line just up from the hook: where the line comes up out
   * of the water, or FISHING.floatUp up it if that's further (a fish that's out of the water, or
   * gone down deeper, has it on the line over it, dragged under). Never further up the line than
   * that: it's fixed on the line, so it can't go off along it toward you. It eases along the line
   * to where it's going, so a fish breaking the surface doesn't flick it up the line.
   */
  private placeFloat(dt: number): void {
    if (this.state !== 'fighting' || !this.hooked) return;
    const ocean = fishingDeps.ocean!;
    const B = this.lineBuf;
    const n = B.length / 3 - 1;
    // how far up the line it goes to: out of the water, or floatUp
    const inSea = this.bob.y < ocean.heightAt(this.bob.x, this.bob.z);
    let want: number = FISHING.floatUp;
    let along = 0;
    let wet = B[n * 3 + 1] - ocean.heightAt(B[n * 3], B[n * 3 + 2]);
    for (let i = n; i > 0 && inSea && along < want; i--) {
      const o = (i - 1) * 3;
      const seg = Math.hypot(B[o] - B[i * 3], B[o + 1] - B[i * 3 + 1], B[o + 2] - B[i * 3 + 2]);
      const next = B[o + 1] - ocean.heightAt(B[o], B[o + 2]);
      if (wet < -0.01 && next >= -0.01) want = Math.min(want, along + (seg * (-0.01 - wet)) / (next - wet));
      along += seg;
      wet = next;
    }
    this.floatAlong += (want - this.floatAlong) * (1 - Math.exp(-dt * 8));
    // and that far up the line from the fish
    along = 0;
    for (let i = n; i > 0; i--) {
      const o = (i - 1) * 3;
      const seg = Math.hypot(B[o] - B[i * 3], B[o + 1] - B[i * 3 + 1], B[o + 2] - B[i * 3 + 2]);
      if (along + seg >= this.floatAlong || i === 1) {
        const t = seg > 1e-6 ? Math.min(1, Math.max(0, (this.floatAlong - along) / seg)) : 0;
        const x = B[i * 3] + (B[o] - B[i * 3]) * t;
        const y = B[i * 3 + 1] + (B[o + 1] - B[i * 3 + 1]) * t;
        const z = B[i * 3 + 2] + (B[o + 2] - B[i * 3 + 2]) * t;
        const w = ocean.heightAt(x, z);
        this.bobber.position.set(x, Math.max(y, Math.min(w, y + 0.02)), z);
        return;
      }
      along += seg;
    }
  }
  /** how far up the line from the hook the float is while a fish is on (placeFloat) */
  private floatAlong = 0;

  private startLanding(species: string, kg: number, seed?: number): void {
    // the fish that's been on the line (a fresh one if there wasn't: the shark's is its own, drawn
    // again with its markings)
    let H = this.hooked;
    this.hooked = null;
    if (!H) {
      const { mesh, uniforms, seed: drawn } = fishingDeps.props!.makeFish(species, seed);
      // (the great white hangs smaller than life, or it'd stand on the deck over the rod tip)
      const len = Math.min(species === SHARK_ID ? SHARK_HANG : Infinity, (fishingDeps.state!.lastCatch?.cm ?? 30) / 100);
      mesh.scale.setScalar(len);
      mesh.rotation.order = 'YXZ';
      this.scene.add(mesh);
      H = { mesh, u: uniforms, seed: drawn, len, yaw: 0, run: 0, slip: 0 };
    }
    const { mesh, u: uniforms, len } = H;
    // under the pier, it's drawn out past the deck's edge through the water before it comes up
    const S = fishingDeps.surfaces;
    let out: Vector3 | null = null;
    if (S?.lineUnder(this.rod.tip, this.bob, _edgeTop, _edgeUnder, this.edgeHeld)) {
      _x.set(_edgeUnder.x - this.bob.x, 0, _edgeUnder.z - this.bob.z);
      const d = _x.length();
      out = new Vector3(_edgeUnder.x, this.bob.y, _edgeUnder.z);
      if (d > 1e-3) out.addScaledVector(_x, (0.25 + len * 0.5) / d);
    }
    const start = out ?? this.bob;
    // Lifted out, not flung: up out of the water first, then in to hang under the tip (a curve
    // through a point over where it came out). That point's only as high as it must be for the
    // fish to clear what's between (the sand up a beach, the pier's edge and rail), and never
    // more than 0.6 m over where it ends up.
    const hang = _v.copy(this.rod.tip);
    hang.y -= FISHING.landLine;
    let rise = Math.max(start.y + 0.25, Math.min(hang.y, start.y + 1.2));
    const cap = Math.max(rise, hang.y + 0.6);
    for (; S && rise < cap; rise += 0.1) {
      let clear = true;
      for (let i = 1; i < 16 && clear; i++) {
        bezier(start, rise, hang, i / 16, _x);
        if (_x.y < S.topAt(_x.x, _x.z) + len + 0.15) clear = false;
      }
      if (clear) break;
    }
    const span = Math.hypot(hang.x - start.x, hang.z - start.z);
    const time = Math.min(1.8, Math.max(0.7, 0.55 + Math.abs(hang.y - start.y) * 0.15 + span * 0.1));
    this.landing = {
      species,
      kg,
      mesh,
      u: uniforms,
      len,
      from: this.bob.clone(),
      rise: Math.min(rise, cap),
      time,
      yaw: H.yaw,
      out,
      pre: out ? 0.45 : 0,
      face: H.yaw,
      fit: 0,
      fitFor: 0,
      next: 0.15,
      twist: 0,
    };
    this.setState('landing');
    this.bobVel.set(0, 0, 0);
    const info = fishingDeps.state!.lastCatch;
    if (info) this.card.show(info);
  }

  private updateLanding(dt: number, time: number): void {
    const L = this.landing;
    if (!L || this.state !== 'landing') return;
    // (out from under the pier first,) lifted out and in, then it hangs and swings off the tip on
    // a short line
    const k = Math.min(1, Math.max(0, this.t - L.pre) / L.time);
    const e = k * k * (3 - 2 * k);
    const hang = _v.copy(this.rod.tip);
    hang.y -= FISHING.landLine;
    if (L.out && this.t < L.pre) {
      const p = this.t / L.pre;
      this.bob.lerpVectors(L.from, L.out, p * (2 - p));
      this.bobVel.set(0, 0, 0);
    } else if (k < 1) {
      bezier(L.out ?? L.from, L.rise, hang, e, this.bob);
      this.bobVel.set(0, 0, 0);
    } else {
      this.dangle(this.bob, this.bobVel, this.rod.tip, FISHING.landLine, dt);
    }
    // it comes up out of the water head first (level to head-up over the first part of the lift)
    const up = L.out && this.t < L.pre ? 0 : Math.min(1, k / 0.45);
    const pitch = (Math.PI / 2) * up * up * (3 - 2 * up);
    // and hangs from the hook as far as it's tipped up: never down in the sand, or through a deck
    // it's come up over (one it's still under, coming out from under the pier, it stays under)
    const deck = fishingDeps.surfaces?.deckOver(this.bob.x, this.bob.z) ?? -Infinity;
    const tr = fishingDeps.terrain;
    const reach = Math.cos(pitch) * L.len;
    const ground = tr ? Math.max(tr.heightAt(this.bob.x, this.bob.z), tr.heightAt(this.bob.x - Math.sin(L.yaw) * reach, this.bob.z - Math.cos(L.yaw) * reach)) : -Infinity;
    const floor = Math.max(ground, this.bob.y > deck - 0.5 ? deck : -Infinity) + Math.max(L.len * 0.12, Math.sin(pitch) * L.len) + 0.06;
    if (this.bob.y < floor) {
      this.bob.y = floor;
      if (this.bobVel.y < 0) this.bobVel.y = 0;
    }
    // then hangs head-up by the mouth, thrashing in fits: a hard burst of tail beats that twists
    // it round and swings it on the line, then it hangs, gills going, till the next. The fits come
    // weaker and further apart as it tires.
    const tired = Math.min(1, this.t / 9);
    const vigour = 1 - 0.75 * tired;
    L.next -= dt;
    L.fitFor -= dt;
    if (L.next <= 0) {
      L.fitFor = (0.45 + Math.random() * 0.5) * (1 - 0.4 * tired);
      L.next = L.fitFor + (0.6 + Math.random() * 1.1) * (1 + 2 * tired);
      const side = Math.random() < 0.5 ? -1 : 1;
      L.twist = side * (0.35 + Math.random() * 0.45) * vigour;
      if (k >= 1) {
        // it throws itself sideways (to you, it's across the line) and swings on it
        this.camera.getWorldPosition(_w);
        _x.copy(_w).sub(this.bob).setY(0).normalize();
        this.bobVel.x += -_x.z * side * (0.35 + Math.random() * 0.35) * vigour;
        this.bobVel.z += _x.x * side * (0.35 + Math.random() * 0.35) * vigour;
      }
      if (Math.random() < 0.4 + 0.6 * vigour) shot('fish_flop', MIX.fishFlop - 4 - 5 * tired, { rate: 0.9 + Math.random() * 0.2 });
    }
    const inFit = L.fitFor > 0;
    if (!inFit) L.twist *= Math.exp(-dt * 1.5);
    // quick into a fit, easing out of it
    L.fit += ((inFit ? 1 : 0) - L.fit) * (1 - Math.exp(-dt * (inFit ? 12 : 4)));
    // turning to show you its flank, slowly both ways, as the lift brings it up; always turning
    // from where it is the short way round, never spinning about
    this.camera.getWorldPosition(_w);
    const hangYaw = Math.atan2(_w.x - this.bob.x, _w.z - this.bob.z) + Math.PI / 2 + Math.sin(this.t * 0.7) * 0.6 + L.twist;
    L.face += Math.atan2(Math.sin(hangYaw - L.face), Math.cos(hangYaw - L.face)) * (1 - Math.exp(-dt * 6 * Math.min(1, k * 1.2)));
    const yaw = L.face;
    L.mesh.rotation.set(-pitch, yaw, 0);
    L.mesh.position.set(
      this.bob.x - Math.sin(yaw) * Math.cos(pitch) * L.len * 0.5,
      this.bob.y - Math.sin(pitch) * L.len * 0.5,
      this.bob.z - Math.cos(yaw) * Math.cos(pitch) * L.len * 0.5,
    );
    const fit = L.fit * vigour;
    swim(L.u, 0.03 + 0.14 * fit, 1.3 + 3.4 * fit, dt);
    L.u.uTime.value = time;
    // water streams off it, then drips, then stops
    const wet = 30 * Math.exp(-this.t * 0.55);
    if (fishingDeps.fx && Math.random() < wet * dt * 4) {
      _v.copy(L.mesh.position);
      _v.y -= L.len * (0.1 + Math.random() * 0.4);
      fishingDeps.fx.drip(_v, 1 + Math.floor(Math.random() * 2), L.len * 0.25);
    }

    // the card beside it, toward your right, facing you
    _x.copy(_w).sub(this.bob).setY(0).normalize();
    this.card.group.position.copy(this.bob).addScaledVector(_h.set(-_x.z, 0, _x.x), -0.32);
    this.card.group.position.y = this.bob.y - L.len * 0.35;
    this.card.group.lookAt(_w);
  }

  private endLanding(into: Hand | null = null): void {
    this.sharkLanding = false;
    const L = this.landing;
    if (L) {
      this.scene.remove(L.mesh);
      (L.mesh.material as { dispose(): void }).dispose();
    }
    this.landing = null;
    this.card.hide();
    if (this.state === 'landing') this.reelInNow();
    // off the hook and into your free hand; A brings up the backpack to put it away
    if (this.caughtId !== null) {
      const id = this.caughtId;
      this.caughtId = null;
      backpackView.takeInHand?.(id, into ?? this.other(this.hand));
    }
  }

  /* ── rod, bobber, line ───────────────────────────────────────────────── */

  /** The rod, the line and what's on the hook, as you fish with them (the shops' upgrades, your picks). */
  private dressGear(): void {
    const u = fishingDeps.state!.gear;
    this.rod.dress({ rod: u.rod | 0, reel: u.reel | 0, line: u.line | 0 });
    this.bait.setGear(u.bait | 0, u.hooks | 0);
    const line = Math.max(0, Math.min(LINE.length - 1, u.line | 0));
    if (line !== this.lineLevel) {
      this.lineLevel = line;
      this.lineMat.color.set(LINE[line]);
      this.bait.setLineColour(LINE[line]);
    }
  }
  private lineLevel = -1;

  /** The bait under the float, gone while a fish has it. */
  private updateBait(dt: number): void {
    const show = this.bobber.visible && this.state !== 'fighting' && this.state !== 'landing';
    const s = this.bobber.scale.x;
    const a = this.baitAnchor.copy(this.bobber.position);
    a.y -= BOBBER_R * s;
    const terrain = fishingDeps.terrain!;
    const ocean = fishingDeps.ocean!;
    const S = fishingDeps.surfaces;
    // the sea bed or the sand under it, or the boards when the float's been let down on a deck
    const floor = (x: number, z: number): number => {
      const g = terrain.heightAt(x, z);
      const area = S?.areaNear(x, z, a.y);
      return area?.kind === 'deck' ? area.y : g;
    };
    this.bait.update(dt, show, a, s, floor, (x, z) => ocean.heightAt(x, z));
  }

  private updateRod(dt: number, time: number): void {
    if (this.state === 'stowed') {
      this.rod.mesh.visible = false;
      return;
    }
    this.rod.mesh.visible = true;
    const f = this.fight;
    let bendT = 0.012;
    let loadT = 0.15;
    let towards: Vector3 | null = null;
    switch (this.state) {
      case 'fighting':
        if (f) {
          bendT = 0.06 + 0.3 * Math.min(f.tension, 1.1) + 0.05 * f.surge;
          loadT = Math.min(1, f.tension * 1.1);
          // a shark's run bows it into the cork
          if (f instanceof SharkFight && f.phase === 'run') ((bendT += 0.14), (loadT = 1));
        }
        towards = this.bob;
        break;
      case 'retrieving':
        bendT = 0.035;
        towards = this.bob;
        break;
      case 'windup':
        bendT = 0.02;
        break;
      case 'floating':
        bendT = 0.012 + this.dip * 0.07;
        towards = this.bob;
        break;
      case 'landing':
        bendT = 0.1 + (this.landing ? Math.min(0.12, this.landing.kg * 0.02) : 0);
        loadT = 0.5;
        break;
      case 'flying':
        towards = this.bob;
        break;
    }
    const bailOpen = this.state === 'windup' || this.state === 'flying';
    this.rod.lineFill = 1 - Math.min(1, this.lineOut / 220) * 0.5;
    const held = this.rodHands(dt);
    this.rod.update(dt, time, held.grip, held.ray, { bendT, loadT, towards, bailOpen, rig: this.player });
    // the cast running line off the spool
    if (this.state === 'flying') this.rod.payOut(this.lineOut - this.castOut, dt, true);
    this.castOut = this.lineOut;
    if (this.state !== 'fighting') {
      const rateT = this.state === 'retrieving' ? Math.min(1.6, this.retrieveSpeed / LINE_PER_CRANK) : 0;
      if (!this.cranking && rateT > 0) this.rod.turnCrank(rateT * dt, dt);
      this.rod.crankRate += (Math.max(rateT, this.cranking ? this.handCrankRate : 0) - this.rod.crankRate) * (1 - Math.exp(-dt * 10));
    }
  }
  private retrieveSpeed = 0;
  /** the line out at the last frame, for what the cast has run off since */
  private castOut = 0;

  /** The bobber is sitting ON the sea (not on a deck or the sand above it). */
  private onWater(): boolean {
    const b = this.bob;
    return fishingDeps.terrain!.heightAt(b.x, b.z) < -0.05 && b.y < fishingDeps.ocean!.heightAt(b.x, b.z) + 0.3;
  }

  /** A weight on a short line under an anchor: gravity, a little air drag, the line's length. */
  private dangle(p: Vector3, v: Vector3, anchor: Vector3, len: number, dt: number): void {
    const n = 2;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      v.y -= 9.81 * h;
      v.multiplyScalar(Math.exp(-h * 1.1));
      p.addScaledVector(v, h);
      _x.copy(p).sub(anchor);
      const d = _x.length();
      if (d > len) {
        _x.divideScalar(d);
        p.copy(anchor).addScaledVector(_x, len);
        const vr = v.dot(_x);
        if (vr > 0) v.addScaledVector(_x, -vr);
      }
    }
  }

  private updateBobber(dt: number, reelIn: number): void {
    const ocean = fishingDeps.ocean!;
    const terrain = fishingDeps.terrain!;
    const tip = this.rod.tip;
    this.retrieveSpeed = 0;
    switch (this.state) {
      case 'idle':
      case 'windup': {
        this.dangle(this.bob, this.bobVel, tip, FISHING.dangle, dt);
        // it comes down on the boards (or the sand) under your feet, not through them: with the
        // tip pushed down through the deck it lies on it, rather than hanging under the pier (where
        // the line would go out over the rail to it, as to a fish under there)
        const S = fishingDeps.surfaces;
        if (S) {
          const area = S.areaNear(this.bob.x, this.bob.z, this.player.position.y);
          const floor = (area.kind === 'water' ? ocean.heightAt(this.bob.x, this.bob.z) : area.y) + BOBBER_R;
          if (this.bob.y < floor) {
            this.bob.y = floor;
            if (this.bobVel.y < 0) this.bobVel.y = 0;
          }
        }
        break;
      }
      case 'flying': {
        // ballistic with a little drag, capped by the rod's casting range (Tidewater)
        const prevY = this.bob.y;
        this.bobVel.y -= 9.81 * dt;
        this.bobVel.multiplyScalar(Math.exp(-dt * 0.25));
        this.bob.addScaledVector(this.bobVel, dt);
        const range = Math.hypot(this.bob.x - tip.x, this.bob.z - tip.z);
        if (range > fishingDeps.state!.stats.castM) {
          this.bobVel.x *= 0.5;
          this.bobVel.z *= 0.5;
        }
        const water = ocean.heightAt(this.bob.x, this.bob.z);
        const ground = terrain.heightAt(this.bob.x, this.bob.z);
        const deck = fishingDeps.surfaces?.catchArc(this.bob.x, this.bob.y, this.bob.z, prevY, this.bobVel.y < 0);
        const onDeck = deck?.kind === 'deck';
        if (onDeck || this.bob.y <= Math.max(water, ground)) {
          const wet = !onDeck && water > ground + 0.05;
          this.bob.y = onDeck ? deck!.y : Math.max(water, ground);
          this.bobVel.set(0, 0, 0);
          this.onLanded(wet);
        }
        break;
      }
      case 'floating': {
        this.rippleT -= dt;
        if (this.rippleT <= 0) {
          this.rippleT = 1.6 + Math.random() * 1.2;
          fishingDeps.fx?.ripple(this.bob, 0.35, 0, 1.6);
        }
        const bob = Math.sin(this.t * 2.1) * 0.008;
        const yT = ocean.heightAt(this.bob.x, this.bob.z) + 0.012 + bob - this.dip * 0.09;
        this.bob.y += (yT - this.bob.y) * (1 - Math.exp(-dt * 12));
        break;
      }
      case 'retrieving': {
        // an empty line skims back as you reel
        _v.copy(tip).sub(this.bob).setY(0);
        const d = _v.length();
        const speed = (3 + fishingDeps.state!.stats.reelSpeed * 3) * Math.min(1, reelIn);
        this.retrieveSpeed = speed;
        const step = Math.min(d, speed * dt);
        if (d > 1e-3) this.bob.addScaledVector(_v.multiplyScalar(1 / d), step);
        const ground = terrain.heightAt(this.bob.x, this.bob.z);
        const surf = Math.max(ocean.heightAt(this.bob.x, this.bob.z) + 0.02, ground);
        this.bob.y += (surf - this.bob.y) * (1 - Math.exp(-dt * 10));
        if (d < 2.2) {
          if (this.onWater()) {
            waterExitSmall(this.bob);
            fishingDeps.fx?.splash(this.bob, 0.1, false);
            fishingDeps.fx?.ripple(this.bob, 0.7, 0, 1.2);
          }
          this.setState('idle');
          this.bobVel.set(0, 0, 0);
        }
        break;
      }
      case 'fighting': {
        const f = this.fight;
        if (!f) break;
        // the fish runs about at the fight's distance, the bobber dragged under near it
        this.wander += dt * (0.4 + f.surge * 1.5);
        _v.copy(this.fishPos).sub(tip).setY(0);
        // (hooked straight under the tip, off the pier: it runs out the way you're facing)
        if (_v.lengthSq() < 0.25) _v.copy(tip).sub(this.camera.getWorldPosition(_w)).setY(0);
        const d0 = _v.length() || 1;
        _v.multiplyScalar(1 / d0);
        const side = _x.set(-_v.z, 0, _v.x).multiplyScalar(Math.sin(this.wander) * 0.9 * dt * (1 + f.surge));
        const dist = Math.max(1, f.distance);
        this.fishPos.set(tip.x + _v.x * dist, 0, tip.z + _v.z * dist).add(side);
        const k = 1 - Math.exp(-dt * 6);
        this.bob.x += (this.fishPos.x - this.bob.x) * k;
        this.bob.z += (this.fishPos.z - this.bob.z) * k;
        const water = ocean.heightAt(this.bob.x, this.bob.z);
        // just under the surface where you can see it, breaking it as each run starts and once
        // it's reeled in close; in the shallows or pulled up the beach it lies on the sand (under
        // its whole length), never in it
        const H = this.hooked;
        const len = H?.len ?? 0.3;
        const close = Math.min(1, Math.max(0, (6 - f.distance) / 4));
        const under = water - (0.03 + len * 0.08) * (1 - Math.min(1, f.surge * 1.4 + close));
        // (the sand under its head, middle and tail: it's dragged up the slope, so it can't lag)
        const sx = Math.sin(H?.yaw ?? 0) * len;
        const sz = Math.cos(H?.yaw ?? 0) * len;
        const sand = Math.max(terrain.heightAt(this.bob.x, this.bob.z), terrain.heightAt(this.bob.x - sx * 0.5, this.bob.z - sz * 0.5), terrain.heightAt(this.bob.x - sx, this.bob.z - sz)) + len * 0.12 + 0.02;
        this.bob.y += (Math.max(under, sand) - this.bob.y) * (1 - Math.exp(-dt * 8));
        if (this.bob.y < sand) this.bob.y = sand;
        break;
      }
    }
    const out = this.state !== 'stowed';
    this.lineOut = out ? tip.distanceTo(this.bob) : 0;
    this.bobber.visible = out && this.state !== 'landing';
    this.bobber.position.copy(this.bob);
    // a real float is a few pixels at casting range: grow it with distance so it stays readable
    this.camera.getWorldPosition(_w);
    this.bobber.scale.setScalar(Math.max(1, this.bob.distanceTo(_w) / 7));
    this.bobber.rotation.set(this.dip * 0.4, 0, 0);
  }

  private updateLine(): void {
    const show = this.state !== 'stowed';
    this.line.visible = show;
    if (!show) {
      this.edgeHeld = null;
      return;
    }
    const a = this.rod.tip;
    const b = this.bob;
    const f = this.fight;
    const taut = this.state === 'fighting' ? Math.min(1, (f ? f.tension : 0) * 1.5) : this.state === 'retrieving' ? 0.6 : 0;
    const slack = this.state === 'idle' || this.state === 'windup' || this.state === 'landing' ? 0 : 1;
    const sag = (this.lineOut * (this.state === 'flying' ? 0.03 : 0.07) * (1 - taut) + 0.02) * slack;
    // It lies over whatever's between the tip and the fish (a rail, a post, the deck's edge, the
    // sand), rather than through it: pulled taut over all of it, from corner to corner. A fish
    // that's gone in under the pier has the line down outside the posts and in under the beams to
    // it, as a real line bends round the timber. The same in flight: a cast coming down past the
    // rail pulls the line over it, not through it. Swung against a lamp post from the side, it
    // goes round it instead, and stays round it till it's swung back clear.
    const pts = this.linePts;
    pts.length = 0;
    pts.push(a);
    const S = fishingDeps.surfaces;
    if (S) {
      const W = (this.wraps ??= new LineWraps(S));
      const dangling = this.state === 'idle' || this.state === 'windup';
      if (dangling) W.reset();
      let end: Vector3 = b;
      // (a float dangling off the tip is never a fish under the pier)
      if (!dangling && S.lineUnder(a, b, _edgeTop, _edgeUnder, this.edgeHeld)) {
        end = _edgeTop;
        (this.edgeHeld ??= new Vector3()).copy(_edgeTop);
      } else this.edgeHeld = null;
      const m = W.lay(a, end);
      for (let k = 0; k <= m; k++) {
        for (let j = 0; j < W.restCounts[k]; j++) pts.push(W.rests[k][j]);
        if (k < m) for (let j = 0; j < W.counts[k]; j++) pts.push(W.bends[k][j]);
      }
      if (end !== b) pts.push(_edgeTop, _edgeUnder);
    }
    pts.push(b);
    // the points shared out over the spans by their length (each span at least one); a line
    // straight to the float or the fish droops (no further than onto what it passes over), one
    // that rests on something on its way the fish holds taut (drooping, it would come up to where
    // it rests from under it, through the timber)
    const spans = pts.length - 1;
    // It comes down to a float or a fish in the sea, not down under it and back up: sagging into
    // the water past it, a long line came up out of it metres short of the fish, and the float
    // (placeFloat) went there.
    const ocean = fishingDeps.ocean!;
    const droop = b.y < ocean.heightAt(b.x, b.z) + 0.05 ? Math.min(sag, Math.max(0, (a.y - b.y) / 2)) : sag;
    let total = 0;
    for (let k = 1; k <= spans; k++) total += dist(pts[k], pts[k - 1]);
    let left = LINE_N;
    let o = 0;
    this.lineBuf[o++] = a.x;
    this.lineBuf[o++] = a.y;
    this.lineBuf[o++] = a.z;
    for (let k = 1; k <= spans; k++) {
      const p = pts[k - 1];
      const q = pts[k];
      const len = dist(p, q);
      const n = k === spans ? left : Math.max(1, Math.min(left - (spans - k), Math.round((LINE_N * len) / Math.max(total, 1e-6))));
      left -= n;
      _v.set((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2);
      if (spans === 1) _v.y -= S ? S.lineDroop(p, q, droop, this.wraps?.skip) : droop;
      for (let j = 1; j <= n; j++) {
        const t = j / n;
        const u = 1 - t;
        this.lineBuf[o++] = u * u * p.x + 2 * u * t * _v.x + t * t * q.x;
        this.lineBuf[o++] = u * u * p.y + 2 * u * t * _v.y + t * t * q.y;
        this.lineBuf[o++] = u * u * p.z + 2 * u * t * _v.z + t * t * q.z;
      }
    }
    this.lineGeo.setPositions(this.lineBuf);
    // screen-space width needs the eye buffer's size (it differs in and out of the headset)
    const xr = this.renderer.xr;
    if (xr.isPresenting) {
      const vp = (xr.getCamera().cameras[0] as unknown as { viewport?: { z: number; w: number } }).viewport;
      if (vp) this.res.set(vp.z, vp.w);
    } else this.renderer.getDrawingBufferSize(this.res);
    this.lineMat.resolution.copy(this.res);
  }

  private updateSound(dt: number): void {
    const crank = this.state === 'stowed' ? 0 : this.rod.crankRate;
    this.beds.wind.set(smooth(0.05, 0.35, crank) * (0.8 + 0.2 * Math.min(1, crank)), Math.min(1.3, Math.max(0.45, crank / 1.4)));
    this.beds.drag.set(this.state === 'fighting' ? smooth(0.05, 0.7, this.dragSpeed) : 0, Math.min(1.25, Math.max(0.7, 0.7 + this.dragSpeed * 0.25)));
    const strain = this.fight ? smooth(0.7, 1.0, this.fight.tension) : 0;
    this.beds.strain.set(strain, 0.9 + 0.2 * strain);
    void dt;
  }

  private updateGauge(): void {
    const show = this.state !== 'stowed';
    this.gauge.group.visible = show;
    if (!show) return;
    // clamped to the blank just ahead of the fore grip, riding its bend, facing up at you
    this.gauge.place(this.rod.mesh.matrix, this.rod.blankOffset(CLAMP_Y, _gaugeBend));
    const s = fishingDeps.state!;
    const f = this.fight;
    const b = this.bite;
    let label = 'READY';
    let colour: string = INK.hot;
    switch (this.state) {
      case 'idle':
        label = 'READY TO CAST';
        colour = INK.dim;
        break;
      case 'windup':
        label = 'SWING & LET GO';
        colour = INK.amber;
        break;
      case 'flying':
        label = '…';
        break;
      case 'floating':
        if (b?.phase === 'take') {
          label = 'STRIKE!';
          colour = INK.danger;
        } else if (b?.phase === 'nibble') {
          label = 'NIBBLING…';
          colour = INK.amber;
        } else {
          label = 'WAITING';
          colour = INK.dim;
        }
        break;
      case 'retrieving':
        label = 'REELING IN';
        break;
      case 'fighting':
        if (f instanceof SharkFight && (f.phase === 'warn' || f.phase === 'run')) {
          label = this.holding ? `HOLD ON!  ${Math.round(f.holdProgress * 100)}%` : 'GRAB THE ROD!';
          colour = this.holding ? INK.good : INK.danger;
        } else if (f instanceof SharkFight && f.phase === 'beaten') {
          label = 'REEL IT IN!';
          colour = INK.good;
        } else if (f && f.tension > f.band[1]) {
          label = 'EASE OFF!';
          colour = INK.danger;
        } else {
          label = 'REEL!';
          colour = INK.good;
        }
        break;
      case 'landing':
        label = 'LANDED';
        colour = INK.amber;
        break;
    }
    const size = GRID_SIZES[Math.max(0, Math.min(GRID_SIZES.length - 1, s.upgrades.hold | 0))];
    const bag = fill(s.inventory as unknown as Piece[], size[0], size[1]);
    this.gauge.paint({
      label,
      labelColour: colour,
      tension: f ? f.tension : null,
      band: f ? f.band : [0.3, 0.85],
      lineOut: this.lineOut,
      holdKg: bag.used,
      holdMax: bag.total,
    });
  }
}

const _gaugeBend = new Vector3();
