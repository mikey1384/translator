import { createHash } from 'node:crypto';

function normalize(value, seen) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        'Canonical JSON does not support non-finite numbers.'
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    if (seen.has(value))
      throw new TypeError('Canonical JSON cannot contain cycles.');
    seen.add(value);
    const normalized = value.map(item => normalize(item, seen));
    seen.delete(value);
    return normalized;
  }

  if (typeof value === 'object' && value) {
    if (seen.has(value))
      throw new TypeError('Canonical JSON cannot contain cycles.');
    seen.add(value);
    // A null-prototype accumulator preserves JSON keys such as `__proto__`
    // as ordinary data instead of invoking Object.prototype setters.
    const normalized = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child === undefined) continue;
      normalized[key] = normalize(child, seen);
    }
    seen.delete(value);
    return normalized;
  }

  throw new TypeError(
    `Canonical JSON does not support ${typeof value} values.`
  );
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value, new Set()));
}

export function canonicalJsonHash(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
