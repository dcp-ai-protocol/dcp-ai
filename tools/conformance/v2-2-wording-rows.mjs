// The 16 evidence-catalog rejections (external.v2.bundle_vectors) that V2-2 now decides first in every SDK
// (tests/interop/v2/schema_validation/regression_map.json), pinned here for the evidence self-tests. Each committed
// error_contains names the deeper check the row used to reach; the SDKs now report its schema diagnostic instead. So
// under --assessment legacy each is a wording discrepancy with the right verdict (verified false), never a pass, and
// under --assessment verdict each passes with its wording reported as "differs". The other 27 schema-first rows of the
// map still contain their error_contains token in the diagnostic. external-evidence-assessment.test.mjs derives this
// list from the map and checks it equals the pinned one.
export const V2_2_WORDING_ROWS = Object.freeze([
  "external.v2.bundle_vectors.must_reject.bundle_classical_sig_b64_with_a_newline",
  "external.v2.bundle_vectors.must_reject.bundle_classical_sig_b64_with_extra_padding",
  "external.v2.bundle_vectors.must_reject.bundle_classical_sig_b64_with_junk_after",
  "external.v2.bundle_vectors.must_reject.bundle_pq_sig_b64_with_a_newline",
  "external.v2.bundle_vectors.must_reject.intent_classical_sig_b64_with_a_newline",
  "external.v2.bundle_vectors.must_reject.intent_classical_sig_b64_with_extra_padding",
  "external.v2.bundle_vectors.must_reject.intent_classical_sig_b64_with_junk_after",
  "external.v2.bundle_vectors.must_reject_bundles.classical_only_bundle_signature_without_pq",
  "external.v2.bundle_vectors.must_reject_bundles.classical_only_intent_action_type_constructor",
  "external.v2.bundle_vectors.must_reject_bundles.classical_only_intent_estimated_impact_constructor",
  "external.v2.bundle_vectors.must_reject_bundles.classical_only_intent_security_tier_constructor",
  "external.v2.bundle_vectors.must_reject_bundles.classical_only_payment_from_passport_risk_tier_constructor",
  "external.v2.bundle_vectors.must_reject_bundles.classical_only_payment_from_passport_risk_tier_hasOwnProperty",
  "external.v2.bundle_vectors.must_reject_bundles.classical_only_payment_from_passport_risk_tier_proto",
  "external.v2.bundle_vectors.must_reject_bundles.classical_only_payment_from_passport_risk_tier_toString",
  "external.v2.bundle_vectors.must_reject_bundles.rpr_expires_at_impossible_date",
]);

/**
 * True when a legacy evidence report is exactly the V2-2 outcome: 225 passes and the 16 pinned rows as wording
 * discrepancies whose verdict was right ("no error contains", never "verified=..."); `scope` restricts both to the cases
 * of a selection. Returns a message when it is not.
 */
export function legacyV22Problem(report, scope = () => true) {
  const all = report.suites.flatMap((s) => s.cases).filter(scope);
  const failing = all.filter((c) => c.status !== "pass");
  const want = V2_2_WORDING_ROWS.filter((id) => all.some((c) => c.id === id));
  const ids = failing.map((c) => c.id).sort();
  if (JSON.stringify(ids) !== JSON.stringify([...want].sort())) return `failing ${JSON.stringify(ids)}, want ${JSON.stringify(want)}`;
  const wrong = failing.filter((c) => c.status !== "fail" || c.kind !== "discrepancy" || !String(c.message).startsWith("no error contains "));
  return wrong.length ? `not a wording discrepancy: ${JSON.stringify(wrong.map((c) => [c.id, c.status, c.kind, String(c.message).slice(0, 80)]))}` : null;
}
