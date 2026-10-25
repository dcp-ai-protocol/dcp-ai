<sub>[English](AGENT_CREATION_AND_CERTIFICATION.md) · **中文** · [Español](AGENT_CREATION_AND_CERTIFICATION.es.md) · [日本語](AGENT_CREATION_AND_CERTIFICATION.ja.md) · [Português](AGENT_CREATION_AND_CERTIFICATION.pt-BR.md)</sub>

<a id="agent-creation-and-certification--p2p-no-central-service"></a>
<a id="agent-creation-and-certification-p2p-no-central-service"></a>

# 智能体创建与认证 — P2P，无中央服务

> 本文是[英文版](AGENT_CREATION_AND_CERTIFICATION.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

创建智能体的系统可以默认产出 **DCP 认证**的智能体：绑定到人类、签发护照、bundle 已签名。**无需在任何中央服务注册。** 验证在本地进行。可选：将 bundle_hash 锚定到公共日志或链上（使用现有区块链或第三方服务）。

本页所说的“DCP 认证”是指 bundle 通过下文定义的本地检查。它不是由某个机构签发的证书，不能确认委托人的真实身份，也不决定验证者是否应接受该智能体：那是准入，一个单独的步骤（[ADMISSION.md](ADMISSION.md)，未发布）。

> **本页使用的工具。** `dcp` 是源码检出副本中的参考 CLI，即 `node /path/to/dcp-ai/bin/dcp.js`；它只在当前目录内读写。交互式向导 `@dcp-ai/cli init` 是一个演示，不会创建有效的 V2 身份：参见 [CLI 向导（仅演示）](#cli-wizard-demo-only)。

<a id="certification-flow-p2p-no-registry"></a>

## 认证流程（P2P，无注册中心）

```
Human → Onboard (identity / pseudonymous, jurisdiction)
     → System: keygen human, build RPR, sign RPR

Human → Create agent (capabilities, risk_tier)
     → System: keygen agent, build AP, build bundle, sign bundle
     → Optional: publish bundle_hash only to existing chain/log (user or third party)
     → System: issue signed bundle + keys (+ optional anchor_receipt)

Agent → On each action: build Intent, PolicyDecision, AuditEntry (intent_hash, prev_hash chain)
      → append to audit trail; present signed bundle to verifier
      → Optional: anchor new bundle_hash for audit trail (user or third party)
```

- **验证在本地进行；不需要中央服务器。** 可选的锚定由用户或第三方锚定服务在现有的链或日志上完成。

<a id="definition-of-dcp-certified"></a>

## “DCP 认证”的定义

- **已认证（本地）：** 有效的 Citizenship Bundle（符合模式）、Signed Bundle（签名有效）、签名有效的 RPR 和 AP、AP.status = active、RPR 未过期。验证者可以离线验证。**无需服务器。**
- **已认证 + 已锚定（可选）：** 上述条件 + bundle_hash（或 merkle_root）已锚定到公共日志或链上；验证者可以选择检查该哈希是否在某个时间点被锚定。仍然没有知道 agent_id/human_id 的中央 API。锚定使用**现有**区块链或**第三方**日志。

哪个工具检查什么：

- **V1：** `dcp verify-bundle` 和 `verifySignedBundle` 检查模式、bundle 签名、`bundle_hash`、`merkle_root` 和审计链。RPR 和护照的签名、护照的 `status` 以及 RPR 的 `expires_at` 由调用方负责；快速开始文档展示了签名检查。
- **V2：** `verifySignedBundleV2` 还会检查每个构件的复合签名、护照状态（接受 `active` 和 `declining`）以及 RPR 的过期时间。参见 [spec/VERIFICATION.md](../spec/VERIFICATION.md)。

<a id="integration-points-no-registry"></a>

## 集成点（无注册中心）

<a id="on-human-onboarding"></a>

### 人类入驻时

- 生成或接受人类的密钥对（例如 `dcp keygen keys/human`）。
- 构建 RPR（human_id 可以是化名：哈希、UUID 或 DID）。
- 用人类的私钥对去掉 `signature` 字段的 RPR 签名（例如 `signObject(rprBody, humanSecretKeyB64)`）。
- 在本地存储；不要 POST 到任何中央服务器。

<a id="on-agent-creation"></a>

### 创建智能体时

- 生成智能体的密钥对（例如 `dcp keygen keys/agent` 或第二个密钥对）。
- 构建 AP：principal_binding_reference = RPR.human_id，public_key = 智能体公钥（base64 编码的 Ed25519）。用智能体的私钥对去掉 `signature` 字段的 AP 签名。
- 构建最小 bundle：RPR + AP + intent + policy_decision + audit_entries（至少一条；按照 [spec/DCP-03.md](../spec/DCP-03.md) 使用真实的 intent_hash 和 prev_hash 链）。
- 用**人类**的私钥签署 bundle（例如 `dcp sign-bundle bundle.json keys/human/secret_key.txt out.signed.json`）。
- 可选：将 bundle_hash 锚定到公共日志或链上（Bitcoin OP_RETURN、Ethereum 事件或第三方透明度日志）。如有使用，将 anchor_receipt 与 bundle 一起保存。
- 返回给用户：已签名的 bundle、智能体私钥，以及可选的 anchor_receipt。

<a id="at-runtime-agent-execution"></a>

### 运行时（智能体执行）

- 每次操作之前：构建 Intent → PolicyDecision → AuditEntry（真实的 intent_hash = SHA-256(canonical(intent))，prev_hash 链：先是 GENESIS，然后是 SHA-256(canonical(前一条目))）。
- 追加到审计轨迹；可选择重新签署 bundle，或为更新后的审计轨迹生成新的已签名 bundle。
- 向验证者出示已签名的 bundle（例如放在 API 请求头或请求体中）。验证者执行本地验证（参见 [spec/VERIFICATION.md](../spec/VERIFICATION.md)）；可选地检查吊销集合（P2P 或以哈希锚定的列表）以及可选的锚定。

<a id="reference-implementation"></a>

## 参考实现

- **脚本：** [scripts/generate-production-examples.js](../scripts/generate-production-examples.js) — 在没有服务器、没有注册的情况下生成真实的 RPR、AP、意图、策略、两条审计条目（带真实的 intent_hash 和 prev_hash 链）以及已签名的 bundle。它会重新生成仓库自带的 V1 示例（`npm run examples:generate`），并从 `keys/secret_key.txt` 读取人类密钥，而该文件不在仓库中（仓库中只有 `keys/public_key.txt`），因此在全新的检出副本上它会在此处停止。请把它当作步骤顺序的参考来阅读。智能体密钥来自 `keys/agent_secret_key.txt` / `keys/agent_public_key.txt`，缺失时会生成。
- **CLI：** `dcp keygen`、`dcp sign-bundle`、`dcp verify-bundle`、`dcp intent-hash`、`dcp bundle-hash`、`dcp merkle-root`。可选的锚定步骤不在 genesis CLI 中；由用户或第三方工具将哈希发布到现有的链上。

<a id="checklist-for-agent-creation-systems"></a>

## 智能体创建系统检查清单

1. 生成人类和智能体的密钥（或接受已有密钥）。
2. 构建并签署 RPR（人类密钥）。
3. 构建并签署 AP（智能体密钥；public_key = 智能体公钥）。
4. 构建 intent、policy_decision、audit_entries（真实的 intent_hash、prev_hash 链）。
5. 构建 Citizenship Bundle；用人类密钥签名 → Signed Bundle。
6. 可选：锚定 bundle_hash（现有链或第三方日志）；保存 anchor_receipt。
7. 将已签名的 bundle 和智能体私钥交给智能体或其运行环境。
8. 运行时：构建 intent → policy → 审计条目；追加；向验证者出示已签名的 bundle。验证者在本地验证；不调用中央服务器。

---

<a id="v20-agent-creation"></a>

## V2.0 智能体创建

DCP v2.0 引入了后量子混合密码学和自适应安全等级。

<a id="recommended-path-the-sdks"></a>

### 推荐路径：SDK

像经过测试的快速开始那样，用 SDK 创建 V2 身份和 bundle：

- TypeScript：TypeScript SDK 的 [Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2)，以及 [QUICKSTART.md](QUICKSTART.md)
- Python：Python SDK README 中的 [V2 Bundles](../sdks/python/README.md#v2-bundles)

它们以 `main` 为准：请按照各 README 的 *Release status* 说明从检出副本构建 SDK。

要从检出副本生成真实的混合密钥，`dcp keygen --hybrid <out_dir>` 会写出一个 Ed25519 密钥对和一个 ML-DSA-65 密钥对（ML-DSA-65 来自 `@noble/post-quantum`）及其 kid，并以 `0600` 模式写出私钥文件。

<a id="cli-wizard-demo-only"></a>

### CLI 向导（仅演示）

`npx @dcp-ai/cli init`（2026 年 10 月 25 日已发布的 `@dcp-ai/cli` 为 2.0.0，其 `init` 文件与本仓库中的完全相同）会问几个问题，然后写出：

- `.dcp/config.json` — 智能体配置
- `.dcp/keys/` — 一个 Ed25519 密钥对，如果选择混合密钥，再加一个“ML-DSA-65”密钥对
- `.dcp/identity.json` — 类似 RPR 的记录
- `.dcp/passport.json` — 类似护照的记录

用它来四处看看，而不是用来创建智能体身份：

- **“ML-DSA-65”密钥是模拟的。** 它们是长度正确的随机字节，而不是 ML-DSA 密钥；向导运行时也会这样提示。不要用它们签名，也不要把它们作为后量子密钥发布。
- **`identity.json` 和 `passport.json` 不是 V2 构件。** 它们没有签名，也不符合 V2 模式：RPR 中是 `entity_name` 和 `keys`，而模式要求的是 `legal_name`、`binding_keys`、`liability_mode`、`override_rights`、`issued_at` 和 `expires_at`；护照中是 `owner_rpr_hash`，而模式要求的是 `principal_binding_reference` 和 `risk_tier`。用它们构建的 bundle 无法通过验证。
- **它们的吊销令牌无法使用。** RPR 的 `revocation_token` 是一个未被保留的秘密值的哈希，护照的 `emergency_revocation_token` 是随机的，不是你所持有的任何秘密值的哈希。
- **私钥文件采用默认权限**（在常见的 umask `022` 下为 `0644`）。请运行 `chmod 600 .dcp/keys/*_secret.key`，并让 `.dcp/keys/` 不进入版本控制。
- **`dcp-ai sign` 不是 DCP bundle 签名。** 它签署的是文件的 `JSON.stringify`，而不是其 `dcp-jcs-v1` 规范形式，并把签名追加到 `signatures` 数组中。

<a id="v2-certification-flow"></a>

### V2 认证流程

```
Human → Onboard (identity, jurisdiction)
     → System: generate hybrid keypair (Ed25519 + ML-DSA-65)
     → System: build RPR with binding_keys[] (KeyEntry array), sign with composite signature
     → Optional: recovery configuration (Shamir SSS, spec §11.2)

Human → Create agent (capabilities, risk_tier)
     → System: generate agent hybrid keypair
     → System: build AgentPassport with keys[], principal_binding_reference (the RPR's human_id),
               capabilities and risk_tier; optional emergency_revocation_token (spec §11.3)
     → System: build bundle with session_nonce and manifest
     → System: composite-sign bundle (Ed25519 + ML-DSA-65, pq_over_classical binding)
     → Optional: anchor bundle_hash

Agent → On each action:
      → Build IntentV2 (with action_type, data_classes, estimated_impact; optional security_tier)
      → Evaluate PolicyDecisionV2 (with risk_score; optional resolved_tier)
      → Compute the security tier (routine/standard/elevated/maximum) of the action
      → Build AuditEventV2 (SHA-256 prev_hash chain; optional SHA3-256 secondary chain)
      → Generate PQ checkpoint every N events (tier-dependent)
      → Present signed bundle to verifier

Agent → Lifecycle management (DCP-05):
      → Initial state: commissioned → active (via lifecycle transition)
      → Submit periodic VitalityReport (health metrics, performance)
      → On decline: active → declining (time to prepare succession, DCP-06); declining → active on recovery
      → On end-of-life: → decommissioned (DecommissioningRecord with data_disposition)
```

<a id="v2-key-structure"></a>

### V2 密钥结构

V2 智能体使用带确定性密钥标识符的混合密钥对：

```json
{
  "keys": [
    {
      "kid": "a1b2c3d4e5f6...",
      "alg": "ed25519",
      "public_key_b64": "...",
      "created_at": "2026-02-28T00:00:00Z",
      "expires_at": null,
      "status": "active"
    },
    {
      "kid": "f6e5d4c3b2a1...",
      "alg": "ml-dsa-65",
      "public_key_b64": "...",
      "created_at": "2026-02-28T00:00:00Z",
      "expires_at": null,
      "status": "active"
    }
  ]
}
```

密钥 ID 的导出：`kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key))[0:32]`

<a id="v2-security-tier-selection"></a>

### V2 安全等级选择

安全等级根据策略决定中的 `risk_score` 以及意图的 `data_classes`、`action_type` 和 `estimated_impact` 自动计算（规范 §14.2）：

| 条件 | 等级 |
|-----------|------|
| risk_score >= 800，或 data_classes 包含 credentials/children_data | Maximum |
| risk_score >= 500，或 data_classes 包含 pii/financial_data/health_data，或 initiate_payment，或 estimated_impact 为 high，或存在未知或缺失的值 | Elevated |
| risk_score >= 200，或 estimated_impact 为 medium | Standard |
| 默认 | Routine |

意图中显式给出的 `security_tier` 只能提高等级。

等级决定：验证模式、PQ 检查点频率以及建议的 bundle 呈现模式。

<a id="v2-checklist-for-agent-creation-systems"></a>

### 智能体创建系统的 V2 检查清单

1. 生成混合密钥对：Ed25519 + ML-DSA-65（SDK 提供者，或从检出副本运行 `dcp keygen --hybrid`；不要用 `@dcp-ai/cli init`，它的 ML-DSA 密钥是模拟的）
2. 构建带 `binding_keys[]` 数组（KeyEntry 格式）的 RPR，并用复合签名签署
3. 可选：在护照上放置 `emergency_revocation_token`（规范 §11.3）：`generateEmergencyRevocationToken()` 返回令牌及其对应的秘密值，请将该秘密值离线保存；可选：配置 Shamir SSS 恢复（`RecoveryConfig`，规范 §11.2）
4. 构建带 `keys[]`、`principal_binding_reference`、`capabilities` 和 `risk_tier` 的 AgentPassport
5. 构建带 `action_type`、`data_classes`、`estimated_impact` 的 IntentV2，并计算 `security_tier`
6. 构建带 `risk_score`（0–1000 的整数）以及可选 `resolved_tier` 的 PolicyDecisionV2
7. 构建带 `prev_hash` 链（SHA-256；可选的 SHA3-256 次级链）的 AuditEventV2 条目
8. 按等级间隔生成 PQ 检查点
9. 构建带 `session_nonce` 和清单（所有构件的哈希）的 CitizenshipBundleV2
10. 对 bundle 进行复合签名：带 `pq_over_classical` 绑定的 Ed25519 + ML-DSA-65
11. 可选：锚定 bundle_hash
12. 初始化生命周期状态：创建带 `commissioning_authority`、`purpose` 和 `initial_capabilities` 的 `CommissioningCertificate`（DCP-05）
13. 配置继承：可选地创建带 `successor_preferences` 和 `memory_classification` 的 `DigitalTestament`（DCP-06）
14. 声明权利：创建带有适用 `RightEntry` 条目和 `ObligationRecord` 的 `RightsDeclaration`（DCP-08）
15. 设置委托：如果智能体作为受托人行事，创建带 `authority_scope` 的 `DelegationMandate`（DCP-09）
16. 配置关注阈值：设置带 `threshold_rules` 的 `AwarenessThreshold`，用于触发人工介入（human-in-the-loop）（DCP-09）

代码示例参见 [QUICKSTART.md](QUICKSTART.md)，从 V1 升级参见 [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md)。

<a id="reference"></a>

## 参考资料

- 存储与锚定：[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)
- 验证检查清单：[spec/VERIFICATION.md](../spec/VERIFICATION.md)
