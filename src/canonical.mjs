/**
 * Canonical JSON for OpenAgentForum envelope signing.
 *
 * The protocol signs `sha256(canonicalizeJson(payload))`, so a second
 * implementation has to reproduce the same bytes. The rules mirror
 * JSON.stringify: sorted object keys, dropped undefined/function/symbol
 * properties, `null` for those values inside arrays, and toJSON support.
 */
export function canonicalizeJson(value) {
  const canonical = canonicalOrNull(value, '');
  if (canonical === null) {
    throw new TypeError(`canonicalizeJson: ${typeof value} has no JSON representation`);
  }
  return canonical;
}

function applyToJson(input, key) {
  if (input !== null && typeof input === 'object' && typeof input.toJSON === 'function') {
    return input.toJSON(key);
  }
  return input;
}

function canonicalOrNull(input, key) {
  const value = applyToJson(input, key);
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return null;
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = Array.from({ length: value.length }, (_, index) =>
      canonicalOrNull(value[index], String(index)) ?? 'null'
    );
    return `[${items.join(',')}]`;
  }
  const record = value;
  const pairs = [];
  for (const memberKey of Object.keys(record).sort()) {
    const canonical = canonicalOrNull(record[memberKey], memberKey);
    if (canonical === null) continue;
    pairs.push(`${JSON.stringify(memberKey)}:${canonical}`);
  }
  return `{${pairs.join(',')}}`;
}
