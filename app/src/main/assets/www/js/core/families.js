// Puzzle families. Each family turns a declarative puzzle definition into:
//   targets(def)                  the places a creature can be sent
//   hypotheses(def, tier, traits) every hidden rule the tier allows
//   place(hyp, traits)            the one correct target for a creature
//   feedback(correct, target)     what the player is told for an attempt;
//                                 it depends only on where the creature
//                                 belongs and where it was sent
//   slots(hyp)                    slots the hidden rule looks at (for hints)
//   describe(hyp, t)              plain-words lines shown once the Stop ends
// New puzzles in an existing family are data only (content/puzzles.json).
// A tier's "forms" list names the rule shapes it may use.

import { has, anyOf, count, and, or, not, evaluate, ruleSlots, describeRule } from './rules.js';

const slotValues = (traits, id) => traits.slots.find((s) => s.id === id).values;

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

const atoms = (traits, slots) => slots.flatMap((slot) => slotValues(traits, slot).map((v) => has(slot, v)));
// All ways to pick half of a slot's values (the other half is the complement).
const halves = (traits, slots) => slots.flatMap((slot) => pairs(slotValues(traits, slot)).map((values) => anyOf(slot, values)));
const distinct = (...rules) => new Set(rules.map((r) => r.slot)).size === rules.length;

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

const twoWay = (ids) => ({
  targets: () => ids.map((id) => ({ id, label: 'target.' + id })),
  place: (hyp, traits) => (evaluate(hyp.rule, traits) ? ids[0] : ids[1]),
  feedback: plain,
  slots: (hyp) => ruleSlots(hyp.rule),
  describe: (hyp, t) => [t('rule.goes', { target: t('target.' + ids[0]), rule: say(hyp, t) }), t('rule.rest', { target: t('target.' + ids[1]) })],
});

const GATES = ['gateA', 'gateB', 'gateC'];
// One split per slot: halves, plus single values when the tier allows.
const splits = (traits, slots, forms) => [...(forms.includes('half') ? halves(traits, slots) : []), ...(forms.includes('has') ? atoms(traits, slots) : [])];

export const FAMILIES = {
  // Two gates: gate one admits the hidden rule, gate two everyone else.
  // Three gates: gate one has a rule, gate two has another for those turned
  // away from gate one, gate three takes the overflow.
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

  // A 2x2 field. One slot splits the rows, a different slot splits the columns.
  pattern_grid: {
    targets(def) {
      const out = [];
      for (let r = 0; r < def.params.rows; r++)
        for (let c = 0; c < def.params.cols; c++) out.push({ id: `r${r}c${c}`, label: 'target.cell', row: r, col: c });
      return out;
    },
    hypotheses(def, tier, traits) {
      const all = splits(traits, tier.slots, tier.forms);
      const out = [];
      for (const row of all) for (const col of all) if (row.slot !== col.slot) out.push({ row, col });
      return out;
    },
    place: (hyp, traits) => `r${evaluate(hyp.row, traits) ? 0 : 1}c${evaluate(hyp.col, traits) ? 0 : 1}`,
    feedback(correct, target) {
      const rowOk = correct[1] === target[1];
      const colOk = correct[3] === target[3];
      return { ok: rowOk && colOk, rowOk, colOk };
    },
    slots: (hyp) => [...ruleSlots(hyp.row), ...ruleSlots(hyp.col)],
    describe: (hyp, t) => [t('rule.rows', { rule: describeRule(hyp.row, t) }), t('rule.cols', { rule: describeRule(hyp.col, t) })],
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
};

export function family(id) {
  const f = FAMILIES[id];
  if (!f) throw new Error('Unknown puzzle family: ' + id);
  return f;
}

// Stable key for a feedback object, used to compare observations.
export const feedbackKey = (fb) => (fb.ok ? 'ok' : 'rowOk' in fb ? `g${+fb.rowOk}${+fb.colOk}` : 'at' in fb ? 'f' + fb.at : 'no');
