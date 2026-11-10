// Puzzle families. A family turns a declarative puzzle definition into a
// playable Stop. Every family provides:
//   kind                  'sort' (send a creature to a target), 'seat' (place
//                         creatures on linked seats) or 'probe' (other actions)
//   targets(def, state)   places the player can act on
//   hyps(def, cfg, traits, setup)   every hidden rule the tier allows
//   outcome(h, action, pre, env)    what happens if rule h were true:
//                         { fb, cost, deliver, ... } or null if not allowed
//   key(fb)               stable string for comparing feedback
//   describe(h, t, setup, env)      plain-words lines shown when the Stop ends
// and optionally create, pre, after, alive, truth, settle, onFail, slots, hint.
// New puzzles in an existing family are data only (content/puzzles.json).
// A tier's "forms" list names the rule shapes it may use.

import { has, anyOf, count, and, or, not, evaluate, ruleSlots, describeRule } from './rules.js';
import { comboCount, decodeCombo } from './traits.js';

const slotValues = (traits, id) => traits.slots.find((s) => s.id === id).values;
const traitKey = (t) => Object.values(t).join(',');

function pairs(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
  return out;
}
function triples(list) {
  const out = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) for (let k = j + 1; k < list.length; k++) out.push([list[i], list[j], list[k]]);
  return out;
}
function permutations(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [x, ...rest]));
}
// Ordered selections of k distinct items.
function arrangements(list, k) {
  if (k === 0) return [[]];
  return list.flatMap((x, i) => arrangements([...list.slice(0, i), ...list.slice(i + 1)], k - 1).map((rest) => [x, ...rest]));
}
function subsets(list, size) {
  if (size === 0) return [[]];
  if (list.length < size) return [];
  const [first, ...rest] = list;
  return [...subsets(rest, size - 1).map((s) => [first, ...s]), ...subsets(rest, size)];
}

const atoms = (traits, slots) => slots.flatMap((slot) => slotValues(traits, slot).map((v) => has(slot, v)));
// All ways to pick half of a slot's values (the other half is the complement).
const halves = (traits, slots) => slots.flatMap((slot) => pairs(slotValues(traits, slot)).map((values) => anyOf(slot, values)));
const distinct = (...rules) => new Set(rules.map((r) => r.slot)).size === rules.length;
// Every order of one slot's values: value at index i belongs to place i.
const orders = (traits, slots) => slots.flatMap((slot) => permutations(slotValues(traits, slot)).map((order) => ({ slot, order })));

// Rule shapes over single-trait atoms.
const ATOM_FORMS = {
  has: (a) => a.map((rule) => ({ rule })),
  and2: (a) => pairs(a).filter((p) => distinct(...p)).map(([x, y]) => ({ rule: and(x, y) })),
  or2: (a) => pairs(a).filter((p) => distinct(...p)).map(([x, y]) => ({ rule: or(x, y) })),
  and3: (a) => triples(a).filter((p) => distinct(...p)).map((p) => ({ rule: and(...p) })),
  or3: (a) => triples(a).filter((p) => distinct(...p)).map((p) => ({ rule: or(...p) })),
  count2of3: (a) => triples(a).filter((p) => distinct(...p)).map((p) => ({ rule: count(2, p.map(({ slot, value }) => ({ slot, value }))) })),
  anyOf2: (a, h) => h.map((rule) => ({ rule })),
  andNot: (a, h) => h.flatMap((half) => a.filter((x) => x.slot !== half.slot).map((x) => ({ rule: and(half, not(x)) }))),
};

// Rule shapes over half-splits.
const HALF_FORMS = {
  half: (a, h) => h.map((rule) => ({ rule })),
  has: (a) => a.map((rule) => ({ rule })),
  halfAnd2: (a, h) => pairs(h).filter((p) => distinct(...p)).map(([x, y]) => ({ rule: and(x, y) })),
  halfOr2: (a, h) => pairs(h).filter((p) => distinct(...p)).map(([x, y]) => ({ rule: or(x, y) })),
  xor2: (a, h) =>
    pairs(h)
      .filter((p) => distinct(...p))
      .map(([x, y]) => ({ rule: or(and(x, not(y)), and(not(x), y)), xor: [x, y] })),
};

function build(forms, table, traits, slots) {
  const a = atoms(traits, slots);
  const h = halves(traits, slots);
  return forms.flatMap((form) => {
    if (!table[form]) throw new Error('Unknown rule form: ' + form);
    return table[form](a, h);
  });
}

const say = (hyp, t) => (hyp.xor ? t('rule.xor', { a: describeRule(hyp.xor[0], t), b: describeRule(hyp.xor[1], t) }) : describeRule(hyp.rule, t));
const plain = (correct, target) => ({ ok: correct === target });
const splits = (traits, slots, forms) => [...(forms.includes('half') ? halves(traits, slots) : []), ...(forms.includes('has') ? atoms(traits, slots) : [])];
const sayOrder = (o, t) => o.order.map((v) => t(`${o.slot}.${v}`)).join(', ');

// ---- Sorting families: every creature has exactly one correct target ----
// spec = { targets, hypotheses, place, feedback(correct, target), slots, describe }
function sorter(spec) {
  return {
    kind: 'sort',
    ...spec,
    hyps: (def, cfg, traits) => spec.hypotheses(def, cfg, traits),
    outcome(h, action, pre, env) {
      const traits = env.creatures[action.id] || env.examples[action.id];
      const fb = spec.feedback(spec.place(h, traits), action.target);
      return { fb, cost: fb.ok ? 0 : 1, deliver: fb.ok ? [{ id: action.id, at: action.target }] : [] };
    },
    key: (fb) => (fb.ok ? 'ok' : 'rowOk' in fb ? `g${+fb.rowOk}${+fb.colOk}` : 'at' in fb ? 'f' + fb.at : 'dir' in fb ? 'd' + fb.dir : 'cell' in fb ? 'L' + fb.cell : 'no'),
  };
}

const twoWay = (ids) => ({
  targets: () => ids.map((id) => ({ id, label: 'target.' + id })),
  place: (hyp, traits) => (evaluate(hyp.rule, traits) ? ids[0] : ids[1]),
  feedback: plain,
  slots: (hyp) => ruleSlots(hyp.rule),
  describe: (hyp, t) => [t('rule.goes', { target: t('target.' + ids[0]), rule: say(hyp, t) }), t('rule.rest', { target: t('target.' + ids[1]) })],
});

const GATES = ['gateA', 'gateB', 'gateC'];
const four = (prefix, label) => () => [0, 1, 2, 3].map((n) => ({ id: prefix + n, label, n }));

const SORTERS = {
  // Two gates: gate one admits the hidden rule, gate two everyone else.
  // Three gates: gate two has its own rule for those turned away from gate
  // one, gate three takes the overflow.
  gate_sort: {
    targets: (def) => GATES.slice(0, def.params.gates).map((id) => ({ id, label: 'target.' + id })),
    hypotheses(def, tier, traits) {
      const rules = build(tier.forms, ATOM_FORMS, traits, tier.slots);
      if (def.params.gates === 2) return rules;
      const out = [];
      for (const a of rules)
        for (const b of rules) {
          if (ruleSlots(a.rule).some((s) => ruleSlots(b.rule).includes(s))) continue;
          out.push({ rules: [a.rule, b.rule] });
        }
      return out;
    },
    place(hyp, traits) {
      if (hyp.rule) return evaluate(hyp.rule, traits) ? 'gateA' : 'gateB';
      return evaluate(hyp.rules[0], traits) ? 'gateA' : evaluate(hyp.rules[1], traits) ? 'gateB' : 'gateC';
    },
    feedback: plain,
    slots: (hyp) => (hyp.rule ? ruleSlots(hyp.rule) : hyp.rules.flatMap(ruleSlots)),
    describe(hyp, t) {
      if (hyp.rule) return twoWay(GATES).describe(hyp, t);
      return [
        t('rule.goes', { target: t('target.gateA'), rule: describeRule(hyp.rules[0], t) }),
        t('rule.goesNext', { target: t('target.gateB'), rule: describeRule(hyp.rules[1], t) }),
        t('rule.rest', { target: t('target.gateC') }),
      ];
    },
  },

  // Two bridges with complementary rules.
  bridge_pair: {
    ...twoWay(['bridge1', 'bridge2']),
    hypotheses: (def, tier, traits) => build(tier.forms, HALF_FORMS, traits, tier.slots),
  },

  // A field of patches. One slot decides the row, a different slot the
  // column. Two rows or columns split a slot in half; four use every value.
  pattern_grid: {
    targets(def) {
      const out = [];
      for (let r = 0; r < def.params.rows; r++)
        for (let c = 0; c < def.params.cols; c++) out.push({ id: `r${r}c${c}`, label: 'target.cell', row: r, col: c });
      return out;
    },
    hypotheses(def, tier, traits) {
      const axis = (n) => (n === 4 ? orders(traits, tier.slots) : splits(traits, tier.slots, tier.forms));
      const out = [];
      for (const row of axis(def.params.rows)) for (const col of axis(def.params.cols)) if (row.slot !== col.slot) out.push({ row, col });
      return out;
    },
    place(hyp, traits) {
      const at = (axis) => (axis.order ? axis.order.indexOf(traits[axis.slot]) : evaluate(axis, traits) ? 0 : 1);
      return `r${at(hyp.row)}c${at(hyp.col)}`;
    },
    feedback(correct, target) {
      const rowOk = correct[1] === target[1];
      const colOk = correct[3] === target[3];
      return { ok: rowOk && colOk, rowOk, colOk };
    },
    slots: (hyp) => [hyp.row.slot, hyp.col.slot],
    describe(hyp, t) {
      const line = (axis, split, list) => (axis.order ? t(list, { slot: t('slot.' + axis.slot), order: sayOrder(axis, t) }) : t(split, { rule: describeRule(axis, t) }));
      return [line(hyp.row, 'rule.rows', 'rule.rowOrder'), line(hyp.col, 'rule.cols', 'rule.colOrder')];
    },
  },

  // A forked trail: a first fork, then a second fork on each side, each with
  // its own toll rule. A creature walks toward the chosen exit and is turned
  // back at the first fork that disagrees, so a miss only tells you about the
  // forks it actually reached.
  tour_path: {
    targets: () => ['e00', 'e01', 'e10', 'e11'].map((id) => ({ id, label: 'target.exit', side: Number(id[1]), turn: Number(id[2]) })),
    hypotheses(def, tier, traits) {
      const all = splits(traits, tier.slots, tier.forms);
      const out = [];
      for (const root of all)
        for (const left of all) {
          if (left.slot === root.slot) continue;
          for (const right of all) if (right.slot !== root.slot) out.push({ root, left, right });
        }
      return out;
    },
    place(hyp, traits) {
      const side = evaluate(hyp.root, traits) ? 0 : 1;
      const turn = evaluate(side === 0 ? hyp.left : hyp.right, traits) ? 0 : 1;
      return `e${side}${turn}`;
    },
    feedback(correct, target) {
      if (correct[1] !== target[1]) return { ok: false, at: 0 };
      if (correct[2] !== target[2]) return { ok: false, at: 1 };
      return { ok: true };
    },
    slots: (hyp) => [...new Set([hyp.root, hyp.left, hyp.right].flatMap(ruleSlots))],
    describe: (hyp, t) => [
      t('rule.fork1', { rule: describeRule(hyp.root, t) }),
      t('rule.fork2a', { rule: describeRule(hyp.left, t) }),
      t('rule.fork2b', { rule: describeRule(hyp.right, t) }),
    ],
  },

  // A line with four places, front to back. One slot's values stand in a
  // hidden order. A miss says whether the creature belongs nearer the front
  // or further back.
  rank_line: {
    targets: four('k', 'target.place'),
    hypotheses: (def, tier, traits) => orders(traits, tier.slots),
    place: (hyp, traits) => 'k' + hyp.order.indexOf(traits[hyp.slot]),
    feedback: (correct, target) => (correct === target ? { ok: true } : { ok: false, dir: correct[1] < target[1] ? -1 : 1 }),
    slots: (hyp) => [hyp.slot],
    describe: (hyp, t) => [t('rule.lineOrder', { slot: t('slot.' + hyp.slot), order: sayOrder(hyp, t) })],
  },

  // Four posts, each carved with a glyph. A hidden pairing links each glyph
  // to one value of one slot (or, on harder tiers, to a pair of half-splits).
  totem_match: {
    targets: four('t', 'target.post'),
    hypotheses(def, tier, traits) {
      const out = orders(traits, tier.slots);
      if (tier.forms.includes('pairHalf')) {
        for (const [x, y] of pairs(halves(traits, tier.slots))) if (x.slot !== y.slot) out.push({ row: x, col: y });
      }
      return out;
    },
    place: (hyp, traits) => (hyp.order ? 't' + hyp.order.indexOf(traits[hyp.slot]) : 't' + ((evaluate(hyp.row, traits) ? 0 : 2) + (evaluate(hyp.col, traits) ? 0 : 1))),
    feedback: plain,
    slots: (hyp) => (hyp.order ? [hyp.slot] : [hyp.row.slot, hyp.col.slot]),
    describe: (hyp, t) =>
      hyp.order
        ? [t('rule.postOrder', { slot: t('slot.' + hyp.slot), order: sayOrder(hyp, t) })]
        : [t('rule.postPairA', { rule: describeRule(hyp.row, t) }), t('rule.postPairB', { rule: describeRule(hyp.col, t) })],
  },

  // A 4x4 plot. One slot's values name the rows and another's the columns,
  // both in a hidden order. A miss shows the patch where the creature landed.
  toss_plot: {
    targets() {
      const out = [];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out.push({ id: `r${r}c${c}`, label: 'target.cell', row: r, col: c });
      return out;
    },
    hypotheses(def, tier, traits) {
      const all = orders(traits, tier.slots);
      const out = [];
      for (const row of all) for (const col of all) if (row.slot !== col.slot) out.push({ row, col });
      return out;
    },
    place: (hyp, traits) => `r${hyp.row.order.indexOf(traits[hyp.row.slot])}c${hyp.col.order.indexOf(traits[hyp.col.slot])}`,
    feedback: (correct, target) => (correct === target ? { ok: true } : { ok: false, cell: correct }),
    slots: (hyp) => [hyp.row.slot, hyp.col.slot],
    describe: (hyp, t) => [
      t('rule.rowOrder', { slot: t('slot.' + hyp.row.slot), order: sayOrder(hyp.row, t) }),
      t('rule.colOrder', { slot: t('slot.' + hyp.col.slot), order: sayOrder(hyp.col, t) }),
    ],
  },
};

// ---- Seating families: creatures sit on a grid of seats; some neighbouring
// seats are linked, and linked neighbours must have something in common.
// Seated creatures can be lifted again for free, so there is no dead end. ----
const COLS = 4;
const seatNo = (target) => (typeof target === 'string' && target[0] === 's' ? Number(target.slice(1)) : -1);

function seater({ hyps, linkOk, slots, describe, kinds, vertical }) {
  return {
    kind: 'seat',
    targets: (def, state) => Array.from({ length: state.setup.seats }, (_, i) => ({ id: 's' + i, label: 'target.seat', n: i })),
    hyps,
    linkOk,
    slots,
    describe,
    // Builds the Stop from a known full seating, so a solution always exists.
    create(ctx, cfg, rng, partyIds) {
      const all = hyps(ctx.def, cfg, ctx.traits);
      const hyp = rng.pick(all);
      const n = partyIds.length;
      const nKinds = kinds(cfg);
      const neighbours = (i) => {
        const out = [];
        if (i % COLS > 0) out.push(i - 1);
        if (vertical && i - COLS >= 0) out.push(i - COLS);
        return out;
      };
      const matches = (a, b) => {
        const ks = [];
        for (let k = 0; k < nKinds; k++) if (linkOk(hyp, k, ctx.creatures[a], ctx.creatures[b])) ks.push(k);
        return ks;
      };
      const left = rng.shuffle(partyIds);
      const order = [];
      for (let i = 0; i < n; i++) {
        // Prefer a creature that links to as many already seated neighbours as possible.
        let best = 0;
        let bestScore = -1;
        for (let j = 0; j < left.length; j++) {
          const score = neighbours(i).filter((p) => matches(order[p], left[j]).length).length;
          if (score > bestScore) {
            bestScore = score;
            best = j;
          }
        }
        order.push(left.splice(best, 1)[0]);
      }
      const edges = [];
      for (let i = 0; i < n; i++)
        for (const p of neighbours(i)) {
          const ks = matches(order[p], order[i]);
          if (ks.length) edges.push([p, i, rng.pick(ks)]);
        }
      // A few creatures start seated, as anchors.
      const seats = {};
      for (const i of rng.shuffle(order.map((_, k) => k)).slice(0, Math.min(cfg.examples, n - 1))) seats[i] = order[i];
      return { hyp, setup: { seats: n, cols: COLS, edges, kinds: nKinds }, extra: { seats }, held: Object.values(seats) };
    },
    pre: (state) => ({ seats: state.extra.seats }),
    outcome(h, action, pre, env) {
      if (action.lift) {
        const id = pre.seats[seatNo(action.lift)];
        return id ? { fb: { ok: true }, cost: 0, deliver: [], release: [id], silent: true } : null;
      }
      const s = seatNo(action.target);
      if (!(s >= 0 && s < env.setup.seats) || pre.seats[s]) return null;
      const bad = [];
      env.setup.edges.forEach(([a, b, kind], i) => {
        const other = a === s ? b : b === s ? a : -1;
        if (other < 0 || !pre.seats[other]) return;
        if (!linkOk(h, kind, env.creatures[action.id], env.creatures[pre.seats[other]])) bad.push(i);
      });
      return bad.length ? { fb: { ok: false, bad }, cost: 1, deliver: [] } : { fb: { ok: true }, cost: 0, deliver: [], hold: [action.id] };
    },
    key: (fb) => (fb.ok ? 'ok' : 'b' + fb.bad.join('.')),
    after(state, action, out) {
      const seats = { ...state.extra.seats };
      if (action.lift) delete seats[seatNo(action.lift)];
      else if (out.fb.ok) seats[seatNo(action.target)] = action.id;
      return { ...state.extra, seats };
    },
    seated: (state) => Object.entries(state.extra.seats).map(([s, id]) => ({ id, at: 's' + s })),
    settle(state) {
      return state.queue.length === 0 ? { status: 'solved', deliver: this.seated(state) } : null;
    },
    onFail(state) {
      return this.seated(state);
    },
  };
}

const SEATERS = {
  // Benches: neighbours on a bench must share at least one trait from a
  // hidden set of slots that count.
  bench_link: seater({
    kinds: () => 1,
    vertical: false,
    hyps: (def, cfg) => cfg.setSizes.flatMap((size) => subsets(cfg.slots, size)).map((set) => ({ set })),
    linkOk: (h, kind, a, b) => h.set.some((s) => a[s] === b[s]),
    slots: (h) => h.set,
    describe: (h, t) => [t('rule.bench', { slots: h.set.map((s) => t('slot.' + s)).join(t('rule.listOr')) })],
  }),
  // A rope web: every rope has a kind, and each kind stands for one hidden
  // slot. Creatures joined by a rope must match on that rope's slot.
  link_web: seater({
    kinds: (cfg) => cfg.kinds,
    vertical: true,
    hyps: (def, cfg) => arrangements(cfg.slots, cfg.kinds).map((map) => ({ map })),
    linkOk: (h, kind, a, b) => a[h.map[kind]] === b[h.map[kind]],
    slots: (h) => h.map,
    describe: (h, t) => h.map.map((slot, k) => t('rule.rope', { n: 'ABCD'[k], slot: t('slot.' + slot) })),
  }),
};

// ---- Probe families ----
const bits = (mask, n) => Array.from({ length: n }, (_, i) => i).filter((i) => mask & (1 << i));
// How many creatures a success lets through: an even share of those waiting.
// `reserve` lists creatures that must stay behind for a later round.
export const share = (queue, parts, first = [], reserve = []) => {
  const rest = queue.filter((id) => !first.includes(id) && !reserve.includes(id));
  const n = Math.max(first.length, Math.ceil((queue.length - reserve.length) / parts));
  return [...first, ...rest.slice(0, n - first.length)].map((id) => ({ id, at: 'through' }));
};

const PROBES = {
  // Picky keepers: each keeper wants an exact set of trail foods. An offer
  // with something it dislikes is refused; an offer of only liked things that
  // is not yet complete just makes it ask for more.
  trade_ledger: {
    kind: 'probe',
    targets: (def, state) => Array.from({ length: state.setup.keepers }, (_, k) => ({ id: 'k' + k, label: 'target.keeper', n: k })),
    hypKey: (setup) => `${setup.items.length}x${setup.keepers}`,
    hyps(def, cfg, traits, setup) {
      const n = setup.items.length;
      const k = setup.keepers;
      const out = [];
      for (let code = 0; code < (k + 1) ** n; code++) {
        const sets = new Array(k).fill(0);
        for (let i = 0, c = code; i < n; i++, c = Math.floor(c / (k + 1))) if (c % (k + 1)) sets[(c % (k + 1)) - 1] |= 1 << i;
        if (sets.every(Boolean)) out.push({ sets });
      }
      return out;
    },
    create(ctx, cfg, rng) {
      const setup = { items: ctx.def.params.items.slice(0, cfg.items), keepers: cfg.keepers };
      const hyp = rng.pick(this.hyps(ctx.def, cfg, ctx.traits, setup));
      const extra = { fed: new Array(cfg.keepers).fill(false) };
      // Earlier visitors' offers that were refused or left the keeper wanting more.
      const guides = [];
      for (let tries = 0; guides.length < cfg.examples && tries < cfg.examples * 6; tries++) {
        const action = { keeper: rng.int(cfg.keepers), items: 1 << rng.int(setup.items.length) };
        const out = this.outcome(hyp, action, extra, { setup });
        if (!out.fb.ok && !guides.some((g) => g.action.keeper === action.keeper && g.action.items === action.items)) guides.push({ action, pre: extra, fb: out.fb });
      }
      return { hyp, setup, extra, guides };
    },
    pre: (state) => ({ fed: state.extra.fed }),
    outcome(h, action, pre, env) {
      const k = action.keeper;
      if (!(k >= 0 && k < env.setup.keepers) || pre.fed[k] || !(action.items > 0 && action.items < 1 << env.setup.items.length)) return null;
      const liked = h.sets[k];
      if (action.items === liked) return { fb: { ok: true }, cost: 0, deliver: [], share: pre.fed.filter((f) => !f).length };
      if (action.items & ~liked) return { fb: { ok: false, kind: 'bad' }, cost: 1, deliver: [] };
      return { fb: { ok: false, kind: 'more' }, cost: 0, deliver: [] };
    },
    key: (fb) => (fb.ok ? 'ok' : fb.kind),
    after(state, action, out) {
      return out.fb.ok ? { ...state.extra, fed: state.extra.fed.map((f, k) => f || k === action.keeper) } : state.extra;
    },
    // Rule found: every keeper still waiting has only one possible wish.
    settle(state, env, cands) {
      if (state.queue.length === 0 || state.extra.fed.every(Boolean)) return { status: 'solved', deliver: share(state.queue, 1) };
      const open = state.extra.fed.map((f, k) => (f ? -1 : k)).filter((k) => k >= 0);
      return open.every((k) => cands.every((h) => h.sets[k] === cands[0].sets[k])) ? { status: 'solved', deliver: share(state.queue, 1), auto: true } : null;
    },
    // A hint shows one food a waiting keeper does not want.
    hint(state, env, cands) {
      for (let k = 0; k < env.setup.keepers; k++) {
        if (state.extra.fed[k]) continue;
        for (let i = 0; i < env.setup.items.length; i++) {
          const dislikes = !(state.hyp.sets[k] & (1 << i));
          if (dislikes && cands.some((h) => h.sets[k] & (1 << i))) {
            return { obs: { action: { keeper: k, items: 1 << i }, pre: { fed: state.extra.fed }, fb: { ok: false, kind: 'bad' } }, say: { key: 'hint.trade', vars: { n: k + 1, item: 'item.' + env.setup.items[i] } } };
          }
        }
      }
      return null;
    },
    describe: (h, t, setup) => h.sets.map((mask, k) => t('rule.keeper', { n: k + 1, items: bits(mask, setup.items.length).map((i) => t('item.' + setup.items[i])).join(', ') })),
  },

  // The signal stone calls for one creature at a time. Part of what it wants
  // is carved on it; each wrong answer is graded against the one it wants.
  signal_guess: {
    kind: 'probe',
    targets: () => [{ id: 'stone', label: 'target.stone' }],
    hypKey: (setup) => setup.party.join(''),
    hyps: (def, cfg, traits, setup) => setup.party.slice(),
    truth: (state) => state.hyp.targets[state.extra.round],
    // Creatures the stone will call for in later rounds wait their turn.
    reserve: (state) => state.hyp.targets.slice(state.extra.round + 1),
    create(ctx, cfg, rng, partyIds) {
      const rounds = Math.min(cfg.rounds, partyIds.length);
      const targets = rng.shuffle(partyIds).slice(0, rounds);
      const slots = ctx.traits.slots.map((s) => s.id);
      const shown = targets.map(() => rng.shuffle(slots).slice(0, cfg.reveal));
      return { hyp: { targets }, setup: { party: partyIds.slice(), rounds, shown, grade: cfg.forms[0] }, extra: { round: 0, more: [] } };
    },
    // What the stone shows about the creature it wants this round.
    carved(state) {
      return [...state.setup.shown[state.extra.round], ...state.extra.more];
    },
    alive(h, state, env) {
      if (!state.queue.includes(h)) return false;
      const want = env.creatures[this.truth(state)];
      return this.carved(state).every((slot) => env.creatures[h][slot] === want[slot]);
    },
    pre: (state) => ({ round: state.extra.round, left: state.setup.rounds - state.extra.round }),
    // Only this round's answers say anything about this round's creature.
    relevant: (obs, state) => obs.pre.round === state.extra.round,
    outcome(h, action, pre, env) {
      if (action.target !== 'stone' || !env.creatures[action.id]) return null;
      if (action.id === h) return { fb: { ok: true }, cost: 0, deliver: [], share: pre.left, first: [h], next: true };
      const mine = env.creatures[action.id];
      const want = env.creatures[h];
      const hits = Object.keys(mine).map((s) => (mine[s] === want[s] ? 1 : 0));
      const marks = env.setup.grade === 'count' ? String(hits.reduce((a, b) => a + b, 0)) : hits.join('');
      return { fb: { ok: false, marks }, cost: 1, deliver: [] };
    },
    key: (fb) => (fb.ok ? 'ok' : 'm' + fb.marks),
    after: (state, action, out) => (out.fb.ok ? { ...state.extra, round: state.extra.round + 1, more: [] } : state.extra),
    settle: (state) => (state.queue.length === 0 || state.extra.round >= state.setup.rounds ? { status: 'solved', deliver: share(state.queue, 1) } : null),
    // A hint carves one more trait of the wanted creature onto the stone.
    hint(state, env) {
      const shown = this.carved(state);
      const slot = Object.keys(env.creatures[this.truth(state)]).find((s) => !shown.includes(s));
      return slot ? { extra: { ...state.extra, more: [...state.extra.more, slot] }, say: { key: 'stop.hintIs', vars: { slot: 'slot.' + slot } } } : null;
    },
    describe: (h, t) => h.targets.map((id, i) => t('rule.signal', { n: i + 1, name: t('creature.unnamed', { n: Number(id.slice(2)) }) })),
  },

  // The still pond changes what it reflects by a hidden rule. It shows one
  // reflection at a time; find the creature that casts it. A wrong pick shows
  // that creature's own reflection.
  echo_match: {
    kind: 'probe',
    targets: () => [{ id: 'pond', label: 'target.pond' }],
    hyps(def, cfg, traits) {
      const perSlot = (slot) => {
        const v = slotValues(traits, slot);
        const out = [];
        if (cfg.forms.includes('shift')) for (let k = 1; k < v.length; k++) out.push({ slot, to: v.map((_, i) => v[(i + k) % v.length]) });
        if (cfg.forms.includes('perm')) for (const to of permutations(v)) if (to.some((x, i) => x !== v[i])) out.push({ slot, to });
        return out;
      };
      const singles = cfg.slots.flatMap(perSlot);
      const out = singles.map((op) => ({ ops: [op] }));
      // Two slots change at once: both by a shift, or (mixed) one by any reordering.
      const shifts = cfg.slots.flatMap((slot) => {
        const v = slotValues(traits, slot);
        return [1, 2, 3].map((k) => ({ slot, to: v.map((_, i) => v[(i + k) % v.length]) }));
      });
      if (cfg.forms.includes('two')) for (const [a, b] of pairs(shifts)) if (a.slot !== b.slot) out.push({ ops: [a, b] });
      if (cfg.forms.includes('mixed')) for (const a of shifts) for (const b of singles) if (a.slot !== b.slot) out.push({ ops: [a, b] });
      return out;
    },
    reflect(h, traits, pack) {
      const out = { ...traits };
      for (const op of h.ops) out[op.slot] = op.to[slotValues(pack, op.slot).indexOf(traits[op.slot])];
      return out;
    },
    // The creature whose reflection is showing.
    current: (state) => state.extra.order.find((id) => state.queue.includes(id)),
    create(ctx, cfg, rng, partyIds) {
      const hyp = rng.pick(this.hyps(ctx.def, cfg, ctx.traits));
      const guides = [];
      const examples = {};
      for (let i = 0; i < cfg.examples; i++) {
        const traits = decodeCombo(ctx.traits, rng.int(comboCount(ctx.traits)));
        examples['x_' + (i + 1)] = traits;
        guides.push({ action: { id: 'x_' + (i + 1), target: 'pond' }, pre: { shown: '' }, fb: { ok: false, refl: traitKey(this.reflect(hyp, traits, ctx.traits)) } });
      }
      return { hyp, setup: {}, extra: { order: rng.shuffle(partyIds) }, guides, examples };
    },
    pre(state, env) {
      return { shown: traitKey(this.reflect(state.hyp, env.creatures[this.current(state)], env.traits)) };
    },
    outcome(h, action, pre, env) {
      const traits = env.creatures[action.id] || env.examples[action.id];
      if (action.target !== 'pond' || !traits) return null;
      const refl = traitKey(this.reflect(h, traits, env.traits));
      return refl === pre.shown ? { fb: { ok: true }, cost: 0, deliver: [{ id: action.id, at: 'pond' }] } : { fb: { ok: false, refl }, cost: 1, deliver: [] };
    },
    key: (fb) => (fb.ok ? 'ok' : 'r' + fb.refl),
    // Rule found: every candidate reflects every waiting creature the same way.
    settle(state, env, cands) {
      if (state.queue.length === 0) return { status: 'solved', deliver: [] };
      const same = state.queue.every((id) => {
        const first = traitKey(this.reflect(cands[0], env.creatures[id], env.traits));
        return cands.every((h) => traitKey(this.reflect(h, env.creatures[id], env.traits)) === first);
      });
      return same ? { status: 'solved', deliver: state.queue.map((id) => ({ id, at: 'pond' })), auto: true } : null;
    },
    slots: (h) => h.ops.map((op) => op.slot),
    describe: (h, t, setup, env) =>
      h.ops.map((op) => {
        const v = slotValues(env.traits, op.slot);
        const changes = v.map((x, i) => (op.to[i] === x ? null : t('rule.becomes', { a: t(`${op.slot}.${x}`), b: t(`${op.slot}.${op.to[i]}`) }))).filter(Boolean);
        return t('rule.pond', { slot: t('slot.' + op.slot), changes: changes.join(', ') });
      }),
  },

  // Rail switches: a first switch, then one on each side, lead to four
  // sheds, one per coat. The player sets the switches and sends a small
  // convoy. A switch flips after a creature with its trigger trait rolls
  // over it, so later riders may be sent elsewhere. Some triggers are hidden.
  switch_run: {
    kind: 'probe',
    targets: () => [0, 1, 2, 3].map((n) => ({ id: 'e' + n, label: 'target.shed', n })),
    hypKey: (setup) => JSON.stringify(setup.triggers),
    hyps(def, cfg, traits, setup) {
      const all = atoms(traits, cfg.slots);
      const per = setup.triggers.map((shown) => (shown ? [shown] : all));
      return per[0].flatMap((a) => per[1].flatMap((b) => per[2].map((c) => [a, b, c])));
    },
    create(ctx, cfg, rng) {
      const all = atoms(ctx.traits, cfg.slots);
      const hyp = [rng.pick(all), rng.pick(all), rng.pick(all)];
      const hidden = rng.shuffle([0, 1, 2]).slice(0, cfg.hidden);
      const tints = slotValues(ctx.traits, 'tint');
      // Earlier convoys of trail guides, and where each rider ended up.
      const examples = {};
      const guides = [];
      for (let g = 0; g < cfg.examples; g++) {
        const convoy = [];
        for (let i = 0; i < cfg.convoy; i++) {
          const id = `x_${g * cfg.convoy + i + 1}`;
          examples[id] = decodeCombo(ctx.traits, rng.int(comboCount(ctx.traits)));
          convoy.push(id);
        }
        const dirs = [rng.int(2), rng.int(2), rng.int(2)];
        guides.push({ action: { dirs, convoy }, pre: { waiting: 99 }, fb: { ok: false, exits: this.run(hyp, dirs, convoy.map((id) => examples[id])).exits } });
      }
      return {
        hyp,
        setup: { triggers: hyp.map((atom, j) => (hidden.includes(j) ? null : atom)), sheds: rng.shuffle(tints), size: cfg.convoy },
        extra: { dirs: [0, 0, 0], known: [] },
        guides,
        examples,
      };
    },
    // Runs a convoy through the switches; returns the shed each rider reached.
    run(h, dirs, riders) {
      const d = dirs.slice();
      const exits = riders.map((traits) => {
        const side = d[0];
        const child = 1 + side;
        const exit = side * 2 + d[child];
        if (evaluate(h[0], traits)) d[0] ^= 1;
        if (evaluate(h[child], traits)) d[child] ^= 1;
        return exit;
      });
      return { exits, dirs: d };
    },
    alive: (h, state) => state.extra.known.every((j) => h[j].slot === state.hyp[j].slot && h[j].value === state.hyp[j].value),
    pre: (state) => ({ waiting: state.queue.length }),
    outcome(h, action, pre, env) {
      const ids = action.convoy || [];
      const size = ids.length;
      // A full convoy is required while enough riders wait; the last few may go in smaller groups.
      const sizeOk = pre.waiting > env.setup.size ? size === env.setup.size : size >= 1 && size <= pre.waiting;
      const dirsOk = Array.isArray(action.dirs) && action.dirs.length === 3 && action.dirs.every((d) => d === 0 || d === 1);
      const riders = ids.map((id) => env.creatures[id] || env.examples[id]);
      if (!dirsOk || !sizeOk || new Set(ids).size !== size || riders.some((r) => !r)) return null;
      const { exits, dirs } = this.run(h, action.dirs, riders);
      const deliver = ids.map((id, i) => ({ id, at: 'e' + exits[i] })).filter((d, i) => env.setup.sheds[exits[i]] === riders[i].tint);
      return { fb: { ok: deliver.length === size, exits }, cost: deliver.length === size ? 0 : 1, deliver, dirs };
    },
    key: (fb) => 'x' + fb.exits.join(''),
    after: (state, action, out) => ({ ...state.extra, dirs: out.dirs }),
    settle: (state) => (state.queue.length === 0 ? { status: 'solved', deliver: [] } : null),
    // A hint uncovers one hidden trigger.
    hint(state, env) {
      const j = env.setup.triggers.findIndex((shown, i) => !shown && !state.extra.known.includes(i));
      return j < 0 ? null : { extra: { ...state.extra, known: [...state.extra.known, j] }, say: { key: 'hint.switch', vars: { n: j + 1 } } };
    },
    describe: (h, t) => h.map((atom, j) => t('rule.switch', { n: j + 1, rule: describeRule(atom, t) })),
  },
};

export const FAMILIES = {
  ...Object.fromEntries(Object.entries(SORTERS).map(([id, spec]) => [id, sorter(spec)])),
  ...SEATERS,
  ...PROBES,
};

export function family(id) {
  const f = FAMILIES[id];
  if (!f) throw new Error('Unknown puzzle family: ' + id);
  return f;
}

export const feedbackKey = (fam, fb) => fam.key(fb);
export { traitKey };
