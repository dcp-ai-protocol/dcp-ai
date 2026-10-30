<sub>[English](../../../docs/NIST_CONFORMITY.md) · **中文** · [Español](../../es/docs/NIST_CONFORMITY.md) · [日本語](../../ja/docs/NIST_CONFORMITY.md) · [Português](../../pt-BR/docs/NIST_CONFORMITY.md)</sub>

<a id="dcp-ai-nist-post-quantum-cryptography-conformity-statement"></a>

# DCP-AI 与 NIST 后量子密码标准的符合性声明

> 本文是[英文版](../../../docs/NIST_CONFORMITY.md)的参考译文，更新于 28/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

**规范版本：** 2.0
**最后更新：** 2026 年 10 月 25 日
**状态：** 有效 — 描述 2026 年 10 月 25 日 `main` 上的 SDK；已发布的包可能滞后（参见各 SDK 的 *Release status*）

本文档说明 DCP-AI 如何与 NIST 的后量子密码标准保持一致，并为实现者提供符合性评估。DCP-AI 把 FIPS 203、FIPS 204 和 FIPS 205 的算法作为其混合后量子安全架构的核心组件。

> **是算法，不是经过验证的模块。** 使用 FIPS 203、204 和 205 规定的算法并不等于 FIPS 140-3 验证。验证适用于加密模块，由 NIST 的 [Cryptographic Module Validation Program](https://csrc.nist.gov/projects/cryptographic-module-validation-program/validated-modules) 测试并列出。本仓库没有证据表明 §8 中的库是经过验证的模块，也不作任何 FIPS 140 声明。它也没有硬件安全模块（HSM）集成：参见 §2.2。

---

<a id="1-standards-coverage"></a>

## 1. 标准覆盖范围

| NIST 标准 | 算法 | 在 DCP-AI 中的用途 | 提供情况 | 说明 |
|---------------|-----------|-------------|---------|-------|
| FIPS 203 | ML-KEM-768 | 用于 A2A 会话的混合 KEM、信封加密 | Python、Go、Rust、WASM（公开的提供程序）；TypeScript（内部，未导出） | 没有 SDK 导出 X25519 + ML-KEM-768 混合交换；A2A 会话接收由调用方派生的会话密钥（§8）。 |
| FIPS 204 | ML-DSA-65 | 复合绑定中的后量子签名 | 全部 5 个 SDK | 主要的 PQ 签名。 |
| FIPS 204 | ML-DSA-87 | 高保证的后量子签名 | 未实现 | 在密钥 schema 中保留了标识符；没有 SDK 提供它的提供程序。 |
| FIPS 205 | SLH-DSA-192f | 基于哈希的备用签名方案 | TypeScript、Python、Rust、Go、WASM | 启用中的备用方案（SLH-DSA-SHA2-192f）。 |
| FIPS 205 | SLH-DSA-256f | 5 级基于哈希的签名 | 未提供 | 保留。 |
| SP 800-208 | LMS / XMSS | 未使用 | 不适用 | 仅作背景：DCP-AI 使用无状态的 SLH-DSA，而不是 LMS/XMSS（§2.4）。 |

---

<a id="2-algorithm-parameter-mapping"></a>

## 2. 算法参数对应

<a id="21-ml-kem-fips-203--key-encapsulation"></a>
<a id="21-ml-kem-fips-203-key-encapsulation"></a>

### 2.1 ML-KEM（FIPS 203）— 密钥封装

DCP-AI 规范在与 X25519 的混合构造中使用 ML-KEM-768，用于建立智能体之间（A2A）的会话以及可选的信封加密。没有 SDK 执行该交换：由调用方执行，会话密钥归调用方所有（参见本节末尾）。

| 参数 | FIPS 203 的值 | DCP-AI 的值 | 说明 |
|-----------|---------------|-------------|-------|
| 参数集 | ML-KEM-768 | `ml-kem-768` | NIST 安全级别 3 |
| 公钥大小 | 1184 字节 | 1184 字节 | 符合 |
| 密文大小 | 1088 字节 | 1088 字节 | 符合 |
| 共享秘密大小 | 32 字节 | 32 字节 | 符合 |
| 混合构造 | N/A | X25519 + ML-KEM-768 | 通过 HKDF-SHA256 组合共享秘密 |
| DCP-AI 标识符 | N/A | `x25519-ml-kem-768` | 混合 KEM 标识符 |
| 密钥派生 | N/A | HKDF-SHA256（RFC 5869） | A2A 会话密钥：`info = "DCP-AI.v2.A2A.SessionKey"`（[DCP-04](../../../spec/DCP-04.md) §3.4） |

**在 DCP-AI 中的用途：**

- **A2A 握手（DCP-04，规范中的构造）：** 双方交换临时的混合 KEM 公钥。每一方都对另一方的密钥进行封装。会话密钥通过 HKDF-SHA256 组合双方的共享秘密派生出来。这些步骤由调用方完成；SDK 的会话函数接收得到的密钥。
- **密钥恢复（规范 §11.2）：** 规范用混合 KEM 加密发给恢复联系人的 Shamir SSS 份额。SDK 的 `setupKeyRecovery` 和 `dcp recovery-setup` 会生成份额，但不会加密它们；`dcp recovery-setup` 把每个份额写入各自的文件，权限为 `0600`。

**规范中的混合 KEM 构造**（大小取自 [DCP-AI v2.0](../../../spec/DCP-AI-v2.0.md) 的算法表；会话密钥取自 DCP-04 §3.4）：

```
combined_pk = x25519_pk || ml_kem_768_pk       (1216 bytes)
combined_ct = x25519_ct || ml_kem_768_ct       (1120 bytes)
session_key = HKDF-SHA256(
  salt = nonce_A || nonce_B,
  ikm  = shared_secret_BA || shared_secret_AB,
  info = "DCP-AI.v2.A2A.SessionKey",
  len  = 32
)
```

**TypeScript 源码中有一个编码不同的内部混合 KEM。** `HybridKemProvider`（连同 `X25519KemProvider` 和 `MlKem768Provider`）位于 `sdks/typescript/src` 中，但没有从 `@dcp-ai/sdk` 导出，因此不属于该包的 API。它不是上面的二进制拼接：

- 它的组合公钥、私钥和密文分别是一个 JSON 对象 `{ "classical": …, "pq": … }` 的 base64，其中 X25519 部分采用 DER 编码（公钥和密文中为 SPKI，44 字节；私钥中为 PKCS#8），而不是原始的 32 字节，ML-KEM-768 部分为 1184 字节（公钥）和 1088 字节（密文）；
- 它的共享秘密是 `HKDF-SHA256(ikm = x25519_ss || ml_kem_768_ss, salt = "DCP-AI.v2.HybridKEM", info = "x25519-ml-kem-768")`。

没有 SDK 会替你执行 DCP-04 的交换：§3.4 的 A2A 会话密钥由调用方派生，并传给 SDK 的会话函数。

<a id="22-ml-dsa-fips-204--digital-signatures"></a>
<a id="22-ml-dsa-fips-204-digital-signatures"></a>

### 2.2 ML-DSA（FIPS 204）— 数字签名

DCP-AI 把 ML-DSA-65 作为与 Ed25519 复合绑定的主要后量子签名算法。ML-DSA-87 已保留，未实现。

<a id="ml-dsa-65-primary"></a>

#### ML-DSA-65（主要）

| 参数 | FIPS 204 的值 | DCP-AI 的值 | 说明 |
|-----------|---------------|-------------|-------|
| 参数集 | ML-DSA-65 | `ml-dsa-65` | NIST 安全级别 3 |
| 公钥大小 | 1952 字节 | 1952 字节 | 符合 |
| 私钥大小 | 4032 字节 | 4032 字节 | 符合 |
| 签名大小 | 3309 字节 | 3309 字节 | 符合 |
| 域分离 | 上下文字符串参数 | 上下文标签前缀 | 参见第 3 节 |
| 随机化签名 | 对冲（默认）或确定性 | 取决于提供程序 | TypeScript（`@noble/post-quantum` 默认）和 Rust（`fips204` 的 `try_sign`）提供程序为对冲；Go 提供程序（CIRCL 的 `SignTo`，`randomized = false`）为确定性；Python 遵循 `pqcrypto` 的默认值，此处未核实。两种方式都是有效的 FIPS 204 签名，验证方式相同 |

<a id="ml-dsa-87-high-assurance--reserved"></a>
<a id="ml-dsa-87-high-assurance-reserved"></a>

#### ML-DSA-87（高保证 — 保留）

ML-DSA-87 保留供将来的高保证用途使用。`ml-dsa-87` 是密钥 schema 中 `alg` 的可接受值，下面的大小来自 FIPS 204，但没有 SDK 能用它生成密钥、签名或验证，参考 CLI 也拒绝生成它的密钥。

TypeScript SDK 源码中有 `HsmCryptoProvider`（`sdks/typescript/src/providers/hsm-provider.ts`），其中列出了 `ml-dsa-87`。它是一个**模拟模式**，而不是 HSM 集成：它没有被导出或注册，没有 PKCS#11 绑定，生成随机的“公钥”，在应有签名的位置生成一个哈希，而且它的 `verify` 会接受任何长度正确的签名。不得用它来签署或验证真实的证据。

| 参数 | FIPS 204 的值 | DCP-AI 的值 | 说明 |
|-----------|---------------|-------------|-------|
| 参数集 | ML-DSA-87 | `ml-dsa-87` | NIST 安全级别 5 |
| 公钥大小 | 2592 字节 | 2592 字节 | 符合 |
| 私钥大小 | 4896 字节 | 4896 字节 | 符合 |
| 签名大小 | 4627 字节 | 4627 字节 | 符合 |
| 状态 | — | 保留 | 任何 SDK 都未实现。 |

**在 DCP-AI 中的用途：**

- **复合签名：** 在 `pq_over_classical` 绑定模式下，ML-DSA-65 对 (context_tag || 0x00 || payload || classical_sig) 的拼接进行签名。
- **PQ 检查点：** ML-DSA-65 对审计事件批次的 Merkle 根签名。
- **bundle 签名：** bundle 级别的复合签名把 Ed25519 与 ML-DSA-65 组合在一起。

<a id="23-slh-dsa-fips-205--stateless-hash-based-signatures"></a>
<a id="23-slh-dsa-fips-205-stateless-hash-based-signatures"></a>

### 2.3 SLH-DSA（FIPS 205）— 无状态的基于哈希的签名

DCP-AI 把 SLH-DSA-192f 用作备用的后量子签名方案。SLH-DSA 的安全性仅基于哈希函数的安全假设，在基于格的假设（ML-DSA）被削弱时提供纵深防御。

<a id="slh-dsa-192f-backup"></a>

#### SLH-DSA-192f（备用）

| 参数 | FIPS 205 的值 | DCP-AI 的值 | 说明 |
|-----------|---------------|-------------|-------|
| 参数集 | SLH-DSA-SHA2-192f | `slh-dsa-192f` | NIST 安全级别 3，快速变体 |
| 公钥大小 | 48 字节 | 48 字节 | 符合 |
| 私钥大小 | 96 字节 | 96 字节 | 符合 |
| 签名大小 | 35,664 字节 | 35,664 字节 | 符合 |
| 哈希函数 | SHA2 参数集（SHA-256 和 SHA-512） | SHA2 参数集 | 符合 |

<a id="slh-dsa-256f-reserved"></a>

#### SLH-DSA-256f（保留）

| 参数 | FIPS 205 的值 | DCP-AI 的值 | 说明 |
|-----------|---------------|-------------|-------|
| 参数集 | SLH-DSA-SHA2-256f | `slh-dsa-256f` | NIST 安全级别 5 |
| 公钥大小 | 64 字节 | 64 字节 | 保留供将来使用 |
| 签名大小 | 49,856 字节 | 49,856 字节 | 保留供将来使用 |

**在 DCP-AI 中的用途：**

- **算法替代：** 如果 ML-DSA 成为治理弃用通告的对象，验证器可以改用 SLH-DSA-192f 作为复合签名中的 PQ 部分。
- **高保证审计：** 安全态势保守的组织可以要求在 ML-DSA 之外同时使用 SLH-DSA。

<a id="24-sp-800-208-context-only"></a>

### 2.4 SP 800-208（仅作背景）

NIST SP 800-208 涵盖有状态的基于哈希的签名方案 LMS 和 XMSS。它的主要要求是操作层面的：绝不重复使用一次性签名密钥，并让签名状态（下一个未使用密钥的索引）保持持久且一致。DCP-AI 没有实现 LMS 或 XMSS，因此 SP 800-208 不适用于它，本文档也不声称符合该标准。DCP-AI 改用无状态的 SLH-DSA（FIPS 205），它没有需要保存的签名状态。这一选择避免了分布式智能体部署中的状态同步风险；它不是对 SP 800-208 的符合，确定性的 `kid` 也不是，它只用于命名一个公钥。

---

<a id="3-domain-separation-and-context-binding"></a>

## 3. 域分离与上下文绑定

FIPS 204（ML-DSA）支持用于域分离的可选上下文字符串。DCP-AI 并不使用它，而是在消息本身中实现域分离，如下所示：

```
signed_bytes = UTF8(context_tag) || 0x00 || canonical_payload_bytes
```

经典（Ed25519）签名按原样对这些字节签名。在 `pq_over_classical` 绑定中，PQ 签名对这些字节再接上经典签名的字节进行签名（§2.2），因此两个签名覆盖的不是同一条消息。DCP 上下文标签是消息内部的前缀，而不是 FIPS 204 的上下文字符串：SDK 提供程序以空的 `ctx` 调用 ML-DSA。0x00 分隔字节可防止上下文标签与载荷数据之间产生歧义。

| DCP 上下文标签 | 对应用途 |
|-----------------|---------|
| `DCP-AI.v2.AgentPassport` | 智能体身份签名 |
| `DCP-AI.v2.ResponsiblePrincipal` | Responsible Principal Record 签名 |
| `DCP-AI.v2.Intent` | 意图声明签名 |
| `DCP-AI.v2.PolicyDecision` | 策略决定签名 |
| `DCP-AI.v2.AuditEvent` | PQ 检查点和审计压缩签名（V2 审计条目不逐条签名） |
| `DCP-AI.v2.Bundle` | bundle 级签名 |
| `DCP-AI.v2.Revocation` | 撤销记录签名 |
| `DCP-AI.v2.KeyRotation` | 密钥轮换证明 |
| `DCP-AI.v2.Governance` | 治理操作 |

这只是一部分。TypeScript SDK 中的 `DCP_CONTEXTS` 列出了 19 个上下文标签，包括 DCP-05 至 DCP-09 的标签；
`DCP-AI.v2.Governance` 不在其中：TypeScript 的治理模块把它定义为自己的常量。

---

<a id="4-test-vector-references"></a>

## 4. 测试向量参考

<a id="41-nist-kat-directory"></a>

### 4.1 NIST KAT 目录

DCP-AI 在 `tests/nist-kat/` 中维护 Known Answer Test 向量：

```
tests/nist-kat/
  ed25519/
    vectors.json    -- RFC 8032 Section 7.1 deterministic test vectors
  ml-dsa-65/
    vectors.json    -- FIPS 204 property test configuration
  ml-kem-768/
    vectors.json    -- FIPS 203 NIST ACVP decapsulation and key-check vectors
  slh-dsa-192f/
    vectors.json    -- FIPS 205 NIST ACVP signature-verification vectors
```

每个文件检查什么，参见 [`tests/nist-kat/README.md`](../../../tests/nist-kat/README.md)。

§4.3 至 §4.5 的表格和 §5 的检查清单说明的是实现应达到的覆盖范围，而不是认证。没有任何单个文件能覆盖整个矩阵：`tests/nist-kat/`
包含上面列出的向量，其余各行取决于每个 SDK 自己的测试，这些测试未必覆盖全部各行，而且该目录中没有混合构造的向量。

<a id="42-ed25519-rfc-8032"></a>

### 4.2 Ed25519（RFC 8032）

Ed25519 是确定性的。测试向量直接取自 RFC 8032 第 7.1 节。对于给定的 (secret_key, message) 对，所有 DCP-AI SDK 都必须（MUST）产生相同的签名。

<a id="43-ml-dsa-65-fips-204"></a>

### 4.3 ML-DSA-65（FIPS 204）

ML-DSA-65 支持随机化签名和确定性签名；如第 2.2 节所述，当前 SDK 的提供程序使用不同的方式。直接与 KAT 比较需要控制签名的随机性，而这在各个密码库之间并不相同。DCP-AI 检验以下性质；这些检查并不等同于 NIST 对算法或模块的完整验证：

| 测试 | 说明 | 要求 |
|------|-------------|------|
| 大小符合 | 公钥 = 1952 B，签名 = 3309 B | 必须通过 |
| 往返 | `verify(pk, sign(sk, msg), msg) == true` | 必须通过 |
| 拒绝其他密钥 | `verify(pk_other, sign(sk, msg), msg) == false` | 必须通过 |
| 跨 SDK 验证 | SDK A 的签名能在 SDK B 中验证通过 | 必须通过 |
| 确定性 kid | `kid(alg, pk)` 在所有 SDK 中都相同 | 必须通过 |
| 域分离 | 使用上下文标签 A 的签名在标签 B 下无法验证 | 必须通过 |
| 复合绑定 | 剥离经典签名会使 PQ 签名失效 | 必须通过 |

<a id="44-slh-dsa-192f-fips-205"></a>

### 4.4 SLH-DSA-192f（FIPS 205）

| 测试 | 说明 | 要求 |
|------|-------------|------|
| 大小符合 | 公钥 = 48 B，签名 = 35,664 B | 必须通过 |
| 往返 | 先签名再验证成功 | 必须通过 |
| 拒绝其他密钥 | 用其他密钥验证失败 | 必须通过 |
| 跨 SDK 验证 | SDK 之间的互操作性 | 必须通过 |

<a id="45-ml-kem-768-fips-203"></a>

### 4.5 ML-KEM-768（FIPS 203）

| 测试 | 说明 | 要求 |
|------|-------------|------|
| 大小符合 | 公钥 = 1184 B，密文 = 1088 B，SS = 32 B | 必须通过 |
| 往返 | `decapsulate(encapsulate(pk)) == shared_secret` | 必须通过 |
| 隐式拒绝 | 用其他密钥解封装会返回不同的共享秘密，而不是错误（FIPS 203 隐式拒绝）；修改过的密文同样如此 | 必须通过 |
| 输入检查 | 格式错误的输入会以错误被拒绝：长度错误、系数 ≥ q 的封装密钥、`H(ek)` 错误的解封装密钥 | 必须通过 |
| 混合构造 | 组合后的 HKDF 输出与参考值一致 | 必须通过 |

<a id="46-running-kat-tests"></a>

### 4.6 运行 KAT 测试

```bash
# From the repository root; each line runs in a subshell, so the working directory does not change.
# They use the tools and dependencies already installed for each SDK; nothing here installs them.

# TypeScript SDK (vitest, from the SDK's own node_modules)
(cd sdks/typescript && ./node_modules/.bin/vitest run src/__tests__/nist-kat.test.ts)

# Python SDK (pytest)
(cd sdks/python && python3 -m pytest tests/test_nist_kat.py -v)

# Go SDK (conformance + interop + PQ providers in one run)
(cd sdks/go && go test ./...)

# Rust SDK (dedicated integration test)
(cd sdks/rust && cargo test --test nist_kat)
```

---

<a id="5-conformity-checklist-for-implementers"></a>

## 5. 实现者符合性检查清单

使用这份清单来验证你的 DCP-AI 实现符合 NIST 的后量子标准。

<a id="51-ml-kem-768-fips-203-checklist"></a>

### 5.1 ML-KEM-768（FIPS 203）检查清单

- [ ] 公钥大小恰好为 1184 字节
- [ ] 密文大小恰好为 1088 字节
- [ ] 共享秘密大小恰好为 32 字节
- [ ] 封装使用符合 FIPS 203 的实现
- [ ] 解封装使用符合 FIPS 203 的实现
- [ ] 混合构造通过 HKDF-SHA256 组合 X25519 和 ML-KEM-768 的共享秘密
- [ ] HKDF 的 info 参数包含 DCP-AI 上下文标签
- [ ] 每个会话生成临时密钥（前向保密）
- [ ] 大小、往返、隐式拒绝（其他密钥或修改过的密文会得到不同的共享秘密）和输入检查的 KAT 测试通过

<a id="52-ml-dsa-65-fips-204-checklist"></a>

### 5.2 ML-DSA-65（FIPS 204）检查清单

- [ ] 公钥大小恰好为 1952 字节
- [ ] 签名大小恰好为 3309 字节
- [ ] 签名使用符合 FIPS 204 的实现
- [ ] 验证使用符合 FIPS 204 的实现
- [ ] 签名前加上域分离上下文标签前缀
- [ ] 复合绑定：PQ 签名覆盖 `context || 0x00 || payload || classical_sig`
- [ ] kid 派生：`hex(SHA-256(UTF8("ml-dsa-65") || 0x00 || raw_pk))[0:32]`
- [ ] 大小、往返、其他密钥、跨 SDK 和域分离的 KAT 测试通过

<a id="53-ml-dsa-87-fips-204-checklist"></a>

### 5.3 ML-DSA-87（FIPS 204）检查清单

供将来的实现使用：目前没有 DCP-AI SDK 实现 ML-DSA-87（§2.2）。

- [ ] 公钥大小恰好为 2592 字节
- [ ] 签名大小恰好为 4627 字节
- [ ] 与 ML-DSA-65 相同的域分离和复合绑定
- [ ] kid 派生使用 `"ml-dsa-87"` 作为算法标识符
- [ ] KAT 测试通过

<a id="54-slh-dsa-192f-fips-205-checklist"></a>

### 5.4 SLH-DSA-192f（FIPS 205）检查清单

- [ ] 公钥大小恰好为 48 字节
- [ ] 签名大小恰好为 35,664 字节
- [ ] 签名使用符合 FIPS 205 的实现
- [ ] 验证使用符合 FIPS 205 的实现
- [ ] 与 ML-DSA 相同的域分离模式
- [ ] kid 派生使用 `"slh-dsa-192f"` 作为算法标识符
- [ ] KAT 测试通过

<a id="55-general-cryptographic-checklist"></a>

### 5.5 通用密码检查清单

- [ ] 所有 PQ 操作在可能时都使用常数时间实现
- [ ] 私钥使用后清零（安全的内存处置）
- [ ] 私钥存放在与部署风险相称的存储中（本仓库不提供 HSM/TPM 集成）
- [ ] 为实现密码敏捷性，实现了算法通告系统
- [ ] 所有已签名载荷中的数值字段仅为整数（无浮点数）
- [ ] 所有 JSON 签名都使用 `dcp-jcs-v1` 规范化（基于 RFC 8785 JCS），它是默认且唯一的规范性配置；实验性候选 `dcp-jcs-v2` 只在显式选择加入时使用

---

<a id="6-migration-path-classical-to-post-quantum"></a>

## 6. 迁移路径：从经典密码到后量子密码

DCP-AI 定义了一条从仅经典安全到后量子安全的三阶段迁移路径。

这些阶段是 2026 年 4 月写下的推荐计划，而不是对验证器当前行为的描述。目前，`verifySignedBundleV2` 只接受 V2 bundle；是否接受 V1
bundle 由按版本分流的路由器或中间件根据其策略（`allow_v1_bundles`）决定，它可以拒绝 V1 bundle，但本身不会发出弃用警告
（[MIGRATION_V1_V2.md](../../../docs/MIGRATION_V1_V2.md#32-coexistence-strategy)）。在 `hybrid_preferred` 下，只有在有效模式（策略模式与风险等级模式中更严格的那个）允许时才容许缺少 PQ 签名，
而存在但无效的 PQ 签名总是会被拒绝。

<a id="phase-1-hybrid-introduction"></a>

### 阶段 1：引入混合

| 方面 | 状态 |
|--------|-------|
| 默认验证模式 | `hybrid_preferred` |
| 经典签名 | 必需 |
| PQ 签名 | 推荐，非必需 |
| V1 bundle | 接受 |
| 复合绑定 | 可用，非强制 |

实现者需要做的事：
1. 在 Ed25519 之外集成 ML-DSA-65 提供程序。
2. 生成混合密钥对（Ed25519 + ML-DSA-65）。
3. 尽可能生成复合签名。
4. V1 bundle 继续正常验证。

<a id="phase-2-hybrid-required"></a>

### 阶段 2：强制混合

| 方面 | 状态 |
|--------|-------|
| 默认验证模式 | `hybrid_required` |
| 经典签名 | 必需 |
| PQ 签名 | 必需 |
| V1 bundle | 接受但给出警告 |
| 复合绑定 | V2 强制 |

实现者需要做的事：
1. 所有 V2 bundle 都必须（MUST）包含复合签名。
2. 验证器策略强制 `min_pq >= 1`。
3. 应当（SHOULD）启用双哈希链（SHA-256 + SHA3-256）。
4. V1 bundle 发出弃用警告。

<a id="phase-3-pq-only-future-as-a-default"></a>

### 阶段 3：仅 PQ（作为默认值是将来的事）

`pq_only` 验证模式如今已在验证器中实现；属于将来的是把它设为默认值。

| 方面 | 状态 |
|--------|-------|
| 默认验证模式 | `pq_only` |
| 经典签名 | 仍是复合签名的一部分；在 `pq_only` 下，对它的验证可以不再是接受的条件 |
| PQ 签名 | 必需 |
| V1 bundle | 拒绝 |
| 复合绑定 | 仍为 `pq_over_classical`：PQ 签名是针对经过域分离的消息和经典签名字节进行验证的，因此没有经典部分的签名不是受支持的格式 |

实现者需要做的事：
1. 经典验证可以不再是接受的条件；经典签名仍保留在复合格式中。
2. 默认拒绝 V1 bundle。
3. 治理通告系统可以弃用经典算法。
4. 如果 ML-DSA 被削弱，SLH-DSA-192f 提供备用。

<a id="migration-timeline-recommended"></a>

### 迁移时间表（推荐）

这份时间表写于 2026 年 4 月，按原样保留。2026 年 10 月 25 日时，所有 SDK 的默认验证器策略都使用 `hybrid_preferred`（低风险护照使用 `classical_only`），参考服务器以 `hybrid_required` 启动；没有任何治理通告触发阶段 3。

```
2026 Q1-Q2    Phase 1: Hybrid Introduction  [CURRENT]
              - SDKs v2.0.x ship composite signatures
              - Verifiers accept both V1 and V2 bundles
              - Early-adopter integrations surface real-world load

2026 Q3-Q4    Phase 2: Hybrid Required
              - Verifier policies default to hybrid_required
              - V1 bundles emit deprecation warnings
              - Wider production deployments

2027+         Phase 3: PQ-Only (conditional)
              - Triggered by a governance advisory if classical
                algorithms are weakened
              - V1 bundle rejection
              - Full post-quantum operation
```

---

<a id="7-nist-pq-standards-transition-guidance-alignment"></a>

## 7. 与 NIST PQ 标准过渡指南的一致性

DCP-AI 与 NIST 发布的后量子密码过渡指南保持一致：

| NIST 指南 | DCP-AI 的实现 |
|--------------|----------------------|
| 尽早开始混合部署 | 自 v2.0 发布起提供混合复合签名 |
| 使用 FIPS 203/204/205 批准的算法 | ML-KEM-768、ML-DSA-65、SLH-DSA-192f（ML-DSA-87 已保留，未实现） |
| 保持密码敏捷性 | 算法注册表 + 通告系统 + 提供程序抽象 |
| 为算法弃用做好计划 | 由治理签名并带自动响应的通告 |
| 保护长期数据 | 哈希链接的审计轨迹；会生成双哈希链，自 `@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go v2.11.1 和 Rust `dcp-ai` 2.11.1 起，V2 验证器会检查存在的次级字段（更早的版本不检查）（[STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)） |
| 过渡期间使用混合构造 | `pq_over_classical` 复合绑定 |
| 用硬件安全模块存储密钥 | 未实现：没有 HSM/TPM 集成；源码中的 `HsmCryptoProvider` 是模拟实现（§2.2） |
| 测试互操作性 | 跨 SDK 的 KAT 验证、符合性测试套件 |

---

<a id="8-cryptographic-library-requirements"></a>

## 8. 密码库要求

实现必须（MUST）使用提供符合 NIST 的算法实现的密码库。

<a id="libraries-used-by-each-shipped-sdk"></a>

### 各个已提供 SDK 使用的库

| SDK | 库 | 算法 |
|-----|---------|-----------|
| TypeScript（`@dcp-ai/sdk`） | `@noble/post-quantum` | ML-DSA-65、SLH-DSA-192f；ML-KEM-768（内部，未导出） |
| TypeScript（`@dcp-ai/sdk`） | `tweetnacl` | Ed25519 |
| TypeScript（`@dcp-ai/sdk`） | Node.js `crypto` | SHA-256、SHA3-256、HMAC-SHA256（HKDF）；X25519（内部，未导出） |
| Python（`dcp-ai`） | `pqcrypto` ≥ 1.0（Backbone 的 Rust crate，未经独立审计） | ML-DSA-65、ML-KEM-768、SLH-DSA-192f |
| Python（`dcp-ai`） | `pynacl`（libsodium） | Ed25519 |
| Go（`sdks/go/v2`） | `github.com/cloudflare/circl` | ML-DSA-65、ML-KEM-768、SLH-DSA-192f |
| Go（`sdks/go/v2`） | `crypto/ed25519`（标准库） | Ed25519 |
| Rust（`dcp-ai` crate） | `fips203`、`fips204`、`fips205`（integritychain） | ML-KEM-768、ML-DSA-65、SLH-DSA-192f |
| Rust（`dcp-ai` crate） | `ed25519-dalek` | Ed25519 |
| WASM（`@dcp-ai/wasm`） | 由上述 Rust crate 编译而来 | 与 Rust 相同 |

Python、Go 和 Rust SDK 把 ML-KEM-768 作为 KEM 原语（`MlKem768Provider`）公开，`@dcp-ai/wasm` 则以 `wasm_ml_kem_768_*` 函数公开。TypeScript SDK 的源码中有 ML-KEM-768、X25519 和混合提供程序，但没有导出它们。没有 SDK 执行 DCP-04 的 X25519 + ML-KEM-768 混合交换：双方自行派生会话密钥，并传给会话函数（Python 中的 `create_session`、Go 中的 `CreateSession`）。Rust 的 A2A 模块只涵盖发现、握手消息和会话 ID。

<a id="library-audit-requirements"></a>

### 库的审计要求

在生产部署中，密码库应当（SHOULD）：
- 经过独立的安全审计
- 对依赖秘密的分支实现常数时间操作
- 提供安全的内存清零 API
- 通过所有 PQ 算法的 NIST KAT 向量

---

<a id="9-references"></a>

## 9. 参考文献

- **FIPS 203** — NIST，"Module-Lattice-Based Key-Encapsulation Mechanism Standard"，2024 年 8 月。
- **FIPS 204** — NIST，"Module-Lattice-Based Digital Signature Standard"，2024 年 8 月。
- **FIPS 205** — NIST，"Stateless Hash-Based Digital Signature Standard"，2024 年 8 月。
- **SP 800-208** — NIST，"Recommendation for Stateful Hash-Based Signature Schemes"，2020 年 10 月。
- **RFC 5869** — Krawczyk, H. 和 P. Eronen，"HMAC-based Extract-and-Expand Key Derivation Function (HKDF)"，2010 年 5 月。
- **RFC 8032** — Josefsson, S. 和 I. Liusvaara，"Edwards-Curve Digital Signature Algorithm (EdDSA)"，2017 年 1 月。
- **RFC 8785** — Rundgren, A.、Jordan, B. 和 S. Erdtman，"JSON Canonicalization Scheme (JCS)"，2020 年 6 月。
- **DCP-AI v2.0 规范性规范** — `spec/DCP-AI-v2.0.md`
- **DCP-AI 安全模型** — `docs/SECURITY_MODEL.md`
- **DCP-AI NIST KAT README** — `tests/nist-kat/README.md`
