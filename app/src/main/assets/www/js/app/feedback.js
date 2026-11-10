// Feedback bus. Gameplay emits typed events (accepted, rejected, hint,
// solved, failed); audio, haptics and the screen subscribe here. Gameplay
// code never calls UI directly.

import { vibrate } from './storage.js';

const listeners = new Set();
export const bus = {
  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit(event) {
    for (const fn of listeners) fn(event);
  },
};

// Short synthesised cues. Accepted rises, rejected falls: the contour
// differs, not just the volume.
const CUES = {
  accepted: [[523, 0], [784, 0.09]],
  rejected: [[330, 0], [220, 0.11]],
  hint: [[660, 0], [660, 0.12]],
  solved: [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.3]],
  failed: [[294, 0], [247, 0.16], [196, 0.32]],
};
const BUZZ = { accepted: 15, rejected: 60, hint: 20, solved: 120, failed: 200 };

let ctx = null;
function play(notes) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    for (const [freq, at] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + at;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.18);
    }
  } catch (e) {
    /* audio is optional */
  }
}

export function attachSenses(getSettings) {
  bus.on((event) => {
    const s = getSettings();
    if (s.audio && CUES[event.type]) play(CUES[event.type]);
    if (s.haptics && BUZZ[event.type]) vibrate(BUZZ[event.type]);
  });
}
