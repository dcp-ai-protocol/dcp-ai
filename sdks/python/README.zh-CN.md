<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# dcp-ai — Python SDK

数字公民身份协议 (DCP v2.0) 的官方 Python SDK。Pydantic v2 模型、混合后量子签名 (Ed25519 + ML-DSA-65，另有 SLH-DSA-192f)、ML-KEM-768 KEM 原语、带 `pq_over_classical` 绑定的复合签名、V1 与 V2 凭证包签名与验证、OpenTelemetry 可观测性、DCP-04 至 DCP-09 行为，以及功能齐全的 CLI。

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
pip install "dcp-ai[otlp]"       # OpenTelemetry OTLP exporter
```

## 功能

| 范畴 | 状态 |
|---|---|
| Ed25519 / ML-DSA-65 (FIPS 204) provider | 是 |
| SLH-DSA-192f provider | 是，FIPS 205（纯模式、空上下文），可与其他 SDK 互操作 |
| ML-KEM-768 | KEM 原语：是（`MlKem768Provider`，FIPS 203）。DCP-04 的 X25519 + ML-KEM-768 混合密钥交换：暂不支持 |
| 复合签名 (`pq_over_classical`) + 验证 | 是 |
| 规范 JSON v2 + 域分离 | 是 |
| 双哈希 (SHA-256 + SHA3-256) + Merkle 根 | 是 |
| 凭证包签名与验证 | V1：是。V2 (`SignedBundleV2`)：是，`BundleBuilderV2` / `sign_bundle_v2` / `verify_signed_bundle_v2` |
| DCP-04 A2A 发现 + 握手 + AES-256-GCM 会话（通过 `cryptography`）；在窗口内每条消息只接受一次（§8.4） | 是 |
| DCP-05 代理生命周期（委任 / 活力 / 停用） | 是 |
| DCP-06 数字继承（数字遗嘱、记忆迁移、交接仪式） | 是 |
| DCP-07 争议解决 + 仲裁 + 判例 | 是 |
| DCP-08 权利与义务 + 合规 | 是 |
| DCP-09 委托 + 可验证的委托链（`create_sub_mandate`、`verify_mandate_chain`，§3.5）+ 感知阈值 + 主体镜像 | 是 |
| 会话随机数助手、安全等级引擎（`compute_security_tier(intent, policy_decision, mandate_chain_tier)`，spec §14.2）、紧急撤销 | 是 |
| 惰性 PQ 检查点 + `PQCheckpointManager` | 是 |
| 盲化 RPR、多方授权、算法建议助手 | 是 |
| 规范错误码（38 项，跨所有 SDK 共享）+ `detect_wire_format` | 是 |
| OpenTelemetry / OTLP 导出器（可选 `[otlp]` 附加依赖） | 是 |

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

### V2 凭证包

`dcp_ai.v2` 中的 `BundleBuilderV2`、`sign_bundle_v2` 和 `verify_signed_bundle_v2` 移植自 TypeScript SDK 的 `builder-v2.ts`、`signer-v2.ts` 和 `verify-v2.ts`。工件为 `SignedPayload` 字典（`{"payload", "payload_hash", "composite_sig"}`）；凭证包签名是对 manifest 的复合签名。

```python
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

验证器还会检查每个工件自身的复合签名（RPR 使用主体的 `binding_keys`，其余使用护照密钥），并且在任何策略模式下都会拒绝存在但无效的 PQ 签名。模式取策略模式与安全等级模式中更严格的一个（spec §14.3），`details["resolved_tier"]` 返回该等级。

### 准入：受信任的委托人与 strict-v1

已验证的凭证包由其自身列出的密钥签名，这并不能证明委托人是谁。准入只接受这样的凭证包：其委托人签名所用的密钥属于信任集中列出的委托人。还可以选择由运营方固定的 `strict-v1` 配置（混合签名、已签名的受众、最长 300 秒的会话、最新的吊销快照）。

```python
from dcp_ai.v2 import admit_signed_bundle_v2, create_principal_trust_store, resolve_strict_v1_profile

trust = create_principal_trust_store(trust_set)  # AdmissionConfigError on a bad trust set
profile = resolve_strict_v1_profile({"profile": "strict-v1", "verifier_id": "api.acme.example"})
result = await admit_signed_bundle_v2(signed_bundle, registry, profile=profile, trust=trust, revocation=snapshot)
# result["verified"], result["principal_trust"], result["profile_compliance"], result["admitted"],
# result["action_authorized"] (always False), result["errors"] [{"code", "message"}]
```

- `verify_signed_bundle_v2(bundle, registry, policy, now_ms=...)` 接受可选的时钟并报告 `details["signer_keys"]`；不提供时行为与之前相同。
- `evaluate_admission_v2` 评估并信任已有的验证结果（不做密码运算，也不做 I/O）；`revocation_subjects` 列出吊销来源需要回答的对象，`deny_list_revocation_source(url)` 读取参考吊销服务的拒绝列表。
- FastAPI：`DCPVerifyMiddleware(app, require_bundle=True, trusted_principals=..., profile=..., revocation_source=...)`；参见 [`integrations/fastapi/README.md`](../../integrations/fastapi/README.md)。指南：[`docs/ADMISSION.md`](../../docs/ADMISSION.md)。规范与错误码：[`spec/profiles/admission`](../../spec/profiles/admission/README.md)。

### 委托链 (DCP-09 §3.5)

根授权由人类签名（`create_delegation_mandate`）；持有根授权的智能体可以向另一个智能体签发子授权（`create_sub_mandate`），
并用自己的密钥签名。`verify_mandate_chain` 离线验证以根授权开头的链：一直追溯到人类的签名、父级链接与深度、`sub_delegation`、
嵌套的有效期窗口、权限衰减（动作、`data_classes` 和 `limits` 只能收窄）、安全等级下限以及撤销。

```python
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

### Pydantic 模型

所有 DCP v1 工件均作为带自动验证的 Pydantic v2 模型提供：

`ResponsiblePrincipalRecord`、`AgentPassport`、`Intent`、`IntentTarget`、`PolicyDecision`、`AuditEntry`、`AuditEvidence`、`CitizenshipBundle`、`SignedBundle`、`BundleSignature`、`SignerInfo`、`RevocationRecord`、`HumanConfirmation`

**V2 模型 (DCP-05–09)：**

DCP-05 — 生命周期：`LifecycleState`、`TerminationMode`、`DataDisposition`、`VitalityMetrics`、`CommissioningCertificate`、`VitalityReport`、`DecommissioningRecord`

DCP-06 — 继承：`TransitionType`、`MemoryDisposition`、`MemoryClassification`、`SuccessorPreference`、`DigitalTestament`、`SuccessionRecord`、`MemoryTransferEntry`、`DualHashRef`、`MemoryTransferManifest`

DCP-07 — 争议：`DisputeType`、`EscalationLevel`、`DisputeStatus`、`ObjectionType`、`AuthorityLevel`、`DisputeRecord`、`ArbitrationResolution`、`JurisprudenceBundle`、`ObjectionRecord`

DCP-08 — 权利：`RightType`、`ComplianceStatus`、`RightEntry`、`RightsDeclaration`、`ObligationRecord`、`RightsViolationReport`

DCP-09 — 委托：`AuthorityScopeEntry`、`DelegationMandate`、`AdvisoryDeclaration`、`PrincipalMirror`、`InteractionRecord`、`ThresholdRule`、`ThresholdOperator`、`ThresholdAction`、`AwarenessThreshold`

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
- `pqcrypto` ≥ 1.0 — ML-DSA-65、SLH-DSA-192f、ML-KEM-768（FIPS 204/205/203）
- `cryptography` — DCP-04 A2A 会话的 AES-256-GCM

## 许可证

Apache-2.0
