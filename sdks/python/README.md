# dcp-ai — Python SDK

SDK oficial de Python para el Digital Citizenship Protocol (DCP). Modelos Pydantic v2, criptografia Ed25519, verificacion de bundles y CLI completa.

## Instalacion

```bash
pip install dcp-ai
```

### Extras opcionales

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

# 1. Generar keypair Ed25519
keys = generate_keypair()

# 2. Construir un Citizenship Bundle
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
        agent_name="MiAgente",
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

# 3. Firmar
signed = sign_bundle(bundle, keys["secret_key_b64"])

# 4. Verificar
result = verify_signed_bundle(signed, keys["public_key_b64"])
print(result)  # {"verified": True, "errors": []}
```

## CLI

La SDK incluye un CLI con Typer. Disponible como `dcp` despues de instalar.

```bash
# Version
dcp version

# Generar keypair Ed25519
dcp keygen [out_dir]

# Validar un objeto contra un schema DCP
dcp validate <schema_name> <json_path>

# Validar un Citizenship Bundle completo
dcp validate-bundle <bundle_path>

# Verificar un Signed Bundle
dcp verify <signed_path> [public_key_path]

# Calcular bundle hash (SHA-256)
dcp bundle-hash <bundle_path>

# Calcular Merkle root de audit entries
dcp merkle-root <bundle_path>

# Calcular intent_hash
dcp intent-hash-cmd <intent_path>
```

## API Reference

### Crypto

| Funcion | Firma | Descripcion |
|---------|-------|-------------|
| `generate_keypair()` | `() -> dict[str, str]` | Retorna `{"public_key_b64": ..., "secret_key_b64": ...}` |
| `sign_object(obj, secret_key_b64)` | `(Any, str) -> str` | Firma, retorna base64 |
| `verify_object(obj, signature_b64, public_key_b64)` | `(Any, str, str) -> bool` | Verifica firma |
| `canonicalize(obj)` | `(Any) -> str` | JSON deterministico |
| `public_key_from_secret(secret_key_b64)` | `(str) -> str` | Deriva clave publica |

### Merkle & Hashing

| Funcion | Firma | Descripcion |
|---------|-------|-------------|
| `hash_object(obj)` | `(Any) -> str` | SHA-256 del JSON canonicalizado |
| `merkle_root_from_hex_leaves(leaves)` | `(list[str]) -> str \| None` | Raiz Merkle |
| `merkle_root_for_audit_entries(entries)` | `(list[Any]) -> str \| None` | Raiz Merkle de audit entries |
| `intent_hash(intent)` | `(Any) -> str` | Hash del intent |
| `prev_hash_for_entry(prev_entry)` | `(Any) -> str` | Hash de entrada anterior |

### Schema Validation

| Funcion | Firma | Descripcion |
|---------|-------|-------------|
| `validate_schema(schema_name, data)` | `(str, Any) -> dict` | Retorna `{"valid": bool, "errors": [...]}` |
| `validate_bundle(bundle)` | `(dict) -> dict` | Valida bundle completo |

### Bundle Builder

```python
bundle = (
    BundleBuilder()
    .human_binding_record(hbr)
    .agent_passport(passport)
    .intent(intent)
    .policy_decision(policy)
    .add_audit_entry(entry)       # Manual
    .create_audit_entry(...)      # Auto-computa hashes
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

Verifica: schema, firma Ed25519, `bundle_hash`, `merkle_root`, cadena de `intent_hash`, cadena de `prev_hash`.

### Modelos Pydantic

Todos los artefactos DCP v1 estan disponibles como modelos Pydantic v2 con validacion automatica:

`HumanBindingRecord`, `AgentPassport`, `Intent`, `IntentTarget`, `PolicyDecision`, `AuditEntry`, `AuditEvidence`, `CitizenshipBundle`, `SignedBundle`, `BundleSignature`, `SignerInfo`, `RevocationRecord`, `HumanConfirmation`

## Desarrollo

```bash
# Instalar en modo desarrollo
pip install -e ".[dev]"

# Ejecutar tests
pytest -v

# Tests async
pytest -v --asyncio-mode=auto
```

### Dependencias

- `pynacl` — Criptografia Ed25519
- `jsonschema` — Validacion JSON Schema
- `pydantic` v2 — Modelos de datos
- `typer` — CLI framework

## Licencia

Apache-2.0
