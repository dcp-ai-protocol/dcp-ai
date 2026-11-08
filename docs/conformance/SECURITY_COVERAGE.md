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
- **External delegation:** contract `/4` exercises DCP-09 §3.5.2 mandate chain verdicts. The repository supplies TypeScript, Python, Go and Rust wrappers; WASM has no mandate chain API.
- **External effective policy:** contract `/5` (opt-in) exercises V2 bundle verification with the verification mode and security tier the verifier resolved in that same verification. The repository supplies TypeScript, Python, Go, Rust and WASM wrappers.
- **SDK and adapter suites:** separate tests, with their own entry points and scopes. An item in the kit's inventory is not a test executed by that kit.

The numbered contracts are runner interfaces, not versions of the DCP protocol. Wrapper identity is self-declared. Five wrappers are not five independent external adopters: WASM shares Rust code, and all these wrappers belong to this repository.

A negative result is useful only with a working positive control. Altering signed content without updating its signature can make a test fail for several reasons. A `spec_step` label or a matching error message alone does not prove that one particular check caused rejection. Cases with an isolated valid/invalid pair provide stronger evidence than separately built rejected bundles with only a suite-level positive control.

## V2 verification map

The case names below refer to [bundle vectors](../../tests/interop/v2/bundle_vectors.json). `M`, `R` and `A` mean `must_reject`, `must_reject_bundles` and `must_accept_bundles`; the external IDs have the prefix `external.v2.bundle_vectors.` followed by `must_reject`, `must_reject_bundles` or `must_accept`, respectively, then the case name. `signed_bundle` is the base positive. These are selected traceable samples, not an exhaustive list or a completeness rating.

| Normative rule | Selected existing cases or suite | Scope and remaining limits |
|---|---|---|
| V2-1: select the version | M `dcp_bundle_version_1_0`, `dcp_bundle_version_3_0` | V2 entry-point rejection; does not exercise all V1 requirements |
| V2-2: validate envelope and artifact schemas | Reference `v2.signed_bundle.schema_invalid_payload_rejected`; schema suites; the opt-in schema-validation catalog (57 cases) | The SDK verifiers run V2-2 themselves from `@dcp-ai/sdk` 2.3.0, `@dcp-ai/wasm` 2.1.3, `dcp-ai` 2.10.2 (PyPI), Go v2.13.0 and Rust `dcp-ai` 2.13.0; earlier versions do not. See the boundary below |
| V2-3: manifest, payload hashes and audit binding | M `intent_payload_hash_wrong`, `audit_entries_truncated`; R `manifest_intent_hash_mismatch`, `audit_chain_hash_wrong`; A `empty_audit_trail` | Samples of hash/chain binding; not isolated coverage of every field and malformed shape |
| V2-4: session, time and unsigned metadata consistency | R `intent_session_nonce_differs`, `session_expired_with_offset`, `session_longer_than_policy_max_with_late_created_at`; M `signature_signer_id_other`; A `session_duration_at_millisecond_precision` | Fixed-time tests; requested policy and effective mode must be distinguished |
| V2-5: signature structure and canonical encoding | M `bundle_classical_sig_b64_with_trailing_bits`, `intent_classical_sig_b64_unpadded`; R `classical_only_bundle_signature_without_pq` | Encoding samples do not cover every signature location and defect combination |
| V2-6: principal signs the manifest | R `bundle_signed_by_agent_keys`; reference `v2.signed_bundle.forged_classical_signature_rejected` | Role binding and signature samples; does not establish trust in a self-declared principal |
| V2-7: verify present PQ signatures | M `bundle_pq_signature_invalid`, `bundle_pq_slot_holds_ed25519` | The legacy evidence catalog exercises these under its selected policy; claiming all effective modes requires corresponding controls |
| V2-8: verify each artifact with its context and signer role | M `rpr_classical_signature_invalid`, `intent_signed_by_principal`, `policy_decision_signed_under_intent_context` | Samples of artifacts and roles; not every combination of component, context and key |
| V2-9: derive tier without allowing a declaration to lower it | R `classical_only_intent_action_type_constructor`, `classical_only_intent_security_tier_constructor` | Verdict samples; the `/2` bundle operation does not assess the reported resolved tier; the `/5` effective-policy catalog does |
| V2-10: enforce effective mode and algorithm policy | R `classical_only_payment_from_low_risk_passport`; `classical_only_routine` in four modes | Mode samples; the legacy evidence catalog has no dedicated algorithm allowlist/advisory matrix |
| V2-11: verify secondary fields when present | `external.v2.secondary_sha3`, from [secondary vectors](../../tests/interop/v2/secondary_sha3_vectors.json) | Positive controls and malformed/mismatching fields; absent links are optional, so acceptance does not imply a complete secondary chain |
| V2-12: bind and verify checkpoints | A `pq_checkpoint_over_the_trail`; R `pq_checkpoint_listed_but_missing`, `pq_checkpoint_event_range_count_wrong`, `pq_checkpoint_pq_signature_invalid` | Samples of membership, range and signatures; not every malformed range or component combination |
| V2-13: derive key IDs and enforce key validity | R `passport_key_kid_not_derived`, `passport_key_public_key_with_trailing_bits`, `rpr_binding_key_revoked` | Key/encoding/status samples; not exhaustive key-policy coverage |
| V2-14: cross-artifact consistency | R `passport_principal_binding_reference_other`, `audit_entry_policy_decision_other`; A `blocked_action_recorded`, `escalated_action_recorded` | Evidence consistency is distinct from permission to act |

The corpus's expectations must be interpreted with its declared policy, per-case overrides and verification time. A positive hybrid bundle can verify under `pq_only`; the presence of classical bytes needed for binding does not make it a negative control. A requested `classical_only` policy can resolve to a stricter effective mode because of the action's tier.

### Schema and cryptographic API boundary

V2-2 requires schema validation. From `@dcp-ai/sdk` 2.3.0, `@dcp-ai/wasm` 2.1.3, `dcp-ai` 2.10.2, Go v2.13.0 and Rust `dcp-ai` 2.13.0, the V2 verifiers of the TypeScript, Python, Go, Rust and WASM SDKs run it themselves: `verifySignedBundleV2` and its counterparts, the combined admission API, which verifies first, and the experimental candidate verifier; evaluating admission from an earlier verification result does not run it again. Earlier SDK versions do not include it. The gate validates the signed bundle envelope and the four payloads (`responsible_principal_record`, `agent_passport`, `intent`, `policy_decision`) against `schemas/v2`. It runs after the verifier's policy and clock checks, and before the verifier checks the manifest, payload hashes, keys and signatures. Every SDK interprets the same representation generated from `schemas/v2` (`tools/schema-ir/`); CI regenerates it and compares the copies.

- **Closed and open objects.** An unknown member of a closed object (`additionalProperties: false`, for example the envelope, `SignedPayload`, `composite_sig`, audit entries and checkpoints) is rejected even when hashes and signatures stay valid. In an open object, such as the intent `target` or the audit `evidence`, the declared members keep their constraints (`target.channel`, for instance, is required and enumerated); only the additional members the schema does not describe are not inspected at this layer, and those under a commitment can reach canonicalization. An additional member of the `bundle` object itself is accepted: the schema leaves `bundle` open, the member is under no commitment (unlike the signed artifacts and manifest the bundle contains), and no later check reads it.
- **Missing and `null`.** A missing required member and a `null` where the schema expects another type are both rejected, with different diagnostics (`required`, `type`). The manifest's `session_issued_at` and `session_expires_at` must be strings when present: `null` is rejected.
- **Diagnostics.** A schema failure returns `verified: false` with errors of the form `schema: <JSON pointer> <keyword>[ <member>]`, at most 16 followed by `schema: further errors not listed`, never with input values and without cryptographic details. A rejection that a deeper check used to report can now carry a schema diagnostic instead; a schema failure does not show that the deeper check ran.
- **Candidate overlay.** On the experimental `dcp-jcs-v2` path, which a caller selects explicitly, the only difference is the manifest's `canonicalization_profile`, which must be `dcp-jcs-v2`. The default profile and the signed bytes are unchanged.
- **`date-time`.** The format check is the one the reference verifier applies, ajv-formats 3.0.1 in full mode, quirks included: any ECMAScript white space or `t` as the separator, `+hh` and `+hhmm` offsets, a second 60 when the time moved by its offset is 23:59. It is a compatibility boundary of the schema layer, not strict RFC 3339. The temporal parsers of V2-4, V2-13 and V2-14 remain a separate, later layer and can still reject a time the schema accepts.
- **Parsers come first.** What a JSON parser refuses never reaches V2-2. Go reports a root that is not an object as its historical parse error; the Rust API takes a parsed `serde_json::Value`, so serde_json's refusals (a lone surrogate, `1e400`) belong to the caller; the WASM binding keeps its policy parse error, `JSON parse error` and version dispatch before V2-2.
- **Acceptance change.** Schema-invalid bundles that the SDK verifiers accepted before now return `verified: false`. No schema-only API is added, and no schema or profile changes.

An implementer claiming the full V2 checklist must account for V2-2 as well as the cryptographic checks. Do not weaken the schema or describe a partial API as a complete gate to make a test pass. The kit reports these layers separately.

Unknown members are not universally forbidden. Some schema objects are open. Schema acceptance of an extension in a signed object does not preserve its old signature: hashes and signatures must be recomputed when signed content changes. No new required-extension mechanism is defined here.

The opt-in [schema-validation catalog](../../tools/conformance/external-schema-validation-catalog.json) runs 57 signed cases through an implementation: 13 positives, and 44 negatives that each count only when the base case verifies in the same run. CI runs it through the five SDK wrappers. The opt-in [schema diagnostic catalog](../../tools/conformance/external-schema-catalog.json) keeps 15 closure cases: its base and permitted extensions are positive controls; closed-object extensions and invalid enumeration values retain the normative rejection. A failing SDK case remains a failure, and a pass of either catalog covers its cases only. The separate `tools/conformance/schema-boundary.js` report distinguishes schema validation, integrity of the finite corpus, and schema-plus-SDK composition at the corpus time. That composition is not evidence that the SDK alone implements V2-2, and the integrity helper is not a general normative verifier.

### Verifier policy samples

The opt-in [policy catalog](../../tools/conformance/external-policy-catalog.json), version 2.0, adds 108 cases in two suites under the existing `/2` contract. The first suite keeps the 74 cases of version 1.1: 10 positive controls, 24 invalid-present-PQ cases, 14 algorithm-list/advisory cases and 26 committed tier cases. The second runs the 34 cases of the clarification of V2-10 (below). Each request carries its exact policy and verification time. The default evidence catalog remains unchanged, and version 1.1 is archived byte for byte as [`external-policy-catalog-1.1.json`](../../tools/conformance/external-policy-catalog-1.1.json).

The new routine hybrid control exercises effective `classical_only`, as well as the other three modes. The standard hybrid control raises a requested `classical_only` to `hybrid_preferred`. The corpus records this derivation; `/2` assesses the verdict, not the implementation's reported tier or effective mode. The opt-in effective-policy catalog (below) assesses them through contract `/5`.

The PQ negatives alter only the PQ signature at the bundle, passport or checkpoint; the classical component remains valid. Algorithm-list cases keep the same bundle and change only policy. Tier cases reuse separately signed committed bundles and a routine control under the same requested mode: they are not single-change twins. Every negative requires its positive control to pass in the same run.

The clarification of [VERIFICATION.md](../../spec/VERIFICATION.md) Step V2-10 (05/11/2026) settles the three questions of the corpus. [`verifier_policy_clarification_vectors.json`](../../tests/interop/v2/verifier_policy_clarification_vectors.json) holds their cases, with routine bases so that each requested mode is the effective one:

- **Q1.** Under `pq_only`, classical list and advisory exclusions accept a hybrid bundle; under `hybrid_required` the same policies reject it.
- **Q2.** At the bundle signature, the passport and the checkpoint, a classical component that fails while the PQ component verifies over those classical bytes is accepted under `pq_only` and rejected in the three other modes. A non-canonical classical `sig_b64` and an unknown classical kid are rejected under `pq_only`.
- **Q3.** PQ list and advisory exclusions accept the classical-only bundle under `classical_only` and `hybrid_preferred`, and reject the hybrid bundle under the same policy.

`verifier_policy_vectors.json` keeps its omitted Q1 cases as history. The cases sample these rules: they are not every location, algorithm or key state. An untested combination does not by itself demonstrate a contradiction in the specification. These are policy samples: schema validation (V2-2) has its own catalog and runs inside the SDK verifiers from the releases of 05/11/2026, not in earlier ones. The samples do not establish complete V2 conformance.

### Structural samples

The opt-in [structural catalog](../../tools/conformance/external-structural-catalog.json) adds 16 cases through `/2`: two positive controls and 14 negatives covering signature encoding, checkpoint components and ranges, manifest commitments, a fractional payload, session order and a bundle classical signature invalidated while its PQ signature is recomputed correctly. The effective mode is `hybrid_preferred`; these classical negatives make no claim about `pq_only`.

The four encoding cases preserve the decoded signature bytes. Checkpoint ranges use actual trail positions, with deliberately unsorted identifiers. Manifest mutations are signed again. A reversed session has a separate positive twin within the allowed clock skew. Every negative requires its controls to pass in the same run.

Isolation has explicit limits: a fraction has no `dcp-jcs-v1` representation, so its old hashes and signatures remain stale; a backwards range has no valid root for that range. Component checks document the intended defects but do not identify which SDK check caused rejection. These are structural samples: schema validation (V2-2) has its own catalog and runs inside the SDK verifiers from the releases of 05/11/2026, not in earlier ones. The samples do not prove complete conformance.

### Effective mode and tier

The opt-in [effective-policy catalog](../../tools/conformance/external-effective-policy-catalog.json) runs 130 cases through contract `/5`: the verdict, and the verification mode and security tier that the implementation's verifier resolved in that same verification, as returned and never recomputed by the kit. 112 cases require both values: the 94 verifier-policy and clarification cases whose bundles pass V2-2, 17 signed cases that add valid positives at the elevated and maximum tiers under every requested mode, `risk_score` boundaries, explicit and declared `security_tier` floors and passport overrides that replace the default, and one control. In 14 cases whose bundles fail V2-2, and in 4 earlier rejections, the values may be absent; values that are reported must still be known and consistent. The SDKs differ on whether they resolve the values after an earlier failure, and both are allowed. Controlled implementations show that the judge fails a wrapper that reports the requested or default mode, the tier floor alone, a declared tier or the policy decision's `resolved_tier`. The DCP-09 chain floor, the `@dcp-ai/wasm` JavaScript API and browsers are not covered, and a pass covers these cases only.

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

## Delegation map

The [external delegation catalog](../../tools/conformance/external-delegation-catalog.json), version 2.0.0, runs the committed [mandate chain](../../tests/interop/v2/mandate_chain_vectors.json), [chain time](../../tests/interop/v2/mandate_chain_time_vectors.json) and [repeated domain](../../tests/interop/v2/mandate_domain_vectors.json) vectors through `verify_mandate_chain`. Each normative case names its rule of [DCP-09 §3.5.2](../../spec/DCP-09.md); the verdict and, for an accepted chain, the effective tier are judged.

| Requirement | Exercised surface | Limit |
|---|---|---|
| Rules 1–2: root and sub-mandate signatures, signer roles and contexts, parent links, depth and `human_id` | `external.delegation.chain` | The keys are given in the request; the kit does not establish that they are the principal's or the agents' |
| Rule 3: sub-delegation permission and maximum depth | `external.delegation.chain` | The committed chains, not every depth |
| Rule 4: validity windows, their nesting and the verification time as RFC 3339 instants, compared in milliseconds | `external.delegation.chain`, `external.delegation.chain_time` | Millisecond precision is normative since the clarification of §3.5.2 (05/11/2026); version 1.0.0 of the catalog, archived, kept those three cases informative |
| Rules 1–2: each signer key active, its `expires_at` absent, `null` or not before the verification time (clarification of 05/11/2026) | `external.delegation.chain_time` | Seven cases on `expires_at`; no case has a key whose `status` is not `active`. Version 1.0.0 kept these seven informative |
| Rule 5: attenuation of actions, data classes and limits; limits within ±(2^53 − 1); a domain repeated in one mandate | `external.delegation.chain`, `external.delegation.domains` | Error texts are diagnostics; a rejection is judged on its verdict |
| Rule 6: tier floor and effective tier | `external.delegation.chain` | The effective tier is judged on accepted chains; `tier_floor` (`computeSecurityTier`) is outside the catalog |
| Rule 7: revocation of the root or an intermediate mandate | `external.delegation.chain` | Revocation is the local set of revoked ids in the request, not a revocation source |

A rejection counts only with its control, a normative accepted chain whose relation to it (`same_chain`, `single_mandate`, `same_shape` or `suite`) is checked on the bytes. None of these relations shows that the two cases differ by a single defect. A verified chain is not admission or authorization.

Version 1.0.0 of the catalog, archived byte for byte as [`external-delegation-catalog-1.0.0.json`](../../tools/conformance/external-delegation-catalog-1.0.0.json), judges 87 cases and reports ten informative ones apart; version 2.0.0 judges all 97. The runner pins the classification of each version, so a 1.0.0 report is evidence of 1.0.0 only.

### Differential samples

The [differential harnesses](../../tools/difffuzz/README.md) compare the SDKs on the same bytes; agreement is never the oracle.

- **Mandate chains.** `run-mandates.mjs` sends re-signed DCP-09 chains to the four chain verifiers through contract `/4`: every run covers 73 variants at every depth they apply to (167 cases), then bounded random mutants. Only cases anchored in §3.5.2, the canonicalization profile or RFC 8259 count as rule evidence. Observations and cases whose attribution is limited by an unsignable value or by number representation are reported apart; a disagreement among them is still a finding.
- **Bundles with WASM.** `run.mjs --sdks five` adds the Rust SDK compiled to WASM, run by Node, to the four bundle verifiers. Four-SDK findings are never read as five-SDK evidence.

A finite campaign shows these cases agree or records where they do not; it is not exhaustive. WASM verifies no mandate chain, and inputs that contract `/4` cannot carry to every SDK (a `NaN` token, a byte order mark, `1e400`) are measured by a separate transport probe: a wrapper's refusal is never counted as an SDK rejection, and the rejection the TypeScript and Python SDKs return for `1e400` credits no semantic rule.

## Local-source additions (07/11/2026)

These rows describe the local source of the TypeScript, Python, Go and Rust SDKs, not a published package. Each is
exercised by shared vectors that the four SDK suites run; the external kit has no contract for them yet, so a kit result
says nothing about these rules. None of them is a claim of complete conformance or of enterprise readiness.

**Optional surfaces.** Used only by code that calls them.

| Requirement | Exercised surface | Limit |
|---|---|---|
| Delegated admission ([admission profile § 10](../../spec/profiles/admission/README.md#10-delegated-admission-opt-in)) | [`delegated_admission_vectors.json`](../../tests/interop/v2/delegated_admission_vectors.json): 71 cases and 6 configuration cases | Checked at `now` only; `delegation_active` and `action_authorized` are `false`; no WASM API |
| Admission from bytes (§ 11) | [`v1_ingress_vectors.json`](../../tests/interop/v2/v1_ingress_vectors.json): 26 cases and 30 domain differences | Size and time budgets are out of scope; the functions on parsed values cannot recover what their parser lost |
| Mandate acknowledgment and activation ([DCP-09 § 3.3.1](../../spec/DCP-09.md#331-mandate-acknowledgment-opt-in), § 12) | [`mandate_acknowledgment_vectors.json`](../../tests/interop/v2/mandate_acknowledgment_vectors.json): 93 cases in TypeScript and Python; 89 in Go and Rust, which exclude explicitly the 4 cases whose containers are not lists, since their typed API cannot carry them | Signed declarations, not proof of chronology or of understanding; no authorization; no global replay check; no activation from bytes; no WASM API |

**Ed25519 verification (Crypto Profile).** Applies to every Ed25519 signature the SDK verifiers check.

| Requirement | Exercised surface | Limit |
|---|---|---|
| [P-ED-1](../../spec/profiles/crypto/README.md#p-ed-1-ed25519-acceptance-criterion) on V1 objects and the default V2 provider | [`ed25519_ped1_vectors.json`](../../tests/interop/v2/ed25519_ped1_vectors.json) and its checker, in the four SDK suites; the Rust provider run on `wasm32` | Since 08/11/2026, also the reference verifier, the CLI's V1 path and the playground, and WASM in Node and in Chrome: see [Public interfaces](#public-interfaces-mp-03-08112026), which lists who inherits it from an installed SDK. A custom provider is the operator's |

## Public interfaces (MP-03, 08/11/2026)

This section also describes local source, not published packages. For each capability it names the public function
the capability goes through, and the evidence that reaches it there.

- **WASM** is the `DcpWasm` class of `@dcp-ai/wasm`.
- **Raw** means its wasm-bindgen exports (`@dcp-ai/wasm/pkg`), run in Node.
- **Chrome** runs go through the kit's [browser wrapper](../../tools/conformance/README.md#browser-wrapper-dcpwasm-in-chrome).

| Capability | TypeScript, Python, Go, Rust | WASM | Not claimed |
|---|---|---|---|
| `dcp-jcs-v1` canonical bytes and digests | Kit `/1` (38) | `/1` raw (38). In Chrome, `/1` (38): canonicalization through `DcpWasm.canonicalize` after `JSON.parse`, digests through `dualHash` and `sha3_256` on the text | Bytes a parser has already changed (see the parsing table below) |
| V2 verification: bundles, Merkle roots, composite signatures | Kit `/2` (241: 211 bundle, 24 composite and 6 Merkle cases), policy (108), structural (16), schema (57), `/5` (130) | The same catalogs raw (552 cases; 590 with `/1`). In Chrome, each through its own `DcpWasm` method: bundles through `verifyBundle`, composite cases through `compositeVerify`, Merkle cases through `dualMerkleRoot` | Admission, trust, authorization |
| Composite signatures, domain separation, security tier | Kit `/2` composite cases (24); interop vectors in the SDK suites | Direct calls in Chrome (103): `domainSeparatedMessage` 20 (the 19 contexts of the interop vectors and `MandateAcknowledgment`), `computeSecurityTier` 79, 2 hybrid sign-verify round trips with payload, context and signature negatives, and the 2 P-ED-1 composite preimages | `/5` does not exercise `computeSecurityTier`: it reads the mode and tier `verifyBundle` reports |
| P-ED-1 | The corpus in the four SDK suites | The Rust provider on `wasm32` in Node: 67 provider cases, 4 V1 objects, and 2 composite cases with a real ML-DSA-65 key. In Chrome: the 2 composite preimages through `compositeVerify`, with a `classical_only` binding | The whole corpus through `DcpWasm`, which has no raw Ed25519 method |
| `strict-v1` admission | Kit `/3` (140) | Not supported | — |
| Mandate chains | Kit `/4` (97) | Not supported | — |
| Delegated admission, admission from bytes, activation | The SDK suites above, and the configuration errors of the bytes and activation functions | Not supported | A kit contract |

WASM has no mandate chain, admission or activation API. That is the scope of the pilot (D-04), not a limit of
browsers: a browser application's backend checks delegations and admits with one of the four SDKs. An admission
computed in a browser from inputs the client controls authorizes nothing on a server.

**P-ED-1 outside the SDKs.** A verifier that computes Ed25519 with TweetNaCl itself checks P-ED-1 first. It uses one of
three identical copies of a byte helper: `tools/`, `cli/lib/` and `playground/js/core/ed25519-ped1.js`. Every other
verifier gets P-ED-1 only from the SDK it loads.

| Verifier | Ed25519 path | P-ED-1 |
|---|---|---|
| Reference V1 (`tools/crypto.js` `verifyObject`): `lib/verify.js` and `bin/dcp.js` V1, transparency-log gossip, revocation service | Its own check, then TweetNaCl | In the source; `tools/ed25519-ped1-consumers.test.mjs` |
| `dcp-ai verify` on V1 files | Its own check (`cli/lib/ed25519-ped1.js`) | In the source; not in the published `@dcp-ai/cli` |
| `dcp-ai verify` on V2 files, reference V2, server | The installed `@dcp-ai/sdk` | Only with an SDK that has it. CI builds and installs the workspace SDK. No published `@dcp-ai/sdk` has it (2.3.0 and earlier), nor do copies installed from them |
| Playground (a demo whose PQ signatures are simulated) | Its own check | In the source |
| Express, OpenClaw | `@dcp-ai/sdk` locked at 2.2.0 | Not with the lock; CI also runs their tests on the workspace SDK |
| Anthropic MCP, Google A2A | `@dcp-ai/sdk` locked at 2.2.0 | Not applied (a recorded limit) |
| FastAPI, LangChain, OpenAI, CrewAI | The Python SDK of this tree | Applied |

**Errors, rejections and missing results.** Each public function keeps its own error contract; none is normalized.
P-ED-1 rejects only inputs that passed the earlier type, size and decoding checks of the function: what was an error
stays an error. In the kit and the browser harness, an `error`, `unsupported`, a missing case, a crash or a timeout
never satisfies an expected rejection.

| Function | Rejected | Error |
|---|---|---|
| Ed25519 provider, V1 `verifyObject` (SDKs, reference, CLI, playground) | `false`: S >= L, P-ED-1 or the equation | Each its own, and invalid base64 only where the function decodes base64 (the key of a provider, the signature and key of `verifyObject`). TypeScript and the reference verifier throw for invalid base64 and for a decoded signature or key of the wrong size; the playground's `verifyDetached` takes bytes and throws for a wrong size or a value that is not a `Uint8Array`. Python raises PyNaCl's `ValueError` for a wrong size. Go returns `false` for a wrong signature length and an error for a wrong key length. Rust returns errors for either length and for a key that does not decompress. The CLI exits 1 for INVALID and for errors, and 0 only for VALID |
| `compositeVerify` | `valid: false`, with the verdict of each component | A missing PQ signature under `pq_over_classical` is an error in Rust and through WASM; TypeScript, Python and Go return booleans |
| Bundle verification | `verified: false` with diagnostics, also for malformed input | WASM `verifyBundle` reports its own JSON and policy parse errors the same way |
| `strict-v1` admission (`admitSignedBundleV2`) | `admitted: false` and codes; `action_authorized` is always `false` | `AdmissionConfigError` (Go `*AdmissionConfigError`). An invalid profile, or a profile passed with a verifier policy, is refused before the bundle is verified. Where other configuration errors are found depends on the SDK: a profile without a trust set, for instance, during admission after the verification in TypeScript (`evaluateAdmissionV2`), before it in Rust. Either way, an error and no result |
| Delegated admission, activation | Delegated admission: `admitted: false` and codes. Activation: `composition` (the delegated admission's result), `activation`, `delegation_active` and the `ACK_*` codes. `action_authorized` is always `false` | `AdmissionConfigError` for an invalid operator configuration, raised before any evidence is read |
| Admission from bytes | The ingress rejection is a result: `ingress.accepted: false`, with its layer and class, and no admission | The ingress decides first, and accepted bytes are then admitted as by `admitSignedBundleV2`, with its configuration errors (Rust `IngressError::Config`). Input that is not bytes is a `TypeError` in TypeScript and Python |
| `DcpWasm` methods | As the binding reports | `Error('<method>: …')`. `canonicalize` reads the tagged `wasm_canonicalize_v2_result`; `hashObject` and `deriveKid` return only their hex format. The raw exports keep `{"error": …}` in band, and `wasm_canonicalize_v2` cannot tell it from a value whose canonical form is that object |

The tests behind this table:

- the P-ED-1 corpus tests of each SDK;
- `sdks/wasm/test/interface-errors.mjs` and `sdks/wasm/test/schema-v2.mjs`;
- the configuration-error tests `e5-config-errors.test.ts`, `test_e5_config_errors.py`, `e5_config_errors_test.go` and
  `tests/e5_config_errors.rs`.

**Who parses.** No function repairs input for another: each reads what its parser produced.

| Function | Parser | Checks before the parser |
|---|---|---|
| `verifySignedBundleV2`, `admitSignedBundleV2` and their Python and Rust counterparts | The caller's (`JSON.parse`, `json.loads`, `serde_json`) | None |
| Go `VerifySignedBundleV2At`, `AdmitSignedBundleV2` | The SDK's `encoding/json`, on `[]byte` | None: taking bytes is not the ingress of [admission § 11](../../spec/profiles/admission/README.md#11-admission-from-bytes-opt-in) |
| The `FromBytes` admission function of each SDK | The SDK | The ingress: scanner, portable domain, then the parser comparison, before admission |
| `DcpWasm` methods | The caller's `JSON.parse`, then `serde_json` on what `JSON.stringify` writes | None, and none is possible: the JavaScript value is already parsed |
| Raw WASM exports | `serde_json` on the text | None |
| `experimentalCandidateIngress` and its counterparts | The experimental candidate's own | Its scanner. It is not the ingress of § 11 and changes nothing in `dcp-jcs-v1` |

## Claims for core and profiles

| Surface | What can be reported from the kit | What must remain separate |
|---|---|---|
| Core data representation | Exact tested `dcp-jcs-v1` canonical bytes and digests | Untested inputs and the experimental candidate |
| V2 evidence verification | Results for selected bundle, Merkle and signature cases | Full V2 compliance, especially schema coverage, unless separately established |
| Crypto primitives | Tested domain separation, component verification and binding | Verifier policy, principal trust and admission |
| `strict-v1` admission | Results for the selected admission/configuration cases | Deployment enforcement and action authorization |
| V1 | Reference schema and integrity checks on committed fixtures | Independent third-party V1 conformance |
| A2A and governance | Only the specific rules actually exercised by a named suite | Complete functional conformance of either profile |
| DCP-05 to DCP-08 | The internal schema/wire suites' stated checks | Complete lifecycle, rights or other semantics of these documents |
| DCP-09 | The internal schema/wire suites' stated checks, and the verdicts of the selected mandate chain cases of the external delegation catalog | Complete delegation semantics, the validity helper, trust in the keys, admission or action authorization |
| Experimental `dcp-jcs-v2` | Its separately selected experimental tests | Normative/default status; `dcp-jcs-v1` remains unchanged |

A subset result must name the subset and its limits. Do not turn `unsupported`, a missing case, a crash, a timeout or a skipped matrix into a passing case. A reserved SDK test that returns without running its matrix is not evidence that the matrix ran.

## Further validation

The [audit dossier](AUDIT_DOSSIER.md) gives the review baseline, reproduction commands, artifact provenance and known limits. The [implementer guide](IMPLEMENTER_GUIDE.md) describes how to reproduce and report results independently. External implementation and independent security review are additional milestones; this repository's tests do not substitute for them.

Performance measurements use their own [documented harness](../../tools/conformance/README.md#performance-baseline). End-to-end timing does not attribute cost to a cryptographic primitive or prove the absence of early exits. Optimize only after measuring a specific cost and preserving verification decisions and compatibility.
