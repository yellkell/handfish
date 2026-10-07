# Fish & Chips

Fish by day, chips by night: the catch pays for the casino's chips. (The repo, the
site and the services keep their old `gamblefish` names so links and saves still work.)

A VR adaptation of **How to Fish**, set on **Tidewater's** island
([dgreenheck/tidewater](https://github.com/dgreenheck/tidewater), MIT), built on
the **Immersive Web SDK** (IWSDK 0.4.2, three r184 — the same stack as
[FIRE FIGHT 2](https://github.com/yellkell/ff2)).

**handfish** is the hand-tracking line of the game. You get about the island one way only:
**the travel map**. Call it up, point at where you want to be, and you're there, standing at the
pier rail, the roulette table or the tree, already facing it.

**Play:** https://yellkell.github.io/gamblefish/ (Quest Browser → ENTER VR)

## Controls

| | |
|---|---|
| **Travel map** | Push either stick **forward** (bare hands: reach up, pinch and pull down) and the map unrolls in front of you. Point at a spot and pull the **trigger** (bare hands: press your fingertip into the paper) to go there. Push forward again, or the ✕, to roll it up. |
| **Snap turn** | Flick the stick sideways (controllers only: with hands, just turn round). |
| **Palm menu (hands)** | Turn your free hand palm up and look at it: a panel opens above your palm. Poke it with your other index finger: **BACKPACK**, **MAP**, **RECENTRE**, **MUSIC**. Turn the palm over to put it away. |
| **Recentre** | **RECENTRE** on the backpack's left, under ALWAYS DAY: back on the spot the map put you on, facing the way it faced you. |
| **Rod out / away** | **B** puts it in your right hand, **Y** in your left. It starts in your right hand. |
| **Cast** | Hold the **trigger** (your finger on the line), swing the rod and let go. |
| **Strike** | When the bobber goes under, yank the rod back or pull the trigger. |
| **Fight** | Reel with the **trigger** (pressure sets the speed), or grip the reel handle with your other hand and crank. Keep the tension in the green. A hooked fish runs first, and won't come in until it's tired. Ease off and it swims away, taking line; leave it too long and it takes the lot. |
| **Wallet** | Look at either wrist: a rolling counter shows your money. |

## Running

```sh
npm install
npm run dev          # bakes the island on first run, then http://localhost:5180
npm run build        # bake + typecheck + static build in dist/
npm run check:map        # every travel-map spot, against the baked island
npm run check:teleport   # and check:backpack, check:casino, check:fish, check:camps,
                         # check:line, check:mining, check:statue, check:bank
```

In dev, IWSDK's plugin injects the IWER Quest 3 emulator, so **ENTER VR** works on a
desktop. On a Quest, open the dev server's LAN address in the Quest Browser.

## Where the island comes from

Tidewater is a WebGPU/WGSL engine. Quest Browser can't run WebGPU inside WebXR, so
none of its renderer carries over. Its **world generation** is plain CPU
JavaScript, though, and that does carry over:

- `vendor/tidewater/` holds Tidewater's source, unmodified (MIT, see its
  `LICENSE`, `CREDITS.md` and `VERSION`).
- `tools/bake-world.mjs` runs Tidewater's own `TerrainData` and `Village`
  builders headlessly in Node (about 2 s). It writes `public/world/`:
  - `terrain.bin` — the heightfield on a 2 m grid, a ground-colour map and water depth.
  - `village.bin` — the village, pier and boardwalks as merged, vertex-coloured meshes.
    The pier's handrails are laid end to end. Tidewater overlaps each bay's rails
    over the posts, and the overlapping faces flickered.
    The four outhouses are left out, and gateways for the woodworks' walks are cut in the
    pier head's rails.
    The walkway's sway braces run pile to pile. Tidewater stops each one 25–45 cm short of the
    piles at both ends, which leaves the boards floating.
  - `world.json` — the layout and Tidewater's collision world.
- The runtime (`src/world/`) rebuilds all of this in three.js for Quest:
  - LOD terrain chunks.
  - A single-pass Gerstner ocean shaded with Tidewater's water optics (by way of FIRE FIGHT 2's
    cove sea): light absorbed and scattered along the refracted ray down to the seabed, the sand
    and its caustics seen through it, exact Fresnel, the sky's own colours in the reflection, a
    GGX sun path, drifting ripple layers and a lace of foam at the waterline.
  - A gradient sky with fog, and sprite clouds.
  - Four Lambert draws for the village.

  At the pier head that's about 43 draw calls and 200k triangles.

Not carried over yet: vegetation (palms), the boat, the reef and the swimming fish,
and the vendors.

## Opening

- **On the page:** ff2's publisher card (yellkell.com, PRESENTS) fades in and out, then the
  splash: the FISH & CHIPS mark (`src/ui/logo.ts`: a chip for the ampersand) breathing in its
  glow. The leaping fish over the chip is the game's own sailfish, photographed once its
  model loads and faded in. The loader, a neon ENTER VR, and a thumbstick icon sit under it.
- **In the browser tab:** the mark's chip with the sailfish leaping across its face
  (`public/favicon.svg`), plus the .ico, home-screen and manifest icons made from it.
- **In the headset:** the first session of a page load opens on ff2's boot intro
  (`src/experience/bootIntro.ts`): the publisher card, then the same mark, then the curtain
  drops. While it's up the controls wait and the first song decodes, starting as it drops.

## Fishing (How to Fish's loop, Tidewater's rules)

- **Game logic:** `src/fishing/tidewater.ts` imports Tidewater's fishing code
  as-is. That covers the 18 species with their prices, the habitats and bite
  timing, the line-tension fight, the gear tracks and the save, which lives
  under its own key. One change: "deep water" starts at this island's drop-off
  (9 m, all deep by 15 m) rather than Tidewater's 16–28 m, which no cast here
  reaches. Without it the mahi-mahi and blackfin tuna, which live only in the
  deep, never bit. Off the end of the deep walk they now do.
- **Props:** `tools/bake-props.mjs` bakes Tidewater's own rod and reel, bobber
  and all 18 fish, colouring the fish the way its skin shader does. The rod's
  vertex animation (blank bend, rotor, bail, crank, spool) is ported from WGSL
  to GLSL in `src/fishing/props.ts`.
- **VR play:** `src/fishing/FishingSystem.ts` runs it all in VR.
  - The rod sits in your palm and points where you aim.
  - The cast uses your real tip speed. An assist forgives late releases on
    elevation only.
  - The rod-hand haptics carry the nibbles, the take and every surge.
  - Teleport closes during the fight.
- **Sound:** Tidewater's CC0 fishing recordings (`public/audio`) play at
  Tidewater's mix levels, on ff2's SFX bus.
- **Ripples** (`src/fx/water.ts`) ride the swell: each ring's vertices are raised to
  the sea's height at that point, from the ocean's own waves, so a passing crest no
  longer hides them.
- **Sea:** `src/audio/shore.ts` is ff2's cove soundscape on this island, with the
  same Tidewater recordings. Surf breaks and washes up the beaches around you, timed
  to the foam you see running up the sand, over a distant surf roar. Water laps
  under the pier. Indoors it's all muffled.
- **Music:** `src/audio/music.ts` plays the soundtrack board's three playlists
  (`src/audio/songs/`): **Day** (12 songs), **Night** round the island (Novus,
  Neighborhood, Imagine) and **the Pier at Night**, out on the pier or its walks
  (Night Catch, Harmony, New Song 35). Every day and night deals a new order, the songs
  not heard last time first; a session's first day opens on Poo Song. Songs run into
  each other, and a change of playlist waits for the song on to play out.
  Inside the casinos it's Give It To Me and Fusion, round and round (`src/audio/casino/`),
  spilling muffled out of their doors as you walk up.
  The backpack's **MUSIC** button mutes it all.
- **The day:** `src/world/sky.ts` runs a whole day in about 40 minutes, with the
  night going faster. Sun and moon move across the sky; dawn, midday, golden hour,
  sunset, dusk and a moonlit night each have their own sky, fog, sea and light.
  After dark the windows glow, the lamps light up (`src/world/lamps.ts`), the stars
  come out and the crickets start.
- **Clouds:** `src/world/clouds.ts` fills the sky with fair-weather cumulus drifting
  on the trade wind, out to the horizon wherever you stand. Each cloud is a heap of soft
  puffs on a flat base, lit by the sky's own sun and moon: white tops and grey-blue bellies
  by day, a silver edge as one crosses the sun, gold then pink through the sunset, and dim
  moonlit shapes against the stars. The far ones fade into the horizon haze.
  - **Cost:** one draw for the whole sky, about 1200 sprites, sorted back to front a few
    times a second. Only the 800 to 1000 that can reach inside the fade-out are drawn, and
    each puff's haze, silver lining and sun angle are worked out per corner, not per pixel.
- **Hawks:** `src/world/hawks.ts`. Every few minutes a red-tailed hawk comes in over the
  island, finds a thermal near you and circles up it, banked into the turn. Its wings are
  fingered at the tips and held in a shallow V. It gives a few deep beats now and then,
  then glides off without a sound.
  Sometimes its mate comes along. Their paths stay clear of the hills. They keep a hawk's
  hours: they come only while the sun is well up (7:30 to about 5 pm on the island's
  clock) and are gone before sunset, so you never see one at dusk or at night.
  - **The bird:** pale underneath with dark wing bars and fingertips, brown on top with the
    rufous tail. It flaps in its vertex shader, at the shoulder and the wrist, so each hawk
    costs one draw.
- **Fish that keep their own hours:** `src/fishing/timedFish.ts` adds five species,
  each biting only in its window: bonefish at dawn, queen triggerfish at midday,
  permit at sunset, lookdown at night under the pier lamps, and glasseye snapper after
  midnight. `npm run check:fish` checks the windows.
- **Your shack:** the hut on the beach (HOME) is yours. The Carpenter, Florist,
  Taxidermist and Pawn Shop each sell things for it from a counter and a price
  board (`src/village/homeGoods.ts`). What you buy is delivered to its spot in the
  shack and kept in your save.
  - The Carpenter: a driftwood bed with a patchwork quilt, a table and two ladder-back
    chairs, a kilim rug, a bookshelf, and a sea chest for the foot of the bed.
  - The Florist: a kentia palm, a hibiscus in bloom, a Boston fern in a macramé
    hanger, a moth orchid on a bamboo stand, and a monstera in a woven basket.
  - The Taxidermist: tarpon, mahi-mahi, red snapper and a leaping sailfish, each on a
    carved plaque with an engraved brass plate.
  - The Pawn Shop: a ship in a bottle on a rum barrel, a mariner's globe, a painting of
    the bay, a brass diving helmet on its salvage crate, and an old map of the dancers' camps in a
    driftwood frame ($300). The map also adds a spread to the field guide after the chart of the
    bay: the whole island with every camp's fire marked (lit once you've found it), and a list of
    the camps. Point at one you've found to go there; the rest you walk to.
- **How the goods are made:** each shop's things are modelled in `src/village/wares/`
  with a small kit (`src/village/craft.ts`): leaves, petals and leaflets as curved,
  folded blades grown from real stems; tapered tubes; turned and rounded pieces; wood
  grain, linen, velvet and rattan painted once on a canvas.
  - **Draw calls:** plain colours and cloth share one material per finish, with the
    colour baked into each piece. Everything delivered to the shack or the villa is
    baked together, one draw per material for the whole room.
  - **Load time:** each thing is built once at load; its board picture is taken from
    a copy.
  - **Cost:** the town from the pier costs the same as before (rooms are drawn only
    when you can see into them). A fully furnished shack costs about as many draws as
    it did before this polish.
- **Coral's villa:** Villa Mar (L) is furnished the same way. The Jeweller sells a
  crystal chandelier, a vanity with a jewellery box (a real box, its velvet lining sunk in its well:
  laid flush with a solid block's top it flickered), pearls on a velvet bust, a
  ring under a glass cloche and a mermaid's tiara. The Boutique sells a velvet chaise
  longue, a gilded cheval mirror, silk drapes, a baby grand and a painted silk screen. Coral is at home (`src/village/villa.ts`), lit like the
  room around her rather than by the sky outside.
- **Coral talks to you** (`src/village/coral.ts`), in a speech bubble over her head
  (`src/ui/speechBubble.ts`) that pops up when you come in, turns to face you and shrinks away
  when she's done:
  - Her heart is the gifts you've given her, one heart each, shown in the bubble. How she greets
    you moves through five stages as it fills (a stranger, warming, fond, close, yours), with
    her own lines after dark.
  - Anything delivered since your last visit she thanks you for in person, by name, one line
    each, a heart filling with a chime; then a word on where the two of you are now.
  - Early on, with nothing new, she hints at the Jeweller and the Boutique. Straight back in:
    "Back so soon?" Walking out: a goodbye, seen back through the doorway.
  - What she's thanked you for and how often you've called are saved (`coral` in the save); an
    older save counts everything already in her villa as thanked.
- **Fishing upgrades** (`src/fishing/gear.ts`, `src/village/gearShop.ts`), on
  Tidewater's own upgrade tracks:
  - The **Tackle Shop** sells rods (cast distance), reels (reel speed) and line
    (breaking strain), each now with a big-game top level, and hooks: sharper hooks
    hold the window to strike open longer.
  - The **Bait Shop** sells bait, up to live bonito. Better bait brings bites sooner. The cheapest
    step up ($25) is **goop bait**: FIRE FIGHT 2's Goopliath no bigger than your thumb, by the tub
    (`src/village/wares/goop.ts`). His twenty gel blobs in ff2's boxer's stance are polygonised once
    at load from the same smooth-min, in his lime-to-bottle-green gel with the nucleus glowing
    through and his two bead eyes. A save from before goop bait keeps the bait it had.
  - The **Island Engineer** sells gadgets built to bring the big ones in: a brass line rattle, a
    deep-drop lure light, a clockwork flasher and a sonic sea-caller. They make trophy fish bite
    more often. The shop is a workshop: a workbench with a vice, a sonar screen and a work lamp,
    pegboards of tools, and a blueprint of the sea-caller pinned up.
  - Each board says what a level does for you in plain numbers against what you have (cast 13 m
    further, bites 28% sooner, trophy fish 2.4× as often), and which trophy fish need it.
  - Every shop board shows a picture of each thing it sells: the item's own 3D model,
    photographed once at load (`src/ui/thumbnail.ts`).
  - The rod in your hand looks like what you've bought (`src/fishing/rodLook.ts`): the blank,
    grips, wraps and fittings follow your rod (brown fibreglass and cork up to a navy big-game
    blank with gold guides and a gimbal butt), the reel's body and trim your reel, and the line
    on the spool, through the guides and out to the float your line. The bake tags each of the
    rod's vertices with its material, so it's repainted in place.
  - Your hook and bait hang under the float on a short leader (`src/fishing/baitRig.ts`): the
    shops' own models, swinging on the cast, sinking under the float in the water, gone
    while a fish has them. At the Bait Shop every bait you've bought (and the frozen shrimp you
    started with) has a **USE** button to put it on the hook, and at the Tackle Shop a **YOUR
    ROD AND REEL** board on the wall by the rack does the same for the rod in your hand and the
    reel on it. Every fish likes one bait best (`src/fishing/favouriteBait.ts`, from what it
    eats in the wild) and bites twice as readily with it on the hook. What you pick is what you
    fish with (`usedGear` in `src/fishing/gear.ts`): the bites come as fast as that bait brings
    them, the trophy fish look at what's on your line, you cast as far as that rod and reel in
    as fast as that reel. Buying new gear puts it on. The picks are saved (`looks`, by track).
- **Trophy fish** (`src/fishing/trophyFish.ts`): roosterfish, opah, sailfish,
  swordfish (night only) and blue marlin. They bite only when you have the gear each one
  needs and the bobber is over deep enough water (8–13 m, out past the drop-off off the
  pier head, so the longer rods matter). The marlin needs everything at the top and a
  gadget. Each has its own body, built from a Tidewater anatomy with a bill, a sail or a
  comb added. `npm run check:fish` checks that none bites without its gear.
- **Signs** (`src/village/signs.ts`): every business has a painted timber board, 5 cm thick,
  lit by the scene. Each is lettered by hand in a
  sign-writer's serif, letters a hair off the line with a painted shadow, over wood grain, and has
  seen some weather: paint chipped back to grey timber at the edges and seams, flecks gone, rain
  streaks, grime along the foot. A picture of the trade sits beside the name and a line says what's
  inside: planks painted in the trade's colour with a pinstripe (a rod, a baited hook, a fish, a saw
  and hammer, the pawnbroker's three balls, a mounted fish, a potted hibiscus, the engineer's cog
  and spanner); gold leaf on oiled dark hardwood for the jeweller, the boutique and the bank;
  glass-tube neon on stained timber for the casinos. Your shack, Coral's villa and the
  boatyard have none.
- **The pier's sign** (`src/village/pierSign.ts`): no words. A snapper cut from a thick plank, its
  edges eased, painted coral and gold by hand (scales, fin rays, the gill, a bright eye) and worn
  back to the grain in places, hanging from the entrance arch on two iron chains and swinging a
  little in the wind. It replaces Tidewater's plain board (world.json `pierSign` keeps where it hung).
- **Roofs** (`src/world/village.ts`): the bake keeps Tidewater's roof coordinates, and the village's
  own draws texture the roofs from them in the fragment stage: thatch streaked down the slope in
  courses, older and greyer in patches; corrugated metal with its ribs, sheet seams and laps, and
  rust streaking down from the eave. No textures, no extra draws; the detail fades with distance.
- **The village:** the Rum Shack (I) and the empty Captain's Table (M) are gone, and
  each spot is now a small garden. The beds' heliconias and birds of paradise are made the way the
  Florist's plants are (`src/world/beds.ts`): leaves on their own stalks, and flower spikes of red
  and yellow bracts, or the bird's green beak with its orange crest and blue tongue. They're in
  full within 16 m of you, coarser beyond.
- **The Tackle Shop's porch:** its roof hung from under the thatch eave, at eye height. The bake
  raises any porch like that (taller walls, a shallower pitch) until it clears 2 m. Rooms are only drawn when you could see into them
  (from inside, or from in front of the doorway), so looking back at town from the
  pier costs about 100 draw calls instead of about 800.
- **Field guide:** the backpack has a second tab (the BACKPACK and FIELD GUIDE
  buttons stand off the tray's left edge, above MUSIC), a book of the island's marine fauna
  (`src/backpack/fieldGuide.ts`). It has a title page with your progress, two species to
  a page, and the tarpon and the trophy fish on a page each at the back. A species you
  haven't caught shows as a shadow with where and when to look, and the bait it likes. The first one you land
  fills its entry in: its picture, names, habitat, how many you've caught and your best, and a
  true DID YOU KNOW? fact. Opposite the title page is a chart of the bay drawn from the terrain
  (`src/backpack/chart.ts`), showing depths, the drop-off, the reef, the pier, and numbered places
  (the shops, the casinos, home, the timber yard and the east woodlot) with a key, plus a dot for
  where you're standing. Point at a marker, a line of the key or a finished walk's platform and
  you're there: inside a room a step in from its door, or in front of the place, looking at it. The
  backpack shuts behind you. (Not with a fish on the line.) The great white has the last page.
  Point at the corner arrows to turn the pages, or point at the book and flick the thumbstick
  left or right.
- **Winning at the casinos** (`src/casino/celebrate.ts`): every win flashes light, sends
  a ring across the table and throws a burst of glints (no confetti). The
  amount rises in gold, and both controllers buzz. All of it scales with the win.
  - **Big wins** get a banner with a shine sweeping across its letters and light rays
    turning behind it, and a fountain of gold coins that ring down and settle. (The statue,
    the great white, the helter skelter and the walks opening don't get the coins.)
  - **Chips** (`src/casino/chips.ts`) have a real chip's edge spots and inlay ring, so a
    pay stack reads as money.
  - **Roulette:** the winning pocket lights up on the wheel and the winning spots pulse
    gold. Each winning stack is paid chip by chip beside it, then slides over to you. A
    straight-up hit gets a STRAIGHT UP! banner.
  - **Blackjack:** the pay lands chip by chip beside your bet, the felt glows gold under
    the winning cards and the hand's label throbs. A natural gets a BLACKJACK! banner and
    the biggest burst.
  - **Slots:** the winning symbols glow and the payline turns gold. A small win's amount
    rises when the count lands. From three shells or hooks up the win is a show that lasts
    the whole count: the amount rolls up in big gold figures over the reels, the NICE WIN,
    BIG WIN! or JACKPOT! banner stays up and glints keep popping. When the count lands
    the figures slam and burst, then float away.
- **The case wall** (`src/casino/CaseWall.ts`, rules in `src/casino/cases.ts`): on The
  Lucky Lure's right-hand wall, between the roulette table and the door. It opens THE LURE
  CASE ($50) the way a CS case opens. It's a black lacquer cabinet in the Lucky Lure's gold
  leaf and pink, with one column down its front: the case's name on a board at the top, the
  window, and the case's board.
  - **The spin:** point at OPEN and pull the trigger. A strip of cards races past a gold
    marker, ticking card by card, and slows to a crawl onto your prize. The prize is drawn
    first (crypto RNG) and the strip is dressed round it, so the spin only shows it.
  - **Grades** in CS's names and colours: Consumer (logs and small fish), Industrial,
    Mil-Spec (peridot, amethyst), Restricted, Classified, Covert (an opah, an emerald, a
    black opal) and the ★ Rare Special (a blue marlin, a ruby). The board shows everything in the case and each grade's
    odds. One fish in ten comes out Silver.
  - **Gems only with the pickaxe:** until the Jeweller's pickaxe is yours the case holds just
    logs and fish, and the board shows only those. It returns about 94.5% without
    the gems and 91% with them, whose stones are big ones from the top of what the rocks give.
  - **The reveal:** your card comes out of the strip in its grade's light, with rays from
    Restricted up. Mil-Spec and up get a party in the grade's colour; Classified, Covert and
    the ★ Rare Special get a banner.
  - **Where it goes:** logs into your backpack, a fish into its grid and a stone into your
    pouch. A fish with no room is sold on the spot. Nothing from the case fills the field
    guide: its fish and gem pages are for what you catch and dig out yourself. (The
    Jeweller's window still names a case stone in your pouch.)
- **The fish's skin** (`src/fishing/fishSkin.ts`): Tidewater's WGSL fish material, ported to
  GLSL on three's standard material. It adds scales in colour and relief, each species'
  markings, the lateral line and gill cover, see-through ray-striped fins, eyes with an iris
  and cornea, and the silvery sheen. The bake keeps each vertex's anatomy data for it, and
  seats the eye domes on the head so none stand off it.
- **The great white** (`src/fishing/shark.ts`, `src/fishing/sharkShow.ts`): the last catch.
  Once every other page of the field guide is filled, it takes baits in 6 m of water or more.
  - Every few seconds it breaches and runs. A ring lights on the rod's rear grip, below your rod hand: grab it with
    your other hand and hold on until the run breaks. One-handed it strips line, and reeling
    against a run snaps it.
  - Three held runs beat it. It comes up out of the sea under a GREAT WHITE! banner and hangs
    off your rod like any catch. It's too big for the backpack: grab it and it hangs from your
    hand by the tail, and you carry it to the fish market and sell it on the scale (which it
    pegs). The rod won't cast while it's in your hand. Shut the game with it in hand and it's
    back in your left hand next time.
  - Its skin is its own pattern: denticles, scars, gill slits, snout pores and teeth.
- **The woodworks** (`src/woodworks/`): build your own way out to the reef and deep water.
  - **Timber yard:** an open stall on the beach west of the pier foot. It sells the AXE
    ($60), a bundle of 10 logs ($40) and a cart of 50 ($180) for when you'd rather not chop.
  - **Woodlots:** six almond trees behind the yard, and six more on the far side of the village
    past the boatyard, with a log pile and a chopping block but no stall (`src/woodworks/lots.ts`).
    Once you own the axe, walk up to either and it's in your hand. Swing it into a trunk: four good blows and the tree creaks, falls away
    from you, and its 4 logs fly into your backpack. A sapling grows back from the stump
    about a minute later. Beside the backpack tray lies a little bundle of real logs, one for each
    you carry up to a full stack of six, bound with rope, the count burnt into a pine tag
    (`src/backpack/stash.ts`).
  - **The build boards** (`src/woodworks/buildSign.ts`): what asks for wood is a notice board of old
    planks nailed into a frame on two stakes, with a pitched cap, lettered by hand like the shop
    signs. How far along it is shows as a row of log ends, the ones in painted in, the rest chalked
    round; PUT IN WOOD is a tag hung under it on two cords. It's lit like everything round it.
  - **The walks:** put wood in a build crate on the pier head and a walk lays itself out plank by
    plank through a gateway in the rail. At first only the **reef walk** (48 logs) is on offer: it
    runs 60 m out to a platform over the reef's edge. Until it's finished the deep walk's gateway
    keeps the pier's rail and has no crate. Then the **deep walk** (44 logs) opens, running past the
    drop-off to a platform over 14 m of water. Each platform stands on a regular grid of piles, is
    railed down its sides and open at the far edge to fish off, and has a lantern at each corner and
    a bucket and a coil of rope made fast to a cleat (`src/woodworks/bucket.ts`), their shine fading
    with the daylight so they're moonlit at night, not lit up, and an orange-and-white life ring
    on the rail across from them (`src/woodworks/buoy.ts`). Each walk appears
    on the field guide's chart, named, once it's finished. Wood, the axe and the walks are saved.
    Until a walk's finished a rope with its sign hangs across the gateway and the way is shut; with
    the last plank down it's unhooked, swings down and it's gone, and the walk is open. (Tidewater
    hung a string of floats on the head's rail right across the reef walk's gateway; the bake hangs
    it along the rail past the gateway instead.)
- **The helter skelter** (`src/skelter/`): [HELTER SKELTER](https://github.com/yellkell/helter) in
  its full glory, at the back left of the village (as the chart draws it). Once the deep walk's
  finished its plot is staked out, with a build crate and a board: **500 logs**. The logs raise it as
  they go in: the plinth, the 300 m candy-striped drum with the slide spiralling up round it, the
  roof, the finial and the flag, a timber collar climbing with the work. Then it's on the chart.
  - **To the top:** the board by the crate becomes the ride's: RIDE TO THE TOP takes you up to the
    balcony, where a warning comes up before the descent: centre yourself in your play space (a
    ring on the balcony floor marks the middle; hold the Meta button to recentre), because the ride
    moves you and you dodge the gates with your real body.
  - **The ride:** helter's, carried over whole: DOWN's sliding, three tiers with a landing between,
    gates to lean past, the voiced 3-2-1 on each bay, 4 Leaf Clovers at the top and Brain Eater on the
    way down, the balcony's 3-2-1 on its beats, the first launch right on its drop, and its
    outro at the bottom before the island's songs come back
    (`src/audio/skelter.ts`). While you're up the teleport is off and
    the slide moves you, the rod's away and the island's songs step aside.
  - **The coins are money:** $1 a coin, $5 a gem, paid into your wallet at every landing. Clip a
    gate and you're off the ride, but you keep what you caught. At the bottom: back up to the top,
    or step off into the village.
  - The painted tower is lit by the island's sun, so it goes gold at sunset and dark at night.
    After dark its lanterns come on like the pier's (`src/skelter/lights.ts`): a little iron
    lantern on the slide's outer rail every 5 m, so the whole tower is wound in a spiral of warm
    light you can see from the beach.
- **The fire dancers' camps** (`src/camps/`): FIRE FIGHT 2's beach-party dancers (the glowstick
  crowd round its bonfires, ff2's `src/arena/cove/`) have gone off into the wilds in **twelve** little
  groups, each dancing round its own fire in a clearing with a chest beside it (the carpenter's
  sea chest, built so its lid opens: hollow inside, lined in red velvet, its logs lying in the
  bottom). None of them is on the chart and none can be seen from the
  start: they're over the ridges, down the hollows and round the far coasts, a long walk out
  (two of them in the big forest behind the village, off to the left as you look up from the pier,
  and two out on the far right, up the island's east coast).
  Listen for the drums, which carry further than the firelight: a little West African ensemble
  in 12/8 (bell, shaker, two bass drums and a djembe with a fill every fourth bar), each camp at
  its own tempo. `npm run check:camps` proves every
  one is hidden from the boardwalk, the pier and the beach, is level and standable, and can be
  reached on foot. None is on the chart of the bay; the pawn shop's map of the camps shows the lot.
  - **Pleased to see you:** walk into a camp and its dancers throw their hands in the air, and gift
    you everything in their chest (no pop-up: the chest's readout keeps the count, "2 of 12 camps
    found"). A hidden camp's gift is given once.
  - **The chest:** walk up to it and it opens by itself (or grip its lid). The lid swings up and the
    **chest pack** rises out of it: a tray like your backpack's, lined in the chest's red velvet and
    lit by the fire (never black under the moon), with the dancers' fish lying in its slots and
    their logs beside it. Its readout is the dancers' welcome ("We're happy to see you! Glad you
    found us. Please take these as a gift!"), never the camp's name, so no chest gives away where
    it is. Reach in and **click** a fish to pack it straight into your
    backpack, or **grip** it to take it in your hand and put it in your backpack yourself (A).
    Point at the logs to add them to your stack, or TAKE ALL. There's always a prize fish a tier up
    (the harder camps can hold a Gold). Walk away and the lid comes down; shut it with CLOSE and it stays shut till you've stepped away
    and come back.
  - **The beach party:** find all twelve and a thirteenth group comes down to the main beach, west of the
    timber yard, and lights a fire there (the hidden camps' chests say so once you have). Their chest fills every day with a couple of nice fish
    (Silver or better) and a stack of logs, fresh at midnight. Which camps you've found, and what's left in each chest,
    are saved. (A save that already had the beach party, from when there were fewer to find,
    keeps it.)
- **The gem rocks** (`src/mining/`): prospecting, with a pickaxe from the Jeweller.
  - **The Jeweller's windows** (`src/village/gemWindows.ts`): a second counter down the Jeweller's
    right-hand wall, a screen of glass and brass bars along it with two windows cut in it, a board
    over each. The **Prospector's Window** sells the **pickaxe** ($250; one lies on the counter till
    it's yours) and nothing else: where the rocks are is yours to find out. **We Buy Gems**
    shows every kind in your pouch with a SELL for each, and SELL ALL; one of each kind you've
    ever found lies on a velvet pad under it.
  - **The rocks** (`src/mining/sites.ts`, `src/mining/rock.ts`): forty big boulders out in the
    wilds, at least eight on each kind of ground (a good few in the forest behind the village and out on the
    east side, and a handful on the walks between the dancers' camps), none on the chart, veined with glowing lines in the colour of
    what's inside, breathing softly day and night. The bake clears the plants and Tidewater's own rocks round each. Own the
    pick and walk up to one and it's in your hand, the rod over your shoulder, as the axe is among
    the trees. Swing its point into the rock: steel rings on stone, chips and sparks fly, a jolt in
    your hand, and the veins open wider and blaze. Six blows and it bursts apart, the chunks glowing along the cracks as they tumble and sink into rubble.
    Like a dancers' chest, a rock is a one-time find: once broken it stays broken (rubble where it
    stood, and nothing left in the way of a teleport), and never grows back. Stones you leave in its
    tray wait there for you. Which rocks you've broken, and what's still in each, are saved.
  - **The tray:** out of the rubble rises a tray like the dancers' chest pack, lined in black
    velvet, the rock's stones turning in its slots; its board opens on "The sparkle blinds your
    eyes!", never where you are or what the stones are worth (the Jeweller might want to look at
    them). Reach in and click one (trigger or grip) and it
    flies into your pouch; TAKE ALL; CLOSE. What's inside depends on the ground (`src/mining/gems.ts`):
    peridot and aquamarine on the shore, watermelon tourmaline and emerald in the forest, amethyst
    and black opal on the high ground, sapphire and ruby on the peaks, the second of each the rare
    one. Each stone has its carats and is worth them.
  - **The stones** (`src/mining/gemMesh.ts`): each cut as a lapidary would (an oval, a pear, a
    trillion, a cushion and a heart as brilliants, crown and pavilion facets interlocking; emerald
    and baguette step cuts; the opal a cabochon), every facet its own flat normal. Their shader lights
    each from its own jeweller's studio fixed in the world (a dark room hung with lamps), so they
    scintillate as you move your head: through each facet the light that went in at the crown and
    came back off a pavilion facet, split a little for red, green and blue (fire), coloured by its
    path through the stone, under the surface's own reflection. The black opal's harlequin patches
    flash their colours as it turns; the tourmaline is pink at the heart and green at the rind; the
    emerald cut's table shows its hall of mirrors. Little four-pointed stars flash on them.
  - **The book:** once the pickaxe is yours the field guide gains a last spread after the fish, the
    eight gems four to a page. One you haven't found is a shadow with no name: where to look (the
    ground, how high, what the stone looks like) and whether it's the common one there or a rare
    one. The first you take fills its entry in (its names, where it's found, how many and your
    biggest, and a true DID YOU KNOW? fact), and the stone itself lies on the page, turning.
  - **The pouch:** once the pickaxe is yours (not before), a violet velvet drawstring pouch sits
    beside the backpack tray, under the logs: pleated at the neck by a gold cord with tasselled
    ends, your three most valuable kinds of stone sparkling in its open mouth, and a black velvet
    tag with how many you have: take these to the Jeweller (no prices till you're at his window). `npm run check:mining` checks that every rock is on its
    ground, clear, standable and reachable, and that the stones and the pouch behave.
- **The golden statue** (`src/statue/`): the island's thanks, once you've had everything it has to
  give. `src/statue/journey.ts` keeps the tally, five legs:
  - **the book:** every fish in the field guide, the great white too;
  - **the dancers:** all twelve hidden camps found;
  - **the gems:** every kind of stone the rocks hold;
  - **the shops:** everything they sell that stays yours: all 28 pieces for your shack and Coral's
    villa, every level of rod, reel, line, hooks, bait and gadget, the axe and the pickaxe;
  - **the helter skelter:** one full descent, all three tiers to the bottom (the ride's win counts it,
    `journey.rides` in the save; rides from before it was counted don't, so ride it once more).

  Finish the last and (once you're off the tower and have no fish on) a big golden statue of the
  sailfish off the logo rises out of the sand where you come down onto the beach, west of the pier
  foot, to a fanfare, a 100%! banner and a word wherever you are. The fish is the game's
  own sailfish, 5.5 m bill to tail, bent into a leap, its markings kept as shading in the gold, its sail's
  rays standing out, leaping from a golden splash; little stars glint over it, and after dark it keeps a
  soft warm glow of its own, brightest round its edges so the fish keeps its shape, on a plinth
  that's moonlit like the sand round it. On the plinth's face an engraved bronze plaque: *100% Complete! Thanks for
  Playing! Created by yellkell. Music by IBWildcat1998, poopoodoodoo689, JakeThePro & Crystalzach.*
  Once up it's saved (`journey.unveiled`), stands there every visit, and is a gold star on the field
  guide's chart (point at it to stand before the plaque). About five draws, built only once it's
  earned. `npm run check:statue` checks the plot (dry, clear, in sight from the start, solid) and that
  only all five legs together earn it.
- **The boards** (`src/ui/boards.ts`): every shop's, table's and counter's point-and-click board is a
  thing in the room, not a pane of dark glass: made of what that place would make it of, lettered
  its way, and set in a real frame. The carpenter's is planed pine with the lettering burnt in; the
  florist's sage-green boards with flowers painted round; the pawn shop prices things on manila
  tickets on string; the taxidermist uses engraved brass plaques; the jeweller black velvet and
  gold leaf in a gilt frame; the boutique cream linen and teal ribbons; the tackle shop navy boards
  with a painted rope and life-ring buttons; the bait shop and the fish market a chalkboard; the island
  engineer a blueprint, ruled in white with callout-box buttons; the bank green leather tooled in gold with brass plates; the
  Lucky Lure black lacquer with art-deco gold leaf and pink enamel; the Card Shark green baize with
  ivory plaques on a mahogany stand; the dancers' chest bark
  cloth printed with tapa bands in a bamboo frame, with carved tags. Indoors they're drawn like
  the rooms (the lamp's light painted on); outdoors they're lit like everything else, and dim at
  dusk.
- **ALWAYS DAY:** a switch under MUSIC in the backpack holds the island in the early
  afternoon. The fish that only bite at night won't bite while it's on.
- **Wallet:** `src/ui/wallet.ts` puts an odometer-style money counter on both
  wrists. Any change in the balance rings ff2's cash chime, pitched up for
  money in and down for money out.

## Soundtrack board

`public/soundtrack.html` is where the music team fills the island's playlists:
**Day** (12 songs, wandering and fishing), **Night · Around the Island** (3)
and **Night · On the Pier** (3). They drop audio files onto a playlist, listen back,
download, rename and move songs, and everyone with the team link sees the same
board live. It's one self-contained page (Firebase from gstatic), so it works
from the deployed site or any other host.

The board lives in Firestore under `soundtrack/<team key>/songs`, each song's
file split into ≤ 1 MB documents under its `parts`. The team key is the part of
the link after the `#`; `firestore.rules` holds only its SHA-256, so the key
itself is never in the repo. Anyone with the link can change the board, as with
a shared doc.

- **Turn it on:** publish `firestore.rules` (Firebase console → Firestore →
  Rules → paste → Publish, or `firebase deploy --only firestore:rules`).
- **Send the team** `https://yellkell.github.io/gamblefish/soundtrack.html#<team key>`.
  It publishes with the game on every push to main.
- **New key** (to shut out an old link): `printf %s '<new key>' | sha256sum`,
  put that hash in `teamOpen()` in `firestore.rules`, and publish the rules.

## Dev harness

In `npm run dev`, `window.__harness` drives the emulated Quest:

- `await __harness.enter()`, then `__harness.stand(55, 34, Math.PI, 2.3)` to
  stand on the pier head.
- `await __harness.cast()`, then `await __harness.until('fighting')` (it
  strikes by itself), then `await __harness.fight()`.
- `__harness.snapshot(camPos, lookAt)` renders the live XR scene from a
  spectator camera. The emulator's own XR canvas can't be screenshotted.

## The travel map

The only way about the island (`src/locomotion/TravelMap.ts`). The arc teleport and the step back
are gone; snap turn stays on the sticks for anyone seated.

- **Calling it up.** Either stick forward (0.6, re-armed under 0.3), or with bare hands a pinch
  above your eyes pulled down 16 cm, like a blind. It unrolls between two turned-wood rollers with
  brass knobs, 46 cm in front of you and 20 cm below your eyes, and stays world-locked so it holds
  still while you point. Walk 1.4 m off or turn your back on it and it rolls itself up.
- **Its sheets** (`src/locomotion/mapSheets.ts`): ISLAND, BAY, VILLAGE and PIER tabs, each the
  field guide's hand-tinted chart at its own scale (the pier's turned on its side to fill the
  sheet), and a floor plan of every room with more than one thing in it. Opened indoors, it opens
  on that room's plan.
- **Pointing.** A controller's ray, or a bare index fingertip on the paper. The nearest spot
  snaps (38 px, and the current one holds till another's 8 px nearer). Its name and what's there
  run along the bottom, a dotted line runs to it from YOU, and the octagon marker
  (`src/locomotion/marker.ts`) lights up on the island where you'll stand. Anywhere else on dry
  land is a free point (an X), so the wilds can still be explored and the camps found.
- **Going.** Trigger, or a fingertip pressed 4 mm into the paper: the map snaps, a blink, and your
  head lands on the spot facing what it's for. Mid-fight, landing a fish or up the helter skelter
  it says why not instead.

**The spots** (`src/locomotion/spots.ts`, pure, checked by `npm run check:map`):

- **The pier:** every 4 m down both rails wherever there's water under them, 0.38 m back from
  the rail and looking straight out; round the pier head's far end, west side, back and open east
  edge; out on the reef and deep walks once built, and at their build crates until then.
- **The beach:** every 16 m round the bay, on dry sand above the swash, looking out to sea.
- **The village:** a step inside every door, and in each room where to stand for each thing in
  it (roulette, the case wall, blackjack, each slot with its lever at your right hand, the bank,
  every counter, the Jeweller's two windows, the rod rack, Coral). Outside: the fish market's
  scale, the timber yard, the east woodlot.
- **The wilds:** a step from each of the twelve trees; each found camp's chest (every camp once
  the camp map's yours); each gem rock you've been within 45 m of, once the pickaxe is yours; the
  helter skelter's gate; the statue.

Every spot is checked against `src/world/surfaces.ts` before it's offered: a floor you may stand
on, at its height, and nothing solid within 26 cm of your feet.

What had to be new is **where** you may land. The club was a list of flat
rectangles; the island has terrain and a sea. `src/world/surfaces.ts` answers the
same questions as ff2's `TELEPORT_AREAS`, `floorYAt` and `crossesWall`:

- **Floor areas** are Tidewater's walkable colliders (pier, pier steps,
  boardwalks, stairs, porches, stoops) plus dry ground.
- **Refused landings:** the sea, the swash line (below 0.25 m) and slopes
  steeper than 45°, or 62° when the landing is at least half a metre below you:
  you can scramble down what you couldn't climb, so no hillside leaves you stuck
  with every aim burning red (`npm run check:teleport` proves every spot you can
  stand on out on the hills has a way off).
- **Walls** are Tidewater's solid colliders. As with the club's bar counter,
  each one's **top is its sill**, so a hop at deck height passes over the pier's
  under-deck beams, but the rails stop it.
- **Raised floors** catch an arc only as it falls onto them. The ground catches
  it either way, just as the club floor did.
- **On sloped ground**, the marker tilts to lie along the slope.
- **Stepping back** on natural ground allows 0.35 m of rise or fall. On decks it
  keeps the club's 5 cm.

## Layout

| Path | What |
|---|---|
| `src/main.ts` | IWSDK boot, load, Enter VR |
| `src/locomotion/` | the travel map, its sheets and spots; snap turn and recentre; the octagon |
| `src/world/` | baked data reader, heightfield, surfaces (pure), terrain, ocean, sky, clouds, hawks, village |
| `src/audio/` | ff2's synth SFX bus and cash chime; Tidewater's sampled fishing and shore sounds; the music |
| `src/fishing/` | the rod, cast, bites, fight, landing, catch card, the line meter clipped to the rod |
| `src/woodworks/` | the axe, the woodlots and the timber yard; the reef and deep walks, their build crates and boards, and the bucket at the end |
| `src/skelter/` | the helter skelter: its plot, the tower and slide, the ride (from HELTER SKELTER) |
| `src/mining/` | the gem rocks: their sites, the boulders and their cracks, the pickaxe, the cut stones and their shader, the tray, the pouch |
| `src/camps/` | the fire dancers' hidden camps: their sites, fires and dancers (from FIRE FIGHT 2), the chests and what's in them, the drums |
| `src/ui/` | ff2's Rajdhani type kit and coin symbol, canvas panels, the wrist wallet |
| `src/dev/harness.ts` | dev-only emulator driver |
| `tools/bake-world.mjs` | Tidewater → `public/world/` |
| `tools/bake-props.mjs` | Tidewater's rod, bobber and fish → `public/props/` |
| `tools/make-icons.mjs` | `public/favicon.svg` → the .ico and PNG icons beside it (run after editing the SVG) |
| `tools/map-check.mjs` | headless check of every travel-map spot: on its floor, clear of walls, in reach of what it's for, facing it |
| `tools/teleport-check.mjs` | headless floor and wall rules check, including no landing under a house floor |
| `tools/fish-check.mjs` | headless check that the timed fish keep their hours and the trophy fish need their gear |
| `tools/camps-check.mjs` | headless check that the camps are hidden from the start, level, reachable, and their chests fill properly |
| `tools/bank-check.mjs` | headless check of the bank server in dev mode: paying credits once, claiming once, pay codes (the page finds the code, pays for the pack picked there, the headset collects), the newer save wins, and wrong LOG IN and pay codes are throttled (`server/guards.mjs`) so nobody can guess into an account |
| `site/chips.html` | yellkell.com/chips (Hostinger `public_html/chips.html`): where a pay code from the Island Bank's board is typed on a phone or computer, a pack picked and paid for with Stripe. Served from localhost it talks to the dev bank on :8792 |
| `tools/line-check.mjs` | headless check that the fishing line lies over the pier's rails, posts and deck as drawn, not through them, and goes round a lamp post it's swung against (`src/world/lineWrap.ts`) rather than over or through it |

Dev hook: `__fish.move.to(x, z, yaw)`, `__fish.move.snapTurn(±1)` and
`__fish.move.stepBack()`.

## Credits

- **Island, fishing rules, rod, fish and sounds:** from [Tidewater](https://github.com/dgreenheck/tidewater)
  by Dan Greenheck (MIT). See `vendor/tidewater/LICENSE` and `CREDITS.md`, and
  `public/audio/CREDITS.md` for the CC0 recordings.
- **Teleport, cash chime, coin symbol, type kit, the sea's soundscape, the music, and the fire dancers and their bonfires:** from FIRE FIGHT 2. Rajdhani
  is under the SIL OFL (`src/assets/fonts/OFL-rajdhani.txt`).
