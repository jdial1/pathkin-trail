// A small JSON Schema validator (the subset the content packs need):
// type, required, properties, additionalProperties, items, enum, minimum,
// maximum, minItems, minLength, pattern. Returns a list of problems.

const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v);

export function validate(value, schema, path = '$') {
  const out = [];
  const types = [].concat(schema.type || []);
  const actual = typeOf(value);
  if (types.length && !types.includes(actual) && !(actual === 'integer' && types.includes('number'))) {
    return [`${path}: expected ${types.join(' or ')}, found ${actual}`];
  }
  if (schema.enum && !schema.enum.includes(value)) out.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) out.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) out.push(`${path}: above ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) out.push(`${path}: too short`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) out.push(`${path}: does not match ${schema.pattern}`);
  }
  if (actual === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) out.push(`${path}: needs at least ${schema.minItems} items`);
    if (schema.items) value.forEach((v, i) => out.push(...validate(v, schema.items, `${path}[${i}]`)));
  }
  if (actual === 'object') {
    for (const key of schema.required || []) if (!(key in value)) out.push(`${path}: missing "${key}"`);
    for (const [key, v] of Object.entries(value)) {
      const sub = schema.properties && schema.properties[key];
      if (sub) out.push(...validate(v, sub, `${path}.${key}`));
      else if (schema.additionalProperties === false) out.push(`${path}: unknown key "${key}"`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') out.push(...validate(v, schema.additionalProperties, `${path}.${key}`));
    }
  }
  return out;
}
