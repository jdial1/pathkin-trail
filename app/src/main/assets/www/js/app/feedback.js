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

// ---- Music ------------------------------------------------------------------
// A small generative tune per biome, made of three stems: a plucked melody,
// a bass and a soft pad. The key, scale and pace come from the theme pack.
// While a Stop is being worked on the melody thins out and quietens.

function tone(freq, at, dur, vol, type = 'triangle') {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(vol, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
// A repeatable "random" number for a step of the tune.
const dice = (n) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  return (Math.imul(x, 0xc2b2ae35) >>> 0) / 4294967296;
};

export const music = {
  on: false,
  tune: null,
  calm: false,
  timer: 0,
  step: 0,
  next: 0,
  note: 2,
  set({ on, tune, calm }) {
    this.calm = calm;
    if (tune !== this.tune) {
      this.tune = tune;
      this.step = 0;
    }
    if (on === this.on) return;
    this.on = on;
    clearInterval(this.timer);
    if (on) this.timer = setInterval(() => this.pump(), 120);
  },
  // Schedules the next few steps a little ahead of time.
  pump() {
    if (!ctx || ctx.state !== 'running' || !this.tune) return;
    const beat = 60 / this.tune.bpm / 2;
    if (this.next < ctx.currentTime) this.next = ctx.currentTime + 0.05;
    while (this.next < ctx.currentTime + 0.4) {
      this.play(this.step++, this.next, beat);
      this.next += beat;
    }
  },
  play(step, at, beat) {
    const { root, scale } = this.tune;
    const deg = (i) => root + scale[((i % scale.length) + scale.length) % scale.length] + 12 * Math.floor(i / scale.length);
    const bar = step % 8;
    if (bar === 0) tone(hz(deg(0) - 12), at, beat * 3.5, 0.07, 'sine');
    if (bar === 4) tone(hz(deg(Math.floor(scale.length / 2)) - 12), at, beat * 3, 0.055, 'sine');
    if (step % 16 === 0) tone(hz(deg(0)), at, beat * 14, 0.018, 'sine');
    if (step % 16 === 0) tone(hz(deg(2)), at, beat * 14, 0.014, 'sine');
    // The melody wanders up and down the scale; in a Stop it plays less and softer.
    const r = dice(step + root * 131);
    if (this.calm ? bar % 4 !== 0 || r < 0.35 : r < 0.3) return;
    this.note = Math.max(0, Math.min(scale.length * 2, this.note + Math.round(dice(step * 7 + 3) * 4 - 2)));
    tone(hz(deg(this.note)), at, beat * (this.calm ? 2.6 : 1.8), this.calm ? 0.03 : 0.06);
  },
};

// A short wordless call, different for each kind of feet.
export function voice(traits) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    const call = { hooves: [150, 120, 'sawtooth'], paws: [300, 360, 'triangle'], webs: [520, 760, 'sine'], roller: [240, 240, 'square'] }[traits.feet] || [300, 300, 'triangle'];
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = call[2];
    osc.frequency.setValueAtTime(call[0], t0);
    osc.frequency.exponentialRampToValueAtTime(call[1], t0 + 0.11);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.07, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.16);
  } catch (e) {
    /* audio is optional */
  }
}

// Sound may only start once the player has touched the screen.
window.addEventListener(
  'pointerdown',
  () => {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {
      /* audio is optional */
    }
  },
  { passive: true }
);
