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

This first scenario covers DCP-01 (identity), DCP-02 (intent and policy) and DCP-03 (audit). The
A2A handshake of DCP-04 is the next scenario: it needs SDK work first (see the roadmap at the end).

## Run

```bash
npm install                                           # agents/ref: the reference verifier
cd sdks/typescript && npm install && npm run build   # agents/ts imports sdks/typescript/dist
pip install -e sdks/python                            # dependencies of agents/py
node tools/interop-matrix/run.mjs                     # all four SDKs and the reference verifier
node tools/interop-matrix/run.mjs --agents ts,py      # a subset
```

Go and a stable Rust toolchain must be on `PATH`; `run.mjs` builds `agents/go` and `agents/rust`.
Options: `--agents a,b` (any of `ts`, `py`, `go`, `rust`, `ref`), `--python PATH` (default `$INTEROP_PYTHON` or `python3`), `--timeout MS`
(per request, default 60000), `--out DIR` (default `tools/interop-matrix/out`, where the report
and every bundle that produced an unexpected verdict are written).

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

### `identity` `{owner_name, jurisdiction}` → `{agent_id, human_id, session_nonce}`

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

### `bundle` `{intent_id}` → `{signed_bundle}`

The citizenship bundle of that intent (`signed_bundle.schema.json`): the signed RPR, passport,
intent and policy decision, the intent's whole trail, and the manifest: `session_nonce`,
`rpr_hash` / `passport_hash` / `intent_hash` / `policy_hash` (the payload hashes), 
`audit_merkle_root` (`"sha256:"` + the SDK's audit Merkle root), `audit_count`,
`canonicalization_profile "dcp-jcs-v1"`. The signature: `hash_alg "sha256"`, `created_at` now,
`signer {type: "human", id: human_id, kids: [human classical kid, human pq kid]}`,
`manifest_hash`, `composite_sig` by the **human** keys under the `Bundle` context. Use the SDK's
bundle builder and signer. The Go and Rust builders also write `audit_merkle_root_secondary`.

### `verify` `{signed_bundle, mode}` → `{valid, errors}`

The SDK's V2 bundle verifier. `mode` `""` is the default verifier policy; any other value is a
verification mode applied to `default_mode` and to every risk tier, as the interop tests do. A
malformed bundle is a `valid: false` result, never an error response.

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

1. This scenario (DCP-01 to 03), in CI.
2. DCP-04: today every SDK builds `A2A_HELLO` and `A2A_WELCOME`, but none implements
   `A2A_CONFIRM` / `A2A_ESTABLISHED` or the session-key derivation of DCP-04 §3.4, only TypeScript
   has the hybrid X25519 + ML-KEM-768 KEM the messages announce, and Rust has no session layer.
   Once they do, the protocol gains `hello`, `welcome`, `confirm`, `send` and `receive`, and the
   orchestrator replays, reorders and splices messages between the two agents.
3. DCP-09 mandate chains built hop by hop by agents on different SDKs.
