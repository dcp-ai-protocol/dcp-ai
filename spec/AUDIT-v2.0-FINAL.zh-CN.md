<sub>[English](AUDIT-v2.0-FINAL.md) · **中文** · [Español](AUDIT-v2.0-FINAL.es.md) · [日本語](AUDIT-v2.0-FINAL.ja.md) · [Português](AUDIT-v2.0-FINAL.pt-BR.md)</sub>

<a id="dcp-ai-v20-final-security-audit--all-13-gaps-verified-closed"></a>
<a id="dcp-ai-v20-final-security-audit-all-13-gaps-verified-closed"></a>

# DCP-AI v2.0 最终安全审计 — 13 个缺口全部确认关闭

> 本文是[英文版](AUDIT-v2.0-FINAL.md)的参考译文，更新于 25/10/2026。**这是带日期的历史记录**，不代表当前状态。如有出入，以英文版为准。

**审计日期：** 2026-02-26  
**审计方：** DCP-AI Protocol Governance  
**范围：** 对 DCP-AI v2.0 第 3 阶段缺口关闭情况的完整核查  
**结果：** 13 个缺口全部关闭  

> **历史记录，按原文保留。** 本审计的日期为 2026 年 2 月 26 日。后来的审查（2026 年 10 月）对其中一些结论作了限定；当前状态见此处链接的文档，而不是本记录：
>
> - **第 11 号缺口与 HSM 参考实现。** `HsmCryptoProvider` 和 `HsmProviderFactory` 是一个模拟的模式，而不是 HSM 集成。它们没有从 `@dcp-ai/sdk` 导出，也没有 PKCS#11 绑定；`sign` 返回的是哈希而不是签名，`verify` 接受任何长度正确的签名。不得将它们用于真实证据（[docs/NIST_CONFORMITY.md](../docs/NIST_CONFORMITY.md) §2.2）。
> - **第 1 号缺口。** SDK 的密钥恢复和 `dcp recovery-setup` 会生成 Shamir 份额，但不会用混合 KEM 加密这些份额。
> - **第 4 号缺口。** 参考服务器检查公告 `composite_sig` 的结构，而不检查其签名；保护它的是运营方令牌（[server/README.md](../server/README.md)）。
> - **仅 PQ 模式。** SDK 验证器中的 `pq_only` 仍然需要经典签名字节：在 `pq_over_classical` 下 PQ 签名覆盖这些字节，因此这并不意味着可以省略经典组件。
> - **第 6 号缺口。** 双哈希辅助函数存在，但验证器不会重新计算 `prev_hash_secondary` 或 `audit_merkle_root_secondary`（[VERIFICATION.md](VERIFICATION.md)，V2-11）。
> - **`dcp audit gaps`** 检查的是文件是否存在以及是否包含标记，而不是行为。在 2026 年 10 月 25 日，它把第 7 号缺口报告为未关闭，因为它查找的是 `integrations/fastapi/__init__.py`，而该文件现在是 `sdks/python/dcp_ai/fastapi/__init__.py`。

---

<a id="gap-verification-matrix"></a>

## 缺口核查矩阵

<a id="gap-1-key-recovery-m-of-n-social-recovery"></a>

### 第 1 号缺口：密钥恢复（M-of-N 社交恢复）

- **状态：** 已关闭
- **实现：** `sdks/typescript/src/core/key-recovery.ts`
- **CLI：** `dcp recovery-setup --threshold <M> --shares <N>`
- **Schema：** `schemas/v2/recovery_config.schema.json`
- **核查：** Shamir 秘密共享以阈值 M 将主秘密拆分为 N 个份额。份额用混合 KEM 加密。恢复需要 M-of-N 份额以及带外身份验证。

<a id="gap-2-rpr-privacy--blinded-mode"></a>
<a id="gap-2-rpr-privacy-blinded-mode"></a>

### 第 2 号缺口：RPR 隐私 — 盲化模式

- **状态：** 已关闭
- **实现：** `sdks/typescript/src/core/blinded-rpr.ts`
- **类型：** `sdks/typescript/src/types/v2.ts` 中的 `BlindedResponsiblePrincipalRecordV2`
- **Schema：** `schemas/v2/blinded_rpr.schema.json`
- **核查：** 个人数据字段被 `pii_hash` 替换。司法管辖区、责任和密钥得以保留。按需通过完整 RPR 进行监管披露。

<a id="gap-3-missing-v2-artifacts"></a>

### 第 3 号缺口：缺失的 V2 工件

- **状态：** 已关闭
- **JurisdictionAttestationV2：** 类型 + schema（`schemas/v2/jurisdiction_attestation.schema.json`）
- **HumanConfirmationV2：** 类型 + schema（`schemas/v2/human_confirmation.schema.json`）
- **核查：** 两个工件都包含复合签名和用于会话绑定的 session_nonce。

<a id="gap-4-algorithm-deprecation-protocol"></a>

### 第 4 号缺口：算法弃用协议

- **状态：** 已关闭
- **实现：** `sdks/typescript/src/core/algorithm-advisory.ts`
- **自动响应：** `autoApplyAdvisoriesToPolicy()` 函数
- **治理核查：** `verifyGovernanceAdvisory()` 函数
- **Schema：** `schemas/v2/algorithm_advisory.schema.json`
- **服务器：** `POST /v2/advisory/publish`、`GET /v2/advisory/check`、`POST /v2/advisory/auto-apply`
- **CLI：** `dcp advisory check [url]`
- **核查：** 公告由治理方签名。验证器自动移除已弃用或已吊销的算法，加入替代算法，并在所有经典算法都被移除时自动切换到 pq_only。

<a id="gap-5-multi-party-authorization"></a>

### 第 5 号缺口：多方授权

- **状态：** 已关闭
- **实现：** `sdks/typescript/src/core/multi-party-auth.ts`
- **Schema：** `schemas/v2/multi_party_authorization.schema.json`
- **服务器：** `POST /v2/multi-party/authorize`
- **核查：** 需要 M-of-N 复合签名。所有者角色始终必需。角色：owner、org_admin、recovery_contact。

<a id="gap-6-dual-hash-chains"></a>

### 第 6 号缺口：双哈希链

- **状态：** 已关闭
- **实现：** `sdks/typescript/src/core/dual-hash.ts`
- **核查：** SHA-256 + SHA3-256 并行运行。AuditEventV2 包含 `prev_hash_secondary` 和 `intent_hash_secondary`。bundle 清单包含 `audit_merkle_root_secondary`。

<a id="gap-7-python-integrations-v2"></a>

### 第 7 号缺口：Python V2 集成

- **状态：** 已关闭
- **FastAPI：** `integrations/fastapi/__init__.py`
- **LangChain：** `integrations/langchain/`
- **OpenAI：** `integrations/openai/`
- **CrewAI：** `integrations/crewai/`
- **核查：** 所有集成都已更新，支持 V2 身份设置、复合签名、会话 nonce 传播和 V2 验证。

<a id="gap-8-grpcprotobuf-v2-messages"></a>

### 第 8 号缺口：gRPC/Protobuf V2 消息

- **状态：** 已关闭
- **实现：** `api/proto/dcp.proto`
- **核查：** V2 消息类型：CompositeSignature、SignedPayload、BundleManifest、AgentPassportV2、ResponsiblePrincipalRecordV2、IntentV2、PolicyDecisionV2、AuditEventV2、PQCheckpoint、SignedBundleV2。

<a id="gap-9-cli-v2-commands"></a>

### 第 9 号缺口：CLI V2 命令

- **状态：** 已关闭
- **实现：** `bin/dcp.js`
- **V2 命令：** `keygen --hybrid`、`sign-bundle --composite`、`verify-bundle --policy`、`kid`、`recovery-setup`、`emergency-revoke`、`rotate-key`、`capabilities`、`advisory check`
- **第 3 阶段命令：** `keys rotate`、`keys certify`、`governance ceremony`、`governance sign-advisory`、`governance verify-advisory`、`audit gaps`
- **核查：** CLI 完整覆盖 V1、V2 和第 3 阶段的操作。

<a id="gap-10-nist-kat-validation"></a>

### 第 10 号缺口：NIST KAT 验证

- **状态：** 已关闭
- **提供方：** `sdks/typescript/src/providers/ml-dsa-65.ts`、`slh-dsa-192f.ts`
- **核查：** 提供方实现参照 FIPS 204/205 标准。KAT 验证结构在测试计划中定义。强制执行提供方的 `isConstantTime` 标志。

<a id="gap-11-secure-memory--hsm-provider"></a>
<a id="gap-11-secure-memory-hsm-provider"></a>

### 第 11 号缺口：安全内存 / HSM 提供方

- **状态：** 已关闭
- **安全内存：** `sdks/typescript/src/core/secure-memory.ts` — 在释放时安全清零的 `SecureKeyGuard`
- **HSM 提供方：** `sdks/typescript/src/providers/hsm-provider.ts` — `HsmCryptoProvider` 参考实现
- **HSM 工厂：** 支持多算法 HSM 的 `HsmProviderFactory`
- **核查：** HsmCryptoProvider 实现 CryptoProvider 接口。私钥从不进入应用内存。PKCS#11 会话管理。支持 Ed25519、ML-DSA-65、ML-DSA-87、SLH-DSA-192f。

<a id="gap-12-version--capability-negotiation"></a>
<a id="gap-12-version-capability-negotiation"></a>

### 第 12 号缺口：版本与能力协商

- **状态：** 已关闭
- **服务器：** `GET /.well-known/dcp-capabilities.json`
- **请求头：** 支持 `DCP-Version` 请求头
- **CLI：** `dcp capabilities <endpoint>`
- **核查：** 能力文档包括支持的版本、算法、传输格式、功能以及验证器策略哈希。

<a id="gap-13-emergency-revocation-panic-button"></a>

### 第 13 号缺口：紧急吊销（紧急按钮）

- **状态：** 已关闭
- **实现：** `sdks/typescript/src/core/emergency-revocation.ts`
- **Schema：** `schemas/v2/emergency_revocation.schema.json`
- **服务器：** 带限流的 `POST /v2/emergency-revoke`
- **CLI：** `dcp emergency-revoke --agent <id> --token <secret>`
- **核查：** 预先登记的吊销令牌（SHA-256 承诺）。公开原像即吊销代理的所有密钥。一次性使用。带限流。

---

<a id="phase-3-specific-verifications"></a>

## 第 3 阶段的专项核查

<a id="pq-only-mode"></a>

### 仅 PQ 模式

- **验证器：** `verify-v2.ts` 中的 `PQ_ONLY_VERIFIER_POLICY` 预设
- **服务器：** 用于在运行时切换模式的 `POST /v2/policy/mode`
- **核查：** 经典签名可选。V1 bundle 被拒绝。对纯经典 bundle 给出弃用警告。

<a id="key-rotation-ceremony"></a>

### 密钥轮换仪式

- **CLI：** `dcp keys rotate --key-dir <dir> --new-alg <alg>`
- **CLI：** `dcp keys certify --key-dir <dir> --endpoint <url>`
- **SDK：** `proof-of-possession.ts` — `createKeyRotation()` 和 `verifyKeyRotation()`
- **核查：** 新密钥的持有证明 + 旧密钥的授权。支持宽限期。由网关认证。

<a id="algorithm-deprecation-protocol--automated-response"></a>
<a id="algorithm-deprecation-protocol-automated-response"></a>

### 算法弃用协议 — 自动响应

- **SDK：** `algorithm-advisory.ts` 中的 `autoApplyAdvisoriesToPolicy()`
- **服务器：** `POST /v2/advisory/auto-apply`
- **核查：** 自动移除已弃用或已吊销的算法。注入替代算法。在所有经典算法都被移除时自动切换到 pq_only。策略变更的审计轨迹。

<a id="hsmtpm-reference-implementation"></a>

### HSM/TPM 参考实现

- **SDK：** `providers/hsm-provider.ts` 中的 `HsmCryptoProvider`
- **工厂：** 用于多算法 HSM 会话的 `HsmProviderFactory`
- **核查：** 实现 CryptoProvider 接口。PKCS#11 会话生命周期。私钥从不位于应用内存中。

<a id="governance-key-ceremony"></a>

### 治理密钥仪式

- **SDK：** `governance.ts` — `generateGovernanceParticipant()`、`executeGovernanceCeremony()`、`signAdvisoryAsGovernance()`
- **CLI：** `dcp governance ceremony`、`dcp governance sign-advisory`、`dcp governance verify-advisory`
- **服务器：** `POST /v2/governance/register`、`GET /.well-known/governance-keys.json`
- **核查：** M-of-N 复合签名。每个参与方持有 Ed25519 + ML-DSA-65。强制执行阈值。

<a id="normative-specification"></a>

### 规范性规范

- **文档：** `spec/DCP-AI-v2.0.md`
- **核查：** 覆盖协议所有方面的完整规范：算法、密钥管理、签名、验证、隐私、治理、威胁模型和一致性要求。

---

<a id="audit-conclusion"></a>

## 审计结论

DCP-AI v2.0 后量子协议升级计划中识别出的 13 个缺口均已确认关闭。第 3 阶段新增的内容（pq_only 模式、密钥轮换仪式、算法弃用自动响应、HSM 提供方、治理仪式）已全部实现。

DCP-AI v2.0 协议已可以发布。

**审计核查方式：** CLI 命令 `dcp audit gaps`  
**运行：** 从仓库根目录运行 `node bin/dcp.js audit gaps`
