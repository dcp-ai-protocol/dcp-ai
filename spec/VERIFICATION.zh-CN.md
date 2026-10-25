<sub>[English](VERIFICATION.md) · **中文** · [Español](VERIFICATION.es.md) · [日本語](VERIFICATION.ja.md) · [Português](VERIFICATION.pt-BR.md)</sub>

<a id="verification-checklist--signed-bundle"></a>
<a id="verification-checklist-signed-bundle"></a>

# 验证清单 — Signed Bundle

> 本文是[英文规范](VERIFICATION.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

所有步骤都在**本地**完成；不需要调用任何 API 或服务器。验证器只需要 Signed Bundle（以及可选的一组已签名的 RevocationRecord，来自对等方、文件或已锚定的列表）。

<a id="normative-checklist"></a>

## 规范性清单

验证 Signed Bundle 时，按顺序执行以下步骤：

1. **按 schema 校验** Signed Bundle 和内部的 Citizenship Bundle，分别对照 `schemas/v1/signed_bundle.schema.json` 和 `schemas/v1/citizenship_bundle.schema.json`（或对内部 bundle 使用 `dcp validate-bundle`，并按 schema 校验已签名的外层）。

2. **验证签名：**  
   - 重新计算 `bundle_hash` = SHA-256(canonical(bundle))；与 `signature.bundle_hash` 比较（必须一致，例如 `sha256:<hex>`）。  
   - 在规范 bundle 上用 `signature.signer.public_key_b64` 验证 `signature.sig_b64`（Ed25519 分离签名）。  
   - 用 `dcp verify-bundle <signed.json> <public_key.txt>` 执行此步骤。

3. **验证 RPR：** 未过期 — `responsible_principal_record.expires_at` 为 `null` 或未来的 ISO 8601 日期时间。可选：如果该记录以签名形式保存，则验证 RPR 签名。

4. **验证 AP：** `agent_passport.status` = `"active"`。可选：对照**本地的一组已签名 RevocationRecord**（来自对等方、文件或已锚定的列表）检查签名者 / agent_id，不使用任何中心化 API。

5. **验证 intent_hash：** 对 `bundle.audit_entries` 中的每个 AuditEntry，`intent_hash` 必须（MUST）等于 SHA-256(canonical(intent))（十六进制），其中意图是 bundle 中由该条目的 `intent_id` 标识的那个（通常是 bundle 唯一的 `intent`）。使用 `dcp intent-hash <intent.json>` 或参考实现的 `intentHash()` 辅助函数。

6. **验证审计链：**  
   - 第一个条目：`prev_hash` = `"GENESIS"`。  
   - 对索引 n（n ≥ 1）处的每个后续条目：`prev_hash` 必须（MUST）等于 SHA-256(canonical(entry_{n-1}))（十六进制）。

7. **可选 — merkle_root：** 如果存在 `signature.merkle_root`（非 null），验证它等于 `bundle.audit_entries` 的 Merkle 根（例如对内部 bundle 使用 `dcp merkle-root`）。

8. **可选 — anchor_receipt：** 如果随 bundle 提供了 anchor_receipt（例如链、tx_id、区块引用），**仅使用公开数据**（例如从公开的区块浏览器或节点获取交易）验证 `bundle_hash` 出现在指定的链或日志索引处。不涉及任何中心服务器；验证只使用公开数据。

9. **可选 — 司法管辖区吊销列表：** 如果验证器能获取代理所属司法管辖区（依据 `responsible_principal_record.jurisdiction`）的已签名吊销列表，则获取该列表或使用缓存的列表，验证签发方的 Ed25519 签名，并对照列表条目检查 bundle 的 `agent_passport.agent_id`（或签名者）。如果在列表中找到，则该代理已被吊销，验证失败。列表格式和 well-known URL 约定见 [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md)。

10. **可选 — 司法管辖区证明：** 如果 bundle 包含（或附带）`JurisdictionAttestation` 对象，用证明方的公钥验证证明对 `rpr_hash` 的签名。证明方的公钥可从司法管辖区发布的 well-known URL 获得（例如 `https://<authority>/.well-known/dcp-attestation-keys.json`）。证明对象的格式见 [DCP-01.md](DCP-01.md)。

11. **可选 — 透明日志证明：** 如果持有人提供了日志包含证明（`log_url`、`log_index`、`merkle_proof`），验证 `bundle_hash` 在日志已签名根中的 Merkle 包含。如果日志根已在链上锚定，可选地验证该锚定。日志 API 和证明格式见 [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md)。

---

<a id="v2-verification-checklist"></a>

## V2 验证清单

验证 V2 Signed Bundle（`dcp_bundle_version: "2.0"`）时，执行以下步骤。它们在 V1 清单的基础上增加了复合签名验证、会话绑定和清单完整性。

参考实现：`dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]`（或 `lib/verify.js` 中的 `verifySignedBundle`），它校验 schema，并把密码学检查委托给 `@dcp-ai/sdk` 中的 `verifySignedBundleV2`。可选的公钥用于固定经典签名者。

<a id="step-v2-1-detect-version"></a>

### 步骤 V2-1：识别版本

检查 `bundle.dcp_bundle_version`。如果是 `"2.0"`，使用本 V2 清单。如果缺失或为 `"1.0"`，使用上面的 V1 清单。

<a id="step-v2-2-schema-validate"></a>

### 步骤 V2-2：按 schema 校验

按 `schemas/v2/signed_bundle.schema.json` 校验 Signed Bundle，它定义了内部 bundle，并引用 `bundle_manifest`、`signed_payload`、`audit_entry` 和 `pq_checkpoint`。按各工件的 schema 校验每个 `SignedPayload.payload`：`schemas/v2/` 中的 `responsible_principal_record`、`agent_passport`、`intent` 和 `policy_decision`。

<a id="step-v2-3-validate-manifest"></a>

### 步骤 V2-3：校验清单

bundle 必须（MUST）包含一个 `manifest` 对象，带有以下必需字段：

- `session_nonce` — 64 个字符的十六进制字符串
- `rpr_hash`、`passport_hash`、`intent_hash`、`policy_hash` — 各工件的 SHA-256 哈希
- `audit_merkle_root` — 审计条目的 Merkle 根
- `audit_count` — 审计条目数量的整数

根据对应 `payload` 的规范表示重新计算每个工件的哈希，并验证它与清单中的值以及工件自身的 `payload_hash` 一致。清单哈希缺失，或载荷缺失或无法规范化，都会使验证失败。

把审计轨迹与清单绑定：`audit_count` 必须（MUST）等于 `audit_entries` 的数量，`audit_merkle_root` 必须（MUST）等于由它们重新计算的 Merkle 根，第一个条目的 `prev_hash` 必须（MUST）是 `GENESIS`，之后每个条目的 `prev_hash` 必须（MUST）是前一条目的哈希。空审计轨迹的根是 `sha256:` 后跟 64 个零，清单 schema 的模式允许这个值；接受零个审计条目的 bundle 构建器会写入该值（Go 的 `BuildBundleV2` 和 Rust 的 `build_bundle_v2`（`wasm` 特性的 `wasm_build_bundle` 会调用它）会这样做；TypeScript 和 Python 的构建器要求至少一个条目）。每个 SDK 中服务于 PQ 检查点的 `auditEventsMerkleRoot` 辅助函数则会拒绝空列表。

<a id="step-v2-4-verify-session-nonce-consistency"></a>

### 步骤 V2-4：验证会话 nonce 的一致性

所有工件（`responsible_principal_record.payload`、`agent_passport.payload`、`intent.payload`、`policy_decision.payload`）以及所有包含 `session_nonce` 字段的 `audit_entries`，都必须（MUST）与 `manifest.session_nonce` 共享相同的 nonce。

如果存在 `manifest.session_expires_at` 且已过期，拒绝该 bundle。

`manifest.session_issued_at` 存在时表示会话开始的时间，与清单的其余部分一起签名。当它不是 RFC 3339 时间戳、比验证时间晚且差值超过 30 秒（[DCP-04](DCP-04.md) 也允许的时钟偏差）或晚于 `session_expires_at` 时，拒绝该 bundle。验证器策略的 `max_session_duration_seconds` 限制 `session_expires_at` 减去 `session_issued_at` 的差值：在这样的策略下，缺少其中任一项的 bundle 会被拒绝，绝不会从未签名的时间开始计算，也不会被当作永不结束的会话。在 `session_issued_at` 出现之前签名的 bundle，在没有最长会话时长的策略下照旧通过验证；在有最长时长的策略下会被拒绝，必须重新签名。

`composite_sig` 之外的 `signature` 块（`hash_alg`、`created_at`、`signer`、`manifest_hash`）没有签名：任何人都可以修改它而不破坏签名。它不得（MUST NOT）代替已签名的数据，就像 `created_at` 曾经代替会话开始时间那样。它也不得（MUST NOT）与已签名的内容相矛盾：`signer.id` 是 RPR 的 `human_id`，`signer.kids` 是 `composite_sig` 的 kid（先经典签名的，再是存在时 PQ 签名的），`manifest_hash` 是 `sha256:` 后跟规范清单的 SHA-256，`hash_alg` 是 `sha256` 或 `sha256+sha3-256`。

这些检查中的时间戳（此处的 `session_expires_at`、步骤 V2-13 中密钥的 `expires_at`）是带有 `Z` 或 `±hh:mm` 偏移的 RFC 3339 日期时间，例如 `2026-10-22T06:05:03-05:00`。应以毫秒精度（舍去毫秒以下的数字）将它们作为时刻比较，绝不能作为字符串比较：偏移不同的两个时间戳按字符串排序并不是它们的时间顺序。0000 至 9999 年都有效。缺失或 `null` 表示不过期。任何不是这种时间戳的其他值（没有时间的日期、没有偏移的时间、不可能的日期或时间、非字符串）都必须（MUST）被拒绝。`tests/interop/v2/interop_vectors.json` 的 `rfc3339` 类别列出了每个被接受用例的时刻以及被拒绝的用例。

<a id="step-v2-5-verify-composite-signature-structure"></a>

### 步骤 V2-5：验证复合签名的结构

bundle 级的 `signature` 必须（MUST）包含一个 `composite_sig` 对象，其中有：

- `classical` — 带有 `alg`、`kid`、`sig_b64` 的对象
- `binding` — `pq_over_classical`、`classical_only` 之一（`schemas/v2/composite_signature.schema.json`）
- `pq` — （当 binding 为 `pq_over_classical` 时必需）带有 `alg`、`kid`、`sig_b64` 的对象

bundle 签名、工件签名和检查点签名中的每个 `sig_b64` 都必须（MUST）是规范的 base64（RFC 4648 § 4：带填充、末尾比特为零、没有其他字符），以便每个验证器解码出相同的字节，且一个签名只有一种编码。否则拒绝该 bundle。

<a id="step-v2-6-verify-classical-signature"></a>

### 步骤 V2-6：验证经典签名

重建被签名的消息：`context_tag || 0x00 || canonical(manifest)`，其中 `context_tag` 为 `"DCP-AI.v2.Bundle"`。用 `composite_sig.classical.kid` 标识的公钥、按 `composite_sig.classical.alg` 指定的算法（通常为 Ed25519）验证 `composite_sig.classical.sig_b64`。

bundle 的签名者是负责的委托人：只在 RPR 的 `binding_keys` 中查找该 kid。委托人对清单的签名（清单承诺了 `passport_hash`）把这个代理及其密钥绑定到委托人；代理自己签名自己的护照，因此只出现在护照中的密钥不得（MUST NOT）验证 bundle 签名。否则任何人都可以把一份已发布、已签名的 RPR 与自己的护照和密钥配对。

这把代理绑定到持有 RPR `binding_keys` 的人。它并不能证明那是谁：任何人都可以用任意 `human_id` 和自己的密钥生成 RPR。需要确认委托人身份的验证器会固定其密钥（就像 `dcp verify-bundle` 用公钥所做的那样）、检查司法管辖区证明，或从它信任的来源解析这些密钥。

<a id="step-v2-7-verify-pq-signature-if-present"></a>

### 步骤 V2-7：验证 PQ 签名（如果存在）

如果 `composite_sig.binding` 为 `pq_over_classical`：

1. 重建 PQ 被签名的消息：`context_tag || 0x00 || canonical(manifest) || classical_sig_bytes`
2. 用 RPR `binding_keys` 中由 `composite_sig.pq.kid` 标识的公钥、使用 PQ 算法（例如 ML-DSA-65）验证 `composite_sig.pq.sig_b64`。

存在的 PQ 签名在每种模式下都必须（MUST）通过验证，包括 `hybrid_preferred` 和 `classical_only`；无效的 PQ 签名会使验证失败。

如果 binding 为 `classical_only`，则不存在 PQ 签名。根据有效模式（步骤 V2-9），这可以（MAY）被接受：`hybrid_preferred` 接受并附带警告，`hybrid_required` 和 `pq_only` 拒绝。

<a id="step-v2-8-verify-per-artifact-composite-signatures"></a>

### 步骤 V2-8：验证每个工件的复合签名

每个工件（`responsible_principal_record`、`agent_passport`、`intent`、`policy_decision`）都包装在带有自己 `composite_sig` 的 `SignedPayload` 封装中。用与步骤 V2-6 和 V2-7 相同的流程、按每种工件类型相应的上下文标签验证每个工件的复合签名。委托人用其 `binding_keys` 签名 RPR；代理用护照的 `keys` 签名护照、意图和策略决定。

<a id="step-v2-9-compute-the-security-tier-and-the-effective-mode"></a>

### 步骤 V2-9：计算安全等级和有效模式

按 [DCP-AI-v2.0.md § 14.2](DCP-AI-v2.0.md) 根据 `intent.payload` 和 `policy_decision.payload` 计算安全等级：`risk_score` 取自策略决定，绝不取自意图；`action_type`、`estimated_impact` 或 `data_classes` 的值缺失、类型错误或未知，或策略决定的 `risk_score` 缺失或不是 0 到 1000 的整数时，失败关闭为 `elevated`；`intent.security_tier` 只能提高等级。

有效模式是策略模式（`default_mode`，或护照 `risk_tier` 对应的 `risk_overrides` 条目）与等级模式两者中更严格的一个：`routine` → `classical_only`，`standard` → `hybrid_preferred`，`elevated` 和 `maximum` → `hybrid_required`，其中 `classical_only` < `hybrid_preferred` < `hybrid_required`。`pq_only` 策略保持为 `pq_only`。随结果报告解析出的等级。

<a id="step-v2-10-enforce-verifier-policy"></a>

### 步骤 V2-10：执行验证器策略

将有效模式（步骤 V2-9）和验证器的策略配置应用于 bundle 签名以及每个工件签名（步骤 V2-6 至 V2-8）：

- 如果有效模式为 `hybrid_required`，拒绝 binding 为 `classical_only` 的 bundle。
- 如果有效模式为 `pq_only`，拒绝没有 PQ 签名的 bundle。
- 检查 `accepted_classical_algs` 和 `accepted_pq_algs` — 如果 bundle 使用了不在这些列表中的算法则拒绝。
- 检查 `advisory_rejected_algs` — 如果 bundle 使用了被有效公告禁用的算法则拒绝。

因此，带有 `initiate_payment` 意图的 `classical_only` bundle 即使其护照声明 `risk_tier: "low"` 也会被拒绝。

<a id="step-v2-11-verify-dual-hash-audit-chain-if-present"></a>

### 步骤 V2-11：验证双哈希审计链（如果存在）

如果审计条目包含 `prev_hash_secondary`，验证二级哈希链：

- 第一个条目：`prev_hash_secondary` = `"GENESIS"`
- 后续条目：`prev_hash_secondary` = SHA3-256(canonical(previous_entry))

<a id="step-v2-12-verify-pq-checkpoints-if-present"></a>

### 步骤 V2-12：验证 PQ 检查点（如果存在）

如果清单列出了 `pq_checkpoints`，或 bundle 带有检查点，则验证它们：

1. bundle 必须（MUST）恰好带有清单列出的检查点，按 `checkpoint_id` 各一次。列出但缺失的检查点，或带有但清单未列出的检查点，都会使验证失败：清单是已签名的，检查点正文则不是。
2. 检查点的 `event_range` 指定一段连续的 `audit_entries`，从 `audit_id` 为 `from_audit_id` 的条目到 `audit_id` 为 `to_audit_id` 的条目，共 `count` 个条目。其 `merkle_root` 必须（MUST）是 `sha256:` 后跟这些条目的 Merkle 根，计算方式与 `auditEventsMerkleRoot` 相同。
3. 其 `composite_sig` 属于代理：用护照的 `keys`、在 `DCP-AI.v2.AuditEvent` 上下文下、对去掉 `composite_sig` 的规范检查点进行验证。经典签名和 PQ 签名都必须（MUST）存在且有效（在 `pq_only` 模式下为 PQ 签名）；检查点的存在就是为了携带 PQ 签名。
4. 其 `session_nonce` 必须（MUST）是清单的那个。

<a id="step-v2-13-key-validity-checks"></a>

### 步骤 V2-13：密钥有效性检查

对复合签名（bundle 的、每个工件的和每个检查点的）中引用的每个密钥标识符（`kid`）：

- kid 必须（MUST）由验证该签名的密钥推导：`kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key))[0:32]`，其中 `alg` 和 `raw_public_key` 取自该密钥条目。否则拒绝该 bundle。这样一个 kid 只指向一个密钥，无论哪个列表包含它；没有这项检查，一个密钥列表就可以为自己的密钥冒用另一方的 kid。
- 该密钥的 `public_key_b64` 必须（MUST）是规范的 base64（RFC 4648 § 4，带填充且末尾比特为零），以便每个验证器从中解码出相同的字节。
- 可选地，对照吊销服务或本地吊销列表检查密钥状态。

如果任何能签名该 bundle 的密钥（在护照 `keys` 或 RPR `binding_keys` 中）的 `status` 为 `"revoked"` 或 `"expired"`（`schemas/v2/key_entry.schema.json` 两者都允许），或其 `expires_at` 已过期或不是 RFC 3339 时间戳（步骤 V2-4），则拒绝该 bundle。

<a id="step-v2-14-cross-artifact-consistency"></a>

### 步骤 V2-14：工件间一致性

签名证明了每个工件由谁签名；这些检查使各工件描述的是同一个委托人的同一个代理的同一项操作。它们把 V1 对 RPR、护照和 `intent_hash` 的检查延续到 V2。在以下情况下拒绝该 bundle：

- `agent_passport.status` 既不是 `active` 也不是 `declining`：`commissioned`、`suspended`、`revoked` 或 `decommissioned` 的代理不执行任何操作（[DCP-05](DCP-05.md) § 3.1）；
- RPR 的 `expires_at` 已过期或不是 RFC 3339 时间戳（步骤 V2-4）；`null` 永不过期；
- `agent_passport.principal_binding_reference` 不是 RPR 的 `human_id`；
- `intent.agent_id` 不是护照的 `agent_id`，或 `intent.human_id` 不是 RPR 的 `human_id`；
- `policy_decision.intent_id` 不是 `intent.intent_id`；
- 某个审计条目的 `intent_id` 不是 `intent.intent_id`，其 `intent_hash` 不是意图的载荷哈希（清单的 `intent_hash`），其 `agent_id` 不是护照的，或其 `human_id` 不是 RPR 的；
- 某个审计条目的 `policy_decision` 没有记录该策略决定：`approve` 对应 `approved`，`escalate` 对应 `escalated`，`block` 对应 `blocked`。

记录了被升级或被阻止操作的 bundle 是该操作的有效证据：这里没有任何内容要求决定必须是 `approve`。状态和过期检查与步骤 V2-13 的密钥检查一样，在验证时刻适用；以较早时间为准验证已归档的证据尚未定义。

<a id="verification-time-and-signer-keys"></a>

### 验证时刻与签名者密钥

V2-1 至 V2-14 中的每次时间比较都使用同一个验证时刻。实现将其作为可选参数，默认为系统时钟，以便可以在给定时间复现判定。对它们检查的每个复合签名，验证器都会报告为每个组件解析出的密钥条目以及是否通过验证（`signer_keys`）；准入配置文件读取的就是这些信息。

<a id="beyond-verification-admission"></a>

### 验证之外：准入

步骤 V2-1 至 V2-14 决定 bundle 是否通过验证：完好、一致，并由它列出的密钥签名。它们并不决定委托人是谁。已验证的 bundle 是否来自验证器已经信任的委托人，以及由运营方固定的 `strict-v1` 要求，由准入配置文件 [`profiles/admission`](profiles/admission/README.md) 在这些步骤之上定义，且不改变这些步骤。

---

<a id="protocol-integrity"></a>

## 协议完整性

在验证 bundle 之前，验证器应当（SHOULD）验证自己的 schema 与规范协议一致：

```bash
dcp integrity
```

这会对照 [`protocol_fingerprints.json`](../protocol_fingerprints.json)（位于仓库根目录）中的规范指纹检查每个本地 schema 的 SHA-256 哈希。如果任何 schema 被修改（例如在协议分叉中），检查就会失败。完整的安全模型见 [docs/SECURITY_MODEL.md](../docs/SECURITY_MODEL.md)。

<a id="reference"></a>

## 参考

- bundle 格式：[BUNDLE.md](BUNDLE.md)
- 审计链和 intent_hash：[DCP-03.md](DCP-03.md)
- 安全模型：[docs/SECURITY_MODEL.md](../docs/SECURITY_MODEL.md)
- 存储、锚定、吊销列表、透明日志：[docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md)
- 运营指南：[docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md)

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准。

- 通过这些步骤表明 bundle 按此处的定义通过了验证：完好、一致，并由它列出的密钥
  签名。它并不证明代理或委托人的身份，不表明符合任何法规，也不
  授权任何操作；对委托人的信任属于准入配置文件（[docs/ADMISSION.md](../docs/ADMISSION.md)）。
- 可选的 V1 步骤 8 至 11（锚定回执、司法管辖区吊销列表、司法管辖区证明、
  透明日志证明）不由 `dcp verify-bundle`、`lib/verify.js` 或 SDK 验证器执行；需要它们的验证器
  需自行执行。吊销快照由准入配置文件读取，而不是由这些步骤读取。
- 步骤 V2-11：在 `main` 上，SDK 验证器和 `lib/verify.js` 不重新计算二级 SHA3-256 链
  （`prev_hash_secondary`）或 `audit_merkle_root_secondary`。带有它们的 bundle 只按 SHA-256 链和
  根通过验证；需要二级链的验证器需自行检查。
- 步骤 10 把证明签名描述为“对 `rpr_hash`”所作，而 [DCP-01](DCP-01.md) 将其描述为对
  除 `signature` 以外所有字段的规范 JSON 所作，V2 schema 则使用 `composite_sig`。本说明记录
  这一差异；并不决定适用哪一种。
