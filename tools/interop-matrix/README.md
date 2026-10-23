# Interop matrix: live agents across the four SDKs

`run.mjs` starts one **agent process per SDK** (TypeScript, Python, Go, Rust) and makes them
work with each other: an agent built on one SDK creates its identity, declares intents, acts and
signs its citizenship bundles; an agent built on another SDK verifies them, as it would before
trusting a counterparty. The processes share nothing but the messages the orchestrator relays,
so every pair (16 with four SDKs, each SDK against itself included) is a real interoperation, not
a comparison of files. A fifth, verify-only agent, `ref`, runs the reference verifier
`lib/verify.js` (what `npx dcp-ai verify` and the verification server run): it validates every
artifact against `schemas/v2` before the published `@dcp-ai/sdk` verifier, which the SDK
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
as written; everything else is the SDK's own business, which is what the matrix tests.

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
bundle builder and signer where it has one; an SDK without one assembles the bundle from its
primitives.

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

## What the first run found

All 16 SDK pairs and the reference verifier agree on every bundle and every attack (17 checks per
pair). Writing the agents surfaced these SDK gaps, none of them a verdict divergence between
SDK verifiers:

- **Go `SignBundleV2` leaves `signature.signer.id` empty** (`sdks/go/dcp/v2/bundle_builder.go`):
  it takes no signer id. The four SDK verifiers accept such a bundle; the reference verifier, the
  CLI and the server reject it (`signer/id must NOT have fewer than 6 characters`). The Go agent
  sets the id after signing (the signer block is outside the signed manifest) until the SDK does.
- **Go's typed payloads cannot express the contract**: `IntentV2` has no `security_tier`,
  `PolicyDecisionV2` no `resolved_tier`, and `contact` / `target.to` are `omitempty` where the
  schema wants `null`; the Go agent builds those payloads as maps.
- **Rust has no bundle builder or signer**; the Rust agent assembles the manifest and signs it
  from the primitives, and its bundles verify everywhere. Rust also has no public helper for an
  RFC 3339 "now" or a UUID v4.
- **An empty audit trail**: Rust's `audit_events_merkle_root` refuses an empty list while its
  verifier accepts `audit_merkle_root` of 64 zeros with no entries. Whether a bundle may carry no
  audit entry at all is a spec question (the builders require one).

## Roadmap

1. This scenario (DCP-01 to 03), in CI.
2. DCP-04: today every SDK builds `A2A_HELLO` and `A2A_WELCOME`, but none implements
   `A2A_CONFIRM` / `A2A_ESTABLISHED` or the session-key derivation of DCP-04 §3.4, only TypeScript
   has the hybrid X25519 + ML-KEM-768 KEM the messages announce, and Rust has no session layer.
   Once they do, the protocol gains `hello`, `welcome`, `confirm`, `send` and `receive`, and the
   orchestrator replays, reorders and splices messages between the two agents.
3. DCP-09 mandate chains built hop by hop by agents on different SDKs.
