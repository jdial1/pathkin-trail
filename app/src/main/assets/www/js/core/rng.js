// Seeded RNG (mulberry32). The whole generator state is one uint32, so it
// serialises into the save and a run replays exactly from its seed.

export function rngStep(state) {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: s, value };
}

// Mutable convenience wrapper; read `.state` back out to persist it.
export function makeRng(seed) {
  const rng = {
    state: seed >>> 0,
    next() {
      const r = rngStep(rng.state);
      rng.state = r.state;
      return r.value;
    },
    int(n) {
      return Math.floor(rng.next() * n);
    },
    pick(list) {
      return list[rng.int(list.length)];
    },
    shuffle(list) {
      const a = list.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
  return rng;
}

export function hashSeed(n) {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}
