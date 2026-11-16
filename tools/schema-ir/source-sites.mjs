// The assertion sites of the V2-2 closure read straight from the normative schema files, with no code from the IR
// compiler (tools/schema-ir/generate.mjs): a separate walk that follows $ref by file name, so a compiler regression that
// drops an assertion drops it from the IR but not from this list. checkIR() then requires every source site to be in
// the IR, and checkCoverage() requires every one to have a case (or, for the structural keywords, a stated reason).
//
// Sites: "<file>#<pointer>/<keyword>" for type, enum, const, pattern, format, minLength, maxLength, minItems,
// uniqueItems, minimum, maximum, oneOf, additionalProperties, $ref, properties and items; "<file>#<pointer>/required/<name>"
// for each required name; "binding:<member>" for each SignedPayload.payload bound by member name (V2-2).
import fs from 'node:fs';
import path from 'node:path';

// Declared here on purpose, not imported from the compiler: spec/VERIFICATION.md V2-2.
export const SOURCE_ROOT = 'signed_bundle.schema.json';
export const SOURCE_BINDINGS = [
  ['responsible_principal_record', 'responsible_principal_record.schema.json'],
  ['agent_passport', 'agent_passport.schema.json'],
  ['intent', 'intent.schema.json'],
  ['policy_decision', 'policy_decision.schema.json'],
];
const LEAF = ['type', 'enum', 'const', 'pattern', 'format', 'minLength', 'maxLength', 'minItems', 'uniqueItems', 'minimum', 'maximum'];
const esc = (t) => t.replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * {sites: Map<site, {file, pointer, keyword, name?}>, objects: Map<"file#pointer", schema object>, files: [file]} for the
 * closure under `dir`.
 */
export function sourceSites(dir) {
  const sites = new Map();
  const objects = new Map();
  const files = [];
  const add = (file, pointer, keyword, name) => sites.set(`${file}#${pointer}/${keyword}${name !== undefined ? `/${esc(name)}` : ''}`, { file, pointer, keyword, ...(name !== undefined ? { name } : {}) });
  const visitFile = (file) => {
    if (files.includes(file)) return;
    files.push(file);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const walk = (s, ptr) => {
      objects.set(`${file}#${ptr}`, s);
      for (const k of LEAF) if (k in s) add(file, ptr, k);
      if (s.additionalProperties === false) add(file, ptr, 'additionalProperties');
      for (const r of s.required ?? []) add(file, ptr, 'required', r);
      if (s.properties) { add(file, ptr, 'properties'); for (const [p, sub] of Object.entries(s.properties)) walk(sub, `${ptr}/properties/${esc(p)}`); }
      if (s.items) { add(file, ptr, 'items'); walk(s.items, `${ptr}/items`); }
      if (s.oneOf) { add(file, ptr, 'oneOf'); s.oneOf.forEach((b, i) => walk(b, `${ptr}/oneOf/${i}`)); }
      if (typeof s.$ref === 'string') { add(file, ptr, '$ref'); visitFile(s.$ref); }
    };
    walk(doc, '');
  };
  visitFile(SOURCE_ROOT);
  for (const [member, file] of SOURCE_BINDINGS) { sites.set(`binding:${member}`, { file, pointer: '', keyword: 'binding', name: member }); visitFile(file); }
  return { sites, objects, files: [...files].sort() };
}

const IR_KEY = { type: 'types', additionalProperties: 'closed', $ref: 'ref' };
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sortedCopy = (xs) => [...xs].sort();

/**
 * What the IR node of a source schema object must hold, read from the source alone: the assertion values (types in
 * source order, enum, const, format, bounds, flags, the required set) and the links (children by site, the $ref target
 * by file root, the pattern by its source text). Annotations ($schema, $id, title, description) have no IR form.
 */
function expectedNode(file, ptr, s, rel) {
  const at = `${rel}${file}#${ptr}`;
  const e = {};
  if ('type' in s) e.types = Array.isArray(s.type) ? s.type : [s.type];
  for (const k of ['enum', 'const', 'format', 'minLength', 'maxLength', 'minItems', 'minimum', 'maximum']) if (k in s) e[k] = s[k];
  if (s.uniqueItems === true) e.uniqueItems = true;
  if (s.additionalProperties === false) e.closed = true;
  if (s.required) e.required = sortedCopy(s.required);
  if (s.properties) e.properties = sortedCopy(Object.keys(s.properties)).map((p) => [p, `${at}/properties/${esc(p)}`]);
  if (s.items) e.items = `${at}/items`;
  if (s.oneOf) e.oneOf = s.oneOf.map((_, i) => `${at}/oneOf/${i}`);
  if (typeof s.$ref === 'string') e.ref = `${rel}${s.$ref}#`;
  if ('pattern' in s) e.pattern = s.pattern;
  return e;
}

/** The IR node in the same shape: child ids replaced by their sites, the pattern index by its source text. */
function actualNode(ir, n) {
  const site = (id) => ir.nodes[id]?.site ?? `<no node ${id}>`;
  const a = {};
  for (const k of ['types', 'enum', 'const', 'format', 'minLength', 'maxLength', 'minItems', 'minimum', 'maximum', 'uniqueItems', 'closed']) if (n[k] !== undefined) a[k] = n[k];
  if (n.required !== undefined) a.required = sortedCopy(n.required);
  if (n.properties !== undefined) a.properties = [...n.properties].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).map(([p, id]) => [p, site(id)]);
  if (n.items !== undefined) a.items = site(n.items);
  if (n.oneOf !== undefined) a.oneOf = n.oneOf.map(site);
  if (n.ref !== undefined) a.ref = site(n.ref);
  if (n.pattern !== undefined) a.pattern = ir.patterns[n.pattern]?.source ?? `<no pattern ${n.pattern}>`;
  const KNOWN = ['site', 'types', 'enum', 'const', 'format', 'minLength', 'maxLength', 'minItems', 'minimum', 'maximum', 'uniqueItems', 'closed', 'required', 'properties', 'items', 'oneOf', 'ref', 'pattern'];
  for (const k of Object.keys(n)) if (!KNOWN.includes(k)) a[`unexpected:${k}`] = n[k];
  return a;
}

/**
 * The IR against the source: every source site present, every IR node equal to what its source object says (values
 * and links), no IR node without a source object, the four bindings and the one overlay where they belong. Each stored
 * pattern program must equal `compile(source)`: that ties the program to its source text; whether the compiler is right
 * is a different test (the programs against ECMAScript RegExp).
 */
export function checkIR(ir, { sites, objects }, { rel = 'schemas/v2/', compile } = {}) {
  const bySite = new Map(ir.nodes.map((n) => [n.site, n]));
  const problems = [];
  for (const [key, s] of sites) {
    if (s.keyword === 'binding') {
      const b = ir.roots.payloads.find(([m]) => m === s.name);
      if (!b || ir.nodes[b[1]]?.site !== `${rel}${s.file}#`) problems.push(`${key}: binding missing from the IR or bound to another root`);
      continue;
    }
    const n = bySite.get(`${rel}${s.file}#${s.pointer}`);
    const k = IR_KEY[s.keyword] ?? s.keyword;
    if (!n) problems.push(`${key}: no IR node`);
    else if (s.keyword === 'required' ? !(n.required ?? []).includes(s.name) : n[k] === undefined) problems.push(`${key}: assertion missing from the IR`);
  }
  if (objects) {
    for (const [where, s] of objects) {
      const [file, ptr] = where.split('#');
      const n = bySite.get(`${rel}${file}#${ptr}`);
      if (!n) { problems.push(`${where}: no IR node`); continue; }
      const want = expectedNode(file, ptr, s, rel);
      const got = actualNode(ir, n);
      for (const k of new Set([...Object.keys(want), ...Object.keys(got)])) if (!sameJSON(want[k], got[k])) problems.push(`${where}: ${k} is ${JSON.stringify(got[k])?.slice(0, 120)} in the IR, ${JSON.stringify(want[k])?.slice(0, 120)} in the source`);
    }
    const sourceSitesSet = new Set([...objects.keys()].map((w) => `${rel}${w}`));
    for (const n of ir.nodes) if (!sourceSitesSet.has(n.site)) problems.push(`${n.site}: IR node without a source schema object`);
    if (new Set(ir.nodes.map((n) => n.site)).size !== ir.nodes.length) problems.push('two IR nodes share a site');
  }
  if (ir.nodes[ir.roots.signed_bundle]?.site !== `${rel}${SOURCE_ROOT}#`) problems.push(`the IR envelope root is not ${SOURCE_ROOT}`);
  if (!sameJSON(ir.roots.payloads.map(([m, id]) => [m, ir.nodes[id]?.site]), SOURCE_BINDINGS.map(([m, f]) => [m, `${rel}${f}#`]))) problems.push('the IR payload bindings differ from the source bindings');
  if (compile) for (const [i, p] of ir.patterns.entries()) if (!sameJSON(p, compile(p.source))) problems.push(`pattern ${i} (${p.source}): the stored program is not the compilation of its source`);
  const ov = ir.overlays?.['dcp-jcs-v2'];
  const target = `${rel}bundle_manifest.schema.json#/properties/canonicalization_profile`;
  if (!Array.isArray(ov) || ov.length !== 1 || ir.nodes[ov[0].node]?.site !== target || ov[0].keyword !== 'const' || ov[0].value !== 'dcp-jcs-v2' || objects?.get('bundle_manifest.schema.json#/properties/canonicalization_profile')?.const !== 'dcp-jcs-v1') {
    problems.push('the dcp-jcs-v2 overlay is not exactly one const on canonicalization_profile over the source dcp-jcs-v1');
  }
  if (Object.keys(ir.overlays ?? {}).some((k) => k !== 'dcp-jcs-v2')) problems.push('the IR has an overlay other than dcp-jcs-v2');
  return problems;
}

/** Every source assertion site covered by a case of coverage.json (structural keywords: a stated reason). */
export function checkCoverage(coverage, { sites }, schemaCases, rel = 'schemas/v2/') {
  const ids = new Set(schemaCases.map((c) => c.id));
  const problems = [];
  for (const [key, s] of sites) {
    if (s.keyword === 'binding') {
      const at = `/bundle/${s.name}/payload`;
      if (!schemaCases.some((c) => c.kind === 'negative' && c.attribution?.instance === at && c.attribution.keyword === 'additionalProperties')) problems.push(`${key}: no negative case at ${at}`);
      continue;
    }
    const covKey = `${rel}${s.file}#${s.pointer}/${s.keyword}${s.name !== undefined ? `/${esc(s.name)}` : ''}`;
    const v = coverage.sites[covKey];
    if (['properties', 'items', '$ref'].includes(s.keyword)) { if (typeof v !== 'string' || v === '') problems.push(`${key}: structural site without a stated reason`); continue; }
    if (!Array.isArray(v) || v.length === 0) problems.push(`${key}: no case covers it`);
    else for (const id of v) if (!ids.has(id)) problems.push(`${key}: covered by unknown case ${id}`);
  }
  return problems;
}
