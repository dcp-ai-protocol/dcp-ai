# Interop matrix: live agents across the four SDKs

`run.mjs` starts one **agent process per SDK** (TypeScript, Python, Go, Rust) and makes them
work with each other: an agent built on one SDK creates its identity, declares intents, acts and
signs its citizenship bundles; an agent built on another SDK verifies them, as it would before
trusting a counterparty. The processes share nothing but the messages the orchestrator relays,
so every pair (16 with four SDKs, each SDK against itself included) is a real interoperation, not
a comparison of files. A fifth, verify-only agent, `ref`, runs the reference verifier
`lib/verify.js` (what `npx dcp-ai verify` and the verification server run): it validates every
artifact against `schemas/v2` before the `@dcp-ai/sdk` verifier (the workspace SDK until 2.2.0 is
on npm), which the SDK
verifiers do not.

The orchestrator is also the network in between: it tampers with bundles in transit, and every
verifier must reject every tampered bundle the same way. Any unexpected verdict, crash or timeout
fails the run.

Scenario 1 (`run.mjs`) covers DCP-01 (identity), DCP-02 (intent and policy) and DCP-03 (audit).
Scenario 2 (`admission.mjs`) covers admission under the `strict-v1` profile
(`spec/profiles/admission`) across the four SDKs. The A2A handshake of DCP-04 needs SDK work first
(see the roadmap at the end).

## Run

```bash
npm install                                           # agents/ref: the reference verifier
cd sdks/typescript && npm install && npm run build   # agents/ts imports sdks/typescript/dist
pip install -e sdks/python                            # dependencies of agents/py
node tools/interop-matrix/run.mjs                     # all four SDKs and the reference verifier
node tools/interop-matrix/run.mjs --agents ts,py      # a subset
node tools/interop-matrix/admission.mjs               # scenario 2, the four SDKs, with its negative control
```

Go and a stable Rust toolchain must be on `PATH`; `run.mjs` builds `agents/go` and `agents/rust`.
Options: `--agents a,b` (any of `ts`, `py`, `go`, `rust`, `ref`), `--python PATH` (default `$INTEROP_PYTHON` or `python3`), `--timeout MS`
(per request, default 60000), `--out DIR` (default `tools/interop-matrix/out`, where the report
and every bundle that produced an unexpected verdict are written). `admission.mjs` takes the same
options except `ref` (default `--out tools/interop-matrix/out/admission`), plus
`--skip-negative-control`, `--negative-control`, `--check-negative-control` and `--replay FILE`
(below).

## The agent protocol

An agent reads one JSON request per line on stdin and writes exactly one JSON response line per
request on stdout, in order; anything else goes to stderr.

```json
{"id": 1, "cmd": "identity", "args": {"owner_name": "Interop Owner", "jurisdiction": "CL"}}
{"id": 1, "ok": true, "result": {"agent_id": "agent:…", "human_id": "rpr:…", "session_nonce": "…"}}
{"id": 2, "ok": false, "error": "message"}
```

An agent keeps its own state (keys, identity, intents, audit trails) in memory for the life of the
process. Keys never leave it. Every value below that the contract fixes must be produced exactly
as written; everything else is the SDK's own business, which is what the matrix tests (an
optional field an SDK adds on its own, such as Go's SHA3 `audit_merkle_root_secondary`, is fine
as long as every verifier accepts it).

### `identity` `{owner_name, jurisdiction}` → `{agent_id, human_id, session_nonce, principal_keys, agent_keys}`

Generates two composite key pairs (Ed25519 + ML-DSA-65): one for the human principal, one for the
agent; a new session nonce (64 hex); `human_id` = `rpr:<uuid4>` and `agent_id` = `agent:<uuid4>`.
Key entries: `{kid, alg, public_key_b64, created_at: <now RFC 3339>, expires_at: null, status: "active"}`.

- **RPR** (`schemas/v2/responsible_principal_record.schema.json`): `dcp_version "2.0"`, `human_id`,
  `session_nonce`, `legal_name` = `owner_name`, `entity_type "natural_person"`, `jurisdiction`,
  `liability_mode "owner_responsible"`, `override_rights true`, `issued_at` now, `expires_at null`,
  `contact null`, `binding_keys` = the two human key entries. A `SignedPayload` composite-signed
  (`pq_over_classical`) by the **human** keys under the `ResponsiblePrincipal` context.
- **Passport** (`agent_passport.schema.json`): `dcp_version "2.0"`, `agent_id`, `session_nonce`,
  `keys` = the two agent key entries, `principal_binding_reference` = `human_id`,
  `capabilities ["api_call", "payments"]`, `risk_tier "medium"`, `created_at` now,
  `status "active"`. Composite-signed by the **agent** keys under `AgentPassport`.

`principal_keys` and `agent_keys` are the public halves, `[{kid, alg, public_key_b64}]`, classical
first. Scenario 2 enrolls the principal from them, out of band.

A second `identity` replaces the first, and the intents and trails that went with it.

### `intent` `{action_type, channel, data_classes, estimated_impact, risk_score, applied_policy_hash}` → `{intent_id, decision, security_tier}`

- **Intent** (`intent.schema.json`): `dcp_version "2.0"`, `intent_id` = `intent:<uuid4>`,
  `session_nonce`, `agent_id`, `human_id`, `timestamp` now, `action_type`,
  `target {channel, to: null}`, `data_classes`, `estimated_impact`,
  `requires_consent` = (`estimated_impact` is `"high"`), `security_tier` = the SDK's
  security-tier computation (DCP-AI v2.0 §14.2) for this intent and `risk_score`.
- **Policy decision** (`policy_decision.schema.json`): `dcp_version "2.0"`, `intent_id`,
  `session_nonce`, `decision` = `approve` if `risk_score` < 500, `escalate` if < 800, else
  `block`; `risk_score`; `reasons ["interop-matrix: risk_score <n>"]`; `required_confirmation`
  `null` on approve, else `{"type": "human_approve", "fields": ["action_type"]}`;
  `applied_policy_hash` from the args; `timestamp` now; `resolved_tier` = the intent's
  `security_tier`.

Both composite-signed by the **agent** keys (`Intent`, `PolicyDecision` contexts).

### `act` `{intent_id, outcome, tool, result_ref}` → `{audit_id, count}`

Appends one audit entry (`audit_entry.schema.json`) to that intent's trail: `dcp_version "2.0"`,
`audit_id` = `audit:<uuid4>`, `session_nonce`, `prev_hash` = `"GENESIS"` for the trail's first
entry, else `"sha256:" + hex(sha256(canonical(previous entry)))`; `hash_alg "sha256"`;
`timestamp` now; `agent_id`; `human_id`; `intent_id`;
`intent_hash` = `"sha256:" + hex(sha256(canonical(intent payload)))`;
`policy_decision` = `approved` / `escalated` / `blocked` from the decision; `outcome`;
`evidence {tool, result_ref, evidence_hash: "sha256:" + hex(sha256(utf8(result_ref)))}`;
`pq_checkpoint_ref null`. `count` is the trail length.

### `bundle` `{intent_id, session_issued_at?, session_expires_at?, intended_verifier?}` → `{signed_bundle}`

The citizenship bundle of that intent (`signed_bundle.schema.json`): the signed RPR, passport,
intent and policy decision, the intent's whole trail, and the manifest: `session_nonce`,
`rpr_hash` / `passport_hash` / `intent_hash` / `policy_hash` (the payload hashes), 
`audit_merkle_root` (`"sha256:"` + the SDK's audit Merkle root), `audit_count`,
`canonicalization_profile "dcp-jcs-v1"`. The signature: `hash_alg "sha256"`, `created_at` now,
`signer {type: "human", id: human_id, kids: [human classical kid, human pq kid]}`,
`manifest_hash`, `composite_sig` by the **human** keys under the `Bundle` context. Use the SDK's
bundle builder and signer. The Go and Rust builders also write `audit_merkle_root_secondary`.
The optional arguments go into the manifest before it is signed, exactly as given.

### `verify` `{signed_bundle, mode}` → `{valid, errors}`

The SDK's V2 bundle verifier. `mode` `""` is the default verifier policy; any other value is a
verification mode applied to `default_mode` and to every risk tier, as the interop tests do. A
malformed bundle is a `valid: false` result, never an error response.

### `rotate_principal` `{}` → `{human_id, principal_keys}`

A new composite key pair for the principal and a new RPR with the same `human_id`, `issued_at`
now and the new `binding_keys`, signed by the new keys. Later bundles use them.

### `configure` `{tenant, trust_set, profile}` → `{}` or `{config_error}`

The operator configuration of a tenant, loaded with the SDK's own loaders: the trust set
(`createPrincipalTrustStore` and its counterparts) and the `strict-v1` profile
(`resolveStrictV1Profile`). A configuration error is `{config_error: <CONFIG_* code>}`.

### `admit` `{tenant, signed_bundle, revocation, now_ms}` → the admission result

The SDK's combined admission API (`admitSignedBundleV2` and its counterparts) with the tenant's
profile and trust set, the revocation snapshot and the clock. The result is the SDK's own JSON
form (spec §8) without `verification`, plus `verification_errors`.

### `shutdown` `{}` → `{}`

The agent exits after responding.

## Scenario 1: DCP-01 to DCP-03

For every SDK as **producer**: `identity`; a routine intent (`api_call`, channel `api`,
`["none"]`, impact `low`, risk 100) with three `act`s; a payment intent (`initiate_payment`,
channel `payments`, `["financial_data"]`, impact `high`, risk 900, so blocked) with one `act`
(the refusal is evidence too); `bundle` for both. Then every SDK as **verifier** checks both
bundles under the default policy and `hybrid_required`: both must verify.

Then the orchestrator tampers with the routine bundle in transit, and every verifier must reject
each copy, in both modes unless noted:

| Attack | What changes |
|---|---|
| `intent_changed` | `intent.payload.estimated_impact` becomes `high` after signing |
| `audit_reordered` | the first two audit entries swap places |
| `audit_entry_dropped` | the last audit entry is removed, the manifest kept |
| `session_spliced` | the manifest's `session_nonce` is replaced |
| `bundle_signature_swapped` | the bundle signature comes from the payment bundle |
| `passport_swapped` | the passport is another agent's (the next SDK's producer) |
| `pq_stripped` | the bundle signature's `pq` slot is removed (`classical_only`); `hybrid_required` only |
| `intent_from_other_bundle` | the intent and policy decision come from the payment bundle (same session and signer) |
| `trail_from_other_bundle` | the audit trail comes from the payment bundle (same session and signer) |

An agent that crashes, times out or answers out of turn is stopped and every later request to it
fails at once, so a broken agent shows up as failures, never as a hung run.

## Scenario 2: admission under `strict-v1`

Every SDK as **producer**: `identity`, a routine intent (risk 100, so `approve`) with one `act`,
and three bundles whose manifests sign the session window `[T0, T0 + 300 s]` (the profile's
maximum): one for this verifier (`verifier:interop-admission`), one for another audience, and,
after `rotate_principal`, one signed with the rotated principal keys.

The orchestrator is the operator. It enrolls each principal from the public keys the producer
reported (never from a bundle under admission), builds the trust sets, and serves the revocation
snapshots: the producer's agent and keys, `checked_at` 10 s before the clock. Every admission runs
at the fixed instant `T0 + 120 s` (the expiry case at the expiry plus 1 ms). Tenants A and B are
a selection of operator configuration made by the harness; no integration or cache is involved.

Every SDK as **consumer** runs the 13 cases below for every producer, in this order, in one
process. The expected `verified`, `principal_trust`, `profile`, `profile_compliance`, `admitted`,
`action_authorized` (always `false`), `recorded_decision`, `trust_set_version` and set of codes
come from the spec, written in `admission.mjs`, never from an SDK.

| Case | Configuration | Expected |
|---|---|---|
| `trusted_admitted` | tenant A trusts every enrolled principal | admitted |
| `trust_withdrawn` | tenant A without this principal, same bundle | `TRUST_PRINCIPAL_UNKNOWN` |
| `trust_restored` | tenant A as before, same bundle | admitted |
| `tenant_b_empty_trust` | tenant B, empty trust set | `TRUST_PRINCIPAL_UNKNOWN` |
| `principal_key_revoked` | a fresh snapshot revokes a principal key | `REVOCATION_REVOKED` |
| `agent_key_revoked` | a fresh snapshot revokes an agent key | `REVOCATION_REVOKED` |
| `other_audience` | the bundle signed for another verifier | `PROFILE_AUDIENCE_MISMATCH`, `VERIFICATION_FAILED` |
| `session_expired` | clock 1 ms after the signed expiry | `PROFILE_SESSION_EXPIRED`, `VERIFICATION_FAILED` |
| `rotation_new_keys_not_enrolled` | rotated bundle, trust set not updated | `TRUST_KEY_NOT_ANCHORED` |
| `rotation_overlap_new_keys` | old and new keys active | admitted |
| `rotation_overlap_old_keys` | the same, original bundle | admitted |
| `rotation_old_keys_retired` | old keys `revoked`, original bundle | `TRUST_KEY_REVOKED` |
| `rotation_new_keys_after_retirement` | the same, rotated bundle | admitted |

A mismatch writes a minimal reproduction to the output directory: everything the consumer was
given for that one admission, including the tenant's **effective** trust set and profile (the last
ones loaded, also when an earlier case loaded them, with `configuration_loaded_in`), and what it
returned. Only public material: no private key.

```bash
node tools/interop-matrix/admission.mjs --replay tools/interop-matrix/out/admission/<producer>-<consumer>-<case>.json
```

`--replay` starts a fresh consumer of the recorded SDK, configures the recorded tenant, admits the
recorded bundle at the recorded clock and requires exactly the recorded output: every key of
either side (the normalized fields, the codes, the verifier's errors, and `error` when a call
failed), a key present on one side only being a difference, so two different errors never count
as a reproduction. Exit 0 when it reproduces, 1 when it differs, 2 when the record is incomplete.

**Negative control.** After the matrix, the runner starts itself with `--negative-control` on the
`ts` pair, in a new temporary directory and with a new run id, at most 120 s. That run inverts the
expected `admitted` of `trust_withdrawn`. The control passes only if the child exits 1 and its
report is the one it wrote in this run (same run id) with `negative_control_run: true`, the one
pair `ts>ts` at 12 of 13, and exactly one failure, field `admitted` of `trust_withdrawn`.
`--check-negative-control` tests the control itself: it must accept a correct run and refuse a
child that cannot start (no report, and a report left by an earlier run in the same directory)
and a child that hangs (stopped at the time limit). `--negative-control-case NAME` inverts another
case instead, to produce a reproduction file on purpose.

First run: 16 pairs × 13 cases = 208 results as expected, and the negative control failed as
required.

## What the first run found

All 16 SDK pairs and the reference verifier agree on every bundle and every attack. Writing the
agents surfaced these SDK gaps, none of them a verdict divergence between SDK verifiers:

- **Go `SignBundleV2` left `signature.signer.id` empty**: it took no signer id. The four SDK
  verifiers accepted such a bundle; the reference verifier, the CLI and the server rejected it
  (`signer/id must NOT have fewer than 6 characters`). Fixed: the signer is now the bundle's RPR
  `human_id`, and the Go agent uses `SignBundleV2` as is. The `signature.signer` block (`id`, `kids`),
  `created_at` and `manifest_hash` are unauthenticated metadata outside the signed manifest: no
  verifier checks them against the RPR or recomputes `manifest_hash` (all five accept zeros);
  only the schema constrains their shape.
- **Go's typed payloads lacked tier fields**: `IntentV2` had no `security_tier` and
  `PolicyDecisionV2` no `resolved_tier`. Both exist now. (`contact` and `target.to` are optional in
  the schema, so the Go agent's maps write `null` only to match the contract.)
- **Rust's native API had no bundle builder or signer**, so the Rust agent assembled the manifest
  and signed it from the primitives. Fixed: `build_bundle_v2` and `sign_bundle_v2`
  (`dcp_ai::v2::bundle`), which the agent now uses. The `wasm` feature's `wasm_build_bundle` and
  `wasm_sign_bundle` now call them; before, `wasm_sign_bundle` wrote `created_at ""` and no
  `signer.id`, so the reference verifier rejected every bundle it signed.
- **An empty audit trail**: every verifier accepts a validly signed bundle with no audit entries,
  as `spec/VERIFICATION.md` allows (root of 64 zeros); the `auditEventsMerkleRoot` helpers, which
  serve PQ checkpoints, refuse an empty list in all four SDKs alike.

## Roadmap

1. Scenarios 1 (DCP-01 to 03) and 2 (admission), in CI.
2. DCP-04: today every SDK builds `A2A_HELLO` and `A2A_WELCOME`, but none implements
   `A2A_CONFIRM` / `A2A_ESTABLISHED` or the session-key derivation of DCP-04 §3.4, only TypeScript
   has the hybrid X25519 + ML-KEM-768 KEM the messages announce, and Rust has no session layer.
   Once they do, the protocol gains `hello`, `welcome`, `confirm`, `send` and `receive`, and the
   orchestrator replays, reorders and splices messages between the two agents.
3. DCP-09 mandate chains built hop by hop by agents on different SDKs.
