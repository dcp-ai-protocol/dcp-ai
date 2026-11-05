<sub>[English](../../../../tests/nist-kat/README.md) · [Español](../../../es/tests/nist-kat/README.md) · [Português](../../../pt-BR/tests/nist-kat/README.md) · **日本語** · [中文](../../../zh-CN/tests/nist-kat/README.md)</sub>

<a id="nist-kat-known-answer-test-compliance"></a>

# NIST KAT（既知応答テスト）の適合性

> [英語版](../../../../tests/nist-kat/README.md)の参考訳です。更新日：2026年11月5日。相違がある場合は英語の原文が優先されます。識別子とコードブロック（コメントを含む）は原文のままです。

このディレクトリには、DCP-AI の暗号プロバイダーが使用する既知応答ベクトルとプロパティテストを収録しています。これらのテストの合格で確認できるのは対象となる動作であり、アルゴリズム全体の適合性や暗号モジュールの NIST 検証ではありません。[NIST 適合性と対象範囲](../../../../docs/NIST_CONFORMITY.md)を参照してください。

<a id="structure"></a>

## 構成

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

Ed25519（RFC 8032）は決定的な署名を使用します。`vectors.json` には RFC 8032 第7.1節の正確なテストベクトルが含まれます。すべての SDK は、指定された秘密鍵とメッセージに対して同一の署名を生成しなければなりません（MUST）。

## ML-DSA-65

ML-DSA-65（FIPS 204）の署名は TypeScript と Rust のプロバイダーでは hedged（乱数を用いる方式）、Go のプロバイダーでは決定的です。どちらも有効な方式であり、検証方法は同じです。署名の KAT を再現するには署名の乱数を制御する必要があり、その手段は実装によって異なります。そのため署名は以下のプロパティ確認で扱います。検証にはこの制御が不要で、後述の[検証ベクトル](#ml-dsa-65-verification-vectors)で扱います。プロパティ確認の範囲は次のとおりです。

1. **サイズの適合性** - 公開鍵（1952 B）、署名（3309 B）
2. **往復処理** - 署名した後の検証が成功する
3. **異なる鍵の拒否** - 別の鍵での検証は失敗する
4. **SDK 間の検証** - TypeScript SDK の署名を他のすべての SDK で検証できる
5. **決定的な kid** - SDK 間で kid の導出を再現できる

<a id="ml-dsa-65-verification-vectors"></a>
<a id="verification-vectors"></a>

### 検証ベクトル

独立した 2 つの出典の ML-DSA-65 検証ケースを、各 SDK の実際のプロバイダーで実行します。

| ファイル | 出典 | 固定先 | SHA-256 |
|---|---|---|---|
| `acvp_sigver_tg3.json` | NIST ACVP-Server `gen-val/json-files/ML-DSA-sigVer-FIPS204/internalProjection.json` のテストグループ 3（ML-DSA-65、外部インターフェース、pure モード、15 ケース） | コミット `a7f283cdc87d2d6dd93c1bac59e5622c5f9f8324` | 元ファイル `47cdd6314c7f746d02421ffcba89d4dbc7bb875ac49e07a029fdfc26fba55437`、このファイル `bacf4ad8e55db0594d8bf2878ca3bd3cb80cfa680aaf05ca8e1788d896f63eb8` |
| `wycheproof_mldsa_65_verify_test.json` | C2SP Wycheproof `testvectors_v1/mldsa_65_verify_test.json`（210 ケース）、Apache-2.0。NIST の出典ではありません | コミット `20b256949ea8f21a11375619b1825027ca0668bd` | `1ca235f61928421a173a171780beb00264ae9155dc33c52a11e1766cc7979034`（このファイルはバイト単位のコピーです） |

`acvp_sigver_tg3.json` には、変更せずにコピーしたテストグループと、元ファイルのパス、コミット、SHA-256、およびそれに付随する NIST の通知を記録した `_source` オブジェクトが含まれます。タグは移動しうるため、タグではなくコミットを固定しています。値はそのままコピーしています。SDK に合わせて編集してはいけません。

SDK のプロバイダーはすべて FIPS 204 の空のコンテキストで検証します（DCP はドメイン分離をメッセージ内に置きます。[NIST 適合性の §3](../../../../docs/NIST_CONFORMITY.md) を参照）。そのため、プロバイダーを通すのはコンテキストが空のケースだけです。

- **実行：204 ケース（有効 77、無効 127）。** テストグループ 3 でコンテキストが空の唯一のケースである NIST tc39（無効）と、コンテキストがないか空の Wycheproof の 203 ケース（有効 77、無効 126）です。
- **除外（ID で確認）：** NIST tc31～tc45 のうち tc39 以外（空でないコンテキスト。有効な 3 ケース tc33、tc43、tc44 を含む）と、Wycheproof tc3、tc4、tc5、tc153～tc156（空でないコンテキスト）です。プリハッシュと内部インターフェースのグループは使用しません。
- **判定：** 有効なケースは `true` を返す必要があります。無効なケースは `false` を返す必要があります。ただし Go と Rust では、長さが誤った鍵または署名に対してプロバイダーがエラーを返します。このエラーは該当するケース（Go：Wycheproof tc69、tc70、tc158、tc159。Rust：それらに加えて tc6、tc7、tc157）で、プロバイダーの長さエラーと完全に一致する場合に限り拒否として扱います。それ以外のエラーやパニックはテストの失敗です。

各 SDK には 3 つのテストがあります。1 つは両ファイルの SHA-256、件数、除外 ID を確認し、1 つはプロバイダーが SDK のものであることを確認し、判定テストはケースを実行して、ちょうど 204 ケースが実行されなければ失敗します。WASM の対象は、`wasm32-unknown-unknown` 向けにコンパイルし `wasm-bindgen-test` で実行する Rust プロバイダーです（Node では `sdks/rust/tests/wasm_mldsa65_vectors.rs`、ブラウザでは `wasm_mldsa65_vectors_browser.rs`）。ファイルはコンパイル時に埋め込まれます。Rust の実装を共有しており、5 つ目のライブラリではありません。npm パッケージ `@dcp-ai/wasm` は ML-DSA の生の検証を公開していないため、これらのベクトルはそのエクスポートを経由しません。

制限：これらのケースに合格しても、ライブラリやモジュールの NIST 検証（CAVP や CMVP）にはなりません。空でないコンテキスト、プリハッシュ ML-DSA、内部インターフェース、署名はベクトルでカバーされていません。Wycheproof のフラグ名と ACVP の理由名は上流の記録どおりに残しています。各ケースが FIPS 204 のどの条件を確認するかを示すものではありません。

## ML-KEM-768

ML-KEM-768（FIPS 203）のデカプセル化は決定的であるため、NIST ACVP（`ML-KEM-encapDecap-FIPS203`）の `(dk, c) -> k` ケースは、変更された暗号文の暗黙的拒否も含め、どの実装に対しても真正の KAT となります。このファイルには FIPS 203 の入力チェックも含まれます。係数が >= q であるカプセル化鍵と、`H(ek)` が正しくないデカプセル化鍵は拒否しなければなりません。

## SLH-DSA-192f

SLH-DSA-SHA2-192f（FIPS 205）の署名は乱数を用いるため、ベクトルには NIST ACVP の署名検証ケース（`SLH-DSA-sigVer-FIPS205`、外部インターフェース、pure モード）を使用します。有効なケースは、標準化前の SPHINCS+ では省略される FIPS 205 のプレフィックス `0x00 || len(ctx) || ctx` を適用した場合にのみ検証に成功します。DCP は空のコンテキストで署名しますが、これらのケースにはコンテキストがあるため、テストでは明示的に渡します。

両ファイルには ACVP-Server のリリースと元ファイルの SHA-256 を記録しています。値はそのままコピーしてあります。SDK に合わせるために編集してはいけません。

<a id="phase-1-gate"></a>

## フェーズ1の合格条件

CI の各 SDK のテストジョブで KAT を実行します。TypeScript は `src/__tests__/nist-kat.test.ts`、Python は `tests/test_nist_kat.py`、Go は `dcp/nist_kat_test.go`（`go test ./...` 内）、Rust は `tests/nist_kat.rs` です。WASM ジョブは `wasm-pack test` で `sdks/rust/tests/wasm_mldsa65_vectors.rs` を Node で実行し、3 つのテストがすべて合格しなければ失敗します。KAT が失敗すると、そのジョブも失敗します。
