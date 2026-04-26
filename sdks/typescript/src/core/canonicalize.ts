/**
 * DCP v2.0 Canonicalization — profile `dcp-jcs-v1`.
 *
 * Strict subset of RFC 8785 (JCS) with the cases JCS leaves
 * implementation-defined explicitly pinned. See
 * `spec/CANONICALIZATION_PROFILE.md` for the normative reference.
 *
 * Numeric rule: a number is valid iff its value is a finite integer.
 * `1.0`, `1.00`, and `1e2` are accepted because, post-parse, JavaScript
 * cannot distinguish them from `1` and `100`. `0.1`, `NaN`, and
 * infinities are rejected.
 *
 * Undefined handling (TypeScript-only): in objects, a key whose value
 * is `undefined` is omitted entirely; inside an array, `undefined`
 * serialises as the literal `null`. Other SDKs (Python, Rust, Go) do
 * not expose `undefined` as a distinct value.
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
