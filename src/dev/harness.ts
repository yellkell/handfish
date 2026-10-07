/**
 * Dev-only test harness (never in a production build): drive the emulated Quest (IWER) the way
 * a player would, to exercise the fishing loop without a headset.
 *
 *   await __harness.enter()                 start the emulated VR session
 *   __harness.stand(55, 34, Math.PI)        put the rig somewhere (x, z, yaw)
 *   __harness.aim(pitchDeg, yawDeg)         pin the right controller's pose
 *   __harness.aimHand(hand, pitch, yaw, pos) pin either controller (pos in the headset's space)
 *   await __harness.press(hand, 'a-button')  press and release a button
 *   await __harness.cast()                  trigger down, swing forward, let go mid-swing
 *   await __harness.until('fighting')       wait for a state (strikes on the take by itself)
 *   await __harness.fight()                 reel with the trigger, easing off on the red
 *   __harness.snapshot(camPos, lookAt)       render the live scene from a spectator camera into
 *                                            an <img> over the page (the emulator's XR canvas
 *                                            can't be screenshotted)
 *   await __harness.eye()                    the LEFT EYE of the emulated headset, read straight from
 *                                            the XR framebuffer inside an XR frame (what the headset
 *                                            really drew), into the same <img>
 *   __harness.hide()                         remove that image
 *
 * IWER's devui rewrites the controller pose every frame from its panel, so `aim` pins it by
 * overriding the pose setters on that one controller.
 */

import { launchXR, SessionMode, type World } from '@iwsdk/core';
import { Euler, PerspectiveCamera, Quaternion, SRGBColorSpace, Vector3, WebGLRenderTarget } from 'three';
import { fishingView } from '../fishing/FishingSystem.ts';
import { introDone } from '../experience/introGate.ts';

interface IwerVec {
  set(...a: number[]): unknown;
  copy(o: unknown): unknown;
}
interface IwerController {
  quaternion: IwerVec;
  position: IwerVec;
  updateButtonValue(id: string, v: number): void;
  updateAxes(id: string, x: number, y: number): void;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function installHarness(world: World): void {
  const dev = (window as unknown as { IWER_DEVICE?: { controllers: Record<string, IwerController> } }).IWER_DEVICE;
  const poses: Record<string, { q: number[] | null; p: number[] | null }> = { left: { q: null, p: null }, right: { q: null, p: null } };
  const pinned: Record<string, boolean> = {};

  /** Take a controller's pose away from the devui panel, which rewrites it every frame. */
  const pin = (hand: 'left' | 'right' = 'right'): IwerController | null => {
    const R = dev?.controllers[hand];
    if (!R || pinned[hand]) return R ?? null;
    const pose = poses[hand];
    const qp = Object.getPrototypeOf(R.quaternion) as IwerVec;
    const pp = Object.getPrototypeOf(R.position) as IwerVec;
    R.quaternion.set = function (this: IwerVec, ...a: number[]) {
      return qp.set.call(this, ...(pose.q ?? a));
    };
    R.quaternion.copy = function (this: IwerVec, o: unknown) {
      return pose.q ? qp.set.call(this, ...pose.q) : qp.copy.call(this, o);
    };
    R.position.set = function (this: IwerVec, ...a: number[]) {
      return pp.set.call(this, ...(pose.p ?? a));
    };
    R.position.copy = function (this: IwerVec, o: unknown) {
      return pose.p ? pp.set.call(this, ...pose.p) : pp.copy.call(this, o);
    };
    pinned[hand] = true;
    return R;
  };

  /** Pose a controller: pitch / yaw (degrees) and position in the headset's local space. */
  const aimHand = (hand: 'left' | 'right', pitchDeg: number, yawDeg = 0, pos?: [number, number, number]): void => {
    const R = pin(hand);
    if (!R) return;
    const q = new Quaternion().setFromEuler(new Euler((pitchDeg * Math.PI) / 180, (yawDeg * Math.PI) / 180, 0, 'YXZ'));
    const pose = poses[hand];
    pose.q = [q.x, q.y, q.z, q.w];
    pose.p = pos ?? [hand === 'right' ? 0.25 : -0.25, 1.5, -0.4];
    Object.getPrototypeOf(R.quaternion).set.call(R.quaternion, ...pose.q);
    Object.getPrototypeOf(R.position).set.call(R.position, ...pose.p);
  };
  const aim = (pitchDeg: number, yawDeg = 0, pos: [number, number, number] = [0.25, 1.5, -0.4]): void => aimHand('right', pitchDeg, yawDeg, pos);

  const state = (): string => fishingView.state?.() ?? '?';

  const until = async (want: string | string[], timeoutMs = 60000, strike = true): Promise<string> => {
    const R = pin();
    const wants = Array.isArray(want) ? want : [want];
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const s = state();
      if (wants.includes(s)) return s;
      // strike on the take with the trigger
      const b = fishingView.bite?.() as { phase?: string } | null;
      if (strike && R && s === 'floating' && b?.phase === 'take') {
        R.updateButtonValue('trigger', 1);
        await sleep(60);
        R.updateButtonValue('trigger', 0);
      }
      await sleep(30);
    }
    return state();
  };

  const show = (c: HTMLCanvasElement): void => {
    let el = document.getElementById('harness-snap') as HTMLImageElement | null;
    if (!el) {
      el = document.createElement('img');
      el.id = 'harness-snap';
      el.style.cssText = 'position:fixed;left:0;top:0;width:100vw;z-index:99999;';
      document.body.appendChild(el);
    }
    el.src = c.toDataURL();
    el.style.display = 'block';
  };

  /** Read the headset's own framebuffer inside an XR frame (after the app has drawn it). */
  const eye = async (): Promise<boolean> => {
    const r = world.renderer;
    const s = r.xr.getSession();
    const layer = s?.renderState.baseLayer;
    if (!s || !layer) return false;
    const gl = r.getContext();
    await new Promise<void>((res) => s.requestAnimationFrame(() => res()));
    const { w, h, px } = await new Promise<{ w: number; h: number; px: Uint8Array }>((resolve) =>
      s.requestAnimationFrame(() => {
        const w = layer.framebufferWidth;
        const h = layer.framebufferHeight;
        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        resolve({ w, h, px });
      }),
    );
    const ew = Math.floor(w / 2);
    const c = document.createElement('canvas');
    c.width = ew;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(ew, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < ew; x++) {
        const si = ((h - 1 - y) * w + x) * 4;
        const di = (y * ew + x) * 4;
        img.data[di] = px[si];
        img.data[di + 1] = px[si + 1];
        img.data[di + 2] = px[si + 2];
        img.data[di + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    show(c);
    return true;
  };

  const snapshot = (camPos: [number, number, number], look: [number, number, number], w = 900, h = 640): void => {
    const r = world.renderer;
    const cam = new PerspectiveCamera(55, w / h, 0.05, 6000);
    cam.position.set(...camPos);
    cam.lookAt(new Vector3(...look));
    cam.updateMatrixWorld();
    const rt = new WebGLRenderTarget(w, h, { colorSpace: SRGBColorSpace });
    const xrOn = r.xr.enabled;
    const prev = r.getRenderTarget();
    r.xr.enabled = false;
    r.setRenderTarget(rt);
    r.clear();
    r.render(world.scene, cam);
    r.setRenderTarget(prev);
    r.xr.enabled = xrOn;
    const px = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(rt, 0, 0, w, h, px);
    rt.dispose();
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    // opaque, as the headset shows it: alpha-to-coverage leaves fractional alpha on cut-out edges
    // (grass, leaves), which read as black specks once the image is flattened
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    ctx.putImageData(img, 0, 0);
    let el = document.getElementById('harness-snap') as HTMLImageElement | null;
    if (!el) {
      el = document.createElement('img');
      el.id = 'harness-snap';
      el.style.cssText = 'position:fixed;left:0;top:0;width:100vw;z-index:99999;';
      document.body.appendChild(el);
    }
    el.src = c.toDataURL();
    el.style.display = 'block';
  };

  (window as unknown as { __harness: unknown }).__harness = {
    state,
    snapshot,
    eye,
    aimHand,
    /** press and release a button on a controller ('trigger', 'squeeze', 'a-button', ...) */
    async press(hand: 'left' | 'right', id: string, ms = 90): Promise<void> {
      const R = pin(hand);
      R?.updateButtonValue(id, 1);
      await sleep(ms);
      R?.updateButtonValue(id, 0);
      await sleep(60);
    },
    hide(): void {
      document.getElementById('harness-snap')?.remove();
    },
    aim,
    until,
    async enter(): Promise<boolean> {
      if (!world.session) launchXR(world, { sessionMode: SessionMode.ImmersiveVR, features: { handTracking: true } });
      for (let i = 0; i < 50 && !world.session; i++) await sleep(100);
      await sleep(300);
      await introDone(); // the boot intro's six seconds
      return !!world.session;
    },
    stand(x: number, z: number, yaw: number, y?: number): void {
      world.player.position.set(x, y ?? world.player.position.y, z);
      world.player.rotation.set(0, yaw, 0);
    },
    /** Trigger down with the rod cocked back, sweep it forward, let go part-way down. */
    async cast(from = 70, to = -5, ms = 200, releaseAt = 0.8): Promise<string> {
      const R = pin();
      if (!R) return 'no controller';
      aim(from);
      await sleep(300);
      R.updateButtonValue('trigger', 1);
      await sleep(150);
      const t0 = performance.now();
      let released = false;
      for (;;) {
        const k = Math.min(1, (performance.now() - t0) / ms);
        aim(from + (to - from) * k);
        if (!released && k >= releaseAt) {
          R.updateButtonValue('trigger', 0);
          released = true;
        }
        if (k >= 1) break;
        await sleep(8);
      }
      R.updateButtonValue('trigger', 0);
      aim(15);
      return until(['floating', 'retrieving', 'idle'], 6000, false);
    },
    /** Reel on the trigger, easing off above the green band, until the fight ends. */
    async fight(timeoutMs = 90000): Promise<{ result: string; log: string[] }> {
      const R = pin();
      const log: string[] = [];
      const t0 = performance.now();
      let lastLog = 0;
      while (state() === 'fighting' && performance.now() - t0 < timeoutMs) {
        const f = fishingView.fight?.() as { tension: number; band: [number, number]; distance: number; stamina: number } | null;
        if (f && R) R.updateButtonValue('trigger', f.tension < f.band[1] - 0.08 ? 0.8 : 0);
        if (f && performance.now() - lastLog > 2000) {
          lastLog = performance.now();
          log.push(`t ${f.tension.toFixed(2)} d ${f.distance.toFixed(1)} m stamina ${f.stamina.toFixed(2)}`);
        }
        await sleep(30);
      }
      R?.updateButtonValue('trigger', 0);
      return { result: state(), log };
    },
  };
}
