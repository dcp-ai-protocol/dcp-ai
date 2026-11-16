#!/usr/bin/env node
// Phase 1 of the SDK schema-validation work (a generated IR evaluated by four small SDK interpreters): compiles
// the V2-2 closure of schemas/v2 (signed_bundle.schema.json, the four artifact schemas bound to the SignedPayload
// payloads by member name, and everything they reference) into one intermediate representation (IR), and renders it
// as candidate SDK source artifacts in tools/schema-ir/staging/ (never into the SDK directories in this phase).
//
// The gate is closed: the generation fails, listing every problem, on an unknown keyword, an unsupported value or
// combination, an unresolved or fragment reference, a duplicate $id, a reference cycle or a boolean schema. Property
// names are data (a property called "type" is a property). $ref siblings are kept. The IR records the sha256 of each
// source file, is serialized canonically (sorted keys, no white space) and is reproducible byte for byte.
//
//   node tools/schema-ir/generate.mjs            write tools/schema-ir/staging/
//   node tools/schema-ir/generate.mjs --check    regenerate in memory; exit 1 if any staged byte differs
//   node tools/schema-ir/generate.mjs --out DIR  write to DIR instead (reproducibility checks)
//   node tools/schema-ir/generate.mjs --sdk typescript|python|go|rust   also write the artifact into that SDK (SDK_TARGETS)
// --check compares the staging files and every SDK copy listed in SDK_TARGETS.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePattern, PatternError } from './patterns.mjs';
import { FORMAT_ID } from './date-time.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const STAGING = path.join(HERE, 'staging');
export const IR_FORMAT = 'dcp-ai.v2-schema-ir/1';
export const DIALECT = 'https://json-schema.org/draft/2020-12/schema';
export const ROOT_FILE = 'signed_bundle.schema.json';
// spec/VERIFICATION.md V2-2: each SignedPayload.payload against its artifact schema, by bundle member name.
export const PAYLOADS = [
  ['responsible_principal_record', 'responsible_principal_record.schema.json'],
  ['agent_passport', 'agent_passport.schema.json'],
  ['intent', 'intent.schema.json'],
  ['policy_decision', 'policy_decision.schema.json'],
];
// The experimental candidate (decision D4): one node, reachable only when dcp-jcs-v2 was explicitly selected.
export const OVERLAY = { name: 'dcp-jcs-v2', file: 'bundle_manifest.schema.json', pointer: '/properties/canonicalization_profile', keyword: 'const', from: 'dcp-jcs-v1', to: 'dcp-jcs-v2' };

const TYPES = new Set(['object', 'array', 'string', 'integer', 'boolean', 'null']);
const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description']);
const ASSERTIONS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', '$ref', 'oneOf', 'enum', 'const', 'pattern', 'format', 'minLength', 'maxLength', 'minItems', 'uniqueItems', 'minimum', 'maximum']);
// Keywords that only apply to one JSON type: a node using them must declare that type.
const FAMILY = { properties: 'object', required: 'object', additionalProperties: 'object', items: 'array', minItems: 'array', uniqueItems: 'array', pattern: 'string', format: 'string', minLength: 'string', maxLength: 'string', minimum: 'integer', maximum: 'integer' };

export class GateError extends Error {
  constructor(problems) {
    super(`schema-ir gate refused the schemas (${problems.length} problem(s)):\n- ${problems.join('\n- ')}`);
    this.problems = problems;
  }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const escapeToken = (t) => t.replace(/~/g, '~0').replace(/\//g, '~1');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const cmpCodePoints = (a, b) => {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i].codePointAt(0) - y[i].codePointAt(0);
  return x.length - y.length;
};

/** Canonical JSON: keys sorted by code point at every depth, no white space; only strings, safe integers, booleans, null. */
export function canonical(v) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new Error(`IR number ${v} is not a safe integer`);
    return String(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isPlain(v)) return `{${Object.keys(v).sort(cmpCodePoints).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  throw new Error(`IR value of type ${typeof v}`);
}

/**
 * Compiles the closure. `files` maps a file name to its bytes (every file of the directory, so duplicate $id values are
 * found even outside the closure); `rel` prefixes the file names in sites and sources.
 */
export function buildIR({ files, rel = 'schemas/v2/', rootFile = ROOT_FILE, payloads = PAYLOADS, overlay = OVERLAY } = {}) {
  const problems = [];
  const docs = new Map();
  const byId = new Map();
  for (const [name, bytes] of [...files].sort((a, b) => cmpCodePoints(a[0], b[0]))) {
    let doc;
    try { doc = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch (e) { problems.push(`${rel}${name}: not JSON (${e.message})`); continue; }
    docs.set(name, { doc, sha: sha256(Buffer.from(bytes)) });
    const id = isPlain(doc) ? doc.$id : undefined;
    if (typeof id !== 'string') continue;
    if (byId.has(id)) problems.push(`${rel}${name}: duplicate $id ${id} (also ${rel}${byId.get(id)})`);
    else byId.set(id, name);
  }
  const nodes = [];
  const nodeOf = new Map(); // site -> id
  const patterns = [];
  const patternOf = new Map();
  const used = new Map(); // file -> sha
  const inventory = {}; // keyword -> [site#/.../keyword]
  const onStack = new Set();
  const note = (kw, site, ptr) => (inventory[kw] ??= []).push(`${site}#${ptr}/${escapeToken(kw)}`);

  function resolveRef(ref, fromName, site) {
    if (typeof ref !== 'string' || ref.includes('#')) { problems.push(`${site}: $ref ${JSON.stringify(ref)} is not a reference to a whole schema file`); return null; }
    const baseId = docs.get(fromName)?.doc?.$id;
    let target;
    try { target = new URL(ref, baseId).href; } catch { problems.push(`${site}: $ref ${JSON.stringify(ref)} does not resolve against ${baseId}`); return null; }
    const name = byId.get(target);
    if (name === undefined) { problems.push(`${site}: unresolved $ref ${JSON.stringify(ref)} (${target})`); return null; }
    return name;
  }

  function compileFile(name) {
    const site = `${rel}${name}#`;
    if (onStack.has(name)) { problems.push(`${rel}${name}: reference cycle (not supported by the interpreters)`); return null; }
    if (nodeOf.has(site)) return nodeOf.get(site);
    const entry = docs.get(name);
    if (!entry) { problems.push(`${rel}${name}: missing`); return null; }
    used.set(name, entry.sha);
    onStack.add(name);
    const id = compile(name, entry.doc, '');
    onStack.delete(name);
    return id;
  }

  function compile(name, s, ptr) {
    const site = `${rel}${name}#${ptr}`;
    if (typeof s === 'boolean') { problems.push(`${site}: boolean schema (unsupported)`); return null; }
    if (!isPlain(s)) { problems.push(`${site}: a schema must be an object`); return null; }
    const id = nodes.length;
    const node = { site };
    nodes.push(node);
    nodeOf.set(site, id);
    for (const k of Object.keys(s)) {
      if (!ANNOTATIONS.has(k) && !ASSERTIONS.has(k)) problems.push(`${site}: unsupported keyword ${JSON.stringify(k)}`);
      else note(k, `${rel}${name}`, ptr);
    }
    if ('$schema' in s && (ptr !== '' || s.$schema !== DIALECT)) problems.push(`${site}: $schema must be ${DIALECT}, at the file root only`);
    if (ptr === '' && s.$schema !== DIALECT) problems.push(`${site}: the file root must declare $schema ${DIALECT}`);
    if ('$id' in s && ptr !== '') problems.push(`${site}: $id below the file root (unsupported)`);
    for (const k of ['title', 'description']) if (k in s && typeof s[k] !== 'string') problems.push(`${site}: ${k} must be a string`);
    let types = null;
    if ('type' in s) {
      const t = Array.isArray(s.type) ? s.type : [s.type];
      if (t.length === 0 || t.some((x) => !TYPES.has(x)) || new Set(t).size !== t.length) problems.push(`${site}: type ${JSON.stringify(s.type)} (supported: ${[...TYPES].join(', ')}, distinct)`);
      else node.types = types = t;
    }
    for (const [kw, fam] of Object.entries(FAMILY)) {
      if (kw in s && !(types && types.includes(fam))) problems.push(`${site}: ${kw} without type ${fam} (unsupported combination)`);
    }
    if ('properties' in s) {
      if (!isPlain(s.properties)) problems.push(`${site}: properties must be an object`);
      else {
        node.properties = Object.keys(s.properties).sort(cmpCodePoints).map((p) => [p, compile(name, s.properties[p], `${ptr}/properties/${escapeToken(p)}`)]);
      }
    }
    if ('required' in s) {
      const r = s.required;
      if (!Array.isArray(r) || r.some((x) => typeof x !== 'string') || new Set(r).size !== r.length) problems.push(`${site}: required must be distinct strings`);
      else node.required = [...r].sort(cmpCodePoints);
    }
    if ('additionalProperties' in s) {
      if (s.additionalProperties !== false) problems.push(`${site}: additionalProperties other than false (unsupported)`);
      else node.closed = true;
    }
    if ('items' in s) {
      if (!isPlain(s.items)) problems.push(`${site}: items must be one schema object (unsupported form)`);
      else node.items = compile(name, s.items, `${ptr}/items`);
    }
    if ('oneOf' in s) {
      if (!Array.isArray(s.oneOf) || s.oneOf.length < 2) problems.push(`${site}: oneOf needs at least two schemas`);
      else node.oneOf = s.oneOf.map((b, i) => compile(name, b, `${ptr}/oneOf/${i}`));
    }
    for (const kw of ['enum', 'const']) {
      if (!(kw in s)) continue;
      const vals = kw === 'enum' ? s.enum : [s.const];
      if (!Array.isArray(vals) || vals.length === 0 || vals.some((x) => typeof x !== 'string') || new Set(vals).size !== vals.length) problems.push(`${site}: ${kw} must hold distinct strings (other values unsupported)`);
      else if (types && !types.includes('string')) problems.push(`${site}: string ${kw} on a node without type string`);
      else node[kw] = kw === 'enum' ? [...vals] : s.const;
    }
    if ('pattern' in s) {
      try {
        if (!patternOf.has(s.pattern)) { patternOf.set(s.pattern, patterns.length); patterns.push(compilePattern(s.pattern)); }
        node.pattern = patternOf.get(s.pattern);
      } catch (e) {
        if (!(e instanceof PatternError)) throw e;
        problems.push(`${site}: pattern ${e.message}`);
      }
    }
    if ('format' in s) {
      if (s.format !== 'date-time') problems.push(`${site}: format ${JSON.stringify(s.format)} (only date-time is supported)`);
      else node.format = 'date-time';
    }
    for (const kw of ['minLength', 'maxLength', 'minItems', 'minimum', 'maximum']) {
      if (!(kw in s)) continue;
      const v = s[kw];
      if (!Number.isSafeInteger(v) || (kw.startsWith('min') && kw !== 'minimum' && v < 0) || (kw === 'maxLength' && v < 0)) problems.push(`${site}: ${kw} must be a ${kw.endsWith('imum') ? 'safe integer' : 'non-negative integer'}`);
      else node[kw] = v;
    }
    if ('uniqueItems' in s) {
      const itemTypes = isPlain(s.items) ? s.items.type : undefined;
      if (s.uniqueItems !== true) problems.push(`${site}: uniqueItems other than true (unsupported)`);
      else if (itemTypes !== 'string') problems.push(`${site}: uniqueItems over items that are not exactly type string (unsupported: the interpreters compare strings with a set)`);
      else node.uniqueItems = true;
    }
    if ('$ref' in s) {
      const target = resolveRef(s.$ref, name, site);
      if (target !== null) node.ref = compileFile(target);
    }
    return id;
  }

  const rootId = compileFile(rootFile);
  const payloadRoots = payloads.map(([member, file]) => [member, compileFile(file)]);
  const ov = overlay && nodes.find((n) => n.site === `${rel}${overlay.file}#${overlay.pointer}`);
  if (overlay && (!ov || ov[overlay.keyword] !== overlay.from)) problems.push(`overlay ${overlay.name}: ${rel}${overlay.file}#${overlay.pointer} does not hold ${overlay.keyword} ${JSON.stringify(overlay.from)}`);
  if (problems.length) throw new GateError(problems);
  const ir = {
    format: IR_FORMAT,
    dialect: DIALECT,
    generator: 'tools/schema-ir/generate.mjs',
    sources: [...used].sort((a, b) => cmpCodePoints(a[0], b[0])).map(([name, sha]) => ({ file: `${rel}${name}`, id: docs.get(name).doc.$id, sha256: sha })),
    formats: { 'date-time': FORMAT_ID },
    patterns,
    nodes,
    roots: { signed_bundle: rootId, payloads: payloadRoots },
    overlays: overlay ? { [overlay.name]: [{ node: nodes.indexOf(ov), keyword: overlay.keyword, value: overlay.to, site: `${ov.site}/${overlay.keyword}` }] } : {},
  };
  return { ir, text: canonical(ir), inventory };
}

/** Every file of schemas/v2, by name. */
export function readSchemaDir(dir = path.join(ROOT, 'schemas', 'v2')) {
  return new Map(fs.readdirSync(dir).filter((f) => f.endsWith('.schema.json')).map((f) => [f, fs.readFileSync(path.join(dir, f))]));
}

// ── Candidate SDK artifacts: the IR text as one string constant per language ──
// The IR is printable ASCII (checked), so escaping \ and " gives a valid literal in all four languages.
function literal(text) {
  if (!/^[\x20-\x7e]*$/.test(text)) throw new Error('the IR text is not printable ASCII');
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
function header(prefix, ir, irSha) {
  return [
    'GENERATED by tools/schema-ir/generate.mjs. DO NOT EDIT: change schemas/v2 and regenerate.',
    `IR ${ir.format}, sha256 ${irSha}.`,
    'Sources (file, sha256):',
    ...ir.sources.map((s) => `  ${s.file} ${s.sha256}`),
  ].map((l) => `${prefix}${l}`.trimEnd()).join('\n');
}
// Where each SDK keeps its copy of the artifact, once that SDK's phase has started (phase 2: TypeScript; 3: Python; 4: Go).
export const SDK_TARGETS = {
  typescript: ['typescript/schema-v2.generated.ts', 'sdks/typescript/src/core/schema-v2.generated.ts'],
  python: ['python/_schema_v2_generated.py', 'sdks/python/dcp_ai/v2/_schema_v2_generated.py'],
  go: ['go/schema_v2_generated.go', 'sdks/go/dcp/v2/schema_v2_generated.go'],
  rust: ['rust/schema_v2_generated.rs', 'sdks/rust/src/v2/schema_v2_generated.rs'],
};

export function renderArtifacts({ ir, text }) {
  const irSha = sha256(Buffer.from(text, 'utf8'));
  const lit = literal(text);
  return {
    'ir.json': `${text}\n`,
    'typescript/schema-v2.generated.ts': `${header('// ', ir, irSha)}\n\nexport const SCHEMA_V2_IR_SHA256 = '${irSha}';\nexport const SCHEMA_V2_IR = ${lit};\n`,
    'python/_schema_v2_generated.py': `${header('# ', ir, irSha)}\n\nSCHEMA_V2_IR_SHA256 = "${irSha}"\nSCHEMA_V2_IR = ${lit}\n`,
    'go/schema_v2_generated.go': `${header('// ', ir, irSha)}\n\npackage v2\n\nconst schemaV2IRSHA256 = "${irSha}"\n\nconst schemaV2IR = ${lit}\n`,
    'rust/schema_v2_generated.rs': `${header('// ', ir, irSha)}\n\npub(crate) const SCHEMA_V2_IR_SHA256: &str = "${irSha}";\npub(crate) const SCHEMA_V2_IR: &str = ${lit};\n`,
  };
}

function main(argv) {
  const check = argv.includes('--check');
  const outAt = argv.indexOf('--out');
  const out = outAt >= 0 ? path.resolve(argv[outAt + 1]) : STAGING;
  const built = buildIR({ files: readSchemaDir() });
  const artifacts = renderArtifacts(built);
  const sdkCopies = Object.values(SDK_TARGETS).map(([art, dest]) => [path.join(ROOT, dest), artifacts[art]]);
  if (check) {
    const differ = [...Object.entries(artifacts).map(([f, body]) => [path.join(out, f), body]), ...sdkCopies].filter(([file, body]) => { try { return fs.readFileSync(file, 'utf8') !== body; } catch { return true; } });
    if (differ.length) { console.error(`schema-ir: these files differ from a fresh generation: ${differ.map(([file]) => path.relative(ROOT, file)).join(', ')}`); return 1; }
    console.log(`schema-ir: staging and SDK copies match (${Object.keys(artifacts).length + sdkCopies.length} files, IR sha256 ${sha256(Buffer.from(built.text, 'utf8'))})`);
    return 0;
  }
  const sdkAt = argv.indexOf('--sdk');
  if (sdkAt >= 0) {
    const target = SDK_TARGETS[argv[sdkAt + 1]];
    if (!target) throw new Error(`--sdk: one of ${Object.keys(SDK_TARGETS).join(', ')}`);
    fs.writeFileSync(path.join(ROOT, target[1]), artifacts[target[0]]);
  }
  for (const [f, body] of Object.entries(artifacts)) {
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.writeFileSync(path.join(out, f), body);
  }
  console.log(`schema-ir: wrote ${Object.keys(artifacts).length} files to ${path.relative(ROOT, out) || out} (${built.ir.nodes.length} nodes, ${built.ir.sources.length} sources, IR sha256 ${sha256(Buffer.from(built.text, 'utf8'))})`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(e instanceof GateError ? e.message : e.stack); process.exitCode = 2; }
}
