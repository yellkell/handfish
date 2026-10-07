/**
 * Tiny WebAudio sound kit — ff2's synth SFX bus (`src/rave/audio/sfx.ts`),
 * cut down to what the island uses so far. Same signal chain, same levels:
 * synth one-shots → `_master` (0.28, the quiet mix bus) → a soft glue
 * compressor → `_sfxOut` (the user's SFX fader) → speakers. The teleport's
 * click is ff2's `uiClick`, note for note.
 *
 * The AudioContext can only start inside a user gesture, so we unlock it on
 * the first DOM interaction; after that, sounds triggered from the frame loop
 * play fine.
 */

type Ctx = AudioContext & { _master?: GainNode; _sfxOut?: GainNode };

let ctx: Ctx | null = null;

function getCtx(): Ctx | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC() as Ctx;
    const sfxOut = ctx.createGain();
    sfxOut.gain.value = 1;
    sfxOut.connect(ctx.destination);
    ctx._sfxOut = sfxOut;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -24;
    glue.knee.value = 14;
    glue.ratio.value = 3;
    glue.attack.value = 0.004;
    glue.release.value = 0.18;
    glue.connect(sfxOut);
    const master = ctx.createGain();
    master.gain.value = 0.28;
    master.connect(glue);
    ctx._master = master;
  }
  return ctx;
}

function unlock(): void {
  const c = getCtx();
  if (c && c.state === 'suspended') void c.resume();
}

if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'click', 'keydown', 'touchstart']) {
    window.addEventListener(ev, unlock, { capture: true });
  }
}

/** The shared AudioContext (the sampled fishing sounds play through it too). */
export function audioContext(): AudioContext | null {
  return getCtx();
}

/** The user master SFX bus — sampled clips connect here instead of the raw
 *  destination so they ride the same fader as the synth mix. */
export function sfxOut(): GainNode | null {
  return getCtx()?._sfxOut ?? null;
}

/** Call from a user gesture (e.g. the Enter VR tap) to make sure audio is live. */
export function ensureAudio(): void {
  unlock();
}

function ready(): Ctx | null {
  const c = getCtx();
  if (!c) return null;
  if (c.state === 'suspended') void c.resume();
  return c.state === 'running' ? c : null;
}

interface ToneOpts {
  freq: number;
  to?: number; // glide target
  type?: OscillatorType;
  dur?: number;
  gain?: number;
  delay?: number;
}

function tone(o: ToneOpts): void {
  const c = ready();
  if (!c) return;
  const { freq, to, type = 'sine', dur = 0.12, gain = 0.2, delay = 0 } = o;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c._master!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/**
 * A burst of noise `frames` long, its swell and fade shaped in. Each is made once (a few takes of
 * each length, so repeats don't sound stamped out) and played again: filling a fresh one sample by
 * sample on every clack, a chip stack's run of them was a hitch.
 */
const bursts = new Map<number, AudioBuffer[]>();
const TAKES = 3;
function noiseBurst(c: AudioContext, frames: number): AudioBuffer {
  let takes = bursts.get(frames);
  if (!takes) bursts.set(frames, (takes = []));
  if (takes.length >= TAKES) return takes[Math.floor(Math.random() * TAKES)];
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const p = i / frames;
    data[i] = (Math.random() * 2 - 1) * (p < 0.12 ? p / 0.12 : 1) * (1 - p) ** 0.8;
  }
  takes.push(buf);
  return buf;
}

/** Bandpass-filtered noise burst — the basis of every whoosh. */
function whooshNoise(dur: number, gain: number, fromHz: number, toHz: number, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBurst(c, Math.floor(c.sampleRate * dur));
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(fromHz, t0);
  bp.frequency.exponentialRampToValueAtTime(toHz, t0 + dur * 0.6);
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(c._master!);
  src.start(t0);
}

/**
 * Struck plate steel: an inharmonic partial stack (plate-bell ratios, each
 * slightly detuned) over a sharp noise tick. `base` sets the pitch of the
 * plate, `dur` how long it rings.
 */
function clank(base: number, gain = 0.2, dur = 0.3, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const ratios = [1, 1.51, 2.27, 3.43, 4.83];
  ratios.forEach((ratio, i) => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = base * ratio * (1 + (Math.random() - 0.5) * 0.015);
    const env = c.createGain();
    const g = gain * (1 / (i + 1));
    const d = dur * (1 - i * 0.12);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(g, t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.04, d));
    osc.connect(env).connect(c._master!);
    osc.start(t0);
    osc.stop(t0 + d + 0.05);
  });
  // The impact tick that sells the strike.
  whooshNoise(0.03, gain * 0.7, base * 4, base * 2, delay);
}

/** UI / teleport: a light relay snap. */
export function uiClick(): void {
  clank(1500, 0.05, 0.04);
  tone({ freq: 110, type: 'sine', dur: 0.04, gain: 0.08 });
}

/** UI: the pointer landing on a button — the same relay snap as a click, but softer (ff2). */
export function uiHover(): void {
  clank(1500, 0.024, 0.035);
  tone({ freq: 110, type: 'sine', dur: 0.035, gain: 0.038 });
}

/** Someone starts to speak: a soft rising blip as their speech bubble pops up. */
export function speechPop(): void {
  tone({ freq: 520, to: 820, type: 'sine', dur: 0.09, gain: 0.05 });
}

/** A heart filled in: two soft bell notes, a fourth apart. */
export function heartChime(): void {
  tone({ freq: 1318.5, type: 'sine', dur: 0.35, gain: 0.06 });
  tone({ freq: 1760, type: 'sine', dur: 0.5, gain: 0.05, delay: 0.11 });
}

/**
 * The catch: a bright rising chime over a low thump, in the kit's struck-steel voice — longer
 * and higher when it's a new species or a record.
 */
export function catchSting(special = false): void {
  const notes = special ? [523, 659, 784, 1047] : [587, 784, 988];
  notes.forEach((f, i) => {
    tone({ freq: f, type: 'sine', dur: special ? 0.7 : 0.5, gain: 0.16, delay: i * 0.085 });
    tone({ freq: f * 2, type: 'triangle', dur: 0.25, gain: 0.04, delay: i * 0.085 });
  });
  tone({ freq: 90, to: 55, type: 'sine', dur: 0.3, gain: 0.3 });
  if (special) clank(2200, 0.05, 0.6, notes.length * 0.085);
}

/** A refusal: a short low double knock (the fish won't go there). */
export function uiDeny(): void {
  tone({ freq: 150, to: 110, type: 'triangle', dur: 0.08, gain: 0.12 });
  tone({ freq: 130, to: 95, type: 'triangle', dur: 0.1, gain: 0.12, delay: 0.09 });
}

/**
 * Two fish fusing: a bright arpeggio that climbs with the new tier, and climbs again for each
 * link of a chain merge — plus a plate-steel ring on the way up.
 */
export function mergeChime(tier: number, chain = 1): void {
  const root = 440 * Math.pow(2, (tier * 4 + (chain - 1) * 2) / 12);
  const steps = [0, 4, 7, 12, tier >= 2 ? 16 : 12];
  steps.forEach((st, i) => {
    const f = root * Math.pow(2, st / 12);
    tone({ freq: f, type: 'sine', dur: 0.45, gain: 0.13, delay: i * 0.055 });
    tone({ freq: f * 2, type: 'triangle', dur: 0.2, gain: 0.035, delay: i * 0.055 });
  });
  clank(1800 + tier * 400, 0.06, 0.5, steps.length * 0.055);
  tone({ freq: 70, to: 45, type: 'sine', dur: 0.35, gain: 0.3 });
}

/** A clay chip set down on felt (or on another chip): a short, dull double knock. */
export function chipClack(): void {
  clank(2600 + Math.random() * 500, 0.035, 0.035);
  clank(3300 + Math.random() * 400, 0.02, 0.03, 0.018);
}

/** The ball bouncing over a fret. */
export function ballTick(strength = 1): void {
  clank(3000 + Math.random() * 900, 0.03 * strength, 0.035);
}

/** A little fanfare for a win: bigger wins climb higher. */
export function winFanfare(size: number): void {
  const notes = size > 20 ? [523, 659, 784, 1047, 1319] : size > 3 ? [587, 740, 880, 1175] : [659, 880];
  notes.forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.28, gain: 0.12, delay: i * 0.09 }));
  if (size > 20) clank(2400, 0.07, 0.8, notes.length * 0.09);
}

/**
 * Glitter over a win: a quick run of high bell tones up a pentatonic scale, longer and higher
 * for bigger wins (tier 1–3).
 */
export function winShimmer(tier: number): void {
  const steps = [0, 2, 4, 7, 9];
  const n = [0, 6, 10, 16][tier] ?? 6;
  for (let i = 0; i < n; i++) {
    const f = 1047 * Math.pow(2, (steps[i % 5] + 12 * Math.floor(i / 5)) / 12);
    const at = 0.08 + i * 0.045;
    tone({ freq: f, type: 'sine', dur: 0.4, gain: 0.045, delay: at });
    tone({ freq: f * 2.01, type: 'sine', dur: 0.16, gain: 0.014, delay: at });
  }
}

/** Pay chips set down one on another: a run of clay clacks, `gap` seconds apart. */
export function chipRun(n: number, gap = 0.07, delay = 0): void {
  for (let i = 0; i < Math.min(n, 24); i++) {
    const at = delay + i * gap;
    clank(2600 + Math.random() * 500, 0.035, 0.035, at);
    clank(3300 + Math.random() * 400, 0.02, 0.03, at + 0.018);
  }
}

/**
 * The roulette ball rolling round the track: bandpassed noise whose level and pitch follow the
 * ball's speed (a hollow rumble that drops as it slows). `set(0)` silences it.
 */
export class RollBed {
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;

  set(level: number, speed: number): void {
    const c = ready();
    if (!c) return;
    if (level <= 0.001) {
      if (this.gain) this.gain.gain.setTargetAtTime(0, c.currentTime, 0.05);
      return;
    }
    if (!this.src) {
      const len = c.sampleRate * 2;
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(i * 0.0021));
      this.src = c.createBufferSource();
      this.src.buffer = buf;
      this.src.loop = true;
      this.filter = c.createBiquadFilter();
      this.filter.type = 'bandpass';
      this.filter.Q.value = 3;
      this.gain = c.createGain();
      this.gain.gain.value = 0;
      this.src.connect(this.filter).connect(this.gain).connect(c._master!);
      this.src.start();
    }
    const t = c.currentTime;
    this.gain!.gain.setTargetAtTime(level * 0.5, t, 0.08);
    this.filter!.frequency.setTargetAtTime(500 + speed * 900, t, 0.1);
  }
}

/** The slot lever: a ratchet clicking down as it's pulled, `k` from 0 (up) to 1 (bottom). */
export function leverClick(k: number): void {
  clank(900 + k * 500, 0.04, 0.05);
}

/** A slot reel slamming to a stop on its detent: a thunk and a short rattle. */
export function reelStop(n: number): void {
  tone({ freq: 120 - n * 10, to: 70, type: 'triangle', dur: 0.12, gain: 0.25 });
  clank(1400 + n * 120, 0.06, 0.08);
  whooshNoise(0.05, 0.08, 2400, 900, 0.02);
}

/** Coins dropping into the tray: `count` tinny hits spread out, faster for bigger wins. */
export function coinDrops(count: number): void {
  const n = Math.min(40, count);
  const gap = n > 15 ? 0.045 : 0.08;
  for (let i = 0; i < n; i++) clank(3200 + Math.random() * 1400, 0.035 + Math.random() * 0.02, 0.18, i * gap + Math.random() * 0.02);
}

/** The machine's win bells: a fast ringing alternation, longer for bigger wins. */
export function slotBells(seconds: number): void {
  const n = Math.round(seconds * 10);
  for (let i = 0; i < n; i++) tone({ freq: i % 2 ? 1568 : 1319, type: 'triangle', dur: 0.09, gain: 0.07, delay: i * 0.1 });
}

/** A card slid off the shoe across the felt: a soft papery hiss with a tick as it lands. */
export function cardSlide(): void {
  whooshNoise(0.14, 0.07, 3600, 1600);
  clank(2600, 0.012, 0.03, 0.12);
}

/** A card turned over: a quick snap. */
export function cardFlip(): void {
  whooshNoise(0.05, 0.08, 5000, 2600);
  tone({ freq: 900, to: 500, type: 'triangle', dur: 0.03, gain: 0.04, delay: 0.03 });
}

/** The lever hitting its catch at the bottom: a heavy mechanical clunk. */
export function leverClunk(): void {
  tone({ freq: 95, to: 48, type: 'sine', dur: 0.22, gain: 0.42 });
  tone({ freq: 190, to: 110, type: 'triangle', dur: 0.08, gain: 0.18 });
  clank(620, 0.12, 0.16);
  whooshNoise(0.07, 0.14, 1800, 500);
}

/** The lever let go: its spring twangs it back up. */
export function leverSpring(): void {
  tone({ freq: 210, to: 330, type: 'triangle', dur: 0.25, gain: 0.06 });
  clank(1100, 0.04, 0.2, 0.18);
}

/** A reel's detent clicking past as it slows. */
export function reelTick(k = 1): void {
  clank(2400 + Math.random() * 300, 0.022 * k, 0.03);
}

/** The win meter counting up: a bright blip that climbs as the count goes on. */
export function rollTick(k: number): void {
  tone({ freq: 880 * Math.pow(2, k * 1.2), type: 'square', dur: 0.03, gain: 0.025 });
}

/** One coin landing in the tray. */
export function coinClink(): void {
  clank(3400 + Math.random() * 1600, 0.03 + Math.random() * 0.02, 0.16);
}

/** Tension while the last reel crawls in: a rising hum. */
export function riser(seconds: number): void {
  tone({ freq: 220, to: 660, type: 'sawtooth', dur: seconds, gain: 0.03 });
  tone({ freq: 331, to: 990, type: 'triangle', dur: seconds, gain: 0.03 });
}

/** A big win landing: a boom under a bright chord. */
export function bigWinHit(): void {
  tone({ freq: 70, to: 38, type: 'sine', dur: 0.6, gain: 0.5 });
  [523, 659, 784, 1047].forEach((f) => tone({ freq: f, type: 'triangle', dur: 1.2, gain: 0.07 }));
  clank(1800, 0.1, 1.2);
}

/* ── the woodworks (woodworks/) ─────────────────────────────────────────── */

/** An axe biting into a trunk: a deep knock, the crack of the fibres, a spray of chips. */
export function chopThunk(k = 1): void {
  tone({ freq: 140 + Math.random() * 30, to: 70, type: 'sine', dur: 0.14, gain: 0.34 * k });
  tone({ freq: 320, to: 180, type: 'triangle', dur: 0.06, gain: 0.12 * k });
  whooshNoise(0.08, 0.22 * k, 2600, 900);
  clank(900 + Math.random() * 200, 0.05 * k, 0.07, 0.01);
}

/** The trunk giving way: a long groaning creak. */
export function treeCreak(): void {
  tone({ freq: 90, to: 140, type: 'sawtooth', dur: 0.9, gain: 0.05 });
  tone({ freq: 133, to: 96, type: 'sawtooth', dur: 1.1, gain: 0.04, delay: 0.25 });
  whooshNoise(0.8, 0.05, 700, 300, 0.1);
}

/** The tree coming down: a boom and a rush of leaves. */
export function treeCrash(): void {
  tone({ freq: 60, to: 32, type: 'sine', dur: 0.7, gain: 0.55 });
  whooshNoise(0.9, 0.28, 1600, 400);
  clank(420, 0.08, 0.3, 0.05);
}

/** A log landing on others (the backpack, a crate). */
export function logThunk(): void {
  tone({ freq: 180 + Math.random() * 60, to: 90, type: 'triangle', dur: 0.1, gain: 0.2 });
  clank(700 + Math.random() * 200, 0.03, 0.06);
}

/** A plank laid on the walk and nailed: a clap and two taps of the hammer. */
export function plankLay(): void {
  tone({ freq: 210, to: 120, type: 'triangle', dur: 0.09, gain: 0.26 });
  whooshNoise(0.05, 0.1, 2000, 800);
  clank(1600, 0.05, 0.08, 0.14);
  clank(1650, 0.05, 0.08, 0.26);
}

/* ── the gem rocks (mining/) ────────────────────────────────────────────── */

/** Steel on stone: the pick's point ringing off the rock, a crunch of grit. `k` 0..1: how near it is to going. */
export function pickClink(k = 0): void {
  clank(1900 + Math.random() * 300 - k * 300, 0.12, 0.22);
  tone({ freq: 220 - k * 60, to: 110, type: 'triangle', dur: 0.08, gain: 0.22 });
  whooshNoise(0.07, 0.2, 4200, 1600);
  // the gems inside ringing back, louder as the cracks open
  if (k > 0.2) tone({ freq: 2093 + k * 400, type: 'sine', dur: 0.5, gain: 0.03 * k, delay: 0.05 });
}

/** The rock giving way: a crack, a rumble, stone tumbling, then the gems' glitter. */
export function rockBreak(): void {
  tone({ freq: 70, to: 30, type: 'sine', dur: 0.8, gain: 0.55 });
  whooshNoise(0.6, 0.32, 2400, 500);
  clank(620, 0.08, 0.25, 0.02);
  for (let i = 0; i < 6; i++) tone({ freq: 160 + Math.random() * 120, to: 80, type: 'triangle', dur: 0.08, gain: 0.12, delay: 0.25 + i * 0.09 + Math.random() * 0.05 });
  winShimmer(2);
}

/** A gem lifted out and into your pouch: a bright little bell run, higher for the rare ones. */
export function gemChime(rare = false): void {
  const steps = rare ? [0, 4, 7, 11, 14, 19] : [0, 4, 7, 12];
  const root = rare ? 1318.5 : 1046.5;
  steps.forEach((st, i) => {
    const f = root * Math.pow(2, st / 12);
    tone({ freq: f, type: 'sine', dur: 0.5, gain: 0.07, delay: i * 0.045 });
    tone({ freq: f * 2.01, type: 'sine', dur: 0.18, gain: 0.02, delay: i * 0.045 });
  });
}

/* ── the travel map (locomotion/TravelMap.ts) ───────────────────────────── */

/** The map unrolling: a dry papery rush, a couple of crinkles, the rollers' wooden knock. */
export function mapUnroll(): void {
  whooshNoise(0.34, 0.16, 5200, 2400);
  whooshNoise(0.09, 0.07, 7000, 4200, 0.12);
  whooshNoise(0.07, 0.06, 6400, 3800, 0.22);
  tone({ freq: 320, to: 210, type: 'triangle', dur: 0.06, gain: 0.08, delay: 0.3 });
}

/** …and rolling it back up: quicker, with the rollers meeting. */
export function mapRollUp(): void {
  whooshNoise(0.2, 0.12, 3000, 5600);
  tone({ freq: 360, to: 240, type: 'triangle', dur: 0.05, gain: 0.09, delay: 0.17 });
  clank(1900, 0.02, 0.05, 0.18);
}

/** Off you go: the map's snap, a soft rising rush, and a low landing thump. */
export function mapGo(): void {
  clank(1500, 0.05, 0.04);
  whooshNoise(0.42, 0.2, 500, 2600);
  tone({ freq: 220, to: 440, type: 'sine', dur: 0.3, gain: 0.05 });
  tone({ freq: 95, to: 55, type: 'sine', dur: 0.22, gain: 0.22, delay: 0.3 });
}

/** A tab of the map turned over: a light page flick. */
export function mapTab(): void {
  whooshNoise(0.08, 0.08, 6200, 3600);
  clank(1700, 0.02, 0.03);
}

/** The palm menu (ui/PalmMenu.ts) opening off your palm: a soft rising pair of glassy notes. */
export function palmOpen(): void {
  tone({ freq: 880, to: 1320, type: 'sine', dur: 0.12, gain: 0.05 });
  tone({ freq: 1760, type: 'sine', dur: 0.18, gain: 0.03, delay: 0.06 });
}

/** …and folding away: the same, falling. */
export function palmClose(): void {
  tone({ freq: 1320, to: 760, type: 'sine', dur: 0.12, gain: 0.04 });
}
