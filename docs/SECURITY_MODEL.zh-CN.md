<sub>[English](SECURITY_MODEL.md) · **中文** · [Español](SECURITY_MODEL.es.md) · [日本語](SECURITY_MODEL.ja.md) · [Português](SECURITY_MODEL.pt-BR.md)</sub>

<a id="security-model"></a>

# 安全模型

> 本文是[英文版](SECURITY_MODEL.md)的参考译文，更新于 26/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

协议如何防范各种攻击，从伪造的 bundle 到协议分叉。

---

<a id="design-principle"></a>

## 设计原则

验证在本地进行。这不是弱点，而是核心的安全属性。本地验证意味着：

- **没有单一的被攻破点。** 不存在一旦被攻破就会让所有智能体失效的中央服务器。每个验证者运行自己的代码，自己核对数学运算。
- **密码学保证与地点无关。** Ed25519 签名和 SHA-256 哈希在任何机器上都得出相同的结果。你无法“攻破数学”。
- **验证者不信任智能体。** 智能体出示 bundle；验证者用自己的工具检查它。被攻破的智能体无法让验证者接受无效的 bundle。

验证说明的是 bundle 未被篡改，并由它所指明的密钥签署。是否信任这些密钥、是否据此行事，是另一项决定：需要按照运营方受信任的委托人进行准入（[ADMISSION.md](ADMISSION.md)），再加上运营方自己的授权。

安全来自**多层防护**，每一层应对不同的攻击向量。

---

<a id="attack-vectors-and-protections"></a>

## 攻击向量与防护

<a id="1-forged-bundle-tampered-content"></a>

### 1. 伪造的 bundle（内容被篡改）

**攻击：** 攻击者修改 Signed Bundle 中的某个字段（例如把 `agent_passport.status` 从 `"revoked"` 改为 `"active"`）。

**防护：** Ed25519 签名覆盖整个 bundle 的规范 JSON（`dcp-jcs-v1`）。对已签名内容的任何更改——一个值、一个键、一个元素——都会使签名失效。不改变规范形式的更改，例如空白或键的顺序，并不是对已签名内容的更改，仍能通过验证。验证者会重新计算 `bundle_hash = SHA-256(canonical(bundle))`，并与已签名的哈希比对。如果内容被修改，这两项检查都会失败。

**强度：** 密码学级别。攻破 Ed25519 需要解决 Curve25519 上的离散对数问题；目前没有已知的实际攻击。

<a id="2-forged-identity-fake-rpr"></a>

### 2. 伪造的身份（假 RPR）

**攻击：** 攻击者创建一个自称“Google”或“美国政府”的 Responsible Principal Record，并用自己的密钥签署 bundle。签名有效，但身份是假的。

**防护：**

- **Jurisdiction Attestation**（参见 [spec/DCP-01.md](../spec/DCP-01.md)）：政府或经认可的机构签署 RPR 的哈希，证明身份。要求证明的验证者会拒绝没有证明的 bundle。
- **公钥绑定：** 验证者可以要求签名者的公钥是已知的（例如由该实体公布）。假的“Google” bundle 不会有 Google 真正的公钥。
- **透明度日志：** 如果真实实体的 `bundle_hash` 在日志中而伪造的不在，伪造就可以被发现。

**强度：** 取决于是否要求证明。没有证明时，身份是自我声明的（类似自签名证书）。有证明时，身份由权威机构背书。

<a id="3-stolen-signing-key"></a>

### 3. 被盗的签名密钥

**攻击：** 攻击者窃取用户的私钥，以其名义创建有效的 bundle。

**防护：**

- **吊销：** 密钥所有者（或司法辖区）发布已签名的 RevocationRecord。所有检查吊销列表的验证者都会拒绝用被攻破密钥签署的 bundle。
- **司法辖区吊销列表：** 政府在一个众所周知的 URL 上发布已签名的被吊销智能体列表。验证者获取并缓存它。
- **密钥轮换：** 生成新的密钥对（`dcp keygen`），重新签署 bundle，吊销旧密钥。

**强度：** 取决于吊销的传播，以及验证者在无法获取最新状态时如何处理。仅靠缓存 TTL 并不能构成上限：被盗的密钥在所有者发布吊销之前一直可用，之后还要等到每个验证者获取到包含该吊销的列表。使用缓存列表（例如 1 小时 TTL）时，只有按时刷新、且在无法获取列表时以失败即关闭方式处理的验证者，发布后的窗口才约为一小时。继续使用过期列表、或在信息源不可达时跳过吊销检查的验证者，则没有上限。strict-v1 准入配置要求吊销快照最旧不超过 300 秒，并在信息源不可用时失败（[ADMISSION.md](ADMISSION.md#revocation-sources)）。

<a id="4-modified-verifier-compromised-verification-code"></a>

### 4. 被修改的验证器（被攻破的验证代码）

**攻击：** 攻击者（或粗心的实现者）修改验证代码，使其总是返回 `verified: true`，绕过所有检查。

**防护：**

- **信任边界。** 被攻破的验证器会影响其运营方以及依赖其结果的客户端。独立运行的验证器不会继承这些结果；但被攻破的共享依赖可能影响多个运营方。
- **模式指纹检查：** `dcp integrity` 把本地的 V1 模式与本地 `protocol_fingerprints.json` 中的指纹进行比较（见下文）。它能发现被修改但未更新指纹的 V1 模式；它不检查验证代码。
- **一致性测试：** `npm run conformance` 按已知正确的测试夹具验证实现。改变了这些夹具上结果的被修改实现无法通过一致性测试；而夹具未覆盖范围之外的更改仍可能通过。

**强度：** 影响取决于被攻破的代码如何分发，以及谁依赖其结果。独立验证可以限制对另一个验证器的依赖，但不能消除供应链风险。

<a id="5-protocol-fork-the-real-threat"></a>

### 5. 协议分叉（真正的威胁）

**攻击：** 有人分叉协议，削弱模式（删除必需字段、放宽验证），并声称与 DCP 兼容。如果被广泛采用，这会侵蚀生态系统中的信任。

**防护：**

- **协议指纹：** 仓库根目录下的 `protocol_fingerprints.json` 文件包含每个 V1 模式文件的 SHA-256 哈希。任何实现都可以用它们核对自己的 V1 模式。如果有人修改了某个模式，其哈希就会改变。
- **`dcp integrity` 命令：** 把 `schemas/v1/` 中的 V1 模式与本地 `protocol_fingerprints.json` 中的指纹进行比较：

  ```bash
  dcp integrity
  # ✅ PROTOCOL INTEGRITY VERIFIED — all schemas match canonical fingerprints.
  ```

- **一致性证据：** 使用从可信来源获得的模式通过 `npm run conformance`，可以证明在该测试套件所覆盖的用例上是一致的。它并不能证明协议的所有要求或所有输入都被正确处理；还应审查实现以及所适用规范的覆盖情况。
- **bundle 级版本：** 每个构件都包含 `dcp_version: "1.0"`。验证者检查版本并使用相应的模式。使用不同模式的分叉需要不同的版本，从而可以被区分出来。

**强度：** 有限。指纹能发现与其旁边的指纹文件不一致的 V1 模式。它们并不认证该文件本身（该文件没有签名，分叉可以同时修改二者），不覆盖 V2 模式，也不说明任何关于代码的事情。匹配并不是对实现的认证。要评判一个实现，请与从你信任的来源获得的指纹进行比较，并运行一致性测试套件。

<a id="6-retroactive-modification-bundle-changed-after-anchoring"></a>

### 6. 追溯性修改（锚定之后更改 bundle）

**攻击：** 攻击者在 bundle 被锚定到区块链或记录到透明度日志之后修改它。

**防护：**

- **锚定的不可变性：** Bitcoin（OP_RETURN）或 Ethereum（事件）中的 `bundle_hash` 是不可变的。攻击者无法更改链上的哈希。
- **验证：** 验证者根据 bundle 重新计算 `bundle_hash` 并与锚定进行比较。如果 bundle 被修改，哈希就不匹配。
- **透明度日志证明：** 日志记录了原始的 `bundle_hash`。Merkle 包含证明把该哈希与已签名的根联系起来。如果 bundle 被修改，证明就会失败。

**强度：** 密码学 + 区块链不可变性。只要锚定或日志条目存在，追溯性修改就可以被发现。

---

<a id="protection-layers-summary"></a>

## 防护层（概要）

```
Layer 1: Cryptography (Ed25519 + SHA-256)
  Forged bundles are detected by signature and hash checks.

Layer 2: Attestation (jurisdiction signs RPR)
  Fake identities are detected if attestation is required.

Layer 3: Revocation (signed lists by jurisdiction)
  Fresh status and fail-closed handling bound acceptance after revocation;
  a cache TTL alone is not a propagation guarantee.

Layer 4: Protocol integrity (fingerprints + dcp integrity)
  A V1 schema changed without its fingerprint is detected.

Layer 5: Transparency log (append-only Merkle tree)
  Retroactive modifications are detected by log proof mismatch.

Layer 6: Blockchain anchor (Bitcoin / Ethereum)
  Provides immutable, public proof of bundle existence at a point in time.
```

第 1–4 层目前在本仓库中可用。第 5 层有一个参考服务（`services/transparency-log/`，内存实现）。第 6 层已经设计（[docs/STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)），并有一个 Ethereum 合约（`contracts/ethereum/`），但参考锚定服务尚未向链上提交；生产实现因运营方而异。

---

<a id="protocol-fingerprints"></a>

## 协议指纹

仓库根目录下的 `protocol_fingerprints.json` 文件包含 `schemas/v1/` 中每个模式文件字节的 SHA-256 哈希。格式：

```json
{
  "protocol": "DCP-AI",
  "version": "1.0",
  "schema_fingerprints": {
    "responsible_principal_record": "sha256:<hex>",
    "agent_passport": "sha256:<hex>",
    ...
  }
}
```

任何实现——无论使用何种语言、在何种平台上——都可以计算自己模式文件的 SHA-256，并与这些指纹进行比较。匹配意味着其 V1 模式文件与被计算指纹的文件逐字节相同；它并不能证明其代码能正确验证，而且指纹文件的可信度只取决于你获取它的来源。

**本地验证：**

```bash
dcp integrity
```

---

<a id="what-the-protocol-does-not-protect-against"></a>

## 协议不能防范什么

- **有效 bundle 背后的恶意人类。** DCP 可以携带委托人绑定以及按照运营方信任配置检查的证据。它不会自动确立现实世界的身份，也不保证委托人的行为合乎道德。执法和监管仍在密码学验证的范围之外。
- **接受无效 bundle 的被攻破验证器。** 运行正确的验证代码是每个实体自己的责任。协议提供指纹和一致性测试；使用它们是运营方的责任。
- **拒绝服务。** 限流在 API 中按端点规定（参见 [`api/openapi.yaml`](../api/openapi.yaml) 中的 `x-ratelimit`）。基础设施层面的 DDoS 缓解是运营方的责任。
- **有效 bundle 的重放。** 已签名的 bundle 可以被再次出示；对其限制参见[跨构件重放](#9-cross-artifact-replay)。

---

---

<a id="v20-security-enhancements"></a>

## V2.0 安全增强

DCP v2.0 通过后量子密码学、复合签名、自适应安全等级和智能体间安全，大幅加强了安全模型。

<a id="7-post-quantum-threat-model"></a>

### 7. 后量子威胁模型

**攻击：** 能够使用大规模量子计算机的量子攻击者（或采用“现在收集、以后解密”策略的攻击者）以 Ed25519 签名和密钥交换为目标。

**防护：**
- **混合复合签名：** V2 复合签名把 Ed25519（经典）与 ML-DSA-65（后量子，FIPS 204）结合在一起。PQ 签名覆盖经典签名（`pq_over_classical` 绑定），因此只攻破其中之一是不够的。V2 签名也可以是 `classical_only`；它是否被接受取决于验证模式（§8）。
- **混合 KEM：** DCP-04 的密钥交换使用 X25519 + ML-KEM-768（FIPS 203），因此只要其中任一算法仍然安全，会话密钥就保持安全。SDK 不执行这一交换：由调用方导出会话密钥（[NIST_CONFORMITY.md](NIST_CONFORMITY.md) §2.1）。
- **双哈希链：** 设计并行使用 SHA-256 和 SHA3-256，以便在一个哈希家族被攻破时保持连续性，前提是两条链都经过验证。尚未发布的源代码中的 V2 bundle 验证器会检查存在的可选次级链接和次级 Merkle 根，但不要求它们存在，已发布的软件包也不检查它们，因此验证成功并不能证明存在这种额外保护（[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains)）。

**强度：** 对于在 `hybrid_required` 模式（elevated 和 maximum 等级的模式）下检查的签名，具有 NIST 第 3 级后量子安全性：攻击者必须同时攻破经典算法和后量子算法。

<a id="8-stripping-attacks-composite-signature"></a>

### 8. 剥离攻击（复合签名）

**攻击：** 攻击者截获已签名的 bundle，移除后量子签名分量，只出示经典签名。

**防护：** `pq_over_classical` 绑定协议确保：
1. `classical_sig = Ed25519.sign(context || 0x00 || payload)`
2. `pq_sig = ML-DSA-65.sign(context || 0x00 || payload || classical_sig)`

PQ 签名覆盖经典签名，因此被修改的经典签名，或被挪到另一个载荷上的 PQ 签名，都会验证失败。把 PQ 签名整个移除会留下一个 `classical_only` 签名，是否接受它只由实际生效的模式决定：`hybrid_required`（以及 `pq_only`）会拒绝它，`hybrid_preferred` 会带着警告接受它，`classical_only` 会接受它。

**强度：** 在 `hybrid_required` 模式下为密码学级别。在 `hybrid_preferred` 或 `classical_only` 下，剥离是可见的（警告、`classical_only` 绑定），但不会被拒绝。

<a id="9-cross-artifact-replay"></a>

### 9. 跨构件重放

**攻击：** 攻击者从一个会话中取出一个有效的意图，在另一个会话中或与另一个 bundle 一起重放。

**防护：**
- **域分离：** 每个签名都包含一个上下文标签（例如 `DCP-AI.v2.Intent`、`DCP-AI.v2.Bundle`）。一种构件类型的签名不能被重放用于另一种类型。
- **会话 nonce：** 每个 bundle 都包含一个 256 位的随机会话 nonce。清单把所有构件绑定到该 nonce。把一个会话的构件重放到另一个会话中会破坏清单哈希。

nonce 并不能阻止同一个 bundle 被再次出示：整个 bundle 会原样被重放。已签名的会话过期时间和已签名的 `intended_verifier`（strict-v1 准入配置两者都要求）限定了 bundle 可以在何处、多长时间内被重放；它们并不使其成为一次性的。需要一次性使用的验证者应自行记录已消费的 nonce 或 bundle 哈希（[ADMISSION.md](ADMISSION.md#limits)）。

**强度：** 针对构件混用，具有密码学域分离 + 会话绑定；但不能防范整个 bundle 的重放。

<a id="10-security-tier-downgrade"></a>

### 10. 安全等级降级

**攻击：** 恶意智能体为高风险操作声明一个较低的安全等级（例如 `routine`），以规避 PQ 签名要求。

**防护：**
- **由验证器决定的策略：** 决定最低等级的是验证者，而不是智能体。它按其策略模式与等级模式中较严格者验证每个 bundle（规范 §14.3），因此声明 `risk_tier: "low"` 的护照无法为支付意图获得 `classical_only`。验证者可以提高等级，但不得（MUST NOT）降低等级。
- **自动计算等级：** SDK 根据策略决定的 `risk_score` 以及意图的 `data_classes`、`action_type` 和 `estimated_impact` 计算等级（规范 §14.2）。未知或缺失的值以失败即关闭方式定为 `elevated`，智能体无法把计算出的等级往下调。
- **禁止降级规则：** 如果意图计算结果为 `elevated`，但智能体声明 `routine`，验证者会解析为 `elevated`。

**强度：** 在验证器层面执行策略。

<a id="11-a2a-session-security"></a>

### 11. A2A 会话安全

**攻击：** 攻击者截获或劫持智能体间的通信会话。

**防护：**
- **相互验证 bundle：** 在建立会话之前，两个智能体互相验证对方的 bundle。
- **混合 KEM 密钥交换：** 临时密钥提供前向保密。长期密钥被攻破不会泄露过去的会话密钥。SDK 把这一交换留给调用方。
- **AES-256-GCM 加密：** 所有会话消息都用认证加密进行加密。
- **单调递增的序号：** 防止会话内的重放和重排。
- **定期更换密钥：** 会话会报告何时需要更换密钥（`needsRekeying`）；由调用方导出新密钥。
- **吊销感知：** 规范要求在任一智能体被吊销时结束会话。SDK 不会在会话期间监视吊销：应用必须自行检查并关闭会话。

**强度：** 当调用方执行混合交换和密钥更换时，提供后量子前向保密 + 认证加密。

<a id="12-lifecycle-state-manipulation-dcp-05"></a>

### 12. 生命周期状态操纵（DCP-05）

**攻击：** 恶意行为者试图绕过生命周期状态转换——例如重新激活已停用的智能体，或跳过“declining”状态以规避数据处置流程。

**防护（规范和 SDK）：**
- **状态机：** `commissioned → active → declining → decommissioned`；无效的转换会被拒绝。
- **已签名的生命周期记录：** 每次状态转换（启用证书、活力报告、停用记录）都带有复合签名，活力报告以哈希相互链接。
- **最终停用：** 智能体一旦到达 `decommissioned`，就不能再进行任何转换。停用记录会说明数据的处置方式。

**在参考服务器中：** 生命周期端点会拒绝无效的转换（409），但不验证记录的签名，也不需要认证；为已停用的智能体提交新的启用证书会把它重置为 `commissioned`（[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#dcp-0509-service-endpoints)）。

**强度：** 在验证记录签名的地方（由 SDK 函数，或由调用这些函数的服务验证），提供状态机加已签名轨迹。仅靠参考服务器，二者都得不到。

<a id="13-unauthorized-succession-dcp-06"></a>

### 13. 未经授权的继承（DCP-06）

**攻击：** 未经授权的一方为其并不控制的智能体创建数字遗嘱或发起继承，把记忆和权限转移给不正当的继任者。

**防护：**
- **遗嘱签名：** 数字遗嘱带有绑定 `agent_id` 和 `successor_preferences` 的复合签名。参考服务器存储遗嘱时不验证该签名。
- **记忆分类：** 记忆转移使用分级的访问级别。只有与继任者许可相符的条目才会被转移。
- **双哈希清单：** 记忆转移清单使用双哈希（SHA-256 + SHA3-256）引用，防止被转移的数据遭到篡改。

**强度：** 对于检查签名的验证者，提供继承权限的密码学绑定 + 分级记忆的访问控制。

<a id="14-delegation-abuse--authority-escalation-dcp-09"></a>
<a id="14-delegation-abuse-authority-escalation-dcp-09"></a>

### 14. 委托滥用与权限升级（DCP-09）

**攻击：** 拥有委托权限的智能体试图超出其委托范围，或伪造委托书以授予未经授权的能力。

**防护：**
- **有范围限定的委托书：** 每份委托书都指定 `authority_scope`，其中有明确的领域和操作。超出范围的操作会被拒绝。
- **关注阈值：** 当委托参数超出定义的限值（风险分数、金额、数据敏感度）时，可配置的阈值会触发告警或要求人工确认。
- **委托人镜像：** `PrincipalMirror` 记录保存委托人偏好的可验证快照，防止委托权限与委托人意图之间发生偏离。
- **交互记录：** 交互可以记录为已签名的 `InteractionRecord` 条目；是否记录取决于应用。

**强度：** 对于检查委托书及其签名的验证者，提供有范围的授权 + 阈值监控 + 密码学审计轨迹。参考服务器存储委托书时不验证其签名，并允许任何人吊销可吊销的委托书（[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#dcp-0509-service-endpoints)）。

<a id="updated-protection-layers-v20"></a>

### 更新后的防护层（V2.0）

```
Layer 1: Cryptography (Ed25519 + ML-DSA-65 composite, SHA-256 + SHA3-256 dual hash)
  Forged bundles detected. Post-quantum resistant.

Layer 2: Attestation (jurisdiction signs RPR)
  Fake identities detected if attestation is required.

Layer 3: Revocation (lists + emergency revocation via pre-image)
  Stolen keys are refused by verifiers that fetch fresh status and fail closed.
  Emergency revocation: revealing the pre-image revokes all keys without a signature,
  effective for each verifier once it learns of it.

Layer 4: Protocol integrity (fingerprints + dcp integrity)
  A V1 schema changed without its fingerprint is detected.

Layer 5: Transparency log (append-only Merkle tree)
  Retroactive modifications detected by log proof mismatch.

Layer 6: Blockchain anchor (Bitcoin / Ethereum L2)
  Immutable, public proof of bundle existence.

Layer 7: Security Tiers (V2.0)
  Risk-adaptive cryptographic requirements. High-risk = full PQ.

Layer 8: A2A Security (DCP-04)
  Mutual authentication + encrypted channels between agents.

Layer 9: Observability (V2.0)
  Telemetry, metrics, and alerting for anomalous behavior.

Layer 10: Lifecycle Governance (DCP-05)
  Signed lifecycle records and a state machine, where the signatures are verified.

Layer 11: Succession Security (DCP-06)
  Signed testaments and classified memory transfers protect succession integrity.

Layer 12: Dispute Resolution (DCP-07)
  Structured escalation prevents unresolved conflicts from compromising operations.

Layer 13: Rights Enforcement (DCP-08)
  Declared rights and obligations create verifiable compliance boundaries.

Layer 14: Delegation Control (DCP-09)
  Scoped mandates and awareness thresholds prevent authority escalation.
```

关于 NIST 后量子密码学符合性的详情，参见 [NIST_CONFORMITY.md](NIST_CONFORMITY.md)。
关于从 V1.0 安全模型迁移，参见 [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md)。

---

<a id="operational-security-requirements"></a>

## 运营安全要求

<a id="private-key-storage"></a>

### 私钥存储

| 安全等级 | 要求 |
|---|---|
| **Routine** | 权限为 0600 的密钥文件，静态加密（操作系统级） |
| **Standard** | 用口令加密的密钥库（PKCS#8 或类似格式） |
| **Elevated** | 集成 HSM/TPM（SHOULD）。集成操作系统钥匙串 |
| **Maximum** | 集成 HSM/TPM（MUST）。在气隙隔离的仪式中生成密钥 |

本仓库没有 HSM/TPM 集成：TypeScript 源码中的 `HsmCryptoProvider` 是一个模拟模式，不得用于真实的证据（[NIST_CONFORMITY.md](NIST_CONFORMITY.md) §2.2）。elevated 和 maximum 两行需要你自己的集成。

参考 CLI（`bin/dcp.js`）和 Python SDK 的 CLI 以 `0600` 模式（所有者可读写，组和其他用户没有权限）写出私钥文件。交互式的 `@dcp-ai/cli init` 不会这样做：它以默认权限写出（在常见的 umask `022` 下为 `0644`），因此请运行 `chmod 600 .dcp/keys/*_secret.key`。运营方不得（MUST NOT）放宽这些权限。

<a id="revocation-propagation-slas"></a>

### 吊销传播 SLA

| 安全等级 | 可接受的最大延迟 |
|---|---|
| **Routine** | 24 小时 |
| **Standard** | 1 小时 |
| **Elevated** | 15 分钟 |
| **Maximum** | 立即（推送通知 + 类 OCSP 装订） |

这些是给运营方的目标。仓库中没有推送通知或装订；最接近的是 strict-v1 准入配置，它要求吊销快照最旧不超过 300 秒。运营方应当（SHOULD）根据其服务的最高等级配置吊销列表的缓存 TTL，并在无法获取列表时以失败即关闭方式处理。

<a id="api-security"></a>

### API 安全

所有生产部署都必须（MUST）：
- 强制使用 TLS 1.3（最低 TLS 1.2）
- 在所有修改数据的端点上要求认证（Bearer 令牌或 API 密钥）
- 按照 `openapi.yaml` 中的 `x-ratelimit` 规定配置限流
- 设置安全头：`Strict-Transport-Security`、`Content-Security-Policy`、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`
- 把 CORS 限制在受信任的来源
- 对验证响应使用 `Cache-Control: no-store`

<a id="v1-to-v2-downgrade-prevention"></a>

### 防止从 V2 降级到 V1

当某个智能体已注册 V2 密钥时，验证者应当（SHOULD）拒绝该智能体的 V1 bundle（能力固定）。策略标志 `allow_v1_bundles` 在迁移期间默认为 `true`，但迁移完成后应当（SHOULD）设为 `false`。

<a id="supply-chain-security"></a>

### 供应链安全

部署 DCP 的运营方必须（MUST）：
- 在锁文件中固定所有密码学库的版本
- 使用 SRI 哈希验证依赖的完整性
- 监控上游库（`@noble/post-quantum`、`tweetnacl` 等）是否被攻破
- 对密码学组件使用可复现构建

---

<a id="known-limitations-and-mitigations"></a>

## 已知的限制与缓解措施

| 限制 | 缓解措施 |
|---|---|
| `routine` 等级下的身份是自我声明的 | 对 `standard` 及以上等级要求证明，或按信任集合进行准入；验证器本身不会强制这一点 |
| 验证缓存可能返回过时的结果 | 吊销列表更新时必须（MUST）使缓存失效。TypeScript 的 `VerificationCache` 只以 bundle 哈希为键，其 `invalidateByAgent` 不做任何事，因此请清空缓存，或不要在信任或吊销变化前后沿用缓存（[API_REFERENCE.md](API_REFERENCE.md)） |
| 已发布的 V2 验证器不检查可选的次级审计链或次级 Merkle 根；在尚未发布的源代码中会检查存在的字段，不存在的不作要求 | 使用已发布的软件包时，只依赖实际执行的检查：主 SHA-256 承诺和签名，不要因验证成功就声称获得了 V2-11 中规定的额外保护。在尚未发布的源代码中，验证成功覆盖的是存在的次级字段，而不是完整的次级链；实验性候选也复用这些检查（[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains)） |
| `agent_id` 的持久性使追踪成为可能 | 在高隐私场景中考虑轮换化名 |
| BlindedRPR 暴露 `entity_type` 和 `jurisdiction` | 未来：基于 ZKP 的凭证出示 |
| 没有任何 SDK 执行 DCP-04 的 X25519 + ML-KEM-768 交换 | 由调用方导出 A2A 会话密钥。Python、Go、Rust 和 WASM 把 ML-KEM-768 作为原语公开；TypeScript 的 KEM 提供者是内部的 |
| ML-DSA-87 未实现 | 该标识符在密钥模式中被保留；没有 SDK 能使用它，列出它的模拟 HSM 模式也不是实现 |
| 参考服务器的 DCP-05–09 端点没有认证，也不验证签名 | 不要把它们暴露给不受信任的客户端（[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#dcp-0509-service-endpoints)） |

以下在早期草稿中出现的限制已经**解决**：

- *CLI 中的 PQ 密码学是模拟的（HMAC 占位符）*：已解决；参考 CLI（`bin/dcp.js`）现在通过 `@noble/post-quantum` 使用真实的 ML-DSA-65 来生成密钥和签名。
- *CLI 中的 Shamir SSS 是占位符（随机份额）*：已解决；CLI 在密钥恢复操作中使用 `secrets.js-grempe`，这是一个真正的 Shamir 秘密共享库。
- *DCP-04..09 的行为只在 TypeScript 中实现*：已在 2.2.0..2.7.0 中解决；生命周期、继承、争议解决、仲裁、权利与义务、委托、关注阈值和委托人镜像在 Python、Rust 和 Go 中都已提供，语义与 TypeScript 参考实现相同。A2A 握手消息和 AES-256-GCM 会话层在 Python 和 Go 中提供；Rust 覆盖发现、握手消息和会话 ID。逐版本的明细参见 [CHANGELOG.md](../CHANGELOG.md#210---2026-04-22)。
- *规范错误分类只在 TypeScript 中实现*：已在 2.7.0 中解决；38 个带有稳定 `DCP-E###` 标识符的 `DcpErrorCode` 值现已在 TypeScript、Python、Rust 和 Go 之间对齐，跨 SDK 的错误处理可以通过同一个字符串匹配。
- *Python CLI 的 `keygen` 以默认文件模式写出私钥*：已解决；`sdks/python/dcp_ai/cli.py` 现在直接在 `os.open` 调用中以 0600 模式原子地创建 `secret_key.txt`（没有 chmod 竞争窗口），并把所在目录设为 0700 模式。

---

<a id="reference"></a>

## 参考资料

- 验证检查清单：[spec/VERIFICATION.md](../spec/VERIFICATION.md)
- 协议指纹：[protocol_fingerprints.json](../protocol_fingerprints.json)
- DCP-01（证明）：[spec/DCP-01.md](../spec/DCP-01.md)
- 存储、锚定、吊销：[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)
- 技术架构：[TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)
