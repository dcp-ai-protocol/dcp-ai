<sub>[English](DCP-AI-v2.0.md) · [中文](DCP-AI-v2.0.zh-CN.md) · [Español](DCP-AI-v2.0.es.md) · **日本語** · [Português](DCP-AI-v2.0.pt-BR.md)</sub>

<a id="dcp-ai-v20-normative-specification"></a>

# DCP-AI v2.0 規範仕様

> [英語の仕様](DCP-AI-v2.0.md)の参考訳です（25/10/2026 更新）。**規範となるのは英語版です**。この翻訳に規範的な効力はなく、内容が異なる場合は英語版が優先されます。識別子とコードブロックは翻訳せずにそのまま掲載しています。

**ステータス:** Final  
**バージョン:** 2.0.0  
**日付:** 2026-02-26  
**著者:** DCP-AI Protocol Governance  

---

<a id="1-introduction"></a>

## 1. はじめに

Digital Citizenship Protocol for AI（DCP-AI）v2.0 は、エージェントのアイデンティティ、意図の宣言、ポリシーによるゲーティング、監査証跡のための、量子耐性を持つ枠組みを定義します。v1.0 に代わるもので、複合バインディングによるハイブリッド署名、ドメイン分離、セッションバインディング、検証者が決定権を持つポリシーの適用を導入します。

<a id="11-design-goals"></a>

### 1.1 設計目標

1. **耐量子セキュリティ**: アイデンティティと監査のすべての成果物を、ハイブリッドの複合署名で量子攻撃者から保護する。
2. **否認防止**: エージェントと人間は、署名済みの監査チェーンに記録された行動を否認できない。
3. **改ざんの検出**: ハッシュチェーン、Merkle ルート、ブロックチェーンへのアンカリングが、多層的な改ざん検出を提供する。
4. **暗号アジリティ**: アルゴリズムレジストリとプロバイダーの抽象化により、プロトコルを変えずにアルゴリズムを移行できる。
5. **プライバシー**: ブラインド化された RPR のモードが、検証可能性を保ちながら個人情報を保護する。
6. **相互運用性**: SDK 間の検証、CBOR のワイヤーフォーマット、gRPC への対応。

<a id="12-notation"></a>

### 1.2 表記

- `||` はバイト列の連結を表す
- `UTF8(s)` は文字列 `s` の UTF-8 エンコーディングを表す
- `canonical(obj)` は、RFC 8785 JCS に基づくプロファイル `dcp-jcs-v1`（§15）による正規化を表す
- `SHA-256(m)` はメッセージ `m` の SHA-256 ハッシュを表す
- `hex(b)[0:n]` はバイト列 `b` の先頭 `n` 文字の 16 進表記を表す

---

<a id="2-algorithm-registry"></a>

## 2. アルゴリズムレジストリ

<a id="21-signature-algorithms"></a>

### 2.1 署名アルゴリズム

| 識別子 | 規格 | 公開鍵サイズ | 署名サイズ | セキュリティレベル | ステータス |
|---|---|---|---|---|---|
| `ed25519` | RFC 8032 | 32 B | 64 B | 古典 128 ビット | ACTIVE |
| `ml-dsa-65` | FIPS 204 | 1952 B | 3309 B | NIST レベル 3 PQ | ACTIVE（主要な PQ） |
| `ml-dsa-87` | FIPS 204 | 2592 B | 4627 B | NIST レベル 5 PQ | ACTIVE（高保証） |
| `slh-dsa-192f` | FIPS 205 | 48 B | 35664 B | NIST レベル 3 PQ | ACTIVE（予備の PQ） |
| `slh-dsa-256f` | FIPS 205 | 64 B | 49856 B | NIST レベル 5 PQ | RESERVED |

> *参考の注記（2026 年 10 月 25 日）、規範的な本文の一部ではありません：* `ml-dsa-87` を実装している DCP-AI の SDK はまだありません。SDK は `ed25519`、`ml-dsa-65`、`slh-dsa-192f` で署名し検証します（[docs/NIST_CONFORMITY.md](../docs/NIST_CONFORMITY.md)）。

<a id="22-kem-algorithms"></a>

### 2.2 KEM アルゴリズム

| 識別子 | 規格 | 公開鍵サイズ | 暗号文サイズ | セキュリティレベル |
|---|---|---|---|---|
| `x25519` | RFC 7748 | 32 B | 32 B | 古典 128 ビット |
| `ml-kem-768` | FIPS 203 | 1184 B | 1088 B | NIST レベル 3 PQ |
| `x25519-ml-kem-768` | ハイブリッド | 1216 B | 1120 B | ハイブリッド レベル 3 |

<a id="23-hash-algorithms"></a>

### 2.3 ハッシュアルゴリズム

| 識別子 | 出力 | 用途 |
|---|---|---|
| `sha256` | 32 B | レベル 3 の導入での既定（DEFAULT） |
| `sha3-256` | 32 B | 二重ハッシュモードの副ハッシュ |
| `sha384` | 48 B | レベル 5 の導入で推奨（RECOMMENDED） |

<a id="24-numeric-types"></a>

### 2.4 数値型

DCP-AI v2.0 のすべての数値フィールドは整数でなければなりません（MUST）。正規化の曖昧さをなくすため、浮動小数点値は禁止されます。

---

<a id="3-key-objects"></a>

## 3. 鍵オブジェクト

<a id="31-key-entry"></a>

### 3.1 鍵エントリー

```json
{
  "kid": "<32 hex chars>",
  "alg": "<algorithm identifier>",
  "public_key_b64": "<base64-encoded public key>",
  "created_at": "<ISO 8601>",
  "expires_at": "<ISO 8601 | null>",
  "status": "active | revoked | expired"
}
```

<a id="32-deterministic-kid-derivation"></a>

### 3.2 決定的な kid の導出

```
kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key_bytes))[0:32]
```

性質: 一意、決定的、衝突耐性（SHA-256 の切り詰めによる 128 ビット）。

---

<a id="4-domain-separation"></a>

## 4. ドメイン分離

すべての署名はドメイン分離タグを含まなければなりません（MUST）。

```
signed_bytes = UTF8(context_tag) || 0x00 || canonical_payload_bytes
```

<a id="41-context-tags"></a>

### 4.1 コンテキストタグ

| コンテキストタグ | 用途 |
|---|---|
| `DCP-AI.v2.AgentPassport` | エージェントパスポートの自己署名 |
| `DCP-AI.v2.ResponsiblePrincipal` | 人間とのバインディング記録の署名 |
| `DCP-AI.v2.Intent` | 意図の宣言の署名 |
| `DCP-AI.v2.PolicyDecision` | ポリシーエンジンの署名 |
| `DCP-AI.v2.AuditEvent` | イベントごとの監査署名 |
| `DCP-AI.v2.Bundle` | bundle の署名 |
| `DCP-AI.v2.Revocation` | 失効記録の署名 |
| `DCP-AI.v2.KeyRotation` | 鍵ローテーションの証明 |
| `DCP-AI.v2.ProofOfPossession` | 所持証明のチャレンジレスポンス |
| `DCP-AI.v2.JurisdictionAttestation` | 管轄区域の証明 |
| `DCP-AI.v2.HumanConfirmation` | 人間による確認 |
| `DCP-AI.v2.AlgorithmAdvisory` | アルゴリズムの非推奨化の勧告 |
| `DCP-AI.v2.Governance` | ガバナンスの操作 |
| `DCP-AI.v2.MultiPartyAuth` | 複数当事者の認可における各当事者の認可（`multi_party_authorization.schema.json`） |
| `DCP-AI.v2.Lifecycle` | 運用開始証明書、バイタリティレポート、廃止記録（DCP-05） |
| `DCP-AI.v2.Succession` | デジタル遺言、メモリ移転マニフェスト、承継記録（DCP-06） |
| `DCP-AI.v2.Dispute` | 紛争記録、異議、仲裁の解決、判例バンドル（DCP-07） |
| `DCP-AI.v2.Rights` | 権利宣言、義務記録、権利侵害報告（DCP-08） |
| `DCP-AI.v2.Delegation` | ルートの委任マンデート（人間の署名）、プリンシパルミラー、やり取りの記録（DCP-09） |
| `DCP-AI.v2.Awareness` | 認識しきい値と助言の宣言（DCP-09） |
| `DCP-AI.v2.SubMandate` | 委任するエージェントが署名したサブマンデート（DCP-09 §3.5） |

> **正誤 E1（25/10/2026、規範的）：** `MultiPartyAuth`、`Lifecycle`、`Succession`、`Dispute`、`Rights`、`Awareness` の行と、`Delegation` の行のプリンシパルミラーは、SDK と `tests/interop/v2/interop_vectors.json#domain_separation_all_contexts` がすでに使っているコンテキストを記載するもので、タグを追加するものではありません。[V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md) を参照してください。

---

<a id="5-composite-signatures"></a>

## 5. 複合署名

<a id="51-binding-protocol"></a>

### 5.1 バインディングのプロトコル

```
Step 1: classical_sig = Classical.sign(context || 0x00 || payload)
Step 2: pq_sig = PQ.sign(context || 0x00 || payload || classical_sig)
```

PQ 署名は古典署名を対象に含みます。どちらかの構成要素を取り除くと、両方の検証が失敗します。

<a id="52-wire-format"></a>

### 5.2 ワイヤーフォーマット

```json
{
  "composite_sig": {
    "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
    "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
    "binding": "pq_over_classical"
  }
}
```

<a id="53-binding-modes"></a>

### 5.3 バインディングのモード

- `pq_over_classical`: v2.0 では必須（MANDATORY）。PQ 署名が古典署名を対象に含む。
- `classical_only`: 移行期間中は許可される。PQ のフィールドは `null`。

---

<a id="6-signedpayload-envelope"></a>

## 6. SignedPayload エンベロープ

成果物が署名データを含むことはありません。署名は兄弟フィールドに置かれます。

```json
{
  "payload": { /* pure artifact */ },
  "payload_hash": "sha256:...",
  "composite_sig": { /* ... */ }
}
```

署名されるバイト列: `context_tag || 0x00 || canonical(payload)`

---

<a id="7-verification-modes"></a>

## 7. 検証モード

<a id="71-modes"></a>

### 7.1 モード

| モード | 古典の要否 | PQ の要否 | V1 bundle |
|---|---|---|---|
| `classical_only` | 必要 | 不要 | 可 |
| `pq_only` | 不要 | 必要 | 不可 |
| `hybrid_required` | 必要 | 必要 | 設定可能 |
| `hybrid_preferred` | 必要 | 不要（警告） | 設定可能 |

どのモードでも、存在する PQ 署名（`pq_over_classical`）は検証に成功しなければなりません（MUST）。`hybrid_preferred` と `classical_only` が許容するのは、PQ 署名がない場合だけです。

<a id="72-verifier-authoritative-policy"></a>

### 7.2 検証者が決定権を持つポリシー

署名のポリシーは、エージェントでは決してなく検証者の設定によって決まります。検証者は自らの設定からポリシーを読み込みます。

```json
{
  "verifier_policy": {
    "default_mode": "hybrid_required",
    "risk_overrides": { "high": "hybrid_required", "medium": "hybrid_required", "low": "hybrid_preferred" },
    "min_classical": 1,
    "min_pq": 1,
    "accepted_classical_algs": ["ed25519"],
    "accepted_pq_algs": ["ml-dsa-65", "slh-dsa-192f"],
    "require_session_binding": true,
    "require_composite_binding": true,
    "allow_classical_fallback_disable": false,
    "warn_classical_only_deprecated": false,
    "advisory_rejected_algs": []
  }
}
```

セキュリティ階層（§14.3）は、このポリシーが選ぶモードをより厳しくすることしかできません。

<a id="73-pq-only-mode-phase-3"></a>

### 7.3 PQ のみのモード（フェーズ 3）

`default_mode` が `pq_only` の場合:

- 古典署名は受け入れられるが、必須ではない
- `min_classical` は 0、`min_pq` は 1
- 複合バインディングは必須ではない
- V1 bundle は拒否される
- 古典のみの bundle には非推奨の警告が出る

---

<a id="8-session-binding"></a>

## 8. セッションバインディング

256 ビットのランダムな `session_nonce`（16 進 64 文字）が、セッション内のすべての成果物を結び付けます。

```
session_nonce = hex(random(32))
```

すべての V2 成果物は `session_nonce` を含みます。検証者は、bundle 内のすべての成果物が同じ nonce を共有していることを確認しなければなりません（MUST）。

---

<a id="9-bundle-manifest"></a>

## 9. bundle マニフェスト

bundle マニフェストは、すべての成果物のハッシュを暗号学的に結び付けます。

```json
{
  "manifest": {
    "session_nonce": "...",
    "rpr_hash": "sha256:...",
    "passport_hash": "sha256:...",
    "intent_hash": "sha256:...",
    "policy_hash": "sha256:...",
    "audit_merkle_root": "sha256:...",
    "audit_merkle_root_secondary": "sha3-256:...",
    "audit_count": 5,
    "pq_checkpoints": ["ckpt-uuid-1"],
    "canonicalization_profile": "dcp-jcs-v1"
  }
}
```

`canonicalization_profile` は省略可能（OPTIONAL）です（現在定義されているのは `"dcp-jcs-v1"` だけです。§ 15 と [`CANONICALIZATION_PROFILE.md`](CANONICALIZATION_PROFILE.md) を参照）。このフィールドのない bundle を受け取った検証者は、`dcp-jcs-v1` とみなさなければなりません（MUST）。将来のプロファイルでは、このフィールドは必須（REQUIRED）になります。

bundle レベルの複合署名は `canonical(manifest)` に署名します。

---

<a id="10-audit-trail"></a>

## 10. 監査証跡

<a id="101-per-event-signing"></a>

### 10.1 イベントごとの署名

各監査イベントは Ed25519 で署名されます（マイクロ秒単位のレイテンシー）。イベントは `prev_hash` によってハッシュチェーンを形成します。

<a id="102-pq-checkpoints-lazy-model"></a>

### 10.2 PQ チェックポイント（遅延モデル）

N イベントごと（設定可能、既定は 10）に PQ チェックポイントを作成します。これは直近 N イベントの Merkle ルートに対する複合署名です。

<a id="103-dual-hash-chains"></a>

### 10.3 二重ハッシュチェーン

SHA-256 と SHA3-256 のチェーンは v2.0 の開始時から並行して動作します。一方のハッシュファミリーが破られても、もう一方が継続性を提供します。

<a id="104-audit-compaction"></a>

### 10.4 監査の圧縮

N イベント（既定は 1000）の後に、圧縮のチェックポイントを作成します。圧縮されたイベントはアーカイブしてもかまいません（MAY）。チェックポイントはアクティブなチェーンに残ります。

---

<a id="11-key-management"></a>

## 11. 鍵管理

<a id="111-key-rotation"></a>

### 11.1 鍵のローテーション

1. 新しい鍵ペアを生成する
2. 新しい鍵が、`DCP-AI.v2.KeyRotation` コンテキストのもとで所持証明のチャレンジ（old_kid + new_kid + タイムスタンプ）に署名する
3. 古い鍵が副署してローテーションを認可する
4. 猶予期間: 両方の鍵が受け入れられる 30 日間

<a id="112-key-recovery-m-of-n-social-recovery"></a>

### 11.2 鍵の回復（M-of-N のソーシャルリカバリー）

マスターシークレットは Shamir の秘密分散で分割されます。シェアは回復用の連絡先に向けてハイブリッド KEM で暗号化されます。

> *参考の注記（2026 年 10 月 25 日）、規範的な本文の一部ではありません：* TypeScript SDK の鍵回復と `dcp recovery-setup` はシェアを作成しますが、暗号化はしません。回復用の連絡先に向けた暗号化は実装者に委ねられています。

<a id="113-emergency-revocation"></a>

### 11.3 緊急失効

事前に登録した `revocation_token = SHA-256(revocation_secret)`。原像を明かすと、暗号学的な署名なしにエージェントのすべての鍵が失効します。

<a id="114-hsmtpm-support"></a>

### 11.4 HSM/TPM への対応

秘密鍵はハードウェアセキュリティモジュールに保管すべきです（SHOULD）。`CryptoProvider` インターフェースは、PKCS#11 を通じてすべての操作を HSM に委ねる `HsmCryptoProvider` に対応しています。

> *参考の注記（2026 年 10 月 25 日）、規範的な本文の一部ではありません：* TypeScript SDK のソースにある `HsmCryptoProvider` はシミュレーションのパターンであり、HSM との統合ではありません。エクスポートされておらず、PKCS#11 のバインディングもなく、実際の証拠の署名や検証に使ってはなりません。このリポジトリはハードウェアのバックエンドを実装しておらず、FIPS 140 の検証も主張していません（[docs/NIST_CONFORMITY.md](../docs/NIST_CONFORMITY.md) §2.2）。

---

<a id="12-privacy"></a>

## 12. プライバシー

<a id="121-blinded-rpr"></a>

### 12.1 ブラインド化された RPR

ブラインド化された RPR（`schemas/v2/blinded_rpr.schema.json`）は、完全な RPR の個人情報のフィールド（`legal_name`、`contact`）をソルト付きのコミットメントに置き換えます。これにより、個人情報を含めずに bundle を透明性ログやアンカーに公開できます。個人情報ではないフィールド（`human_id`、`session_nonce`、`entity_type`、`jurisdiction`、`liability_mode`、`override_rights`、`issued_at`、`expires_at`、`binding_keys`）は変更せずにコピーされ、開示の際に完全な RPR と照合されます。

```
pii_salt = hex(random(32))
pii_hash = "sha256:" || hex(SHA-256(UTF8(canonical({ contact, legal_name, pii_salt }))))
```

`contact` がない場合は `null` としてハッシュされます。

- **ソルト。** `pii_salt` は完全な RPR のフィールドです。CSPRNG による 32 バイトを小文字の 16 進で表したもので、RPR ごとに新しく生成します。完全な RPR の署名の対象であり、公開してはなりません（MUST NOT）。ブラインド化された RPR に現れることはありません。ソルトを再利用すると、同じ個人情報を持つ記録が同じ `pii_hash` になり、記録同士を結び付けられてしまいます。32 バイトであれば、推測して確認する探索には、Grover のアルゴリズムを使っても 2^128 の計算量が必要です。
- **ブラインド化はフェイルクローズ。** 実装は、有効な `pii_salt` を持たない RPR のブラインド化を拒否しなければならず（MUST）、検証者は、`pii_salt` があるのに小文字の 16 進 64 文字でない完全な RPR を拒否しなければなりません（MUST）。ソルトは完全な RPR とともに署名されるため、RPR を作成するときに設定する必要があります。後でブラインド化する可能性のある RPR は、最初から `pii_salt` を持つべきです（SHOULD）。
- **開示。** ソルトは完全な RPR と一緒にのみ開示されます。たとえば規制当局に開示し、規制当局は完全な RPR から `pii_hash` を再計算して、個人情報ではないフィールドを照合します。
- **消去。** 完全な RPR を、それとともにソルトを削除すると、公開されたコミットメントは開けなくなります。推測した名前や連絡先をそれで確認することは誰にもできません。これにより、書き換えのできない不変のログやアンカー上の記録についても消去（GDPR 第 17 条）が可能になります。開示したものを含め、完全な RPR のすべての複製を削除する必要があります。
- **`human_id`。** ブラインド化された RPR は `human_id` を公開するため、`human_id` は不透明でなければならず（MUST）、メールアドレスや名前、それらのハッシュなど、個人情報を含んだり個人情報から導出したりしてはなりません（MUST NOT）。
- **従来のコミットメント。** `pii_salt` を持たない完全な RPR から計算した `pii_hash`（上の式から `pii_salt` のメンバーを除いたもの）は非推奨です。実装は、新しい記録をその方法でブラインド化してはなりません（MUST NOT）。検証者は、開示された完全な RPR と照合して従来のコミットメントを引き続き確認してもかまいませんが（MAY）、非推奨として印を付けるべきです（SHOULD）。個人情報を推測した者は誰でもそれを確認でき、不変のログ上ではそれが永遠に変わらないからです。

---

<a id="13-governance"></a>

## 13. ガバナンス

<a id="131-governance-key-set"></a>

### 13.1 ガバナンス鍵セット

アルゴリズムの勧告とプロトコルの決定に署名するための M-of-N のマルチパーティ鍵。`/.well-known/governance-keys.json` で公開されます。

<a id="132-algorithm-advisory-system"></a>

### 13.2 アルゴリズム勧告の仕組み

`warn`、`deprecate`、`revoke` のアクションを持つ署名付きの勧告。検証者の自動応答が、影響を受けるアルゴリズムを取り除き、代替を追加します。

<a id="133-advisory-auto-response"></a>

### 13.3 勧告への自動応答

検証者は自動的に次のことを行います。

- 非推奨または失効したアルゴリズムを受け入れリストから取り除く
- 代替のアルゴリズムを追加する
- 古典アルゴリズムがすべて取り除かれた場合は pq_only に切り替える
- ポリシー変更の監査証跡を保持する

---

<a id="14-adaptive-security-tiers"></a>

## 14. 適応型のセキュリティ階層

適応型のセキュリティ階層の仕組みは、ポリシー決定のリスクスコアと、意図のデータクラス、行動の種類、推定される影響から、暗号学的な保護のレベルを選びます。階層は、検証モードの選択、PQ チェックポイントの間隔、bundle の提示モードを決めます。

<a id="141-tier-definitions"></a>

### 14.1 階層の定義

| 階層 | 名前 | 検証モード | PQ チェックポイントの間隔 | bundle のサイズ | 暗号処理のレイテンシー |
|---|---|---|---|---|---|
| 0 | `routine` | `classical_only` | 50 イベントごと | ~1-2 KB | ~2 ms |
| 1 | `standard` | `hybrid_preferred` | 10 イベントごと | ~2-5 KB | ~2 ms + チェックポイント 5 ms |
| 2 | `elevated` | `hybrid_required` | 毎イベント | ~10-15 KB | ~11 ms |
| 3 | `maximum` | `hybrid_required` | 毎イベント + 即時検証 | ~15-25 KB | ~15 ms |

<a id="142-tier-selection-algorithm"></a>

### 14.2 階層の選択アルゴリズム

階層は、スキーマが定義する署名済みのフィールドだけから計算されます。意図の `action_type`、`data_classes`、`estimated_impact`、省略可能な `security_tier`、そして bundle の `PolicyDecisionV2` の `risk_score`（整数 0..1000）です。意図のスキーマには `risk_score` がありません。実装は意図からそれを読み取ってはなりません（MUST NOT）。

```
function computeSecurityTier(intent, policy_decision):
  if policy_decision is absent or null:
    score = 0
  else if policy_decision.risk_score is an integer from 0 to 1000:
    score = policy_decision.risk_score
  else:
    score = unknown
  dc = intent.data_classes
  unknown = score is unknown
         OR intent.action_type ∉ ACTION_TYPES
         OR intent.estimated_impact ∉ {low, medium, high}
         OR dc is not an array
         OR some element of dc ∉ DATA_CLASSES

  if score >= 800 OR dc ∩ {credentials, children_data} ≠ ∅:
    tier = "maximum"
  else if score >= 500 OR dc ∩ {pii, financial_data, health_data} ≠ ∅
       OR intent.action_type == "initiate_payment"
       OR intent.estimated_impact == "high" OR unknown:
    tier = "elevated"
  else if score >= 200 OR intent.estimated_impact == "medium":
    tier = "standard"
  else:
    tier = "routine"

  explicit = intent.security_tier
  if explicit is present and not null:
    tier = max(tier, explicit if it is a tier name else "elevated")
  if a verified mandate chain (DCP-09 §3.5) applies and has an effective tier:
    tier = max(tier, that tier if it is a tier name else "elevated")
  return tier
```

検証済みの委任チェーンの実効的な階層、すなわちチェーン上の `minimum_security_tier` の最大値は、この計算への省略可能な入力であり、結果を引き上げることしかできず、引き下げることは決してありません。チェーンを運ぶ bundle のフィールドはまだないため、この下限が適用されるのは、検証者が bundle と一緒に検証済みのチェーンを渡された場合です。§18 の bundle の検証者はチェーンを読みません。

`ACTION_TYPES` と `DATA_CLASSES` は、`schemas/v2/intent.schema.json` の `action_type` と `data_classes` の列挙値です。値が欠けている、型が誤っている、または未知の場合は、少なくとも `elevated` にフェイルクローズします。これにより、スキーマ検証の有無にかかわらず、検証者が知らない値によって bundle が受ける精査が弱まることはありません。ポリシー決定がない場合、スコアは 0 です。ポリシー決定の中で、`risk_score` が欠けているか、0 から 1000 の整数でない（文字列、小数、負の数、1000 を超える数）場合は、同じく未知として扱われ、上のスコアの比較では 0 とみなされます。`200.0` のように小数部のない数は、その整数として数えます。

`tests/interop/v2/interop_vectors.json` の `security_tier` カテゴリーには、各ケースについて期待される階層、検証モード、チェックポイントの間隔が列挙されています。4 つの SDK すべてがこれを実行します。

<a id="143-tier-enforcement-never-downgrade"></a>

### 14.3 階層の強制（引き下げない）

V2 の検証者は、すべての bundle の階層を計算し、次の 2 つのモードのうち厳しい方で bundle を検証しなければなりません（MUST）。

1. ポリシーのモード: 検証者の `default_mode`、またはパスポートの `risk_tier` に対応する `risk_overrides` のエントリー（§7.2）
2. 階層のモード（§14.1）

厳しさの順は `classical_only` < `hybrid_preferred` < `hybrid_required` です。階層は PQ の要件を加えることしかできないため、`pq_only` のポリシーは `pq_only` のままです。検証されるエージェントはパスポートと意図に署名するため、その `risk_tier` と `security_tier` はモードを引き上げることはできても、階層のモードより下げることはできません。検証者は、解決した階層を結果とともに報告します。

検証者は計算された階層を引き上げてもかまいませんが（MAY）、引き下げてはなりません（MUST NOT）。`PolicyDecisionV2` の `resolved_tier` フィールドは、ポリシーエンジンが解決した階層を記録します。これは情報提供のためのもので、§14.2 の計算はこれを読みません。

<a id="144-intent-and-policy-decision-fields"></a>

### 14.4 意図とポリシー決定のフィールド

`IntentV2` には省略可能な `security_tier` フィールド（自動計算または明示的に設定）があります。`PolicyDecisionV2` には省略可能な `resolved_tier` フィールドがあり、ポリシーエンジンが解決した階層を情報として示します。§14.2 はこれを読みません。

<a id="145-verification-cache"></a>

### 14.5 検証キャッシュ

検証済みの bundle の結果は、解決された階層で決まる TTL でキャッシュしてもかまいません（MAY）。

| 階層 | キャッシュの TTL |
|---|---|
| `routine` | 5 分 |
| `standard` | 2 分 |
| `elevated` | 30 秒 |
| `maximum` | 10 秒 |

いずれかの署名者の kid が失効したときは、キャッシュのエントリーを無効にしなければなりません（MUST）。

<a id="146-bundle-presentation-modes"></a>

### 14.6 bundle の提示モード

階層は、帯域幅を最適化するために推奨される提示モードに影響します。

- **階層 0-1（確立済みのセッション）**: `compact` または `reference` — PQ 署名を省略し、チェックポイントへの参照を含める
- **階層 2-3**: `full` — すべての署名を含む完全な bundle
- **初回の接触（どの階層でも）**: `full`

---

<a id="15-canonicalization"></a>

## 15. 正規化

DCP-AI v2.0 は、RFC 8785（JCS）に基づく正規化プロファイル **`dcp-jcs-v1`** を使います。このプロファイルは、JCS が実装に委ねている場合（undefined の扱い、整数値を持つ浮動小数点数、指数表記、null の保持、空のコンテナー）を固定し、4 つの SDK がバイト単位で同一の出力を作るようにします。JCS の厳密な部分集合ではありません。キーは Unicode のコードポイント順に並べられます（項目 1）が、RFC 8785 は UTF-16 のコード単位で並べます。2 つの順序が異なるのは、補助面の文字と U+E000..U+FFFF の範囲の文字が混在するキーの場合だけです。

概要:

1. キーを Unicode のコードポイントで辞書順に並べる
2. 簡潔な形式（空白なし）
3. 整数のみ。解析後に判断する（`1.0`、`1e2`、`1.00` は受け入れ、`0.1`、`NaN`、`Infinity` は拒否）
4. `null` はキーとともに保持する。配列は `null` を位置どおりに保持する
5. `undefined`（TypeScript のみ）: オブジェクトでは省略し、配列では `null` としてシリアライズする
6. フィールドの除外なし（SignedPayload エンベロープ）
7. 署名されるバイト列: `UTF8(context_tag) || 0x00 || canonical(payload)`

境界ケースの受け入れ表と、4 つの SDK すべてが通過しなければならないテストフィクスチャを含む完全な規範的プロファイルは、[`spec/CANONICALIZATION_PROFILE.md`](CANONICALIZATION_PROFILE.md) にあります。このプロファイルで作成された bundle は、bundle マニフェストの省略可能なフィールド `canonicalization_profile: "dcp-jcs-v1"` でそれを宣言します。

---

<a id="16-wire-formats"></a>

## 16. ワイヤーフォーマット

<a id="161-json-default"></a>

### 16.1 JSON（既定）

`Content-Type: application/json`

<a id="162-cbor-optional"></a>

### 16.2 CBOR（省略可能）

`Content-Type: application/cbor` — RFC 8949 の決定的エンコーディング。JSON より 30〜40% 小さい。

---

<a id="17-backward-compatibility"></a>

## 17. 後方互換性

```
V1 Verifier + V1 Bundle  ->  PASS (unchanged)
V1 Verifier + V2 Bundle  ->  REJECT "unsupported dcp_version 2.0"
V2 Verifier + V1 Bundle  ->  PASS (when allow_v1_bundles=true)
V2 Verifier + V2 Bundle  ->  PASS (full V2 verification)
```

V2 の検証者は V1 に無期限に対応しなければなりません（MUST）。移行は段階的に行われます。

---

<a id="18-verification-pipeline"></a>

## 18. 検証パイプライン

1. ワイヤーフォーマットのデコード（JSON または CBOR）
2. スキーマの検証（V1/V2 の振り分け）
3. セッション nonce の一貫性
4. マニフェストの完全性（成果物のハッシュの再計算）と、署名済みの `session_issued_at` と `session_expires_at` によるセッションの期間
5. 成果物間の一貫性: パスポートのステータス、RPR の有効期限、成果物と監査証跡を通じて単一のプリンシパル、エージェント、意図（VERIFICATION.md V2-14）
6. 署名済みの意図とポリシー決定からのセキュリティ階層の計算（§14.2）
7. 勧告に基づくアルゴリズムの拒否
8. 複合署名の検証（並列）: bundle の署名は RPR の `binding_keys` で、エージェントの成果物はパスポートの `keys` で検証し、各 kid はその鍵から導出する
9. 実効的なモード、すなわちポリシーのモードと階層のモードのうち厳しい方（§14.3）による、bundle の署名とすべての成果物の署名への検証者ポリシーの適用
10. 監査ハッシュチェーンの検証
11. PQ チェックポイントの検証: 列挙されたチェックポイントのみを対象とし、それぞれが自らの監査エントリーを対象とし、エージェントが署名していること
12. 鍵の有効性の確認（有効期限、失効、kid の導出）
13. 検証キャッシュの参照と保存（§14.5）

---

<a id="19-threat-model"></a>

## 19. 脅威モデル

| 脅威 | 緩和策 |
|---|---|
| 量子攻撃者（Shor のアルゴリズム） | 複合署名の ML-DSA-65 |
| いま収集して後で復号する攻撃 | ハイブリッドの複合署名（古典が破られても PQ は有効） |
| 剥ぎ取り攻撃 | 複合バインディング（PQ が古典署名を対象に署名） |
| 成果物間のリプレイ | ドメイン分離のコンテキストタグ |
| セッションのつなぎ合わせ | session_nonce + bundle マニフェスト |
| ポリシーの引き下げ | 検証者が決定権を持つポリシー + 階層を引き下げないルール |
| 鍵の混同や乗っ取り | 決定的な kid + 所持証明 |
| アルゴリズムの破綻（PQ） | 暗号アジリティ + SLH-DSA-192f の予備 + 勧告の仕組み |
| 正規化の悪用 | 整数のみのスキーマ、浮動小数点の禁止 |
| 鍵の盗難 | HSM/TPM、短期の証明書、所持証明を伴う鍵のローテーション |
| データベースの改ざん | ハッシュチェーン + Merkle ルート + ブロックチェーンへのアンカリング |
| 個人情報の露出 | ブラインド化された RPR のモード |
| 鍵の紛失 | M-of-N のソーシャルリカバリー（Shamir SSS） |
| 階層の回避 | 検証者による階層の引き上げ。エージェントは引き下げられない |
| プリンシパルを名乗るエージェント（公開済みの署名付き RPR の再利用） | bundle の署名は RPR の `binding_keys` によるものだけで、パスポートのハッシュにコミットする。他人の `human_id` で発行された RPR を止められるのは、プリンシパルの鍵を固定または証明する検証者だけ |
| 一貫しないが正しく署名された成果物 | 成果物間の一貫性の確認（VERIFICATION.md V2-14） |
| 確認を誘導する署名なしのメタデータ | マニフェストで署名されたセッションの開始。署名者ブロックは署名と矛盾してはならない |

---

<a id="20-conformance-requirements"></a>

## 20. 適合性の要件

### 20.1 MUST

- すべての V2 成果物に、複合バインディングによるハイブリッド署名
- すべての署名にドメイン分離
- bundle 内のすべての成果物にセッション nonce
- 整数のみの数値フィールド
- 決定的な kid の導出
- すべての PQ プロバイダーについて NIST KAT による検証
- すべての V2 bundle について、セキュリティ階層の計算（§14.2）と、引き下げないルールによる強制（§14.3）

### 20.2 SHOULD

- 本番環境での秘密鍵の保管に HSM/TPM
- 二重ハッシュチェーン（SHA-256 + SHA3-256）
- 高スループットの導入では CBOR のワイヤーフォーマット
- 失効リストの代わりに短期の証明書（TTL 24 時間）
- 勧告の定期的な取得（毎日）

### 20.3 MAY

- CBOR + gzip 圧縮
- 署名の並列検証
- PQ を先に確認して早期に失敗させる検証戦略
- 監査証跡の圧縮
- 階層に応じた TTL での検証結果のキャッシュ（§14.5）

---

<a id="21-references"></a>

## 21. 参考文献

- FIPS 203: ML-KEM（モジュール格子ベースの鍵カプセル化メカニズム）
- FIPS 204: ML-DSA（モジュール格子ベースのデジタル署名アルゴリズム）
- FIPS 205: SLH-DSA（ステートレスなハッシュベースのデジタル署名アルゴリズム）
- RFC 8032: Edwards-Curve Digital Signature Algorithm (EdDSA)
- RFC 8785: JSON Canonicalization Scheme (JCS)
- RFC 8949: Concise Binary Object Representation (CBOR)

---

*DCP-AI v2.0 規範仕様 終わり*

<a id="implementation-notes-informative"></a>

## 実装に関する注記（参考）

> **2026 年 10 月 25 日に追加。規範的ではありません。** これらの注記は要件を加えず、上の内容を何も変えません。`main` のリファレンスの
> コードがこの文書とどう関係するかを説明するものです。食い違う場合は、上の規範的な本文がそのまま有効です。

- **§5.1 と §7.1、剥ぎ取り。** SDK の検証者では、存在するのに検証に失敗する PQ 署名は、どのモードでも拒否されます。
  PQ 署名を取り除き、バインディングを `classical_only` に付け替えた bundle は、実効的なモードが `classical_only`
  または `hybrid_preferred` の場合に受け入れられ（`hybrid_preferred` では警告付き）、`hybrid_required` と `pq_only`
  では拒否されます（[VERIFICATION.md](VERIFICATION.md) V2-7 から V2-9）。
- **§7.3、`pq_only`。** SDK の検証者は、引き続き古典署名のバイト列を伴う `pq_over_classical` のバインディングを
  前提とします。PQ 署名がそれを対象に含むため、`pq_only` でも古典の構成要素を省くことはできません。
- **§6、SignedPayload。** エンベロープは bundle の 4 つの主要な成果物（パスポート、RPR、意図、ポリシー決定）を
  包みます。DCP-05 から DCP-09 の記録は署名をオブジェクトの内側に持ち、通常は `composite_sig` です。ルートの
  委任マンデートは `human_composite_sig` を、サブマンデートは `delegator_composite_sig` を持ちます（DCP-09 §3.5）。
- **§9 と §15、正規化。** `dcp-jcs-v1` が唯一の規範的プロファイルであり、既定です。
  [docs/proposals/canonicalization-candidate](../docs/proposals/canonicalization-candidate/README.md) の候補プロファイル
  は実験的なオプトインの API からしか使えず、既定の検証者が受け入れるものを変えません。
- **§10、監査証跡。** 監査エントリーは 1 件ずつ署名されるのではなく、マニフェストを通じて bundle の署名の対象に
  なります。`DCP-AI.v2.AuditEvent` のコンテキストは PQ チェックポイントと監査の圧縮に使われ、それらは呼び出し側が
  SDK のヘルパーで作成します。自動的に署名するものはありません。検証者は列挙されたチェックポイントと SHA-256 の
  チェーンを確認します。未公開のソースコード（2026 年 10 月 27 日）では、存在する副の SHA3-256 のフィールドも確認しますが（V2-11 の正誤）、公開済みのパッケージは確認しません。
- **§11.3、緊急失効。** RPR のスキーマには `revocation_token` がありません。V2 のパスポートには省略可能な
  `emergency_revocation_token` があります。
- **§12.1、消去。** 本文はソルトを削除することの暗号学的な効果を述べたものです。GDPR やその他の法律への準拠を
  評価したものではありません。[docs/EU_AI_ACT_MAPPING.md](../docs/EU_AI_ACT_MAPPING.md) を参照してください。
- **§13、勧告。** リファレンスサーバーが公開された勧告を自らのポリシーに適用するのは、オペレーターが
  `POST /v2/advisory/auto-apply` を呼び出したときだけです。勧告の `composite_sig` は構造しか確認せず、自動的な
  定期取得もありません。
- **§14.1、サイズとレイテンシー。** bundle のサイズとレイテンシーの列は説明用であり、`main` のコードの測定値では
  ありません。測定方法は [docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md) で説明しています。
- **§1.1 と §19、アンカリング。** リファレンスのアンカーサービスは記録をローカルに保持し、チェーンには何も
  送信しません（[docker/README.md](../docker/README.md)）。
- **§16、ワイヤーフォーマット。** CBOR は TypeScript SDK だけにある省略可能なエンコーダー・デコーダーであり、
  リファレンスサーバーは JSON の本文しか読みません。30–40% というサイズの数値は、このリポジトリのどの測定にも
  裏付けられていません。`api/proto/dcp.proto` は定義であり、このリポジトリにそれを実装した gRPC のサーバーや
  クライアントはありません。
- **§17、後方互換性。** 表は結果を示すもので、単一の入口を示すものではありません。SDK の `verifySignedBundleV2`
  が検証するのは V2 の bundle だけです。`allow_v1_bundles` を読むのはリファレンスサーバーとアドミッションの
  プロファイルで、ルートの `verifySignedBundle`（`lib/verify.js`）はそれを読まずに V1 の bundle を V1 の確認に
  回します。
- **§18、パイプライン。** `verifySignedBundleV2` は JSON Schema による検証（ステップ 2）を行いません。
  `lib/verify.js` とサーバーが、それを呼び出す前に行います。TypeScript SDK がエクスポートする検証キャッシュ
  （ステップ 13）も使わず、ステップ 12 は bundle にある鍵のステータスを読みます。失効サービスへの問い合わせは
  アドミッションの役割です（[docs/ADMISSION.md](../docs/ADMISSION.md)）。検証は、アドミッション、信頼、認可では
  ありません。
