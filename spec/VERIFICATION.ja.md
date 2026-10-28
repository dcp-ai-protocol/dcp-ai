<sub>[English](VERIFICATION.md) · [中文](VERIFICATION.zh-CN.md) · [Español](VERIFICATION.es.md) · **日本語** · [Português](VERIFICATION.pt-BR.md)</sub>

<a id="verification-checklist--signed-bundle"></a>
<a id="verification-checklist-signed-bundle"></a>

# 検証のチェックリスト — Signed Bundle

> [英語の仕様](VERIFICATION.md)の参考訳です（28/10/2026 更新）。**規範となるのは英語版です**。この翻訳に規範的な効力はなく、内容が異なる場合は英語版が優先されます。識別子とコードブロックは翻訳せずにそのまま掲載しています。

すべての手順は**ローカル**で、API やサーバーの呼び出しは必要ありません。検証器に必要なのは Signed Bundle だけです（省略可能ですが、ピア、ファイル、アンカーされたリストから得た、署名された RevocationRecord の集合も使えます）。

<a id="normative-checklist"></a>

## 規範的なチェックリスト

Signed Bundle を検証するときは、次を順に行います：

1. Signed Bundle と内側の Citizenship Bundle を、`schemas/v1/signed_bundle.schema.json` と `schemas/v1/citizenship_bundle.schema.json` に照らして**スキーマで検証**します（または、内側のバンドルに `dcp validate-bundle` を使い、署名付きの包みをスキーマで検証します）。

2. **署名を検証します：**  
   - `bundle_hash` = SHA-256(canonical(bundle)) を再計算し、`signature.bundle_hash` と比べます（一致しなければならない。たとえば `sha256:<hex>`）。  
   - 正規のバンドルに対して、`signature.signer.public_key_b64` で `signature.sig_b64` を検証します（Ed25519 の分離署名）。  
   - この手順には `dcp verify-bundle <signed.json> <public_key.txt>` を使います。

3. **RPR を検証します：** 期限切れでないこと — `responsible_principal_record.expires_at` が `null` か、未来の ISO 8601 の日時であること。省略可能：記録が署名付きで保存されていれば、RPR の署名を検証します。

4. **AP を検証します：** `agent_passport.status` = `"active"`。省略可能：署名者や agent_id を、**署名された RevocationRecord のローカルの集合**（ピア、ファイル、アンカーされたリストから）に照らして確認します。中央の API は使いません。

5. **intent_hash を検証します：** `bundle.audit_entries` の各 AuditEntry について、`intent_hash` は SHA-256(canonical(intent))（16 進）に等しくなければなりません（MUST）。ここで意図は、そのエントリーの `intent_id` で特定されるバンドルの中の意図です（通常はバンドルのただ 1 つの `intent`）。`dcp intent-hash <intent.json>` か、リファレンスの `intentHash()` ヘルパーを使います。

6. **監査チェーンを検証します：**  
   - 最初のエントリー：`prev_hash` = `"GENESIS"`。  
   - インデックス n（n ≥ 1）の以降の各エントリー：`prev_hash` は SHA-256(canonical(entry_{n-1}))（16 進）に等しくなければなりません（MUST）。

7. **省略可能 — merkle_root：** `signature.merkle_root` が存在する（null でない）場合、それが `bundle.audit_entries` の Merkle ルートに等しいことを検証します（たとえば内側のバンドルに `dcp merkle-root`）。

8. **省略可能 — anchor_receipt：** バンドルとともに anchor_receipt（たとえばチェーン、tx_id、ブロックの参照）が与えられた場合、**公開のデータだけ**を使って（たとえば公開のブロックエクスプローラーやノードからトランザクションを取得して）、指定されたチェーンやログのインデックスに `bundle_hash` があることを検証します。中央のサーバーは関与せず、検証は公開のデータだけを使います。

9. **省略可能 — 管轄区域の失効のリスト：** 検証器がエージェントの管轄区域（`responsible_principal_record.jurisdiction` に基づく）の署名された失効のリストにアクセスできる場合、リストを取得するかキャッシュしたものを使い、発行者の Ed25519 の署名を検証し、バンドルの `agent_passport.agent_id`（または署名者）をリストのエントリーと照らします。見つかれば、エージェントは失効しており、検証は失敗します。リストの形式と well-known の URL の慣習は [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md) を参照してください。

10. **省略可能 — 管轄区域の証明：** バンドルが `JurisdictionAttestation` のオブジェクトを含む（またはそれを伴う）場合、証明者の公開鍵で、`rpr_hash` に対する証明の署名を検証します。証明者の公開鍵は、管轄区域が公開する well-known の URL（たとえば `https://<authority>/.well-known/dcp-attestation-keys.json`）から得られます。証明のオブジェクトの形式は [DCP-01.md](DCP-01.md) を参照してください。

11. **省略可能 — 透明性ログの証明：** 保持者がログへの包含の証明（`log_url`、`log_index`、`merkle_proof`）を与えた場合、ログの署名されたルートにおける `bundle_hash` の Merkle 包含を検証します。ログのルートがオンチェーンでアンカーされていれば、省略可能ですがアンカーも検証します。ログの API と証明の形式は [docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md) を参照してください。

---

<a id="v2-verification-checklist"></a>

## V2 の検証のチェックリスト

V2 の Signed Bundle（`dcp_bundle_version: "2.0"`）を検証するときは、次の手順を行います。これらは、複合署名の検証、セッションの結び付け、マニフェストの完全性で V1 のチェックリストを拡張するものです。

リファレンスの実装：`dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]`（または `lib/verify.js` の `verifySignedBundle`）。スキーマを検証し、暗号の確認を `@dcp-ai/sdk` の `verifySignedBundleV2` に委ねます。省略可能な公開鍵は、クラシカルの署名者を固定します。

<a id="step-v2-1-detect-version"></a>

### 手順 V2-1：バージョンを判別する

`bundle.dcp_bundle_version` を調べます。`"2.0"` ならこの V2 のチェックリストを使います。ないか `"1.0"` なら、上の V1 のチェックリストを使います。

<a id="step-v2-2-schema-validate"></a>

### 手順 V2-2：スキーマで検証する

Signed Bundle を `schemas/v2/signed_bundle.schema.json` に照らして検証します。これは内側のバンドルを定義し、`bundle_manifest`、`signed_payload`、`audit_entry`、`pq_checkpoint` を参照します。各 `SignedPayload.payload` を、そのアーティファクトのスキーマ、つまり `schemas/v2/` の `responsible_principal_record`、`agent_passport`、`intent`、`policy_decision` に照らして検証します。

<a id="step-v2-3-validate-manifest"></a>

### 手順 V2-3：マニフェストを検証する

バンドルは、次の必須のフィールドを持つ `manifest` のオブジェクトを含まなければなりません（MUST）：

- `session_nonce` — 64 文字の 16 進の文字列
- `rpr_hash`、`passport_hash`、`intent_hash`、`policy_hash` — それぞれのアーティファクトの SHA-256 ハッシュ
- `audit_merkle_root` — 監査エントリーの Merkle ルート
- `audit_count` — 監査エントリーの数の整数

各アーティファクトのハッシュを、対応する `payload` の正規の表現から再計算し、それがマニフェストの値とアーティファクト自身の `payload_hash` に一致することを検証します。マニフェストのハッシュがない場合、またはペイロードがないか正規化できない場合、検証は失敗します。

監査証跡をマニフェストに結び付けます：`audit_count` は `audit_entries` の数に等しく、`audit_merkle_root` はそれらから再計算した Merkle ルートに等しく、最初のエントリーの `prev_hash` は `GENESIS` で、以降の各エントリーの `prev_hash` は直前のエントリーのハッシュでなければなりません（MUST）。空の監査証跡のルートは `sha256:` の後に 64 個のゼロが続くもので、マニフェストのスキーマのパターンはそれを認めます。監査エントリーがゼロでも受け入れるバンドルのビルダーはその値を書きます（Go の `BuildBundleV2` と、`wasm` のフィーチャーの `wasm_build_bundle` が呼ぶ Rust の `build_bundle_v2` は書きます。TypeScript と Python のビルダーは少なくとも 1 つのエントリーを求めます）。PQ のチェックポイントに使われる、すべての SDK の `auditEventsMerkleRoot` のヘルパーは、代わりに空のリストを拒否します。

<a id="step-v2-4-verify-session-nonce-consistency"></a>

### 手順 V2-4：セッションの nonce の一貫性を検証する

すべてのアーティファクト（`responsible_principal_record.payload`、`agent_passport.payload`、`intent.payload`、`policy_decision.payload`）と、`session_nonce` のフィールドを含むすべての `audit_entries` は、`manifest.session_nonce` と同じ nonce を共有しなければなりません（MUST）。

`manifest.session_expires_at` が存在し、すでに過ぎていれば、バンドルを拒否します。

`manifest.session_issued_at` は、存在する場合、セッションが始まった時刻で、マニフェストのほかの部分とともに署名されています。それが RFC 3339 のタイムスタンプでない場合、検証の時刻より 30 秒を超えて後である場合（[DCP-04](DCP-04.md) も認める時計のずれ）、または `session_expires_at` より後である場合は、バンドルを拒否します。検証器のポリシーの `max_session_duration_seconds` は、`session_expires_at` から `session_issued_at` を引いた値の上限を定めます。そのようなポリシーのもとでは、どちらかを欠くバンドルは拒否され、署名されていない時刻から測られたり、終わらないセッションとして扱われたりすることは決してありません。`session_issued_at` ができる前に署名されたバンドルは、セッションの最大期間のないポリシーのもとでは以前どおり検証を通りますが、最大期間のあるポリシーのもとでは拒否され、署名し直さなければなりません。

`composite_sig` の外にある `signature` のブロック（`hash_alg`、`created_at`、`signer`、`manifest_hash`）は署名されていません。誰でも署名を壊さずにそれを変えられます。それは、かつて `created_at` がセッションの開始についてそうしたように、署名されたデータの代わりになってはなりません（MUST NOT）。また、署名されたものと矛盾してもなりません（MUST NOT）：`signer.id` は RPR の `human_id`、`signer.kids` は `composite_sig` の kid（クラシカルのもの、そして存在すれば PQ のもの）、`manifest_hash` は `sha256:` の後に正規のマニフェストの SHA-256 が続くもの、`hash_alg` は `sha256` か `sha256+sha3-256` です。

これらの確認のタイムスタンプ（ここでは `session_expires_at`、手順 V2-13 では鍵の `expires_at`）は、`Z` または `±hh:mm` のオフセットを持つ RFC 3339 の日時で、たとえば `2026-10-22T06:05:03-05:00` です。文字列としてではなく、ミリ秒の精度で（ミリ秒より下の桁は切り捨て）瞬間として比べてください。オフセットの異なる 2 つのタイムスタンプの文字列の順序は、その時間の順序ではありません。0000 年から 9999 年まですべて有効です。ないか `null` なら期限なしを意味します。そのようなタイムスタンプでない値（時刻のない日付、オフセットのない時刻、ありえない日付や時刻、文字列でないもの）は拒否しなければなりません（MUST）。`tests/interop/v2/interop_vectors.json` の `rfc3339` のカテゴリーは、受け入れる各ケースの瞬間と、拒否されるケースを挙げています。

<a id="step-v2-5-verify-composite-signature-structure"></a>

### 手順 V2-5：複合署名の構造を検証する

バンドルの `signature` は、次を持つ `composite_sig` のオブジェクトを含まなければなりません（MUST）：

- `classical` — `alg`、`kid`、`sig_b64` を持つオブジェクト
- `binding` — `pq_over_classical`、`classical_only` のいずれか（`schemas/v2/composite_signature.schema.json`）
- `pq` — （binding が `pq_over_classical` なら必須）`alg`、`kid`、`sig_b64` を持つオブジェクト

バンドルの署名、アーティファクトの署名、チェックポイントの署名にあるすべての `sig_b64` は、正規の base64（RFC 4648 § 4：パディングあり、末尾のビットはゼロ、ほかの文字なし）でなければなりません（MUST）。こうしてすべての検証器が同じバイト列を復号し、署名の符号化は 1 つになります。そうでなければバンドルを拒否します。

<a id="step-v2-6-verify-classical-signature"></a>

### 手順 V2-6：クラシカルの署名を検証する

署名されたメッセージを再構成します：`context_tag || 0x00 || canonical(manifest)`。ここで `context_tag` は `"DCP-AI.v2.Bundle"` です。`composite_sig.classical.sig_b64` を、`composite_sig.classical.kid` で特定される公開鍵に照らし、`composite_sig.classical.alg` で指定されたアルゴリズム（通常は Ed25519）で検証します。

バンドルの署名者は責任を負うプリンシパルです。kid は RPR の `binding_keys` の中だけで探します。`passport_hash` を約束するマニフェストに対するプリンシパルの署名が、このエージェントとその鍵をプリンシパルに結び付けます。エージェントは自分のパスポートに自分で署名するため、パスポートにだけ挙げられた鍵がバンドルの署名を検証してはなりません（MUST NOT）。さもなければ、誰でも、公開された署名付きの RPR を、自分のパスポートと鍵と組み合わせることができてしまいます。

これはエージェントを、RPR の `binding_keys` を持つ者に結び付けます。それが誰かは証明しません。誰でも、任意の `human_id` と自分の鍵で RPR を作れます。プリンシパルのアイデンティティを必要とする検証器は、その鍵を固定する（`dcp verify-bundle` が公開鍵でするように）か、管轄区域の証明を確認するか、信頼する情報源からそれらを解決します。

<a id="step-v2-7-verify-pq-signature-if-present"></a>

### 手順 V2-7：PQ の署名を検証する（存在する場合）

`composite_sig.binding` が `pq_over_classical` なら：

1. PQ の署名されたメッセージを再構成します：`context_tag || 0x00 || canonical(manifest) || classical_sig_bytes`
2. `composite_sig.pq.sig_b64` を、RPR の `binding_keys` の中で `composite_sig.pq.kid` によって特定される公開鍵に照らし、PQ のアルゴリズム（たとえば ML-DSA-65）で検証します。

存在する PQ の署名は、`hybrid_preferred` と `classical_only` を含むすべてのモードで検証を通らなければなりません（MUST）。無効なものは検証を失敗させます。

binding が `classical_only` なら、PQ の署名はありません。これは実効のモード（手順 V2-9）によっては受け入れてもかまいません（MAY）：`hybrid_preferred` は警告付きで受け入れ、`hybrid_required` と `pq_only` は拒否します。

<a id="step-v2-8-verify-per-artifact-composite-signatures"></a>

### 手順 V2-8：アーティファクトごとの複合署名を検証する

各アーティファクト（`responsible_principal_record`、`agent_passport`、`intent`、`policy_decision`）は、それ自身の `composite_sig` を持つ `SignedPayload` のエンベロープに包まれています。各アーティファクトの複合署名を、手順 V2-6 と V2-7 と同じ方法で、アーティファクトの種類ごとに適切なコンテキストのタグを使って検証します。プリンシパルは `binding_keys` で RPR に署名し、エージェントはパスポートの `keys` でパスポート、意図、ポリシー判断に署名します。

<a id="step-v2-9-compute-the-security-tier-and-the-effective-mode"></a>

### 手順 V2-9：セキュリティティアと実効のモードを計算する

[DCP-AI-v2.0.md § 14.2](DCP-AI-v2.0.md) のとおり、`intent.payload` と `policy_decision.payload` からセキュリティティアを計算します。`risk_score` はポリシー判断から取り、決して意図からは取りません。`action_type`、`estimated_impact`、`data_classes` の値がない、型が誤っている、または未知である場合、またはポリシー判断の `risk_score` がないか 0 から 1000 の整数でない場合は、フェイルクローズして `elevated` になります。`intent.security_tier` はティアを上げることしかできません。

実効のモードは、ポリシーのモード（`default_mode`、またはパスポートの `risk_tier` に対する `risk_overrides` の項目）とティアのモードのうち厳しい方です：`routine` → `classical_only`、`standard` → `hybrid_preferred`、`elevated` と `maximum` → `hybrid_required`、順序は `classical_only` < `hybrid_preferred` < `hybrid_required`。`pq_only` のポリシーは `pq_only` のままです。解決したティアを結果とともに報告します。

<a id="step-v2-10-enforce-verifier-policy"></a>

### 手順 V2-10：検証器のポリシーを適用する

実効のモード（手順 V2-9）と検証器のポリシーの設定を、バンドルの署名とすべてのアーティファクトの署名（手順 V2-6 から V2-8）に適用します：

- 実効のモードが `hybrid_required` なら、binding が `classical_only` のバンドルを拒否する。
- 実効のモードが `pq_only` なら、PQ の署名のないバンドルを拒否する。
- `accepted_classical_algs` と `accepted_pq_algs` を確認する — バンドルがこれらのリストにないアルゴリズムを使っていれば拒否する。
- `advisory_rejected_algs` を確認する — バンドルが有効なアドバイザリーでブロックされたアルゴリズムを使っていれば拒否する。

したがって、`initiate_payment` の意図を持つ `classical_only` のバンドルは、そのパスポートが `risk_tier: "low"` を宣言していても拒否されます。

<a id="step-v2-11-verify-dual-hash-audit-chain-if-present"></a>

### 手順 V2-11：二重のハッシュの監査チェーンを検証する（存在する場合）

監査エントリーが `prev_hash_secondary` を含む場合、二次のハッシュチェーンを検証します：

- 最初のエントリー：`prev_hash_secondary` = `"GENESIS"`
- 以降のエントリー：`prev_hash_secondary` = SHA3-256(canonical(previous_entry))

> **正誤（27/10/2026、規範的）。** 上の手順と二次フィールドを明確にするもので、ハッシュ、正規化、その他の手順は変えません。
>
> - 各二次フィールドは任意（OPTIONAL）で、存在する場合にだけ確認されます。`hash_alg` によってどれかが必須になることはありません。
> - `prev_hash_secondary`：最初のエントリーでは、存在する場合、リテラル `"GENESIS"` でなければなりません（MUST）。それ以降の
>   エントリーでは、存在する場合、バンドルに含まれているとおりの直前のエントリーの `dcp-jcs-v1` バイト列の SHA3-256 を小文字の
>   16 進数で表したものに `sha3-256:` を付けた値でなければなりません（MUST）。直前のエントリーが自身の二次フィールドを持つか
>   どうかは問いません。これを省略したエントリーは不整合ではありませんが、一部のリンクを省略したバンドルは完全な二次チェーンを
>   持ちません。
> - `intent_hash_secondary` は、存在する場合、インテントのペイロードの `dcp-jcs-v1` バイト列の SHA3-256 に `sha3-256:` を付けた
>   値でなければなりません（MUST）。
> - `audit_merkle_root_secondary` は、マニフェストに存在する場合、`audit_merkle_root` と同じ方法（各エントリーの `dcp-jcs-v1`
>   バイト列を葉とし、32 バイトのダイジェストを連結したものをペアとし、奇数の層では最後のノードを複製し、バンドルの順序に
>   従う）で計算した監査エントリーの SHA3-256 マークルルートに `sha3-256:` を付けた値でなければならず（MUST）、空の記録では
>   `sha3-256:` に 64 個のゼロを続けた値です。
> - 存在する値が `null` または文字列でない場合、検証は失敗します。ハッシュが期待される箇所では、値は `sha3-256:` に小文字の
>   16 進数 64 桁を続けたもので、計算値と等しくなければなりません（MUST）。それ以外に認められる値は、最初のエントリーの
>   `prev_hash_secondary` のリテラル `"GENESIS"` だけです。

<a id="step-v2-12-verify-pq-checkpoints-if-present"></a>

### 手順 V2-12：PQ のチェックポイントを検証する（存在する場合）

マニフェストが `pq_checkpoints` を挙げているか、バンドルがチェックポイントを持っている場合、それらを検証します：

1. バンドルは、マニフェストが挙げるチェックポイントを、`checkpoint_id` ごとに 1 回ずつ、ちょうど持っていなければなりません（MUST）。挙げられているのに欠けているチェックポイント、またはマニフェストが挙げていないのに持っているチェックポイントは、検証を失敗させます。マニフェストは署名されていますが、チェックポイントの本体は署名されていません。
2. チェックポイントの `event_range` は、`audit_id` が `from_audit_id` のエントリーから `audit_id` が `to_audit_id` のエントリーまでの、`count` 個の連続した `audit_entries` を指します。その `merkle_root` は、`sha256:` の後に、`auditEventsMerkleRoot` が計算するのと同じように計算したそれらのエントリーの Merkle ルートが続くものでなければなりません（MUST）。
3. その `composite_sig` はエージェントのものです。パスポートの `keys` で、`DCP-AI.v2.AuditEvent` のコンテキストのもとで、`composite_sig` を除いた正規のチェックポイントに対して検証します。クラシカルと PQ の両方の署名が存在し、有効でなければなりません（MUST）（`pq_only` のモードでは PQ のもの）。チェックポイントは PQ の署名を運ぶために存在します。
4. その `session_nonce` はマニフェストのものでなければなりません（MUST）。

<a id="step-v2-13-key-validity-checks"></a>

### 手順 V2-13：鍵の有効性の確認

複合署名（バンドルのもの、各アーティファクトのもの、各チェックポイントのもの）で参照される各鍵の識別子（`kid`）について：

- kid は、署名を検証する鍵から導出されたものでなければなりません（MUST）：`kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key))[0:32]`。`alg` と `raw_public_key` はその鍵のエントリーから取ります。そうでなければバンドルを拒否します。こうして kid は、どのリストにあっても 1 つの鍵を指します。この確認がなければ、鍵のリストが、ほかの当事者の kid を自分の鍵のために主張できてしまいます。
- その鍵の `public_key_b64` は、すべての検証器が同じバイト列を復号できるように、正規の base64（RFC 4648 § 4、パディングありで末尾のビットはゼロ）でなければなりません（MUST）。
- 省略可能ですが、鍵の状態を失効のサービスやローカルの失効のリストに照らして確認します。

バンドルに署名できる鍵（パスポートの `keys` または RPR の `binding_keys` にあるもの）のいずれかが、`status` が `"revoked"` か `"expired"`（`schemas/v2/key_entry.schema.json` は両方を認める）であるか、`expires_at` が過ぎているか RFC 3339 のタイムスタンプでない（手順 V2-4）場合は、バンドルを拒否します。

<a id="step-v2-14-cross-artifact-consistency"></a>

### 手順 V2-14：アーティファクト間の一貫性

署名は各アーティファクトに誰が署名したかを証明します。これらの確認は、アーティファクトが、1 つのプリンシパルのための、1 つのエージェントによる、1 つの行動を記述するようにします。RPR、パスポート、`intent_hash` についての V1 の確認を V2 に引き継ぐものです。次の場合はバンドルを拒否します：

- `agent_passport.status` が `active` でも `declining` でもない：`commissioned`、`suspended`、`revoked`、`decommissioned` のエージェントは行動しない（[DCP-05](DCP-05.md) § 3.1）；
- RPR の `expires_at` が過ぎているか、RFC 3339 のタイムスタンプでない（手順 V2-4）。`null` は期限切れにならない；
- `agent_passport.principal_binding_reference` が RPR の `human_id` でない；
- `intent.agent_id` がパスポートの `agent_id` でない、または `intent.human_id` が RPR の `human_id` でない；
- `policy_decision.intent_id` が `intent.intent_id` でない；
- 監査エントリーの `intent_id` が `intent.intent_id` でない、その `intent_hash` が意図のペイロードのハッシュ（マニフェストの `intent_hash`）でない、その `agent_id` がパスポートのものでない、またはその `human_id` が RPR のものでない；
- 監査エントリーの `policy_decision` がポリシー判断を記録していない：`approve` に対して `approved`、`escalate` に対して `escalated`、`block` に対して `blocked`。

エスカレートまたはブロックされた行動を記録したバンドルは、その有効な証拠です。ここでは判断が `approve` であることを何も求めていません。状態と期限の確認は、手順 V2-13 の鍵の確認と同じく、検証の時刻に適用されます。保管した証拠を以前の時刻の時点で検証することは、まだ定義されていません。

<a id="verification-time-and-signer-keys"></a>

### 検証の時刻と署名者の鍵

V2-1 から V2-14 のすべての時刻の比較は、1 つの検証の瞬間を使います。実装はそれを省略可能なパラメーターとして受け取り、既定はシステムの時計で、判定を特定の時刻で再現できるようにします。確認する各複合署名について、検証器は、各構成要素について解決した鍵のエントリーと、それが検証を通ったかどうか（`signer_keys`）を報告します。これはアドミッションのプロファイルが読むものです。

<a id="beyond-verification-admission"></a>

### 検証の先：アドミッション

手順 V2-1 から V2-14 は、バンドルが検証済みかどうか、つまり損なわれておらず、一貫しており、列挙する鍵で署名されているかを決めます。プリンシパルが誰かは決めません。検証済みのバンドルが検証器のすでに信頼するプリンシパルから来たかどうか、そして運用者が定める `strict-v1` の要件は、これらの手順の上に、それらを変えずに、アドミッションのプロファイル [`profiles/admission`](profiles/admission/README.md) が定義します。

---

<a id="protocol-integrity"></a>

## プロトコルの完全性

バンドルを検証する前に、検証器は自分のスキーマが正規のプロトコルと一致することを確認するべきです（SHOULD）：

```bash
dcp integrity
```

これは、各ローカルのスキーマの SHA-256 ハッシュを、[`protocol_fingerprints.json`](../protocol_fingerprints.json)（リポジトリのルートにある）の正規の指紋と照らします。いずれかのスキーマが変更されていれば（たとえばプロトコルのフォークで）、確認は失敗します。セキュリティのモデル全体は [docs/SECURITY_MODEL.md](../docs/SECURITY_MODEL.md) を参照してください。

<a id="reference"></a>

## 参照

- バンドルの形式：[BUNDLE.md](BUNDLE.md)
- 監査チェーンと intent_hash：[DCP-03.md](DCP-03.md)
- セキュリティのモデル：[docs/SECURITY_MODEL.md](../docs/SECURITY_MODEL.md)
- 保存、アンカリング、失効のリスト、透明性ログ：[docs/STORAGE_AND_ANCHORING.md](../docs/STORAGE_AND_ANCHORING.md)
- 運用者ガイド：[docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md)

<a id="implementation-notes-informative"></a>

## 実装に関する注記（参考）

> **2026 年 10 月 25 日に追加。規範的ではありません。** これらの注記は要件を加えず、上の内容を何も変えません。`main` のリファレンスの
> コードがこの文書とどう関係するかを説明するものです。食い違う場合は、上の規範的な本文がそのまま有効です。

- これらの手順を通ることは、バンドルがここで定義されたとおりに検証済みであること、つまり損なわれておらず、一貫しており、
  列挙する鍵で署名されていることを示します。エージェントやプリンシパルのアイデンティティを証明するものではなく、どの規制への
  適合も示さず、行動を認可するものでもありません。プリンシパルへの信頼はアドミッションのプロファイルの役割です（[docs/ADMISSION.md](../docs/ADMISSION.md)）。
- 省略可能な V1 の手順 8 から 11（アンカーの受領書、管轄区域の失効のリスト、管轄区域の証明、
  透明性ログの証明）は、`dcp verify-bundle`、`lib/verify.js`、SDK の検証器では実行されません。それらを
  望む検証器は自ら実行します。失効のスナップショットを読むのは、これらの手順ではなくアドミッションのプロファイルです。
- 手順 V2-11：`@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go v2.11.1、Rust `dcp-ai` 2.11.1 以降の SDK の検証器は正誤のとおり存在する二次フィールドを確認し、`lib/verify.js` も `@dcp-ai/sdk` 2.2.1 以降を解決する場合は確認します。それより前のバージョンは確認しません。それらでは、二次フィールドを持つバンドルは SHA-256 のチェーンとルートだけで検証を通り、二次のチェーンを必要とする検証器は自らそれを確認します。
- 手順 10 は証明の署名を「`rpr_hash` に対する」ものとして説明していますが、[DCP-01](DCP-01.md) は
  `signature` を除くすべてのフィールドの正規の JSON に対するものとして説明し、V2 のスキーマは `composite_sig` を使います。この注記は
  その違いを記録するもので、どちらが適用されるかを決めるものではありません。
