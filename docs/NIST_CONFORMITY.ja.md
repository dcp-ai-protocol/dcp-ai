<sub>[English](NIST_CONFORMITY.md) · [中文](NIST_CONFORMITY.zh-CN.md) · [Español](NIST_CONFORMITY.es.md) · **日本語** · [Português](NIST_CONFORMITY.pt-BR.md)</sub>

<a id="dcp-ai-nist-post-quantum-cryptography-conformity-statement"></a>

# DCP-AI の NIST ポスト量子暗号への適合性声明

> [英語版](NIST_CONFORMITY.md)の参考訳です（28/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

**仕様のバージョン：** 2.0
**最終更新：** 2026 年 10 月 25 日
**ステータス：** 有効 — 2026 年 10 月 25 日時点の `main` の SDK を記述しています。公開されたパッケージは遅れることがあります（各 SDK の *Release status* を参照）

この文書は、DCP-AI が NIST のポスト量子暗号の標準とどのように整合しているかを説明し、実装者向けの適合性評価を示します。DCP-AI は、FIPS 203、FIPS 204、FIPS 205 のアルゴリズムを、ハイブリッドなポスト量子セキュリティアーキテクチャの中核的な構成要素として取り入れています。

> **検証済みモジュールではなく、アルゴリズムです。** FIPS 203、204、205 が規定するアルゴリズムを使うことは、FIPS 140-3 の検証ではありません。検証は、NIST の [Cryptographic Module Validation Program](https://csrc.nist.gov/projects/cryptographic-module-validation-program/validated-modules) で試験され、リストに載った暗号モジュールに適用されるものです。このリポジトリには、§8 のライブラリが検証済みモジュールであるという証拠はなく、FIPS 140 についての主張もしません。ハードウェアセキュリティモジュール（HSM）との統合もありません（§2.2 を参照）。

---

<a id="1-standards-coverage"></a>

## 1. 標準のカバレッジ

| NIST の標準 | アルゴリズム | DCP-AI での用途 | 提供状況 | 注記 |
|---------------|-----------|-------------|---------|-------|
| FIPS 203 | ML-KEM-768 | A2A セッション用のハイブリッド KEM、エンベロープ暗号化 | Python、Go、Rust、WASM（公開プロバイダー）、TypeScript（内部のみ、エクスポートなし） | X25519 + ML-KEM-768 のハイブリッド交換をエクスポートする SDK はありません。A2A セッションは、呼び出し側が導出したセッション鍵を受け取ります（§8）。 |
| FIPS 204 | ML-DSA-65 | 複合バインディングにおけるポスト量子署名 | 5 つの SDK すべて | 主要な PQ 署名。 |
| FIPS 204 | ML-DSA-87 | 高保証のポスト量子署名 | 未実装 | 鍵のスキーマで識別子を予約。プロバイダーを持つ SDK はありません。 |
| FIPS 205 | SLH-DSA-192f | ハッシュベースのバックアップ署名方式 | TypeScript、Python、Rust、Go、WASM | 有効なバックアップ（SLH-DSA-SHA2-192f）。 |
| FIPS 205 | SLH-DSA-256f | レベル 5 のハッシュベース署名 | 未提供 | 予約。 |
| SP 800-208 | LMS / XMSS | 使用しない | 該当なし | 参考のみ：DCP-AI はステートレスな SLH-DSA を使い、LMS/XMSS は使いません（§2.4）。 |

---

<a id="2-algorithm-parameter-mapping"></a>

## 2. アルゴリズムのパラメーターの対応

<a id="21-ml-kem-fips-203--key-encapsulation"></a>
<a id="21-ml-kem-fips-203-key-encapsulation"></a>

### 2.1 ML-KEM（FIPS 203）— 鍵カプセル化

DCP-AI の仕様は、エージェント間（A2A）のセッション確立と任意のエンベロープ暗号化のために、ML-KEM-768 を X25519 とのハイブリッド構成で使います。その交換を実行する SDK はありません。交換を行い、セッション鍵を持つのは呼び出し側です（この節の最後を参照）。

| パラメーター | FIPS 203 の値 | DCP-AI の値 | 注記 |
|-----------|---------------|-------------|-------|
| パラメーターセット | ML-KEM-768 | `ml-kem-768` | NIST セキュリティレベル 3 |
| 公開鍵のサイズ | 1184 バイト | 1184 バイト | 適合 |
| 暗号文のサイズ | 1088 バイト | 1088 バイト | 適合 |
| 共有秘密のサイズ | 32 バイト | 32 バイト | 適合 |
| ハイブリッド構成 | N/A | X25519 + ML-KEM-768 | HKDF-SHA256 で共有秘密を結合 |
| DCP-AI の識別子 | N/A | `x25519-ml-kem-768` | ハイブリッド KEM の識別子 |
| 鍵導出 | N/A | HKDF-SHA256（RFC 5869） | A2A セッション鍵：`info = "DCP-AI.v2.A2A.SessionKey"`（[DCP-04](../spec/DCP-04.md) §3.4） |

**DCP-AI での用途：**

- **A2A ハンドシェイク（DCP-04、仕様上の構成）：** 両当事者が、ハイブリッド KEM の一時的な公開鍵を交換します。各当事者は相手の鍵に対してカプセル化を行います。セッション鍵は、両方の共有秘密を HKDF-SHA256 で結合して導出されます。これらの手順は呼び出し側が行い、SDK のセッション関数は得られた鍵を受け取ります。
- **鍵の復旧（仕様 §11.2）：** 仕様では、復旧用の連絡先に渡す Shamir SSS のシェアをハイブリッド KEM で暗号化します。SDK の `setupKeyRecovery` と `dcp recovery-setup` はシェアを生成しますが、暗号化はしません。`dcp recovery-setup` は、各シェアをそれぞれモード `0600` の個別のファイルに書き出します。

**仕様におけるハイブリッド KEM の構成**（サイズは [DCP-AI v2.0](../spec/DCP-AI-v2.0.md) のアルゴリズム表、セッション鍵は DCP-04 §3.4 による）：

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

**TypeScript のソースには、エンコーディングの異なる内部のハイブリッド KEM があります。** `HybridKemProvider`（`X25519KemProvider` と `MlKem768Provider` を含む）は `sdks/typescript/src` にありますが、`@dcp-ai/sdk` からエクスポートされていないため、パッケージの API には含まれません。これは上のバイナリ連結ではありません。

- 結合した公開鍵、秘密鍵、暗号文は、それぞれ JSON オブジェクト `{ "classical": …, "pq": … }` の base64 です。その X25519 の構成要素は、生の 32 バイトではなく DER でエンコードされ（公開鍵と暗号文では SPKI、44 バイト、秘密鍵では PKCS#8）、ML-KEM-768 の構成要素は 1184 バイト（公開鍵）と 1088 バイト（暗号文）です。
- その共有秘密は `HKDF-SHA256(ikm = x25519_ss || ml_kem_768_ss, salt = "DCP-AI.v2.HybridKEM", info = "x25519-ml-kem-768")` です。

DCP-04 の交換を代わりに実行してくれる SDK はありません。§3.4 の A2A セッション鍵は呼び出し側が導出し、SDK のセッション関数に渡します。

<a id="22-ml-dsa-fips-204--digital-signatures"></a>
<a id="22-ml-dsa-fips-204-digital-signatures"></a>

### 2.2 ML-DSA（FIPS 204）— デジタル署名

DCP-AI は、Ed25519 との複合バインディングにおける主要なポスト量子署名アルゴリズムとして ML-DSA-65 を使います。ML-DSA-87 は予約されており、実装されていません。

<a id="ml-dsa-65-primary"></a>

#### ML-DSA-65（主要）

| パラメーター | FIPS 204 の値 | DCP-AI の値 | 注記 |
|-----------|---------------|-------------|-------|
| パラメーターセット | ML-DSA-65 | `ml-dsa-65` | NIST セキュリティレベル 3 |
| 公開鍵のサイズ | 1952 バイト | 1952 バイト | 適合 |
| 秘密鍵のサイズ | 4032 バイト | 4032 バイト | 適合 |
| 署名のサイズ | 3309 バイト | 3309 バイト | 適合 |
| ドメイン分離 | コンテキスト文字列のパラメーター | コンテキストタグの接頭辞 | 第 3 節を参照 |
| ランダム化署名 | ヘッジ（既定）または決定的 | プロバイダーによる | TypeScript（`@noble/post-quantum` の既定）と Rust（`fips204` の `try_sign`）のプロバイダーではヘッジ、Go のプロバイダー（CIRCL の `SignTo`、`randomized = false`）では決定的、Python は `pqcrypto` の既定に従います（ここでは未確認）。どちらの方式も有効な FIPS 204 の署名で、同じ方法で検証されます |

<a id="ml-dsa-87-high-assurance--reserved"></a>
<a id="ml-dsa-87-high-assurance-reserved"></a>

#### ML-DSA-87（高保証 — 予約）

ML-DSA-87 は将来の高保証の用途のために予約されています。`ml-dsa-87` は鍵のスキーマにおける `alg` の受け付けられる値で、下のサイズは FIPS 204 のものですが、これで鍵を生成、署名、検証できる SDK はなく、リファレンス CLI はその鍵の生成を拒否します。

TypeScript SDK のソースには、`ml-dsa-87` を挙げる `HsmCryptoProvider`（`sdks/typescript/src/providers/hsm-provider.ts`）があります。これは**シミュレーションのパターン**であり、HSM との統合ではありません。エクスポートも登録もされず、PKCS#11 のバインディングもなく、ランダムな「公開鍵」を作り、署名の代わりにハッシュを生成し、その `verify` は正しい長さのどんな署名でも受け入れます。実際の証拠の署名や検証に使ってはなりません。

| パラメーター | FIPS 204 の値 | DCP-AI の値 | 注記 |
|-----------|---------------|-------------|-------|
| パラメーターセット | ML-DSA-87 | `ml-dsa-87` | NIST セキュリティレベル 5 |
| 公開鍵のサイズ | 2592 バイト | 2592 バイト | 適合 |
| 秘密鍵のサイズ | 4896 バイト | 4896 バイト | 適合 |
| 署名のサイズ | 4627 バイト | 4627 バイト | 適合 |
| ステータス | — | 予約 | どの SDK にも未実装。 |

**DCP-AI での用途：**

- **複合署名：** `pq_over_classical` バインディングモードで、ML-DSA-65 は (context_tag || 0x00 || payload || classical_sig) の連結に署名します。
- **PQ チェックポイント：** ML-DSA-65 は、監査イベントのバッチのマークルルートに署名します。
- **バンドルの署名：** バンドル単位の複合署名は、Ed25519 と ML-DSA-65 を組み合わせます。

<a id="23-slh-dsa-fips-205--stateless-hash-based-signatures"></a>
<a id="23-slh-dsa-fips-205-stateless-hash-based-signatures"></a>

### 2.3 SLH-DSA（FIPS 205）— ステートレスなハッシュベース署名

DCP-AI は、ポスト量子署名のバックアップ方式として SLH-DSA-192f を使います。SLH-DSA の安全性はハッシュ関数の安全性の仮定だけに基づいており、格子ベースの仮定（ML-DSA）が弱まった場合の多層防御になります。

<a id="slh-dsa-192f-backup"></a>

#### SLH-DSA-192f（バックアップ）

| パラメーター | FIPS 205 の値 | DCP-AI の値 | 注記 |
|-----------|---------------|-------------|-------|
| パラメーターセット | SLH-DSA-SHA2-192f | `slh-dsa-192f` | NIST セキュリティレベル 3、高速版 |
| 公開鍵のサイズ | 48 バイト | 48 バイト | 適合 |
| 秘密鍵のサイズ | 96 バイト | 96 バイト | 適合 |
| 署名のサイズ | 35,664 バイト | 35,664 バイト | 適合 |
| ハッシュ関数 | SHA2 パラメーターセット（SHA-256 と SHA-512） | SHA2 パラメーターセット | 適合 |

<a id="slh-dsa-256f-reserved"></a>

#### SLH-DSA-256f（予約）

| パラメーター | FIPS 205 の値 | DCP-AI の値 | 注記 |
|-----------|---------------|-------------|-------|
| パラメーターセット | SLH-DSA-SHA2-256f | `slh-dsa-256f` | NIST セキュリティレベル 5 |
| 公開鍵のサイズ | 64 バイト | 64 バイト | 将来の利用のため予約 |
| 署名のサイズ | 49,856 バイト | 49,856 バイト | 将来の利用のため予約 |

**DCP-AI での用途：**

- **アルゴリズムの代替：** ML-DSA がガバナンスの非推奨アドバイザリーの対象になった場合、検証器は複合署名の PQ の構成要素として SLH-DSA-192f に移行できます。
- **高保証の監査：** 保守的なセキュリティ方針を持つ組織は、ML-DSA と並べて SLH-DSA を求めることがあります。

<a id="24-sp-800-208-context-only"></a>

### 2.4 SP 800-208（参考のみ）

NIST SP 800-208 は、ステートフルなハッシュベース署名方式である LMS と XMSS を扱います。その主な要件は運用上のものです。ワンタイム署名鍵を決して再利用しないこと、そして署名の状態（次に使う未使用の鍵のインデックス）を永続的かつ一貫して保つことです。DCP-AI は LMS も XMSS も実装していないため、SP 800-208 は適用されず、この文書はそれへの適合を主張しません。DCP-AI は代わりに、保つべき署名の状態を持たないステートレスな SLH-DSA（FIPS 205）を使います。この選択は、分散したエージェントのデプロイにおける状態同期のリスクを避けるものであり、SP 800-208 への適合ではありません。公開鍵に名前を付けるだけの決定的な `kid` も、それへの適合ではありません。

---

<a id="3-domain-separation-and-context-binding"></a>

## 3. ドメイン分離とコンテキストの結び付け

FIPS 204（ML-DSA）は、ドメイン分離のための任意のコンテキスト文字列をサポートします。DCP-AI はそれを使わず、次のようにメッセージそのものの中でドメインを分離します。

```
signed_bytes = UTF8(context_tag) || 0x00 || canonical_payload_bytes
```

クラシカル（Ed25519）の署名は、これらのバイト列をそのまま署名します。`pq_over_classical` のバインディングでは、PQ 署名はこれらのバイト列にクラシカルな署名のバイト列を続けたものに署名するため（§2.2）、二つの署名は同じメッセージを対象としません。DCP のコンテキストタグはメッセージの中の接頭辞であり、FIPS 204 のコンテキスト文字列ではありません。SDK のプロバイダーは空の `ctx` で ML-DSA を呼び出します。区切りの 0x00 バイトにより、コンテキストタグとペイロードのデータの間の曖昧さを防ぎます。

| DCP のコンテキストタグ | 対応先 |
|-----------------|---------|
| `DCP-AI.v2.AgentPassport` | エージェントの身元の署名 |
| `DCP-AI.v2.ResponsiblePrincipal` | Responsible Principal Record の署名 |
| `DCP-AI.v2.Intent` | 意図の宣言の署名 |
| `DCP-AI.v2.PolicyDecision` | ポリシー判断の署名 |
| `DCP-AI.v2.AuditEvent` | PQ チェックポイントと監査の圧縮の署名（V2 の監査エントリは 1 件ずつ署名されるわけではありません） |
| `DCP-AI.v2.Bundle` | バンドル単位の署名 |
| `DCP-AI.v2.Revocation` | 失効記録の署名 |
| `DCP-AI.v2.KeyRotation` | 鍵のローテーションの証明 |
| `DCP-AI.v2.Governance` | ガバナンスの操作 |

これは抜粋です。TypeScript SDK の `DCP_CONTEXTS` は、DCP-05 から DCP-09 のものを含む 19 のコンテキストタグを挙げています。
`DCP-AI.v2.Governance` はその中に含まれません。TypeScript のガバナンスモジュールが独自の定数として定義しています。

---

<a id="4-test-vector-references"></a>

## 4. テストベクターの参照

<a id="41-nist-kat-directory"></a>

### 4.1 NIST KAT のディレクトリ

DCP-AI は Known Answer Test のベクターを `tests/nist-kat/` で管理しています。

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

各ファイルが何を確認するかは [`tests/nist-kat/README.md`](../tests/nist-kat/README.md) を参照してください。

§4.3 から §4.5 の表と §5 のチェックリストは、実装が到達すべきカバレッジを示すもので、認証ではありません。マトリクス全体を
1 つのファイルで網羅するものはありません。`tests/nist-kat/` にあるのは上に挙げたベクターで、ほかの行は各 SDK 自身のテストに
依存し、それらがすべての行を網羅しているとは限りません。また、このディレクトリにはハイブリッド構成のベクターはありません。

<a id="42-ed25519-rfc-8032"></a>

### 4.2 Ed25519（RFC 8032）

Ed25519 は決定的です。テストベクターは RFC 8032 の 7.1 節から直接取っています。DCP-AI のすべての SDK は、同じ (secret_key, message) の組に対して同一の署名を生成しなければなりません（MUST）。

<a id="43-ml-dsa-65-fips-204"></a>

### 4.3 ML-DSA-65（FIPS 204）

ML-DSA-65 はランダム化署名と決定的署名の両方をサポートします。2.2 節で述べたとおり、現在の SDK のプロバイダーは異なる方式を使っています。KAT との直接比較には署名の乱数を制御する必要があり、それは暗号ライブラリごとに異なります。DCP-AI は次の性質を確認しますが、これらの確認は NIST によるアルゴリズムやモジュールの完全な検証に相当するものではありません。

| テスト | 説明 | 基準 |
|------|-------------|------|
| サイズの適合 | 公開鍵 = 1952 B、署名 = 3309 B | 合格必須 |
| 往復 | `verify(pk, sign(sk, msg), msg) == true` | 合格必須 |
| 別の鍵での拒否 | `verify(pk_other, sign(sk, msg), msg) == false` | 合格必須 |
| SDK 間の検証 | SDK A の署名が SDK B で検証できる | 合格必須 |
| 決定的な kid | `kid(alg, pk)` がすべての SDK で同一 | 合格必須 |
| ドメイン分離 | コンテキストタグ A の署名がタグ B では検証できない | 合格必須 |
| 複合バインディング | クラシカルな署名を取り除くと PQ 署名が無効になる | 合格必須 |

<a id="44-slh-dsa-192f-fips-205"></a>

### 4.4 SLH-DSA-192f（FIPS 205）

| テスト | 説明 | 基準 |
|------|-------------|------|
| サイズの適合 | 公開鍵 = 48 B、署名 = 35,664 B | 合格必須 |
| 往復 | 署名してから検証すると成功する | 合格必須 |
| 別の鍵での拒否 | 別の鍵で検証すると失敗する | 合格必須 |
| SDK 間の検証 | SDK 間の相互運用性 | 合格必須 |

<a id="45-ml-kem-768-fips-203"></a>

### 4.5 ML-KEM-768（FIPS 203）

| テスト | 説明 | 基準 |
|------|-------------|------|
| サイズの適合 | 公開鍵 = 1184 B、暗号文 = 1088 B、SS = 32 B | 合格必須 |
| 往復 | `decapsulate(encapsulate(pk)) == shared_secret` | 合格必須 |
| 暗黙の拒否 | 別の鍵でデカプセル化すると、エラーではなく異なる共有秘密が返る（FIPS 203 の暗黙の拒否）。改変された暗号文でも同様 | 合格必須 |
| 入力の確認 | 不正な形式の入力はエラーで拒否される：長さの誤り、係数が ≥ q のカプセル化鍵、`H(ek)` が誤っているデカプセル化鍵 | 合格必須 |
| ハイブリッド構成 | 結合した HKDF の出力がリファレンスと一致する | 合格必須 |

<a id="46-running-kat-tests"></a>

### 4.6 KAT テストの実行

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

## 5. 実装者向けの適合性チェックリスト

このチェックリストを使って、あなたの DCP-AI の実装が NIST のポスト量子標準に適合していることを確認してください。

<a id="51-ml-kem-768-fips-203-checklist"></a>

### 5.1 ML-KEM-768（FIPS 203）のチェックリスト

- [ ] 公開鍵のサイズがちょうど 1184 バイトである
- [ ] 暗号文のサイズがちょうど 1088 バイトである
- [ ] 共有秘密のサイズがちょうど 32 バイトである
- [ ] カプセル化に FIPS 203 に準拠した実装を使っている
- [ ] デカプセル化に FIPS 203 に準拠した実装を使っている
- [ ] ハイブリッド構成が、X25519 と ML-KEM-768 の共有秘密を HKDF-SHA256 で結合している
- [ ] HKDF の info パラメーターに DCP-AI のコンテキストタグが含まれている
- [ ] 一時的な鍵がセッションごとに生成される（前方秘匿性）
- [ ] サイズ、往復、暗黙の拒否（別の鍵や改変された暗号文では異なる共有秘密になる）、入力の確認について KAT テストが合格する

<a id="52-ml-dsa-65-fips-204-checklist"></a>

### 5.2 ML-DSA-65（FIPS 204）のチェックリスト

- [ ] 公開鍵のサイズがちょうど 1952 バイトである
- [ ] 署名のサイズがちょうど 3309 バイトである
- [ ] 署名に FIPS 204 に準拠した実装を使っている
- [ ] 検証に FIPS 204 に準拠した実装を使っている
- [ ] 署名の前に、ドメイン分離のコンテキストタグが先頭に付けられる
- [ ] 複合バインディング：PQ 署名が `context || 0x00 || payload || classical_sig` を対象とする
- [ ] kid の導出：`hex(SHA-256(UTF8("ml-dsa-65") || 0x00 || raw_pk))[0:32]`
- [ ] サイズ、往復、別の鍵、SDK 間、ドメイン分離について KAT テストが合格する

<a id="53-ml-dsa-87-fips-204-checklist"></a>

### 5.3 ML-DSA-87（FIPS 204）のチェックリスト

将来の実装向け：現在、ML-DSA-87 を実装している DCP-AI の SDK はありません（§2.2）。

- [ ] 公開鍵のサイズがちょうど 2592 バイトである
- [ ] 署名のサイズがちょうど 4627 バイトである
- [ ] ML-DSA-65 と同じドメイン分離と複合バインディング
- [ ] kid の導出で、アルゴリズムの識別子として `"ml-dsa-87"` を使う
- [ ] KAT テストが合格する

<a id="54-slh-dsa-192f-fips-205-checklist"></a>

### 5.4 SLH-DSA-192f（FIPS 205）のチェックリスト

- [ ] 公開鍵のサイズがちょうど 48 バイトである
- [ ] 署名のサイズがちょうど 35,664 バイトである
- [ ] 署名に FIPS 205 に準拠した実装を使っている
- [ ] 検証に FIPS 205 に準拠した実装を使っている
- [ ] ML-DSA と同じドメイン分離のパターン
- [ ] kid の導出で、アルゴリズムの識別子として `"slh-dsa-192f"` を使う
- [ ] KAT テストが合格する

<a id="55-general-cryptographic-checklist"></a>

### 5.5 暗号全般のチェックリスト

- [ ] すべての PQ の操作で、可能な限り定数時間の実装を使っている
- [ ] 秘密鍵は使用後にゼロクリアされる（メモリーの安全な破棄）
- [ ] 秘密鍵は、デプロイのリスクに見合ったストレージに保管されている（このリポジトリは HSM/TPM との統合を提供しません）
- [ ] 暗号の俊敏性のために、アルゴリズムのアドバイザリーの仕組みが実装されている
- [ ] すべての署名付きペイロードで、数値フィールドは整数のみ（浮動小数点なし）
- [ ] すべての JSON の署名で、既定であり唯一の規範的なプロファイルである `dcp-jcs-v1` の正規化（RFC 8785 JCS に基づく）を使う。実験的な候補 `dcp-jcs-v2` は明示的にオプトインした場合だけ

---

<a id="6-migration-path-classical-to-post-quantum"></a>

## 6. 移行の道筋：クラシカルからポスト量子へ

DCP-AI は、クラシカルのみのセキュリティからポスト量子のセキュリティへの、3 段階の移行の道筋を定めています。

これらのフェーズは 2026 年 4 月に書かれた推奨の計画であり、現在の検証器の動作の記述ではありません。現在、
`verifySignedBundleV2` は V2 のバンドルしか受け付けません。V1 のバンドルを受け入れるかどうかは、バージョンによるルーターや
ミドルウェアが自らのポリシー（`allow_v1_bundles`）に従って決め、拒否することはできますが、それ自体が非推奨の警告を出すことは
ありません（[MIGRATION_V1_V2.md](MIGRATION_V1_V2.md#32-coexistence-strategy)）。`hybrid_preferred` では、PQ 署名の欠落が許容されるのは実効モード（ポリシーのモードとリスクティアの
モードのうち厳しい方）が許す場合だけで、存在するが無効な PQ 署名は常に拒否されます。

<a id="phase-1-hybrid-introduction"></a>

### フェーズ 1：ハイブリッドの導入

| 項目 | 状態 |
|--------|-------|
| 既定の検証モード | `hybrid_preferred` |
| クラシカルな署名 | 必須 |
| PQ 署名 | 推奨、必須ではない |
| V1 のバンドル | 受け入れる |
| 複合バインディング | 利用可能、必須ではない |

実装者が行うこと：
1. Ed25519 と並べて ML-DSA-65 のプロバイダーを統合する。
2. ハイブリッドな鍵ペア（Ed25519 + ML-DSA-65）を生成する。
3. 可能な場合は複合署名を生成する。
4. V1 のバンドルは引き続き通常どおり検証される。

<a id="phase-2-hybrid-required"></a>

### フェーズ 2：ハイブリッド必須

| 項目 | 状態 |
|--------|-------|
| 既定の検証モード | `hybrid_required` |
| クラシカルな署名 | 必須 |
| PQ 署名 | 必須 |
| V1 のバンドル | 警告付きで受け入れる |
| 複合バインディング | V2 では必須 |

実装者が行うこと：
1. すべての V2 のバンドルは複合署名を含まなければならない（MUST）。
2. 検証器のポリシーが `min_pq >= 1` を強制する。
3. 二重ハッシュチェーン（SHA-256 + SHA3-256）を有効にすべきである（SHOULD）。
4. V1 のバンドルは非推奨の警告を出す。

<a id="phase-3-pq-only-future-as-a-default"></a>

### フェーズ 3：PQ のみ（既定としては将来）

`pq_only` の検証モードは現在すでに検証器に実装されています。将来のこととして残っているのは、それを既定にすることです。

| 項目 | 状態 |
|--------|-------|
| 既定の検証モード | `pq_only` |
| クラシカルな署名 | 引き続き複合署名の一部。`pq_only` では、その検証が受け入れの要件でなくなることがある |
| PQ 署名 | 必須 |
| V1 のバンドル | 拒否する |
| 複合バインディング | 引き続き `pq_over_classical`。PQ 署名はドメイン分離したメッセージとクラシカルな署名のバイト列に対して検証されるため、クラシカルな部分のない署名はサポートされた形式ではない |

実装者が行うこと：
1. クラシカルな検証が受け入れの要件でなくなることがある。クラシカルな署名は複合形式の中に残る。
2. V1 のバンドルは既定で拒否される。
3. ガバナンスのアドバイザリーの仕組みが、クラシカルなアルゴリズムを非推奨にすることがある。
4. ML-DSA が弱まった場合、SLH-DSA-192f がバックアップになる。

<a id="migration-timeline-recommended"></a>

### 移行のタイムライン（推奨）

このタイムラインは 2026 年 4 月に書かれたもので、書かれたまま残しています。2026 年 10 月 25 日の時点では、すべての SDK の既定の検証器ポリシーは `hybrid_preferred`（低リスクのパスポートには `classical_only`）を使い、リファレンスサーバーは `hybrid_required` で起動していました。フェーズ 3 を発動したガバナンスのアドバイザリーはありませんでした。

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

## 7. NIST の PQ 標準への移行ガイダンスとの整合

DCP-AI は、NIST が公表しているポスト量子暗号への移行ガイダンスと整合しています。

| NIST のガイダンス | DCP-AI の実装 |
|--------------|----------------------|
| ハイブリッドなデプロイを早期に始める | v2.0 のリリース時からハイブリッドな複合署名 |
| FIPS 203/204/205 で承認されたアルゴリズムを使う | ML-KEM-768、ML-DSA-65、SLH-DSA-192f（ML-DSA-87 は予約、未実装） |
| 暗号の俊敏性を保つ | アルゴリズムのレジストリ + アドバイザリーの仕組み + プロバイダーの抽象化 |
| アルゴリズムの非推奨化に備える | 自動応答を伴う、ガバナンスが署名したアドバイザリー |
| 長期間保存するデータを保護する | ハッシュで連鎖した監査証跡。二重ハッシュチェーンは生成され、`@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go v2.11.1、Rust `dcp-ai` 2.11.1 以降の V2 検証器は存在する二次フィールドを確認します（それより前のバージョンは確認しません）（[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains)） |
| 移行期間中はハイブリッド構成を使う | `pq_over_classical` の複合バインディング |
| 鍵の保管にハードウェアセキュリティモジュールを使う | 未実装：HSM/TPM との統合はありません。ソースにある `HsmCryptoProvider` はシミュレーションです（§2.2） |
| 相互運用性を試験する | SDK 間の KAT の検証、適合性テストスイート |

---

<a id="8-cryptographic-library-requirements"></a>

## 8. 暗号ライブラリの要件

実装は、NIST に準拠したアルゴリズムの実装を提供する暗号ライブラリを使わなければなりません（MUST）。

<a id="libraries-used-by-each-shipped-sdk"></a>

### 提供されている各 SDK が使うライブラリ

| SDK | ライブラリ | アルゴリズム |
|-----|---------|-----------|
| TypeScript（`@dcp-ai/sdk`） | `@noble/post-quantum` | ML-DSA-65、SLH-DSA-192f。ML-KEM-768（内部のみ、エクスポートなし） |
| TypeScript（`@dcp-ai/sdk`） | `tweetnacl` | Ed25519 |
| TypeScript（`@dcp-ai/sdk`） | Node.js の `crypto` | SHA-256、SHA3-256、HMAC-SHA256（HKDF）。X25519（内部のみ、エクスポートなし） |
| Python（`dcp-ai`） | `pqcrypto` ≥ 1.0（Backbone の Rust クレート、独立した監査なし） | ML-DSA-65、ML-KEM-768、SLH-DSA-192f |
| Python（`dcp-ai`） | `pynacl`（libsodium） | Ed25519 |
| Go（`sdks/go/v2`） | `github.com/cloudflare/circl` | ML-DSA-65、ML-KEM-768、SLH-DSA-192f |
| Go（`sdks/go/v2`） | `crypto/ed25519`（標準ライブラリ） | Ed25519 |
| Rust（`dcp-ai` クレート） | `fips203`、`fips204`、`fips205`（integritychain） | ML-KEM-768、ML-DSA-65、SLH-DSA-192f |
| Rust（`dcp-ai` クレート） | `ed25519-dalek` | Ed25519 |
| WASM（`@dcp-ai/wasm`） | 上の Rust クレートからコンパイル | Rust と同じ |

Python、Go、Rust の SDK は ML-KEM-768 を KEM のプリミティブ（`MlKem768Provider`）として公開し、`@dcp-ai/wasm` は `wasm_ml_kem_768_*` 関数として公開しています。TypeScript SDK は、ソースに ML-KEM-768、X25519、ハイブリッドのプロバイダーを持っていますが、それらをエクスポートしていません。DCP-04 の X25519 + ML-KEM-768 のハイブリッド交換を実行する SDK はありません。両当事者が自らセッション鍵を導出し、セッション関数（Python では `create_session`、Go では `CreateSession`）に渡します。Rust の A2A モジュールが扱うのは、ディスカバリー、ハンドシェイクのメッセージ、セッション ID だけです。

<a id="library-audit-requirements"></a>

### ライブラリの監査の要件

本番のデプロイでは、暗号ライブラリは次を満たすべきです（SHOULD）。
- 独立したセキュリティ監査を受けている
- 秘密に依存する分岐で定数時間の処理を実装している
- メモリーを安全にゼロクリアする API を提供している
- すべての PQ アルゴリズムについて NIST の KAT ベクターに合格する

---

<a id="9-references"></a>

## 9. 参考文献

- **FIPS 203** — NIST、"Module-Lattice-Based Key-Encapsulation Mechanism Standard"、2024 年 8 月。
- **FIPS 204** — NIST、"Module-Lattice-Based Digital Signature Standard"、2024 年 8 月。
- **FIPS 205** — NIST、"Stateless Hash-Based Digital Signature Standard"、2024 年 8 月。
- **SP 800-208** — NIST、"Recommendation for Stateful Hash-Based Signature Schemes"、2020 年 10 月。
- **RFC 5869** — Krawczyk, H.、P. Eronen、"HMAC-based Extract-and-Expand Key Derivation Function (HKDF)"、2010 年 5 月。
- **RFC 8032** — Josefsson, S.、I. Liusvaara、"Edwards-Curve Digital Signature Algorithm (EdDSA)"、2017 年 1 月。
- **RFC 8785** — Rundgren, A.、Jordan, B.、S. Erdtman、"JSON Canonicalization Scheme (JCS)"、2020 年 6 月。
- **DCP-AI v2.0 規範仕様** — `spec/DCP-AI-v2.0.md`
- **DCP-AI セキュリティモデル** — `docs/SECURITY_MODEL.md`
- **DCP-AI NIST KAT の README** — `tests/nist-kat/README.md`
