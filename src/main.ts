/**
 * FISH & CHIPS — How to Fish, in VR, on Tidewater's island.
 *
 * Boot: IWSDK world (VR, no built-in locomotion — you get about by pointing
 * at the travel map, see locomotion/TravelMap.ts), then the baked island
 * streams in: sky, terrain, sea, village. The player starts where Tidewater
 * starts you — on the boardwalk above the pier, looking down it to the sea —
 * with a rod in hand (fishing/FishingSystem.ts) and a wallet on each wrist.
 */

import { createSystem, launchXR, SessionMode, World } from '@iwsdk/core';
import { Vector3, type Camera, type PerspectiveCamera } from 'three';
import { Music } from './audio/music.ts';
import { ShoreSound } from './audio/shore.ts';
import { ensureAudio, uiDeny } from './audio/sfx.ts';
import { BackpackSystem, backpackDeps, backpackView } from './backpack/BackpackSystem.ts';
import type { Place } from './backpack/chart.ts';
import { FishingSystem, fishingDeps, fishingView } from './fishing/FishingSystem.ts';
import { loadProps } from './fishing/props.ts';
import { createGameState } from './fishing/tidewater.ts';
import { warmUp, warmUpNow } from './fx/warm.ts';
import { WristWallet } from './ui/wallet.ts';
import { WaterFx } from './fx/water.ts';
import { locomotion, teleportView, TeleportSystem } from './locomotion/TeleportSystem.ts';
import { TravelMap, travelMapDeps, travelMapView } from './locomotion/TravelMap.ts';
import { CAMP_MAP } from './backpack/fieldGuide.ts';
import { decodeTerrain, type BoxCollider, type WorldJson } from './world/data.ts';
import { Heightfield } from './world/heightfield.ts';
import { Ocean } from './world/ocean.ts';
import { createSky } from './world/sky.ts';
import { Clouds } from './world/clouds.ts';
import { Hawks } from './world/hawks.ts';
import { Surfaces } from './world/surfaces.ts';
import { buildTerrain } from './world/terrain.ts';
import { Grass } from './world/grass.ts';
import { VillageSigns, type BuildingFrame } from './village/signs.ts';
import { FishMarket } from './village/market.ts';
import { IslandBank } from './village/bank.ts';
import { bankDeps, bootBank } from './net/bank.ts';
import { bootCloudSave } from './net/cloudSave.ts';
import { RouletteTable } from './casino/RouletteTable.ts';
import { SlotMachine } from './casino/SlotMachine.ts';
import { casinoEnv } from './casino/look.ts';
import { BlackjackTable } from './casino/BlackjackTable.ts';
import { CaseWall } from './casino/CaseWall.ts';
import { PointerSystem } from './ui/pointer.ts';
import { buildInteriors, interiorAt, openColliders, type Interior } from './village/interiors.ts';
import { GOODS, HOME, HOME_SHOPS, HomeShopCounter, Shack, VILLA, VILLA_SHOPS } from './village/homeGoods.ts';
import { campMapSource } from './village/wares/pawn.ts';
import { GearShopCounter, RodRackBoard } from './village/gearShop.ts';
import { CASE_WALL_Z, GEAR_COUNTERS, JEWELLER } from './village/interiors.ts';
import { GemWindows } from './village/gemWindows.ts';
import { Villa } from './village/villa.ts';
import { Blink } from './fx/blink.ts';
import { Vegetation } from './world/vegetation.ts';
import { buildVillage } from './world/village.ts';
import { buildLamps } from './world/lamps.ts';
import { runBootIntro } from './experience/bootIntro.ts';
import { cutGates } from './woodworks/gates.ts';
import { WoodSystem, woodDeps, woodView } from './woodworks/woodSystem.ts';
import { SkelterSystem, skelterDeps, skelterView } from './skelter/SkelterSystem.ts';
import { SKELTER } from './skelter/site.ts';
import { CampSystem, campDeps, campView } from './camps/CampSystem.ts';
import { MiningSystem, mineDeps, mineView } from './mining/MiningSystem.ts';
import { Statue } from './statue/statue.ts';
import { onFontsReady } from './ui/fonts.ts';
import { drawLogo, drawLogoFish, hasLogoFish, setLogoFish } from './ui/logo.ts';
import { thumbnail } from './ui/thumbnail.ts';

/** out at sea past the bay, where nothing grows: the plants are picked round here while you're high up
 *  the helter skelter (none near, so every tree is its far card) */
const OFFSHORE = { x: 0, z: 700 };

/** ff2's fixed-foveation level: sharp centre, cheap rim. */
const FOVEATION = 0.33;

const container = document.getElementById('scene-container') as HTMLDivElement;
/** per-frame work for the village's people and counters (set once they're built) */
let villageTick: (dt: number) => void = () => {};
const status = document.getElementById('status') as HTMLElement;
const enter = document.getElementById('enter-vr') as HTMLButtonElement;
const bar = document.getElementById('bar-fill') as HTMLElement;

// the splash's mark (index.html shows it after the publisher card), repainted once the type is
// in; its leaping fish is the real sailfish, laid over it and faded in once the models load
const logo = document.getElementById('logo') as HTMLCanvasElement | null;
const logoFish = document.getElementById('logo-fish') as HTMLCanvasElement | null;
const paintLogo = (): void => {
  const g = logo?.getContext('2d');
  if (g && logo) {
    g.clearRect(0, 0, logo.width, logo.height);
    drawLogo(g, logo.width, logo.height, true, false);
  }
  const f = logoFish?.getContext('2d');
  if (f && logoFish && hasLogoFish()) {
    f.clearRect(0, 0, logoFish.width, logoFish.height);
    drawLogoFish(f, logoFish.width, logoFish.height);
    logoFish.classList.add('in');
  }
};
paintLogo();
onFontsReady(paintLogo);

/**
 * The loading bar, 0 to 1, and it never goes back. index.html creeps it along on its own until the
 * code is in; from the first call here it's the real thing: the code (to 0.2), the island's files
 * (to 0.7), then the build (to 1).
 */
let shown = 0;
const progress = (f: number): void => {
  if (bar.style.animation !== 'none') {
    // take over from the creep where it's got to
    const t = getComputedStyle(bar).transform;
    shown = t.startsWith('matrix(') ? parseFloat(t.slice(7)) || 0 : 0;
    bar.style.animation = 'none';
  }
  shown = Math.max(shown, Math.min(1, f));
  bar.style.transform = `scaleX(${shown})`;
};
/** A build step's done: move the bar and let the page draw before the next (one long block froze the splash) */
const built = (f: number): Promise<void> => {
  progress(0.7 + 0.3 * f);
  return new Promise((r) => window.setTimeout(r, 0));
};

async function fetchBuffer(path: string, onProgress: (f: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(import.meta.env.BASE_URL + path);
  if (!res.ok || !res.body) throw new Error(`${path}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total) onProgress(got / total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out.buffer;
}

World.create(container, {
  // The Enter VR button calls IWSDK's explicit WebXR launcher from the
  // user's tap — Quest Browser needs that direct requestSession gesture.
  xr: { sessionMode: SessionMode.ImmersiveVR, offer: 'none' },
  features: { locomotion: false, grabbing: false, spatialUI: false },
  render: {
    defaultLighting: false,
    // 10 cm, not 5: the depth buffer's precision everywhere doubles with it, and surfaces laid
    // close over others (a rug on a floor, a floor on Tidewater's) stop fighting at a distance
    near: 0.1,
    far: 6000,
    camera: { position: [0, 1.6, 0] },
  },
}).then(async (world) => {
  world.renderer.xr.setFoveation(FOVEATION);

  status.textContent = 'Loading the island…';
  progress(0.2);
  const got = { terrain: 0, village: 0, props: 0, veg: 0 };
  const show = (): void => progress(0.2 + 0.5 * ((got.terrain + got.village + got.props + got.veg) / 4));
  const [json, terrainBuf, villageBuf, propsBuf, vegBuf] = await Promise.all([
    fetch(import.meta.env.BASE_URL + 'world/world.json').then((r) => r.json() as Promise<WorldJson>),
    fetchBuffer('world/terrain.bin', (f) => ((got.terrain = f), show())),
    fetchBuffer('world/village.bin', (f) => ((got.village = f), show())),
    fetchBuffer('props/props.bin', (f) => ((got.props = f), show())),
    fetchBuffer('world/veg.bin', (f) => ((got.veg = f), show())),
  ]);

  status.textContent = 'Building the island…';
  await built(0);
  const grid = decodeTerrain(json, terrainBuf);
  const scene = world.scene;
  // not drawn while it's half built (the splash covers it, and the frames between the steps come quicker)
  scene.visible = false;
  const sky = createSky(scene);
  scene.add(buildTerrain(grid));
  await built(0.05);
  scene.add(buildVillage(villageBuf, sky.state.night));
  const lamps = buildLamps((json as unknown as { lamps?: [number, number, number, string][] }).lamps ?? [], sky.state.night);
  scene.add(lamps);
  const signs = new VillageSigns((json as unknown as { buildings: BuildingFrame[] }).buildings ?? [], (json as unknown as { pierSign?: [number, number, number] | null }).pierSign ?? null);
  scene.add(signs.group);
  await built(0.1);
  const vegetation = new Vegetation(vegBuf);
  scene.add(vegetation.group);
  const grass = vegetation.grassMask ? new Grass(vegetation.atlas, vegetation.grassMask, vegetation.grassRes, new Heightfield(grid), grid) : null;
  if (grass) scene.add(grass.mesh);
  const ocean = new Ocean(grid, sky.state);
  scene.add(ocean.mesh);
  const clouds = new Clouds(sky.state);
  scene.add(clouds.mesh);
  const t0 = performance.now();
  let lastT = 0;
  ocean.mesh.onBeforeRender = (_r, _s, camera: Camera) => {
    const t = (performance.now() - t0) / 1000;
    const dt = Math.min(0.05, Math.max(0, t - lastT));
    // the day goes on (sky, sea, lights); the lamps are lit from dusk to dawn
    sky.update(dt);
    lamps.visible = sky.state.night.value > 0.01;
    villageTick(dt);
    lastT = t;
    clouds.update(dt, camera);
    ocean.update(t, camera);
    // up the helter skelter the plants and the grass stay picked round its tower, not round you;
    // and up in its first two tiers, 100 m and more over them, round nothing at all (out at sea):
    // from up there the near plants were specks, a couple of hundred thousand triangles of them
    const hold = skelterView.high ? OFFSHORE : skelterView.onTower ? SKELTER : null;
    vegetation.update(t, camera, hold);
    grass?.update(t, camera, hold);
    signs.update(1 / 72);
  };

  const heightfield = new Heightfield(grid);
  // the walk-in buildings: their bodies open up (walls, a door gap, a floor) and get a room inside
  const frames = (json as unknown as { buildings: BuildingFrame[] }).buildings ?? [];
  await built(0.15);
  const interiors = buildInteriors(frames);
  for (const i of interiors) scene.add(i.group);
  await built(0.25);
  // (the pier head's rails open at the gateways of the walks you can build: woodworks/gates.ts)
  const surfaces = new Surfaces(heightfield, { boxes: cutGates(openColliders(json.colliders.boxes, frames)), cylinders: json.colliders.cylinders });
  locomotion.surfaces = surfaces;
  if (grass) grass.floorOver = (x, z, m) => surfaces.deckOver(x, z, m);
  world.registerSystem(TeleportSystem);
  // Tidewater's start: the boardwalk up from the pier foot, looking down it (set now, so the
  // systems see you there through the rest of the build)
  const s = json.layout.start;
  world.player.position.set(s.x, surfaces.floorYAt(s.x, s.z, 10), s.z);
  world.player.rotation.set(0, s.yaw, 0);

  // the fishing: Tidewater's rules and save, the rod in your hand, the wallet on your wrists
  const game = createGameState();
  // the backpack's grid is the limit on what you carry now, not the hold's kilograms
  game.fits = () => true;
  // the account: the cloud save first (a new headset takes the account's), then collect anything bought while away
  bankDeps.state = game;
  void bootCloudSave(game).then(() => bootBank());
  const fx = new WaterFx((x, z) => ocean.heightAt(x, z), ocean.swell);
  scene.add(fx.group);
  const wallet = new WristWallet(game, [world.player.raySpaces.left, world.player.raySpaces.right]);
  // the boards round the island hear about a change a few a frame, not all in one (fishing/tidewater.ts)
  world.registerSystem(
    class extends createSystem({}) {
      update(): void {
        game.deliver();
      }
    },
  );
  const props = loadProps(propsBuf);
  // the silvery fish reflect the casinos' studio light (a soft, neutral room)
  props.setEnv(casinoEnv(world.renderer));
  // the fish's skin: its shader built behind the boot intro, and kept (a fish of its own that's
  // never let go): a landed fish's material is let go as it goes into your hand, and with none
  // left the shader went too, built again then and there for the next (fx/warm.ts)
  warmUp(props.makeFish('silverside').mesh);
  await built(0.35);
  // the mark's leaping fish: the sailfish, sail up, mid-thrash, photographed side on
  {
    const { mesh, uniforms } = props.makeFish('sailfish');
    uniforms.uSwim.value = 0.1;
    uniforms.uFreq.value = 1;
    uniforms.uTime.value = 0.12;
    mesh.rotation.y = Math.PI / 2;
    setLogoFish(thumbnail(world.renderer, mesh, { w: 1024, h: 420, dir: new Vector3(0.06, 0.1, 1).normalize() }));
    mesh.material.dispose();
    paintLogo();
  }
  await built(0.45);
  Object.assign(fishingDeps, { props, state: game, ocean, terrain: heightfield, surfaces, layout: json.layout, wallet, fx, night: sky.state.night });
  backpackDeps.chart = { heightAt: (x, z) => heightfield.heightAt(x, z), layout: json.layout, buildings: frames };
  // the travel map: the only way about the island (point at a spot on it and you're there)
  Object.assign(travelMapDeps, {
    world: { layout: json.layout, buildings: frames, heightAt: (x: number, z: number) => heightfield.heightAt(x, z), surfaces },
    chart: backpackDeps.chart,
    progress: () => ({
      walks: woodView.walks?.() ?? {},
      skelterGate: (woodView.walks?.().deep ?? 0) >= 1 ? (skelterView.gate ?? null) : null,
      statue: game.journey.unveiled,
      campsFound: new Set(Object.entries(game.camps).filter(([, c]) => c.found).map(([id]) => id)),
      campMap: game.home.includes(CAMP_MAP),
      pick: game.gems.pick,
      rocksMined: new Set(Object.keys(game.gems.mined)),
      rocksSeen: new Set<string>(),
    }),
    go: (spot: { x: number; z: number; y: number; face: [number, number] }) => {
      blink.fire();
      teleportView.travel?.(spot.x, spot.z, Math.atan2(-(spot.face[0] - spot.x), -(spot.face[1] - spot.z)), spot.y);
    },
    blocked: () => {
      const st = fishingView.state?.();
      if (st === 'fighting') return 'Land your fish first';
      if (st === 'landing') return 'Put your catch away first';
      if (skelterView.onTower) return 'Slide back down first';
      return null;
    },
    busy: () => backpackView.open,
  });
  // point-and-click panels first: a hand on a button claims its trigger before fishing sees it
  // (and the map's one of them: pointing at it never casts)
  world.registerSystem(PointerSystem);
  world.registerSystem(TravelMap);
  world.registerSystem(FishingSystem);
  backpackDeps.state = game;
  backpackDeps.props = fishingDeps.props;
  // (and the pawn shop's map of the camps draws the same island)
  campMapSource.chart = backpackDeps.chart;
  backpackDeps.where = () => world.camera.getWorldPosition(new Vector3());
  // (and the helter skelter, once it's up, and the golden statue once it's unveiled)
  backpackDeps.walks = () => ({ ...(woodView.walks?.() ?? {}), skelter: skelterView.progress(), statue: game.journey.unveiled ? 1 : 0 });
  backpackDeps.skelter = () => skelterView.gate;
  // no backpack up the helter skelter
  backpackDeps.blocked = () => skelterView.onTower;
  // the chart's places: point at one in the field guide and you're there
  backpackDeps.travel = (p) => {
    const st = fishingView.state?.();
    const spot = st === 'fighting' || st === 'landing' ? null : spotFor(p);
    if (!spot || !teleportView.travel) {
      uiDeny();
      return false;
    }
    blink.fire();
    teleportView.travel(spot.x, spot.z, Math.atan2(-(spot.face[0] - spot.x), -(spot.face[1] - spot.z)), spot.y);
    return true;
  };
  /**
   * Where you land for a place on the chart, and what you're looking at: inside a room a step in
   * from its door, looking in; at a building without one, in front of it (or beside it, wherever
   * there's dry ground first), looking at it; at a spot, where it says to stand.
   */
  const spotFor = (p: Place): { x: number; z: number; y: number; face: [number, number] } | null => {
    if (!p.building) {
      const [x, z] = p.stand ?? p.at!;
      const area = surfaces.areaNear(x, z, 2.3);
      return surfaces.standable(area, x, z) ? { x, z, y: area.y, face: p.face ?? p.at! } : null;
    }
    const b = frames.find((f) => f.name === p.building);
    if (!b) return null;
    const room = interiors.find((i) => i.name === b.name);
    if (room) {
      const at = room.toWorld(0, 0, room.d / 2 - 1.0);
      const back = room.toWorld(0, 0, -room.d / 2);
      return { x: at.x, z: at.z, y: at.y, face: [back.x, back.z] };
    }
    const c = Math.cos(b.yaw);
    const sn = Math.sin(b.yaw);
    // front, then either side, then the back: [across, out] for each metre further out
    for (let out = 1.8; out < 7; out += 0.6)
      for (const [lx, lz] of [
        [b.doorX ?? 0, b.d / 2 + b.porch + out],
        [b.w / 2 + out, 0],
        [-b.w / 2 - out, 0],
        [0, -b.d / 2 - out],
      ]) {
        const x = b.x + lx * c + lz * sn;
        const z = b.z - lx * sn + lz * c;
        const area = surfaces.areaNear(x, z, b.floorY);
        if (surfaces.standable(area, x, z)) return { x, z, y: area.y, face: [b.x, b.z] };
      }
    return null;
  };
  world.registerSystem(BackpackSystem);
  await built(0.55);

  // stepping through a doorway: a blink hides the door you can't see open
  const blink = new Blink(world.camera);
  locomotion.onTeleport.push((from, to) => {
    if (interiorAt(interiors, from.x, from.z) !== interiorAt(interiors, to.x, to.z)) blink.fire();
  });

  // what bites, and when, follows the island's day
  fishingDeps.hour = () => sky.state.hour;
  // indoors, with the axe out among the trees or the pick by a gem rock, up the helter skelter or
  // at a dancers' open chest or a broken rock's tray, the rod goes over your shoulder
  fishingDeps.indoors = () =>
    interiorAt(interiors, world.player.position.x, world.player.position.z) !== null || woodView.axeOut || mineView.pickOut || mineView.busy || skelterView.onTower || campView.busy;

  // the woodworks: the timber yard, the woodlot and the walks off the pier head
  Object.assign(woodDeps, {
    state: game,
    ground: (x: number, z: number) => heightfield.heightAt(x, z),
    addBox: (b: BoxCollider) => surfaces.addBox(b),
    removeBox: (b: BoxCollider) => surfaces.removeBox(b),
    env: casinoEnv(world.renderer),
    night: sky.state.night,
    busy: () => backpackView.open || skelterView.onTower || interiorAt(interiors, world.player.position.x, world.player.position.z) !== null,
    // once the helter skelter's built (all its logs in), the timber yard buys logs back
    buysLogs: () => (game.woodworks.built.skelter ?? 0) >= SKELTER.cost,
  });
  world.registerSystem(WoodSystem);
  await built(0.6);

  // the helter skelter at the back of the village: raised with wood once the deep walk's done
  Object.assign(skelterDeps, {
    state: game,
    ground: (x: number, z: number) => heightfield.heightAt(x, z),
    addBox: (b: BoxCollider) => surfaces.addBox(b),
    removeBox: (b: BoxCollider) => surfaces.removeBox(b),
    sky: sky.state,
    unlocked: () => (woodView.walks?.().deep ?? 0) >= 1,
    blink: () => blink.fire(),
  });
  world.registerSystem(SkelterSystem);

  // the fire dancers' camps, hidden out in the wilds, each with a chest to open (camps/)
  Object.assign(campDeps, {
    state: game,
    props: fishingDeps.props,
    ground: (x: number, z: number) => heightfield.heightAt(x, z),
    addBox: (b: BoxCollider) => surfaces.addBox(b),
    hour: () => sky.state.hour,
  });
  world.registerSystem(CampSystem);
  await built(0.65);

  // the gem rocks out in the wilds, and the pickaxe from the Jeweller (mining/)
  Object.assign(mineDeps, {
    state: game,
    ground: (x: number, z: number) => heightfield.heightAt(x, z),
    addBox: (b: BoxCollider) => surfaces.addBox(b),
    removeBox: (b: BoxCollider) => surfaces.removeBox(b),
    env: casinoEnv(world.renderer),
    busy: () => backpackView.open || skelterView.onTower || woodView.axeOut || campView.busy || interiorAt(interiors, world.player.position.x, world.player.position.z) !== null,
  });
  world.registerSystem(MiningSystem);
  await built(0.7);

  // the village's people and counters
  const stall = frames.find((b) => b.name === 'stall');
  const market = stall ? new FishMarket(scene, stall, game) : null;
  // the casinos' tables
  const tables: { update(dt: number, camera: Camera): void }[] = [];
  const room = (n: string): Interior | undefined => interiors.find((i) => i.name === n);
  const lure = room('C');
  if (lure) tables.push(new RouletteTable(lure, game, world, { chips: [1, 5, 25, 100], maxBet: 500, at: [0, -0.6] }));
  // and the case wall on its right-hand wall, between the table and the door (village/interiors.ts FURNITURE C)
  if (lure) tables.push(new CaseWall(lure, game, world, { at: [lure.w / 2, CASE_WALL_Z, -Math.PI / 2], props: fishingDeps.props!, hour: () => sky.state.hour }));
  const vault = room('H');
  if (vault) tables.push(new IslandBank(vault, game, world.renderer));
  const shark = room('G');
  if (shark) tables.push(new BlackjackTable(shark, game, world, { chips: [5, 10, 25, 100], maxBet: 500, at: [0, -0.9] }));
  const reels = room('B');
  if (reels) {
    const z = -reels.d / 2 + 0.28;
    // deep lacquers with gold and chrome: sea-teal, cherry, midnight
    const looks = [
      { colour: '#0e4a50', accent: '#3fe0d0' },
      { colour: '#6e0f1a', accent: '#ffb627' },
      { colour: '#131f46', accent: '#ffd45a' },
    ];
    [-1.5, 0, 1.5].forEach((x, k) => tables.push(new SlotMachine(reels, game, world, { bets: [1, 5, 25], at: [x, z, 0], ...looks[k] })));
  }
  // the music (the day's songs, the night's, the pier's at night; the casinos' own inside) and
  // the sea's sound
  const PIER_FLOORS = new Set(['pierDeck', 'pierStep', 'walkDeck']);
  const music = new Music(
    interiors.filter((i) => i.role.role === 'casino'),
    {
      hour: () => sky.state.hour,
      onPier: () => {
        const p = world.player.position;
        return PIER_FLOORS.has(surfaces.areaNear(p.x, p.z, p.y).tag);
      },
    },
  );
  const shore = new ShoreSound(heightfield, json.layout.pier, () => interiorAt(interiors, world.player.position.x, world.player.position.z) !== null, () => sky.state.night.value);
  // now and then a hawk, circling up a thermal near you
  const hawks = new Hawks(heightfield, sky.state);
  scene.add(hawks.group);
  // your shack, and the shops that furnish it
  const kit = { renderer: world.renderer, props: fishingDeps.props! };
  const shack = room(HOME);
  if (shack) new Shack(shack, game, kit, (b) => surfaces.addBox(b));
  await built(0.75);
  const homeShops = [...HOME_SHOPS, ...VILLA_SHOPS].map((n) => room(n)).filter((r): r is Interior => !!r).map((r) => new HomeShopCounter(r, game, kit));
  // the Jeweller's second counter: the pickaxe, and the window that buys your gems
  await built(0.85);
  const jeweller = room(JEWELLER);
  const gemWindows = jeweller ? new GemWindows(jeweller, game, kit) : null;
  // the fishing upgrades: tackle, bait and luck (fishing/gear.ts)
  await built(0.9);
  const gearShops = GEAR_COUNTERS.map((n) => room(n)).filter((r): r is Interior => !!r).map((r) => new GearShopCounter(r, game, kit));
  // and at the tackle shop, a board by the rack of rods: which of your rods and reels you fish with
  const tackle = room('S3');
  const rodRack = tackle ? new RodRackBoard(tackle, game, kit) : null;
  // Coral at home, and what you've given her
  await built(0.95);
  const villaRoom = room(VILLA);
  const villa = villaRoom ? new Villa(villaRoom, game, kit, (b) => surfaces.addBox(b), () => sky.state.night.value) : null;
  // the golden statue on the beach, once you've had everything the island has to give (statue/)
  const statue = new Statue(scene, {
    state: game,
    kit,
    ground: (x, z) => heightfield.heightAt(x, z),
    addBox: (b) => surfaces.addBox(b),
    removeBox: (b) => surfaces.removeBox(b),
    night: sky.state.night,
    goods: GOODS.map((g) => g.id),
    // not while you're up the helter skelter or have a fish on: it waits for you
    hold: () => skelterView.onTower || ['fighting', 'landing'].includes(fishingView.state?.() ?? ''),
    // the game clock runs while you're in the headset
    playing: () => !!world.session,
  });
  villageTick = (dt) => {
    // a room is drawn only when you could see into it: from inside, or through its doorway
    // (from across the village, its dozens of little draws were most of the frame)
    const eye = world.camera.matrixWorld.elements;
    for (const i of interiors) i.group.visible = i.seenFrom(eye[12], eye[14]);
    villa?.update(dt, world.camera);
    statue.update(dt, world.camera);
    music.update(world.camera);
    shore.update(ocean.time, dt, world.camera);
    hawks.update(dt, world.camera);
    market?.update(dt, world.camera);
    for (const t of tables) t.update(dt, world.camera);
    blink.update(dt);
  };

  // Dev hook: drive the rig without a headset (`__fish.move.to(x, z, yaw)`, `__fish.map.system.goTo(id)`).
  (window as unknown as { __fish: unknown }).__fish = { world, surfaces, move: teleportView, map: travelMapView, json, game, fishing: fishingView, vegetation, backpack: backpackView, interiors, tables, music, shore, sky, clouds, hawks, homeShops, gearShops, rodRack, villa, fx, props: fishingDeps.props, wood: woodView, skelter: skelterView, camps: campView, mining: mineView, gemWindows, statue, spotFor };

  if (import.meta.env.DEV) void import('./dev/harness.ts').then((m) => m.installHarness(world));

  // the curtain goes up the moment the session starts, before the island's first frame in it
  world.renderer.xr.addEventListener('sessionstart', () => {
    runBootIntro(world.camera as PerspectiveCamera, world.scene);
    // and while its shade is up, the shaders that would otherwise be built mid-game (fx/warm.ts)
    warmUpNow(world.camera);
  });

  progress(1);
  scene.visible = true;
  status.textContent = navigator.xr ? 'Ready.' : 'WebXR not available in this browser: desktop preview only.';
  enter.disabled = !navigator.xr;
  enter.addEventListener('click', () => {
    ensureAudio();
    // (hands too: put the controllers down and your bare hands work the map)
    launchXR(world, { sessionMode: SessionMode.ImmersiveVR, features: { handTracking: true } });
  });
  // Hide the landing card once the session is up; bring it back after.
  // (A timer, not rAF: Quest Browser suspends window rAF while presenting.)
  window.setInterval(() => {
    document.body.classList.toggle('in-xr', !!world.session);
    // the first session of the page opens on the boot intro (yellkell.com, then the mark)
    if (world.session) runBootIntro(world.camera as PerspectiveCamera, world.scene);
  }, 250);
});
