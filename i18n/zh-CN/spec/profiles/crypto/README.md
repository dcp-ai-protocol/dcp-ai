<sub>[English](../../../../../spec/profiles/crypto/README.md) · **中文** · [Español](../../../../es/spec/profiles/crypto/README.md) · [日本語](../../../../ja/spec/profiles/crypto/README.md) · [Português](../../../../pt-BR/spec/profiles/crypto/README.md)</sub>

<a id="crypto-profile"></a>

# Crypto 配置文件

> 本文是[英文规范](../../../../../spec/profiles/crypto/README.md)的参考译文，更新于 07/11/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

**状态：** 已发布 — v2.0  
**范围：** 密码算法选择、复合签名、密码敏捷性和验证器策略  

---

<a id="purpose"></a>

## 目的

DCP 核心要求密码签名和哈希函数，但刻意不强制规定具体算法。Crypto 配置文件定义 DCP v2.0 中使用的具体密码选择，以及随时间演进这些选择的机制。

这种分离确保：

- 核心协议能在不做结构性改动的情况下经受算法过渡（例如后量子迁移）
- 验证器可以根据风险背景执行自己的算法策略
- 实现可以从经典算法开始，在准备好时再采用后量子算法
- 算法的弃用不会破坏核心规范

<a id="what-lives-here-not-in-core"></a>

## 这里包含什么（不在核心中）

<a id="algorithm-registry"></a>

### 算法注册表

已批准的签名算法（Ed25519、ML-DSA-65、ML-DSA-87、SLH-DSA-192f）、密钥封装机制（X25519、ML-KEM-768、混合 X25519+ML-KEM-768）和哈希算法（SHA-256、SHA3-256、SHA-384）的集合。

> *参考性说明（2026 年 10 月 25 日），不属于配置文件：* 目前还没有任何 DCP-AI SDK 实现 ML-DSA-87，也没有任何 SDK 导出混合 X25519+ML-KEM-768 交换（[docs/NIST_CONFORMITY.md](../../../../../docs/NIST_CONFORMITY.md)）。

完整的注册表见 [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) 第 2 节。

<a id="composite-signature-binding"></a>

### 复合签名绑定

`pq_over_classical` 绑定协议，确保经典签名和后量子签名组件都不能被剥离：

1. 经典签名对 `context || 0x00 || payload` 签名
2. PQ 签名对 `context || 0x00 || payload || classical_sig` 签名

绑定协议和传输格式见 [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) 第 5 节。

<a id="domain-separation"></a>

### 域分离

防止跨工件重放攻击的上下文标签。每种工件类型都有唯一的上下文标签（例如 `DCP-AI.v2.AgentPassport`、`DCP-AI.v2.Intent`）。

完整的标签列表见 [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) 第 4 节。

<a id="verification-modes"></a>

### 验证模式

由验证器决定的策略，确定需要哪些签名组件：

- `classical_only` — 只需要经典签名
- `hybrid_preferred` — 需要经典签名，建议有 PQ 签名
- `hybrid_required` — 经典签名和 PQ 签名都需要
- `pq_only` — 只需要 PQ 签名（第 3 阶段）

验证模式和验证器策略格式见 [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) 第 7 节。

<a id="p-ed-1-ed25519-acceptance-criterion"></a>

### P-ED-1：Ed25519 接受准则

公钥 `A`（32 字节）对消息 `M` 的 `ed25519` 签名 `sig = R ‖ S`（64 字节），当且仅当以下四个条件全部成立时才被接受：

1. **标量。** S < L，其中 S 按 256 位小端整数读取，L = 2^252 + 27742317777372353535851937790883648493。
2. **规范编码。** A 和 R 是规范编码：设 `y` 为将第 255 位清零后按小端读取的 32 字节，`s` 为第 255 位，
   p = 2^255 − 19，则 `y < p`，且不存在 `y ∈ {1, p − 1}` 而 `s = 1` 的情况。
3. **阶。** A 和 R 都不是 E[8]（阶整除 8 的点，包括单位元）的 8 个编码之一：

   ```
   0000000000000000000000000000000000000000000000000000000000000000
   0000000000000000000000000000000000000000000000000000000000000080
   0100000000000000000000000000000000000000000000000000000000000000
   26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05
   26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85
   c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a
   c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa
   ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f
   ```

4. **解码与等式。** A 和 R 解码为曲线上的点，并且在这些点之间不带余因子地满足 [S]B = R + [k]A，
   其中 k = SHA-512(R ‖ A ‖ M) mod L，在 R 和 A 的原始字节上计算。

P-ED-1 是 DCP 的准则，而不是 RFC 8032 的某个选项；RFC 8032 的 §5.1.7 使用未约简的挑战值。对于素数阶子群中的 A 和 R，
其等式与 RFC 的等式结果相同；该准则还拒绝单位元和 E[8] 的其他点。带有挠分量但不属于小阶点的 A 或 R，只要等式成立
就会被接受：P-ED-1 不要求无挠点。

**实现。** 各 SDK 保留其库（TweetNaCl、使用 libsodium 的 PyNaCl、Go 的 `crypto/ed25519`、`ed25519-dalek`）对等式的
检查，并在调用之前对字节检查条件 1 至 3：只与常量比较，没有新的曲线运算。库仍会确保 A 和 R 是有效的点且等式成立；对于 R，有些库通过计算 [S]B − [k]A 的
规范编码并与收到的字节比较来做到这一点，这是一种不解码 R 的等价检查。不满足的
条件是一次拒绝（`false`），从不是错误；以前会产生错误的输入（长度、无效的 base64）仍产生同样的错误；无法解码的公钥
在 TypeScript、Python 和 Go 中仍为 `false`，在 Rust 中仍为错误。这些检查适用于 V1 签名对象和 V2 默认的 Ed25519
提供方，凡是验证 `ed25519` 组件之处都适用。它们不改变某个模式验证哪些组件：在 `pq_only` 下，只在仍会验证经典组件
的地方适用，例如 DCP-09 的授权书和确认在任何模式下都验证两个组件。提供方注册表属于运营方：P-ED-1 是默认提供方的
准则，不是对自定义提供方的保证。

**兼容性。** 这是一次有意的接受变更：S ≥ L、A 或 R 非规范编码、或 A 或 R 属于 E[8] 的签名都会被拒绝，包括
TypeScript、Go 和 Rust 的库以前接受它的情况（使用 libsodium 1.0.20 的 PyNaCl 官方构建，按其代码和观察到的样本，
已经拒绝这些输入）。签名方不变：其密钥生成得到的密钥及其产生的签名都满足 P-ED-1，但 r ≡ 0 mod L 的随机数会给出
单位元作为 R，并被无例外地拒绝。格式、上下文、`dcp-jcs-v1`、模式、实验性候选配置文件和此前的 API 都不变。

**迁移。** 只影响不满足 P-ED-1 的证据。按原样保留，绝不规范化已签名的字节：重新编码 A 或 R 会改变 k（对 A 还会
改变 `kid`），约简 S 会改变签名字节以及 PQ 组件的消息，因为 PQ 组件也对经典签名进行签名。

- S ≥ L，或 R 非规范或属于 E[8]：如果该密钥满足 P-ED-1，就用同一密钥重新签名。
- A 非规范：其规范编码对 DCP 而言是另一个密钥，`kid` 也不同，因此需要轮换密钥并重新签名。
- A 属于 E[8]：替换该密钥；用它重新签名没有用。

向量：[`tests/interop/v2/ed25519_ped1_vectors.json`](../../../../../tests/interop/v2/ed25519_ped1_vectors.json)，由
`tools/ed25519-review/check_ped1_vectors.py` 检查。哪些验证器应用 P-ED-1、哪些尚未应用，见
[SECURITY_COVERAGE.md](../../../../../docs/conformance/SECURITY_COVERAGE.md)。

<a id="crypto-agility"></a>

### 密码敏捷性

算法公告系统，允许治理机构通过已签名的公告弃用或吊销算法，并由验证器自动响应。

见 [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) 第 13.2 节以及 [AUDIT 报告](../../../../../spec/AUDIT-v2.0-FINAL.md) 的第 4 号缺口。

<a id="dual-hash-chains"></a>

### 双哈希链

审计条目的并行 SHA-256 和 SHA3-256 哈希链，在某一哈希族被攻破时提供连续性。

见 [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) 第 10.3 节。

<a id="what-stays-in-core"></a>

## 什么留在核心中

- 工件必须签名的要求（但不规定用哪种算法）
- 审计条目必须以哈希链连接的要求（但不规定用哪种哈希函数）
- bundle 结构和验证模型
- `bundle_hash` 和 `merkle_root` 概念

<a id="normative-references"></a>

## 规范性参考

- [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) — 第 2 节（算法注册表）、第 4 节（域分离）、第 5 节（复合签名）、第 7 节（验证模式）、第 10.3 节（双哈希）、第 13.2 节（公告系统）
- [NIST 符合性](../../../../../docs/NIST_CONFORMITY.md) — 对 NIST 后量子密码的符合性
- [安全模型](../../../../../docs/SECURITY_MODEL.md) — 威胁模型和保护层

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准。

- 复合绑定只在验证器要求时才使剥离可被发现。起作用的是验证器解析出的
  有效模式，在应用风险等级、安全等级和策略之后，它可能比请求的 `default_mode` 更严格。
  在 SDK 验证器中，删除 PQ 签名并把绑定重新标注为 `classical_only` 时，若有效模式为 `classical_only` 或
  `hybrid_preferred` 则会被接受（在 `hybrid_preferred` 下附带警告），若为 `hybrid_required` 或 `pq_only` 则被拒绝。
  只有明确缺失的 PQ 签名才可能被容忍：在 `pq_over_classical` 下存在但
  无效的 PQ 签名在任何模式下都会被拒绝，其他所有检查也照常适用。
- SDK 验证器中的 `pq_only` 仍然要求带有经典签名字节的 `pq_over_classical` 绑定，
  因为 PQ 签名覆盖了这些字节；它不接受只带 PQ 签名的 bundle。
- 公告系统不是自动的：只有当运营方加载公告并调用
  公告辅助函数或相应地设置策略时，验证器才会应用它。
- SDK 验证器检查 SHA-256 审计链和 Merkle 根；自 `@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go v2.11.1 和 Rust `dcp-ai` 2.11.1 起，它们也检查存在的二级 SHA3-256 字段（[VERIFICATION.md](../../../../../spec/VERIFICATION.md) 的 V2-11 及其勘误），更早的版本则不检查。
