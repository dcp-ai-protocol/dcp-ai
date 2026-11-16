// Reference evaluator of the schema IR (tools/schema-ir/generate.mjs), in JavaScript. A phase-1 test tool and the
// template of the four SDK interpreters; it is under test here, not an oracle (the oracles are tools/schema-ir/oracle-ajv.mjs
// and tools/schema-ir/oracle_jsonschema.py).
//
// Semantics:
// - the envelope against the signed_bundle root, then each bundle.<member>.payload that is an object against its
//   artifact root (V2-2 binds them by member name), whatever the envelope gave;
// - types: integer is a finite number with no fraction (2 and 2.0 alike; a boolean never); object is any non-null
//   non-array object, read through its own enumerable string keys, where a key whose value is undefined counts as
//   absent (as the dcp-jcs-v1 TypeScript canonicalizer omits it); nothing is required of its prototype;
// - members of an open object that no schema names are not visited at all, so a host value there (NaN, a function,
//   a BigInt) is left to the later canonicalization layer;
// - lengths in code points as JavaScript iterates a string (a lone surrogate counts 1); patterns through the compiled
//   programs; date-time through the ajv-formats 3.0.1 port; enum and const by exact string equality;
// - oneOf: exactly one branch valid, reported as one oneOf error at the instance (branch errors are not listed);
// - at most `cap` (16) errors, then `truncated`; the walk stops there, the verdict is already invalid. An error names
//   the instance pointer (RFC 6901) and the keyword; each escaped pointer token is cut to 64 code points with a
//   marker, and an unknown member name is reported the same way. No input value is echoed. Nothing is written.
import { matchProgram } from './patterns.mjs';
import { isDateTime } from './date-time.mjs';

export const ERRORS_CAP = 16;
export const TOKEN_CAP = 64;
const STOP = Symbol('stop');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const enumerable = Object.prototype.propertyIsEnumerable;
export const present = (o, k) => enumerable.call(o, k) && o[k] !== undefined;

/** An RFC 6901 token, escaped first and then cut to TOKEN_CAP code points with a marker. */
export function boundedToken(t) {
  const cps = Array.from(String(t).replace(/~/g, '~0').replace(/\//g, '~1'));
  return cps.length > TOKEN_CAP ? `${cps.slice(0, TOKEN_CAP).join('')}…[cut]` : cps.join('');
}

function typeOk(t, v) {
  switch (t) {
    case 'null': return v === null;
    case 'boolean': return typeof v === 'boolean';
    case 'string': return typeof v === 'string';
    case 'integer': return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);
    case 'array': return Array.isArray(v);
    case 'object': return isObject(v);
    default: return false;
  }
}

/** Validates `doc` against the IR; `overlay` names an IR overlay ('dcp-jcs-v2') or is null. */
export function validateSchemaIR(ir, doc, { overlay = null, cap = ERRORS_CAP } = {}) {
  if (!Number.isInteger(cap) || cap < 1 || cap > ERRORS_CAP) throw new RangeError(`cap must be an integer from 1 to ${ERRORS_CAP}`);
  const replaced = new Map();
  if (overlay !== null) {
    const entries = ir.overlays?.[overlay];
    if (!entries) throw new Error(`unknown overlay ${overlay}`);
    for (const e of entries) replaced.set(`${e.node}/${e.keyword}`, e.value);
  }
  const kw = (id, k) => (replaced.has(`${id}/${k}`) ? replaced.get(`${id}/${k}`) : ir.nodes[id][k]);
  const errors = [];
  let truncated = false;
  let invalid = false; // set by the first error, whatever the list keeps: the verdict never depends on the cap

  // `sink` collects errors; a oneOf branch evaluates into a private sink and only its emptiness counts.
  function evalNode(id, v, ptr, sink) {
    const n = ir.nodes[id];
    if (n.ref !== undefined) evalNode(n.ref, v, ptr, sink);
    if (n.types && !n.types.some((t) => typeOk(t, v))) sink(ptr, 'type', n);
    if (n.enum && !(typeof v === 'string' && n.enum.includes(v))) sink(ptr, 'enum', n);
    if (n.const !== undefined && v !== kw(id, 'const')) sink(ptr, 'const', n);
    if (typeof v === 'string') {
      if (n.minLength !== undefined || n.maxLength !== undefined) {
        let len = 0;
        for (const _ of v) len += 1;
        if (n.minLength !== undefined && len < n.minLength) sink(ptr, 'minLength', n);
        if (n.maxLength !== undefined && len > n.maxLength) sink(ptr, 'maxLength', n);
      }
      if (n.pattern !== undefined && !matchProgram(ir.patterns[n.pattern], v)) sink(ptr, 'pattern', n);
      if (n.format === 'date-time' && !isDateTime(v)) sink(ptr, 'format', n);
    }
    if (Array.isArray(v)) {
      if (n.minItems !== undefined && v.length < n.minItems) sink(ptr, 'minItems', n);
      if (n.uniqueItems && v.every((x) => typeof x === 'string') && new Set(v).size !== v.length) sink(ptr, 'uniqueItems', n);
      // An undefined element is null to the TypeScript canonicalizer, so it is null here. A hole of a sparse array is
      // not JSON, and that canonicalizer writes it as nothing ("[1,,2]", observed in phase 1): a type error here.
      if (n.items !== undefined) {
        for (let i = 0; i < v.length; i++) {
          if (!(i in v)) sink(`${ptr}/${i}`, 'type', ir.nodes[n.items]);
          else evalNode(n.items, v[i] === undefined ? null : v[i], `${ptr}/${i}`, sink);
        }
      }
    }
    if (isObject(v)) {
      if (n.required) for (const r of n.required) if (!present(v, r)) sink(ptr, 'required', n, r);
      const props = n.properties ? new Map(n.properties) : null;
      if (n.closed) for (const k of Object.keys(v)) if (v[k] !== undefined && !(props && props.has(k))) sink(ptr, 'additionalProperties', n, k);
      if (props) for (const [k, child] of props) if (present(v, k)) evalNode(child, v[k], `${ptr}/${boundedToken(k)}`, sink);
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (n.minimum !== undefined && v < n.minimum) sink(ptr, 'minimum', n);
      if (n.maximum !== undefined && v > n.maximum) sink(ptr, 'maximum', n);
    }
    if (n.oneOf) {
      let valid = 0;
      for (const b of n.oneOf) {
        let failed = false;
        evalNode(b, v, ptr, () => { failed = true; });
        if (!failed) valid += 1;
      }
      if (valid !== 1) sink(ptr, 'oneOf', n);
    }
  }

  const top = (ptr, keyword, node, member) => {
    invalid = true;
    if (errors.length >= cap) { truncated = true; throw STOP; }
    errors.push({ instance: ptr, keyword, site: `${node.site}/${keyword}`, ...(member !== undefined ? { member: boundedToken(member) } : {}) });
  };
  try {
    evalNode(ir.roots.signed_bundle, doc, '', top);
    const bundle = isObject(doc) && present(doc, 'bundle') && isObject(doc.bundle) ? doc.bundle : null;
    for (const [member, root] of ir.roots.payloads) {
      const env = bundle && present(bundle, member) && isObject(bundle[member]) ? bundle[member] : null;
      if (env && present(env, 'payload') && isObject(env.payload)) evalNode(root, env.payload, `/bundle/${member}/payload`, top);
    }
  } catch (e) {
    if (e !== STOP) throw e;
  }
  return { valid: !invalid, errors, truncated };
}

/** The diagnostics as an SDK would word them: at most `cap` lines, then the truncation marker. */
export function diagnostics(result) {
  const lines = result.errors.map((e) => `schema: ${e.instance || '/'} ${e.keyword}${e.member !== undefined ? ` ${e.member}` : ''}`);
  if (result.truncated) lines.push('schema: further errors not listed');
  return lines;
}
