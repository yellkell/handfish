/**
 * The travel map's sheets (locomotion/TravelMap.ts), drawn once each and kept: the same hand-tinted
 * nautical chart as the field guide's (backpack/chart.ts) at four scales, and a floor plan of each
 * room you can go into.
 *
 *   ISLAND   the whole island, out to the furthest camp: the wilds, for exploring
 *   BAY      the bay and the village above it: the shore, the pier's end, every building once
 *   VILLAGE  the village in plan, every building drawn with its walls and named; point at one to go
 *            in (or, where there's more than one thing inside, to open its floor plan)
 *   PIER     the pier close up, turned on its side to fill the sheet (the shore on the left, the head
 *            on the right): a spot every few metres down both rails and all round the head
 *   ROOM     one building's floor plan: its door, its furniture, and where to stand for each thing
 *
 * Every sheet knows its own scale both ways (world x, z ⇄ the sheet's pixels), so the map can mark
 * spots on it and turn a point back into the island.
 */

import { drawChart, type Bounds, type ChartSource } from '../backpack/chart.ts';
import { font } from '../ui/fonts.ts';
import { COUNTER_SHOPS, FURNITURE, gemCounter, hasInterior, JEWELLER, shopCounter } from '../village/interiors.ts';
import type { BuildingFrame } from '../village/signs.ts';
import { BUILDING_NAMES, frameXZ, toFrame, type MapTab } from './spots.ts';

/** the whole map: its canvas (px) and its size in the world (m) */
export const MAP_PX: [number, number] = [1280, 960];
export const MAP_M: [number, number] = [0.5, 0.375];
/** the sheet's window on the map (px): under the tabs, over the caption */
export const VIEW = { x: 24, y: 96, w: 1232, h: 776 };

export type SheetId = MapTab | `room:${string}`;

export interface Sheet {
  id: SheetId;
  title: string;
  /** the drawing, VIEW.w × VIEW.h */
  canvas: HTMLCanvasElement;
  /** px per metre */
  scale: number;
  /** world (x, z) → the sheet's px (in VIEW, from its corner), and back */
  toPx(x: number, z: number): [number, number];
  toWorld(u: number, v: number): [number, number];
  /** a room sheet's building */
  building?: BuildingFrame;
}

const INK = '#2e2214';
const PAPER = '#f2e6cc';
const SEA_INK = '#1e3a5a';
const aspect = VIEW.w / VIEW.h;

/** a sheet's bounds, widened to the view's shape round (cx, cz) with `span` m across */
function fit(x0: number, x1: number, z0: number): Bounds {
  const zs = (x1 - x0) / aspect;
  return { x0, x1, z0, z1: z0 + zs };
}

export const SHEET_BOUNDS: Record<'island' | 'bay' | 'village', Bounds> = {
  island: fit(-620, 700, -610),
  bay: fit(-250, 290, -214),
  village: fit(-26, 162, -170),
};
/** the pier sheet's reach along the pier (z), and the middle of it across (x) */
const PIER_Z: [number, number] = [-48, 44];
const PIER_X = 55;

/** Italic ink lettering with a paper halo, centred on (x, y). */
function letter(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, colour = SEA_INK, weight: 600 | 700 = 700, italic = true): void {
  c.font = `${italic ? 'italic ' : ''}${font(weight, size)}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.lineWidth = Math.max(3, size * 0.22);
  c.strokeStyle = 'rgba(242, 230, 204, 0.88)';
  c.strokeText(text, x, y);
  c.fillStyle = colour;
  c.fillText(text, x, y);
}

/** A chart sheet (island, bay, village): the chart at these bounds, then its own lettering. */
function chartSheet(id: 'island' | 'bay' | 'village', title: string, src: ChartSource, buildings: BuildingFrame[]): Sheet {
  const b = SHEET_BOUNDS[id];
  const ch = drawChart(src, VIEW.w, VIEW.h, b, false);
  const s = VIEW.w / (b.x1 - b.x0);
  const sheet: Sheet = {
    id,
    title,
    canvas: ch.canvas,
    scale: s,
    toPx: (x, z) => [(x - b.x0) * s, (z - b.z0) * s],
    toWorld: (u, v) => [b.x0 + u / s, b.z0 + v / s],
  };
  const c = ch.canvas.getContext('2d')!;
  const at = (x: number, z: number): [number, number] => sheet.toPx(x, z);
  const L = src.layout;
  if (id === 'bay') {
    letter(c, 'THE REEF', ...at(L.reef.x, L.reef.z + 6), 26);
    letter(c, 'THE SHALLOWS', ...at(-120, -28), 22);
    letter(c, 'THE BAY', ...at(170, 30), 24);
    letter(c, 'DROP-OFF · 6 m', ...at(150, 92), 20);
    letter(c, 'DEEP WATER', ...at(-40, 112), 26);
    letter(c, 'THE PIER', ...at(L.pier.x + 24, -14), 20);
    letter(c, 'THE VILLAGE', ...at(L.village.x, L.village.z - 50), 24, INK);
  } else if (id === 'island') {
    letter(c, 'THE BAY', ...at(30, 30), 22);
    letter(c, 'THE VILLAGE', ...at(L.village.x, L.village.z - 30), 20, INK);
    letter(c, 'OPEN SEA', ...at(60, 170), 26);
  } else {
    // the village: every building with a door drawn as its plan, and named
    planBuildings(c, sheet, buildings);
    letter(c, 'THE BEACH', ...at(-8, -56), 20);
  }
  return sheet;
}

/**
 * On the village sheet: the walk-in buildings as plans (light floor, inked walls, the door's gap),
 * and every building's name, nudged apart where they crowd.
 */
function planBuildings(c: CanvasRenderingContext2D, sheet: Sheet, buildings: BuildingFrame[]): void {
  const s = sheet.scale;
  for (const b of buildings) {
    if (!hasInterior(b.name)) continue;
    const [x, y] = sheet.toPx(b.x, b.z);
    c.save();
    c.translate(x, y);
    c.rotate(-b.yaw);
    // the floor, the walls (with the door's gap in the front one), the porch
    c.fillStyle = '#e9d3a6';
    c.fillRect((-b.w / 2) * s, (-b.d / 2) * s, b.w * s, b.d * s);
    c.strokeStyle = INK;
    c.lineWidth = Math.max(2.5, 0.17 * s);
    const hw = (b.w / 2) * s;
    const hd = (b.d / 2) * s;
    const dx = b.doorX * s;
    const gap = 0.55 * s;
    c.beginPath();
    c.moveTo(dx - gap, hd);
    c.lineTo(-hw, hd);
    c.lineTo(-hw, -hd);
    c.lineTo(hw, -hd);
    c.lineTo(hw, hd);
    c.lineTo(dx + gap, hd);
    c.stroke();
    if (b.porch > 0.1) {
      c.fillStyle = 'rgba(122, 86, 50, 0.55)';
      c.fillRect((b.doorX - 0.9) * s, hd + c.lineWidth / 2, 1.8 * s, Math.min(b.porch, 2.4) * s);
    }
    c.restore();
  }
  // the names, under each building, pushed apart where they'd overlap
  const labels = buildings
    .filter((b) => BUILDING_NAMES[b.name])
    .map((b) => {
      const [x, y] = sheet.toPx(b.x, b.z);
      return { text: BUILDING_NAMES[b.name], x, y: y + (b.d / 2) * s + 16, w: 0, ax: x, ay: y + (b.d / 2) * s + 16 };
    });
  c.font = font(700, 15);
  for (const l of labels) l.w = c.measureText(l.text).width + 8;
  for (let it = 0; it < 80; it++)
    for (const a of labels)
      for (const b of labels) {
        if (a === b) continue;
        const ox = (a.w + b.w) / 2 - Math.abs(a.x - b.x);
        const oy = 18 - Math.abs(a.y - b.y);
        if (ox <= 0 || oy <= 0) continue;
        const push = Math.min(ox, oy) / 2 + 0.5;
        if (oy < ox) {
          const d = a.y < b.y ? -1 : 1;
          a.y += d * push;
          b.y -= d * push;
        } else {
          const d = a.x < b.x ? -1 : 1;
          a.x += d * push;
          b.x -= d * push;
        }
      }
  for (const l of labels) letter(c, l.text, l.x, l.y, 15, INK, 700, false);
}

/**
 * The pier sheet: the pier close up, cut in two and laid in two strips, one over the other (the
 * shore end on top, running on into the head below), each turned a quarter so the pier runs along
 * it. Twice the scale of laying it out whole: the two rails' spots are a good fingertip apart.
 */
function pierSheet(src: ChartSource): Sheet {
  const gap = 16;
  const sh = (VIEW.h - gap) / 2;
  const s = VIEW.w / ((PIER_Z[1] - PIER_Z[0]) / 2);
  const half = sh / s / 2;
  const x0 = PIER_X - half;
  const zMid = (PIER_Z[0] + PIER_Z[1]) / 2;
  const strips = [
    { z0: PIER_Z[0], y: 0 },
    { z0: zMid, y: sh + gap },
  ];
  const canvas = document.createElement('canvas');
  canvas.width = VIEW.w;
  canvas.height = VIEW.h;
  const c = canvas.getContext('2d')!;
  c.fillStyle = PAPER;
  c.fillRect(0, 0, VIEW.w, VIEW.h);
  for (const st of strips) {
    // drawn upright (x across, z down) on a canvas the strip's height wide, then turned onto it:
    // +z runs to the right, +x (east) up the strip
    const ch = drawChart(src, Math.round(sh), VIEW.w, { x0, x1: PIER_X + half, z0: st.z0, z1: st.z0 + VIEW.w / s }, false);
    c.save();
    c.translate(0, st.y + sh);
    c.rotate(-Math.PI / 2);
    c.drawImage(ch.canvas, 0, 0);
    c.restore();
  }
  // where the top strip runs on into the bottom one
  c.fillStyle = PAPER;
  c.fillRect(0, sh, VIEW.w, gap);
  c.strokeStyle = INK;
  c.lineWidth = 2;
  c.setLineDash([8, 6]);
  c.beginPath();
  c.moveTo(0, sh + gap / 2);
  c.lineTo(VIEW.w, sh + gap / 2);
  c.stroke();
  c.setLineDash([]);
  const strip = (z: number): (typeof strips)[number] => (z < zMid ? strips[0] : strips[1]);
  const sheet: Sheet = {
    id: 'pier',
    title: 'The pier',
    canvas,
    scale: s,
    toPx: (x, z) => {
      const st = strip(z);
      return [(z - st.z0) * s, st.y + sh - (x - x0) * s];
    },
    toWorld: (u, v) => {
      const st = v < sh + gap / 2 ? strips[0] : strips[1];
      return [x0 + (st.y + sh - v) / s, st.z0 + u / s];
    },
  };
  const P = src.layout.pier;
  letter(c, 'THE BEACH', ...sheet.toPx(P.x + 4.5, -45), 20, INK);
  letter(c, 'EAST', ...sheet.toPx(P.x + 4.6, -20), 20);
  letter(c, 'WEST', ...sheet.toPx(P.x - 4.6, -20), 20);
  letter(c, 'runs on below ▾', ...sheet.toPx(P.x + 5.2, zMid - 6), 18, INK);
  letter(c, 'EAST', ...sheet.toPx(P.x + 4.6, 12), 20);
  letter(c, 'WEST', ...sheet.toPx(P.x - 4.6, 12), 20);
  letter(c, 'THE PIER HEAD ▸', ...sheet.toPx(P.x + 5, P.zEnd - 13), 20, INK);
  letter(c, 'OUT TO SEA ▸', ...sheet.toPx(P.x + 4.6, PIER_Z[1] - 2.2), 18);
  return sheet;
}

/**
 * A room's floor plan: the planks, the walls, the door at the bottom (you come in from the bottom
 * of the sheet), the counters and the tables, drawn to fill the sheet.
 */
function roomSheet(b: BuildingFrame): Sheet {
  const iw = b.w - 0.34;
  const id = b.d - 0.34;
  const s = Math.min((VIEW.w - 220) / iw, (VIEW.h - 150) / id);
  const cx = VIEW.w / 2;
  const cy = VIEW.h / 2 - 8;
  const canvas = document.createElement('canvas');
  canvas.width = VIEW.w;
  canvas.height = VIEW.h;
  const c = canvas.getContext('2d')!;
  const sheet: Sheet = {
    id: `room:${b.name}`,
    title: BUILDING_NAMES[b.name] ?? b.name,
    canvas,
    scale: s,
    building: b,
    toPx: (x, z) => {
      const [lx, lz] = toFrame(b, x, z);
      return [cx + lx * s, cy + lz * s];
    },
    toWorld: (u, v) => frameXZ(b, (u - cx) / s, (v - cy) / s),
  };
  // the paper
  c.fillStyle = PAPER;
  c.fillRect(0, 0, VIEW.w, VIEW.h);
  const px = (lx: number): number => cx + lx * s;
  const py = (lz: number): number => cy + lz * s;
  // the planks
  c.fillStyle = '#d8b47e';
  c.fillRect(px(-iw / 2), py(-id / 2), iw * s, id * s);
  c.strokeStyle = 'rgba(110, 70, 30, 0.28)';
  c.lineWidth = 1.5;
  for (let lz = -id / 2 + 0.18; lz < id / 2; lz += 0.18) {
    c.beginPath();
    c.moveTo(px(-iw / 2), py(lz));
    c.lineTo(px(iw / 2), py(lz));
    c.stroke();
  }
  // the furniture: tables, counters, the case wall, the slots, the sofa
  const pieces: [number, number, number, number, number][] = [...(FURNITURE[b.name] ?? [])];
  if (COUNTER_SHOPS.includes(b.name)) pieces.push(shopCounter(id));
  if (b.name === JEWELLER) pieces.push(gemCounter(iw, id));
  for (const [fx, fz, hx, hz] of pieces) {
    const r = Math.min(hx, hz) * s * 0.5;
    roundRect(c, px(fx - hx), py(fz - hz), hx * 2 * s, hz * 2 * s, Math.min(r, 14));
    c.fillStyle = '#6b4a2a';
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 2.5;
    c.stroke();
  }
  // a few touches that say what each table is
  if (b.name === 'C') {
    // the roulette wheel at the table's left end, the felt's green
    c.fillStyle = '#1f6b3a';
    roundRect(c, px(-0.5), py(-1.02), 2.0 * s, 0.84 * s, 8);
    c.fill();
    wheel(c, px(-1.18), py(-0.6), 0.42 * s);
  } else if (b.name === 'G') {
    c.fillStyle = '#1f6b3a';
    c.beginPath();
    c.arc(px(0), py(-1.25), 0.95 * s, 0, Math.PI);
    c.fill();
  } else if (b.name === 'B') {
    for (const mx of [-1.5, 0, 1.5]) {
      roundRect(c, px(mx - 0.32), py(-1.98 - 0.16), 0.64 * s, 0.5 * s, 8);
      c.fillStyle = '#b8862a';
      c.fill();
      c.strokeStyle = INK;
      c.stroke();
      c.fillStyle = '#c0301c';
      c.beginPath();
      c.arc(px(mx + 0.42), py(-1.72), 7, 0, Math.PI * 2);
      c.fill();
    }
  }
  // the walls, with the door's gap in the front one
  const t = Math.max(8, 0.17 * s);
  c.strokeStyle = INK;
  c.lineWidth = t;
  c.lineJoin = 'miter';
  const L = px(-iw / 2) - t / 2;
  const R = px(iw / 2) + t / 2;
  const T = py(-id / 2) - t / 2;
  const B = py(id / 2) + t / 2;
  const d0 = px(b.doorX - 0.55);
  const d1 = px(b.doorX + 0.55);
  c.beginPath();
  c.moveTo(d0, B);
  c.lineTo(L, B);
  c.lineTo(L, T);
  c.lineTo(R, T);
  c.lineTo(R, B);
  c.lineTo(d1, B);
  c.stroke();
  letter(c, 'DOOR', (d0 + d1) / 2, B + 30, 18, INK, 700, false);
  letter(c, (BUILDING_NAMES[b.name] ?? b.name).toUpperCase(), VIEW.w / 2, 30, 30, INK, 700, false);
  return sheet;
}

function wheel(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  for (let k = 0; k < 18; k++) {
    c.beginPath();
    c.moveTo(x, y);
    c.arc(x, y, r, (k / 18) * Math.PI * 2, ((k + 1) / 18) * Math.PI * 2);
    c.closePath();
    c.fillStyle = k === 0 ? '#1f8a3a' : k % 2 ? '#1a1a1a' : '#b8201a';
    c.fill();
  }
  c.fillStyle = '#c9a04a';
  c.beginPath();
  c.arc(x, y, r * 0.35, 0, Math.PI * 2);
  c.fill();
}

export function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

/** The sheets, each drawn the first time it's wanted and kept. */
export class Sheets {
  private readonly made = new Map<SheetId, Sheet>();

  constructor(
    private readonly src: ChartSource,
    private readonly buildings: BuildingFrame[],
  ) {}

  get(id: SheetId): Sheet {
    let s = this.made.get(id);
    if (s) return s;
    if (id === 'pier') s = pierSheet(this.src);
    else if (id === 'island') s = chartSheet('island', 'The island', this.src, this.buildings);
    else if (id === 'bay') s = chartSheet('bay', 'The bay', this.src, this.buildings);
    else if (id === 'village') s = chartSheet('village', 'The village', this.src, this.buildings);
    else {
      const b = this.buildings.find((k) => `room:${k.name}` === id);
      if (!b) throw new Error(`no room ${id}`);
      s = roomSheet(b);
    }
    this.made.set(id, s);
    return s;
  }

  /** Draw the sheets you'll want first now, while the island loads, not on the map's first opening. */
  warm(ids: SheetId[] = ['bay', 'pier', 'village', 'island']): void {
    for (const id of ids) this.get(id);
  }
}
