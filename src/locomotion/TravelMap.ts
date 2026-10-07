/**
 * THE TRAVEL MAP: how you get about the island. There's no other way: no arc, no stepping, no
 * sliding. You call up the map, point at where you want to be, and you're there, standing exactly
 * where the thing you came for is in reach, looking at it.
 *
 *  OPEN IT      Push either thumbstick forward (where the old teleport's arc used to be), or, with
 *               your bare hands, reach up, pinch the air and pull down, like pulling down a blind.
 *               A paper chart on two wooden rollers unrolls in front of you, chest height, and
 *               stays put there, world-locked, so it holds still while you point at it.
 *  ITS SHEETS   Four tabs along its top: ISLAND (the whole island, for exploring), BAY (the shore,
 *               the pier's end, every building once), VILLAGE (every building in plan: point at one
 *               to go in, or to open its floor plan where there's more than one thing inside), PIER
 *               (the pier close up, a spot every few metres down both rails and all round the head).
 *               Opened inside a building, it opens on that room's plan.
 *  POINT        With a controller, its ray; with a hand, your index finger right on the paper. The
 *               nearest spot under it lights up (locomotion/spots.ts: the rails, the beach, each
 *               table, slot, counter and window, each tree and rock and camp), its name along the
 *               bottom, a dotted line runs to it from YOU, and the octagon marker glows on the
 *               island where you'll stand. Anywhere else on dry land is a free point (the island's
 *               there to be explored).
 *  GO           Pull the trigger (or press your fingertip into the paper). The map snaps, a blink,
 *               and you're there. Mid-fight, landing a fish or up the helter skelter, it says why
 *               not instead.
 *  PUT IT AWAY  Push the stick forward again, pull it down again, or point at the ✕.
 *
 * The map is an `InteractivePanel` (ui/pointer.ts), so a ray on it claims that hand's trigger and
 * the rod never casts while you're choosing where to go.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import {
  BufferAttribute,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Plane,
  Quaternion,
  Ray,
  Vector3,
} from 'three';
import type { ChartSource } from '../backpack/chart.ts';
import { flame } from '../backpack/chart.ts';
import { mapGo, mapRollUp, mapTab, mapUnroll, uiDeny, uiHover } from '../audio/sfx.ts';
import { introActive } from '../experience/introGate.ts';
import { pulseHand } from '../input/haptics.ts';
import { hands } from '../input/hands.ts';
import { font, onFontsReady } from '../ui/fonts.ts';
import { InteractivePanel, pointerView, register } from '../ui/pointer.ts';
import { turned } from '../village/craft.ts';
import { hasInterior } from '../village/interiors.ts';
import { WALK_W, WALKS } from '../woodworks/gates.ts';
import { ROCK_SITES } from '../mining/sites.ts';
import { OCTAGON_VERTICES, TELEPORT_COLOURS } from './config.ts';
import { TeleportMarker } from './marker.ts';
import { MAP_M, MAP_PX, roundRect, Sheets, VIEW, type Sheet, type SheetId } from './mapSheets.ts';
import { freePoint, inBuilding, progressSpots, ROCK_SEEN_R, staticSpots, type Spot, type SpotProgress, type SpotWorld } from './spots.ts';

type Hand = 'left' | 'right';
const HANDS: Hand[] = ['left', 'right'];

/** What the map needs from the game, set once the island's loaded (main.ts). */
export const travelMapDeps: {
  world: SpotWorld | null;
  chart: ChartSource | null;
  /** how far along you are (what's opened up) */
  progress: (() => SpotProgress) | null;
  /** take me there */
  go: ((s: Spot) => void) | null;
  /** why you can't go anywhere just now (mid-fight, up the tower), or null */
  blocked: (() => string | null) | null;
  /** something else has your hands (the backpack's open): the map stays shut */
  busy: (() => boolean) | null;
} = { world: null, chart: null, progress: null, go: null, blocked: null, busy: null };

/** Anyone can ask: is the map out? (And the dev harness can work it: `__fish.map`.) */
export const travelMapView: {
  open: boolean;
  sheet: SheetId;
  system?: TravelMap;
} = { open: false, sheet: 'bay' };

/** What's under your pointer on the map. */
type Target =
  | { kind: 'tab'; id: SheetId }
  | { kind: 'close' }
  | { kind: 'back' }
  | { kind: 'spot'; spot: Spot }
  | { kind: 'room'; name: string; title: string }
  | { kind: 'free'; spot: Spot };

const key = (t: Target | null): string => {
  if (!t) return '';
  if (t.kind === 'tab') return `tab:${t.id}`;
  if (t.kind === 'spot') return `spot:${t.spot.id}`;
  if (t.kind === 'room') return `room:${t.name}`;
  if (t.kind === 'free') return `free:${Math.round(t.spot.x * 2)},${Math.round(t.spot.z * 2)}`;
  return t.kind;
};

/** the tabs along the top: their sheet, name and box (map px) */
const TABS: { id: SheetId; text: string; x: number; w: number }[] = [
  { id: 'island', text: 'ISLAND', x: 24, w: 196 },
  { id: 'bay', text: 'BAY', x: 232, w: 196 },
  { id: 'village', text: 'VILLAGE', x: 440, w: 196 },
  { id: 'pier', text: 'PIER', x: 648, w: 196 },
];
const TAB_Y = 18;
const TAB_H = 62;
const CLOSE = { x: 1218, y: 49, r: 30 };
const BACK = { x: 16, y: 14, w: 196, h: 50 };
const FOOT_Y = VIEW.y + VIEW.h + 8;

/** a spot snaps to the pointer within this of it (sheet px); a room's spots are bigger */
const SNAP = 38;
const SNAP_ROOM = 90;
/** the current spot holds against a new one till that's this much nearer (px): no flicker between neighbours */
const STICK = 8;

/** how the map sits: out in front of you, below eye level, facing you */
const READ_OUT = 0.46;
const READ_DOWN = 0.2;
/** unroll / roll-up times (s) */
const OPEN_T = 0.42;
const CLOSE_T = 0.22;
/** walk this far from it, or turn your back on it, and it rolls itself up */
const LEAVE_R = 1.4;

/** colours of the marks by what they are */
const MARK: Record<Spot['kind'], { fill: string; rim: string; r: number }> = {
  fish: { fill: '#1f8f8a', rim: '#f2e6cc', r: 9 },
  place: { fill: '#7a5230', rim: '#f2e6cc', r: 8 },
  station: { fill: '#9a2a1a', rim: '#f2e6cc', r: 10 },
  wood: { fill: '#3d7a2e', rim: '#f2e6cc', r: 8 },
  rock: { fill: '#7a3fb0', rim: '#f2e6cc', r: 9 },
  camp: { fill: '#d2461c', rim: '#7a1e0c', r: 9 },
  sight: { fill: '#f4c542', rim: '#7a5a12', r: 11 },
  build: { fill: '#b8862a', rim: '#3a2610', r: 9 },
};

/** pinch: thumb and index tips this close (m) to close it, this far to let go */
const PINCH_ON = 0.02;
const PINCH_OFF = 0.035;
/** the pull-down: start above your eyes less this (m), within this of your head, and pull down this far */
const PULL_ABOVE = -0.12;
const PULL_NEAR = 0.8;
const PULL_DROP = 0.16;
/** a fingertip: hovering within this in front of the paper (m); pressed this far through it */
const POKE_HOVER = 0.035;
const POKE_PRESS = 0.004;
const POKE_REARM = 0.02;

const _v = new Vector3();
const _w = new Vector3();
const _q = new Quaternion();
const _m = new Matrix4();
const _head = new Vector3();
const _plane = new Plane();
const _ray = new Ray();
const _hit = new Vector3();
const _n = new Vector3();

const easeOutBack = (t: number): number => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

export class TravelMap extends createSystem({}) {
  private sheets: Sheets | null = null;
  private panel!: InteractivePanel;
  private group!: Group;
  private back!: Mesh;
  private rollers: Group[] = [];
  private marker!: TeleportMarker;

  private phase: 'closed' | 'opening' | 'open' | 'closing' = 'closed';
  private t = 0;
  private openFrom = new Vector3();
  private openTo = new Vector3();
  private sheetId: SheetId = 'bay';
  /** the last chart tab you used (a room's plan isn't remembered) */
  private lastTab: SheetId = 'bay';

  private fixed: Spot[] | null = null;
  private later: Spot[] = [];
  private laterKey = '';
  private progress: SpotProgress | null = null;

  private hover: Target | null = null;
  private hoverAt: [number, number] | null = null;
  private hoverBy: Hand | null = null;
  private lastPick: [number, number] = [-1e9, -1e9];
  private flashText = '';
  private flashT = 0;
  private dirty = true;

  private readonly stickArmed: Record<Hand, boolean> = { left: true, right: true };
  private readonly pinch: Record<Hand, { on: boolean; from: Vector3 | null }> = { left: { on: false, from: null }, right: { on: false, from: null } };
  private readonly poke: Record<Hand, { armed: boolean; inFront: boolean }> = { left: { armed: true, inFront: false }, right: { armed: true, inFront: false } };

  private seen = new Set<string>();
  private seenT = 0;

  init(): void {
    travelMapView.system = this;
    try {
      const raw = localStorage.getItem('handfish.rocksSeen');
      if (raw) for (const id of JSON.parse(raw) as string[]) this.seen.add(id);
    } catch {
      /* no storage: you'll see them again */
    }

    this.group = new Group();
    this.group.visible = false;
    this.scene.add(this.group);

    // the paper: the map's face (a pointer panel), and its plain back
    this.panel = new InteractivePanel(MAP_PX, MAP_M);
    this.panel.buttons = [{ id: 'map', x: 0, y: 0, w: MAP_PX[0], h: MAP_PX[1] }];
    this.panel.paint = () => {};
    this.panel.onClick = (_id, hand) => this.select(hand);
    const mat = this.panel.mesh.material as MeshBasicMaterial;
    mat.transparent = false;
    mat.depthWrite = true;
    this.group.add(this.panel.mesh);
    register(this.panel);
    this.back = new Mesh(new PlaneGeometry(MAP_M[0], MAP_M[1]), new MeshStandardMaterial({ color: 0xd9c49a, roughness: 0.95 }));
    this.back.rotation.y = Math.PI;
    this.back.position.z = -0.0015;
    this.group.add(this.back);

    // the rollers: turned wood, a brass knob at each end
    const wood = new MeshStandardMaterial({ color: 0x6e4424, roughness: 0.55 });
    const brass = new MeshStandardMaterial({ color: 0xc9a04a, roughness: 0.28, metalness: 0.85 });
    const len = MAP_M[0] + 0.024;
    const rod = new CylinderGeometry(0.011, 0.011, len, 20, 1);
    rod.rotateZ(Math.PI / 2);
    const knob = turned([[0, 0], [0.009, 0.001], [0.014, 0.006], [0.016, 0.012], [0.013, 0.018], [0.006, 0.022], [0, 0.023]], 18);
    for (let i = 0; i < 2; i++) {
      const g = new Group();
      g.add(new Mesh(rod, wood));
      for (const side of [-1, 1]) {
        const k = new Mesh(knob, brass);
        k.rotation.z = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        k.position.x = (side * len) / 2;
        g.add(k);
      }
      g.position.z = 0.004;
      this.rollers.push(g);
      this.group.add(g);
    }
    this.unroll(1);

    this.marker = new TeleportMarker(OCTAGON_VERTICES, TELEPORT_COLOURS);
    this.scene.add(this.marker.group);

    // the sheets are drawn in the house face once it's in (a sheet drawn first in the fallback
    // would keep it): the bay and the pier now, the rest the first time they're wanted
    onFontsReady(() => {
      const c = travelMapDeps.chart;
      const w = travelMapDeps.world;
      if (!c || !w || this.sheets) return;
      this.sheets = new Sheets(c, w.buildings);
      this.sheets.warm(['bay', 'pier']);
    });
  }

  /* ── open, close ─────────────────────────────────────────────────────── */

  /** Unroll the map in front of you (from `from`, a hand's position, if given). */
  openMap(hand: Hand | null, from?: Vector3): void {
    if (this.phase === 'open' || this.phase === 'opening') return;
    const deps = travelMapDeps;
    if (!deps.world || !deps.chart) return;
    if (deps.busy?.()) {
      uiDeny();
      return;
    }
    this.sheets ??= new Sheets(deps.chart, deps.world.buildings);
    this.fixed ??= staticSpots(deps.world);
    this.refreshLater();
    // inside a room with things to stand at, its plan; otherwise the sheet you last had out
    this.player.head.getWorldPosition(_head);
    const room = deps.world.buildings.find((b) => hasInterior(b.name) && inBuilding(b, _head.x, _head.z, -0.1));
    const inRoom = room && this.roomSpots(room.name).length > 1;
    this.setSheet(inRoom ? (`room:${room.name}` as SheetId) : this.lastTab, false);

    // where it'll hang: in front of you, below your eyes, turned to face you
    this.player.head.getWorldQuaternion(_q);
    _w.set(0, 0, -1).applyQuaternion(_q).setY(0);
    if (_w.lengthSq() < 1e-6) _w.set(0, 0, -1);
    _w.normalize();
    this.clearSpot(_head, _w, this.openTo);
    if (from) this.openFrom.copy(from);
    else if (hand) this.player.gripSpaces[hand].getWorldPosition(this.openFrom);
    else this.openFrom.copy(this.openTo);
    this.group.position.copy(this.openFrom);
    this.group.lookAt(_head);
    this.group.visible = true;
    this.phase = 'opening';
    this.t = 0;
    this.hover = null;
    this.dirty = true;
    travelMapView.open = true;
    mapUnroll();
    if (hand) pulseHand(this.renderer.xr.getSession() ?? undefined, hand, 0.35, 40);
  }

  /** Roll it up (`now`: just gone, as when you travel: the blink covers it). */
  closeMap(now = false): void {
    if (this.phase === 'closed' || this.phase === 'closing') return;
    this.marker.hide();
    this.hover = null;
    this.pinned = null;
    travelMapView.open = false;
    if (now) {
      this.phase = 'closed';
      this.group.visible = false;
      return;
    }
    this.phase = 'closing';
    this.t = 0;
    mapRollUp();
  }

  /**
   * Where the map hangs: READ_OUT in front of you, unless something solid's in the way (at a slot
   * machine, a counter, a rail): then a little closer, or turned a little to one side, wherever the
   * whole sheet's in clear air. (Drawn in front of everything instead, it would hide your own hand
   * as you reached to touch it.)
   */
  private clearSpot(head: Vector3, fwd: Vector3, out: Vector3): void {
    const S = travelMapDeps.world!.surfaces;
    // (what's lower than the sheet's bottom edge isn't in its way: a pier rail, a table)
    const bottom = head.y - READ_DOWN - MAP_M[1] / 2;
    const half = (MAP_M[0] / 2) * 1.05;
    for (const dist of [READ_OUT, 0.4, 0.34, 0.28])
      for (const turn of [0, -0.4, 0.4, -0.75, 0.75]) {
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        const fx = fwd.x * c - fwd.z * s;
        const fz = fwd.x * s + fwd.z * c;
        const cx = head.x + fx * dist;
        const cz = head.z + fz * dist;
        // the sheet's middle and both its edges, each seen from your eyes
        const clear = [0, -1, 1].every((k) => !S.crossesWall(head.x, head.z, cx - fz * half * k, cz + fx * half * k, bottom));
        if (!clear) continue;
        out.set(cx, head.y - READ_DOWN, cz);
        return;
      }
    out.set(head.x + fwd.x * 0.28, head.y - READ_DOWN, head.z + fwd.z * 0.28);
  }

  private toggle(hand: Hand | null, from?: Vector3): void {
    if (this.phase === 'open' || this.phase === 'opening') this.closeMap();
    else this.openMap(hand, from);
  }

  /** The paper unrolled to `k` (0 rolled up, 1 open): the rollers apart, the picture revealed from the middle. */
  private unroll(k: number): void {
    const h = MAP_M[1] * Math.max(0.002, k);
    const g = this.panel.mesh.geometry;
    const pos = g.attributes.position as BufferAttribute;
    const uv = g.attributes.uv as BufferAttribute;
    // PlaneGeometry's corners: top-left, top-right, bottom-left, bottom-right
    for (let i = 0; i < 4; i++) {
      const top = i < 2;
      pos.setY(i, top ? h / 2 : -h / 2);
      uv.setY(i, top ? 0.5 + k / 2 : 0.5 - k / 2);
    }
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    this.back.scale.y = Math.max(0.002, k);
    this.rollers[0].position.y = h / 2 + 0.008;
    this.rollers[1].position.y = -h / 2 - 0.008;
  }

  /* ── the frame ───────────────────────────────────────────────────────── */

  update(delta: number): void {
    const dt = Math.min(delta, 0.05);
    this.marker.update(dt);
    if (introActive()) {
      if (this.phase !== 'closed') this.closeMap(true);
      return;
    }
    this.watchRocks(dt);
    if (travelMapDeps.busy?.() && this.phase !== 'closed') this.closeMap();

    // calling it up (or putting it away): the stick forward, or a hand's pull-down
    this.sticks();
    this.pulls();

    if (this.phase === 'opening') {
      this.t += dt / OPEN_T;
      const k = Math.min(1, this.t);
      this.group.position.lerpVectors(this.openFrom, this.openTo, easeOutCubic(k));
      this.player.head.getWorldPosition(_head);
      this.group.lookAt(_head);
      this.group.scale.setScalar(0.55 + 0.45 * easeOutCubic(k));
      this.unroll(Math.min(1.04, easeOutBack(k)));
      if (k >= 1) {
        this.unroll(1);
        this.phase = 'open';
      }
    } else if (this.phase === 'closing') {
      this.t += dt / CLOSE_T;
      const k = Math.min(1, this.t);
      this.unroll(1 - easeOutCubic(k));
      this.group.scale.setScalar(1 - 0.35 * k);
      if (k >= 1) {
        this.phase = 'closed';
        this.group.visible = false;
      }
    }
    if (this.phase !== 'open') {
      if (this.phase === 'opening' && this.dirty) this.paint();
      return;
    }

    // walked off from it, or turned your back on it: it rolls itself up
    this.player.head.getWorldPosition(_head);
    this.player.head.getWorldQuaternion(_q);
    _w.set(0, 0, -1).applyQuaternion(_q);
    _v.copy(this.group.position).sub(_head);
    if (_v.length() > LEAVE_R || _v.normalize().dot(_w) < -0.2) {
      this.closeMap();
      return;
    }

    // what you're pointing at: a fingertip on the paper first, then a controller's ray
    let at: [number, number] | null = null;
    let by: Hand | null = null;
    for (const h of HANDS) {
      const p = this.pokeAt(h);
      if (p) {
        at = p;
        by = h;
        break;
      }
    }
    if (!at && this.pinned) at = this.pinned;
    if (!at)
      for (const h of ['right', 'left'] as const) {
        if (pointerView.over[h] !== this.panel) continue;
        at = this.rayAt(h);
        if (at) {
          by = h;
          break;
        }
      }
    this.hoverAt = at;
    this.hoverBy = by;
    const was = key(this.hover);
    if (!at) this.hover = null;
    else if (Math.hypot(at[0] - this.lastPick[0], at[1] - this.lastPick[1]) > 2 || !this.hover) {
      this.lastPick = at;
      this.hover = this.pick(at[0], at[1]);
    }
    if (key(this.hover) !== was) {
      this.dirty = true;
      if (this.hover) {
        uiHover();
        if (by) pulseHand(this.renderer.xr.getSession() ?? undefined, by, 0.12, 14);
      }
      this.showMarker();
    } else if (this.hover && at) {
      // the tooltip follows the pointer, but only repaints when it's moved a little
      this.dirty ||= Math.hypot(at[0] - (this.drawnAt?.[0] ?? -1e9), at[1] - (this.drawnAt?.[1] ?? -1e9)) > 14;
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.dirty = true;
    }
    if (this.pressBy) {
      const h = this.pressBy;
      this.pressBy = null;
      this.select(h, true);
    }
    if (this.dirty && this.phase === 'open') this.paint();
  }

  /** (dev) a pointer held at map px, for the harness */
  pinned: [number, number] | null = null;

  /** a fingertip pressed into the paper this frame */
  private pressBy: Hand | null = null;

  /** Push a thumbstick forward, let it come back: the map out, or away. */
  private sticks(): void {
    for (const h of HANDS) {
      const a = this.input.xr.gamepads[h]?.getAxesValues(InputComponent.Thumbstick);
      if (!a) continue;
      const m = Math.hypot(a.x, a.y);
      if (m < 0.3) {
        this.stickArmed[h] = true;
        continue;
      }
      if (!this.stickArmed[h]) continue;
      if (a.y <= -0.6 && Math.abs(a.y) > Math.abs(a.x) * 1.4) {
        this.stickArmed[h] = false;
        this.toggle(h);
      }
    }
  }

  /** Is this hand a tracked hand (not a controller), its joints read this frame? */
  private isHand(h: Hand): boolean {
    return hands[h].fresh;
  }

  /** A tracked hand's thumb or index tip, in the world (input/hands.ts). */
  private joint(h: Hand, name: 'thumb-tip' | 'index-finger-tip', out: Vector3): Vector3 | null {
    const s = hands[h];
    if (!s.fresh) return null;
    return out.copy(name === 'thumb-tip' ? s.thumbTip : s.indexTip);
  }

  /** Bare hands: pinch above your eyes and pull down, and the map comes down with your hand. */
  private pulls(): void {
    for (const h of HANDS) {
      const st = this.pinch[h];
      const thumb = this.joint(h, 'thumb-tip', _v);
      const index = thumb ? this.joint(h, 'index-finger-tip', _w) : null;
      if (!thumb || !index) {
        st.on = false;
        st.from = null;
        continue;
      }
      const d = thumb.distanceTo(index);
      const mid = _hit.copy(thumb).add(index).multiplyScalar(0.5);
      if (!st.on && d < PINCH_ON) {
        st.on = true;
        this.player.head.getWorldPosition(_head);
        const near = Math.hypot(mid.x - _head.x, mid.z - _head.z) < PULL_NEAR;
        st.from = near && mid.y > _head.y + PULL_ABOVE ? mid.clone() : null;
      } else if (st.on && d > PINCH_OFF) {
        st.on = false;
        st.from = null;
      }
      if (st.on && st.from && st.from.y - mid.y > PULL_DROP) {
        st.from = null;
        this.toggle(h, mid.clone());
      }
    }
  }

  /** A bare index fingertip on the map's face: where it's touching (map px), and a press is a pick. */
  private pokeAt(h: Hand): [number, number] | null {
    const st = this.poke[h];
    const tip = this.joint(h, 'index-finger-tip', _v);
    if (!tip) {
      st.armed = true;
      st.inFront = false;
      return null;
    }
    const local = this.panel.mesh.worldToLocal(tip.clone());
    const u = (local.x / MAP_M[0] + 0.5) * MAP_PX[0];
    const v = (0.5 - local.y / MAP_M[1]) * MAP_PX[1];
    const over = u >= 0 && u <= MAP_PX[0] && v >= 0 && v <= MAP_PX[1];
    // (its local z is how far in front of the paper the fingertip is: toward you is +z)
    const depth = local.z / this.group.scale.x;
    if (!over || depth > POKE_HOVER || depth < -0.05) {
      if (depth > POKE_REARM || !over) st.armed = true;
      st.inFront = false;
      return null;
    }
    if (depth > POKE_REARM) st.armed = true;
    if (depth > 0) st.inFront = true;
    if (st.armed && st.inFront && depth < -POKE_PRESS) {
      st.armed = false;
      // the pick is what's under the finger as it goes in (chosen once this frame's hover is)
      this.pressBy = h;
    }
    return [u, v];
  }

  /** A controller's ray on the map: where it's pointing (map px). */
  private rayAt(h: Hand): [number, number] | null {
    const rs = this.player.raySpaces[h];
    rs.getWorldPosition(_v);
    rs.getWorldQuaternion(_q);
    _w.set(0, 0, -1).applyQuaternion(_q);
    _ray.set(_v, _w);
    const mesh = this.panel.mesh;
    mesh.updateMatrixWorld();
    _n.set(0, 0, 1).transformDirection(mesh.matrixWorld);
    _plane.setFromNormalAndCoplanarPoint(_n, mesh.getWorldPosition(_hit));
    if (!_ray.intersectPlane(_plane, _hit)) return null;
    _m.copy(mesh.matrixWorld).invert();
    const local = _hit.applyMatrix4(_m);
    const u = (local.x / MAP_M[0] + 0.5) * MAP_PX[0];
    const v = (0.5 - local.y / MAP_M[1]) * MAP_PX[1];
    if (u < 0 || u > MAP_PX[0] || v < 0 || v > MAP_PX[1]) return null;
    return [u, v];
  }

  /* ── what's where ───────────────────────────────────────────────────── */

  private sheet(): Sheet {
    return this.sheets!.get(this.sheetId);
  }

  private setSheet(id: SheetId, sound = true): void {
    if (id !== this.sheetId && sound) mapTab();
    this.sheetId = id;
    travelMapView.sheet = id;
    if (!id.startsWith('room:')) this.lastTab = id;
    this.hover = null;
    this.lastPick = [-1e9, -1e9];
    this.dirty = true;
    this.marker.hide();
  }

  /** The spots that come with progress, worked out again only when something's changed. */
  private refreshLater(): void {
    const deps = travelMapDeps;
    if (!deps.progress || !deps.world) return;
    const p = deps.progress();
    const seen = new Set([...p.rocksSeen, ...this.seen]);
    const k = JSON.stringify([p.walks, p.skelterGate, p.statue, [...p.campsFound].sort(), p.campMap, p.pick, [...p.rocksMined].sort(), [...seen].sort()]);
    this.progress = { ...p, rocksSeen: seen };
    if (k === this.laterKey) return;
    this.laterKey = k;
    this.later = progressSpots(deps.world, this.progress);
  }

  private all(): Spot[] {
    return [...(this.fixed ?? []), ...this.later];
  }

  /** A room's spots (its stations, and its door). */
  private roomSpots(name: string): Spot[] {
    return this.all().filter((s) => s.building === name && (s.kind === 'station' || s.kind === 'place'));
  }

  /** The spots marked on this sheet. */
  private spotsOn(sheet: Sheet): Spot[] {
    if (sheet.building) return this.roomSpots(sheet.building.name);
    const tab = sheet.id as Spot['tabs'][number];
    // on the village sheet a walk-in building is one target (it opens its plan), not its spots
    return this.all().filter((s) => s.tabs.includes(tab) && !(tab === 'village' && s.building && hasInterior(s.building)));
  }

  /** What's at (u, v) on the map. */
  private pick(u: number, v: number): Target | null {
    if (v < VIEW.y) {
      if (Math.hypot(u - CLOSE.x, v - CLOSE.y) < CLOSE.r + 10) return { kind: 'close' };
      for (const t of TABS) if (u >= t.x && u <= t.x + t.w && v >= TAB_Y - 8 && v <= TAB_Y + TAB_H + 8) return { kind: 'tab', id: t.id };
      return null;
    }
    if (v > VIEW.y + VIEW.h || u < VIEW.x || u > VIEW.x + VIEW.w) return null;
    const sheet = this.sheet();
    const su = u - VIEW.x;
    const sv = v - VIEW.y;
    if (sheet.building && su >= BACK.x && su <= BACK.x + BACK.w && sv >= BACK.y && sv <= BACK.y + BACK.h) return { kind: 'back' };
    // the nearest spot within reach (the one you're on holds till another's clearly nearer)
    const snap = sheet.building ? SNAP_ROOM : SNAP;
    let best: Spot | null = null;
    let bestD = snap;
    let holdD = Infinity;
    for (const s of this.spotsOn(sheet)) {
      const [x, y] = sheet.toPx(s.x, s.z);
      const d = Math.hypot(x - su, y - sv);
      if (this.hover?.kind === 'spot' && this.hover.spot.id === s.id) holdD = d;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (this.hover?.kind === 'spot' && holdD < snap + STICK && holdD < bestD + STICK) return this.hover;
    if (best) return { kind: 'spot', spot: best };
    const deps = travelMapDeps;
    const w = deps.world!;
    const [x, z] = sheet.toWorld(su, sv);
    // the village: a walk-in building opens its plan (or, with one thing in it, takes you there)
    if (sheet.id === 'village' || sheet.id === 'bay') {
      const margin = sheet.id === 'village' ? 1.2 : 2.5;
      const b = w.buildings.find((k) => hasInterior(k.name) && inBuilding(k, x, z, margin));
      if (b) {
        const spots = this.roomSpots(b.name);
        if (sheet.id === 'village' && spots.length > 1) return { kind: 'room', name: b.name, title: spots[0].label.split(' · ')[0] };
        const first = spots.find((s) => s.tabs.includes('bay')) ?? spots[0];
        if (first) return { kind: 'spot', spot: first };
      }
    }
    if (sheet.building) return null;
    this.player.head.getWorldPosition(_head);
    const free = freePoint(w, x, z, [_head.x, _head.z]);
    return free ? { kind: 'free', spot: free } : null;
  }

  /** The octagon on the island where the spot under your pointer will put you. */
  private showMarker(): void {
    const t = this.hover;
    if (!t || (t.kind !== 'spot' && t.kind !== 'free')) {
      this.marker.hide();
      return;
    }
    const s = t.spot;
    const g = this.marker.group;
    g.position.set(s.x, s.y + 0.012, s.z);
    g.rotation.set(0, Math.atan2(-(s.face[0] - s.x), -(s.face[1] - s.z)), 0);
    this.marker.show(!travelMapDeps.blocked?.());
  }

  /* ── choosing ────────────────────────────────────────────────────────── */

  /** The trigger (or a fingertip's press) on the map: go there, or turn to that sheet. */
  private select(hand: Hand, poked = false): void {
    if (this.phase !== 'open') return;
    const t = this.hover;
    if (!t) return;
    if (poked) pulseHand(this.renderer.xr.getSession() ?? undefined, hand, 0.3, 24);
    switch (t.kind) {
      case 'close':
        this.closeMap();
        return;
      case 'tab':
        this.setSheet(t.id);
        return;
      case 'back':
        this.setSheet('village');
        return;
      case 'room':
        this.setSheet(`room:${t.name}` as SheetId);
        return;
      case 'spot':
      case 'free':
        this.travel(t.spot, hand);
    }
  }

  private travel(s: Spot, hand: Hand): void {
    const why = travelMapDeps.blocked?.();
    if (why) {
      this.flashText = why;
      this.flashT = 2.2;
      this.dirty = true;
      uiDeny();
      return;
    }
    mapGo();
    pulseHand(this.renderer.xr.getSession() ?? undefined, hand, 0.5, 50);
    this.closeMap(true);
    travelMapDeps.go?.(s);
  }

  /** Go straight to a spot by its id (the dev harness, and anything that wants to send you). */
  goTo(id: string): boolean {
    const deps = travelMapDeps;
    if (!deps.world) return false;
    this.fixed ??= staticSpots(deps.world);
    this.refreshLater();
    const s = this.all().find((k) => k.id === id);
    if (!s || deps.blocked?.()) return false;
    deps.go?.(s);
    return true;
  }

  /** Every spot there is just now (dev). */
  spots(): Spot[] {
    const deps = travelMapDeps;
    if (deps.world) this.fixed ??= staticSpots(deps.world);
    this.refreshLater();
    return this.all();
  }

  /** Point at map px (u, v) as if a ray were there (dev: the harness can't aim that finely). */
  pointAt(u: number, v: number): string {
    if (this.phase !== 'open') return '';
    this.pinned = [u, v];
    this.hover = this.pick(u, v);
    this.hoverAt = [u, v];
    this.dirty = true;
    this.showMarker();
    this.paint();
    return key(this.hover);
  }

  /** Pull the trigger on whatever's under the pointer (dev). */
  click(hand: Hand = 'right'): void {
    this.select(hand);
  }

  /** Where a spot is on the current sheet, in map px (dev). */
  whereIs(id: string): [number, number] | null {
    const s = this.all().find((k) => k.id === id);
    if (!s || !this.sheets) return null;
    const [u, v] = this.sheet().toPx(s.x, s.z);
    return [u + VIEW.x, v + VIEW.y];
  }

  /** Remember the gem rocks you've been near enough to see (the map marks them, once the pick's yours). */
  private watchRocks(dt: number): void {
    this.seenT -= dt;
    if (this.seenT > 0) return;
    this.seenT = 1;
    this.player.head.getWorldPosition(_head);
    let added = false;
    for (const r of ROCK_SITES) {
      if (this.seen.has(r.id) || Math.hypot(r.x - _head.x, r.z - _head.z) > ROCK_SEEN_R) continue;
      this.seen.add(r.id);
      added = true;
    }
    if (!added) return;
    try {
      localStorage.setItem('handfish.rocksSeen', JSON.stringify([...this.seen]));
    } catch {
      /* fine: this session still knows */
    }
  }

  /* ── drawing ─────────────────────────────────────────────────────────── */

  private drawnAt: [number, number] | null = null;

  private paint(): void {
    this.dirty = false;
    if (!this.sheets) return;
    const c = this.panel.ctx;
    const [W, H] = MAP_PX;
    const sheet = this.sheet();
    this.drawnAt = this.hoverAt;

    // the paper, a little darker toward its edges
    c.fillStyle = '#f0e2c0';
    c.fillRect(0, 0, W, H);
    const g = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.72);
    g.addColorStop(0, 'rgba(120, 80, 30, 0)');
    g.addColorStop(1, 'rgba(120, 80, 30, 0.22)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    // the tabs (the village's is lit on a room's plan), and the ✕
    const lit = sheet.building ? 'village' : sheet.id;
    for (const t of TABS) {
      const on = t.id === lit;
      const hov = this.hover?.kind === 'tab' && this.hover.id === t.id;
      roundRect(c, t.x, TAB_Y, t.w, TAB_H, 18);
      c.fillStyle = on ? '#9a2a1a' : hov ? '#e6cf9c' : '#dcc596';
      c.fill();
      c.lineWidth = hov ? 5 : 3;
      c.strokeStyle = hov ? '#ffd24a' : '#2e2214';
      c.stroke();
      c.font = font(700, 30);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = on ? '#fff6e0' : '#2e2214';
      c.fillText(t.text, t.x + t.w / 2, TAB_Y + TAB_H / 2 + 2);
    }
    {
      const hov = this.hover?.kind === 'close';
      c.beginPath();
      c.arc(CLOSE.x, CLOSE.y, CLOSE.r, 0, Math.PI * 2);
      c.fillStyle = hov ? '#9a2a1a' : '#dcc596';
      c.fill();
      c.lineWidth = hov ? 5 : 3;
      c.strokeStyle = hov ? '#ffd24a' : '#2e2214';
      c.stroke();
      c.strokeStyle = hov ? '#fff6e0' : '#2e2214';
      c.lineWidth = 5;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(CLOSE.x - 10, CLOSE.y - 10);
      c.lineTo(CLOSE.x + 10, CLOSE.y + 10);
      c.moveTo(CLOSE.x + 10, CLOSE.y - 10);
      c.lineTo(CLOSE.x - 10, CLOSE.y + 10);
      c.stroke();
      c.lineCap = 'butt';
    }
    // a compass rose by the tabs (north's along the pier sheet's left edge, it's turned)
    this.compass(c, 1120, 49, 26, sheet.id === 'pier' ? -Math.PI / 2 : 0);

    // the sheet
    c.save();
    c.beginPath();
    c.rect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    c.clip();
    c.translate(VIEW.x, VIEW.y);
    c.drawImage(sheet.canvas, 0, 0);
    this.drawWalks(c, sheet);
    this.drawMarks(c, sheet);
    this.drawYou(c, sheet);
    this.drawHover(c, sheet);
    if (sheet.building) {
      const hov = this.hover?.kind === 'back';
      roundRect(c, BACK.x, BACK.y, BACK.w, BACK.h, 14);
      c.fillStyle = hov ? '#9a2a1a' : 'rgba(220, 197, 150, 0.96)';
      c.fill();
      c.lineWidth = hov ? 4 : 2.5;
      c.strokeStyle = hov ? '#ffd24a' : '#2e2214';
      c.stroke();
      c.font = font(700, 26);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = hov ? '#fff6e0' : '#2e2214';
      c.fillText('◂  VILLAGE', BACK.x + BACK.w / 2, BACK.y + BACK.h / 2 + 2);
    }
    c.restore();
    c.lineWidth = 4;
    c.strokeStyle = '#2e2214';
    c.strokeRect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);

    // the caption: what's under your pointer, and how to go
    this.caption(c);
    this.panel.commit();
  }

  private compass(c: CanvasRenderingContext2D, x: number, y: number, r: number, turn: number): void {
    c.save();
    c.translate(x, y);
    c.rotate(turn);
    // four points, north's in red
    for (let k = 0; k < 4; k++) {
      c.save();
      c.rotate((k * Math.PI) / 2);
      c.beginPath();
      c.moveTo(0, -r);
      c.lineTo(r * 0.22, 0);
      c.lineTo(-r * 0.22, 0);
      c.closePath();
      c.fillStyle = k === 0 ? '#9a2a1a' : '#2e2214';
      c.fill();
      c.restore();
    }
    c.font = font(700, 16);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#9a2a1a';
    c.fillText('N', 0, -r - 10);
    c.restore();
  }

  /** The walks off the pier head, once they're built (the sheets are drawn before they are). */
  private drawWalks(c: CanvasRenderingContext2D, sheet: Sheet): void {
    if (sheet.building || !this.progress) return;
    for (const w of WALKS) {
      const built = this.progress.walks[w.id] ?? 0;
      if (built <= 0) continue;
      const len = (w.bays * w.bay + w.head[1]) * Math.min(1, built);
      const [x0, y0] = sheet.toPx(w.gate.x, w.gate.z);
      const [x1, y1] = sheet.toPx(w.gate.x + w.dir[0] * len, w.gate.z + w.dir[1] * len);
      c.lineCap = 'butt';
      c.strokeStyle = '#6b4a2a';
      c.lineWidth = Math.max(3, WALK_W * sheet.scale);
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
      if (built >= 1) {
        c.fillStyle = '#6b4a2a';
        const r = Math.max(4, (w.head[0] / 2) * sheet.scale);
        c.beginPath();
        c.arc(x1, y1, r, 0, Math.PI * 2);
        c.fill();
      }
    }
  }

  /** Every spot on this sheet, marked by what it is (a room's are big, and named). */
  private drawMarks(c: CanvasRenderingContext2D, sheet: Sheet): void {
    const room = !!sheet.building;
    const k = room ? 2.1 : sheet.id === 'pier' ? 1.15 : 1;
    // a walk-in building on the village sheet: a soft ring round its door to say it opens
    if (sheet.id === 'village') {
      for (const b of travelMapDeps.world!.buildings) {
        if (!hasInterior(b.name)) continue;
        const [x, y] = sheet.toPx(b.x, b.z);
        const on = this.hover?.kind === 'room' ? this.hover.name === b.name : this.hover?.kind === 'spot' && this.hover.spot.building === b.name;
        c.save();
        c.translate(x, y);
        c.rotate(-b.yaw);
        roundRect(c, (-b.w / 2) * sheet.scale - 4, (-b.d / 2) * sheet.scale - 4, b.w * sheet.scale + 8, b.d * sheet.scale + 8, 6);
        c.lineWidth = on ? 5 : 2;
        c.strokeStyle = on ? '#ffd24a' : 'rgba(154, 42, 26, 0.55)';
        c.stroke();
        c.restore();
      }
    }
    for (const s of this.spotsOn(sheet)) {
      const [x, y] = sheet.toPx(s.x, s.z);
      if (x < -20 || y < -20 || x > VIEW.w + 20 || y > VIEW.h + 20) continue;
      this.mark(c, s, x, y, k);
      if (room) {
        const text = s.label.includes(' · ') ? s.label.split(' · ')[1] : 'the door';
        c.font = font(700, 26);
        c.textAlign = 'left';
        c.textBaseline = 'middle';
        c.lineWidth = 6;
        c.lineJoin = 'round';
        c.strokeStyle = 'rgba(242, 230, 204, 0.92)';
        c.strokeText(text.toUpperCase(), x + 30, y);
        c.fillStyle = '#2e2214';
        c.fillText(text.toUpperCase(), x + 30, y);
      }
    }
  }

  private mark(c: CanvasRenderingContext2D, s: Spot, x: number, y: number, k: number): void {
    const m = MARK[s.kind];
    const r = m.r * k;
    if (s.kind === 'camp') {
      flame(c, x, y - 3 * k, k * 0.75, true);
      return;
    }
    if (s.kind === 'sight') {
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.45 : r;
        c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      c.closePath();
    } else if (s.kind === 'rock') {
      c.beginPath();
      c.moveTo(x, y - r);
      c.lineTo(x + r * 0.8, y);
      c.lineTo(x, y + r);
      c.lineTo(x - r * 0.8, y);
      c.closePath();
    } else {
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
    }
    c.fillStyle = m.fill;
    c.fill();
    c.lineWidth = Math.max(2, 2.5 * k * 0.8);
    c.strokeStyle = m.rim;
    c.stroke();
    // a fishing spot shows which way you'll face: a little tick toward the water
    if (s.kind === 'fish' || s.kind === 'station') {
      const sheet = this.sheet();
      const [fx, fy] = sheet.toPx(s.face[0], s.face[1]);
      const a = Math.atan2(fy - y, fx - x);
      c.strokeStyle = m.fill;
      c.lineWidth = 3 * k * 0.8;
      c.beginPath();
      c.moveTo(x + Math.cos(a) * (r + 1), y + Math.sin(a) * (r + 1));
      c.lineTo(x + Math.cos(a) * (r + 7 * k), y + Math.sin(a) * (r + 7 * k));
      c.stroke();
    }
  }

  /** YOU: where you stand and which way you're looking. */
  private drawYou(c: CanvasRenderingContext2D, sheet: Sheet): void {
    this.player.head.getWorldPosition(_head);
    if (sheet.building && !inBuilding(sheet.building, _head.x, _head.z)) return;
    const [x, y] = sheet.toPx(_head.x, _head.z);
    if (x < 0 || y < 0 || x > VIEW.w || y > VIEW.h) return;
    this.player.head.getWorldQuaternion(_q);
    _w.set(0, 0, -1).applyQuaternion(_q);
    const [fx, fy] = sheet.toPx(_head.x + _w.x, _head.z + _w.z);
    const a = Math.atan2(fy - y, fx - x);
    const r = sheet.building ? 16 : 11;
    c.fillStyle = 'rgba(208, 32, 26, 0.35)';
    c.beginPath();
    c.moveTo(x, y);
    c.arc(x, y, r * 3.2, a - 0.45, a + 0.45);
    c.closePath();
    c.fill();
    c.fillStyle = '#d0201a';
    c.strokeStyle = '#fff6e0';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    // (beside the dot on a chart; under it on a plan, where the spot's own name is beside it)
    const [lx, ly] = sheet.building ? [x, y + r + 16] : [x + r + 5, y + 1];
    c.font = font(700, 20);
    c.textAlign = sheet.building ? 'center' : 'left';
    c.textBaseline = 'middle';
    c.lineWidth = 5;
    c.strokeStyle = 'rgba(242, 230, 204, 0.9)';
    c.strokeText('YOU', lx, ly);
    c.fillStyle = '#d0201a';
    c.fillText('YOU', lx, ly);
  }

  /** The spot under the pointer: a gold ring, a dotted line to it from you, and the pointer's dot. */
  private drawHover(c: CanvasRenderingContext2D, sheet: Sheet): void {
    const t = this.hover;
    if (t && (t.kind === 'spot' || t.kind === 'free')) {
      const s = t.spot;
      const [x, y] = sheet.toPx(s.x, s.z);
      // the way there, inked in dashes from YOU
      this.player.head.getWorldPosition(_head);
      const [hx, hy] = sheet.toPx(_head.x, _head.z);
      if (!sheet.building || inBuilding(sheet.building, _head.x, _head.z)) {
        c.setLineDash([10, 9]);
        c.lineWidth = 3.5;
        c.strokeStyle = 'rgba(154, 42, 26, 0.85)';
        c.beginPath();
        c.moveTo(hx, hy);
        c.lineTo(x, y);
        c.stroke();
        c.setLineDash([]);
      }
      if (t.kind === 'free') {
        // X marks the spot
        c.strokeStyle = '#9a2a1a';
        c.lineWidth = 6;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(x - 11, y - 11);
        c.lineTo(x + 11, y + 11);
        c.moveTo(x + 11, y - 11);
        c.lineTo(x - 11, y + 11);
        c.stroke();
        c.lineCap = 'butt';
      } else this.mark(c, s, x, y, sheet.building ? 2.4 : 1.5);
      c.strokeStyle = '#ffd24a';
      c.lineWidth = 5;
      c.beginPath();
      c.arc(x, y, sheet.building ? 34 : 22, 0, Math.PI * 2);
      c.stroke();
    }
    // the pointer itself, as a small inked circle (the ray's own dot sits on the paper too)
    if (this.hoverAt) {
      const u = this.hoverAt[0] - VIEW.x;
      const v = this.hoverAt[1] - VIEW.y;
      c.strokeStyle = 'rgba(46, 34, 20, 0.55)';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(u, v, 6, 0, Math.PI * 2);
      c.stroke();
    }
  }

  private caption(c: CanvasRenderingContext2D): void {
    const t = this.hover;
    const y = FOOT_Y + 38;
    c.textBaseline = 'middle';
    let main = '';
    let sub = '';
    if (t?.kind === 'spot' || t?.kind === 'free') {
      main = t.spot.label;
      sub = t.spot.note ?? '';
    } else if (t?.kind === 'room') {
      main = t.title;
      sub = 'see inside';
    } else if (t?.kind === 'tab') main = TABS.find((k) => k.id === t.id)!.text.toLowerCase().replace(/^./, (m) => m.toUpperCase());
    else if (t?.kind === 'back') main = 'Back to the village';
    else if (t?.kind === 'close') main = 'Roll the map up';
    else main = this.sheet().building ? this.sheet().title : 'Point where you want to be';
    c.textAlign = 'left';
    c.font = font(700, 36);
    c.fillStyle = '#2e2214';
    c.fillText(main, 36, y);
    if (sub) {
      const w = c.measureText(main).width;
      c.font = `italic ${font(600, 26)}`;
      c.fillStyle = 'rgba(46, 34, 20, 0.7)';
      c.fillText(`·  ${sub}`, 36 + w + 16, y + 2);
    }
    c.textAlign = 'right';
    if (this.flashT > 0) {
      c.font = font(700, 30);
      c.fillStyle = '#c0301c';
      c.fillText(this.flashText, W_RIGHT, y);
      return;
    }
    const go = t?.kind === 'spot' || t?.kind === 'free';
    const blocked = go ? travelMapDeps.blocked?.() : null;
    c.font = `italic ${font(600, 26)}`;
    c.fillStyle = blocked ? '#c0301c' : 'rgba(46, 34, 20, 0.75)';
    const hand = this.hoverBy && this.isHand(this.hoverBy);
    c.fillText(blocked ?? (go ? (hand ? 'press to go there' : 'pull the trigger to go') : t?.kind === 'room' ? (hand ? 'press to look inside' : 'pull the trigger to look inside') : ''), W_RIGHT, y);
  }
}

const W_RIGHT = MAP_PX[0] - 36;
