<sub>**English** · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# dcp-ai — Python SDK

Official Python SDK for the Digital Citizenship Protocol (DCP v2.0). Pydantic v2 models, hybrid post-quantum signatures (Ed25519 + ML-DSA-65, plus SLH-DSA-192f), the ML-KEM-768 KEM primitive, composite signatures with `pq_over_classical` binding, V1 and V2 bundle signing and verification, OpenTelemetry observability, DCP-04 through DCP-09 behavior, and a full-featured CLI.

## Installation

**Python SDK 2.10.0.** This version includes the V2 verifier fixes, principal trust and `strict-v1`, delegation chains, the A2A receive window, bounded revocation workers and the experimental opt-in `dcp-jcs-v2` APIs. It also includes the corrected FastAPI, LangChain, OpenAI and CrewAI bridges. `dcp-jcs-v1` remains the normative default. Install this version with:

```bash
pip install "dcp-ai>=2.10.0,<3"
```

**Upgrade from 2.9.0.** FastAPI now verifies V2 signatures instead of accepting structure alone. V1 acceptance in FastAPI and the LangChain/OpenAI bridges follows the verifier policy. V2 also rejects non-canonical signature encodings and inconsistent or incorrectly bound evidence that older versions accepted. Preserve historical evidence and its verification version; do not silently re-sign it. Trust, resource budgets and disconnect handling remain explicit operator choices. Verification and admission do not authorize an action.

On Python 3.10, cancelling a supervised deny-list download also propagates cancellation if its result has just arrived. Its capacity is still released only when the download thread really finishes.

For source development, an editable checkout remains available:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "dcp-ai/sdks/python"
```

### Optional extras

From the registry (published version); from a checkout, the same extras apply: `pip install -e "dcp-ai/sdks/python[fastapi]"`.

```bash
pip install "dcp-ai[fastapi]>=2.10.0,<3"    # FastAPI middleware
pip install "dcp-ai[langchain]>=2.10.0,<3"  # LangChain integration
pip install "dcp-ai[openai]>=2.10.0,<3"     # OpenAI wrapper
pip install "dcp-ai[crewai]>=2.10.0,<3"     # CrewAI multi-agent
pip install "dcp-ai[otlp]>=2.10.0,<3"       # OpenTelemetry OTLP exporter
```

## Features

| Area | Status |
|---|---|
| Ed25519 / ML-DSA-65 (FIPS 204) providers | Yes |
| SLH-DSA-192f provider | Yes, FIPS 205 (pure, empty context), interoperable with the other SDKs |
| ML-KEM-768 | KEM primitive: yes (`MlKem768Provider`, FIPS 203). DCP-04 X25519 + ML-KEM-768 hybrid key exchange: not yet |
| Composite signatures (`pq_over_classical`) + verification | Yes |
| Canonical JSON v2 + domain separation | Yes |
| Dual hash (SHA-256 + SHA3-256) + Merkle roots | Yes |
| Bundle signing + verification | V1: yes. V2 (`SignedBundleV2`): yes, `BundleBuilderV2` / `sign_bundle_v2` / `verify_signed_bundle_v2` |
| DCP-04 A2A discovery + handshake + AES-256-GCM session (via `cryptography`); each message accepted once within the window (§8.4) | Yes |
| DCP-05 agent lifecycle (commissioning / vitality / decommissioning) | Yes |
| DCP-06 digital succession (testament, memory transfer, ceremony) | Yes |
| DCP-07 dispute resolution + arbitration + jurisprudence | Yes |
| DCP-08 rights + obligations + compliance | Yes |
| DCP-09 delegation + verifiable delegation chains (`create_sub_mandate`, `verify_mandate_chain`, §3.5) + awareness threshold + principal mirror | Yes |
| Session nonce helpers, security tier engine (`compute_security_tier(intent, policy_decision, mandate_chain_tier)`, spec §14.2), emergency revocation | Yes |
| Lazy PQ checkpoints + `PQCheckpointManager` | Yes |
| Blinded RPR, multi-party authorization, algorithm advisory helpers | Yes |
| Canonical error codes (38 shared across all SDKs) + `detect_wire_format` | Yes |
| OpenTelemetry / OTLP exporter (optional `[otlp]` extra) | Yes |
| Admission: trusted principals and the `strict-v1` profile | Yes (2.10.0) |
| Canonicalization candidate `dcp-jcs-v2` (ingress, router, bytes verifier, producers) | Experimental and opt-in; not normative |

## Quickstart

A V1 bundle signed with Ed25519. The RPR is signed with the principal's key and the passport with the agent's,
each over the canonical JSON of the object without its `signature` field; `create_audit_entry` computes
`intent_hash` and the `prev_hash` chain. `verify_signed_bundle` checks the bundle signature, its hashes and the
chain, not these inner signatures: check those yourself, as below. For V2 bundles, see [V2 Bundles](#v2-bundles).

```python
from datetime import datetime, timezone

from dcp_ai import (
    AgentPassport,
    AuditEvidence,
    BundleBuilder,
    Intent,
    PolicyDecision,
    ResponsiblePrincipalRecord,
    generate_keypair,
    sign_bundle,
    sign_object,
    verify_object,
    verify_signed_bundle,
)

now = datetime.now(timezone.utc).isoformat()
principal_keys = generate_keypair()
agent_keys = generate_keypair()

# 1. The responsible principal, signed with the principal's key (the object without "signature")
rpr_body = {
    "dcp_version": "1.0", "human_id": "human:example-001", "legal_name": "Example Principal",
    "entity_type": "natural_person", "jurisdiction": "ES", "liability_mode": "owner_responsible",
    "override_rights": True, "issued_at": now, "expires_at": None, "contact": None,
}
rpr = {**rpr_body, "signature": sign_object(rpr_body, principal_keys["secret_key_b64"])}

# 2. The agent passport, signed with the agent's key (the object without "signature")
passport_body = {
    "dcp_version": "1.0", "agent_id": "agent:example-001", "public_key": agent_keys["public_key_b64"],
    "principal_binding_reference": "human:example-001", "capabilities": ["browse", "api_call"],
    "risk_tier": "low", "created_at": now, "status": "active",
}
passport = {**passport_body, "signature": sign_object(passport_body, agent_keys["secret_key_b64"])}

# 3. Intent, policy decision and one audit entry
intent = Intent(
    intent_id="intent:example-001", agent_id="agent:example-001", human_id="human:example-001",
    timestamp=now, action_type="api_call", target={"channel": "api", "domain": "api.example.com"},
    data_classes=["none"], estimated_impact="low", requires_consent=False,
)
policy = PolicyDecision(
    intent_id="intent:example-001", decision="approve", risk_score=0.05, reasons=["low-impact call"],
)
bundle = (
    BundleBuilder()
    .responsible_principal_record(ResponsiblePrincipalRecord(**rpr))
    .agent_passport(AgentPassport(**passport))
    .intent(intent)
    .policy_decision(policy)
    .create_audit_entry(
        audit_id="audit:example-001", timestamp=now, agent_id="agent:example-001",
        human_id="human:example-001", intent_id="intent:example-001", policy_decision="approved",
        outcome="call_completed", evidence=AuditEvidence(tool="http", result_ref=None),
    )
    .build()
)

# 4. Sign with the principal's key and verify against the principal's public key
signed = sign_bundle(bundle, principal_keys["secret_key_b64"])
print(verify_signed_bundle(signed, principal_keys["public_key_b64"]))  # {'verified': True}

# 5. The inner signatures, over the same objects without "signature"
print(verify_object(rpr_body, rpr["signature"], principal_keys["public_key_b64"]))  # True
print(verify_object(passport_body, passport["signature"], agent_keys["public_key_b64"]))  # True
```

## CLI

The SDK includes a CLI built with Typer. Available as `dcp` after installation.

```bash
# Version
dcp version

# Generate Ed25519 keypair
dcp keygen [out_dir]

# Validate an object against a DCP schema
dcp validate <schema_name> <json_path>

# Validate a complete Citizenship Bundle
dcp validate-bundle <bundle_path>

# Verify a Signed Bundle
dcp verify <signed_path> [public_key_path]

# Compute bundle hash (SHA-256)
dcp bundle-hash <bundle_path>

# Compute Merkle root of audit entries
dcp merkle-root <bundle_path>

# Compute intent_hash
dcp intent-hash-cmd <intent_path>
```

## API Reference

### Crypto

| Function | Signature | Description |
|----------|-----------|-------------|
| `generate_keypair()` | `() -> dict[str, str]` | Returns `{"public_key_b64": ..., "secret_key_b64": ...}` |
| `sign_object(obj, secret_key_b64)` | `(Any, str) -> str` | Signs, returns base64 |
| `verify_object(obj, signature_b64, public_key_b64)` | `(Any, str, str) -> bool` | Verifies signature |
| `canonicalize(obj)` | `(Any) -> str` | Deterministic JSON |
| `public_key_from_secret(secret_key_b64)` | `(str) -> str` | Derives public key |

### Merkle & Hashing

| Function | Signature | Description |
|----------|-----------|-------------|
| `hash_object(obj)` | `(Any) -> str` | SHA-256 of canonicalized JSON |
| `merkle_root_from_hex_leaves(leaves)` | `(list[str]) -> str \| None` | Merkle root |
| `merkle_root_for_audit_entries(entries)` | `(list[Any]) -> str \| None` | Merkle root of audit entries |
| `intent_hash(intent)` | `(Any) -> str` | Intent hash |
| `prev_hash_for_entry(prev_entry)` | `(Any) -> str` | Previous entry hash |

### Schema Validation

| Function | Signature | Description |
|----------|-----------|-------------|
| `validate_schema(schema_name, data)` | `(str, Any) -> dict` | Returns `{"valid": bool, "errors": [...]}` |
| `validate_bundle(bundle)` | `(dict) -> dict` | Validates a complete bundle |

### Bundle Builder

```python
# Fragment: rpr, passport, intent, policy and entry are the models built in the Quickstart.
bundle = (
    BundleBuilder()
    .responsible_principal_record(rpr)
    .agent_passport(passport)
    .intent(intent)
    .policy_decision(policy)
    .add_audit_entry(entry)       # Manual
    .create_audit_entry(...)      # Auto-computes hashes
    .build()                      # => CitizenshipBundle
)
```

### Bundle Signing

```python
# Signature (not runnable)
sign_bundle(
    bundle: CitizenshipBundle,
    secret_key_b64: str,
    signer_type: str = "human",
    signer_id: str | None = None,
) -> dict[str, Any]
```

### Bundle Verification

```python
# Signature (not runnable)
verify_signed_bundle(
    signed_bundle: dict[str, Any],
    public_key_b64: str | None = None,
) -> dict[str, Any]  # {"verified": bool, "errors": [...]}
```

Verifies: schema, Ed25519 signature, `bundle_hash`, `merkle_root`, `intent_hash` chain, `prev_hash` chain.

### V2 Bundles

`BundleBuilderV2`, `sign_bundle_v2` and `verify_signed_bundle_v2` (in `dcp_ai.v2`) port the TypeScript SDK's `builder-v2.ts`, `signer-v2.ts` and `verify-v2.ts`. Artifacts are `SignedPayload` dicts (`{"payload", "payload_hash", "composite_sig"}`); the bundle signature is a composite signature over the manifest.

```python
# Fragment, inside an async function: session_nonce, the signed artifacts (signed_rpr, signed_passport, signed_intent, signed_policy), audit_events, classical_key and pq_key come from your application.
from dcp_ai.providers import Ed25519Provider, MlDsa65Provider
from dcp_ai.v2 import AlgorithmRegistry, BundleBuilderV2, sign_bundle_v2, verify_signed_bundle_v2

registry = AlgorithmRegistry()
registry.register_signer(Ed25519Provider())
registry.register_signer(MlDsa65Provider())

bundle = (
    BundleBuilderV2(session_nonce)
    .responsible_principal_record(signed_rpr)
    .agent_passport(signed_passport)
    .intent(signed_intent)
    .policy_decision(signed_policy)
    .add_audit_entries(audit_events)
    .build()
)
signed = await sign_bundle_v2(bundle, registry, "human", "human-001", classical_key, pq_key)
result = await verify_signed_bundle_v2(signed, registry)  # DEFAULT_VERIFIER_POLICY
# {"verified": bool, "errors": [...], "warnings": [...], "details": {...}}
```

The verifier also checks each artifact's own composite signature (the RPR against the principal's `binding_keys`, the rest against the passport keys) and, in every policy mode, rejects a PQ signature that is present but invalid. The mode is the stricter of the policy mode and the security tier's mode (spec §14.3), and `details["resolved_tier"]` reports the tier.

<a id="admission-trusted-principals-and-strict-v1-unreleased"></a>

### Admission: Trusted Principals and strict-v1

A verified bundle is signed by the keys it lists; it does not prove who the principal is. Admission accepts a bundle only when its principal signatures were made with keys of a principal your trust set lists, and optionally under the operator-fixed `strict-v1` profile (hybrid signatures, signed audience, a session of at most 300 s, a fresh revocation snapshot).

```python
# Fragment, inside an async function: trust_set comes from operator configuration, signed_bundle from the request, snapshot from your revocation source, registry as in V2 Bundles.
from dcp_ai.v2 import admit_signed_bundle_v2, create_principal_trust_store, resolve_strict_v1_profile

trust = create_principal_trust_store(trust_set)  # AdmissionConfigError on a bad trust set
profile = resolve_strict_v1_profile({"profile": "strict-v1", "verifier_id": "api.acme.example"})
result = await admit_signed_bundle_v2(signed_bundle, registry, profile=profile, trust=trust, revocation=snapshot)
# result["verified"], result["principal_trust"], result["profile_compliance"], result["admitted"],
# result["action_authorized"] (always False), result["errors"] [{"code", "message"}]
```

- `verify_signed_bundle_v2(bundle, registry, policy, now_ms=...)` takes an optional clock and reports `details["signer_keys"]`; without them it behaves as before.
- `evaluate_admission_v2` evaluates a verifier result you already have (no cryptography, no I/O) and trusts it; `revocation_subjects` lists what a revocation source must answer for, and `deny_list_revocation_source(url)` reads the reference revocation service's deny list; with `workers=DenyListWorkers(max_workers=...)` its download threads are counted and capped until they really end (opt-in; see the FastAPI README).
- FastAPI: `DCPVerifyMiddleware(app, require_bundle=True, trusted_principals=..., profile=..., revocation_source=...)`; see [`integrations/fastapi/README.md`](../../integrations/fastapi/README.md). Guide: [`docs/ADMISSION.md`](../../docs/ADMISSION.md). Spec and codes: [`spec/profiles/admission`](../../spec/profiles/admission/README.md).

<a id="delegation-chains-dcp-09-35-unreleased"></a>

### Delegation Chains (DCP-09 §3.5)

A root mandate is signed by the human (`create_delegation_mandate`); the agent holding it may issue a
sub-mandate to another agent (`create_sub_mandate`), signed with its own keys. `verify_mandate_chain` checks
the chain root first and offline: signatures back to the human, parent links and depth, `sub_delegation`,
nested validity windows, attenuation (actions, `data_classes` and `limits` only narrow), the security-tier
floor and revocation.

```python
# Fragment, inside an async function: registry as in V2 Bundles; orchestrator_classical, orchestrator_pq, root_mandate, nonce and the key entries come from your delegation setup; intent and policy_decision are V2 payloads.
from dcp_ai.v2 import create_sub_mandate, verify_mandate_chain, compute_security_tier

sub = await create_sub_mandate(
    registry, orchestrator_classical, orchestrator_pq, root_mandate,
    mandate_id="mandate:sub-1", session_nonce=nonce, agent_id="agent:subagent",
    authority_scope=[{"domain": "email", "actions_permitted": ["read"], "data_classes": ["contact_info"]}],
    valid_from="2026-03-01T00:00:00Z", valid_until="2026-06-01T00:00:00Z", revocable=True,
)
result = await verify_mandate_chain(
    registry, [root_mandate, sub], set(),
    {"human_keys": human_key_entries, "agent_keys": {"agent:orchestrator": orchestrator_key_entries}},
)
# {"valid", "errors", "depth", "effective_tier"}; the tier floor can only raise an action's tier.
tier = compute_security_tier(intent, policy_decision, result["effective_tier"] if result["valid"] else None)
```

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

### Experimental: Canonicalization Candidate `dcp-jcs-v2` (opt-in)

Not normative and not active: `dcp-jcs-v1` stays the only canonicalization profile, and no default, builder,
signer or verifier changes. The modules are not re-exported by `dcp_ai.v2`; they exist for callers who import
them, including in Python 2.10.0. A verified candidate bundle grants no trust or admission.
Design and contract: [`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md)
(§15 ingress, §16 router, §17 verifier, §18 producers).

| Module | API |
|---|---|
| `dcp_ai.v2.experimental_candidate_ingress` | `experimental_candidate_ingress(data)`: `CandidateIngressAccept(value, canonical, canonical_sha256)` or `CandidateIngressReject(reject_class, offset)` |
| `dcp_ai.v2.experimental_candidate_router` | `create_router(transport=..., accepted_profiles=..., historical=...)`; decoders `JSON_LOADS_BYTES` and `JSON_LOADS_STRICT_DECODE`, none a default |
| `dcp_ai.v2.experimental_candidate_verify` | `create_verifier(...)`, then `await verifier.verify(data, registry, policy=None, now_ms=None)`: the route, the verifier entered and its result |
| `dcp_ai.v2.experimental_candidate_produce` | `sign_payload(registry, context, input, keys)` and `sign_bundle(registry, parts, signer, options)`, which check and copy at the call and return an awaitable; `ExperimentalCandidateProduceError` for a rejection of the inputs' domain or form, raised before any signer is called |

```python
import asyncio

from dcp_ai.providers import Ed25519Provider, MlDsa65Provider
from dcp_ai.v2 import AlgorithmRegistry, DCP_CONTEXTS
from dcp_ai.v2.experimental_candidate_ingress import experimental_candidate_ingress
from dcp_ai.v2.experimental_candidate_produce import sign_payload

# The ingress decides on the original bytes: 1.0 is the integer 1, members are sorted.
print(experimental_candidate_ingress(b'{"b":1.0,"a":[]}').canonical)  # b'{"a":[],"b":1}'
refused = experimental_candidate_ingress(b'{"a":1,"a":2}')
print(refused.reject_class, refused.offset)  # DUPLICATE_KEY 7


async def main():
    registry = AlgorithmRegistry()
    keys = {}
    for name, provider in (("classical", Ed25519Provider()), ("pq", MlDsa65Provider())):
        registry.register_signer(provider)
        kp = await provider.generate_keypair()
        keys[name] = {"kid": kp["kid"], "alg": provider.alg, "secret_key_b64": kp["secret_key_b64"], "public_key_b64": kp["public_key_b64"]}
    artifact = await sign_payload(registry, DCP_CONTEXTS["Intent"], {"bytes": b'{"intent_id":"intent:1","risk":1.0}'}, keys)
    print(artifact.signed_payload["payload_hash"])  # sha256:... of {"intent_id":"intent:1","risk":1}


asyncio.run(main())
```

### Pydantic Models

All DCP v1 artifacts are available as Pydantic v2 models with automatic validation:

`ResponsiblePrincipalRecord`, `AgentPassport`, `Intent`, `IntentTarget`, `PolicyDecision`, `AuditEntry`, `AuditEvidence`, `CitizenshipBundle`, `SignedBundle`, `BundleSignature`, `SignerInfo`, `RevocationRecord`, `HumanConfirmation`

**V2 models** (`dcp_ai.v2.models`), with the fields of the V2 schemas. Enumerated values (lifecycle states,
termination modes, dispute status and the like) are `Literal` fields of these models, not separate classes:

- Core V2: `ResponsiblePrincipalRecordV2`, `BlindedResponsiblePrincipalRecordV2`, `AgentPassportV2`, `KeyEntryV2`, `IntentV2`, `PolicyDecisionV2`, `AuditEventV2`, `PQCheckpoint`, `BundleManifest`, `VerifierPolicy`, `DcpCapabilities`
- DCP-05 — Lifecycle: `CommissioningCertificate`, `VitalityMetrics`, `VitalityReport`, `DecommissioningRecord`
- DCP-06 — Succession: `DigitalTestament`, `SuccessorPreference`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `DualHashRef`
- DCP-07 — Disputes: `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`
- DCP-08 — Rights: `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`
- DCP-09 — Delegation: `DelegationMandate`, `SubMandate`, `SubDelegationPolicy`, `AuthorityScopeEntry`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`

```python
# Example: DCP-05 commissioning, signed with a composite (Ed25519 + ML-DSA-65) signature
import asyncio

from dcp_ai.providers import Ed25519Provider, MlDsa65Provider
from dcp_ai.v2 import (
    AlgorithmRegistry, CompositeKeyInfo, create_commissioning_certificate, generate_session_nonce,
    validate_state_transition,
)
from dcp_ai.v2.models import CommissioningCertificate


async def main():
    registry = AlgorithmRegistry()
    keys = []
    for provider in (Ed25519Provider(), MlDsa65Provider()):
        registry.register_signer(provider)
        kp = await provider.generate_keypair()
        keys.append(CompositeKeyInfo(kp["kid"], provider.alg, kp["secret_key_b64"], kp["public_key_b64"]))

    cert = await create_commissioning_certificate(
        registry, *keys,
        agent_id="agent:example-001", session_nonce=generate_session_nonce(), human_id="human:example-001",
        commissioning_authority="human:example-001", purpose="Customer support triage",
        initial_capabilities=["browse", "api_call"], risk_tier="low",
        principal_binding_reference="human:example-001",
    )
    CommissioningCertificate(**cert)  # validates the fields
    print(validate_state_transition("commissioned", "active"))  # True


asyncio.run(main())
```

### Domain Separation (V2)

**V2 Domain Separation Contexts:** `Bundle`, `Intent`, `Passport`, `Revocation`, `Governance`, `Lifecycle`, `Succession`, `Dispute`, `Rights`, `Delegation`, `Awareness`

## Development

```bash
# Install in development mode
pip install -e ".[dev]"

# Run tests
pytest -v

# Async tests
pytest -v --asyncio-mode=auto
```

### Dependencies

- `pynacl` — Ed25519 cryptography
- `jsonschema` — JSON Schema validation
- `pydantic` v2 — Data models
- `typer` — CLI framework
- `pqcrypto` ≥ 1.0 — ML-DSA-65, SLH-DSA-192f, ML-KEM-768 (FIPS 204/205/203)
- `cryptography` — AES-256-GCM for DCP-04 A2A sessions

## License

Apache-2.0
