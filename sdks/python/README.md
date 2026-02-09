# dcp-ai — Python SDK

Official Python SDK for the Digital Citizenship Protocol (DCP). Pydantic v2 models, Ed25519 cryptography, bundle verification, and a full-featured CLI.

## Installation

```bash
pip install dcp-ai
```

### Optional extras

```bash
pip install "dcp-ai[fastapi]"    # FastAPI middleware
pip install "dcp-ai[langchain]"  # LangChain integration
pip install "dcp-ai[openai]"     # OpenAI wrapper
pip install "dcp-ai[crewai]"     # CrewAI multi-agent
```

## Quickstart

```python
from dcp_ai import (
    BundleBuilder,
    sign_bundle,
    verify_signed_bundle,
    generate_keypair,
    HumanBindingRecord,
    AgentPassport,
    Intent,
    IntentTarget,
    PolicyDecision,
)

# 1. Generate Ed25519 keypair
keys = generate_keypair()

# 2. Build a Citizenship Bundle
bundle = (
    BundleBuilder()
    .human_binding_record(HumanBindingRecord(
        dcp_version="1.0",
        human_id="human-001",
        entity_type="natural_person",
        jurisdiction="ES",
        liability_mode="full",
        created_at="2025-01-01T00:00:00Z",
        expires_at=None,
    ))
    .agent_passport(AgentPassport(
        dcp_version="1.0",
        agent_id="agent-001",
        human_id="human-001",
        agent_name="MyAgent",
        capabilities=["browse", "api_call"],
        risk_tier="medium",
        status="active",
        created_at="2025-01-01T00:00:00Z",
        expires_at=None,
    ))
    .intent(Intent(
        dcp_version="1.0",
        agent_id="agent-001",
        human_id="human-001",
        timestamp="2025-01-01T00:00:00Z",
        action_type="api_call",
        target=IntentTarget(channel="api", endpoint="https://api.example.com/data"),
        data_classes=["public"],
        estimated_impact="low",
    ))
    .policy_decision(PolicyDecision(
        dcp_version="1.0",
        agent_id="agent-001",
        human_id="human-001",
        timestamp="2025-01-01T00:00:00Z",
        decision="allow",
        matched_rules=["default-allow"],
    ))
    .build()
)

# 3. Sign
signed = sign_bundle(bundle, keys["secret_key_b64"])

# 4. Verify
result = verify_signed_bundle(signed, keys["public_key_b64"])
print(result)  # {"verified": True, "errors": []}
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
bundle = (
    BundleBuilder()
    .human_binding_record(hbr)
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
sign_bundle(
    bundle: CitizenshipBundle,
    secret_key_b64: str,
    signer_type: str = "human",
    signer_id: str | None = None,
) -> dict[str, Any]
```

### Bundle Verification

```python
verify_signed_bundle(
    signed_bundle: dict[str, Any],
    public_key_b64: str | None = None,
) -> dict[str, Any]  # {"verified": bool, "errors": [...]}
```

Verifies: schema, Ed25519 signature, `bundle_hash`, `merkle_root`, `intent_hash` chain, `prev_hash` chain.

### Pydantic Models

All DCP v1 artifacts are available as Pydantic v2 models with automatic validation:

`HumanBindingRecord`, `AgentPassport`, `Intent`, `IntentTarget`, `PolicyDecision`, `AuditEntry`, `AuditEvidence`, `CitizenshipBundle`, `SignedBundle`, `BundleSignature`, `SignerInfo`, `RevocationRecord`, `HumanConfirmation`

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

## License

Apache-2.0
