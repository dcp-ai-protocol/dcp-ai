#!/usr/bin/env node
// Builds tools/conformance/external-effective-policy-catalog.json (contract dcp-ai-conformance-external/5) from the
// committed fixtures. The observational cases are the verifier-policy cases whose bundle fails the kit's reference
// V2-2 schema validation (tools/conformance/schema-boundary.js) on the committed bytes: a verifier rejects them at
// V2-2, before any mode or tier is resolved, so the kit observes what is reported there instead of requiring it.
// The expected mode and tier of the pre-resolution control, the committed signed bundle of bundle_vectors.json under
// its default_verifier_policy, are written by hand from spec/DCP-AI-v2.0.md § 14.2 / § 14.3, and its fields are
// checked here. Usage: node tools/conformance/effective-policy-catalog.mjs [--check]
//   --check compares the built catalog with the committed file and exits 1 on any difference.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { EFFECTIVE_CATALOG_PATH, EFFECTIVE_CONTRACT, SUITES, producedEffectiveCases } from "./external-effective.js";
import { schema } from "./schema-boundary.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const fail = (m) => { throw new Error(m); };

const CONTROL_EFFECTIVE = {
  verification_mode: "hybrid_preferred", resolved_tier: "standard",
  basis: "bundle_vectors.json signed_bundle: intent send_email, estimated_impact medium, data_classes [contact_info], policy_decision risk_score 450, so tier standard (§ 14.2: score 200..499 or impact medium); passport risk_tier medium, whose default_verifier_policy override is hybrid_preferred, equal to the standard floor (V2-9).",
};

export function buildEffectiveCatalog(root = ROOT) {
  const bundles = JSON.parse(fs.readFileSync(path.join(root, "tests/interop/v2/bundle_vectors.json"), "utf8"));
  const b = bundles.signed_bundle.bundle;
  const i = b.intent.payload; const d = b.policy_decision.payload;
  if (!(i.action_type === "send_email" && i.estimated_impact === "medium" && JSON.stringify(i.data_classes) === '["contact_info"]' && (i.security_tier ?? null) === null &&
    d.risk_score === 450 && b.agent_passport.payload.risk_tier === "medium" && bundles.default_verifier_policy.risk_overrides.medium === "hybrid_preferred")) {
    fail("the pre-resolution control no longer has the fields its handwritten expectation describes");
  }
  const produced = producedEffectiveCases(root, [{ id: SUITES.pre, control_effective: CONTROL_EFFECTIVE }]);
  const decode = (c) => JSON.parse(Buffer.from(c.request.bundle_b64, "base64").toString("utf8"));
  const observational = (id) => produced[id].filter((c) => !schema(decode(c)).valid).map((c) => c.id);
  const obsPolicy = observational(SUITES.policy);
  const obsClar = observational(SUITES.clarification);
  if (obsPolicy.length + obsClar.length !== 14) fail(`expected 14 observational cases, found ${obsPolicy.length + obsClar.length}`);
  for (const id of [...obsPolicy, ...obsClar]) if ([...produced[SUITES.policy], ...produced[SUITES.clarification]].find((c) => c.id === id).expect.verified !== false) fail(`${id}: observational but expected to verify`);
  const ids = (id) => produced[id].map((c) => c.id);
  const counts = Object.fromEntries(Object.entries(produced).map(([k, v]) => [k, v.length]));
  const want = { [SUITES.policy]: 74, [SUITES.clarification]: 34, [SUITES.coverage]: 17, [SUITES.pre]: 5 };
  if (JSON.stringify(counts) !== JSON.stringify(want)) fail(`unexpected case counts ${JSON.stringify(counts)}`);
  const OBS_BASIS = "These bundles fail the reference V2-2 schema validation of the committed bytes (a passport risk_tier or an intent action_type, estimated_impact or security_tier outside its enumeration), so a verifier rejects them before resolving a mode or tier. The verdict is judged; a mode and tier left unresolved are observed, not required; reported values must still be known, consistent and those expected.";
  const NOT_SDK = "Only what the implementation reports from its own verification is judged: the kit never recomputes a mode or tier, and a reported mode or tier on a rejected bundle is a diagnostic, not admission or authorization.";
  return {
    contract: EFFECTIVE_CONTRACT,
    catalog_version: "2026-11-07.effective-policy-1.0 (opt-in)",
    suites: [
      { id: SUITES.policy, title: "Effective mode and tier: verifier_policy_vectors.json (V2-7, V2-9, V2-10, V2-12)",
        claim: `Each case of tests/interop/v2/verifier_policy_vectors.json under its exact policy and verification_time: the verdict of the verifier-policy catalog, and the verification mode and security tier the implementation resolved, equal to the case's effective_mode and tier. ${NOT_SDK}`,
        expected_cases: ids(SUITES.policy), observational_cases: obsPolicy, observational_basis: OBS_BASIS },
      { id: SUITES.clarification, title: "Effective mode and tier: verifier_policy_clarification_vectors.json (V2-10 clarification, Q1 to Q3)",
        claim: `Each case of tests/interop/v2/verifier_policy_clarification_vectors.json under its exact policy and verification_time: the verdict of the clarification suite, and the resolved verification mode and security tier, equal to the case's effective_mode and its bundle's tier (a variant re-signs a signature only and keeps its base's tier). ${NOT_SDK}`,
        expected_cases: ids(SUITES.clarification), ...(obsClar.length ? { observational_cases: obsClar, observational_basis: OBS_BASIS } : {}) },
      { id: SUITES.coverage, title: "Effective mode and tier: effective_policy_vectors.json (four tiers, four modes, overrides, risk_score, floors)",
        claim: `Each case of tests/interop/v2/effective_policy_vectors.json: valid signed positives at the elevated and maximum tiers under each requested mode, the risk_score boundaries 200, 500, 799 and 800, an explicit security_tier that raises and a declared one that does not lower, and passport risk_tier overrides of the base policy that replace its default (one lower, one higher) before the tier floor applies; one classical-only bundle rejected for the mode its override sets. The verdict and the resolved mode and tier are judged. ${NOT_SDK}`,
        expected_cases: ids(SUITES.coverage) },
      { id: SUITES.pre, title: "Pre-resolution observations: bundle_vectors.json (V2-1, V2-3, V2-4)",
        claim: `Four committed mutations of the bundle_vectors.json signed bundle, rejected at V2-1, V2-3 or V2-4, under its default_verifier_policy at 2026-10-22T00:00:00Z, and that bundle as their control. The control's verdict, mode and tier are judged; for the four rejections the verdict is judged and the reported mode and tier are observed: implementations differ on whether they resolve them after an earlier failure, and both are allowed. ${NOT_SDK}`,
        expected_cases: ids(SUITES.pre), pre_resolution_cases: ids(SUITES.pre).filter((id) => !id.endsWith(".signed_bundle")), control_effective: CONTROL_EFFECTIVE },
    ],
    limits: [
      "Opt-in: the default catalog (/1), the evidence (/2), admission (/3) and delegation (/4) catalogs, the verifier-policy, structural, schema and schema-validation catalogs and their reports are unchanged.",
      "A pass shows that the argv that was run reports these verdicts and these resolved modes and tiers for these 130 cases under these policies; it is not complete V2 conformance.",
      "Not covered: the DCP-09 delegation-chain tier floor (spec/DCP-AI-v2.0.md § 14.2: no bundle field carries the chain), the @dcp-ai/wasm JavaScript API (DcpClient) and browsers.",
      "Implementations report the fields their API exposes: an unresolved mode or tier may be absent, null or an empty string, and each is reported as it is; none counts as resolved.",
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = JSON.stringify(buildEffectiveCatalog(), null, 2) + "\n";
  if (process.argv[2] === "--check") {
    const same = fs.existsSync(EFFECTIVE_CATALOG_PATH) && fs.readFileSync(EFFECTIVE_CATALOG_PATH, "utf8") === built;
    console.log(same ? "catalog up to date" : "catalog differs from the fixtures");
    process.exitCode = same ? 0 : 1;
  } else {
    fs.writeFileSync(EFFECTIVE_CATALOG_PATH, built);
    console.log(`wrote ${EFFECTIVE_CATALOG_PATH}`);
  }
}
