// Rules are pure predicates over a creature's traits.
// Primitives: has, anyOf, count. Combinators: and, or, not.

export const has = (slot, value) => ({ op: 'has', slot, value });
export const anyOf = (slot, values) => ({ op: 'anyOf', slot, values });
export const count = (min, terms) => ({ op: 'count', min, terms });
export const and = (...rules) => ({ op: 'and', rules });
export const or = (...rules) => ({ op: 'or', rules });
export const not = (rule) => ({ op: 'not', rule });

export function evaluate(rule, traits) {
  switch (rule.op) {
    case 'has':
      return traits[rule.slot] === rule.value;
    case 'anyOf':
      return rule.values.includes(traits[rule.slot]);
    case 'count':
      return rule.terms.filter((t) => traits[t.slot] === t.value).length >= rule.min;
    case 'and':
      return rule.rules.every((r) => evaluate(r, traits));
    case 'or':
      return rule.rules.some((r) => evaluate(r, traits));
    case 'not':
      return !evaluate(rule.rule, traits);
    default:
      throw new Error('Unknown rule op: ' + rule.op);
  }
}

// Every slot a rule looks at (used by hints).
export function ruleSlots(rule) {
  switch (rule.op) {
    case 'has':
    case 'anyOf':
      return [rule.slot];
    case 'count':
      return [...new Set(rule.terms.map((t) => t.slot))];
    case 'and':
    case 'or':
      return [...new Set(rule.rules.flatMap(ruleSlots))];
    case 'not':
      return ruleSlots(rule.rule);
    default:
      throw new Error('Unknown rule op: ' + rule.op);
  }
}

// Plain-words description. `t(key, vars)` is the text lookup.
export function describeRule(rule, t) {
  const val = (slot, v) => t(slot + '.' + v);
  switch (rule.op) {
    case 'has':
      return t('rule.has', { slot: t('slot.' + rule.slot), value: val(rule.slot, rule.value) });
    case 'anyOf':
      return t('rule.anyOf', {
        slot: t('slot.' + rule.slot),
        values: rule.values.map((v) => val(rule.slot, v)).join(t('rule.listOr')),
      });
    case 'count':
      return t('rule.count', { n: rule.min, values: rule.terms.map((x) => val(x.slot, x.value)).join(', ') });
    case 'and':
      return rule.rules.map((r) => describeRule(r, t)).reduce((a, b) => t('rule.and', { a, b }));
    case 'or':
      return rule.rules.map((r) => describeRule(r, t)).reduce((a, b) => t('rule.or', { a, b }));
    case 'not':
      return t('rule.not', { a: describeRule(rule.rule, t) });
    default:
      throw new Error('Unknown rule op: ' + rule.op);
  }
}
