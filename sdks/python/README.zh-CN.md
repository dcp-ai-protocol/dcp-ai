<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# dcp-ai — Python SDK

> 本文是[英文版](README.md)的参考译文，更新于 26/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

Digital Citizenship Protocol（DCP v2.0）的官方 Python SDK。提供 Pydantic v2 模型、后量子混合签名（Ed25519 + ML-DSA-65，以及 SLH-DSA-192f）、ML-KEM-768 KEM 原语、带 `pq_over_classical` 绑定的复合签名、V1 和 V2 bundle 的签名与验证、OpenTelemetry 可观测性、DCP-04 至 DCP-09 的行为，以及功能完整的 CLI。

<a id="installation"></a>

## 安装

**Python SDK。** 自 2.10.0 起，此 SDK 包含 V2 验证器修复、委托人信任与 `strict-v1`、委托链、A2A 接收窗口、受限的吊销工作线程，以及实验性、需显式启用的 `dcp-jcs-v2` API。它还包含修复后的 FastAPI、LangChain、OpenAI 和 CrewAI 适配器。`dcp-jcs-v1` 仍是规范性默认配置。安装：

**Python SDK 2.10.1。** 此版本还会在 [VERIFICATION.md 的 V2-11](../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) 中的二级 SHA3-256 字段存在时验证它们：`audit_merkle_root_secondary`、每个 `prev_hash_secondary` 和每个 `intent_hash_secondary`。不存在的字段不作要求，因此已验证的 bundle 可能没有完整的二级链；存在的字段如果是 `null`、不是字符串或不一致，则被拒绝。API、结果字段、`dcp-jcs-v1` 和 `hash_alg` 的处理均不变。2.10.0 不检查这些字段。下面的安装命令指定的是此版本；它在注册表中的可用情况见[已发布版本](../../docs/README.md#published-versions)。

```bash
pip install "dcp-ai>=2.10.1,<3"
```

**从 2.9.0 升级。** FastAPI 现在验证 V2 签名，而不是仅接受结构。FastAPI 和 LangChain/OpenAI 适配器对 V1 的接受遵循验证器策略。V2 还会拒绝旧版本曾接受的非规范签名编码、不一致或绑定错误的证据。请保留历史证据及其验证版本，不要静默重新签名。信任、资源预算和断开连接处理仍由运营方显式选择。验证或准入不授权任何操作。

在 Python 3.10 中，取消受容量限制的拒绝列表下载时，即使结果刚刚到达，也会传播取消。容量仍仅在下载线程真正结束时释放。

如需开发源码，也可使用可编辑的检出代码：

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "dcp-ai/sdks/python"
```

<a id="optional-extras"></a>

### 可选 extras

来自注册表（2.10.1 或更高版本）；从检出副本安装时同样适用这些 extras：`pip install -e "dcp-ai/sdks/python[fastapi]"`。

```bash
pip install "dcp-ai[fastapi]>=2.10.1,<3"    # FastAPI middleware
pip install "dcp-ai[langchain]>=2.10.1,<3"  # LangChain integration
pip install "dcp-ai[openai]>=2.10.1,<3"     # OpenAI wrapper
pip install "dcp-ai[crewai]>=2.10.1,<3"     # CrewAI multi-agent
pip install "dcp-ai[otlp]>=2.10.1,<3"       # OpenTelemetry OTLP exporter
```

<a id="features"></a>

## 功能

| 领域 | 状态 |
|---|---|
| Ed25519 / ML-DSA-65（FIPS 204）提供者 | 是 |
| SLH-DSA-192f 提供者 | 是，FIPS 205（pure，空上下文），可与其他 SDK 互操作 |
| ML-KEM-768 | KEM 原语：是（`MlKem768Provider`，FIPS 203）。DCP-04 的 X25519 + ML-KEM-768 混合密钥交换：尚未支持 |
| 复合签名（`pq_over_classical`）+ 验证 | 是 |
| 规范 JSON v2 + 域分离 | 是 |
| 双哈希（SHA-256 + SHA3-256）+ Merkle 根 | 是 |
| bundle 签名 + 验证 | V1：是。V2（`SignedBundleV2`）：是，`BundleBuilderV2` / `sign_bundle_v2` / `verify_signed_bundle_v2` |
| DCP-04 A2A 发现 + 握手 + AES-256-GCM 会话（通过 `cryptography`）；在窗口内每条消息只接受一次（§8.4） | 是 |
| DCP-05 智能体生命周期（启用 / 活力 / 停用） | 是 |
| DCP-06 数字继承（遗嘱、记忆转移、仪式） | 是 |
| DCP-07 争议解决 + 仲裁 + 判例 | 是 |
| DCP-08 权利 + 义务 + 合规 | 是 |
| DCP-09 委托 + 可验证的委托链（`create_sub_mandate`、`verify_mandate_chain`，§3.5）+ 关注阈值 + 委托人镜像 | 是 |
| 会话 nonce 工具、安全等级引擎（`compute_security_tier(intent, policy_decision, mandate_chain_tier)`，规范 §14.2）、紧急吊销 | 是 |
| 惰性 PQ 检查点 + `PQCheckpointManager` | 是 |
| 盲化 RPR、多方授权、算法公告工具 | 是 |
| 规范错误码（所有 SDK 共享的 38 个）+ `detect_wire_format` | 是 |
| OpenTelemetry / OTLP 导出器（可选的 `[otlp]` extra） | 是 |
| 准入：受信任的委托人和 `strict-v1` 配置 | 是（2.10.0） |
| 规范化候选 `dcp-jcs-v2`（入口、路由器、字节验证器、生成器） | 实验性、选择加入；非规范性 |

<a id="quickstart"></a>

## 快速开始

用 Ed25519 签名的 V1 bundle。RPR 用委托人的密钥签名，护照用智能体的密钥签名，
二者都针对去掉 `signature` 字段后对象的规范 JSON；`create_audit_entry` 计算
`intent_hash` 和 `prev_hash` 链。`verify_signed_bundle` 检查 bundle 签名、其哈希和
链，而不检查这些内部签名：请像下面这样自行检查。关于 V2 bundle，参见 [V2 bundle](#v2-bundles)。

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

SDK 包含一个用 Typer 构建的 CLI。安装后可通过 `dcp` 使用。

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

<a id="api-reference"></a>

## API 参考

<a id="crypto"></a>

### 密码学

| 函数 | 签名 | 说明 |
|----------|-----------|-------------|
| `generate_keypair()` | `() -> dict[str, str]` | 返回 `{"public_key_b64": ..., "secret_key_b64": ...}` |
| `sign_object(obj, secret_key_b64)` | `(Any, str) -> str` | 签名并返回 base64 |
| `verify_object(obj, signature_b64, public_key_b64)` | `(Any, str, str) -> bool` | 验证签名 |
| `canonicalize(obj)` | `(Any) -> str` | 确定性 JSON |
| `public_key_from_secret(secret_key_b64)` | `(str) -> str` | 导出公钥 |

<a id="merkle--hashing"></a>
<a id="merkle-hashing"></a>

### Merkle 与哈希

| 函数 | 签名 | 说明 |
|----------|-----------|-------------|
| `hash_object(obj)` | `(Any) -> str` | 规范化 JSON 的 SHA-256 |
| `merkle_root_from_hex_leaves(leaves)` | `(list[str]) -> str \| None` | Merkle 根 |
| `merkle_root_for_audit_entries(entries)` | `(list[Any]) -> str \| None` | 审计条目的 Merkle 根 |
| `intent_hash(intent)` | `(Any) -> str` | 意图哈希 |
| `prev_hash_for_entry(prev_entry)` | `(Any) -> str` | 前一条目的哈希 |

<a id="schema-validation"></a>

### 模式验证

| 函数 | 签名 | 说明 |
|----------|-----------|-------------|
| `validate_schema(schema_name, data)` | `(str, Any) -> dict` | 返回 `{"valid": bool, "errors": [...]}` |
| `validate_bundle(bundle)` | `(dict) -> dict` | 验证完整的 bundle |

<a id="bundle-builder"></a>

### bundle 构建器

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

<a id="bundle-signing"></a>

### bundle 签名

```python
# Signature (not runnable)
sign_bundle(
    bundle: CitizenshipBundle,
    secret_key_b64: str,
    signer_type: str = "human",
    signer_id: str | None = None,
) -> dict[str, Any]
```

<a id="bundle-verification"></a>

### bundle 验证

```python
# Signature (not runnable)
verify_signed_bundle(
    signed_bundle: dict[str, Any],
    public_key_b64: str | None = None,
) -> dict[str, Any]  # {"verified": bool, "errors": [...]}
```

验证内容：模式、Ed25519 签名、`bundle_hash`、`merkle_root`、`intent_hash` 链、`prev_hash` 链。

<a id="v2-bundles"></a>

### V2 bundle

`BundleBuilderV2`、`sign_bundle_v2` 和 `verify_signed_bundle_v2`（位于 `dcp_ai.v2`）移植自 TypeScript SDK 的 `builder-v2.ts`、`signer-v2.ts` 和 `verify-v2.ts`。构件是 `SignedPayload` 字典（`{"payload", "payload_hash", "composite_sig"}`）；bundle 签名是针对清单的复合签名。

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

验证器还会检查每个构件自身的复合签名（RPR 用委托人的 `binding_keys`，其余用护照密钥），并在所有策略模式下拒绝存在但无效的 PQ 签名。模式取策略模式与安全等级模式中较严格者（规范 §14.3），`details["resolved_tier"]` 报告该等级。

<a id="admission-trusted-principals-and-strict-v1"></a>
<a id="admission-trusted-principals-and-strict-v1-unreleased"></a>

### 准入：Trusted Principals 与 strict-v1

已验证的 bundle 是由其列出的密钥签署的；这并不能证明委托人是谁。只有当委托人签名是用你的信任集合中列出的某个委托人的密钥做出时，准入才会接受该 bundle；还可以选择在由运营方固定的 `strict-v1` 配置下进行（混合签名、已签名的受众、最长 300 秒的会话、新近的吊销快照）。

```python
# Fragment, inside an async function: trust_set comes from operator configuration, signed_bundle from the request, snapshot from your revocation source, registry as in V2 Bundles.
from dcp_ai.v2 import admit_signed_bundle_v2, create_principal_trust_store, resolve_strict_v1_profile

trust = create_principal_trust_store(trust_set)  # AdmissionConfigError on a bad trust set
profile = resolve_strict_v1_profile({"profile": "strict-v1", "verifier_id": "api.acme.example"})
result = await admit_signed_bundle_v2(signed_bundle, registry, profile=profile, trust=trust, revocation=snapshot)
# result["verified"], result["principal_trust"], result["profile_compliance"], result["admitted"],
# result["action_authorized"] (always False), result["errors"] [{"code", "message"}]
```

- `verify_signed_bundle_v2(bundle, registry, policy, now_ms=...)` 接受一个可选的时钟，并报告 `details["signer_keys"]`；不提供时行为与以前相同。
- `evaluate_admission_v2` 评估你已有的验证结果（不做密码学运算，也没有 I/O）并信任该结果；`revocation_subjects` 列出吊销信息源必须回答的对象，`deny_list_revocation_source(url)` 读取参考吊销服务的拒绝列表；使用 `workers=DenyListWorkers(max_workers=...)` 时，其下载线程会被计数并设上限，直到真正结束（选择加入；参见 FastAPI 的 README）。
- FastAPI：`DCPVerifyMiddleware(app, require_bundle=True, trusted_principals=..., profile=..., revocation_source=...)`；参见 [`integrations/fastapi/README.md`](../../integrations/fastapi/README.md)。指南：[`docs/ADMISSION.md`](../../docs/ADMISSION.md)。规范和代码：[`spec/profiles/admission`](../../spec/profiles/admission/README.md)。

<a id="delegation-chains-dcp-09-35"></a>
<a id="delegation-chains-dcp-09-35-unreleased"></a>

### 委托链（DCP-09 §3.5）

根委托书由人类签署（`create_delegation_mandate`）；持有它的智能体可以向另一个智能体签发
子委托书（`create_sub_mandate`），用其自己的密钥签名。`verify_mandate_chain` 从根开始、离线地检查
整条链：直到人类的签名、与父级的链接和深度、`sub_delegation`、
嵌套的有效期窗口、权限收窄（操作、`data_classes` 和 `limits` 只能缩小）、安全等级
下限以及吊销。

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

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>
<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

### 实验性：规范化候选 `dcp-jcs-v2`（选择加入）

非规范性，也未启用：`dcp-jcs-v1` 仍是唯一的规范化配置，任何默认值、构建器、
签名器或验证器都不变。这些模块不由 `dcp_ai.v2` 重新导出；它们只为自行导入的调用方提供，Python 2.10.0 也是如此。已验证的候选 bundle 不授予信任或准入。
设计和契约：[`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md)
（§15 入口、§16 路由器、§17 验证器、§18 生成器）。

| 模块 | API |
|---|---|
| `dcp_ai.v2.experimental_candidate_ingress` | `experimental_candidate_ingress(data)`：`CandidateIngressAccept(value, canonical, canonical_sha256)` 或 `CandidateIngressReject(reject_class, offset)` |
| `dcp_ai.v2.experimental_candidate_router` | `create_router(transport=..., accepted_profiles=..., historical=...)`；解码器 `JSON_LOADS_BYTES` 和 `JSON_LOADS_STRICT_DECODE`，都不是默认值 |
| `dcp_ai.v2.experimental_candidate_verify` | `create_verifier(...)`，然后 `await verifier.verify(data, registry, policy=None, now_ms=None)`：路由、所进入的验证器及其结果 |
| `dcp_ai.v2.experimental_candidate_produce` | `sign_payload(registry, context, input, keys)` 和 `sign_bundle(registry, parts, signer, options)`，在调用时检查并复制输入，返回一个 awaitable；`ExperimentalCandidateProduceError` 表示因输入的取值域或形式而产生的拒绝，在调用任何签名器之前抛出 |

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

<a id="pydantic-models"></a>

### Pydantic 模型

所有 DCP v1 构件都以带自动验证的 Pydantic v2 模型提供：

`ResponsiblePrincipalRecord`, `AgentPassport`, `Intent`, `IntentTarget`, `PolicyDecision`, `AuditEntry`, `AuditEvidence`, `CitizenshipBundle`, `SignedBundle`, `BundleSignature`, `SignerInfo`, `RevocationRecord`, `HumanConfirmation`

**V2 模型**（`dcp_ai.v2.models`），带有 V2 模式的字段。枚举值（生命周期状态、
终止模式、争议状态等）是这些模型的 `Literal` 字段，而不是单独的类：

- 核心 V2：`ResponsiblePrincipalRecordV2`, `BlindedResponsiblePrincipalRecordV2`, `AgentPassportV2`, `KeyEntryV2`, `IntentV2`, `PolicyDecisionV2`, `AuditEventV2`, `PQCheckpoint`, `BundleManifest`, `VerifierPolicy`, `DcpCapabilities`
- DCP-05 — 生命周期：`CommissioningCertificate`, `VitalityMetrics`, `VitalityReport`, `DecommissioningRecord`
- DCP-06 — 继承：`DigitalTestament`, `SuccessorPreference`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `DualHashRef`
- DCP-07 — 争议：`DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`
- DCP-08 — 权利：`RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`
- DCP-09 — 委托：`DelegationMandate`, `SubMandate`, `SubDelegationPolicy`, `AuthorityScopeEntry`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`

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

<a id="domain-separation-v2"></a>

### 域分离（V2）

**V2 域分离上下文：** `Bundle`, `Intent`, `Passport`, `Revocation`, `Governance`, `Lifecycle`, `Succession`, `Dispute`, `Rights`, `Delegation`, `Awareness`

<a id="development"></a>

## 开发

```bash
# Install in development mode
pip install -e ".[dev]"

# Run tests
pytest -v

# Async tests
pytest -v --asyncio-mode=auto
```

<a id="dependencies"></a>

### 依赖

- `pynacl` — Ed25519 密码学
- `jsonschema` — JSON Schema 验证
- `pydantic` v2 — 数据模型
- `typer` — CLI 框架
- `pqcrypto` ≥ 1.0 — ML-DSA-65、SLH-DSA-192f、ML-KEM-768（FIPS 204/205/203）
- `cryptography` — 用于 DCP-04 A2A 会话的 AES-256-GCM

<a id="license"></a>

## 许可证

Apache-2.0
