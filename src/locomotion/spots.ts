/**
 * WHERE THE MAP TAKES YOU: every spot on the island you can point at on the travel map
 * (locomotion/TravelMap.ts) and be standing at, as plain data worked out from the baked island.
 * Pure (no three.js): tools/map-check.mjs runs this same file against the bake.
 *
 * Movement is the map and nothing else, so a spot has to put you exactly where the thing you came
 * for is in reach, already looking at it:
 *
 *  - THE PIER     a spot every few metres along both rails, wherever there's water under them, a
 *                 hand's breadth back from the rail and looking straight out over it; all round
 *                 the pier head; and out on the walks you build off it, once they're built.
 *  - THE BEACH    along the bay's shore, on dry sand just above the swash, looking out to sea.
 *  - THE VILLAGE  every building's door (a step inside it), and in each room the place to stand
 *                 for what's in it: at the roulette table, the case wall, the blackjack table,
 *                 each of the three slots (the lever under your right hand), the bank's counter,
 *                 every shop counter, the Jeweller's two windows, the tackle shop's rod rack, Coral.
 *                 Outside, the fish market's scale, the timber yard's counter, the build crates on
 *                 the pier head.
 *  - THE WILDS    a step from each of the woodlots' trees, a step from each gem rock you've seen
 *                 (once the pickaxe is yours), by each dancers' camp's chest (once it's found, or
 *                 every one once the camp map is yours), the helter skelter's gate, the statue.
 *
 * Anywhere else on dry land is still yours to point at (the map's free point): the island's to be
 * explored, and its camps and rocks found by going to look.
 *
 * Every spot is checked against the island's floors and walls (`Surfaces`) before it's offered:
 * standing room clear of rails, posts, counters and clutter, on the floor it says.
 */

import type { WorldJson } from '../world/data.ts';
import type { Surfaces } from '../world/surfaces.ts';
import type { BuildingFrame } from '../village/signs.ts';
import { CASE_WALL_Z, hasInterior } from '../village/interiors.ts';
import { CRATES, DECK, WALKS, type WalkDef } from '../woodworks/gates.ts';
import { EAST_PILE, EAST_TREES, WEST_TREES, YARD } from '../woodworks/lots.ts';
import { ROCK_R, ROCK_SITES } from '../mining/sites.ts';
import { ALL_CAMPS, BEACH_CAMP, CAMPS, CHEST_R, type CampSite } from '../camps/sites.ts';
import { STATUE, STATUE_STAND } from '../statue/site.ts';

/** The map's sheets: the whole island, the bay, the village in plan, the pier close up. */
export type MapTab = 'island' | 'bay' | 'village' | 'pier';

export type SpotKind = 'fish' | 'place' | 'station' | 'wood' | 'rock' | 'camp' | 'sight' | 'build';

export interface Spot {
  id: string;
  /** what the map calls it ("Pier · west rail", "The Lucky Lure · roulette") */
  label: string;
  /** a second line: what's there for you ("2.4 m of water", "pull the lever") */
  note?: string;
  kind: SpotKind;
  /** where your head lands (world x, z), the floor you land on, and what you're looking at */
  x: number;
  z: number;
  y: number;
  face: [number, number];
  /** the sheets it's marked on */
  tabs: MapTab[];
  /** the building it's in or at, if any: the map draws it in that building's plan */
  building?: string;
}

/** What the spots are worked out from: the bake, and the floors and walls built from it. */
export interface SpotWorld {
  layout: WorldJson['layout'];
  buildings: BuildingFrame[];
  heightAt(x: number, z: number): number;
  surfaces: Surfaces;
}

/** How far along the game you are: which of the later spots are open yet. */
export interface SpotProgress {
  /** how far each walk is built (0..1), and the helter skelter and statue (1 = up) */
  walks: Record<string, number>;
  skelterGate: { at: [number, number]; face: [number, number] } | null;
  statue: boolean;
  /** camps found, and whether the pawn shop's camp map is yours */
  campsFound: ReadonlySet<string>;
  campMap: boolean;
  /** the pickaxe, the rocks broken, and the rocks you've been near enough to see */
  pick: boolean;
  rocksMined: ReadonlySet<string>;
  rocksSeen: ReadonlySet<string>;
}

/** how far back from a rail (its inside face) you stand: a hand's breadth, the rail at your hip */
export const RAIL_GAP = 0.38;
/** the clear room a spot needs round your feet (m): nothing solid nearer than this */
export const STAND_CLEAR = 0.26;
/** the spacing of spots along the pier's rails, and round its head (m) */
const RAIL_STEP = 4;
const HEAD_STEP = 2.2;
/** water under a rail spot at least this deep (m) for it to be a fishing spot */
const MIN_DEPTH = 0.5;

const TAU = Math.PI * 2;

/* ── helpers ───────────────────────────────────────────────────────────── */

/** A building's local (x across the front, z out of the front) to world (x, z). */
export function frameXZ(b: BuildingFrame, lx: number, lz: number): [number, number] {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
}

/** World (x, z) into a building's local frame. */
export function toFrame(b: BuildingFrame, x: number, z: number): [number, number] {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const dx = x - b.x;
  const dz = z - b.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** Is (x, z) inside a building's walls (grown by `margin`)? */
export function inBuilding(b: BuildingFrame, x: number, z: number, margin = 0): boolean {
  const [lx, lz] = toFrame(b, x, z);
  return Math.abs(lx) <= b.w / 2 + margin && Math.abs(lz) <= b.d / 2 + margin;
}

/** The floor you'd stand on at (x, z), near height `nearY` — or the highest floor there. */
export function floorAt(S: Surfaces, x: number, z: number, nearY?: number): ReturnType<Surfaces['areaNear']> {
  const top = Math.max(S.groundAt(x, z).y, S.deckOver(x, z));
  return S.areaNear(x, z, nearY ?? top);
}

/**
 * Can you stand at (x, z) on the floor at `y`: a floor you may stand on, right at that height,
 * and nothing solid within STAND_CLEAR of your feet (a rail, a post, a counter, a crate)?
 */
export function standsAt(S: Surfaces, x: number, z: number, y: number, clear = STAND_CLEAR): boolean {
  const a = S.areaNear(x, z, y);
  if (!S.standable(a, x, z) || Math.abs(a.y - y) > 0.12) return false;
  for (let k = 0; k < 8; k++) {
    const t = (k / 8) * TAU;
    const px = x + Math.cos(t) * clear;
    const pz = z + Math.sin(t) * clear;
    if (S.crossesWall(px, pz, x, z, a.y + 0.05)) return false;
  }
  return true;
}

const spot = (s: Spot): Spot => s;

/* ── the pier ──────────────────────────────────────────────────────────── */

/**
 * Along both rails of the pier's walk wherever there's water under them, and round the pier head's
 * rails (and its open east edge, over the boat dock), each looking straight out.
 */
export function pierSpots(w: SpotWorld): Spot[] {
  const P = w.layout.pier;
  const S = w.surfaces;
  const y = P.deckHeight;
  const out: Spot[] = [];
  const headZ0 = P.zEnd - P.headDepth;
  const rail = 0.09; // the rails' half-thickness: their inside face is this in from the deck's edge
  // the walk: its two rails (the rails stand on the deck's edges)
  for (const side of [-1, 1] as const) {
    const x = P.x + side * (P.width / 2 + 0.17 - rail - RAIL_GAP);
    const name = side < 0 ? 'west' : 'east';
    let n = 0;
    for (let z = headZ0 - 1.6; z > P.zStart; z -= RAIL_STEP) {
      const depth = -w.heightAt(x + side * 1.5, z);
      if (depth < MIN_DEPTH) break;
      if (!standsAt(S, x, z, y)) continue;
      out.push(spot({ id: `pier:${name}:${n++}`, label: `Pier · ${name} rail`, note: `${depth.toFixed(1)} m of water`, kind: 'fish', x, z, y, face: [x + side * 20, z], tabs: ['pier'] }));
    }
  }
  // the head: its far (south) rail, its west rail, the back (north) rails either side of the walk,
  // and the open east edge
  const hx0 = P.x - P.headWidth / 2;
  const hx1 = P.x + P.headWidth / 2;
  const edges: { name: string; from: [number, number]; to: [number, number]; out: [number, number]; gap: number }[] = [
    { name: 'far end', from: [hx0, P.zEnd], to: [hx1, P.zEnd], out: [0, 1], gap: 0.34 + RAIL_GAP },
    { name: 'west side', from: [hx0, headZ0], to: [hx0, P.zEnd], out: [-1, 0], gap: 0.39 + RAIL_GAP },
    { name: 'east side', from: [hx1, headZ0], to: [hx1, P.zEnd], out: [1, 0], gap: RAIL_GAP + 0.1 },
    { name: 'back', from: [hx0, headZ0], to: [P.x - P.width / 2 - 0.4, headZ0], out: [0, -1], gap: 0.34 + RAIL_GAP },
    { name: 'back', from: [P.x + P.width / 2 + 0.4, headZ0], to: [hx1, headZ0], out: [0, -1], gap: 0.34 + RAIL_GAP },
  ];
  let n = 0;
  for (const e of edges) {
    const len = Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]);
    const ux = (e.to[0] - e.from[0]) / len;
    const uz = (e.to[1] - e.from[1]) / len;
    // candidates every 10 cm, a corner's width in from either end; keep the clear ones HEAD_STEP apart
    let last = -Infinity;
    for (let t = 0.7; t <= len - 0.7; t += 0.1) {
      if (t - last < HEAD_STEP) continue;
      const x = e.from[0] + ux * t - e.out[0] * e.gap;
      const z = e.from[1] + uz * t - e.out[1] * e.gap;
      // (and clear of the walks' build crates: the runtime sets those down on the head)
      if (!standsAt(S, x, z, y) || Object.values(CRATES).some(([cx, cz]) => Math.hypot(x - cx, z - cz) < 0.95)) continue;
      // a corner's taken once, by whichever side got there first
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 1.2)) continue;
      last = t;
      const depth = -w.heightAt(x + e.out[0] * 2, z + e.out[1] * 2);
      out.push(spot({ id: `head:${n++}`, label: `Pier head · ${e.name}`, note: `${depth.toFixed(1)} m of water`, kind: 'fish', x, z, y, face: [x + e.out[0] * 20, z + e.out[1] * 20], tabs: ['pier'] }));
    }
  }
  // the end of the pier, as the bay's chart has always had it: the middle of the head, looking out
  out.push(spot({ id: 'pier:end', label: 'The end of the pier', kind: 'fish', x: 55.9, z: 38.2, y, face: [55.9, 58.2], tabs: ['bay'] }));
  return out;
}

/** A walk's frame: along it (unit), across it, its length to the platform's far edge. */
function walkFrame(def: WalkDef): { ax: number; az: number; px: number; pz: number; len: number; plat: number } {
  const [ax, az] = def.dir;
  const len = def.bays * def.bay + def.head[1];
  return { ax, az, px: -az, pz: ax, len, plat: def.bays * def.bay + def.head[1] / 2 };
}

/** Out on a finished walk: the middle of its platform's open far edge, looking out to sea. */
export function walkSpots(w: SpotWorld, built: Record<string, number>): Spot[] {
  const S = w.surfaces;
  const out: Spot[] = [];
  for (const def of WALKS) {
    if ((built[def.id] ?? 0) < 1) continue;
    const f = walkFrame(def);
    const name = def.id === 'reef' ? 'Reef walk' : 'Deep walk';
    const at = (along: number, across: number): [number, number] => [def.gate.x + f.ax * along + f.px * across, def.gate.z + f.az * along + f.pz * across];
    const cands: { along: number; across: number; out: [number, number]; where: string }[] = [];
    // the platform's open far edge, in the middle (the bay's chart is too small for more: once
    // you're out there, it's a step or two to either side)
    cands.push({ along: f.len - 0.12 - RAIL_GAP - 0.1, across: 0, out: [f.ax, f.az], where: 'platform' });
    for (const across of [-0.8, 0.8]) cands.push({ along: f.len - 0.12 - RAIL_GAP - 0.1, across, out: [f.ax, f.az], where: 'platform' });
    for (const c of cands) {
      const [x, z] = at(c.along, c.across);
      if (!standsAt(S, x, z, DECK, 0.2)) continue;
      const depth = -w.heightAt(x + c.out[0] * 2, z + c.out[1] * 2);
      out.push(spot({ id: `walk:${def.id}`, label: `${name} · ${c.where}`, note: `${depth.toFixed(1)} m of water`, kind: 'fish', x, z, y: DECK, face: [x + c.out[0] * 20, z + c.out[1] * 20], tabs: ['bay', 'island'] }));
      break;
    }
  }
  // the build crates, while their walks are still to build (the deep walk's once the reef walk's done)
  for (const def of WALKS) {
    const b = built[def.id] ?? 0;
    if (b >= 1 || (def.after && (built[def.after] ?? 0) < 1)) continue;
    const [cx, cz] = CRATES[def.id];
    // a step back from the crate toward the middle of the head, looking at it
    const mx = 55;
    const mz = 36.5;
    const l = Math.hypot(mx - cx, mz - cz);
    for (const r of [1.5, 1.8, 2.1]) {
      const x = cx + ((mx - cx) / l) * r;
      const z = cz + ((mz - cz) / l) * r;
      if (!standsAt(S, x, z, DECK)) continue;
      out.push(spot({ id: `crate:${def.id}`, label: `${def.id === 'reef' ? 'Reef' : 'Deep'} walk · build crate`, note: 'put in wood', kind: 'build', x, z, y: DECK, face: [cx, cz], tabs: ['pier'] }));
      break;
    }
  }
  return out;
}

/* ── the beach ─────────────────────────────────────────────────────────── */

/** Along the bay's shore every `step` m: dry sand just above the swash, looking out to sea. */
export function shoreSpots(w: SpotWorld, step = 16): Spot[] {
  const S = w.surfaces;
  const P = w.layout.pier;
  const out: Spot[] = [];
  for (let x = w.layout.beach.xMin + 8; x <= w.layout.beach.xMax - 8; x += step) {
    // clear of the pier's foot and the timber yard (they're spots of their own)
    if (Math.abs(x - P.x) < 6) continue;
    // the water's edge, coming down the beach from the village
    let zw: number | null = null;
    for (let z = -90; z < 40; z += 0.25)
      if (w.heightAt(x, z) <= 0) {
        zw = z;
        break;
      }
    if (zw === null) continue;
    // back up the sand to the first dry, clear footing
    for (let back = 1.2; back < 8; back += 0.3) {
      const z = zw - back;
      const g = S.groundAt(x, z);
      if (g.kind !== 'ground' || g.y < 0.45) continue;
      if (S.deckOver(x, z, 0.3) > g.y - 0.5) break; // under a boardwalk or the pier
      if (!standsAt(S, x, z, g.y)) continue;
      out.push(spot({ id: `shore:${Math.round(x)}`, label: 'The beach', note: 'cast from the sand', kind: 'fish', x, z, y: g.y, face: [x, z + 20], tabs: ['bay'] }));
      break;
    }
  }
  return out;
}

/* ── the village ───────────────────────────────────────────────────────── */

/** a building's name on the map */
export const BUILDING_NAMES: Record<string, string> = {
  S1: 'Home, your shack',
  S3: 'Tackle shop',
  S2: 'Bait shop',
  stall: 'Fish market',
  C: 'The Lucky Lure',
  B: "Reel 'Em In",
  G: 'The Card Shark',
  H: 'Island bank',
  J: 'Pawn shop',
  N: 'Island engineer',
  K: 'Taxidermist',
  A: 'Jeweller',
  L: "Villa Mar, Coral's",
  F: 'Carpenter',
  D: 'Florist',
  E: 'Boutique',
  boathouse: 'Boathouse',
};

/** a station in a room: where you stand (room-local, the room's inside size `w` × `d`) and what you face */
interface Station {
  label: string;
  note?: string;
  at: (w: number, d: number) => [number, number];
  face: (w: number, d: number) => [number, number];
}

const counter = (label: string, note?: string): Station => ({ label, note, at: (_w, d) => [0, -d / 2 + 2.0], face: (_w, d) => [0, -d / 2] });

/** what's in each room, and where to stand for it (the first is where the bay's chart takes you) */
const STATIONS: Record<string, Station[]> = {
  C: [
    { label: 'roulette', note: 'the wheel and the felt', at: () => [0.5, 0.62], face: () => [0.5, -2] },
    { label: 'the case wall', note: 'open a case', at: (w) => [w / 2 - 1.25, CASE_WALL_Z], face: (w) => [w / 2, CASE_WALL_Z] },
  ],
  G: [{ label: 'blackjack', note: 'take a seat at the table', at: () => [0, 0.38], face: () => [0, -2] }],
  B: [
    { label: 'slot one', note: 'the lever at your right hand', at: () => [-1.5 + 0.2, -1.1], face: () => [-1.5 + 0.2, -3] },
    { label: 'slot two', note: 'the lever at your right hand', at: () => [0.2, -1.1], face: () => [0.2, -3] },
    { label: 'slot three', note: 'the lever at your right hand', at: () => [1.5 + 0.2, -1.1], face: () => [1.5 + 0.2, -3] },
  ],
  H: [{ label: 'the counter', note: 'deposits, withdrawals', at: () => [0, 0.5], face: () => [0, -2] }],
  A: [
    counter('the counter'),
    { label: 'the pickaxe window', at: (w) => [w / 2 - 1.05, -0.45], face: (w) => [w / 2, -0.45] },
    { label: 'we buy gems', note: 'sell your stones', at: (w) => [w / 2 - 1.05, 0.75], face: (w) => [w / 2, 0.75] },
  ],
  S3: [
    counter('the counter', 'rods and reels'),
    { label: 'the rod rack', note: 'choose your rod', at: (_w, d) => [-0.5, Math.min(d / 2 - 0.62, 1.15)], face: (w, d) => [-w / 2, Math.min(d / 2 - 0.62, 1.15)] },
  ],
  S2: [counter('the counter', 'bait')],
  N: [counter('the counter', 'upgrades')],
  F: [counter('the counter', 'for your shack')],
  D: [counter('the counter', 'for your shack')],
  K: [counter('the counter', 'for your shack')],
  J: [counter('the counter', 'the camp map, and more')],
  E: [counter('the counter', 'for your shack')],
  L: [{ label: 'Coral', note: 'say hello', at: () => [-0.9, 0.45], face: () => [-1.8, -0.95] }],
};

/**
 * The village: a step inside each building's door, the stations in its room, the fish market's
 * scale and the timber yard's counter. The bay's chart marks each building once (its first
 * station, or its door); the village sheet marks every station in the building's plan.
 */
export function villageSpots(w: SpotWorld): Spot[] {
  const S = w.surfaces;
  const out: Spot[] = [];
  for (const b of w.buildings) {
    const name = BUILDING_NAMES[b.name];
    if (!name) continue;
    if (hasInterior(b.name)) {
      const iw = b.w - 0.34;
      const id = b.d - 0.34;
      const stations = STATIONS[b.name] ?? [];
      // a step in from the door, looking in (the bay's chart goes to the first station, or here)
      const door = ((): Spot | null => {
        for (const inset of [1.0, 1.25, 0.8, 1.5]) {
          const [x, z] = frameXZ(b, b.doorX, id / 2 - inset);
          if (!standsAt(S, x, z, b.floorY)) continue;
          return spot({ id: `door:${b.name}`, label: name, note: 'just inside the door', kind: 'place', x, z, y: b.floorY, face: frameXZ(b, b.doorX, -id / 2), tabs: stations.length ? ['village'] : ['village', 'bay'], building: b.name });
        }
        return null;
      })();
      if (door) out.push(door);
      stations.forEach((st, i) => {
        const [lx, lz] = st.at(iw, id);
        const [fx, fz] = st.face(iw, id);
        // nudge in small steps if the exact spot's crowded (a counter's lip, a table's edge)
        for (const [dx, dz] of [[0, 0], [0, 0.12], [0, 0.24], [0.12, 0], [-0.12, 0], [0, -0.12]]) {
          const [x, z] = frameXZ(b, lx + dx, lz + dz);
          if (!standsAt(S, x, z, b.floorY, 0.2)) continue;
          out.push(spot({ id: `st:${b.name}:${i}`, label: `${name} · ${st.label}`, note: st.note, kind: 'station', x, z, y: b.floorY, face: frameXZ(b, fx, fz), tabs: i === 0 ? ['village', 'bay'] : ['village'], building: b.name }));
          return;
        }
      });
      continue;
    }
    if (b.name === 'stall') {
      // the fish market: at the scale (hold a fish over its pan to sell it), the SELL ALL board above
      for (const [lx, lz] of [[1.8, 1.7], [1.6, 1.9], [1.8, 2.1]]) {
        const [x, z] = frameXZ(b, lx, lz);
        const a = floorAt(S, x, z);
        if (!standsAt(S, x, z, a.y)) continue;
        out.push(spot({ id: 'st:stall', label: name, note: 'the scale, and SELL ALL', kind: 'station', x, z, y: a.y, face: frameXZ(b, 2.0, 0.72), tabs: ['village', 'bay'], building: b.name }));
        break;
      }
    }
  }
  // the timber yard: at its counter (it faces +x), and the east woodlot by its log pile
  out.push(...placed(S, 'yard', 'Timber yard', 'axes, log bundles', 'station', [YARD[0] + 2.6, YARD[1]], YARD, ['village', 'bay']));
  out.push(...placed(S, 'woodlot', 'East woodlot', 'the log pile', 'wood', [EAST_PILE[0] - 2.5, EAST_PILE[1] + 2.5], [118, -86], ['village', 'bay']));
  return out;
}

/** A single spot at (x, z) on whatever floor's there, if you can stand on it (else nearby). */
function placed(S: Surfaces, id: string, label: string, note: string | undefined, kind: SpotKind, at: [number, number], face: [number, number], tabs: MapTab[]): Spot[] {
  for (let r = 0; r <= 1.2; r += 0.3)
    for (let k = 0; k < (r ? 8 : 1); k++) {
      const x = at[0] + Math.cos((k / 8) * TAU) * r;
      const z = at[1] + Math.sin((k / 8) * TAU) * r;
      const a = floorAt(S, x, z);
      if (standsAt(S, x, z, a.y)) return [spot({ id, label, note, kind, x, z, y: a.y, face, tabs })];
    }
  return [];
}

/**
 * A step from something you work on with your hands (a tree, a rock, a chest): `reach` m from its
 * centre, on whichever side you can stand, the side toward `prefer` first, looking at it.
 */
function beside(S: Surfaces, id: string, label: string, note: string | undefined, kind: SpotKind, c: [number, number], reach: number, prefer: [number, number] | null, tabs: MapTab[]): Spot[] {
  const a0 = prefer ? Math.atan2(prefer[1] - c[1], prefer[0] - c[0]) : 0;
  for (const r of [reach, reach + 0.3, reach + 0.6])
    for (let k = 0; k < 12; k++) {
      // alternate either side of the preferred direction, nearest first
      const t = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (TAU / 12);
      const x = c[0] + Math.cos(t) * r;
      const z = c[1] + Math.sin(t) * r;
      const a = floorAt(S, x, z);
      if (a.kind !== 'ground' && a.kind !== 'deck') continue;
      if (standsAt(S, x, z, a.y)) return [spot({ id, label, note, kind, x, z, y: a.y, face: c, tabs })];
    }
  return [];
}

/** A step from each of the woodlots' trees (the axe comes out within 7 m; a chop wants ~1 m). */
export function treeSpots(w: SpotWorld): Spot[] {
  const S = w.surfaces;
  const out: Spot[] = [];
  WEST_TREES.forEach((t, i) => out.push(...beside(S, `tree:w${i}`, 'Almond tree', 'swing the axe', 'wood', t, 1.15, YARD, ['village'])));
  EAST_TREES.forEach((t, i) => out.push(...beside(S, `tree:e${i}`, 'Almond tree', 'swing the axe', 'wood', t, 1.15, EAST_PILE, ['village'])));
  return out;
}

/* ── the wilds, and what comes later ───────────────────────────────────── */

/** Where you stand at a camp: just outside its chest, looking across it to the fire. */
export function campSpot(S: Surfaces, c: CampSite): Spot[] {
  const r = CHEST_R + 1.25;
  const out = beside(S, `camp:${c.id}`, c.name, 'the chest, and the fire', 'camp', [c.x, c.z], r, [c.x + Math.cos(c.chestAt) * r, c.z + Math.sin(c.chestAt) * r], ['island', 'bay']);
  for (const s of out) s.face = [c.x, c.z];
  return out;
}

/** The spots that open up as you go: the walks, the camps, the rocks, the helter skelter, the statue. */
export function progressSpots(w: SpotWorld, p: SpotProgress): Spot[] {
  const S = w.surfaces;
  const out: Spot[] = [...walkSpots(w, p.walks)];
  if (p.skelterGate) out.push(...placed(S, 'skelter', 'Helter skelter', 'ride to the top', 'sight', p.skelterGate.at, p.skelterGate.face, ['island', 'bay', 'village']));
  if (p.statue) out.push(...placed(S, 'statue', 'The golden statue', 'read the plaque', 'sight', STATUE_STAND, [STATUE.x, STATUE.z], ['bay', 'village']));
  const allFound = CAMPS.every((c) => p.campsFound.has(c.id));
  for (const c of ALL_CAMPS) {
    if (c === BEACH_CAMP ? !allFound : !(p.campsFound.has(c.id) || p.campMap)) continue;
    out.push(...campSpot(S, c));
  }
  if (p.pick)
    for (const r of ROCK_SITES) {
      if (p.rocksMined.has(r.id) || !p.rocksSeen.has(r.id)) continue;
      out.push(...beside(S, `rock:${r.id}`, 'Gem rock', 'swing the pick', 'rock', [r.x, r.z], ROCK_R * r.size + 0.75, null, ['island', 'bay']));
    }
  return out;
}

/** Every spot that's there from the start (the walks', camps' and rocks' come with `progressSpots`). */
export function staticSpots(w: SpotWorld): Spot[] {
  return [...pierSpots(w), ...shoreSpots(w), ...villageSpots(w), ...treeSpots(w)];
}

/**
 * A free point: anywhere else on dry land (or a deck) you point at, if you can stand there and it
 * isn't inside a building (a building's own spots go in through its door). You arrive looking the
 * way you travelled.
 */
export function freePoint(w: SpotWorld, x: number, z: number, from: [number, number]): Spot | null {
  const S = w.surfaces;
  for (const b of w.buildings) if (inBuilding(b, x, z, 0.4)) return null;
  const a = floorAt(S, x, z);
  if (a.kind === 'water' || !standsAt(S, x, z, a.y, 0.2)) return null;
  let fx = x - from[0];
  let fz = z - from[1];
  const l = Math.hypot(fx, fz);
  if (l < 0.5) return null;
  fx /= l;
  fz /= l;
  return { id: 'free', label: a.kind === 'deck' ? 'Here' : 'Over here', kind: 'place', x, z, y: a.y, face: [x + fx * 10, z + fz * 10], tabs: [] };
}

/** the rocks within this of you count as seen (m): you'd have spotted the glowing veins */
export const ROCK_SEEN_R = 45;
