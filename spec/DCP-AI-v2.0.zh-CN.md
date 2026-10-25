<sub>[English](DCP-AI-v2.0.md) · **中文** · [Español](DCP-AI-v2.0.es.md) · [日本語](DCP-AI-v2.0.ja.md) · [Português](DCP-AI-v2.0.pt-BR.md)</sub>

<a id="dcp-ai-v20-normative-specification"></a>

# DCP-AI v2.0 规范性规范

> 本文是[英文规范](DCP-AI-v2.0.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

**状态：** Final  
**版本：** 2.0.0  
**日期：** 2026-02-26  
**作者：** DCP-AI Protocol Governance  

---

<a id="1-introduction"></a>

## 1. 引言

Digital Citizenship Protocol for AI（DCP-AI）v2.0 定义了一个抗量子框架，用于代理身份、意图声明、策略管控和审计轨迹。它取代 v1.0，引入了复合绑定的混合签名、域分离、会话绑定，以及由验证方主导的策略执行。

<a id="11-design-goals"></a>

### 1.1 设计目标

1. **后量子安全**：所有身份和审计工件都通过混合复合签名抵御量子攻击者。
2. **不可否认性**：代理和人类不能否认已记录在已签名审计链中的行动。
3. **篡改可发现**：哈希链、Merkle 根和区块链锚定提供多层篡改检测。
4. **密码敏捷性**：算法注册表和提供方抽象使算法迁移无需更改协议。
5. **隐私**：盲化 RPR 模式在保持可验证性的同时保护个人信息。
6. **互操作性**：跨 SDK 验证、CBOR 传输格式和 gRPC 支持。

<a id="12-notation"></a>

### 1.2 记法

- `||` 表示字节拼接
- `UTF8(s)` 表示字符串 `s` 的 UTF-8 编码
- `canonical(obj)` 表示依据基于 RFC 8785 JCS 的 `dcp-jcs-v1` 配置文件（§15）进行规范化
- `SHA-256(m)` 表示消息 `m` 的 SHA-256 哈希
- `hex(b)[0:n]` 表示字节序列 `b` 的前 `n` 个十六进制字符

---

<a id="2-algorithm-registry"></a>

## 2. 算法注册表

<a id="21-signature-algorithms"></a>

### 2.1 签名算法

| 标识符 | 标准 | 公钥大小 | 签名大小 | 安全级别 | 状态 |
|---|---|---|---|---|---|
| `ed25519` | RFC 8032 | 32 B | 64 B | 经典 128 位 | ACTIVE |
| `ml-dsa-65` | FIPS 204 | 1952 B | 3309 B | NIST 3 级 PQ | ACTIVE（主要 PQ） |
| `ml-dsa-87` | FIPS 204 | 2592 B | 4627 B | NIST 5 级 PQ | ACTIVE（高保证） |
| `slh-dsa-192f` | FIPS 205 | 48 B | 35664 B | NIST 3 级 PQ | ACTIVE（备用 PQ） |
| `slh-dsa-256f` | FIPS 205 | 64 B | 49856 B | NIST 5 级 PQ | RESERVED |

> *参考性说明（2026 年 10 月 25 日），不属于规范性文本：* 目前还没有任何 DCP-AI SDK 实现 `ml-dsa-87`；SDK 使用 `ed25519`、`ml-dsa-65` 和 `slh-dsa-192f` 签名和验证（[docs/NIST_CONFORMITY.md](../docs/NIST_CONFORMITY.md)）。

<a id="22-kem-algorithms"></a>

### 2.2 KEM 算法

| 标识符 | 标准 | 公钥大小 | 密文大小 | 安全级别 |
|---|---|---|---|---|
| `x25519` | RFC 7748 | 32 B | 32 B | 经典 128 位 |
| `ml-kem-768` | FIPS 203 | 1184 B | 1088 B | NIST 3 级 PQ |
| `x25519-ml-kem-768` | 混合 | 1216 B | 1120 B | 混合 3 级 |

<a id="23-hash-algorithms"></a>

### 2.3 哈希算法

| 标识符 | 输出 | 用途 |
|---|---|---|
| `sha256` | 32 B | 3 级部署的默认（DEFAULT）算法 |
| `sha3-256` | 32 B | 双哈希模式的辅助哈希 |
| `sha384` | 48 B | 5 级部署推荐（RECOMMENDED） |

<a id="24-numeric-types"></a>

### 2.4 数值类型

DCP-AI v2.0 中的所有数值字段都必须（MUST）是整数。禁止使用浮点值，以消除规范化的歧义。

---

<a id="3-key-objects"></a>

## 3. 密钥对象

<a id="31-key-entry"></a>

### 3.1 密钥条目

```json
{
  "kid": "<32 hex chars>",
  "alg": "<algorithm identifier>",
  "public_key_b64": "<base64-encoded public key>",
  "created_at": "<ISO 8601>",
  "expires_at": "<ISO 8601 | null>",
  "status": "active | revoked | expired"
}
```

<a id="32-deterministic-kid-derivation"></a>

### 3.2 确定性的 kid 派生

```
kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key_bytes))[0:32]
```

特性：唯一、确定、抗碰撞（截断 SHA-256 得到的 128 位）。

---

<a id="4-domain-separation"></a>

## 4. 域分离

每个签名都必须（MUST）包含一个域分离标签：

```
signed_bytes = UTF8(context_tag) || 0x00 || canonical_payload_bytes
```

<a id="41-context-tags"></a>

### 4.1 上下文标签

| 上下文标签 | 用途 |
|---|---|
| `DCP-AI.v2.AgentPassport` | 代理护照的自签名 |
| `DCP-AI.v2.ResponsiblePrincipal` | 人类绑定记录的签名 |
| `DCP-AI.v2.Intent` | 意图声明的签名 |
| `DCP-AI.v2.PolicyDecision` | 策略引擎的签名 |
| `DCP-AI.v2.AuditEvent` | 逐事件审计签名 |
| `DCP-AI.v2.Bundle` | bundle 签名 |
| `DCP-AI.v2.Revocation` | 撤销记录的签名 |
| `DCP-AI.v2.KeyRotation` | 密钥轮换证明 |
| `DCP-AI.v2.ProofOfPossession` | 持有证明的挑战与响应 |
| `DCP-AI.v2.JurisdictionAttestation` | 司法管辖区证明 |
| `DCP-AI.v2.HumanConfirmation` | 人工确认 |
| `DCP-AI.v2.AlgorithmAdvisory` | 算法弃用建议 |
| `DCP-AI.v2.Governance` | 治理操作 |
| `DCP-AI.v2.Delegation` | 根委托授权书（人类签名）和交互记录（DCP-09） |
| `DCP-AI.v2.SubMandate` | 由委托代理签署的子授权书（DCP-09 §3.5） |

---

<a id="5-composite-signatures"></a>

## 5. 复合签名

<a id="51-binding-protocol"></a>

### 5.1 绑定协议

```
Step 1: classical_sig = Classical.sign(context || 0x00 || payload)
Step 2: pq_sig = PQ.sign(context || 0x00 || payload || classical_sig)
```

PQ 签名覆盖经典签名。去掉任一组成部分都会使两者都验证失败。

<a id="52-wire-format"></a>

### 5.2 传输格式

```json
{
  "composite_sig": {
    "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
    "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
    "binding": "pq_over_classical"
  }
}
```

<a id="53-binding-modes"></a>

### 5.3 绑定模式

- `pq_over_classical`：v2.0 中为强制（MANDATORY）。PQ 签名覆盖经典签名。
- `classical_only`：过渡期间允许。PQ 字段为 `null`。

---

<a id="6-signedpayload-envelope"></a>

## 6. SignedPayload 信封

工件本身从不包含签名数据。签名位于同级字段中：

```json
{
  "payload": { /* pure artifact */ },
  "payload_hash": "sha256:...",
  "composite_sig": { /* ... */ }
}
```

被签名的字节：`context_tag || 0x00 || canonical(payload)`

---

<a id="7-verification-modes"></a>

## 7. 验证模式

<a id="71-modes"></a>

### 7.1 模式

| 模式 | 是否需要经典签名 | 是否需要 PQ 签名 | V1 bundle |
|---|---|---|---|
| `classical_only` | 是 | 否 | 是 |
| `pq_only` | 否 | 是 | 否 |
| `hybrid_required` | 是 | 是 | 可配置 |
| `hybrid_preferred` | 是 | 否（警告） | 可配置 |

在任何模式下，存在的 PQ 签名（`pq_over_classical`）都必须（MUST）验证通过。`hybrid_preferred` 和 `classical_only` 只容许其缺失。

<a id="72-verifier-authoritative-policy"></a>

### 7.2 由验证方主导的策略

签名策略由验证方的配置决定，而不是由代理决定。验证方从自己的配置中加载策略：

```json
{
  "verifier_policy": {
    "default_mode": "hybrid_required",
    "risk_overrides": { "high": "hybrid_required", "medium": "hybrid_required", "low": "hybrid_preferred" },
    "min_classical": 1,
    "min_pq": 1,
    "accepted_classical_algs": ["ed25519"],
    "accepted_pq_algs": ["ml-dsa-65", "slh-dsa-192f"],
    "require_session_binding": true,
    "require_composite_binding": true,
    "allow_classical_fallback_disable": false,
    "warn_classical_only_deprecated": false,
    "advisory_rejected_algs": []
  }
}
```

安全层级（§14.3）只能使该策略所选的模式更严格。

<a id="73-pq-only-mode-phase-3"></a>

### 7.3 仅 PQ 模式（第 3 阶段）

当 `default_mode` 为 `pq_only` 时：

- 接受经典签名，但不要求
- `min_classical` 为 0，`min_pq` 为 1
- 不要求复合绑定
- 拒绝 V1 bundle
- 仅经典签名的 bundle 会发出弃用警告

---

<a id="8-session-binding"></a>

## 8. 会话绑定

一个 256 位随机 `session_nonce`（64 个十六进制字符）把一个会话中的所有工件绑定在一起：

```
session_nonce = hex(random(32))
```

每个 V2 工件都包含 `session_nonce`。验证方必须（MUST）检查一个 bundle 中的所有工件共享同一个 nonce。

---

<a id="9-bundle-manifest"></a>

## 9. Bundle 清单

bundle 清单以密码学方式绑定所有工件的哈希：

```json
{
  "manifest": {
    "session_nonce": "...",
    "rpr_hash": "sha256:...",
    "passport_hash": "sha256:...",
    "intent_hash": "sha256:...",
    "policy_hash": "sha256:...",
    "audit_merkle_root": "sha256:...",
    "audit_merkle_root_secondary": "sha3-256:...",
    "audit_count": 5,
    "pq_checkpoints": ["ckpt-uuid-1"],
    "canonicalization_profile": "dcp-jcs-v1"
  }
}
```

`canonicalization_profile` 是可选的（OPTIONAL）（目前只定义了 `"dcp-jcs-v1"`；参见 § 15 和 [`CANONICALIZATION_PROFILE.md`](CANONICALIZATION_PROFILE.md)）。遇到没有该字段的 bundle 时，验证方必须（MUST）假定为 `dcp-jcs-v1`。将来的配置文件会使该字段成为必需（REQUIRED）。

bundle 级复合签名对 `canonical(manifest)` 签名。

---

<a id="10-audit-trail"></a>

## 10. 审计轨迹

<a id="101-per-event-signing"></a>

### 10.1 逐事件签名

每个审计事件都用 Ed25519 签名（微秒级延迟）。事件通过 `prev_hash` 构成哈希链。

<a id="102-pq-checkpoints-lazy-model"></a>

### 10.2 PQ 检查点（惰性模型）

每 N 个事件（可配置，默认 10），生成一个 PQ 检查点：对最近 N 个事件的 Merkle 根所作的复合签名。

<a id="103-dual-hash-chains"></a>

### 10.3 双哈希链

从 v2.0 发布起，SHA-256 链和 SHA3-256 链并行运行。如果一个哈希族被攻破，另一个提供连续性。

<a id="104-audit-compaction"></a>

### 10.4 审计压缩

在 N 个事件（默认 1000）之后，生成一个压缩检查点。被压缩的事件可以（MAY）存档，而检查点保留在活动链中。

---

<a id="11-key-management"></a>

## 11. 密钥管理

<a id="111-key-rotation"></a>

### 11.1 密钥轮换

1. 生成新的密钥对
2. 新密钥在 `DCP-AI.v2.KeyRotation` 上下文下签署持有证明挑战（old_kid + new_kid + 时间戳）
3. 旧密钥副署以授权轮换
4. 宽限窗口：两个密钥都被接受的 30 天

<a id="112-key-recovery-m-of-n-social-recovery"></a>

### 11.2 密钥恢复（M-of-N 社交恢复）

主密钥通过 Shamir 秘密共享拆分。各份额使用混合 KEM 加密后交给恢复联系人。

> *参考性说明（2026 年 10 月 25 日），不属于规范性文本：* TypeScript SDK 的密钥恢复和 `dcp recovery-setup` 会生成份额，但不会加密它们；为恢复联系人加密份额由实现者负责。

<a id="113-emergency-revocation"></a>

### 11.3 紧急撤销

预先登记的 `revocation_token = SHA-256(revocation_secret)`。公开原像即可在没有密码学签名的情况下撤销代理的所有密钥。

<a id="114-hsmtpm-support"></a>

### 11.4 HSM/TPM 支持

私钥应当（SHOULD）存储在硬件安全模块中。`CryptoProvider` 接口支持 `HsmCryptoProvider`，后者通过 PKCS#11 把所有操作委托给 HSM。

> *参考性说明（2026 年 10 月 25 日），不属于规范性文本：* TypeScript SDK 源码中的 `HsmCryptoProvider` 是一个模拟模式，而不是 HSM 集成：它没有被导出，没有 PKCS#11 绑定，不得用于签署或验证真实证据。本仓库没有实现任何硬件后端，也不声称通过任何 FIPS 140 验证（[docs/NIST_CONFORMITY.md](../docs/NIST_CONFORMITY.md) §2.2）。

---

<a id="12-privacy"></a>

## 12. 隐私

<a id="121-blinded-rpr"></a>

### 12.1 盲化 RPR

盲化 RPR（`schemas/v2/blinded_rpr.schema.json`）用加盐承诺取代完整 RPR 中的个人信息字段（`legal_name`、`contact`），使 bundle 可以在不含个人信息的情况下发布到透明度日志和锚定中。非个人信息字段（`human_id`、`session_nonce`、`entity_type`、`jurisdiction`、`liability_mode`、`override_rights`、`issued_at`、`expires_at`、`binding_keys`）原样复制，并在披露时与完整 RPR 核对。

```
pii_salt = hex(random(32))
pii_hash = "sha256:" || hex(SHA-256(UTF8(canonical({ contact, legal_name, pii_salt }))))
```

缺失的 `contact` 按 `null` 计入哈希。

- **盐。** `pii_salt` 是完整 RPR 的一个字段：来自 CSPRNG 的 32 字节，以小写十六进制表示，每个 RPR 都重新生成。它受完整 RPR 签名的覆盖，不得（MUST NOT）公开；它从不出现在盲化 RPR 中。重复使用盐会使个人信息相同的记录得到相同的 `pii_hash`，从而可以把它们关联起来。32 字节使“猜测并确认”式的搜索即使借助 Grover 算法也需要 2^128 的工作量。
- **盲化失败即关闭。** 实现必须（MUST）拒绝盲化没有有效 `pii_salt` 的 RPR，验证方必须（MUST）拒绝 `pii_salt` 存在但不是 64 个小写十六进制字符的完整 RPR。盐与完整 RPR 一起签名，因此必须在创建 RPR 时设定：以后可能被盲化的 RPR 应当（SHOULD）从一开始就带有 `pii_salt`。
- **披露。** 盐只与完整 RPR 一起披露，例如披露给监管机构，由其根据完整 RPR 重新计算 `pii_hash`，并比较非个人信息字段。
- **删除。** 删除完整 RPR，连同其中的盐，会使已发布的承诺无法被打开：任何人都无法再用它确认猜测的姓名和联系方式。这为不可变日志和锚定上无法重写的记录提供了删除能力（GDPR 第 17 条）。完整 RPR 的每一份副本，包括已披露的副本，都必须删除。
- **`human_id`。** 盲化 RPR 会公开 `human_id`，因此 `human_id` 必须（MUST）是不透明的，不得（MUST NOT）包含个人信息或由个人信息派生，例如电子邮件地址、姓名或其中任一者的哈希。
- **旧式承诺。** 根据不含 `pii_salt` 的完整 RPR 计算的 `pii_hash`（即上式去掉 `pii_salt` 成员）已被弃用。实现不得（MUST NOT）以这种方式盲化新记录。验证方可以（MAY）继续用已披露的完整 RPR 核对旧式承诺，并应当（SHOULD）将其标记为已弃用：任何猜中个人信息的人都可以确认它，而在不可变日志上这一点永远成立。

---

<a id="13-governance"></a>

## 13. 治理

<a id="131-governance-key-set"></a>

### 13.1 治理密钥集

用于签署算法建议和协议决定的 M-of-N 多方密钥。发布于 `/.well-known/governance-keys.json`。

<a id="132-algorithm-advisory-system"></a>

### 13.2 算法建议系统

带有 `warn`、`deprecate`、`revoke` 动作的已签名建议。验证方的自动响应会移除受影响的算法并加入替代算法。

<a id="133-advisory-auto-response"></a>

### 13.3 建议的自动响应

验证方自动：

- 从接受列表中移除已弃用或已撤销的算法
- 加入替代算法
- 如果所有经典算法都被移除，则切换到 pq_only
- 保留策略变更的审计轨迹

---

<a id="14-adaptive-security-tiers"></a>

## 14. 自适应安全层级

自适应安全层级系统根据策略决定的风险分数以及意图的数据类别、行动类型和预估影响来选择密码学保护级别。层级决定验证模式的选择、PQ 检查点间隔和 bundle 呈现模式。

<a id="141-tier-definitions"></a>

### 14.1 层级定义

| 层级 | 名称 | 验证模式 | PQ 检查点间隔 | Bundle 大小 | 密码学延迟 |
|---|---|---|---|---|---|
| 0 | `routine` | `classical_only` | 每 50 个事件 | ~1-2 KB | ~2 ms |
| 1 | `standard` | `hybrid_preferred` | 每 10 个事件 | ~2-5 KB | ~2 ms + 5 ms 检查点 |
| 2 | `elevated` | `hybrid_required` | 每个事件 | ~10-15 KB | ~11 ms |
| 3 | `maximum` | `hybrid_required` | 每个事件 + 立即验证 | ~15-25 KB | ~15 ms |

<a id="142-tier-selection-algorithm"></a>

### 14.2 层级选择算法

层级只根据 schema 定义的已签名字段计算：意图的 `action_type`、`data_classes`、`estimated_impact` 和可选的 `security_tier`，以及 bundle 中 `PolicyDecisionV2` 的 `risk_score`（整数 0..1000）。意图 schema 中没有 `risk_score`；实现不得（MUST NOT）从意图中读取它。

```
function computeSecurityTier(intent, policy_decision):
  if policy_decision is absent or null:
    score = 0
  else if policy_decision.risk_score is an integer from 0 to 1000:
    score = policy_decision.risk_score
  else:
    score = unknown
  dc = intent.data_classes
  unknown = score is unknown
         OR intent.action_type ∉ ACTION_TYPES
         OR intent.estimated_impact ∉ {low, medium, high}
         OR dc is not an array
         OR some element of dc ∉ DATA_CLASSES

  if score >= 800 OR dc ∩ {credentials, children_data} ≠ ∅:
    tier = "maximum"
  else if score >= 500 OR dc ∩ {pii, financial_data, health_data} ≠ ∅
       OR intent.action_type == "initiate_payment"
       OR intent.estimated_impact == "high" OR unknown:
    tier = "elevated"
  else if score >= 200 OR intent.estimated_impact == "medium":
    tier = "standard"
  else:
    tier = "routine"

  explicit = intent.security_tier
  if explicit is present and not null:
    tier = max(tier, explicit if it is a tier name else "elevated")
  if a verified mandate chain (DCP-09 §3.5) applies and has an effective tier:
    tier = max(tier, that tier if it is a tier name else "elevated")
  return tier
```

经验证的委托链的实际层级，即链上最大的 `minimum_security_tier`，是该计算的一个可选输入，只能提高结果，绝不能降低结果。目前还没有任何 bundle 字段携带该链，因此只有当验证方与 bundle 一起拿到一条经验证的链时，该下限才适用；§18 的 bundle 验证方不会读取它。

`ACTION_TYPES` 和 `DATA_CLASSES` 是 `schemas/v2/intent.schema.json` 中 `action_type` 和 `data_classes` 的枚举。缺失、类型错误或未知的值会失败关闭到至少 `elevated`，因此无论是否进行 schema 验证，验证方不认识的值都不会降低 bundle 受到的审查力度。没有策略决定时分数为 0。在策略决定中，缺失或不是 0 到 1000 之间整数的 `risk_score`（字符串、小数、负数、大于 1000 的数）同样视为未知，上面的分数比较将其视为 0。没有小数部分的数，例如 `200.0`，按相应整数计算。

`tests/interop/v2/interop_vectors.json` 的 `security_tier` 类别列出了每个用例预期的层级、验证模式和检查点间隔。四个 SDK 都会运行它。

<a id="143-tier-enforcement-never-downgrade"></a>

### 14.3 层级执行（绝不降级）

V2 验证方必须（MUST）计算每个 bundle 的层级，并用以下两种模式中更严格的一种验证该 bundle：

1. 策略模式：验证方的 `default_mode`，或其针对护照 `risk_tier` 的 `risk_overrides` 条目（§7.2）；
2. 层级模式（§14.1）。

严格程度为 `classical_only` < `hybrid_preferred` < `hybrid_required`。层级只能增加 PQ 要求，因此 `pq_only` 策略仍为 `pq_only`。被验证的代理签署护照和意图，因此其 `risk_tier` 和 `security_tier` 可以提高模式，但不能使其低于层级模式。验证方在结果中报告解析出的层级。

验证方可以（MAY）提高计算出的层级，但不得（MUST NOT）降低它。`PolicyDecisionV2` 中的 `resolved_tier` 字段记录策略引擎解析出的层级。它仅供参考：§14.2 的计算不读取它。

<a id="144-intent-and-policy-decision-fields"></a>

### 14.4 意图和策略决定字段

`IntentV2` 包含一个可选的 `security_tier` 字段（自动计算或显式设置）。`PolicyDecisionV2` 包含一个可选的 `resolved_tier` 字段，即策略引擎解析出的层级，仅供参考；§14.2 不读取它。

<a id="145-verification-cache"></a>

### 14.5 验证缓存

已验证 bundle 的结果可以（MAY）缓存，TTL 由解析出的层级决定：

| 层级 | 缓存 TTL |
|---|---|
| `routine` | 5 分钟 |
| `standard` | 2 分钟 |
| `elevated` | 30 秒 |
| `maximum` | 10 秒 |

任一签名者的 kid 被撤销时，必须（MUST）使缓存条目失效。

<a id="146-bundle-presentation-modes"></a>

### 14.6 Bundle 呈现模式

层级影响为优化带宽而建议的呈现模式：

- **层级 0-1（已建立会话）**：`compact` 或 `reference` —— 省略 PQ 签名，包含检查点引用
- **层级 2-3**：`full` —— 包含所有签名的完整 bundle
- **首次接触（任何层级）**：`full`

---

<a id="15-canonicalization"></a>

## 15. 规范化

DCP-AI v2.0 使用基于 RFC 8785（JCS）的规范化配置文件 **`dcp-jcs-v1`**。该配置文件确定了 JCS 留给实现自行决定的情形（undefined 的处理、整数值的浮点数、科学记数法、null 的保留、空容器），使四个 SDK 产生逐字节相同的输出。它不是 JCS 的严格子集：键按 Unicode 码点排序（第 1 项），而 RFC 8785 按 UTF-16 码元排序。两种顺序只在混合了辅助平面字符和 U+E000..U+FFFF 范围字符的键上有所不同。

概要：

1. 键按 Unicode 码点进行字典序排序
2. 紧凑形式（无空白）
3. 仅限整数，在解析后判定（接受 `1.0`、`1e2`、`1.00`；拒绝 `0.1`、`NaN`、`Infinity`）
4. `null` 连同其键一起保留；数组按位置保留 `null`
5. `undefined`（仅 TypeScript）：在对象中省略，在数组中序列化为 `null`
6. 不排除任何字段（SignedPayload 信封）
7. 被签名的字节：`UTF8(context_tag) || 0x00 || canonical(payload)`

完整的规范性配置文件，包括边界情况接受表和四个 SDK 都必须通过的测试 fixtures，位于 [`spec/CANONICALIZATION_PROFILE.md`](CANONICALIZATION_PROFILE.md)。按该配置文件生成的 bundle 通过 bundle 清单中可选的 `canonicalization_profile: "dcp-jcs-v1"` 字段声明这一点。

---

<a id="16-wire-formats"></a>

## 16. 传输格式

<a id="161-json-default"></a>

### 16.1 JSON（默认）

`Content-Type: application/json`

<a id="162-cbor-optional"></a>

### 16.2 CBOR（可选）

`Content-Type: application/cbor` —— RFC 8949 确定性编码。比 JSON 小 30-40%。

---

<a id="17-backward-compatibility"></a>

## 17. 向后兼容

```
V1 Verifier + V1 Bundle  ->  PASS (unchanged)
V1 Verifier + V2 Bundle  ->  REJECT "unsupported dcp_version 2.0"
V2 Verifier + V1 Bundle  ->  PASS (when allow_v1_bundles=true)
V2 Verifier + V2 Bundle  ->  PASS (full V2 verification)
```

V2 验证方必须（MUST）无限期支持 V1。迁移是渐进的。

---

<a id="18-verification-pipeline"></a>

## 18. 验证流水线

1. 传输格式解码（JSON 或 CBOR）
2. Schema 验证（V1/V2 分流）
3. 会话 nonce 一致性
4. 清单完整性（重新计算工件哈希），以及根据已签名的 `session_issued_at` 和 `session_expires_at` 得出的会话窗口
5. 跨工件一致性：护照状态、RPR 到期、各工件和审计轨迹中只有一个主体、代理和意图（VERIFICATION.md V2-14）
6. 根据已签名的意图和策略决定计算安全层级（§14.2）
7. 基于建议拒绝算法
8. 复合签名验证（并行）：用 RPR 的 `binding_keys` 验证 bundle 签名，用护照的 `keys` 验证代理的工件，每个 kid 都由其密钥派生
9. 以实际模式，即策略模式与层级模式中更严格者（§14.3），对 bundle 签名和每个工件签名执行验证方策略
10. 审计哈希链验证
11. PQ 检查点验证：恰好是所列出的检查点，每个都覆盖自己的审计条目并由代理签署
12. 密钥有效性检查（到期、撤销、kid 派生）
13. 验证缓存的查询和存储（§14.5）

---

<a id="19-threat-model"></a>

## 19. 威胁模型

| 威胁 | 缓解措施 |
|---|---|
| 量子攻击者（Shor 算法） | 复合签名中的 ML-DSA-65 |
| 先收集、后解密 | 复合混合签名（即使经典签名被攻破，PQ 签名仍有效） |
| 剥离攻击 | 复合绑定（PQ 签名覆盖经典签名） |
| 跨工件重放 | 域分离上下文标签 |
| 会话拼接 | session_nonce + bundle 清单 |
| 策略降级 | 由验证方主导的策略 + 层级绝不降级规则 |
| 密钥混淆或抢注 | 确定性 kid + 持有证明 |
| 算法被攻破（PQ） | 密码敏捷性 + SLH-DSA-192f 备用 + 建议系统 |
| 规范化漏洞利用 | 仅限整数的 schema，禁止浮点数 |
| 密钥被盗 | HSM/TPM、短期证书、带持有证明的密钥轮换 |
| 数据库篡改 | 哈希链 + Merkle 根 + 区块链锚定 |
| 个人信息泄露 | 盲化 RPR 模式 |
| 密钥丢失 | M-of-N 社交恢复（Shamir SSS） |
| 层级规避 | 由验证方提升层级，代理不能降级 |
| 代理冒认主体（重用已发布的已签名 RPR） | bundle 签名只能由 RPR 的 `binding_keys` 作出；它承诺护照哈希。以他人 `human_id` 签发的 RPR 只有在验证方固定或证明主体密钥时才能被阻止 |
| 不一致但签名有效的工件 | 跨工件一致性检查（VERIFICATION.md V2-14） |
| 未签名元数据左右检查 | 会话开始时间在清单中签名；签名者块不得与签名相矛盾 |

---

<a id="20-conformance-requirements"></a>

## 20. 一致性要求

### 20.1 MUST

- 所有 V2 工件上都有复合绑定的混合签名
- 每个签名都有域分离
- bundle 中每个工件都有会话 nonce
- 数值字段仅限整数
- 确定性的 kid 派生
- 所有 PQ 提供方都通过 NIST KAT 验证
- 对每个 V2 bundle 计算安全层级（§14.2），并按绝不降级规则执行（§14.3）

### 20.2 SHOULD

- 生产环境中用 HSM/TPM 存储私钥
- 双哈希链（SHA-256 + SHA3-256）
- 高吞吐量部署使用 CBOR 传输格式
- 使用短期证书（24 小时 TTL）代替撤销列表
- 定期获取建议（每天）

### 20.3 MAY

- CBOR + gzip 压缩
- 并行签名验证
- 先验证 PQ 的快速失败验证策略
- 审计轨迹压缩
- 按层级设定 TTL 的验证结果缓存（§14.5）

---

<a id="21-references"></a>

## 21. 参考资料

- FIPS 203：ML-KEM（基于模格的密钥封装机制）
- FIPS 204：ML-DSA（基于模格的数字签名算法）
- FIPS 205：SLH-DSA（无状态的基于哈希的数字签名算法）
- RFC 8032：Edwards-Curve Digital Signature Algorithm (EdDSA)
- RFC 8785：JSON Canonicalization Scheme (JCS)
- RFC 8949：Concise Binary Object Representation (CBOR)

---

*DCP-AI v2.0 规范性规范完*

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准。

- **§5.1 和 §7.1，剥离。** 在 SDK 验证方中，存在但验证失败的 PQ 签名在任何模式下都会被拒绝。去掉 PQ 签名并把绑定
  重新标记为 `classical_only` 的 bundle，在实际模式为 `classical_only` 或 `hybrid_preferred` 时会被接受
  （`hybrid_preferred` 下带警告），在 `hybrid_required` 和 `pq_only` 下会被拒绝（[VERIFICATION.md](VERIFICATION.md)
  V2-7 至 V2-9）。
- **§7.3，`pq_only`。** SDK 验证方仍然期望带有经典签名字节的 `pq_over_classical` 绑定：PQ 签名覆盖这些字节，
  因此 `pq_only` 并不允许省略经典组成部分。
- **§6，SignedPayload。** 该信封包裹 bundle 的四个主要工件（护照、RPR、意图、策略决定）。DCP-05 至 DCP-09 的记录
  在对象内部携带签名，通常为 `composite_sig`；根委托授权书携带 `human_composite_sig`，子授权书携带
  `delegator_composite_sig`（DCP-09 §3.5）。
- **§9 和 §15，规范化。** `dcp-jcs-v1` 是唯一的规范性配置文件，也是默认配置文件。
  [docs/proposals/canonicalization-candidate](../docs/proposals/canonicalization-candidate/README.md) 中的候选配置文件
  只能通过实验性、需显式启用的 API 使用，不会改变默认验证方接受的内容。
- **§10，审计轨迹。** 审计条目不是逐条签名的：它们通过清单由 bundle 签名覆盖。`DCP-AI.v2.AuditEvent` 上下文用于
  PQ 检查点和审计压缩，由调用方使用 SDK 辅助函数生成；没有任何机制自动签署它们。验证方检查所列的检查点和 SHA-256
  链，但不会重新计算辅助的 SHA3-256 链。
- **§11.3，紧急撤销。** RPR schema 中没有 `revocation_token`；V2 护照有一个可选的 `emergency_revocation_token`。
- **§12.1，删除。** 本文描述的是删除盐的密码学效果。它不是对 GDPR 或任何其他法律合规性的评估；请参阅
  [docs/EU_AI_ACT_MAPPING.md](../docs/EU_AI_ACT_MAPPING.md)。
- **§13，建议。** 只有当运营方调用 `POST /v2/advisory/auto-apply` 时，参考服务器才会把已发布的建议应用到自己的策略；
  它只检查建议中 `composite_sig` 的结构，也没有自动的定期获取。
- **§14.1，大小和延迟。** bundle 大小和延迟两列仅作说明，不是对 `main` 上代码的测量；
  [docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md) 说明了如何测量。
- **§1.1 和 §19，锚定。** 参考锚定服务在本地保存记录，不会向链上提交任何内容（[docker/README.md](../docker/README.md)）。
- **§16，传输格式。** CBOR 是仅存在于 TypeScript SDK 中的可选编码器和解码器，参考服务器只读取 JSON 请求体。
  30–40% 的大小数字在本仓库中没有任何测量支持。`api/proto/dcp.proto` 只是定义：本仓库中没有任何 gRPC 服务器或
  客户端实现它。
- **§17，向后兼容。** 该表描述的是结果，而不是单一入口。SDK 中的 `verifySignedBundleV2` 只验证 V2 bundle。
  `allow_v1_bundles` 由参考服务器和准入配置文件读取；根目录的 `verifySignedBundle`（`lib/verify.js`）不读取它，
  直接把 V1 bundle 交给 V1 检查。
- **§18，流水线。** `verifySignedBundleV2` 不执行 JSON Schema 验证（第 2 步）：`lib/verify.js` 和服务器会在调用它
  之前执行。它不使用 TypeScript SDK 导出的验证缓存（第 13 步），第 12 步读取的是 bundle 中的密钥状态；查询撤销服务
  属于准入（[docs/ADMISSION.md](../docs/ADMISSION.md)）。验证不等于准入、信任或授权。
