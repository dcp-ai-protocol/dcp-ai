<sub>[English](../../../../tests/nist-kat/README.md) · [Español](../../../es/tests/nist-kat/README.md) · [Português](../../../pt-BR/tests/nist-kat/README.md) · [日本語](../../../ja/tests/nist-kat/README.md) · **中文**</sub>

<a id="nist-kat-known-answer-test-compliance"></a>

# NIST KAT（已知答案测试）符合性

> 本文是[英文版本](../../../../tests/nist-kat/README.md)的参考译文，更新于2026年10月25日。如有差异，以英文原文为准。标识符和代码块（包括注释）均保留原文。

此目录包含 DCP-AI 密码学提供程序使用的已知答案向量和属性测试。通过这些测试只能确认其覆盖的行为，不代表算法完全符合标准，也不代表密码模块通过了 NIST 验证；请参阅 [NIST 符合性与范围](../../../../docs/NIST_CONFORMITY.md)。

<a id="structure"></a>

## 目录结构

```
nist-kat/
  ed25519/
    vectors.json    -- RFC 8032 deterministic test vectors
  ml-dsa-65/
    vectors.json    -- FIPS 204 property test configuration
  ml-kem-768/
    vectors.json    -- FIPS 203 NIST ACVP decapsulation and key-check vectors
  slh-dsa-192f/
    vectors.json    -- FIPS 205 NIST ACVP signature-verification vectors
```

## Ed25519

Ed25519（RFC 8032）使用确定性签名。`vectors.json` 包含 RFC 8032 第7.1节中的确切测试向量。对于给定的秘密密钥和消息，所有 SDK 必须（MUST）生成完全相同的签名。

## ML-DSA-65

ML-DSA-65（FIPS 204）在 TypeScript 和 Rust 提供程序中的签名是 hedged（随机化）的，在 Go 提供程序中则是确定性的；两种变体都有效，验证方式相同。直接 KAT 向量需要控制种子，而不同实现对此的支持各异。这里的检查覆盖：

1. **大小符合性** - 公钥（1952 B）、签名（3309 B）
2. **往返测试** - 签名后验证成功
3. **错误密钥拒绝** - 使用不同密钥验证失败
4. **跨 SDK 验证** - TypeScript SDK 生成的签名可在所有其他 SDK 中验证
5. **确定性 kid** - kid 派生在各 SDK 间可重现

## ML-KEM-768

ML-KEM-768（FIPS 203）的解封装是确定性的，因此 NIST ACVP（`ML-KEM-encapDecap-FIPS203`）的 `(dk, c) -> k` 用例对于任何实现都是真正的 KAT，包括对修改后的密文进行隐式拒绝。该文件还包含 FIPS 203 输入检查：必须拒绝系数 >= q 的封装密钥，以及 `H(ek)` 错误的解封装密钥。

## SLH-DSA-192f

SLH-DSA-SHA2-192f（FIPS 205）的签名是随机化的，因此这些向量是 NIST ACVP 签名验证用例（`SLH-DSA-sigVer-FIPS205`，外部接口，pure 模式）。有效用例只有在应用 FIPS 205 的 `0x00 || len(ctx) || ctx` 前缀时才能验证通过，而标准化前的 SPHINCS+ 会省略此前缀。DCP 使用空上下文签名；这些用例带有上下文，因此测试会显式传入它。

两个文件均记录 ACVP-Server 版本和源文件的 SHA-256。数值按原样复制：绝不能为迎合某个 SDK 而修改它们。

<a id="phase-1-gate"></a>

## 第一阶段通过条件

CI 中每个 SDK 的测试任务都运行其 KAT 测试：TypeScript `src/__tests__/nist-kat.test.ts`、Python `tests/test_nist_kat.py`、Go `dcp/nist_kat_test.go`（在 `go test ./...` 中）和 Rust `tests/nist_kat.rs`。KAT 失败会导致相应任务失败。
