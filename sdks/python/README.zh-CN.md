<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# dcp-ai — Python SDK

数字公民身份协议 (DCP) 的官方 Python SDK。Pydantic v2 模型、Ed25519 密码学、凭证包验证以及功能齐全的 CLI。

## 安装

```bash
pip install dcp-ai
```

### 可选附加依赖

```bash
pip install "dcp-ai[fastapi]"    # FastAPI middleware
pip install "dcp-ai[langchain]"  # LangChain integration
pip install "dcp-ai[openai]"     # OpenAI wrapper
pip install "dcp-ai[crewai]"     # CrewAI multi-agent
```

## 快速开始

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

SDK 包含一个使用 Typer 构建的 CLI。安装后可作为 `dcp` 使用。

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

## API 参考

### 加密

| 函数 | 签名 | 描述 |
|----------|-----------|-------------|
| `generate_keypair()` | `() -> dict[str, str]` | 返回 `{"public_key_b64": ..., "secret_key_b64": ...}` |
| `sign_object(obj, secret_key_b64)` | `(Any, str) -> str` | 签名，返回 base64 |
| `verify_object(obj, signature_b64, public_key_b64)` | `(Any, str, str) -> bool` | 验证签名 |
| `canonicalize(obj)` | `(Any) -> str` | 确定性 JSON |
| `public_key_from_secret(secret_key_b64)` | `(str) -> str` | 派生公钥 |

### Merkle 与哈希

| 函数 | 签名 | 描述 |
|----------|-----------|-------------|
| `hash_object(obj)` | `(Any) -> str` | 规范化 JSON 的 SHA-256 |
| `merkle_root_from_hex_leaves(leaves)` | `(list[str]) -> str \| None` | Merkle 根 |
| `merkle_root_for_audit_entries(entries)` | `(list[Any]) -> str \| None` | 审计条目的 Merkle 根 |
| `intent_hash(intent)` | `(Any) -> str` | 意图哈希 |
| `prev_hash_for_entry(prev_entry)` | `(Any) -> str` | 前一条目哈希 |

### Schema 验证

| 函数 | 签名 | 描述 |
|----------|-----------|-------------|
| `validate_schema(schema_name, data)` | `(str, Any) -> dict` | 返回 `{"valid": bool, "errors": [...]}` |
| `validate_bundle(bundle)` | `(dict) -> dict` | 验证完整凭证包 |

### 凭证包构建器

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

### 凭证包签名

```python
sign_bundle(
    bundle: CitizenshipBundle,
    secret_key_b64: str,
    signer_type: str = "human",
    signer_id: str | None = None,
) -> dict[str, Any]
```

### 凭证包验证

```python
verify_signed_bundle(
    signed_bundle: dict[str, Any],
    public_key_b64: str | None = None,
) -> dict[str, Any]  # {"verified": bool, "errors": [...]}
```

验证项：schema、Ed25519 签名、`bundle_hash`、`merkle_root`、`intent_hash` 链、`prev_hash` 链。

### Pydantic 模型

所有 DCP v1 工件均作为带自动验证的 Pydantic v2 模型提供：

`ResponsiblePrincipalRecord`、`AgentPassport`、`Intent`、`IntentTarget`、`PolicyDecision`、`AuditEntry`、`AuditEvidence`、`CitizenshipBundle`、`SignedBundle`、`BundleSignature`、`SignerInfo`、`RevocationRecord`、`HumanConfirmation`

**V2 模型 (DCP-05–09)：**

DCP-05 — 生命周期：`LifecycleState`、`TerminationMode`、`DataDisposition`、`VitalityMetrics`、`CommissioningCertificate`、`VitalityReport`、`DecommissioningRecord`

DCP-06 — 继任：`TransitionType`、`MemoryDisposition`、`MemoryClassification`、`SuccessorPreference`、`DigitalTestament`、`SuccessionRecord`、`MemoryTransferEntry`、`DualHashRef`、`MemoryTransferManifest`

DCP-07 — 争议：`DisputeType`、`EscalationLevel`、`DisputeStatus`、`ObjectionType`、`AuthorityLevel`、`DisputeRecord`、`ArbitrationResolution`、`JurisprudenceBundle`、`ObjectionRecord`

DCP-08 — 权利：`RightType`、`ComplianceStatus`、`RightEntry`、`RightsDeclaration`、`ObligationRecord`、`RightsViolationReport`

DCP-09 — 委派：`AuthorityScopeEntry`、`DelegationMandate`、`AdvisoryDeclaration`、`PrincipalMirror`、`InteractionRecord`、`ThresholdRule`、`ThresholdOperator`、`ThresholdAction`、`AwarenessThreshold`

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

### 域分离 (V2)

**V2 域分离上下文：** `Bundle`、`Intent`、`Passport`、`Revocation`、`Governance`、`Lifecycle`、`Succession`、`Dispute`、`Rights`、`Delegation`、`Awareness`

## 开发

```bash
# Install in development mode
pip install -e ".[dev]"

# Run tests
pytest -v

# Async tests
pytest -v --asyncio-mode=auto
```

### 依赖

- `pynacl` — Ed25519 密码学
- `jsonschema` — JSON Schema 验证
- `pydantic` v2 — 数据模型
- `typer` — CLI 框架

## 许可证

Apache-2.0
