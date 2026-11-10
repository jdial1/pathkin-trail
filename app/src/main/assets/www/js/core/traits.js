// Trait model: creatures are combinations of the slots in the traits pack.
import { makeRng } from './rng.js';

export function comboCount(traits) {
  return traits.slots.reduce((n, s) => n * s.values.length, 1);
}

export function decodeCombo(traits, index) {
  const out = {};
  let n = index;
  for (const slot of traits.slots) {
    out[slot.id] = slot.values[n % slot.values.length];
    n = Math.floor(n / slot.values.length);
  }
  return out;
}

// Roster = first `rosterSize` combos of a seeded shuffle, drawn without replacement.
export function buildRoster(traits, seed) {
  const rng = makeRng(seed);
  const order = rng.shuffle(Array.from({ length: comboCount(traits) }, (_, i) => i));
  return order.slice(0, traits.rosterSize).map((combo, i) => ({
    id: 'c_' + String(i + 1).padStart(4, '0'),
    traits: decodeCombo(traits, combo),
    nickname: null,
    favourite: false,
    status: 'available',
    history: { stopsCleared: 0, timesReturned: 0 },
  }));
}

export const STATUSES = ['available', 'party', 'delivered', 'parked', 'lost'];

// Inverse of decodeCombo: the index of a trait combination.
export function encodeCombo(traits, values) {
  let n = 0;
  let mul = 1;
  for (const slot of traits.slots) {
    n += slot.values.indexOf(values[slot.id]) * mul;
    mul *= slot.values.length;
  }
  return n;
}
