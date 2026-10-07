#!/usr/bin/env node
/**
 * THE TRAVEL MAP's spots, headless.
 *
 *   npm run bake
 *   node tools/map-check.mjs
 *
 * Drives the SAME locomotion/spots.ts the headset runs (Node strips the types) against the baked
 * island, built into floors and walls the way main.ts builds them, and checks what a player would
 * notice if a spot were wrong:
 *
 *   1. THE PIER. Both rails have a run of spots wherever there's water under them, each a hand's
 *      breadth from the rail, on the deck, looking straight out over the water; the head has its
 *      far end, its west side and its back covered; nothing lands in the clutter on the head.
 *   2. THE BEACH. Spots along the bay's shore on dry sand, above the swash, looking out to sea.
 *   3. THE VILLAGE. Every building has its spot; every station is on its room's floor, inside its
 *      walls, in reach of what it's for (the tables, the slot levers, the counters, the windows).
 *   4. THE WILDS. A spot by every woodlot tree; every camp's chest within the chest's opening
 *      reach; every gem rock (once seen) within the pick's reach.
 *   5. EVERY SPOT. Standable, clear of walls, unique ids, facing somewhere.
 *   6. FREE POINTS. Dry land is a free point; the sea, and the inside of a building, are not.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeTerrain } from '../src/world/data.ts';
import { Heightfield } from '../src/world/heightfield.ts';
import { Surfaces } from '../src/world/surfaces.ts';
import { openColliders } from '../src/village/interiors.ts';
import { cutGates, CRATES } from '../src/woodworks/gates.ts';
import { ALL_CAMPS, CAMPS, CHEST_R } from '../src/camps/sites.ts';
import { ROCK_R, ROCK_SITES } from '../src/mining/sites.ts';
import { EAST_TREES, WEST_TREES } from '../src/woodworks/lots.ts';
import { campSpot, freePoint, frameXZ, inBuilding, pierSpots, progressSpots, RAIL_GAP, shoreSpots, standsAt, staticSpots, toFrame, treeSpots, villageSpots } from '../src/locomotion/spots.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = JSON.parse(readFileSync(resolve(ROOT, 'public/world/world.json'), 'utf8'));
const tb = readFileSync(resolve(ROOT, 'public/world/terrain.bin'));
const hf = new Heightfield(decodeTerrain(json, tb.buffer.slice(tb.byteOffset, tb.byteOffset + tb.byteLength)));
const S = new Surfaces(hf, { boxes: cutGates(openColliders(json.colliders.boxes, json.buildings)), cylinders: json.colliders.cylinders });
const W = { layout: json.layout, buildings: json.buildings, heightAt: (x, z) => hf.heightAt(x, z), surfaces: S };

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
};
const f2 = (v) => v.toFixed(2);
const yawTo = (s) => Math.atan2(s.face[0] - s.x, s.face[1] - s.z);

console.log('1. the pier');
const P = json.layout.pier;
const pier = pierSpots(W);
{
  const west = pier.filter((s) => s.id.startsWith('pier:west'));
  const east = pier.filter((s) => s.id.startsWith('pier:east'));
  check('a run of spots down the west rail', west.length >= 12, west.length);
  check('a run of spots down the east rail', east.length >= 12, east.length);
  const rails = [...west, ...east];
  check('every rail spot is on the deck', rails.every((s) => Math.abs(S.areaNear(s.x, s.z, s.y).y - P.deckHeight) < 0.02));
  const railFace = (s) => Math.abs(Math.abs(s.x - P.x) - (P.width / 2 + 0.17 - 0.09)) ;
  check('a hand’s breadth from the rail', rails.every((s) => Math.abs(railFace(s) - RAIL_GAP) < 0.02), f2(railFace(rails[0])));
  check('looking straight out over the rail', rails.every((s) => Math.abs(s.face[1] - s.z) < 1e-6 && Math.sign(s.face[0] - s.x) === Math.sign(s.x - P.x)));
  check('water under every one', rails.every((s) => hf.heightAt(s.x + Math.sign(s.x - P.x) * 1.5, s.z) < -0.5));
  const zs = west.map((s) => s.z).sort((a, b) => a - b);
  check('…from the waterline right out to the head', zs[0] < -30 && zs[zs.length - 1] > 28, `${f2(zs[0])} … ${f2(zs[zs.length - 1])}`);
  const head = pier.filter((s) => s.id.startsWith('head:'));
  const named = (n) => head.filter((s) => s.label.endsWith(n)).length;
  check('the head’s far end', named('far end') >= 3, named('far end'));
  check('the head’s west side', named('west side') >= 2, named('west side'));
  check('the head’s back, either side of the walk', named('back') >= 3, named('back'));
  check('every head spot faces out off the head', head.every((s) => {
    const fx = s.face[0] - s.x;
    const fz = s.face[1] - s.z;
    return (fz > 0 && s.z > 38) || (fx < 0 && s.x < 50) || (fx > 0 && s.x > 60) || (fz < 0 && s.z < 35);
  }));
  check('none on a build crate', head.every((s) => Object.values(CRATES).every(([cx, cz]) => Math.hypot(s.x - cx, s.z - cz) > 0.6)));
  check('the end of the pier is still on the bay’s chart', pier.some((s) => s.id === 'pier:end' && s.tabs.includes('bay')));
}

console.log('\n2. the beach');
{
  const shore = shoreSpots(W);
  check('spots along the bay’s shore', shore.length >= 10, shore.length);
  check('dry sand, above the swash', shore.every((s) => hf.heightAt(s.x, s.z) > 0.4), f2(Math.min(...shore.map((s) => hf.heightAt(s.x, s.z)))));
  check('the water a few steps in front', shore.every((s) => hf.heightAt(s.x, s.z + 9) < 0), shore.filter((s) => hf.heightAt(s.x, s.z + 9) >= 0).map((s) => s.id).join(' '));
  check('looking out to sea', shore.every((s) => s.face[1] > s.z && Math.abs(s.face[0] - s.x) < 1e-6));
}

console.log('\n3. the village');
const village = villageSpots(W);
{
  const byB = (n) => village.filter((s) => s.building === n);
  for (const b of json.buildings) {
    if (b.name === 'boathouse') continue;
    check(`${b.name}: has a spot`, byB(b.name).length > 0, byB(b.name).map((s) => s.label).join(' / '));
  }
  // a station inside its room's walls, on the room's floor
  const rooms = village.filter((s) => s.kind === 'station' && s.building && s.building !== 'stall');
  check('every room station is on its room’s floor, inside its walls', rooms.every((s) => {
    const b = json.buildings.find((k) => k.name === s.building);
    return inBuilding(b, s.x, s.z, -0.3) && Math.abs(s.y - b.floorY) < 0.02;
  }));
  const local = (s) => toFrame(json.buildings.find((k) => k.name === s.building), s.x, s.z);
  const st = (id) => village.find((s) => s.id === id);
  // the casinos: within arm's reach of the felt / the lever
  const rou = st('st:C:0');
  check('roulette: at the table’s edge', rou && Math.abs(local(rou)[1] - (-0.6 + 0.52)) < 0.9 && local(rou)[1] > -0.08, rou && local(rou).map(f2).join(', '));
  const bj = st('st:G:0');
  check('blackjack: at the player’s edge', bj && local(bj)[1] - -0.23 > 0.2 && local(bj)[1] - -0.23 < 0.8, bj && local(bj).map(f2).join(', '));
  for (const [i, mx] of [[0, -1.5], [1, 0], [2, 1.5]]) {
    const s = st(`st:B:${i}`);
    const b = json.buildings.find((k) => k.name === 'B');
    const d = b.d - 0.34;
    // the lever's knob: machine x + 0.42, 1.3 up, a little in front of the machine (z −d/2+0.28)
    const knob = [mx + 0.42, -d / 2 + 0.28 + 0.1];
    const reach = s ? Math.hypot(local(s)[0] - knob[0], local(s)[1] - knob[1]) : 99;
    check(`slot ${i + 1}: the lever in reach`, reach < 0.75, f2(reach));
  }
  const bank = st('st:H:0');
  check('bank: at the counter', bank && local(bank)[1] > -0.2 && local(bank)[1] < 1.0, bank && local(bank).map(f2).join(', '));
  for (const id of ['st:A:1', 'st:A:2']) {
    const s = st(id);
    const b = json.buildings.find((k) => k.name === 'A');
    check(`${s?.label}: at the side counter`, s && (b.w - 0.34) / 2 - 0.27 * 2 - local(s)[0] < 0.9, s && local(s).map(f2).join(', '));
  }
  const rack = st('st:S3:1');
  check('the rod rack: in front of it', !!rack, rack && local(rack).map(f2).join(', '));
  const market = st('st:stall');
  const stall = json.buildings.find((k) => k.name === 'stall');
  const pan = frameXZ(stall, 2.0, 0.74);
  check('the fish market: the scale’s pan within reach', market && Math.hypot(market.x - pan[0], market.z - pan[1]) < 1.2, market && f2(Math.hypot(market.x - pan[0], market.z - pan[1])));
  check('the bay’s chart marks each building once', json.buildings.every((b) => b.name === 'boathouse' || village.filter((s) => s.building === b.name && s.tabs.includes('bay')).length === 1));
}

console.log('\n4. the wilds');
{
  const trees = treeSpots(W);
  check('a spot by every woodlot tree', trees.length === WEST_TREES.length + EAST_TREES.length, `${trees.length}/${WEST_TREES.length + EAST_TREES.length}`);
  check('…within a swing of its trunk', trees.every((s) => Math.hypot(s.face[0] - s.x, s.face[1] - s.z) < 1.9));
  let ok = 0;
  const far = [];
  for (const c of ALL_CAMPS) {
    const s = campSpot(S, c)[0];
    if (!s) {
      far.push(`${c.id}:none`);
      continue;
    }
    const chest = [c.x + Math.cos(c.chestAt) * CHEST_R, c.z + Math.sin(c.chestAt) * CHEST_R];
    const d = Math.hypot(s.x - chest[0], s.z - chest[1]);
    if (d < 2.6) ok++;
    else far.push(`${c.id}:${f2(d)}`);
  }
  check('every camp: a spot within the chest’s reach (3 m)', ok === ALL_CAMPS.length, far.join(' ') || `${ok}`);
  const p = { walks: { reef: 1, deep: 1 }, skelterGate: null, statue: true, campsFound: new Set(CAMPS.map((c) => c.id)), campMap: true, pick: true, rocksMined: new Set(), rocksSeen: new Set(ROCK_SITES.map((r) => r.id)) };
  const later = progressSpots(W, p);
  const rocks = later.filter((s) => s.kind === 'rock');
  check('a spot by every gem rock, once seen', rocks.length === ROCK_SITES.length, `${rocks.length}/${ROCK_SITES.length}`);
  const rockFar = rocks.filter((s) => {
    const r = ROCK_SITES.find((k) => `rock:${k.id}` === s.id);
    return Math.hypot(s.x - r.x, s.z - r.z) > ROCK_R * r.size + 1.4;
  });
  check('…within a swing of it', rockFar.length === 0, rockFar.map((s) => s.id).join(' '));
  check('none of them till they’re seen', progressSpots(W, { ...p, rocksSeen: new Set() }).every((s) => s.kind !== 'rock'));
  check('none of them without the pick', progressSpots(W, { ...p, pick: false }).every((s) => s.kind !== 'rock'));
  check('camps: only the found ones without the map', progressSpots(W, { ...p, campMap: false, campsFound: new Set([CAMPS[0].id]) }).filter((s) => s.kind === 'camp').length === 1);
  check('the statue, once it’s up', later.some((s) => s.id === 'statue'));
}

console.log('\n5. every spot');
{
  const all = staticSpots(W);
  const ids = new Set();
  let dup = 0;
  for (const s of all) {
    if (ids.has(s.id)) dup++;
    ids.add(s.id);
  }
  check('unique ids', dup === 0, `${all.length} spots`);
  const bad = all.filter((s) => !standsAt(S, s.x, s.z, s.y, 0.2));
  check('standable, clear of walls', bad.length === 0, bad.map((s) => s.id).join(' '));
  check('every spot faces somewhere', all.every((s) => Math.hypot(s.face[0] - s.x, s.face[1] - s.z) > 0.2 && Number.isFinite(yawTo(s))));
  check('every spot is on a sheet', all.every((s) => s.tabs.length > 0));
}

console.log('\n6. free points');
{
  check('dry beach is a free point', !!freePoint(W, -60, -60, [55, -77]));
  check('the sea is not', !freePoint(W, 0, 40, [55, -77]));
  const b = json.buildings.find((k) => k.name === 'C');
  check('inside a building is not (its door is)', !freePoint(W, b.x, b.z, [55, -77]));
  const fp = freePoint(W, -60, -60, [55, -77]);
  check('you arrive looking the way you went', fp && fp.face[0] < fp.x);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
