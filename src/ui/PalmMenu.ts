/**
 * THE PALM MENU: what the A button and the thumbsticks were, for bare hands (FLUX's wrist panel,
 * github.com/yellkell/fff). Turn your free hand (the one without the rod, your left to start with)
 * palm up and look at it: a little glass panel opens just above your palm, facing you. Poke it with
 * the other hand's index finger.
 *
 *   BACKPACK   the tray, open or shut (backpack/BackpackSystem.ts)
 *   MAP        the travel map, out or away (locomotion/TravelMap.ts)
 *   RECENTRE   back on the spot the map put you on, facing the way it faced you
 *   MUSIC      the island's songs on or off
 *
 * Opening takes the pose held a moment (palm well up, looked at square, the hand open: not a fist,
 * not a pinch), with a looser pose to stay open, so a hand passing palm up on its way somewhere
 * doesn't flash it open; turn the palm over or look away and it closes. A button fires when a
 * fingertip comes at it from the front and pushes a few millimetres through, once, until that finger
 * pulls back out: the frame brightens as the finger nears, the face lights under it, and a press
 * flashes it, in place of the haptics a bare hand doesn't have.
 */

import { createSystem } from '@iwsdk/core';
import { Group, Vector3 } from 'three';
import { palmClose, palmOpen, uiClick, uiDeny, uiHover } from '../audio/sfx.ts';
import { introActive } from '../experience/introGate.ts';
import { hands, openHand, type Hand } from '../input/hands.ts';
import { font } from './fonts.ts';
import { INK, Panel, roundRect } from './panel.ts';

/** What the menu's buttons do (main.ts). */
export const palmMenuDeps: {
  /** the hand the rod's in: the menu's on the other */
  rodHand: (() => Hand) | null;
  backpack: (() => void) | null;
  map: ((from: Vector3) => void) | null;
  /** false: refused (it knocks) */
  recentre: (() => boolean) | null;
  music: (() => boolean) | null;
  /** is the music on, is the backpack open, is the map out (how the buttons read) */
  musicOn: (() => boolean) | null;
  backpackOpen: (() => boolean) | null;
  mapOpen: (() => boolean) | null;
} = { rodHand: null, backpack: null, map: null, recentre: null, music: null, musicOn: null, backpackOpen: null, mapOpen: null };

export const palmMenuView: { open: boolean; system?: PalmMenu } = { open: false };

/** FLUX's numbers: how far up the palm faces (its normal's y) and how square you look at it (°), to open and to stay open; the holds (s) */
const MENU = { openUp: 0.65, stayUp: 0.35, openGaze: 25, stayGaze: 40, openHold: 0.2, closeHold: 0.3, lift: 0.13 };
/** the panel's size (m) and canvas (px) */
const SIZE: [number, number] = [0.22, 0.155];
const PX: [number, number] = [704, 496];
/** a fingertip: lit within this of the face (m); pressed this far through it; let go this far back */
const NEAR = 0.04;
const PRESS = 0.006;
const REARM = 0.015;

type Id = 'backpack' | 'map' | 'recentre' | 'music';
const BUTTONS: { id: Id; col: number; row: number; accent: string; ink: string }[] = [
  { id: 'backpack', col: 0, row: 0, accent: '#ffb000', ink: '#1a1206' },
  { id: 'map', col: 1, row: 0, accent: '#5ee8d8', ink: '#06302a' },
  { id: 'recentre', col: 0, row: 1, accent: '#6ad0f4', ink: '#06202c' },
  { id: 'music', col: 1, row: 1, accent: '#ff5fd2', ink: '#2a0a22' },
];
const PAD = 22;
const GAP = 16;
const BW = (PX[0] - PAD * 2 - GAP) / 2;
const BH = (PX[1] - PAD * 2 - GAP) / 2;
const box = (b: (typeof BUTTONS)[number]): { x: number; y: number } => ({ x: PAD + b.col * (BW + GAP), y: PAD + b.row * (BH + GAP) });

const cos = (deg: number): number => Math.cos((deg * Math.PI) / 180);
const _head = new Vector3();
const _gaze = new Vector3();
const _to = new Vector3();
const _want = new Vector3();
const _loc = new Vector3();

export class PalmMenu extends createSystem({}) {
  private readonly root = new Group();
  private panel!: Panel;
  private poseFor = 0;
  private lostFor = 0;
  private scale = 0;
  private side: Hand = 'left';
  /** how near the poking fingertip is to each button (0..1), the one it's on, flashes */
  private near: Record<Id, number> = { backpack: 0, map: 0, recentre: 0, music: 0 };
  private flash: Record<Id, number> = { backpack: 0, map: 0, recentre: 0, music: 0 };
  private refused: Id | null = null;
  /** the poking finger: came at the face from the front, and hasn't pulled back out since a press */
  private front = false;
  private armed = true;
  private drawn = '';

  init(): void {
    palmMenuView.system = this;
    this.panel = new Panel(PX, SIZE);
    // it's on your hand, so it's always the nearest panel: drawn after the others (but behind your
    // own finger as it reaches in)
    this.panel.mesh.renderOrder = 60;
    this.root.add(this.panel.mesh);
    this.root.visible = false;
    this.scene.add(this.root);
    this.panel.repaintOnFonts(() => {
      this.drawn = '';
    });
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.05);
    const deps = palmMenuDeps;
    this.side = deps.rodHand?.() === 'left' ? 'right' : 'left';
    const h = hands[this.side];
    if (introActive()) {
      this.poseFor = 0;
      this.setOpen(false, true);
    } else {
      this.camera.getWorldPosition(_head);
      this.camera.getWorldDirection(_gaze);
      _to.copy(h.palm).sub(_head).normalize();
      const up = h.palmNormal.y;
      const look = _gaze.dot(_to);
      const ok = openHand(h);
      const holding = palmMenuView.open ? ok && up > MENU.stayUp && look > cos(MENU.stayGaze) : ok && up > MENU.openUp && look > cos(MENU.openGaze);
      if (holding) {
        this.poseFor += dt;
        this.lostFor = 0;
      } else {
        this.lostFor += dt;
        this.poseFor = 0;
      }
      if (!palmMenuView.open && this.poseFor >= MENU.openHold) this.setOpen(true);
      else if (palmMenuView.open && this.lostFor >= MENU.closeHold) this.setOpen(false);
    }

    this.scale = Math.min(1, Math.max(0, this.scale + (palmMenuView.open ? dt : -dt) / 0.15));
    this.root.visible = this.scale > 0;
    if (!this.root.visible) return;
    // pops up off the palm: a little overshoot
    const k = this.scale;
    this.root.scale.setScalar(Math.max(0.001, k < 1 ? k * (1 + 0.25 * Math.sin(k * Math.PI)) : 1));
    if (h.fresh) {
      _want.copy(h.palm);
      _want.y += MENU.lift;
      // heavily smoothed: a panel jittering under your finger can't be poked
      this.root.position.lerp(_want, Math.min(1, dt * 12));
    }
    this.root.lookAt(_head);

    for (const b of BUTTONS) this.flash[b.id] = Math.max(0, this.flash[b.id] - dt);
    if (palmMenuView.open && this.scale >= 1) this.poke();
    this.paint();
  }

  private setOpen(open: boolean, quiet = false): void {
    if (palmMenuView.open === open) return;
    palmMenuView.open = open;
    if (open) {
      // snap to the palm as it opens; it follows smoothly after
      this.root.position.copy(hands[this.side].palm);
      this.root.position.y += MENU.lift;
      this.front = false;
      this.armed = true;
      if (!quiet) palmOpen();
    } else if (!quiet) palmClose();
  }

  /** The other hand's index fingertip on the panel: lights what it's near, presses what it pushes into. */
  private poke(): void {
    const other: Hand = this.side === 'left' ? 'right' : 'left';
    const f = hands[other];
    for (const b of BUTTONS) this.near[b.id] = 0;
    if (!f.fresh) {
      this.front = false;
      return;
    }
    const local = this.panel.mesh.worldToLocal(_loc.copy(f.indexTip));
    const depth = local.z * this.root.scale.x;
    const u = (local.x / SIZE[0] + 0.5) * PX[0];
    const v = (0.5 - local.y / SIZE[1]) * PX[1];
    let on: (typeof BUTTONS)[number] | null = null;
    for (const b of BUTTONS) {
      const { x, y } = box(b);
      if (u >= x - 8 && u <= x + BW + 8 && v >= y - 8 && v <= y + BH + 8) on = b;
    }
    if (!on || depth > NEAR || depth < -0.05) {
      if (depth > REARM || !on) this.armed = true;
      this.front = depth > 0 && !!on;
      return;
    }
    const was = this.near[on.id];
    this.near[on.id] = Math.max(0.15, 1 - Math.max(0, depth) / NEAR);
    if (was === 0 && depth > 0.01 && this.armed) uiHover();
    if (depth > REARM) this.armed = true;
    if (depth > 0) this.front = true;
    if (this.armed && this.front && depth < -PRESS) {
      this.armed = false;
      this.press(on.id);
    }
  }

  private press(id: Id): void {
    const deps = palmMenuDeps;
    this.flash[id] = 0.18;
    let ok = true;
    if (id === 'backpack') deps.backpack?.();
    else if (id === 'map') deps.map?.(this.root.position.clone());
    else if (id === 'recentre') ok = deps.recentre?.() ?? false;
    else deps.music?.();
    this.refused = ok ? null : id;
    if (ok) uiClick();
    else uiDeny();
  }

  /** Repaint when anything it shows has changed. */
  private paint(): void {
    const deps = palmMenuDeps;
    const music = deps.musicOn?.() ?? true;
    const pack = deps.backpackOpen?.() ?? false;
    const map = deps.mapOpen?.() ?? false;
    const key = JSON.stringify([music, pack, map, this.near, this.flash, this.refused]);
    if (key === this.drawn) return;
    this.drawn = key;
    const c = this.panel.ctx;
    const [W, H] = PX;
    this.panel.clear();
    // the glass
    roundRect(c, 4, 4, W - 8, H - 8, 30);
    c.fillStyle = INK.glass;
    c.fill();
    c.lineWidth = 4;
    c.strokeStyle = INK.rim;
    c.stroke();
    const text: Record<Id, [string, string]> = {
      backpack: [pack ? 'CLOSE BAG' : 'BACKPACK', pack ? 'put it away' : 'your catch'],
      map: [map ? 'MAP AWAY' : 'MAP', map ? 'roll it up' : 'go somewhere'],
      recentre: ['RECENTRE', 'back on your spot'],
      music: [music ? 'MUSIC ON' : 'MUSIC OFF', 'poke to switch'],
    };
    for (const b of BUTTONS) {
      const { x, y } = box(b);
      const n = this.near[b.id];
      const fl = this.flash[b.id] > 0;
      const lit = fl || (b.id === 'music' ? music : b.id === 'backpack' ? pack : b.id === 'map' ? map : false);
      roundRect(c, x, y, BW, BH, 22);
      c.fillStyle = fl ? (this.refused === b.id ? '#e8352a' : '#fff3cf') : lit ? b.accent : n > 0 ? `rgba(40, 52, 60, ${0.7 + n * 0.3})` : 'rgba(10, 16, 22, 0.6)';
      c.fill();
      c.lineWidth = 4 + n * 5;
      c.strokeStyle = b.accent;
      c.globalAlpha = 0.55 + n * 0.45;
      c.stroke();
      c.globalAlpha = 1;
      const ink = fl || lit ? b.ink : b.accent;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = ink;
      c.font = font(700, 50);
      c.fillText(text[b.id][0], x + BW / 2, y + BH / 2 - 14, BW - 24);
      c.font = font(600, 26);
      c.globalAlpha = 0.8;
      c.fillText(text[b.id][1], x + BW / 2, y + BH / 2 + 30, BW - 24);
      c.globalAlpha = 1;
    }
    this.panel.commit();
  }
}
