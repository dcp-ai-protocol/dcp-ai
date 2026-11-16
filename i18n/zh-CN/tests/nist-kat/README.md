<sub>[English](../../../../tests/nist-kat/README.md) · [Español](../../../es/tests/nist-kat/README.md) · [Português](../../../pt-BR/tests/nist-kat/README.md) · [日本語](../../../ja/tests/nist-kat/README.md) · **中文**</sub>

<a id="nist-kat-known-answer-test-compliance"></a>

# NIST KAT（已知答案测试）符合性

> 本文是[英文版本](../../../../tests/nist-kat/README.md)的参考译文，更新于2026年11月5日。如有差异，以英文原文为准。标识符和代码块（包括注释）均保留原文。

此目录包含 DCP-AI 密码学提供程序使用的已知答案向量和属性测试。通过这些测试只能确认其覆盖的行为，不代表算法完全符合标准，也不代表密码模块通过了 NIST 验证；请参阅 [NIST 符合性与范围](../../../../docs/NIST_CONFORMITY.md)。

<a id="structure"></a>

## 目录结构

```
nist-kat/
  ed25519/
    vectors.json    -- RFC 8032 deterministic test vectors
  ml-dsa-65/
    vectors.json    -- FIPS 204 property test configuration
    acvp_sigver_tg3.json                  -- NIST ACVP sigVer test group 3 (ML-DSA-65, external, pure)
    wycheproof_mldsa_65_verify_test.json  -- C2SP Wycheproof ML-DSA-65 verification vectors
  ml-kem-768/
    vectors.json    -- FIPS 203 NIST ACVP decapsulation and key-check vectors
  slh-dsa-192f/
    vectors.json    -- FIPS 205 NIST ACVP signature-verification vectors
```

## Ed25519

Ed25519（RFC 8032）使用确定性签名。`vectors.json` 包含 RFC 8032 第7.1节中的确切测试向量。对于给定的秘密密钥和消息，所有 SDK 必须（MUST）生成完全相同的签名。

## ML-DSA-65

ML-DSA-65（FIPS 204）在 TypeScript 和 Rust 提供程序中的签名是 hedged（随机化）的，在 Go 提供程序中则是确定性的；两种变体都有效，验证方式相同。重现签名 KAT 需要控制签名随机性，而不同实现提供的控制方式各异，因此签名由以下属性检查覆盖；验证不需要这种控制，由下文的[验证向量](#ml-dsa-65-verification-vectors)覆盖。属性检查覆盖：

1. **大小符合性** - 公钥（1952 B）、签名（3309 B）
2. **往返测试** - 签名后验证成功
3. **错误密钥拒绝** - 使用不同密钥验证失败
4. **跨 SDK 验证** - TypeScript SDK 生成的签名可在所有其他 SDK 中验证
5. **确定性 kid** - kid 派生在各 SDK 间可重现

<a id="ml-dsa-65-verification-vectors"></a>
<a id="verification-vectors"></a>

### 验证向量

两个独立来源的 ML-DSA-65 验证用例通过每个 SDK 的真实提供程序运行：

| 文件 | 来源 | 固定于 | SHA-256 |
|---|---|---|---|
| `acvp_sigver_tg3.json` | NIST ACVP-Server `gen-val/json-files/ML-DSA-sigVer-FIPS204/internalProjection.json`，测试组 3（ML-DSA-65，外部接口，pure 模式，15 个用例） | 提交 `a7f283cdc87d2d6dd93c1bac59e5622c5f9f8324` | 源文件 `47cdd6314c7f746d02421ffcba89d4dbc7bb875ac49e07a029fdfc26fba55437`；本文件 `bacf4ad8e55db0594d8bf2878ca3bd3cb80cfa680aaf05ca8e1788d896f63eb8` |
| `wycheproof_mldsa_65_verify_test.json` | C2SP Wycheproof `testvectors_v1/mldsa_65_verify_test.json`（210 个用例），Apache-2.0；不是 NIST 来源 | 提交 `20b256949ea8f21a11375619b1825027ca0668bd` | `1ca235f61928421a173a171780beb00264ae9155dc33c52a11e1766cc7979034`（本文件是逐字节副本） |

`acvp_sigver_tg3.json` 包含原样复制的测试组，以及一个 `_source` 对象，记录源文件的路径、提交和 SHA-256，以及随附的 NIST 声明。固定的是提交而不是标签，因为标签可能移动。数值逐字复制：切勿为迎合某个 SDK 而修改。

所有 SDK 提供程序都使用 FIPS 204 的空上下文进行验证（DCP 将域分离放在消息中，参见 [NIST 符合性 §3](../../../../docs/NIST_CONFORMITY.md)），因此只有上下文为空的用例才会通过提供程序运行：

- **运行：204 个用例，77 个有效、127 个无效。** NIST tc39 是测试组 3 中唯一上下文为空的用例（无效），另有 203 个没有上下文或上下文为空的 Wycheproof 用例（77 个有效、126 个无效）。
- **排除，并按 ID 检查：** NIST tc31 至 tc45 中除 tc39 以外的用例（上下文非空，包括三个有效用例 tc33、tc43 和 tc44），以及 Wycheproof tc3、tc4、tc5 和 tc153 至 tc156（上下文非空）。不使用预哈希组和内部接口组。
- **判定：** 有效用例必须返回 `true`。无效用例必须返回 `false`；但在 Go 和 Rust 中，提供程序对长度错误的密钥或签名返回错误：该错误仅在这些用例中（Go：Wycheproof tc69、tc70、tc158 和 tc159；Rust：这些加上 tc6、tc7 和 tc157）且仅为提供程序的确切长度错误时才算作拒绝。任何其他错误或 panic 都会使测试失败。

每个 SDK 有三个测试：一个检查两个文件的 SHA-256、计数和排除的 ID；一个检查提供程序是该 SDK 的提供程序；判定测试运行这些用例，除非恰好运行了 204 个用例，否则失败。WASM 目标是编译为 `wasm32-unknown-unknown` 并用 `wasm-bindgen-test` 运行的 Rust 提供程序（Node 中为 `sdks/rust/tests/wasm_mldsa65_vectors.rs`，浏览器中为 `wasm_mldsa65_vectors_browser.rs`），文件在编译时嵌入；它共享 Rust 实现，不是第五个库。npm 包 `@dcp-ai/wasm` 不公开原始 ML-DSA 验证，因此这些向量不经过其导出。

限制：通过这些用例不等于任何库或模块的 NIST 验证（CAVP 或 CMVP）。非空上下文、预哈希 ML-DSA、内部接口和签名没有向量覆盖。Wycheproof 标志名和 ACVP 原因名按上游记录保留；它们并不声明某个用例检验了哪项 FIPS 204 条件。

## ML-KEM-768

ML-KEM-768（FIPS 203）的解封装是确定性的，因此 NIST ACVP（`ML-KEM-encapDecap-FIPS203`）的 `(dk, c) -> k` 用例对于任何实现都是真正的 KAT，包括对修改后的密文进行隐式拒绝。该文件还包含 FIPS 203 输入检查：必须拒绝系数 >= q 的封装密钥，以及 `H(ek)` 错误的解封装密钥。

## SLH-DSA-192f

SLH-DSA-SHA2-192f（FIPS 205）的签名是随机化的，因此这些向量是 NIST ACVP 签名验证用例（`SLH-DSA-sigVer-FIPS205`，外部接口，pure 模式）。有效用例只有在应用 FIPS 205 的 `0x00 || len(ctx) || ctx` 前缀时才能验证通过，而标准化前的 SPHINCS+ 会省略此前缀。DCP 使用空上下文签名；这些用例带有上下文，因此测试会显式传入它。

两个文件均记录 ACVP-Server 版本和源文件的 SHA-256。数值按原样复制：绝不能为迎合某个 SDK 而修改它们。

<a id="phase-1-gate"></a>

## 第一阶段通过条件

CI 中每个 SDK 的测试任务都运行其 KAT 测试：TypeScript `src/__tests__/nist-kat.test.ts`、Python `tests/test_nist_kat.py`、Go `dcp/nist_kat_test.go`（在 `go test ./...` 中）和 Rust `tests/nist_kat.rs`。WASM 任务在 Node 中用 `wasm-pack test` 运行 `sdks/rust/tests/wasm_mldsa65_vectors.rs`，除非其三个测试全部通过，否则失败。KAT 失败会导致相应任务失败。
