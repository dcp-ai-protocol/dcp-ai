// Reading the phase-1 corpus (tests/interop/v2/schema_validation/) and its opt-in catalog, shared by the self-tests and
// tools/schema-ir/before.mjs. This module builds the plan (verify_signed_bundle_v2 cases with the base as control) that
// recorded the phase-1 BEFORE sample; the kit (tools/conformance/external-evidence.js) now builds the same suite from
// the catalog, and a self-test of tools/conformance/external-schema-validation.test.mjs keeps the two plans equal.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './generate.mjs';

export const CORPUS_DIR = path.join(ROOT, 'tests', 'interop', 'v2', 'schema_validation');
export const CATALOG_FILE = path.join(ROOT, 'tools', 'conformance', 'external-schema-validation-catalog.json');
export const SUITE = 'external.v2.schema_validation';
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function readCorpus(file) {
  const rel = path.join('tests', 'interop', 'v2', 'schema_validation', file);
  const bytes = fs.readFileSync(path.join(ROOT, rel));
  return { rel, sha256: sha256(bytes), doc: JSON.parse(bytes.toString('utf8')) };
}

/** The JSON text of a schema case: its mutation applied to a copy of the instance, or its raw replacement. */
export function schemaCaseText(instance, c) {
  if (c.raw_replace) {
    const [from, to] = c.raw_replace;
    const text = JSON.stringify(instance);
    if (text.split(from).length !== 2) throw new Error(`${c.id}: raw anchor is not unique`);
    return text.replace(from, to);
  }
  if (!c.mutation) return JSON.stringify(instance);
  const d = structuredClone(instance);
  const { op, path: p, value, count } = c.mutation;
  const parent = () => p.slice(0, -1).reduce((n, t) => n[t], d);
  if (op === 'set') { if (p.length === 0) return JSON.stringify(value); parent()[p.at(-1)] = value; }
  else if (op === 'delete') delete parent()[p.at(-1)];
  else if (op === 'many') for (let i = 0; i < count; i++) d[`x_unknown_${String(i).padStart(2, '0')}`] = i;
  else throw new Error(`${c.id}: unknown mutation ${op}`);
  return JSON.stringify(d);
}

/** The wiring case's request bytes: the exact text for a raw case, else JSON.stringify of the bundle. */
export const wiringText = (c) => c.signed_bundle_text ?? JSON.stringify(c.signed_bundle);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (o, req, opt = []) => isObject(o) && req.every((k) => Object.hasOwn(o, k)) && Object.keys(o).every((k) => req.includes(k) || opt.includes(k));
const text = (v) => typeof v === 'string' && v.trim() !== '';
const unique = (xs) => new Set(xs).size === xs.length;
const need = (cond, msg) => { if (!cond) throw new Error(msg); };

/** The catalog and the wiring corpus refused unless every identity is unique and every expectation well formed. */
export function checkCatalogAndWiring(cat, w) {
  need(exactKeys(cat, ['contract', 'catalog_version', 'suites'], ['limits']) && cat.contract === 'dcp-ai-conformance-external/2' && text(cat.catalog_version), 'catalog: needs contract dcp-ai-conformance-external/2, a catalog_version and suites');
  need(cat.limits === undefined || (Array.isArray(cat.limits) && cat.limits.every(text)), 'catalog: limits must be strings');
  need(Array.isArray(cat.suites) && cat.suites.length === 1, `catalog: exactly one suite, ${SUITE}`);
  const [suite] = cat.suites;
  need(exactKeys(suite, ['id', 'title', 'claim', 'expected_cases'], ['limits']) && suite.id === SUITE && text(suite.title) && text(suite.claim), `catalog: the suite must be ${SUITE} with a title and a claim`);
  need(suite.limits === undefined || (Array.isArray(suite.limits) && suite.limits.every(text)), 'catalog: suite limits must be strings');
  need(Array.isArray(suite.expected_cases) && suite.expected_cases.length > 0 && suite.expected_cases.every(text), 'catalog: expected_cases must be non-empty strings');
  need(unique(suite.expected_cases), 'catalog: duplicate expected case id');
  need(isObject(w) && text(w.verification_time) && Number.isFinite(Date.parse(w.verification_time)) && isObject(w.verifier_policy) && Array.isArray(w.cases) && w.cases.length > 0, 'wiring: needs verification_time, verifier_policy and cases');
  for (const c of w.cases) {
    const at = `wiring case ${JSON.stringify(c?.name)}`;
    need(isObject(c) && typeof c.name === 'string' && /^[a-z0-9_]+$/.test(c.name), `${at}: needs a name of [a-z0-9_]`);
    need(isObject(c.expect) && typeof c.expect.verified === 'boolean' && isObject(c.expect.schema) && typeof c.expect.schema.valid === 'boolean', `${at}: expect.verified and expect.schema.valid must be booleans`);
    need(text(c.spec_step) && /^V2-(?:[1-9]|1[0-4])$/.test(c.spec_step), `${at}: needs a spec_step V2-1 to V2-14`);
    need((isObject(c.signed_bundle) && c.signed_bundle_text === undefined) || (text(c.signed_bundle_text) && c.signed_bundle === undefined), `${at}: needs exactly one of signed_bundle and signed_bundle_text`);
  }
  need(unique(w.cases.map((c) => c.name)), 'wiring: duplicate case name');
  const base = w.cases.find((c) => c.name === 'base');
  need(base && base.expect.verified === true && base.expect.schema.valid === true, 'wiring: the control "base" must exist and be a positive');
}

/** A plan for runEvidence (tools/conformance/external-evidence.js) from the catalog and wiring_cases.json. */
export function loadSchemaValidationPlan({ catalogBytes, wiring } = {}) {
  const raw = catalogBytes ?? fs.readFileSync(CATALOG_FILE);
  const cat = JSON.parse(Buffer.from(raw).toString('utf8'));
  const w = wiring ?? readCorpus('wiring_cases.json');
  checkCatalogAndWiring(cat, w.doc);
  const [suite] = cat.suites;
  const id = (n) => `${SUITE}.${n}`;
  const cases = w.doc.cases.map((c) => ({
    id: id(c.name),
    source: `${w.rel}#${c.name} (${c.family}${c.target ? `; ${c.target.instance || '/'} ${c.target.keyword}` : ''})`,
    op: 'verify_signed_bundle_v2',
    request: { bundle_b64: Buffer.from(wiringText(c), 'utf8').toString('base64'), policy: w.doc.verifier_policy, verification_time: w.doc.verification_time },
    expect: { verified: c.expect.verified },
    ...(c.expect.verified ? {} : { controls: [id('base')] }),
    anchor_source: { spec_step: c.spec_step },
  }));
  const produced = cases.map((c) => c.id);
  const missing = suite.expected_cases.filter((x) => !produced.includes(x));
  const extra = produced.filter((x) => !suite.expected_cases.includes(x));
  if (missing.length || extra.length) throw new Error(`catalog and corpus disagree (missing ${missing.join(', ') || 'none'}; extra ${extra.join(', ') || 'none'})`);
  return {
    catalog: { version: cat.catalog_version, sha256: sha256(raw), limits: cat.limits ?? [], contract: cat.contract },
    fixtures: { [w.rel]: w.sha256 },
    suites: [{ id: suite.id, title: suite.title, claim: suite.claim, limits: suite.limits ?? [], cases }],
  };
}
