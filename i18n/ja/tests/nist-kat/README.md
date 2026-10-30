<sub>[English](../../../../tests/nist-kat/README.md) · [Español](../../../es/tests/nist-kat/README.md) · [Português](../../../pt-BR/tests/nist-kat/README.md) · **日本語** · [中文](../../../zh-CN/tests/nist-kat/README.md)</sub>

<a id="nist-kat-known-answer-test-compliance"></a>

# NIST KAT（既知応答テスト）の適合性

> [英語版](../../../../tests/nist-kat/README.md)の参考訳です。更新日：2026年10月25日。相違がある場合は英語の原文が優先されます。識別子とコードブロック（コメントを含む）は原文のままです。

このディレクトリには、DCP-AI の暗号プロバイダーが使用する既知応答ベクトルとプロパティテストを収録しています。これらのテストの合格で確認できるのは対象となる動作であり、アルゴリズム全体の適合性や暗号モジュールの NIST 検証ではありません。[NIST 適合性と対象範囲](../../../../docs/NIST_CONFORMITY.md)を参照してください。

<a id="structure"></a>

## 構成

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

Ed25519（RFC 8032）は決定的な署名を使用します。`vectors.json` には RFC 8032 第7.1節の正確なテストベクトルが含まれます。すべての SDK は、指定された秘密鍵とメッセージに対して同一の署名を生成しなければなりません（MUST）。

## ML-DSA-65

ML-DSA-65（FIPS 204）の署名は TypeScript と Rust のプロバイダーでは hedged（乱数を用いる方式）、Go のプロバイダーでは決定的です。どちらも有効な方式であり、検証方法は同じです。直接的な KAT ベクトルにはシードの制御が必要ですが、その方法は実装によって異なります。ここでの確認範囲は次のとおりです。

1. **サイズの適合性** - 公開鍵（1952 B）、署名（3309 B）
2. **往復処理** - 署名した後の検証が成功する
3. **異なる鍵の拒否** - 別の鍵での検証は失敗する
4. **SDK 間の検証** - TypeScript SDK の署名を他のすべての SDK で検証できる
5. **決定的な kid** - SDK 間で kid の導出を再現できる

## ML-KEM-768

ML-KEM-768（FIPS 203）のデカプセル化は決定的であるため、NIST ACVP（`ML-KEM-encapDecap-FIPS203`）の `(dk, c) -> k` ケースは、変更された暗号文の暗黙的拒否も含め、どの実装に対しても真正の KAT となります。このファイルには FIPS 203 の入力チェックも含まれます。係数が >= q であるカプセル化鍵と、`H(ek)` が正しくないデカプセル化鍵は拒否しなければなりません。

## SLH-DSA-192f

SLH-DSA-SHA2-192f（FIPS 205）の署名は乱数を用いるため、ベクトルには NIST ACVP の署名検証ケース（`SLH-DSA-sigVer-FIPS205`、外部インターフェース、pure モード）を使用します。有効なケースは、標準化前の SPHINCS+ では省略される FIPS 205 のプレフィックス `0x00 || len(ctx) || ctx` を適用した場合にのみ検証に成功します。DCP は空のコンテキストで署名しますが、これらのケースにはコンテキストがあるため、テストでは明示的に渡します。

両ファイルには ACVP-Server のリリースと元ファイルの SHA-256 を記録しています。値はそのままコピーしてあります。SDK に合わせるために編集してはいけません。

<a id="phase-1-gate"></a>

## フェーズ1の合格条件

CI の各 SDK のテストジョブで KAT を実行します。TypeScript は `src/__tests__/nist-kat.test.ts`、Python は `tests/test_nist_kat.py`、Go は `dcp/nist_kat_test.go`（`go test ./...` 内）、Rust は `tests/nist_kat.rs` です。KAT が失敗すると、そのジョブも失敗します。
