<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

# dcp-ai — SDK Python

SDK Python oficial para o Digital Citizenship Protocol (DCP). Modelos Pydantic v2, criptografia Ed25519, verificação de bundles (pacotes de cidadania) e uma CLI completa.

## Instalação

```bash
pip install dcp-ai
```

### Extras opcionais

```bash
pip install "dcp-ai[fastapi]"    # FastAPI middleware
pip install "dcp-ai[langchain]"  # LangChain integration
pip install "dcp-ai[openai]"     # OpenAI wrapper
pip install "dcp-ai[crewai]"     # CrewAI multi-agent
```

## Início Rápido

```python
from dcp_ai import (
    BundleBuilder,
    sign_bundle,
    verify_signed_bundle,
    generate_keypair,
    ResponsiblePrincipalRecord,
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
    .responsible_principal_record(ResponsiblePrincipalRecord(
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

O SDK inclui uma CLI construída com Typer. Disponível como `dcp` após a instalação.

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

## Referência de API

### Crypto

| Função | Assinatura | Descrição |
|--------|-----------|-----------|
| `generate_keypair()` | `() -> dict[str, str]` | Retorna `{"public_key_b64": ..., "secret_key_b64": ...}` |
| `sign_object(obj, secret_key_b64)` | `(Any, str) -> str` | Assina, retorna base64 |
| `verify_object(obj, signature_b64, public_key_b64)` | `(Any, str, str) -> bool` | Verifica assinatura |
| `canonicalize(obj)` | `(Any) -> str` | JSON determinístico |
| `public_key_from_secret(secret_key_b64)` | `(str) -> str` | Deriva a chave pública |

### Merkle e Hashing

| Função | Assinatura | Descrição |
|--------|-----------|-----------|
| `hash_object(obj)` | `(Any) -> str` | SHA-256 do JSON canonicalizado |
| `merkle_root_from_hex_leaves(leaves)` | `(list[str]) -> str \| None` | Merkle root |
| `merkle_root_for_audit_entries(entries)` | `(list[Any]) -> str \| None` | Merkle root das entradas de auditoria |
| `intent_hash(intent)` | `(Any) -> str` | Hash da intenção |
| `prev_hash_for_entry(prev_entry)` | `(Any) -> str` | Hash da entrada anterior |

### Validação de Schema

| Função | Assinatura | Descrição |
|--------|-----------|-----------|
| `validate_schema(schema_name, data)` | `(str, Any) -> dict` | Retorna `{"valid": bool, "errors": [...]}` |
| `validate_bundle(bundle)` | `(dict) -> dict` | Valida um bundle completo |

### Bundle Builder

```python
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

### Assinatura de Bundle

```python
sign_bundle(
    bundle: CitizenshipBundle,
    secret_key_b64: str,
    signer_type: str = "human",
    signer_id: str | None = None,
) -> dict[str, Any]
```

### Verificação de Bundle

```python
verify_signed_bundle(
    signed_bundle: dict[str, Any],
    public_key_b64: str | None = None,
) -> dict[str, Any]  # {"verified": bool, "errors": [...]}
```

Verifica: schema, assinatura Ed25519, `bundle_hash`, `merkle_root`, cadeia de `intent_hash`, cadeia de `prev_hash`.

### Modelos Pydantic

Todos os artefatos DCP v1 estão disponíveis como modelos Pydantic v2 com validação automática:

`ResponsiblePrincipalRecord`, `AgentPassport`, `Intent`, `IntentTarget`, `PolicyDecision`, `AuditEntry`, `AuditEvidence`, `CitizenshipBundle`, `SignedBundle`, `BundleSignature`, `SignerInfo`, `RevocationRecord`, `HumanConfirmation`

**Modelos V2 (DCP-05–09):**

DCP-05 — Ciclo de Vida: `LifecycleState`, `TerminationMode`, `DataDisposition`, `VitalityMetrics`, `CommissioningCertificate`, `VitalityReport`, `DecommissioningRecord`

DCP-06 — Sucessão: `TransitionType`, `MemoryDisposition`, `MemoryClassification`, `SuccessorPreference`, `DigitalTestament`, `SuccessionRecord`, `MemoryTransferEntry`, `DualHashRef`, `MemoryTransferManifest`

DCP-07 — Disputas: `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel`, `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`

DCP-08 — Direitos: `RightType`, `ComplianceStatus`, `RightEntry`, `RightsDeclaration`, `ObligationRecord`, `RightsViolationReport`

DCP-09 — Delegação: `AuthorityScopeEntry`, `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `ThresholdRule`, `ThresholdOperator`, `ThresholdAction`, `AwarenessThreshold`

```python
# Example: Lifecycle management
from dcp_ai.v2.models import CommissioningCertificate, LifecycleState

cert = CommissioningCertificate(
    certificate_id="cert-001",
    agent_id="agent-001",
    commissioned_by="human-001",
    commissioned_at="2026-03-01T00:00:00Z",
    initial_state=LifecycleState.COMMISSIONED,
    conditions=["Must complete onboarding within 30 days"],
)
```

### Separação de Domínio (V2)

**Contextos V2 de separação de domínio:** `Bundle`, `Intent`, `Passport`, `Revocation`, `Governance`, `Lifecycle`, `Succession`, `Dispute`, `Rights`, `Delegation`, `Awareness`

## Desenvolvimento

```bash
# Install in development mode
pip install -e ".[dev]"

# Run tests
pytest -v

# Async tests
pytest -v --asyncio-mode=auto
```

### Dependências

- `pynacl` — Criptografia Ed25519
- `jsonschema` — Validação JSON Schema
- `pydantic` v2 — Modelos de dados
- `typer` — Framework de CLI

## Licença

Apache-2.0
