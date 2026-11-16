// Self-tests of phase 1 of the SDK schema-validation work: the IR generator and its gate, the pattern programs, the
// date-time port, the reference evaluator, the two oracles and their harness, the shared corpus and its coverage, and
// the opt-in catalog. No SDK verifier runs here (the BEFORE sample goes through tools/schema-ir/before.mjs).
//   SCHEMA_IR_PYTHON=<python3 with jsonschema and referencing> node --test tools/schema-ir/schema-ir.test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ajvFormats from 'ajv-formats/dist/formats.js';
import { validateV2Bundle } from '../../lib/verify.js';
import { structure } from '../conformance/structural-checks.js';
import { GateError, PAYLOADS, ROOT, STAGING, buildIR, readSchemaDir, renderArtifacts } from './generate.mjs';
import { compilePattern, matchProgram, PatternError } from './patterns.mjs';
import { SEPARATORS, isDateTime } from './date-time.mjs';
import { ERRORS_CAP, TOKEN_CAP, diagnostics, validateSchemaIR } from './evaluate.mjs';
import { AJV_PAYLOADS, ajvValidate } from './oracle-ajv.mjs';
import { pythonValidate } from './oracle-python.mjs';
import { checkCoverage, checkIR, SOURCE_BINDINGS, sourceSites } from './source-sites.mjs';
import { CATALOG_FILE, loadSchemaValidationPlan, readCorpus, schemaCaseText, wiringText } from './corpus.mjs';

const upstream = ajvFormats.fullFormats['date-time'].validate;
const built = buildIR({ files: readSchemaDir() });
const { ir } = built;
const S = readCorpus('schema_cases.json').doc;
const W = readCorpus('wiring_cases.json').doc;
const C = readCorpus('coverage.json').doc;
const D = readCorpus('date_time_cases.json').doc;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const attributed = (errors, a) => errors.some((e) => e.instance === a.instance && e.keyword === a.keyword);
const deepFreeze = (v) => { if (v && typeof v === 'object') { Object.values(v).forEach(deepFreeze); Object.freeze(v); } return v; };

// ── Generator, gate, reproducibility ──
test('the IR is reproducible byte for byte and the staged candidate artifacts are current', () => {
  assert.equal(buildIR({ files: readSchemaDir() }).text, built.text);
  const arts = renderArtifacts(built);
  for (const [f, body] of Object.entries(arts)) assert.equal(fs.readFileSync(path.join(STAGING, f), 'utf8'), body, f);
  const irSha = sha(Buffer.from(built.text, 'utf8'));
  for (const f of Object.keys(arts).filter((x) => x !== 'ir.json')) {
    const body = arts[f];
    assert.ok(body.includes(irSha), `${f}: carries the IR sha256`);
    const lit = /SCHEMA_V2_IR(?:: &str)? = ("(?:[^"\\]|\\.)*")/.exec(body) ?? /schemaV2IR = ("(?:[^"\\]|\\.)*")/.exec(body);
    assert.equal(JSON.parse(lit[1]), built.text, `${f}: the literal is the IR text`);
  }
});

test('the IR names exactly the 11 normative files of the closure, with their sha256', () => {
  const src = sourceSites(path.join(ROOT, 'schemas', 'v2'));
  assert.equal(ir.sources.length, 11);
  assert.deepEqual(ir.sources.map((s) => s.file.replace('schemas/v2/', '')).sort(), src.files);
  for (const s of ir.sources) assert.equal(s.sha256, sha(fs.readFileSync(path.join(ROOT, s.file))), s.file);
});

test('every assertion of the normative files, read without the compiler, is in the IR and covered by a case', () => {
  const src = sourceSites(path.join(ROOT, 'schemas', 'v2'));
  const kinds = {};
  for (const s of src.sites.values()) kinds[s.keyword] = (kinds[s.keyword] ?? 0) + 1;
  assert.equal(kinds.required, 106);
  assert.equal(kinds.binding, 4);
  assert.equal(kinds.$ref, 12);
  assert.deepEqual(checkIR(ir, src, { compile: compilePattern }), []);
  assert.deepEqual(checkCoverage(C, src, S.cases), []);
  assert.deepEqual(AJV_PAYLOADS, PAYLOADS, 'oracle 1 declares the same payload bindings as the compiler');
  assert.deepEqual(SOURCE_BINDINGS, PAYLOADS, 'the source walk declares the same payload bindings as the compiler');
});

test('mutation control: an IR that lost one assertion, one required name or one binding fails the source check', () => {
  const src = sourceSites(path.join(ROOT, 'schemas', 'v2'));
  const drop = (f) => { const x = structuredClone(ir); f(x); return checkIR(x, src); };
  const withPattern = ir.nodes.findIndex((n) => n.pattern !== undefined);
  assert.ok(drop((x) => { delete x.nodes[withPattern].pattern; }).some((p) => p.includes('/pattern: assertion missing')));
  const withRequired = ir.nodes.findIndex((n) => n.required?.length > 1);
  assert.ok(drop((x) => { x.nodes[withRequired].required.pop(); }).some((p) => p.includes('/required/')));
  const closed = ir.nodes.findIndex((n) => n.closed);
  assert.ok(drop((x) => { delete x.nodes[closed].closed; }).some((p) => p.includes('/additionalProperties: assertion missing')));
  assert.ok(drop((x) => { x.roots.payloads.pop(); }).some((p) => p.startsWith('binding:')));
  // And a coverage that lost the cases of one site fails too.
  const key = Object.keys(C.sites).find((k) => Array.isArray(C.sites[k]));
  const cov = structuredClone(C);
  cov.sites[key] = [];
  assert.ok(checkCoverage(cov, src, S.cases).some((p) => p.includes('no case covers it')));
});

test('mutation control: an IR whose values or links differ from the source fails the source check', () => {
  const src = sourceSites(path.join(ROOT, 'schemas', 'v2'));
  const at = (site) => ir.nodes.findIndex((n) => n.site === `schemas/v2/${site}`);
  const fails = (name, f) => { const x = structuredClone(ir); f(x); assert.ok(checkIR(x, src, { compile: compilePattern }).length > 0, name); };
  const twoProps = ir.nodes.findIndex((n) => n.properties?.length > 1);
  const withOneOf = ir.nodes.findIndex((n) => n.oneOf);
  const withItems = ir.nodes.findIndex((n) => n.items !== undefined);
  const withPattern = ir.nodes.findIndex((n) => n.pattern !== undefined);
  for (const [name, f] of [
    ['closed false', (x) => { x.nodes.find((n) => n.closed).closed = false; }],
    ['closed added', (x) => { x.nodes[at('intent.schema.json#/properties/target')].closed = true; }],
    ['const changed', (x) => { x.nodes.find((n) => n.const !== undefined).const = 'unexpected'; }],
    ['enum member changed', (x) => { x.nodes.find((n) => n.enum).enum[0] = 'zz'; }],
    ['enum member added', (x) => { x.nodes.find((n) => n.enum).enum.push('zz'); }],
    ['types changed', (x) => { x.nodes.find((n) => n.types?.[0] === 'string').types = ['string', 'null']; }],
    ['format changed', (x) => { x.nodes.find((n) => n.format).format = 'date'; }],
    ['minLength changed', (x) => { x.nodes.find((n) => n.minLength !== undefined).minLength += 1; }],
    ['maxLength changed', (x) => { x.nodes.find((n) => n.maxLength !== undefined).maxLength -= 1; }],
    ['minItems changed', (x) => { x.nodes.find((n) => n.minItems !== undefined).minItems = 0; }],
    ['minimum changed', (x) => { x.nodes.find((n) => n.minimum !== undefined).minimum = -1; }],
    ['maximum changed', (x) => { x.nodes.find((n) => n.maximum !== undefined).maximum = 999; }],
    ['uniqueItems false', (x) => { x.nodes.find((n) => n.uniqueItems).uniqueItems = false; }],
    ['required name added', (x) => { x.nodes.find((n) => n.required).required.push('x_extra'); }],
    ['ref to the wrong root', (x) => { x.nodes.find((n) => n.ref !== undefined).ref = x.roots.signed_bundle; }],
    ['property targets swapped', (x) => { const p = x.nodes[twoProps].properties; [p[0][1], p[1][1]] = [p[1][1], p[0][1]]; }],
    ['property renamed', (x) => { x.nodes[twoProps].properties[0][0] = 'x_renamed'; }],
    ['items to another node', (x) => { x.nodes[withItems].items = x.roots.signed_bundle; }],
    ['oneOf branches swapped', (x) => { x.nodes[withOneOf].oneOf.reverse(); }],
    ['pattern index changed', (x) => { x.nodes[withPattern].pattern = (x.nodes[withPattern].pattern + 1) % x.patterns.length; }],
    ['pattern program changed', (x) => { x.patterns[0].alternatives[0][0].min += 1; }],
    ['unexpected key', (x) => { x.nodes[0].maxProperties = 3; }],
    ['extra node', (x) => { x.nodes.push({ site: 'schemas/v2/signed_bundle.schema.json#/x' }); }],
    ['binding to the wrong root', (x) => { x.roots.payloads[0][1] = x.roots.payloads[1][1]; }],
    ['bindings reordered', (x) => { x.roots.payloads.reverse(); }],
    ['envelope root changed', (x) => { x.roots.signed_bundle = x.roots.payloads[0][1]; }],
    ['overlay value changed', (x) => { x.overlays['dcp-jcs-v2'][0].value = 'dcp-jcs-v3'; }],
    ['overlay on another node', (x) => { x.overlays['dcp-jcs-v2'][0].node = 0; }],
    ['second overlay', (x) => { x.overlays.other = []; }],
  ]) fails(name, f);
});

test('the plan loader refuses duplicate identities, malformed expectations and a missing or negative base', () => {
  const catBytes = fs.readFileSync(CATALOG_FILE);
  const wiringFile = readCorpus('wiring_cases.json');
  const load = (fc, fw) => {
    const cat = JSON.parse(catBytes.toString('utf8'));
    const doc = structuredClone(wiringFile.doc);
    fc?.(cat);
    fw?.(doc);
    return loadSchemaValidationPlan({ catalogBytes: Buffer.from(JSON.stringify(cat)), wiring: { ...wiringFile, doc } });
  };
  assert.equal(load().suites[0].cases.length, W.cases.length, 'baseline copy accepted');
  for (const [name, fc, fw, re] of [
    ['duplicate wiring name', null, (w) => { w.cases.push(structuredClone(w.cases[1])); }, /duplicate case name/],
    ['duplicate catalog id', (c) => { c.suites[0].expected_cases.push(c.suites[0].expected_cases[0]); }, null, /duplicate expected case id/],
    ['duplicate suite', (c) => { c.suites.push(structuredClone(c.suites[0])); }, null, /exactly one suite/],
    ['unknown suite', (c) => { c.suites[0].id = 'external.v2.other'; }, null, /suite must be/],
    ['wrong contract', (c) => { c.contract = 'dcp-ai-conformance-external/1'; }, null, /contract/],
    ['unknown catalog member', (c) => { c.extra = 1; }, null, /contract/],
    ['empty expected_cases', (c) => { c.suites[0].expected_cases = []; }, null, /expected_cases/],
    ['verified as a string', null, (w) => { w.cases[1].expect.verified = 'false'; }, /must be booleans/],
    ['verified missing', null, (w) => { delete w.cases[1].expect.verified; }, /must be booleans/],
    ['schema verdict missing', null, (w) => { delete w.cases[1].expect.schema; }, /must be booleans/],
    ['base missing', null, (w) => { w.cases = w.cases.filter((c) => c.name !== 'base'); }, /control "base"/],
    ['base negative', null, (w) => { w.cases[0].expect.verified = false; }, /control "base"/],
    ['bundle and text both', null, (w) => { w.cases[0].signed_bundle_text = '{}'; }, /exactly one of/],
    ['bad spec_step', null, (w) => { w.cases[1].spec_step = 'V2-15'; }, /spec_step/],
    ['bad name', null, (w) => { w.cases[1].name = 'Bad Name'; }, /name of/],
    ['bad verification_time', null, (w) => { w.verification_time = 'n/a'; }, /verification_time/],
  ]) assert.throws(() => load(fc, fw), re, name);
});

function synthetic(extra = {}, root = {}) {
  const id = (n) => `https://dcp-ai.org/schemas/v2/${n}`;
  const file = (n, body) => [n, Buffer.from(JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: id(n), ...body }))];
  return new Map([file('signed_bundle.schema.json', { type: 'object', properties: { a: { type: 'string' } }, ...root }), ...Object.entries(extra).map(([n, b]) => file(n, b))]);
}
const gate = (files) => { try { buildIR({ files, payloads: [], overlay: null }); return []; } catch (e) { if (!(e instanceof GateError)) throw e; return e.problems; } };

test('the gate refuses unsupported keywords, values, combinations, references, duplicate ids, cycles and boolean schemas', () => {
  const refused = (files, re) => { const p = gate(files); assert.ok(p.some((x) => re.test(x)), `${re}: ${JSON.stringify(p)}`); };
  refused(synthetic({}, { $defs: { x: { type: 'string' } } }), /unsupported keyword "\$defs"/);
  refused(synthetic({}, { patternProperties: { '^x': { type: 'string' } } }), /unsupported keyword "patternProperties"/);
  refused(synthetic({}, { if: { type: 'object' } }), /unsupported keyword "if"/);
  refused(synthetic({}, { additionalProperties: { type: 'string' } }), /additionalProperties other than false/);
  refused(synthetic({}, { properties: { a: { type: 'number' } } }), /type "number"/);
  refused(synthetic({}, { properties: { a: { type: 'string', format: 'email' } } }), /only date-time/);
  refused(synthetic({}, { properties: { a: { type: 'string', pattern: '^a|b$' } } }), /outside one enclosing group/);
  refused(synthetic({}, { properties: { a: { type: 'string', pattern: '^\\d{2}$' } } }), /unsupported character/);
  refused(synthetic({}, { properties: { a: { type: 'string', pattern: '^[0-9]+[0-9]$' } } }), /overlaps a later item/);
  refused(synthetic({}, { properties: { a: { type: 'string', pattern: 'abc' } } }), /not anchored/);
  refused(synthetic({}, { properties: { a: { $ref: 'missing.schema.json' } } }), /unresolved \$ref/);
  refused(synthetic({ 'b.schema.json': { type: 'string' } }, { properties: { a: { $ref: 'b.schema.json#/x' } } }), /not a reference to a whole schema file/);
  refused(new Map([...synthetic(), ['c.schema.json', Buffer.from(JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://dcp-ai.org/schemas/v2/signed_bundle.schema.json' }))]]), /duplicate \$id/);
  refused(synthetic({ 'b.schema.json': { type: 'object', properties: { x: { $ref: 'signed_bundle.schema.json' } } } }, { properties: { a: { $ref: 'b.schema.json' } } }), /reference cycle/);
  refused(synthetic({}, { properties: { a: { $ref: 'signed_bundle.schema.json' } } }), /reference cycle/);
  refused(synthetic({}, { properties: { a: true } }), /boolean schema/);
  refused(synthetic({}, { properties: { a: { type: 'array', items: { type: 'integer' }, uniqueItems: true } } }), /uniqueItems over items that are not exactly type string/);
  refused(synthetic({}, { properties: { a: { type: 'string', enum: [1] } } }), /enum must hold distinct strings/);
  refused(synthetic({}, { properties: { a: { const: 1 } } }), /const must hold distinct strings/);
  refused(synthetic({}, { properties: { a: { pattern: '^a$' } } }), /pattern without type string/);
  refused(new Map([['signed_bundle.schema.json', Buffer.from(JSON.stringify({ $id: 'https://dcp-ai.org/schemas/v2/signed_bundle.schema.json', type: 'object' }))]]), /must declare \$schema/);
});

test('property names are data, and $ref siblings are kept', () => {
  const files = synthetic({ 'b.schema.json': { type: 'string' } }, { properties: { type: { type: 'string' }, $ref: { type: 'string' }, pattern: { type: 'string' }, r: { $ref: 'b.schema.json', type: 'string', minLength: 3 } } });
  const { ir: x } = buildIR({ files, payloads: [], overlay: null });
  assert.deepEqual(x.nodes[0].properties.map(([n]) => n), ['$ref', 'pattern', 'r', 'type']);
  assert.deepEqual(x.nodes.filter((n) => /#\/properties\/(type|\$ref|pattern)$/.test(n.site)).map((n) => n.types), [['string'], ['string'], ['string']]);
  const r = x.nodes.find((n) => n.site.endsWith('#/properties/r'));
  assert.equal(r.minLength, 3);
  assert.deepEqual(r.types, ['string']);
  assert.equal(x.nodes[r.ref].site, 'schemas/v2/b.schema.json#');
});

test('the dcp-jcs-v2 overlay changes one node; each profile is refused under the other selection', () => {
  const [e] = ir.overlays['dcp-jcs-v2'];
  assert.equal(ir.overlays['dcp-jcs-v2'].length, 1);
  assert.equal(e.site, 'schemas/v2/bundle_manifest.schema.json#/properties/canonicalization_profile/const');
  assert.equal(ir.nodes[e.node].const, 'dcp-jcs-v1');
  const doc = (p) => { const d = structuredClone(S.instance); if (p === undefined) delete d.bundle.manifest.canonicalization_profile; else d.bundle.manifest.canonicalization_profile = p; return d; };
  assert.equal(validateSchemaIR(ir, doc('dcp-jcs-v1')).valid, true);
  assert.equal(validateSchemaIR(ir, doc('dcp-jcs-v2')).valid, false);
  assert.equal(validateSchemaIR(ir, doc('dcp-jcs-v2'), { overlay: 'dcp-jcs-v2' }).valid, true);
  assert.equal(validateSchemaIR(ir, doc('dcp-jcs-v1'), { overlay: 'dcp-jcs-v2' }).valid, false);
  assert.equal(validateSchemaIR(ir, doc(undefined)).valid, true, 'absent: the const applies only when present; the verifier profile check decides');
  assert.throws(() => validateSchemaIR(ir, doc('dcp-jcs-v2'), { overlay: 'dcp-jcs-v3' }), /unknown overlay/);
});

// ── Patterns and date-time ──
function* prng(seed) { let x = seed; for (;;) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; yield (x >>> 0) / 2 ** 32; } }
test('each compiled pattern program answers as the ECMAScript expression on boundary and random strings', () => {
  const r = prng(20261102);
  const alphabet = ['0', '9', 'a', 'f', 'g', 'A', 'F', 'G', 'z', ':', '=', '+', '/', '-', ' ', '\n', '\r', ' ', '١', '\u{1F600}', '\ud800', 's', 'h', 'G', 'E', 'N', 'S', 'I'];
  for (const p of ir.patterns) {
    const re = new RegExp(p.source);
    const valid = { '^[0-9a-f]{32}$': 'a'.repeat(32), '^[0-9a-f]{64}$': 'a'.repeat(64), '^sha256:[0-9a-f]{64}$': `sha256:${'a'.repeat(64)}`, '^sha3-256:[0-9a-f]{64}$': `sha3-256:${'a'.repeat(64)}`, '^(sha256:[0-9a-f]{64}|GENESIS)$': 'GENESIS', '^(sha3-256:[0-9a-f]{64}|GENESIS)$': 'GENESIS', '^[A-Za-z0-9+/]+={0,2}$': 'AAAA==' }[p.source];
    const samples = [valid, `${valid}\n`, `\n${valid}`, valid.toUpperCase(), valid.slice(1), `${valid}0`, `${valid}=`, '', '=', 'A===', 'GENESIS\n'];
    for (let i = 0; i < valid.length; i++) for (const ch of ['g', '=', '١', '\n', '\u{1F600}']) samples.push(valid.slice(0, i) + ch + valid.slice(i + 1));
    for (let n = 0; n < 4000; n++) { let s = ''; const len = Math.floor(r.next().value * 72); for (let i = 0; i < len; i++) s += alphabet[Math.floor(r.next().value * alphabet.length)]; samples.push(s); }
    for (const s of samples) assert.equal(matchProgram(p, s), re.test(s), `${p.source} on ${JSON.stringify(s)}`);
  }
  assert.throws(() => compilePattern('^a*$'), PatternError);
});

test('the date-time port answers as upstream ajv-formats on the shared cases and on every BMP scalar as the separator', () => {
  for (const c of D.cases) { assert.equal(upstream(c.value), c.accepted, `upstream ${JSON.stringify(c.value)}`); assert.equal(isDateTime(c.value), c.accepted, JSON.stringify(c.value)); }
  const accepted = [];
  for (let c = 0; c <= 0xffff; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    const v = `2000-01-01${String.fromCharCode(c)}00:00:00Z`;
    assert.equal(isDateTime(v), upstream(v), `U+${c.toString(16)}`);
    if (upstream(v)) accepted.push(c);
  }
  assert.deepEqual(accepted, [...SEPARATORS].sort((a, b) => a - b));
  assert.deepEqual(D.separator_scalars, accepted.map((c) => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`));
});

// ── Evaluator against the corpus and the oracles ──
test('the evaluator gives every schema case its expected verdict and attribution; oracle 1 and validateV2Bundle agree', () => {
  for (const c of [{ id: 'instance', kind: 'positive', expect: { schema: { valid: true } } }, ...S.cases]) {
    const text = schemaCaseText(S.instance, c);
    const doc = JSON.parse(text);
    const r = validateSchemaIR(ir, doc);
    assert.equal(r.valid, c.expect.schema.valid, `${c.id}: ${JSON.stringify(r.errors.slice(0, 3))}`);
    if (c.expect.schema.attribution) assert.ok(attributed(r.errors, c.expect.schema.attribution), `${c.id}: ${JSON.stringify(r.errors.slice(0, 4))}`);
    const a = ajvValidate(doc);
    if (!c.known_oracle_difference) assert.equal(a.valid, c.expect.schema.valid, `${c.id}: oracle 1`);
    assert.equal(validateV2Bundle(doc).valid, a.valid, `${c.id}: oracle 1 and validateV2Bundle`);
    if (c.layers) assert.equal(ajvValidate(doc, { envelopeOnly: true }).valid, c.layers.envelope_only === 'valid', `${c.id}: envelope layer`);
  }
});

test('oracle 2 (python-jsonschema) gives every schema and wiring case its expected verdict and attribution', () => {
  const items = [...S.cases.map((c) => ({ id: `s:${c.id}`, text: schemaCaseText(S.instance, c), c })), ...W.cases.map((c) => ({ id: `w:${c.name}`, text: wiringText(c), c }))];
  const { results, about } = pythonValidate(items.map(({ id, text }) => ({ id, text })));
  assert.equal(about.oracle, 'python-jsonschema');
  for (const { id, c } of items) {
    const r = results.get(id);
    assert.equal(r.valid, c.expect.schema.valid, id);
    const a = c.expect.schema.attribution ?? (c.target && { instance: c.target.instance, keyword: c.target.keyword });
    if (!r.valid && a) assert.ok(attributed(r.errors, a), `${id}: ${JSON.stringify(r.errors.slice(0, 3))}`);
  }
});

test('every wiring case: the evaluator and oracle 1 give its schema verdict, its target is attributed, and the SDK-free structure check passes', () => {
  assert.equal(W.cases[0].name, 'base');
  for (const c of W.cases) {
    const doc = JSON.parse(wiringText(c));
    const r = validateSchemaIR(ir, doc);
    assert.equal(r.valid, c.expect.schema.valid, `${c.name}: ${JSON.stringify(r.errors.slice(0, 3))}`);
    assert.equal(ajvValidate(doc).valid, c.expect.schema.valid, `${c.name}: oracle 1`);
    if (c.target) assert.ok(attributed(r.errors, c.target), `${c.name}: ${JSON.stringify(r.errors.slice(0, 3))}`);
    assert.deepEqual(structure(doc, W.verification_time), [], c.name);
    assert.equal(c.expect.verified, c.expect.schema.valid, `${c.name}: in this corpus the verdict follows the schema`);
  }
  const raw = W.cases.find((c) => c.signed_bundle_text);
  assert.ok(raw.signed_bundle_text.includes('"audit_count":3.0,'));
});

test('the structure check fails on an altered checkpoint signature, root or range (negative controls)', () => {
  const base = JSON.parse(wiringText(W.cases[0]));
  const alter = (f) => { const d = structuredClone(base); f(d.bundle.pq_checkpoints[0], d); return structure(d, W.verification_time); };
  const flip = (s) => { const b = Buffer.from(s, 'base64'); b[0] ^= 1; return b.toString('base64'); };
  assert.ok(alter((cp) => { cp.composite_sig.classical.sig_b64 = flip(cp.composite_sig.classical.sig_b64); }).some((f) => /classical signature/.test(f)));
  assert.ok(alter((cp) => { cp.composite_sig.pq.sig_b64 = flip(cp.composite_sig.pq.sig_b64); }).some((f) => /pq signature/.test(f)));
  assert.ok(alter((cp) => { cp.merkle_root = `sha256:${'0'.repeat(64)}`; }).some((f) => /merkle_root/.test(f)));
  assert.ok(alter((cp) => { cp.event_range.count = 3; }).some((f) => /count/.test(f)));
  assert.ok(alter((cp) => { cp.event_range.from_audit_id = 'audit:absent-1'; }).some((f) => /absent from the trail/.test(f)));
  assert.ok(alter((cp, d) => { d.bundle.manifest.pq_checkpoints = []; }).some((f) => /listed and carried differ/.test(f)));
  assert.ok(alter((cp) => { cp.session_nonce = 'f'.repeat(64); }).some((f) => /session_nonce/.test(f)));
});

// ── Evaluator properties ──
test('error budget: cap must be an integer from 1 to 16; truncation never makes an invalid instance valid', () => {
  for (const cap of [0, -1, NaN, Infinity, -Infinity, 1.5, 17, '3', null]) assert.throws(() => validateSchemaIR(ir, {}, { cap }), RangeError, String(cap));
  const many = (n) => { const d = structuredClone(S.instance); for (let i = 0; i < n; i++) d[`x_${i}`] = i; return d; };
  for (const cap of [1, 5, 16]) {
    const r = validateSchemaIR(ir, many(40), { cap });
    assert.deepEqual([r.valid, r.errors.length, r.truncated], [false, cap, true]);
  }
  assert.deepEqual((({ valid, errors, truncated }) => [valid, errors.length, truncated])(validateSchemaIR(ir, many(16))), [false, 16, false]);
  assert.deepEqual((({ valid, errors, truncated }) => [valid, errors.length, truncated])(validateSchemaIR(ir, many(17))), [false, 16, true]);
  assert.deepEqual(validateSchemaIR(ir, S.instance, { cap: 1 }), { valid: true, errors: [], truncated: false });
  const lines = diagnostics(validateSchemaIR(ir, many(40)));
  assert.equal(lines.length, ERRORS_CAP + 1);
  assert.equal(lines.at(-1), 'schema: further errors not listed');
});

test('diagnostics never echo values and bound each escaped token', () => {
  const d = structuredClone(S.instance);
  d['x'.repeat(1 << 20)] = 'v'.repeat(1 << 20);
  d['~/'.repeat(100)] = 1;
  d.bundle.manifest.intended_verifier = 'w'.repeat(5000);
  const r = validateSchemaIR(ir, d);
  const text = diagnostics(r).join('\n');
  assert.ok(!text.includes('vvvv') && !text.includes('wwww'));
  for (const e of r.errors) if (e.member !== undefined) assert.ok(Array.from(e.member).length <= TOKEN_CAP + '…[cut]'.length, e.member.slice(0, 80));
  const tilde = r.errors.find((e) => e.member?.startsWith('~0~1'));
  assert.ok(tilde && tilde.member.endsWith('…[cut]'), 'escaped first, then cut');
});

test('the evaluator writes nothing: frozen inputs, same JSON before and after', () => {
  for (const c of S.cases) {
    const doc = deepFreeze(JSON.parse(schemaCaseText(S.instance, c)));
    const before = JSON.stringify(doc);
    validateSchemaIR(ir, doc);
    assert.equal(JSON.stringify(doc), before, c.id);
  }
});

test('host values follow the TypeScript canonicalizer at the visited locations; open members are not visited', () => {
  const d = () => structuredClone(S.instance);
  const v = (doc) => validateSchemaIR(ir, doc);
  let x = d(); x.bundle.manifest.x_ext = undefined; assert.equal(v(x).valid, true, 'an undefined member is absent');
  x = d(); x.bundle.responsible_principal_record.payload.legal_name = undefined; assert.ok(v(x).errors.some((e) => e.keyword === 'required'), 'required and undefined is missing');
  x = d(); x.bundle.responsible_principal_record.payload.contact = undefined; assert.equal(v(x).valid, true, 'optional and undefined is absent, not null');
  x = d(); x.signature.signer.kids = [x.signature.signer.kids[0], undefined]; assert.ok(v(x).errors.some((e) => e.instance === '/signature/signer/kids/1' && e.keyword === 'type'), 'an undefined element is null');
  x = d(); x.signature.signer.kids = [x.signature.signer.kids[0], , x.signature.signer.kids[0]]; assert.ok(v(x).errors.some((e) => e.instance === '/signature/signer/kids/1' && e.keyword === 'type'), 'a hole is not JSON');
  x = d(); x.bundle.manifest.audit_count = NaN; assert.ok(v(x).errors.some((e) => e.keyword === 'type'), 'NaN is not an integer');
  x = d(); x.bundle.manifest.audit_count = 3n; assert.ok(v(x).errors.some((e) => e.keyword === 'type'), 'a BigInt is not an integer');
  x = d(); x.bundle.manifest.audit_count = true; assert.ok(v(x).errors.some((e) => e.keyword === 'type'), 'a boolean is not an integer');
  x = d(); x.bundle.manifest.audit_count = 3.0; assert.equal(v(x).valid, true);
  x = d(); x.bundle.x_ext = { a: NaN, f: () => 1, b: 1n }; assert.equal(v(x).valid, true, 'an open member is not visited (canonicalization is the later layer)');
  x = d(); x.bundle.manifest = Object.assign(Object.create(null), x.bundle.manifest); assert.equal(v(x).valid, true, 'no prototype is required');
  x = d(); x.bundle.manifest = Object.assign(Object.create({ x_inherited: 1 }), x.bundle.manifest); assert.equal(v(x).valid, true, 'inherited members are not members');
  x = d(); x.bundle.manifest[Symbol('s')] = 1; assert.equal(v(x).valid, true, 'symbol keys are not members');
  x = d(); Object.defineProperty(x.bundle.manifest, 'x_hidden', { value: 1, enumerable: false }); assert.equal(v(x).valid, true, 'non-enumerable members are not members');
});

// ── Oracle harness controls ──
test('the python oracle harness refuses incomplete, duplicate, unknown, malformed, failing or late answers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-ir-fake-'));
  try {
    const fake = (name, body) => { const f = path.join(dir, `${name}.mjs`); fs.writeFileSync(f, `import fs from 'node:fs';\nconst cases = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).cases;\nconst ok = (id) => ({ id, valid: true, errors: [] });\nconst out = (results) => process.stdout.write(JSON.stringify({ oracle: 'fake', python: '0', versions: {}, results }));\n${body}\n`); return f; };
    const cases = [{ id: 'a', text: '{}' }, { id: 'b', text: '{}' }];
    const run = (f, opts = {}) => pythonValidate(cases, { python: process.execPath, script: f, ...opts });
    assert.equal(run(fake('good', 'out(cases.map((c) => ok(c.id)));')).results.size, 2);
    assert.throws(() => run(fake('missing', 'out([ok("a")]);')), /no result for 1/);
    assert.throws(() => run(fake('duplicate', 'out([ok("a"), ok("a"), ok("b")]);')), /duplicate result/);
    assert.throws(() => run(fake('unknown', 'out([ok("a"), ok("b"), ok("c")]);')), /not sent: c/);
    assert.throws(() => run(fake('malformed', 'process.stdout.write("{");')), /not one JSON document/);
    assert.throws(() => run(fake('types', 'out([{ id: "a", valid: "true", errors: [] }, ok("b")]);')), /malformed result/);
    assert.throws(() => run(fake('inconsistent', 'out([{ id: "a", valid: true, errors: [{ instance: "", keyword: "type" }] }, ok("b")]);')), /disagrees/);
    assert.throws(() => run(fake('extra-key', 'out([{ ...ok("a"), note: 1 }, ok("b")]);')), /malformed result/);
    assert.throws(() => run(fake('nometa', 'process.stdout.write(JSON.stringify({ results: cases.map((c) => ok(c.id)) }));')), /lacks oracle/);
    assert.throws(() => run(fake('late-exit', 'out(cases.map((c) => ok(c.id))); process.exitCode = 3;')), /exit 3/);
    assert.throws(() => run(fake('slow', 'await new Promise((r) => setTimeout(r, 5000)); out(cases.map((c) => ok(c.id)));'), { timeoutMs: 300 }), /no answer within 300 ms/);
    assert.throws(() => run(fake('flood', 'process.stdout.write("x".repeat(1 << 20));'), { maxBytes: 1024 }), /more than 1024 bytes/);
    assert.throws(() => pythonValidate(cases, { python: path.join(dir, 'no-such-interpreter') }), /python oracle/);
    assert.throws(() => pythonValidate([{ id: 'a', text: '{}' }, { id: 'a', text: '{}' }], { python: process.execPath, script: fake('dup-request', 'out([]);') }), /duplicate request id/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Catalog and sizes ──
test('the opt-in catalog matches the wiring cases; every negative counts only with the base; requests carry the exact text', () => {
  const plan = loadSchemaValidationPlan();
  const cases = plan.suites[0].cases;
  assert.equal(cases.length, W.cases.length);
  for (const [i, c] of cases.entries()) {
    assert.equal(Buffer.from(c.request.bundle_b64, 'base64').toString('utf8'), wiringText(W.cases[i]));
    assert.deepEqual(c.controls, W.cases[i].expect.verified ? undefined : ['external.v2.schema_validation.base']);
  }
});

test('every new fixture and the catalog stay within 4 MiB', () => {
  const files = [...fs.readdirSync(path.join(ROOT, 'tests', 'interop', 'v2', 'schema_validation')).map((f) => path.join(ROOT, 'tests', 'interop', 'v2', 'schema_validation', f)), CATALOG_FILE];
  for (const f of files) assert.ok(fs.statSync(f).size <= 4 * 1024 * 1024, f);
});
