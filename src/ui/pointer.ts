/**
 * Point-and-click panels in the world: shop counters, bet buttons, the bank, Coral's words.
 *
 * Any system can make an `InteractivePanel` (a canvas panel with button rectangles), add it to
 * the scene and `register` it. Each frame the PointerSystem casts both controllers' rays at the
 * visible panels; the nearest hit gets a cursor and a beam, the button under it lights, and a
 * trigger pull clicks it — with ff2's hover and click sounds and a tick in the hand.
 *
 * Bare hands can POKE them too: an index fingertip that comes at a panel's face from the front and
 * pushes a few millimetres through clicks the button under it, once per push (the backpack's tabs
 * and switches, the field guide's pages, any board in reach). A fingertip on a panel takes the place
 * of that hand's ray there.
 *
 * A hand whose ray is on a button CLAIMS its trigger for that frame (`pointerView.claimed`), so
 * pointing at a shop never also casts the rod or drops a fish. A click keeps the claim until the
 * trigger's let go: a button that goes away under it (SELL ALL, with nothing left to sell) mustn't
 * leave the rest of that pull to the rod, which would take it for a new one and cast.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, Plane, Quaternion, Ray, SphereGeometry, Vector3 } from 'three';
import { uiClick, uiHover } from '../audio/sfx.ts';
import { pulseHand } from '../input/haptics.ts';
import { Panel } from './panel.ts';
import { introActive } from '../experience/introGate.ts';
import { hands } from '../input/hands.ts';

type Hand = 'left' | 'right';

export interface Button {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  enabled?: boolean;
}

export class InteractivePanel extends Panel {
  buttons: Button[] = [];
  hover: string | null = null;
  /** a hover on its way (it holds a few frames before the board repaints for it) */
  hoverNext: string | null = null;
  hoverFrames = 0;
  /** metres per canvas pixel, for hit-testing */
  readonly size: [number, number];
  readonly px: [number, number];
  onClick: (id: string, hand: Hand) => void = () => {};
  /** a fingertip may press it (the travel map reads fingertips itself, so it says no) */
  pokeable = true;
  /** repaint hook, called whenever the hover changes (and by owners when state changes) */
  paint: () => void = () => {};

  constructor(px: [number, number], m: [number, number]) {
    super(px, m, { depthTest: true });
    this.px = px;
    this.size = m;
  }

  /** The button `id`, if (x, y) is on it or within `m` canvas pixels of it. */
  near(id: string | null, x: number, y: number, m: number): Button | null {
    if (!id) return null;
    for (const b of this.buttons) if (b.id === id && b.enabled !== false && x >= b.x - m && x <= b.x + b.w + m && y >= b.y - m && y <= b.y + b.h + m) return b;
    return null;
  }

  /** The button at canvas (x, y). */
  at(x: number, y: number): Button | null {
    for (const b of this.buttons) if (b.enabled !== false && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    return null;
  }
}

const panels = new Set<InteractivePanel>();
/** a fingertip: on a panel within this in front of its face (m), pressed this far through, let go this far back out */
const POKE_NEAR = 0.035;
const POKE_PRESS = 0.006;
const POKE_REARM = 0.015;

/** frames a new hover holds before its board repaints */
const HOVER_HOLD = 3;
/** how far past a hovered button's edge (canvas pixels) it stays hovered */
const HOVER_MARGIN = 14;

export function register(p: InteractivePanel): void {
  panels.add(p);
}
export function unregister(p: InteractivePanel): void {
  panels.delete(p);
}

/** Which hands' triggers the UI took this frame, and the panel each hand's ray is on (button or not). */
export const pointerView: { claimed: Record<Hand, boolean>; over: Record<Hand, InteractivePanel | null> } = {
  claimed: { left: false, right: false },
  over: { left: null, right: null },
};

const _o = new Vector3();
const _d = new Vector3();
const _n = new Vector3();
const _hit = new Vector3();
const _best = new Vector3();
const _q = new Quaternion();

export class PointerSystem extends createSystem({}) {
  private cursors!: Record<Hand, { dot: Mesh; beam: Line }>;
  private readonly trig: Record<Hand, boolean> = { left: false, right: false };
  /** a click on a button, its trigger not yet let go: still the UI's */
  private readonly clicking: Record<Hand, boolean> = { left: false, right: false };
  private readonly ray = new Ray();
  private readonly plane = new Plane();
  /** a poking fingertip: came at the face from the front, and hasn't pressed since it last pulled back */
  private readonly pokeFront: Record<Hand, boolean> = { left: false, right: false };
  private readonly pokeArmed: Record<Hand, boolean> = { left: true, right: true };

  init(): void {
    const mk = (): { dot: Mesh; beam: Line } => {
      const dot = new Mesh(new SphereGeometry(0.007, 10, 8), new MeshBasicMaterial({ color: 0xffb000, depthTest: false, toneMapped: false }));
      dot.renderOrder = 40;
      dot.visible = false;
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3));
      const beam = new Line(g, new LineBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.55, depthTest: false }));
      beam.frustumCulled = false;
      beam.visible = false;
      beam.renderOrder = 39;
      this.scene.add(dot, beam);
      return { dot, beam };
    };
    this.cursors = { left: mk(), right: mk() };
  }

  update(): void {
    if (introActive()) {
      for (const c of Object.values(this.cursors)) c.dot.visible = c.beam.visible = false;
      pointerView.over.left = pointerView.over.right = null;
      return;
    }
    const hovered = new Map<InteractivePanel, string | null>();
    for (const hand of ['left', 'right'] as const) {
      const cur = this.cursors[hand];
      pointerView.claimed[hand] = false;
      pointerView.over[hand] = null;
      const pad = this.input.xr.gamepads[hand];
      const t = pad?.getButtonValue(InputComponent.Trigger) ?? 0;
      const down = !this.trig[hand] && t > 0.6;
      if (t > 0.6) this.trig[hand] = true;
      else if (t < 0.3) this.trig[hand] = this.clicking[hand] = false;
      pointerView.claimed[hand] = this.clicking[hand];

      // a bare fingertip on a panel's face: that's what this hand's on (not its ray)
      if (this.poke(hand, cur, hovered)) continue;

      // nearest visible panel along this hand's ray
      const rs = this.player.raySpaces[hand];
      rs.getWorldPosition(_o);
      rs.getWorldQuaternion(_q);
      _d.set(0, 0, -1).applyQuaternion(_q);
      this.ray.set(_o, _d);
      let best: { p: InteractivePanel; x: number; y: number; dist: number } | null = null;
      for (const p of panels) {
        if (!visible(p.mesh)) continue;
        p.mesh.updateMatrixWorld();
        _n.set(0, 0, 1).transformDirection(p.mesh.matrixWorld);
        this.plane.setFromNormalAndCoplanarPoint(_n, p.mesh.getWorldPosition(_hit));
        const hit = this.ray.intersectPlane(this.plane, _hit);
        if (!hit) continue;
        const dist = hit.distanceTo(_o);
        if (dist > 6 || (best && dist > best.dist)) continue;
        const local = p.mesh.worldToLocal(hit.clone());
        const u = local.x / p.size[0] + 0.5;
        const v = 0.5 - local.y / p.size[1];
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        best = { p, x: u * p.px[0], y: v * p.px[1], dist };
        _best.copy(hit);
      }
      if (!best) {
        cur.dot.visible = false;
        cur.beam.visible = false;
        continue;
      }
      pointerView.over[hand] = best.p;
      cur.dot.visible = true;
      cur.dot.position.copy(_best);
      cur.beam.visible = true;
      const pos = cur.beam.geometry.attributes.position as Float32BufferAttribute;
      pos.setXYZ(0, _o.x, _o.y, _o.z);
      pos.setXYZ(1, _best.x, _best.y, _best.z);
      pos.needsUpdate = true;
      // the button you're on keeps you a little past its edge (a hand's tremor there flipped the
      // hover, and every flip repaints the board)
      const b = best.p.near(best.p.hover, best.x, best.y, HOVER_MARGIN) ?? best.p.at(best.x, best.y);
      if (b) {
        pointerView.claimed[hand] = true;
        hovered.set(best.p, b.id);
        if (down) {
          this.clicking[hand] = true;
          uiClick();
          pulseHand(this.renderer.xr.getSession() ?? undefined, hand, 0.35, 30);
          best.p.onClick(b.id, hand);
        }
      } else if (!hovered.has(best.p)) hovered.set(best.p, null);
    }
    // hover changes repaint (with the soft hover tick), once they've held for a few frames: a
    // hand's tremor on a button's edge would otherwise repaint the whole board, and send it to
    // the GPU, frame after frame
    for (const p of panels) {
      const h = hovered.get(p) ?? null;
      if (h === p.hover) {
        p.hoverNext = h;
        p.hoverFrames = 0;
        continue;
      }
      if (h !== p.hoverNext) {
        p.hoverNext = h;
        p.hoverFrames = 0;
      }
      if (++p.hoverFrames < HOVER_HOLD) continue;
      if (h) uiHover();
      p.hover = h;
      p.paint();
    }
  }

  /**
   * A bare index fingertip on (or just in front of) a panel's face: it's what this hand's on. The
   * button under it lights; pushed through from the front, it clicks, once, till the finger pulls
   * back out. True if a fingertip's on a panel (the ray's left alone then).
   */
  private poke(hand: Hand, cur: { dot: Mesh; beam: Line }, hovered: Map<InteractivePanel, string | null>): boolean {
    const f = hands[hand];
    if (!f.fresh) {
      this.pokeFront[hand] = false;
      this.pokeArmed[hand] = true;
      return false;
    }
    let best: { p: InteractivePanel; x: number; y: number; depth: number } | null = null;
    for (const p of panels) {
      if (!p.pokeable || !visible(p.mesh)) continue;
      p.mesh.updateMatrixWorld();
      _n.set(0, 0, 1).transformDirection(p.mesh.matrixWorld);
      p.mesh.getWorldPosition(_hit);
      const depth = _d.copy(f.indexTip).sub(_hit).dot(_n);
      if (depth > POKE_NEAR || depth < -0.04 || (best && Math.abs(depth) > Math.abs(best.depth))) continue;
      const local = p.mesh.worldToLocal(_o.copy(f.indexTip));
      const u = local.x / p.size[0] + 0.5;
      const v = 0.5 - local.y / p.size[1];
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      best = { p, x: u * p.px[0], y: v * p.px[1], depth };
      _best.copy(f.indexTip).addScaledVector(_n, -depth);
    }
    if (!best) {
      this.pokeFront[hand] = false;
      this.pokeArmed[hand] = true;
      return false;
    }
    pointerView.over[hand] = best.p;
    cur.beam.visible = false;
    cur.dot.visible = true;
    cur.dot.position.copy(_best);
    if (best.depth > POKE_REARM) this.pokeArmed[hand] = true;
    if (best.depth > 0) this.pokeFront[hand] = true;
    const b = best.p.near(best.p.hover, best.x, best.y, HOVER_MARGIN) ?? best.p.at(best.x, best.y);
    if (!b) {
      if (!hovered.has(best.p)) hovered.set(best.p, null);
      return true;
    }
    pointerView.claimed[hand] = true;
    hovered.set(best.p, b.id);
    if (this.pokeArmed[hand] && this.pokeFront[hand] && best.depth < -POKE_PRESS) {
      this.pokeArmed[hand] = false;
      uiClick();
      best.p.onClick(b.id, hand);
    }
    return true;
  }
}


function visible(o: { visible: boolean; parent: unknown }): boolean {
  let n: { visible: boolean; parent: unknown } | null = o;
  while (n) {
    if (!n.visible) return false;
    n = n.parent as typeof n;
  }
  return true;
}
