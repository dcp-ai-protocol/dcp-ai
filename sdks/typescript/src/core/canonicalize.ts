/**
 * DCP v2.0 Canonicalization — RFC 8785 (JCS) with float prohibition.
 *
 * DCP-AI v2.0 mandates integer-only numeric values. This eliminates the
 * entire class of floating-point canonicalization ambiguities. Any payload
 * containing a non-integer number is rejected before signing.
 */

/**
 * Validate that a value contains no floating-point numbers anywhere in the tree.
 * Throws if a float is detected.
 */
export function assertNoFloats(value: unknown, path = '$'): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error(
        `Float value prohibited in DCP v2.0 at ${path}: ${value}. Use integer (e.g. millirisk 0-1000).`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertNoFloats(value[i], `${path}[${i}]`);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertNoFloats(v, `${path}.${k}`);
    }
  }
}

/**
 * RFC 8785 (JCS) canonical JSON serialization with DCP v2.0 restrictions:
 * - Object keys sorted lexicographically by Unicode code point
 * - Compact form (no whitespace)
 * - Integers only (floats rejected)
 * - null, true, false are literal
 * - Minimal string escaping per RFC 8785
 */
export function canonicalizeV2(obj: unknown): string {
  assertNoFloats(obj);
  return jcsSerialize(obj);
}

function jcsSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return jcsNumber(value);
    case 'string':
      return JSON.stringify(value);
    case 'object':
      if (Array.isArray(value)) {
        return '[' + value.map(jcsSerialize).join(',') + ']';
      }
      return jcsObject(value as Record<string, unknown>);
    default:
      throw new Error(`Unsupported type for canonicalization: ${typeof value}`);
  }
}

function jcsNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`Non-finite number in canonicalization: ${n}`);
  }
  // RFC 8785: integers must be serialized without decimal point
  if (Number.isInteger(n)) {
    return n.toString();
  }
  throw new Error(
    `Float value prohibited in DCP v2.0: ${n}`,
  );
}

function jcsObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const pairs: string[] = [];
  for (const key of keys) {
    const val = obj[key];
    if (val === undefined) continue;
    pairs.push(JSON.stringify(key) + ':' + jcsSerialize(val));
  }
  return '{' + pairs.join(',') + '}';
}
