<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

# dcp-ai — Python SDK

デジタル市民権プロトコル (DCP) 公式Python SDKです。Pydantic v2モデル、Ed25519暗号、バンドル検証、フル機能のCLIを備えています。

## インストール

```bash
pip install dcp-ai
```

### オプションのエクストラ

```bash
pip install "dcp-ai[fastapi]"    # FastAPI middleware
pip install "dcp-ai[langchain]"  # LangChain integration
pip install "dcp-ai[openai]"     # OpenAI wrapper
pip install "dcp-ai[crewai]"     # CrewAI multi-agent
```

## クイックスタート

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

SDKにはTyperで構築されたCLIが含まれています。インストール後、`dcp` として利用できます。

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

## APIリファレンス

### 暗号

| 関数 | シグネチャ | 説明 |
|----------|-----------|-------------|
| `generate_keypair()` | `() -> dict[str, str]` | `{"public_key_b64": ..., "secret_key_b64": ...}` を返す |
| `sign_object(obj, secret_key_b64)` | `(Any, str) -> str` | 署名し、base64を返す |
| `verify_object(obj, signature_b64, public_key_b64)` | `(Any, str, str) -> bool` | 署名を検証 |
| `canonicalize(obj)` | `(Any) -> str` | 決定論的JSON |
| `public_key_from_secret(secret_key_b64)` | `(str) -> str` | 公開鍵を導出 |

### Merkle & ハッシュ

| 関数 | シグネチャ | 説明 |
|----------|-----------|-------------|
| `hash_object(obj)` | `(Any) -> str` | 正規化JSONのSHA-256 |
| `merkle_root_from_hex_leaves(leaves)` | `(list[str]) -> str \| None` | Merkleルート |
| `merkle_root_for_audit_entries(entries)` | `(list[Any]) -> str \| None` | 監査エントリのMerkleルート |
| `intent_hash(intent)` | `(Any) -> str` | 意図ハッシュ |
| `prev_hash_for_entry(prev_entry)` | `(Any) -> str` | 前のエントリのハッシュ |

### スキーマ検証

| 関数 | シグネチャ | 説明 |
|----------|-----------|-------------|
| `validate_schema(schema_name, data)` | `(str, Any) -> dict` | `{"valid": bool, "errors": [...]}` を返す |
| `validate_bundle(bundle)` | `(dict) -> dict` | 完全なバンドルを検証 |

### バンドルビルダー

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

### バンドル署名

```python
sign_bundle(
    bundle: CitizenshipBundle,
    secret_key_b64: str,
    signer_type: str = "human",
    signer_id: str | None = None,
) -> dict[str, Any]
```

### バンドル検証

```python
verify_signed_bundle(
    signed_bundle: dict[str, Any],
    public_key_b64: str | None = None,
) -> dict[str, Any]  # {"verified": bool, "errors": [...]}
```

検証する内容: スキーマ、Ed25519署名、`bundle_hash`、`merkle_root`、`intent_hash` チェーン、`prev_hash` チェーン。

### Pydanticモデル

すべてのDCP v1成果物は、自動検証付きのPydantic v2モデルとして利用可能です。

`ResponsiblePrincipalRecord`、`AgentPassport`、`Intent`、`IntentTarget`、`PolicyDecision`、`AuditEntry`、`AuditEvidence`、`CitizenshipBundle`、`SignedBundle`、`BundleSignature`、`SignerInfo`、`RevocationRecord`、`HumanConfirmation`

**V2モデル (DCP-05–09):**

DCP-05 — Lifecycle: `LifecycleState`、`TerminationMode`、`DataDisposition`、`VitalityMetrics`、`CommissioningCertificate`、`VitalityReport`、`DecommissioningRecord`

DCP-06 — Succession: `TransitionType`、`MemoryDisposition`、`MemoryClassification`、`SuccessorPreference`、`DigitalTestament`、`SuccessionRecord`、`MemoryTransferEntry`、`DualHashRef`、`MemoryTransferManifest`

DCP-07 — Disputes: `DisputeType`、`EscalationLevel`、`DisputeStatus`、`ObjectionType`、`AuthorityLevel`、`DisputeRecord`、`ArbitrationResolution`、`JurisprudenceBundle`、`ObjectionRecord`

DCP-08 — Rights: `RightType`、`ComplianceStatus`、`RightEntry`、`RightsDeclaration`、`ObligationRecord`、`RightsViolationReport`

DCP-09 — Delegation: `AuthorityScopeEntry`、`DelegationMandate`、`AdvisoryDeclaration`、`PrincipalMirror`、`InteractionRecord`、`ThresholdRule`、`ThresholdOperator`、`ThresholdAction`、`AwarenessThreshold`

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

### ドメイン分離 (V2)

**V2ドメイン分離コンテキスト:** `Bundle`、`Intent`、`Passport`、`Revocation`、`Governance`、`Lifecycle`、`Succession`、`Dispute`、`Rights`、`Delegation`、`Awareness`

## 開発

```bash
# Install in development mode
pip install -e ".[dev]"

# Run tests
pytest -v

# Async tests
pytest -v --asyncio-mode=auto
```

### 依存関係

- `pynacl` — Ed25519暗号
- `jsonschema` — JSONスキーマ検証
- `pydantic` v2 — データモデル
- `typer` — CLIフレームワーク

## ライセンス

Apache-2.0
