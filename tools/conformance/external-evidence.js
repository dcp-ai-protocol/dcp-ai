// Evidence suites of the external kit (contract dcp-ai-conformance-external/2, opt-in through
// tools/conformance/external-evidence-catalog.json): exact dual Merkle roots, composite signature verification
// and normative V2 signed-bundle verification, built from committed public fixtures only. The transport,
// process handling, limits and response envelope are those of external.js; nothing here generates keys or
// signs. A negative case names its control: it passes only if that control passed in the same run.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  REPO_ROOT, LIMITS, UsageError, InfraError, isObj, exactKeys, sha256, utf8, runProcess, runLevel, parseResponse,
} from "./external.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EVIDENCE_CATALOG_PATH = path.join(HERE, "external-evidence-catalog.json");
export const EVIDENCE_CONTRACT = "dcp-ai-conformance-external/2";
export const EVIDENCE_TIMEOUT_MS = 300000;
const HEX64 = /^[0-9a-f]{64}$/;
const BUNDLE_TIME = "2026-10-22T00:00:00Z"; // inside the window of the base bundle and of every bundle expected to verify; some negatives are expired or not yet valid on purpose
const FIXTURES = {
  merkle: "tests/conformance/v2/merkle_vectors.json",
  interop: "tests/interop/v2/interop_vectors.json",
  bundles: "tests/interop/v2/bundle_vectors.json",
  secondary: "tests/interop/v2/secondary_sha3_vectors.json",
};
// Fixtures that only an opt-in suite reads: loaded (and recorded in the report) only when a catalog lists that suite,
// so the committed evidence catalog loads exactly the fixtures it always did.
const SUITE_FIXTURES = {
  "external.v2.schema_closure": { schema: "tests/interop/v2/schema_closure_vectors.json" },
  "external.v2.verifier_policy": { policy: "tests/interop/v2/verifier_policy_vectors.json" },
  "external.v2.structural": { structural: "tests/interop/v2/structural_vectors.json" },
};

const need = (cond, msg) => { if (!cond) throw new InfraError(msg); };
const isHex64 = (v) => typeof v === "string" && HEX64.test(v);
const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const flipLastByte = (sigB64) => { const b = Buffer.from(sigB64, "base64"); b[b.length - 1] ^= 0x01; return b.toString("base64"); };

// Changes the last character of the first string value of a canonical JSON text, so the text stays valid,
// canonical JSON (same keys, same order, no escape introduced) while the signed content differs.
function alterFirstStringValue(canonical) {
  const m = /:"([^"\\]+)"/.exec(canonical);
  need(m, "no string value to alter in the payload");
  const last = m[1].at(-1);
  const other = last === "a" ? "b" : last === "0" ? "1" : /[A-Za-z0-9]/.test(last) ? (last === "b" ? "c" : "a") : "a";
  const at = m.index + 2 + m[1].length - 1;
  return canonical.slice(0, at) + other + canonical.slice(at + 1);
}

function mutated(signed, mutations) {
  const out = structuredClone(signed);
  for (const { path: p, value } of mutations) {
    let node = out;
    for (const k of p.slice(0, -1)) node = node[k];
    node[p.at(-1)] = value;
  }
  return out;
}

const modePolicy = (base, mode) => ({ ...base, default_mode: mode, risk_overrides: { low: mode, medium: mode, high: mode } });
// `controls`: the ids that must pass in the same run for this negative to count.
const verifyCase = (id, source, signed, policy, time, expect, controls) => ({
  id, source, op: "verify_signed_bundle_v2", request: { bundle_b64: b64(JSON.stringify(signed)), policy, verification_time: time }, expect, ...(controls ? { controls } : {}),
});

const BUILDERS = {
  "external.merkle.dual_root": ({ merkle }) => {
    need(Array.isArray(merkle.cases) && merkle.cases.length > 0, `${FIXTURES.merkle}: cases missing`);
    return merkle.cases.map((c) => {
      need(nonEmpty(c.name) && Array.isArray(c.leaves) && c.leaves.length > 0 && c.leaves.every((l) => exactKeys(l, ["sha256", "sha3_256"]) && isHex64(l.sha256) && isHex64(l.sha3_256)), `merkle ${c.name}: malformed leaves`);
      need(exactKeys(c.expected, ["sha256", "sha3_256"]) && isHex64(c.expected.sha256) && isHex64(c.expected.sha3_256), `merkle ${c.name}: malformed expected roots`);
      return { id: `external.merkle.dual_root.${c.name}`, source: `${FIXTURES.merkle}#cases/${c.name}`, op: "dual_merkle_root", request: { leaves: c.leaves }, expect: { roots: c.expected } };
    });
  },
  "external.signature.composite": ({ interop }) => {
    const ed = interop.test_keys?.ed25519?.public_key_b64;
    const pq = interop.test_keys?.ml_dsa_65?.public_key_b64;
    need(typeof ed === "string" && typeof pq === "string", `${FIXTURES.interop}: public test keys missing`);
    const payload = (key) => { const p = interop.canonicalization?.[key]?.expected_canonical; need(typeof p === "string", `no canonical payload ${key}`); return p; };
    const req = (context, text, sig, pqKey) => ({ context, payload_b64: b64(text), composite_sig: sig, classical_public_key_b64: ed, pq_public_key_b64: pqKey });
    const out = [];
    const positives = [
      ...Object.entries(interop.composite_signatures ?? {}).map(([n, v]) => [n, v, true]),
      ...Object.entries(interop.classical_only_signatures ?? {}).map(([n, v]) => [n, v, false]),
    ];
    need(positives.length === 4, "expected 3 composite and 1 classical-only committed signature");
    const contexts = ["DCP-AI.v2.AgentPassport", "DCP-AI.v2.Intent", "DCP-AI.v2.AuditEvent"];
    const positiveFor = {};
    for (const [name, v, composite] of positives) {
      const id = `external.signature.composite.${name}`;
      const text = payload(v.payload_key);
      const pqKey = composite ? pq : null;
      const source = `${FIXTURES.interop}#${composite ? "composite_signatures" : "classical_only_signatures"}/${name}`;
      positiveFor[v.payload_key] ??= composite ? id : undefined;
      out.push({ id, source, op: "composite_verify", request: req(v.context, text, v.composite_sig, pqKey), expect: composite ? { valid: true, classical_valid: true, pq_valid: true } : { valid: true, classical_valid: true } });
      const sig = (f) => { const s = structuredClone(v.composite_sig); f(s); return s; };
      out.push({ id: `${id}.altered_classical_sig`, source: `${source} (altered classical sig)`, op: "composite_verify", controls: [id], request: req(v.context, text, sig((s) => { s.classical.sig_b64 = flipLastByte(s.classical.sig_b64); }), pqKey), expect: { valid: false, classical_valid: false } });
      if (composite) out.push({ id: `${id}.altered_pq_sig`, source: `${source} (altered pq sig)`, op: "composite_verify", controls: [id], request: req(v.context, text, sig((s) => { s.pq.sig_b64 = flipLastByte(s.pq.sig_b64); }), pqKey), expect: { valid: false, pq_valid: false } });
      out.push({ id: `${id}.altered_payload`, source: `${source} (altered payload)`, op: "composite_verify", controls: [id], request: req(v.context, alterFirstStringValue(text), v.composite_sig, pqKey), expect: composite ? { valid: false, classical_valid: false, pq_valid: false } : { valid: false, classical_valid: false } });
      out.push({ id: `${id}.altered_context`, source: `${source} (altered context)`, op: "composite_verify", controls: [id], request: req(contexts.find((c) => c !== v.context), text, v.composite_sig, pqKey), expect: { valid: false } });
    }
    // Attacks: only the fields each fixture commits are judged. stripping_pq_with_downgrade commits
    // classical_valid=true and pq_valid=false; its rejection belongs to a hybrid_required policy, not here.
    for (const [name, a] of Object.entries(interop.attack_vectors ?? {})) {
      const expect = Object.fromEntries(["valid", "classical_valid", "pq_valid"].filter((f) => typeof a[`expected_${f}`] === "boolean").map((f) => [f, a[`expected_${f}`]]));
      need(Object.keys(expect).length > 0, `attack ${name}: no committed expectation`);
      need(positiveFor[a.payload_key], `attack ${name}: no committed composite positive for ${a.payload_key}`);
      // DR2: only a case that commits valid=false alone, for a pq_over_classical signature whose PQ part is
      // absent, may also pass as rejected(missing_pq_signature).
      if (Object.keys(expect).join() === "valid" && expect.valid === false && a.composite_sig?.binding === "pq_over_classical" && a.composite_sig?.pq == null) {
        expect.missing_pq_rejection_allowed = true;
      }
      out.push({ id: `external.signature.composite.attack.${name}`, source: `${FIXTURES.interop}#attack_vectors/${name}`, op: "composite_verify", controls: [positiveFor[a.payload_key]], request: req(a.verify_context ?? a.context, payload(a.payload_key), a.composite_sig, pq), expect });
    }
    return out;
  },
  "external.v2.bundle_vectors": ({ bundles: B }) => {
    need(isObj(B.signed_bundle) && isObj(B.default_verifier_policy), `${FIXTURES.bundles}: signed_bundle or default policy missing`);
    const policy = B.default_verifier_policy;
    need(Array.isArray(B.must_reject) && Array.isArray(B.must_accept_bundles) && Array.isArray(B.must_reject_bundles) && isObj(B.classical_only_routine_bundle?.verified_by_mode), `${FIXTURES.bundles}: collections missing`);
    const src = (p) => `${FIXTURES.bundles}#${p}`;
    const base = "external.v2.bundle_vectors.signed_bundle";
    const out = [verifyCase(base, src("signed_bundle"), B.signed_bundle, policy, BUNDLE_TIME, { verified: true })];
    const overrides = (c) => { need(c.verifier_policy_overrides === undefined || isObj(c.verifier_policy_overrides), `${c.name}: verifier_policy_overrides must be an object`); return { ...policy, ...(c.verifier_policy_overrides ?? {}) }; };
    for (const c of B.must_reject) {
      need(nonEmpty(c.name) && nonEmpty(c.error_contains) && Array.isArray(c.mutations) && c.mutations.length > 0, `must_reject ${c.name}: needs a name, a non-empty error_contains and mutations`);
      out.push({ ...verifyCase(`external.v2.bundle_vectors.must_reject.${c.name}`, src(`must_reject/${c.name}`), mutated(B.signed_bundle, c.mutations), policy, BUNDLE_TIME, { verified: false, error_contains: c.error_contains }, [base]), anchor_source: { spec_step: c.spec_step } });
    }
    const accepted = [base];
    for (const c of B.must_accept_bundles) {
      need(nonEmpty(c.name) && isObj(c.signed_bundle), `must_accept ${c.name}: needs a name and a signed_bundle`);
      const id = `external.v2.bundle_vectors.must_accept.${c.name}`;
      accepted.push(id);
      out.push(verifyCase(id, src(`must_accept_bundles/${c.name}`), c.signed_bundle, overrides(c), BUNDLE_TIME, { verified: true }));
    }
    // Separately built bundles with no per-case positive twin: gated on the base and every committed positive
    // of the same generator (a suite-level control, a weaker guarantee), plus their specific error_contains.
    for (const c of B.must_reject_bundles) {
      need(nonEmpty(c.name) && nonEmpty(c.error_contains) && isObj(c.signed_bundle), `must_reject_bundles ${c.name}: needs a name, a non-empty error_contains and a signed_bundle`);
      out.push({ ...verifyCase(`external.v2.bundle_vectors.must_reject_bundles.${c.name}`, src(`must_reject_bundles/${c.name}`), c.signed_bundle, overrides(c), BUNDLE_TIME, { verified: false, error_contains: c.error_contains }, accepted), anchor_source: { spec_step: c.spec_step } });
    }
    const modes = Object.entries(B.classical_only_routine_bundle.verified_by_mode);
    need(modes.every(([, v]) => typeof v === "boolean") && modes.some(([, v]) => v), "classical_only_routine_bundle.verified_by_mode must hold booleans, at least one true");
    const okMode = `external.v2.bundle_vectors.classical_only_routine.${modes.find(([, v]) => v)[0]}`;
    for (const [mode, verified] of modes) {
      out.push(verifyCase(`external.v2.bundle_vectors.classical_only_routine.${mode}`, src(`classical_only_routine_bundle (mode ${mode})`), B.classical_only_routine_bundle.signed_bundle, modePolicy(policy, mode), BUNDLE_TIME, { verified }, verified ? undefined : [okMode]));
    }
    return out;
  },
  // Diagnostic of spec/VERIFICATION.md V2-2 (schema_closure_vectors.json): the normative verdict of each case, with the
  // base as the same-run control of every negative and, where the corpus names one, the twin positive that carries the
  // same member with every commitment redone. A verifier that accepts a closed-object case fails it: a gap, never a pass.
  "external.v2.schema_closure": ({ schema: Z }) => {
    const rel = SUITE_FIXTURES["external.v2.schema_closure"].schema;
    need(isObj(Z?.base) && isObj(Z.verifier_policy) && typeof Z.verification_time === "string" && Array.isArray(Z.cases) && Z.cases.length > 0, `${rel}: malformed`);
    const base = "external.v2.schema_closure.base";
    const out = [verifyCase(base, `${rel}#base`, Z.base, Z.verifier_policy, Z.verification_time, { verified: true })];
    const byName = new Map(Z.cases.map((c) => [c.name, c]));
    for (const c of Z.cases) {
      need(nonEmpty(c.name) && isObj(c.signed_bundle) && typeof c.expect?.verified === "boolean" && nonEmpty(c.expect?.schema?.pointer) && nonEmpty(c.expect?.schema?.rule) && nonEmpty(c.spec_step),
        `schema_closure ${c.name}: needs a name, a signed_bundle, expect.verified, a schema pointer and rule, and a spec_step`);
      need(c.twin === undefined || byName.get(c.twin)?.expect?.verified === true, `schema_closure ${c.name}: twin ${c.twin} is not a positive case`);
      const controls = c.expect.verified ? undefined : [base, ...(c.twin ? [`external.v2.schema_closure.${c.twin}`] : [])];
      out.push({ ...verifyCase(`external.v2.schema_closure.${c.name}`, `${rel}#cases/${c.name} (${c.expect.schema.pointer}; ${c.expect.schema.rule})`, c.signed_bundle, Z.verifier_policy, Z.verification_time, { verified: c.expect.verified }, controls), anchor_source: { spec_step: c.spec_step } });
    }
    return out;
  },
  // Opt-in policy suite (verifier_policy_vectors.json, spec/VERIFICATION.md V2-7, V2-9, V2-10, V2-12): each case carries
  // its exact policy and instant; committed bundles are taken from bundle_vectors.json only if their recorded sha256
  // still matches. The requested and effective modes go into the source text for the reader; only the verdict is judged.
  "external.v2.verifier_policy": ({ policy: P, bundles: B }) => {
    const rel = SUITE_FIXTURES["external.v2.verifier_policy"].policy;
    need(isObj(P?.bundles) && Array.isArray(P.cases) && P.cases.length > 0, `${rel}: malformed`);
    const signedOf = (name) => {
      const e = P.bundles[name];
      need(isObj(e), `${rel}: unknown bundle ${name}`);
      if (e.signed_bundle !== undefined) return e.signed_bundle;
      const [file, pointer = ""] = String(e.source).split("#");
      const [coll, n] = pointer.split("/");
      need(file === FIXTURES.bundles, `${name}: source outside ${FIXTURES.bundles}`);
      const signed = coll === "classical_only_routine_bundle" ? B.classical_only_routine_bundle?.signed_bundle : B[coll]?.find?.((c) => c.name === n)?.signed_bundle;
      need(isObj(signed) && sha256(JSON.stringify(signed)) === e.sha256, `${name}: ${e.source} is missing or differs from its recorded sha256`);
      return signed;
    };
    return P.cases.map((c) => {
      need(nonEmpty(c.name) && isObj(c.policy) && nonEmpty(c.verification_time) && typeof c.expect?.verified === "boolean" && nonEmpty(c.spec_step) && (c.expect.verified || c.controls?.length > 0),
        `verifier_policy ${c.name}: needs a name, a policy, a verification_time, expect.verified, a spec_step and, if negative, controls`);
      let signed = signedOf(c.bundle);
      if (c.mutation !== undefined) {
        const [k, loc] = String(c.mutation).split(".");
        const m = P.bundles[c.bundle]?.[k]?.[loc];
        need(Array.isArray(m?.path) && typeof m.value === "string", `verifier_policy ${c.name}: unknown mutation ${c.mutation}`);
        signed = mutated(signed, [m]);
      }
      const id = (n) => `external.v2.verifier_policy.${n}`;
      return { ...verifyCase(id(c.name), `${rel}#cases/${c.name} (requested ${c.requested_mode}, tier ${c.tier}, effective ${c.effective_mode})`, signed, c.policy, c.verification_time, { verified: c.expect.verified }, c.controls?.map(id)), anchor_source: { spec_step: c.spec_step } };
    });
  },
  // Opt-in structural suite (structural_vectors.json, spec/VERIFICATION.md V2-3, V2-4, V2-5, V2-6, V2-12): the base and
  // the positives verify; each case breaks one structural rule and counts only if the base, and its twin where the
  // corpus names one, verified in the same run. One policy and one instant, those of the corpus, for every case.
  "external.v2.structural": ({ structural: S }) => {
    const rel = SUITE_FIXTURES["external.v2.structural"].structural;
    need(isObj(S?.base) && isObj(S.verifier_policy) && nonEmpty(S.verification_time) && Array.isArray(S.positives) && Array.isArray(S.cases) && S.cases.length > 0, `${rel}: malformed`);
    const id = (n) => `external.v2.structural.${n}`;
    const run = (name, source, signed, verified, controls) => verifyCase(id(name), `${rel}#${source}`, signed, S.verifier_policy, S.verification_time, { verified }, controls);
    const out = [run("base", "base", S.base, true)];
    const positives = new Set();
    for (const p of S.positives) {
      need(nonEmpty(p.name) && isObj(p.signed_bundle) && p.expect?.verified === true && nonEmpty(p.spec_step), `structural positive ${p.name}: needs a name, a signed_bundle, expect.verified true and a spec_step`);
      positives.add(p.name);
      out.push({ ...run(p.name, `positives/${p.name}`, p.signed_bundle, true), anchor_source: { spec_step: p.spec_step } });
    }
    for (const c of S.cases) {
      need(nonEmpty(c.name) && isObj(c.signed_bundle) && c.expect?.verified === false && nonEmpty(c.spec_step) && (c.twin === undefined || positives.has(c.twin)),
        `structural ${c.name}: needs a name, a signed_bundle, expect.verified false, a spec_step and, if named, a positive twin`);
      out.push({ ...run(c.name, `cases/${c.name} (${c.spec_step})`, c.signed_bundle, false, [id("base"), ...(c.twin ? [id(c.twin)] : [])]), anchor_source: { spec_step: c.spec_step } });
    }
    return out;
  },
  "external.v2.secondary_sha3": ({ secondary: V, bundles: B }) => {
    need(Array.isArray(V.cases) && isObj(V.base?.artifacts) && typeof V.verification_time === "string", `${FIXTURES.secondary}: malformed`);
    const assemble = (p) => ({ bundle: { dcp_bundle_version: "2.0", manifest: p.manifest, ...V.base.artifacts, audit_entries: p.audit_entries }, signature: p.signature });
    const out = [];
    for (const c of V.cases) {
      const id = `external.v2.secondary_sha3.${c.name}`;
      const source = `${FIXTURES.secondary}#cases/${c.name}`;
      need(nonEmpty(c.name), "secondary: a case needs a name");
      if (c.expect === "accept") { out.push(verifyCase(id, source, assemble(c), B.default_verifier_policy, V.verification_time, { verified: true })); continue; }
      need(c.expect === "reject" && isObj(c.control) && nonEmpty(c.error_contains), `secondary ${c.name}: needs expect, a control and a non-empty error_contains`);
      out.push(verifyCase(`${id}.control`, `${source}/control`, assemble(c.control), B.default_verifier_policy, V.verification_time, { verified: true }));
      out.push({ ...verifyCase(id, source, assemble(c), B.default_verifier_policy, V.verification_time, { verified: false, error_contains: c.error_contains }, [`${id}.control`]), anchor_source: { group: c.group } });
    }
    return out;
  },
};

/** Loads the evidence catalog and fixtures; every suite must produce exactly the case ids it pins. */
export function loadEvidencePlan({ root = REPO_ROOT, catalogFile = EVIDENCE_CATALOG_PATH, select } = {}) {
  let raw;
  try { raw = fs.readFileSync(catalogFile); } catch (e) { throw new InfraError(`catalog ${catalogFile} is unreadable (${e.code ?? e.message})`); }
  let cat;
  try { cat = JSON.parse(utf8(raw)); } catch (e) { throw new InfraError(`catalog ${catalogFile} is not valid UTF-8 JSON (${e.message})`); }
  const isText = (v) => typeof v === "string" && v.trim() !== "";
  need(exactKeys(cat, ["contract", "catalog_version", "suites"], ["limits"]) && cat.contract === EVIDENCE_CONTRACT && isText(cat.catalog_version), `invalid catalog: needs contract ${EVIDENCE_CONTRACT}, catalog_version and suites`);
  need(Array.isArray(cat.suites) && cat.suites.length > 0 && (cat.limits === undefined || (Array.isArray(cat.limits) && cat.limits.every(isText))), "invalid catalog: suites and limits");
  const fixtures = {};
  const docs = {};
  for (const [k, rel] of Object.entries(FIXTURES)) {
    let buf;
    try { buf = fs.readFileSync(path.join(root, rel)); } catch (e) { throw new InfraError(`required fixture ${rel} is missing or unreadable (${e.code ?? e.message})`); }
    try { docs[k] = JSON.parse(utf8(buf)); } catch (e) { throw new InfraError(`required fixture ${rel} is not valid UTF-8 JSON (${e.message})`); }
    fixtures[rel] = sha256(buf);
  }
  for (const s of cat.suites) {
    for (const [k, rel] of Object.entries(isObj(s) ? SUITE_FIXTURES[s.id] ?? {} : {})) {
      if (docs[k] !== undefined) continue;
      let buf;
      try { buf = fs.readFileSync(path.join(root, rel)); } catch (e) { throw new InfraError(`required fixture ${rel} is missing or unreadable (${e.code ?? e.message})`); }
      try { docs[k] = JSON.parse(utf8(buf)); } catch (e) { throw new InfraError(`required fixture ${rel} is not valid UTF-8 JSON (${e.message})`); }
      fixtures[rel] = sha256(buf);
    }
  }
  const ids = new Set();
  const suites = cat.suites.map((s) => {
    need(exactKeys(s, ["id", "title", "claim", "expected_cases"], ["limits"]) && isText(s.id) && isText(s.title) && isText(s.claim) &&
      Array.isArray(s.expected_cases) && s.expected_cases.length > 0 && s.expected_cases.every(isText) && (s.limits === undefined || (Array.isArray(s.limits) && s.limits.every(isText))), "invalid catalog: every suite needs id, title, claim and non-empty expected_cases");
    need(BUILDERS[s.id], `invalid catalog: unknown suite ${s.id}`);
    for (const id of [s.id, ...s.expected_cases]) { need(!ids.has(id), `invalid catalog: duplicate id ${id}`); ids.add(id); }
    let cases;
    try { cases = BUILDERS[s.id](docs); } catch (e) { if (e instanceof InfraError) throw e; throw new InfraError(`fixture for ${s.id} is malformed (${e.message})`); }
    const produced = cases.map((c) => c.id);
    need(new Set(produced).size === produced.length, `${s.id}: duplicate case produced`);
    const missing = s.expected_cases.filter((id) => !produced.includes(id));
    const extra = produced.filter((id) => !s.expected_cases.includes(id));
    need(missing.length === 0 && extra.length === 0, `${s.id}: fixtures and catalog disagree (missing ${missing.join(", ") || "none"}; extra ${extra.join(", ") || "none"})`);
    for (const c of cases) for (const k of c.controls ?? []) need(produced.includes(k) && k !== c.id, `${c.id}: control ${k} is not another case of the suite`);
    return { id: s.id, title: s.title, claim: s.claim, limits: s.limits ?? [], cases };
  });
  let selected = suites;
  if (select !== undefined && select.length > 0) {
    const seen = new Set();
    for (const id of select) {
      if (typeof id !== "string" || id.trim() === "") throw new UsageError("empty suite id");
      if (seen.has(id)) throw new UsageError(`suite ${id} selected twice`);
      if (!suites.some((s) => s.id === id)) throw new UsageError(`unknown suite ${id} (see --list)`);
      seen.add(id);
    }
    selected = select.map((id) => suites.find((s) => s.id === id));
  }
  need(selected.reduce((n, s) => n + s.cases.length, 0) > 0, "the selection has no case");
  return { catalog: { version: cat.catalog_version, sha256: sha256(raw), limits: cat.limits ?? [], contract: EVIDENCE_CONTRACT }, fixtures, suites: selected };
}

const RESULT_FIELDS = {
  dual_merkle_root: ["sha256", "sha3_256"],
  composite_verify: ["valid", "classical_valid", "pq_valid"],
  verify_signed_bundle_v2: ["verified", "errors"],
};

// ── Assessment: legacy (default, unchanged) or verdict (opt-in, --assessment verdict) ──
// spec/VERIFICATION.md defines when a bundle does not verify, not the wording of the errors. Under "verdict", the
// cases that carry an error_contains are judged on verified=false alone, every other rule is the legacy one, and the
// wording is a diagnostic. The report of a verdict run declares its own schema, apart from the /2 wire contract.
export const ASSESSMENTS = ["legacy", "verdict"];
export const ASSESSMENT_SCHEMA = "dcp-ai-conformance-assessment/1";
const ERRATUM_FIELD = { root: "audit_merkle_root_secondary", chain: "prev_hash_secondary", intent: "intent_hash_secondary" };
const isWordingCase = (c) => c.expect?.error_contains !== undefined;
const isPlainPositive = (c) => c.controls === undefined && c.expect?.error_contains === undefined && (c.expect?.verified === true || c.expect?.valid === true);

/** The normative step of a case judged on its verdict alone, or null. */
export function anchorOf(c) {
  const a = c.anchor_source ?? {};
  if (Object.hasOwn(a, "spec_step")) return typeof a.spec_step === "string" && /^V2-(?:[1-9]|1[0-4])$/.test(a.spec_step) ? { document: "spec/VERIFICATION.md", step: a.spec_step } : null;
  if (Object.hasOwn(a, "group")) return typeof a.group === "string" && Object.hasOwn(ERRATUM_FIELD, a.group) ? { document: "spec/VERIFICATION.md", step: "V2-11", field: ERRATUM_FIELD[a.group] } : null;
  return null;
}

/**
 * The premises of a verdict run, checked at load: every case judged on its verdict has a normative anchor, and every
 * control is a plain positive (expect.verified or expect.valid true, no error_contains, no controls of its own), so
 * the assessment can never change the outcome of a control. A fact of the current builders, checked, not assumed.
 */
export function assertVerdictPlan(plan) {
  const all = new Map(plan.suites.flatMap((s) => s.cases.map((c) => [c.id, c])));
  for (const c of all.values()) {
    if (isWordingCase(c)) need(anchorOf(c), `${c.id}: no normative anchor for the verdict assessment (spec_step V2-1 to V2-14, or a secondary group root, chain or intent)`);
    for (const k of c.controls ?? []) need(all.has(k) && isPlainPositive(all.get(k)), `${c.id}: control ${k} is not a plain positive (expect verified or valid true, no error_contains, no controls)`);
  }
}

// The claims and limits a verdict run states are the runner's, per suite id: what this assessment checks, whatever
// the prose of the catalog in use. That prose is kept verbatim in the report as catalog_claim and catalog_limits.
const NOT_JUDGED = "Rejection messages are not judged; their agreement with each committed error_contains is reported as a diagnostic.";
export const VERDICT_TEXT = {
  limits: [
    "Opt-in evidence on committed public fixtures: a pass shows these cases pass for the argv that was run, nothing more. The default catalog (external-catalog.json, contract /1) is unchanged.",
    "verification_time is pinned by each implementation through its API; the WASM wrapper substitutes the host clock (Date.now) during each call and restores it, and states so.",
    "No key is generated and nothing is signed; only public test keys of interop_vectors.json are used. Ed25519 policy points E3 to E6 are not defined here.",
    `Verdict assessment (${ASSESSMENT_SCHEMA}): a pass shows correct verdicts for these cases with the argv that was run; rejection messages are not assessed, and their agreement with each committed error_contains is only a diagnostic. Only status pass (exit 0) means the run passed: per-case diagnostics in a run with status fail or error are partial detail.`,
  ],
  suites: {
    "external.merkle.dual_root": {
      claim: "The implementation returns the exact SHA-256 and SHA3-256 dual Merkle roots of tests/conformance/v2/merkle_vectors.json (1, 2, 3 and 5 leaves, and reordered leaves; spec/VERIFICATION.md V2-11), generated offline without any SDK.",
      limits: ["Roots from leaves only: the leaf hashing of audit entries and the empty-trail rule are covered by the bundle suites."],
    },
    "external.signature.composite": {
      claim: "Committed composite and classical-only signatures verify; committed attacks give the committed per-field results; deterministic alterations of each positive (a signature byte, a byte of a signed string value, the context) fail, each counted only if its positive passed.",
      limits: [
        "A primitive with domain separation, binding and keys given: not policy, not trust, not admission. stripping_pq_with_downgrade is judged on classical_valid and pq_valid only; its rejection belongs to a hybrid_required policy.",
        "A committed attack counts only if the positive of its payload passes. rejected/missing_pq_signature (the Rust and WASM error for a pq_over_classical signature without a PQ part) passes only where the attack commits valid:false alone with that binding and pq null (stripping_pq_removal); that code anywhere else fails.",
        "A payload alteration changes one character of a signed string value and keeps the payload valid, canonical JSON, so a parser error is never counted as a cryptographic failure (the WASM export takes payload JSON).",
      ],
    },
    "external.v2.bundle_vectors": {
      claim: `Under default_verifier_policy with each case's committed verifier_policy_overrides, at 2026-10-22T00:00:00Z (inside the validity window of the base bundle and of every bundle expected to verify; some negatives are intentionally expired or not yet valid then), the signed bundle verifies, every committed mutation of it is rejected (verified false; the base is the control), the accepted bundles verify, the separately built rejected bundles are rejected (verified false), and the classical-only routine bundle gets its verdict per mode. ${NOT_JUDGED}`,
      limits: [
        "default_verifier_policy with each case's committed verifier_policy_overrides, plus the 4 modes for the classical-only bundle; no other policy is tried, although the vectors also claim every mode.",
        "must_reject_bundles are separately built bundles with no per-case control: each counts only if the base and the accepted bundles pass (a suite-level control, a weaker guarantee than a per-case control), and is judged on its verdict alone; its committed error_contains is only a diagnostic.",
        "A verifier verdict: not admission, not trust in the principal, not authorization of an action.",
      ],
    },
    "external.v2.schema_closure": {
      claim: `Diagnostic of spec/VERIFICATION.md V2-2 at the corpus verification_time under its verifier_policy: the base and the permitted extensions verify, and every case that adds a member to a closed object, or a value outside an enumeration, of the V2 schemas is rejected (verified false), even when every signature and hash is valid; a verifier that accepts one shows a gap, never conformance. ${NOT_JUDGED}`,
      limits: [
        "The wrappers call each SDK's fixed-time verification API, not the reference verifyV2SignedBundle; a failure here concerns that API, and a pass of validateV2Bundle composed with a verifier is a composition, not that API enforcing V2-2.",
        "One member per case: a sample of the closure rules, not every closed object of the schemas.",
      ],
    },
    "external.v2.verifier_policy": {
      claim: `Each case of tests/interop/v2/verifier_policy_vectors.json is run under its exact policy and verification_time: hybrid positives verify under each requested mode; a present and invalid PQ signature of the bundle, the passport or a checkpoint is rejected in every mode; a policy whose accepted or advisory lists exclude an algorithm the bundle uses rejects it; and committed classical-only bundles whose tier demands hybrid_required are rejected under a requested classical_only or hybrid_preferred mode. Every negative counts only if its positive control, the same bundle or the committed classical-only routine bundle under the same requested mode, passed in the same run. Rejection messages are not judged (no error_contains).`,
      limits: [
        "Only the verdict is judged: the tier and effective mode in each case are derived for the reader (DCP-AI-v2.0.md § 14.2, VERIFICATION.md V2-9) and are not compared with any resolved tier or mode an implementation reports.",
        "A classical list or advisory exclusion under pq_only is left out pending an interpretation (question Q1 of the corpus): no expectation, not run. The other questions of the corpus record coverage not built here.",
      ],
    },
    "external.v2.structural": {
      claim: "Under the corpus verifier_policy at its verification_time (effective mode hybrid_preferred), the base and the positives of tests/interop/v2/structural_vectors.json verify, and every case is rejected (verified false): a non-canonical sig_b64 of an artifact or checkpoint with its bytes unchanged (V2-5), a checkpoint without PQ, with an invalid classical component under a valid PQ one, or with an event_range that is backwards or names an absent audit_id (V2-12), audit_count, passport_hash or policy_hash off in a validly signed manifest, a payload fraction (V2-3), session_issued_at after session_expires_at (V2-4), and an invalid bundle classical signature under a valid PQ one (V2-6). Each negative counts only if the base, and its twin where named, passed in the same run. Rejection messages are not judged (no error_contains).",
      limits: [
        "Only the verdict is judged. The corpus and its SDK-free checks show the violation each bundle is built to carry; they show neither which check of an implementation rejected it nor an exhaustive list of its defects (for the payload fraction the integrity layer stops at canonicalization). No wording, tier, mode or signer_keys output is compared (deferred, D2).",
        "The payload fraction cannot be signed under dcp-jcs-v1, so its stale hashes and signatures also reject it; the corpus records this and the other isolation limits.",
      ],
    },
    "external.v2.secondary_sha3": {
      claim: `At the committed verification_time and under default_verifier_policy, the accepted cases verify, every committed control verifies, and every rejected case is rejected (verified false), counted only if its control passed. ${NOT_JUDGED}`,
      limits: ["Present secondary fields are checked; absent ones are not required, so a pass does not show a complete secondary chain."],
    },
  },
};

// Why the wording of a case was not evaluated: only a well-formed rejection with the expected verdict and every
// control passed is.
function notEvaluatedReason(outcome, results, fatal) {
  if (fatal) return "run_error";
  if (outcome.kind === "discrepancy") return results[0]?.status === "rejected" ? "rejected" : "wrong_verdict";
  return outcome.kind;
}

function wordingDiagnostic(c, outcome, results, fatal) {
  if (outcome.status !== "pass") return { wording: "not_evaluated", reason: notEvaluatedReason(outcome, results, fatal), expected_wording: c.expect.error_contains };
  const errors = results[0].errors;
  const wording = errors.length === 0 ? "no_message" : errors.join("\n").toLowerCase().includes(c.expect.error_contains.toLowerCase()) ? "matched" : "differs";
  return { wording, expected_wording: c.expect.error_contains };
}

function judge(c, results, assessment = "legacy") {
  if (results.length === 0) return { status: "error", kind: "missing", message: "no result for this case" };
  if (results.length > 1) return { status: "error", kind: "duplicate", message: `${results.length} results for this case` };
  const r = results[0];
  if (r.status === "error") return exactKeys(r, ["id", "status", "message"]) && typeof r.message === "string" ? { status: "error", kind: "implementation", message: r.message.slice(0, 500) } : { status: "error", kind: "malformed_result", message: "error needs a message" };
  if (r.status === "unsupported") return exactKeys(r, ["id", "status"]) ? { status: "error", kind: "unsupported", message: `${c.op} is not supported by the implementation` } : { status: "error", kind: "malformed_result", message: "unsupported takes no other field" };
  if (r.status === "rejected") {
    // missing_pq_signature: an SDK whose composite verification reports an absent PQ signature under a
    // pq_over_classical binding as an error (Rust, WASM). It passes only on the case built for it (DR2).
    const codes = c.op === "composite_verify" ? ["parse", "missing_pq_signature"] : ["parse"];
    if (!exactKeys(r, ["id", "status", "code"]) || !codes.includes(r.code)) return { status: "error", kind: "malformed_result", message: `a rejection of ${c.op} is code ${codes.join(" or ")}` };
    if (r.code === "missing_pq_signature") {
      return c.expect.missing_pq_rejection_allowed ? { status: "pass", detail: "rejected (missing_pq_signature)" }
        : { status: "fail", kind: "discrepancy", message: "rejected as missing_pq_signature a case that is not a stripped PQ signature" };
    }
    return { status: "fail", kind: "discrepancy", message: "rejected a committed input as unparseable" };
  }
  if (r.status !== "ok" || !exactKeys(r, ["id", "status", ...RESULT_FIELDS[c.op]])) return { status: "error", kind: "malformed_result", message: `result fields do not match ${c.op}` };
  if (c.op === "dual_merkle_root") {
    if (!isHex64(r.sha256) || !isHex64(r.sha3_256)) return { status: "error", kind: "malformed_result", message: "roots must be 64 lowercase hex characters" };
    return r.sha256 === c.expect.roots.sha256 && r.sha3_256 === c.expect.roots.sha3_256 ? { status: "pass" } : { status: "fail", kind: "discrepancy", message: `got ${r.sha256} / ${r.sha3_256}` };
  }
  if (c.op === "composite_verify") {
    const types = ["valid", "classical_valid", "pq_valid"].every((f) => typeof r[f] === "boolean" || (f === "pq_valid" && r[f] === null));
    if (!types) return { status: "error", kind: "malformed_result", message: "valid and classical_valid are booleans, pq_valid a boolean or null" };
    const wrong = Object.entries(c.expect).filter(([f]) => f !== "missing_pq_rejection_allowed").filter(([f, v]) => r[f] !== v).map(([f, v]) => `${f}=${r[f]}, expected ${v}`);
    return wrong.length ? { status: "fail", kind: "discrepancy", message: wrong.join("; ") } : { status: "pass" };
  }
  if (typeof r.verified !== "boolean" || !Array.isArray(r.errors) || !r.errors.every((e) => typeof e === "string")) return { status: "error", kind: "malformed_result", message: "verified is a boolean and errors an array of strings" };
  if (r.verified && r.errors.length > 0) return { status: "error", kind: "contradictory_result", message: `verified=true with errors: ${JSON.stringify(r.errors).slice(0, 300)}` };
  if (r.verified !== c.expect.verified) return { status: "fail", kind: "discrepancy", message: `verified=${r.verified}, expected ${c.expect.verified}: ${JSON.stringify(r.errors).slice(0, 300)}` };
  if (assessment === "legacy" && c.expect.error_contains && !r.errors.join("\n").toLowerCase().includes(c.expect.error_contains.toLowerCase())) {
    return { status: "fail", kind: "discrepancy", message: `no error contains ${JSON.stringify(c.expect.error_contains)}: ${JSON.stringify(r.errors).slice(0, 300)}` };
  }
  return { status: "pass" };
}

/** Runs the evidence plan against argv and returns the report (status pass, fail or error). */
export async function runEvidence({ plan, argv, timeoutMs = EVIDENCE_TIMEOUT_MS, run = { id: crypto.randomUUID(), started_at: new Date().toISOString() }, assessment = "legacy" }) {
  if (!ASSESSMENTS.includes(assessment)) throw new UsageError(`unknown assessment ${assessment}`);
  if (assessment === "verdict") assertVerdictPlan(plan);
  const nonce = crypto.randomBytes(16).toString("hex");
  const sent = [];
  for (const s of plan.suites) for (const c of s.cases) sent.push({ wire: crypto.randomBytes(8).toString("hex"), c, suite: s.id });
  const request = { contract: EVIDENCE_CONTRACT, run_id: run.id, nonce, cases: sent.map(({ wire, c }) => ({ id: wire, op: c.op, ...c.request })) };
  const requestBytes = Buffer.from(JSON.stringify(request), "utf8");
  const { stdout, observed } = await runProcess(argv, requestBytes, { timeoutMs, limits: LIMITS });
  let fatal = runLevel(observed);
  let implementation = null;
  const byWire = new Map(sent.map((x) => [x.wire, []]));
  let extra = 0;
  if (!fatal) {
    const parsed = parseResponse(stdout, request);
    implementation = parsed.implementation ?? parsed.doc?.implementation ?? null;
    if (parsed.error) fatal = parsed.error;
    else for (const r of parsed.doc.results) { if (isObj(r) && typeof r.id === "string" && byWire.has(r.id)) byWire.get(r.id).push(r); else extra++; }
  }
  const outcome = new Map(sent.map(({ wire, c }) => [c.id, fatal ? { status: "error", ...fatal } : judge(c, byWire.get(wire), assessment)]));
  // A negative counts only if its control passed in the same run.
  for (const { c } of sent) {
    const failed = (c.controls ?? []).filter((k) => outcome.get(k)?.status !== "pass");
    if (failed.length && outcome.get(c.id).status !== "error") {
      outcome.set(c.id, { status: "error", kind: "control_failed", message: `control(s) did not pass: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? ", …" : ""}` });
    }
  }
  const verdict = assessment === "verdict";
  const diagnostic = new Map(verdict ? sent.filter(({ c }) => isWordingCase(c)).map(({ wire, c }) => [c.id, wordingDiagnostic(c, outcome.get(c.id), byWire.get(wire) ?? [], fatal)]) : []);
  const report = {
    kit: { name: "dcp-ai-conformance-external", contract: EVIDENCE_CONTRACT, catalog_version: plan.catalog.version, catalog_sha256: plan.catalog.sha256, fixtures_sha256: plan.fixtures },
    run: { id: run.id, nonce, started_at: run.started_at, finished_at: new Date().toISOString(), node: process.version, request_sha256: sha256(requestBytes), timeout_ms: timeoutMs },
    implementation: { argv, self_declared: implementation, observed },
    selection: plan.suites.map((s) => s.id),
    status: "incomplete",
    totals: { cases: 0, executed: 0, pass: 0, fail: 0, error: 0 },
    suites: [],
    limits: plan.catalog.limits,
  };
  for (const s of plan.suites) {
    const cases = sent.filter((x) => x.suite === s.id).map(({ c }) => ({
      id: c.id, op: c.op, source: c.source, input_sha256: sha256(Buffer.from(JSON.stringify(c.request), "utf8")),
      ...(c.controls ? { controls: c.controls } : {}),
      // Under verdict, a case judged on its verdict alone states that expectation, its anchor and its diagnostic.
      ...(diagnostic.has(c.id) ? { expect: { verified: false }, anchor: anchorOf(c), ...outcome.get(c.id), diagnostic: diagnostic.get(c.id) } : { expect: c.expect, ...outcome.get(c.id) }),
    }));
    if (!fatal && extra > 0) cases.push({ id: `${s.id}#extra`, status: "error", kind: "extra", message: `${extra} result(s) with an id that was not sent` });
    const totals = { cases: cases.length, executed: 0, pass: 0, fail: 0, error: 0 };
    for (const r of cases) { totals[r.status]++; if (r.status !== "error") totals.executed++; }
    const status = totals.error ? "error" : totals.fail ? "fail" : "pass";
    const text = VERDICT_TEXT.suites[s.id];
    report.suites.push(verdict
      ? { id: s.id, title: s.title, claim: text.claim, limits: text.limits, catalog_claim: s.claim, catalog_limits: s.limits, status, totals, cases }
      : { id: s.id, title: s.title, claim: s.claim, limits: s.limits, status, totals, cases });
    for (const k of Object.keys(totals)) report.totals[k] += totals[k];
  }
  report.status = report.totals.error || report.totals.executed === 0 ? "error" : report.totals.fail ? "fail" : "pass";
  if (!verdict) return report;
  // A verdict report: the same fields in the same order, plus the assessment, the diagnostic totals and the verbatim
  // catalog limits. The diagnostics of a run whose status is not pass are partial detail, never conformance.
  const diagnostic_totals = { matched: 0, differs: 0, no_message: 0, not_evaluated: 0 };
  for (const d of diagnostic.values()) diagnostic_totals[d.wording]++;
  const { limits: _catalogLimits, ...rest } = report;
  return {
    ...rest,
    assessment: {
      schema: ASSESSMENT_SCHEMA, mode: "verdict", basis: "spec/VERIFICATION.md V2-1 to V2-14",
      wording: "diagnostic, not judged", wording_cases: diagnostic.size,
      premises: ["every case judged on its verdict has a normative anchor", "every control is a plain positive: expect verified or valid true, no error_contains, no controls (checked at load)"],
      conformance: "only status pass (exit 0) means every selected case passed; per-case diagnostics in a run with status fail or error are partial detail",
    },
    diagnostic_totals,
    limits: VERDICT_TEXT.limits,
    catalog_limits: plan.catalog.limits,
  };
}

/** The ids each builder produces from the committed fixtures, to write expected_cases into the catalog. */
export function producedIds(root = REPO_ROOT) {
  const all = { ...FIXTURES, ...Object.assign({}, ...Object.values(SUITE_FIXTURES)) };
  const docs = Object.fromEntries(Object.entries(all).map(([k, rel]) => [k, JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"))]));
  return Object.fromEntries(Object.entries(BUILDERS).map(([id, b]) => [id, b(docs).map((c) => c.id)]));
}
