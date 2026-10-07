/**
 * Reads both tracked hands once a frame into `hands` (input/hands.ts), before anything that plays
 * on them: the rod in your fist, the travel map's pull-down and fingertip, the palm menu.
 */

import { createSystem } from '@iwsdk/core';
import { readHands } from './hands.ts';

export class HandSystem extends createSystem({}) {
  update(delta: number): void {
    readHands(this, Math.min(delta, 0.1));
  }
}
