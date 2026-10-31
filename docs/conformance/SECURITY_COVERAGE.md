<sub>**English** · [中文](../../i18n/zh-CN/docs/conformance/SECURITY_COVERAGE.md) · [Español](../../i18n/es/docs/conformance/SECURITY_COVERAGE.md) · [日本語](../../i18n/ja/docs/conformance/SECURITY_COVERAGE.md) · [Português](../../i18n/pt-BR/docs/conformance/SECURITY_COVERAGE.md)</sub>

# Security guarantees and conformance coverage

This is an informative map of the normative requirements to the repository's executable tests. It is not a new profile, a certification, a claim that every input has been tested, or evidence that a particular deployment passed. A test result applies to the exact implementation, inputs, policy, verification time and tool version recorded in that run.

The [verification checklist](../../spec/VERIFICATION.md), [canonicalization profile](../../spec/CANONICALIZATION_PROFILE.md) and [admission profile](../../spec/profiles/admission/README.md) remain authoritative. A reference implementation and the test kit can both contain defects. Resolve discrepancies against the specification and a reproducible case; agreement between implementations does not decide correctness.

## What the guarantees mean

| Layer | What its checks establish | What they do not establish |
|---|---|---|
| Schema | The input has the permitted structure and field values | Valid signatures, honest claims, principal identity or authorization |
| Cryptographic verification | The checked signatures, hashes and relationships satisfy the applicable rules for the supplied keys, policy and time | That the named principal is trusted, that a recorded event occurred, or that a tool may run |
| Principal trust | Verified principal signature components match the operator's out-of-band trust set | Identity beyond that trust source or permission to perform an action |
| `strict-v1` admission | Verification, principal trust, signed audience/session constraints and sufficiently fresh revocation status satisfy the profile | Single use, revocation newer than the snapshot, or action authorization |
| Adapter enforcement | The integration applies the operator's admission decision before its protected handler | A property supplied by the core protocol or established by the external conformance kit |

`action_authorized` remains `false`. A verified or admitted record of a blocked or escalated action is evidence of that recorded decision, not permission to execute it. Session binding prevents splicing of inconsistent sessions; it does not consume a bundle or make it single-use.

## Reading the evidence

The [kit README](../../tools/conformance/README.md) defines the commands, contracts, report fields and exit codes. Its surfaces are different:

- **Reference:** `tools/conformance.js` calls reference helpers and `lib/verify.js`; the latter schema-validates V2 input and delegates cryptographic verification to TypeScript.
- **External primitives:** contract `/1` exercises canonicalization and digests through a supplied implementation.
- **External evidence:** contract `/2` exercises Merkle roots, composite signatures and V2 bundle verification. The repository supplies TypeScript, Python, Go, Rust and WASM wrappers.
- **External admission:** contract `/3` exercises combined admission and configuration loading. The repository supplies TypeScript, Python, Go and Rust wrappers; WASM has no admission API.
- **SDK and adapter suites:** separate tests, with their own entry points and scopes. An item in the kit's inventory is not a test executed by that kit.

The numbered contracts are runner interfaces, not versions of the DCP protocol. Wrapper identity is self-declared. Five wrappers are not five independent external adopters: WASM shares Rust code, and all these wrappers belong to this repository.

A negative result is useful only with a working positive control. Altering signed content without updating its signature can make a test fail for several reasons. A `spec_step` label or a matching error message alone does not prove that one particular check caused rejection. Cases with an isolated valid/invalid pair provide stronger evidence than separately built rejected bundles with only a suite-level positive control.

## V2 verification map

The case names below refer to [bundle vectors](../../tests/interop/v2/bundle_vectors.json). `M`, `R` and `A` mean `must_reject`, `must_reject_bundles` and `must_accept_bundles`; the external IDs have the prefix `external.v2.bundle_vectors.` followed by `must_reject`, `must_reject_bundles` or `must_accept`, respectively, then the case name. `signed_bundle` is the base positive. These are selected traceable samples, not an exhaustive list or a completeness rating.

| Normative rule | Selected existing cases or suite | Scope and remaining limits |
|---|---|---|
| V2-1: select the version | M `dcp_bundle_version_1_0`, `dcp_bundle_version_3_0` | V2 entry-point rejection; does not exercise all V1 requirements |
| V2-2: validate envelope and artifact schemas | Reference `v2.signed_bundle.schema_invalid_payload_rejected`; schema suites | The external SDK-verifier operation is not a complete schema gate; see the boundary below |
| V2-3: manifest, payload hashes and audit binding | M `intent_payload_hash_wrong`, `audit_entries_truncated`; R `manifest_intent_hash_mismatch`, `audit_chain_hash_wrong`; A `empty_audit_trail` | Samples of hash/chain binding; not isolated coverage of every field and malformed shape |
| V2-4: session, time and unsigned metadata consistency | R `intent_session_nonce_differs`, `session_expired_with_offset`, `session_longer_than_policy_max_with_late_created_at`; M `signature_signer_id_other`; A `session_duration_at_millisecond_precision` | Fixed-time tests; requested policy and effective mode must be distinguished |
| V2-5: signature structure and canonical encoding | M `bundle_classical_sig_b64_with_trailing_bits`, `intent_classical_sig_b64_unpadded`; R `classical_only_bundle_signature_without_pq` | Encoding samples do not cover every signature location and defect combination |
| V2-6: principal signs the manifest | R `bundle_signed_by_agent_keys`; reference `v2.signed_bundle.forged_classical_signature_rejected` | Role binding and signature samples; does not establish trust in a self-declared principal |
| V2-7: verify present PQ signatures | M `bundle_pq_signature_invalid`, `bundle_pq_slot_holds_ed25519` | The legacy evidence catalog exercises these under its selected policy; claiming all effective modes requires corresponding controls |
| V2-8: verify each artifact with its context and signer role | M `rpr_classical_signature_invalid`, `intent_signed_by_principal`, `policy_decision_signed_under_intent_context` | Samples of artifacts and roles; not every combination of component, context and key |
| V2-9: derive tier without allowing a declaration to lower it | R `classical_only_intent_action_type_constructor`, `classical_only_intent_security_tier_constructor` | Verdict samples; the external bundle operation does not assess the reported resolved tier |
| V2-10: enforce effective mode and algorithm policy | R `classical_only_payment_from_low_risk_passport`; `classical_only_routine` in four modes | Mode samples; the legacy evidence catalog has no dedicated algorithm allowlist/advisory matrix |
| V2-11: verify secondary fields when present | `external.v2.secondary_sha3`, from [secondary vectors](../../tests/interop/v2/secondary_sha3_vectors.json) | Positive controls and malformed/mismatching fields; absent links are optional, so acceptance does not imply a complete secondary chain |
| V2-12: bind and verify checkpoints | A `pq_checkpoint_over_the_trail`; R `pq_checkpoint_listed_but_missing`, `pq_checkpoint_event_range_count_wrong`, `pq_checkpoint_pq_signature_invalid` | Samples of membership, range and signatures; not every malformed range or component combination |
| V2-13: derive key IDs and enforce key validity | R `passport_key_kid_not_derived`, `passport_key_public_key_with_trailing_bits`, `rpr_binding_key_revoked` | Key/encoding/status samples; not exhaustive key-policy coverage |
| V2-14: cross-artifact consistency | R `passport_principal_binding_reference_other`, `audit_entry_policy_decision_other`; A `blocked_action_recorded`, `escalated_action_recorded` | Evidence consistency is distinct from permission to act |

The corpus's expectations must be interpreted with its declared policy, per-case overrides and verification time. A positive hybrid bundle can verify under `pq_only`; the presence of classical bytes needed for binding does not make it a negative control. A requested `classical_only` policy can resolve to a stricter effective mode because of the action's tier.

### Schema and cryptographic API boundary

V2-2 requires schema validation. The SDK cryptographic API and the reference schema-validating entry point are different surfaces. For example, adding an unknown property to the unsigned outer envelope can leave signatures intact: the schema closes that object with `additionalProperties: false`, while the TypeScript, Python, Go, Rust and WASM SDK verifier APIs alone can still return `verified: true`. This is a validation-boundary gap, not proof that signatures were forged or that a protected application admitted the input.

An implementer claiming the full V2 checklist must account for V2-2 as well as the cryptographic checks. Do not weaken the schema or describe a partial API as a complete gate to make a test pass. The kit must report these layers separately.

Unknown members are not universally forbidden. Some schema objects are open. Schema acceptance of an extension in a signed object does not preserve its old signature: hashes and signatures must be recomputed when signed content changes. No new required-extension mechanism is defined here.

The opt-in [schema diagnostic catalog](../../tools/conformance/external-schema-catalog.json) makes this boundary executable: its base and permitted extensions are positive controls; closed-object extensions and invalid enumeration values retain the normative rejection. A failing SDK case remains a failure. The separate `tools/conformance/schema-boundary.js` report distinguishes schema validation, integrity of the finite corpus, and schema-plus-SDK composition at the corpus time. That composition is not evidence that the SDK alone implements V2-2, and the integrity helper is not a general normative verifier.

### Verifier policy samples

The opt-in [policy catalog](../../tools/conformance/external-policy-catalog.json) adds 74 cases under the existing `/2` contract: 10 positive controls, 24 invalid-present-PQ cases, 14 algorithm-list/advisory cases and 26 committed tier cases. Each request carries its exact policy and verification time. The default evidence catalog remains unchanged.

The new routine hybrid control exercises effective `classical_only`, as well as the other three modes. The standard hybrid control raises a requested `classical_only` to `hybrid_preferred`. The corpus records this derivation; `/2` assesses the verdict, not the implementation's reported tier or effective mode.

The PQ negatives alter only the PQ signature at the bundle, passport or checkpoint; the classical component remains valid. Algorithm-list cases keep the same bundle and change only policy. Tier cases reuse separately signed committed bundles and a routine control under the same requested mode: they are not single-change twins. Every negative requires its positive control to pass in the same run.

Classical algorithm exclusions under `pq_only` remain omitted pending clarification, without an expected verdict. Deferred cases and interpretation questions are recorded in the corpus; an untested combination does not by itself demonstrate a contradiction in the specification. These samples do not close the schema gap or establish complete V2 conformance.

### Structural samples

The opt-in [structural catalog](../../tools/conformance/external-structural-catalog.json) adds 16 cases through `/2`: two positive controls and 14 negatives covering signature encoding, checkpoint components and ranges, manifest commitments, a fractional payload, session order and a bundle classical signature invalidated while its PQ signature is recomputed correctly. The effective mode is `hybrid_preferred`; these classical negatives make no claim about `pq_only`.

The four encoding cases preserve the decoded signature bytes. Checkpoint ranges use actual trail positions, with deliberately unsorted identifiers. Manifest mutations are signed again. A reversed session has a separate positive twin within the allowed clock skew. Every negative requires its controls to pass in the same run.

Isolation has explicit limits: a fraction has no `dcp-jcs-v1` representation, so its old hashes and signatures remain stale; a backwards range has no valid root for that range. Component checks document the intended defects but do not identify which SDK check caused rejection. These samples do not close the schema gap or prove complete conformance.

## Admission map

The [shared admission vectors](../../tests/interop/v2/admission_vectors.json) and [external admission catalog](../../tools/conformance/external-admission-catalog.json) exercise the following groups through the combined admission API and configuration loaders. Read the exact `rule`, inputs and expected fields in each case; the group name is not a proof of exhaustive coverage.

| Requirement | Exercised surface | Limit |
|---|---|---|
| T1–T2: principal and component keys anchored in operator trust | `external.admission.outcomes` | Trust is supplied out of band; the kit does not establish a real-world identity |
| P1–P4: V2, signed audience, signed session window and hybrid principal signatures | Outcomes and composed cases | Structural and verified checks are different; malformed-value combinations are not all enumerated |
| R1–R5: snapshot availability, shape, age and subject status | Outcomes | A fresh snapshot is not proof of revocation events after its `checked_at` |
| Configuration: reject unknown fields, malformed trust and profile weakening | `external.admission.config` | Multiple-defect cases may allow more than one normative error; incidental message wording is not the rule |
| Combined procedure and result | Outcomes and composed cases | `action_authorized:false`, recorded decisions and trust/profile results are assessed; complete `signer_keys` output is not directly compared |
| A1–A3: protected handler, operator configuration, sources, tenant and cache | Separate adapter tests | Outside this external kit; an SDK result does not prove integration enforcement |

An evaluator that accepts a precomputed verification result trusts its caller to supply the result for the same bundle, policy and time. The external admission operation uses the combined API. A passing combined test does not make an arbitrary caller-supplied verification object safe.

## Claims for core and profiles

| Surface | What can be reported from the kit | What must remain separate |
|---|---|---|
| Core data representation | Exact tested `dcp-jcs-v1` canonical bytes and digests | Untested inputs and the experimental candidate |
| V2 evidence verification | Results for selected bundle, Merkle and signature cases | Full V2 compliance, especially schema coverage, unless separately established |
| Crypto primitives | Tested domain separation, component verification and binding | Verifier policy, principal trust and admission |
| `strict-v1` admission | Results for the selected admission/configuration cases | Deployment enforcement and action authorization |
| V1 | Reference schema and integrity checks on committed fixtures | Independent third-party V1 conformance |
| A2A and governance | Only the specific rules actually exercised by a named suite | Complete functional conformance of either profile |
| DCP-05 to DCP-09 | The internal schema/wire suites' stated checks | Complete lifecycle, rights or delegation semantics |
| Experimental `dcp-jcs-v2` | Its separately selected experimental tests | Normative/default status; `dcp-jcs-v1` remains unchanged |

A subset result must name the subset and its limits. Do not turn `unsupported`, a missing case, a crash, a timeout or a skipped matrix into a passing case. A reserved SDK test that returns without running its matrix is not evidence that the matrix ran.

## Further validation

The [implementer guide](IMPLEMENTER_GUIDE.md) describes how to reproduce and report results independently. External implementation and independent security review are additional milestones; this repository's tests do not substitute for them.

Performance measurements use their own [documented harness](../../tools/conformance/README.md#performance-baseline). End-to-end timing does not attribute cost to a cryptographic primitive or prove the absence of early exits. Optimize only after measuring a specific cost and preserving verification decisions and compatibility.
