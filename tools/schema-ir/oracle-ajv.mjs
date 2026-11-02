// Schema oracle 1: Ajv 2020 with ajv-formats in full mode, configured as lib/verify.js createAjv does (allErrors,
// strict false), over every file of schemas/v2 registered by $id. It imports nothing from the IR compiler, its
// evaluator or the corpus generator: the repository root and the four payload bindings (spec/VERIFICATION.md V2-2) are
// declared here again, and the self-tests check that they equal the compiler's. The date-time format is the upstream
// ajv-formats function itself. Unlike validateV2Bundle it validates each reachable payload even when the envelope
// fails, so every case gets its attribution; its verdict is checked against validateV2Bundle in the tests. Known
// difference kept on purpose: Ajv takes a non-finite number (JSON.parse("1e400")) for an integer; the schema domain
// of the IR (decision D2) is finite JSON numbers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas', 'v2');
export const AJV_PAYLOADS = [
  ['responsible_principal_record', 'responsible_principal_record.schema.json'],
  ['agent_passport', 'agent_passport.schema.json'],
  ['intent', 'intent.schema.json'],
  ['policy_decision', 'policy_decision.schema.json'],
];
let ajv;
function instance() {
  if (ajv) return ajv;
  ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.schema.json'))) {
    const s = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    ajv.addSchema(s, s.$id);
  }
  return ajv;
}
const id = (f) => `https://dcp-ai.org/schemas/v2/${f}`;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** {valid, errors: [{instance, keyword, member?}]} for the envelope and (unless envelopeOnly) every reachable payload. */
export function ajvValidate(doc, { envelopeOnly = false } = {}) {
  const a = instance();
  const errors = [];
  const run = (schemaFile, value, base) => {
    const v = a.getSchema(id(schemaFile));
    if (v(value)) return;
    for (const e of v.errors) {
      const member = e.keyword === 'additionalProperties' ? e.params.additionalProperty : e.keyword === 'required' ? e.params.missingProperty : undefined;
      errors.push({ instance: base + e.instancePath, keyword: e.keyword, ...(member !== undefined ? { member } : {}) });
    }
  };
  run('signed_bundle.schema.json', doc, '');
  if (!envelopeOnly) for (const [member, file] of AJV_PAYLOADS) {
    const env = isObject(doc) && isObject(doc.bundle) && isObject(doc.bundle[member]) ? doc.bundle[member] : null;
    if (env && isObject(env.payload)) run(file, env.payload, `/bundle/${member}/payload`);
  }
  return { valid: errors.length === 0, errors };
}
