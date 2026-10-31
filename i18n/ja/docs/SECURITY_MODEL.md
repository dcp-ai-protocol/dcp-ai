<sub>[English](../../../docs/SECURITY_MODEL.md) · [中文](../../zh-CN/docs/SECURITY_MODEL.md) · [Español](../../es/docs/SECURITY_MODEL.md) · **日本語** · [Português](../../pt-BR/docs/SECURITY_MODEL.md)</sub>

<a id="security-model"></a>

# セキュリティモデル

> [英語版](../../../docs/SECURITY_MODEL.md)の参考訳です（31/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

偽造されたバンドルからプロトコルのフォークまで、プロトコルが攻撃からどのように守るかを説明します。

---

<a id="design-principle"></a>

## 設計原則

検証はローカルで実行できます。これにより、オペレーターは依存する実装、ポリシー、信頼情報源を自ら選べます。

- **必須の中央検証器はない。** オペレーターは独立して検証できます。ただし、共有する依存関係、信頼情報源、署名鍵の侵害は、複数のオペレーターに影響する可能性があります。
- **再現可能な入力と判断。** 実装は正規バイト列と適用される規則について一致する必要があります。同じポリシーと検証時刻で結果を比較してください。暗号アルゴリズムだけでは、パーサーの違いや実装の欠陥を防げません。
- **証拠は検査するものであり、誠実さを前提にしない。** 検証器は提示された署名と関係を確認します。正当な鍵を持つ侵害されたエージェントは、虚偽の主張や有害な意図にも署名できます。暗号学的に有効な証拠であっても、主張が真実になったり、アクションが安全になったりするわけではありません。

検証が示すのは、バンドルが改ざんされておらず、それが示す鍵で署名されているということです。その鍵を信頼するか、バンドルに基づいて行動するかは別の判断です。オペレーターの信頼済みのプリンシパルに照らしたアドミッション（[ADMISSION.md](../../../docs/ADMISSION.md)）と、オペレーター自身の承認が必要です。

セキュリティは、それぞれ異なる攻撃ベクターに対処する**保護のレイヤー**から生まれます。

[セキュリティのカバレッジマップ](conformance/SECURITY_COVERAGE.md)は、これらのレイヤーを仕様と実行可能なケースに対応付け、未検証の境界も示します。これらのケースへの合格は、明示した範囲の証拠であって、実装やデプロイに脆弱性がないという保証ではありません。

---

<a id="attack-vectors-and-protections"></a>

## 攻撃ベクターと保護

<a id="1-forged-bundle-tampered-content"></a>

### 1. 偽造されたバンドル（改ざんされた内容）

**攻撃：** 攻撃者が Signed Bundle のフィールドを変更します（例：`agent_passport.status` を `"revoked"` から `"active"` に変える）。

**保護：** V1 は正規化したバンドルに対する Ed25519 署名を検証し、バンドルのハッシュを再計算します。V2 は、アーティファクトのハッシュと監査ルートをコミットする、ドメイン分離されたマニフェストへの署名を検証し、各アーティファクトの署名と相互関係も確認します。適用するチェックリストは [VERIFICATION.md](../../../spec/VERIFICATION.md) を参照してください。

署名済みの内容を変更して古い署名を保持した場合、必要なチェックを実施すれば、アルゴリズムの安全性の仮定の下で検出できます。無意味な空白やオブジェクトのキー順のように正規化表現を保つ変更は、署名済みの内容を変えません。V2 には署名されていないラッパーメタデータもあります。これにはスキーマと整合性のチェックが適用され、署名済みの値の代わりに使ってはなりません。外側の JSON のすべてのメンバーに直接署名されているとは考えないでください。

**強度：** 暗号学的な仮定、署名鍵の保護、適用されるチェックリスト全体の正しい実装に依存します。正当な鍵を持つ署名者は別の有効な記録を作れます。検証は、その記述が真実であることを確立しません。

<a id="2-forged-identity-fake-rpr"></a>

### 2. 偽造されたアイデンティティ（偽の RPR）

**攻撃：** 攻撃者が「Google」や「米国政府」を名乗る Responsible Principal Record を作り、自分の鍵でバンドルに署名します。署名は有効ですが、アイデンティティは偽りです。

**保護：**

- **Jurisdiction Attestation**（[spec/DCP-01.md](../../../spec/DCP-01.md) を参照）：政府や認定された機関が RPR のハッシュに署名し、アイデンティティを証明します。証明を要求する検証者は、それのないバンドルを拒否します。
- **公開鍵の結び付け：** 検証者は、署名者の公開鍵が既知であること（例：その組織が公開している）を要求できます。偽の「Google」のバンドルは、Google の本物の公開鍵を持っていません。
- **透明性ログ：** 包含証明は、検証器が信頼するルートを持つログに特定のコミットメントが記録されたことを示せます。包含や不在だけでは署名者の身元は確立できません。ログには、なりすましによる署名済みの主張も記録され得ます。

**強度：** 証明を要求するかどうかによります。証明がなければ、アイデンティティは自己申告です（自己署名証明書のように）。証明があれば、アイデンティティは権威に裏付けられます。

<a id="3-stolen-signing-key"></a>

### 3. 盗まれた署名鍵

**攻撃：** 攻撃者がユーザーの秘密鍵を盗み、その名義で有効なバンドルを作ります。

**保護：**

- **失効：** 鍵の所有者（または管轄）が署名済みの RevocationRecord を公開します。失効リストを確認するすべての検証者は、侵害された鍵で署名されたバンドルを拒否します。
- **管轄の失効リスト：** 政府が、失効したエージェントの署名済みリストを既知の URL で公開します。検証者はそれを取得してキャッシュします。
- **鍵のローテーション：** 新しい鍵ペアを生成し（`dcp keygen`）、バンドルに署名し直し、古い鍵を失効させます。

**強度：** 失効の伝播と、最新の状態を取得できないときに検証者が何をするかによります。キャッシュの TTL だけでは上限になりません。盗まれた鍵は、所有者が失効を公開するまで、さらに各検証者がそれを含むリストを取得するまで使われ続けます。キャッシュしたリスト（例：TTL 1 時間）の場合、公開後の窓がおよそ 1 時間になるのは、期限どおりに更新し、リストを取得できないときはフェイルクローズする検証者だけです。古いリストを使い続ける検証者や、取得元に到達できないときに失効の確認を省く検証者には、上限がありません。strict-v1 のアドミッションのプロファイルは、作成から 300 秒以内の失効スナップショットを要求し、取得元が利用できないときは失敗します（[ADMISSION.md](../../../docs/ADMISSION.md#revocation-sources)）。

<a id="4-modified-verifier-compromised-verification-code"></a>

### 4. 改変された検証器（侵害された検証コード）

**攻撃：** 攻撃者（または不注意な実装者）が検証コードを改変し、常に `verified: true` を返してすべてのチェックを回避させます。

**保護：**

- **信頼境界。** 侵害された検証器は、そのオペレーターと、その結果に依存するクライアントに影響します。独立して実行される検証器は、その結果を引き継ぎません。ただし、共有する依存関係が侵害されると、複数のオペレーターに影響する可能性があります。
- **スキーマのフィンガープリントの確認：** `dcp integrity` は、ローカルの V1 スキーマを、ローカルの `protocol_fingerprints.json` のフィンガープリントと照合します（後述）。フィンガープリントを伴わずに変更された V1 スキーマを検出しますが、検証コードは確認しません。
- **適合性テスト：** `npm run conformance` は、正しいとわかっているフィクスチャに照らして実装を検証します。これらのフィクスチャでの結果を変えてしまう改変された実装は適合性テストに失敗しますが、フィクスチャが扱う範囲の外の変更は合格してしまうことがあります。

**強度：** 影響は、侵害されたコードがどのように配布され、誰がその結果に依存するかによって決まります。独立した検証は他の検証器への依存を限定しますが、サプライチェーンのリスクをなくすものではありません。

<a id="5-protocol-fork-the-real-threat"></a>
<a id="5-incompatible-protocol-fork"></a>

### 5. 互換性のないプロトコルのフォーク

**攻撃：** 誰かがプロトコルをフォークし、スキーマを弱め（必須フィールドを削除し、検証を緩め）、DCP との互換性を主張します。広く採用されれば、エコシステムへの信頼が損なわれます。

**保護：**

- **プロトコルのフィンガープリント：** リポジトリのルートにある `protocol_fingerprints.json` には、各 V1 スキーマファイルの SHA-256 ハッシュが含まれています。どの実装も、自分の V1 スキーマをそれと照合できます。誰かがスキーマを変更すれば、そのハッシュは変わります。
- **`dcp integrity` コマンド：** `schemas/v1/` の V1 スキーマを、ローカルの `protocol_fingerprints.json` のフィンガープリントと照合します。

  ```bash
  dcp integrity
  # ✅ PROTOCOL INTEGRITY VERIFIED — all schemas match canonical fingerprints.
  ```

- **適合性の証拠：** 信頼できる取得元から得たスキーマで `npm run conformance` に合格すれば、そのスイートが扱うケースについて一致していることが示されます。プロトコルのすべての要件やすべての入力が正しく扱われることを証明するものではないので、実装と、適用される仕様の網羅範囲もあわせて確認してください。
- **バージョンの選択：** 検証器は適用される V1 または V2 のバージョンフィールドを確認し、対応する規則を適用します。バージョンラベルは主張であって、適合性の証明ではありません。互換性のないフォークも同じラベルを保持できるため、実際の構造と挙動も確認する必要があります。

**強度：** 限定的です。フィンガープリントは、隣にあるフィンガープリントファイルと異なる V1 スキーマを検出します。そのファイル自体を認証するものではなく（署名されておらず、フォークは両方を変えられる）、V2 のスキーマを対象とせず、コードについては何も示しません。一致しても実装の認証にはなりません。実装を判断するには、信頼できる取得元から得たフィンガープリントと照合し、適合性スイートを実行してください。

<a id="6-retroactive-modification-bundle-changed-after-anchoring"></a>

### 6. 遡及的な改変（アンカー後に変更されたバンドル）

**攻撃：** 攻撃者が、ブロックチェーンにアンカーされた後、あるいは透明性ログに記録された後のバンドルを改変します。

**保護：**

- **外部へのコミットメント：** オペレーターは、バンドルに適用するコミットメントを外部の台帳や透明性ログに記録できます。自らの信頼ポリシーに従い、台帳のファイナリティを確認するか、ログのルートを認証する必要があります。
- **検証：** 検証器は指定された表現を使ってコミットメントを再計算し、記録された値と比較します。コミットされた内容への変更は、ハッシュの安全性の仮定の下で検出できます。
- **透明性ログの証明：** Merkle 包含証明は、コミットメントを特定のルートに結び付けます。包含だけでは、ログが追記専用であることや、すべての観測者に同じ履歴を示したことは証明できません。そのためには追加の整合性チェックと監視が必要です。

**強度：** ハッシュ、認証された参照コミットメント、外部システムの完全性と可用性に依存します。アンカーは、これらの仮定の下でコミットメントが記録されたことを証明します。バンドルに記述された出来事が実際に起きたことは証明しません。

---

<a id="protection-layers-summary"></a>

## 保護のレイヤー（概要）

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
  Records a public commitment, subject to the ledger's finality and trust assumptions.
```

レイヤー 1〜4 は、現在このリポジトリで利用できます。レイヤー 5 にはリファレンスサービス（`services/transparency-log/`、メモリー内）があります。レイヤー 6 は設計済みで（[docs/STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md)）、Ethereum のコントラクト（`contracts/ethereum/`）もありますが、リファレンスのアンカーサービスはまだチェーンに送信しません。本番の実装はオペレーターごとに異なります。

---

<a id="protocol-fingerprints"></a>

## プロトコルのフィンガープリント

リポジトリのルートにある `protocol_fingerprints.json` には、`schemas/v1/` の各スキーマファイルのバイト列の SHA-256 ハッシュが含まれています。形式：

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

どの実装も、どの言語、どのプラットフォームでも、自分のスキーマファイルの SHA-256 を計算し、これらのフィンガープリントと照合できます。一致すれば、その V1 スキーマファイルがフィンガープリントを取ったものとバイト単位で同一であることを意味します。そのコードが正しく検証することを証明するものではなく、フィンガープリントファイルの信頼性は、それを入手した場所の信頼性と同じです。

**ローカルで検証する：**

```bash
dcp integrity
```

---

<a id="what-the-protocol-does-not-protect-against"></a>

## プロトコルが防がないもの

- **有効なバンドルの背後にいる悪意のある人間。** DCP は、プリンシパルとの結び付けと、オペレーターの信頼設定に照らして確認する証拠を運ぶことができます。現実世界のアイデンティティを自動的に確立するものでも、プリンシパルが倫理的に行動することを保証するものでもありません。法執行と規制は暗号学的な検証の範囲外です。
- **無効なバンドルを受け入れる侵害された検証器。** 正しい検証コードを実行するのは各組織の責任です。プロトコルはフィンガープリントと適合性テストを提供しますが、それを使うのはオペレーターの責任です。
- **サービス拒否。** レート制限は API のエンドポイントごとに規定されています（[`api/openapi.yaml`](../../../api/openapi.yaml) の `x-ratelimit` を参照）。インフラレベルでの DDoS 対策はオペレーターの責任です。
- **有効なバンドルのリプレイ。** 署名済みのバンドルは再び提示できます。それを制限するものについては、[アーティファクト間のリプレイ](#9-cross-artifact-replay)を参照してください。

---

---

<a id="v20-security-enhancements"></a>

## V2.0 のセキュリティ強化

DCP v2.0 は、ポスト量子暗号、複合署名、適応型のセキュリティティア、エージェント間のセキュリティによって、セキュリティモデルを大幅に強化します。

<a id="7-post-quantum-threat-model"></a>

### 7. ポスト量子の脅威モデル

**攻撃：** 大規模な量子コンピューターを利用できる量子攻撃者（あるいは「今収集し、後で解読する」戦略）が、Ed25519 の署名と鍵交換を狙います。

**保護：**
- **ハイブリッドな複合署名：** V2 の複合署名は、Ed25519（クラシカル）と ML-DSA-65（ポスト量子、FIPS 204）を組み合わせます。PQ 署名がクラシカルな署名を覆う（`pq_over_classical` バインディング）ため、どちらか一方を破るだけでは足りません。V2 の署名は `classical_only` の場合もあり、それが受け入れられるかどうかは検証モードによります（§8）。
- **ハイブリッド KEM：** DCP-04 の鍵交換は X25519 + ML-KEM-768（FIPS 203）を使うため、どちらかのアルゴリズムが持ちこたえる限り、セッション鍵は安全なままです。SDK はこの交換を実行しません。セッション鍵は呼び出し側が導出します（[NIST_CONFORMITY.md](../../../docs/NIST_CONFORMITY.md) §2.1）。
- **二重ハッシュチェーン：** 設計では、両方のチェーンを検証することを前提に、一方のハッシュ系が侵害されても継続性を保つため、SHA-256 と SHA3-256 を並行して使います。`@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go v2.11.1、Rust `dcp-ai` 2.11.1 以降の V2 バンドルの検証器は、存在するオプションの二次のリンクと二次マークルルートを確認しますが、それらを要求はしません。それより前のバージョンはそれらを確認しません。そのため、検証に成功しても、この追加の保護があることは示されません（[STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)）。

**強度：** `hybrid_required` モード（elevated と maximum のティアのモード）で確認される署名については、NIST レベル 3 のポスト量子セキュリティです。攻撃者は、クラシカルとポスト量子の両方のアルゴリズムを破らなければなりません。

<a id="8-stripping-attacks-composite-signature"></a>

### 8. 除去攻撃（複合署名）

**攻撃：** 攻撃者が署名済みのバンドルを傍受し、ポスト量子の署名要素を取り除いて、クラシカルな署名だけを提示します。

**保護：** `pq_over_classical` のバインディングのプロトコルは次のことを保証します。
1. `classical_sig = Ed25519.sign(context || 0x00 || payload)`
2. `pq_sig = ML-DSA-65.sign(context || 0x00 || payload || classical_sig)`

PQ 署名がクラシカルな署名を覆うため、改変されたクラシカルな署名や、別のペイロードに移された PQ 署名は検証に失敗します。PQ 署名を丸ごと取り除くと `classical_only` の署名が残り、それをどう扱うかは実効モードだけが決めます。`hybrid_required`（と `pq_only`）はそれを拒否し、`hybrid_preferred` は警告付きで受け入れ、`classical_only` は受け入れます。

**強度：** `hybrid_required` モードでは暗号学的です。`hybrid_preferred` や `classical_only` のもとでは、除去は見えます（警告、`classical_only` のバインディング）が、拒否はされません。

<a id="9-cross-artifact-replay"></a>

### 9. アーティファクト間のリプレイ

**攻撃：** 攻撃者が、あるセッションの有効な意図を取り出し、別のセッションや別のバンドルでリプレイします。

**保護：**
- **ドメイン分離：** すべての署名にはコンテキストタグ（例：`DCP-AI.v2.Intent`、`DCP-AI.v2.Bundle`）が含まれます。ある種類のアーティファクトの署名を、別の種類に流用することはできません。
- **セッションの nonce：** 各バンドルには 256 ビットのランダムなセッション nonce が含まれます。マニフェストはすべてのアーティファクトをこの nonce に結び付けます。あるセッションのアーティファクトを別のセッションでリプレイすると、マニフェストのハッシュが壊れます。

nonce は、同じバンドルが再び提示されることは防ぎません。バンドル全体はそのままリプレイされます。署名済みのセッションの有効期限と署名済みの `intended_verifier`（どちらも strict-v1 のアドミッションのプロファイルが要求する）は、バンドルをどこで、どれだけの期間リプレイできるかを制限しますが、1 回限りにはしません。1 回限りの使用が必要な検証器は、消費済みの nonce やバンドルのハッシュを自分で記録します（[ADMISSION.md](../../../docs/ADMISSION.md#limits)）。

**強度：** アーティファクトの混在に対しては、暗号学的なドメイン分離 + セッションバインディング。バンドル全体のリプレイに対してではありません。

<a id="10-security-tier-downgrade"></a>

### 10. セキュリティティアの引き下げ

**攻撃：** 悪意のあるエージェントが、リスクの高い操作で PQ 署名の要件を避けるために、低いセキュリティティア（例：`routine`）を宣言します。

**保護：**
- **検証者が決めるポリシー：** 最低限のティアを決めるのは、エージェントではなく検証者です。検証者は、自分のポリシーのモードとティアのモードのうち厳しいほうで各バンドルを検証するため（仕様 §14.3）、`risk_tier: "low"` を宣言したパスポートでも、支払いの意図で `classical_only` を得ることはできません。検証者はティアを引き上げることはできますが、引き下げてはなりません（MUST NOT）。
- **ティアの自動計算：** SDK は、ポリシー判断の `risk_score` と、意図の `data_classes`、`action_type`、`estimated_impact` からティアを計算します（仕様 §14.2）。不明な値や欠落した値はフェイルクローズで `elevated` になり、エージェントは計算されたティアを引き下げられません。
- **引き下げ禁止のルール：** 意図から `elevated` が計算されたのに、エージェントが `routine` を宣言した場合、検証者は `elevated` とします。

**強度：** 検証者のレベルでのポリシーの強制。

<a id="11-a2a-session-security"></a>

### 11. A2A セッションのセキュリティ

**攻撃：** 攻撃者がエージェント間の通信セッションを傍受または乗っ取ります。

**保護：**
- **バンドルの相互検証：** セッションを確立する前に、両方のエージェントが互いのバンドルを検証します。
- **ハイブリッド KEM による鍵交換：** 一時的な鍵が前方秘匿性を提供します。長期の鍵が侵害されても、過去のセッション鍵は明らかになりません。SDK はこの交換を呼び出し側に任せています。
- **AES-256-GCM による暗号化：** セッションのすべてのメッセージは認証付き暗号で暗号化されます。
- **単調増加のシーケンス番号：** セッション内でのリプレイと順序の入れ替えを防ぎます。
- **定期的な鍵の更新：** セッションは鍵の更新が必要なときにそれを知らせ（`needsRekeying`）、新しい鍵は呼び出し側が導出します。
- **失効への対応：** 仕様では、どちらかのエージェントが失効したらセッションを終了します。SDK はセッション中の失効を監視しないため、アプリケーションがそれを確認してセッションを閉じる必要があります。

**強度：** 呼び出し側がハイブリッド交換と鍵の更新を実行する場合、ポスト量子の前方秘匿性 + 認証付き暗号。

<a id="12-lifecycle-state-manipulation-dcp-05"></a>

### 12. ライフサイクルの状態の操作（DCP-05）

**攻撃：** 悪意のある主体が、ライフサイクルの状態遷移を回避しようとします。たとえば、稼働を終了したエージェントを再び稼働させたり、データの処分手続きを避けるために「declining」の状態を飛ばしたりします。

**保護（仕様と SDK）：**
- **状態機械：** `commissioned → active → declining → decommissioned`。無効な遷移は拒否されます。
- **署名済みのライフサイクルの記録：** すべての状態遷移（稼働開始の証明書、稼働状況レポート、稼働終了の記録）は複合署名を持ち、稼働状況レポートはハッシュで連鎖しています。
- **最終的な稼働終了：** エージェントが `decommissioned` に達すると、それ以上の遷移はできません。稼働終了の記録にはデータの処分が記載されます。

**リファレンスサーバーでは：** ライフサイクルのエンドポイントは無効な遷移を拒否します（409）が、記録の署名は検証せず、認証も不要です。稼働を終了したエージェントに対する新しい稼働開始の証明書は、そのエージェントを `commissioned` にリセットします（[OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)）。

**強度：** 記録の署名が検証される場合（SDK の関数か、それを呼び出すサービスによって）、状態機械と署名済みの証跡。リファレンスサーバー単独では、どちらも得られません。

<a id="13-unauthorized-succession-dcp-06"></a>

### 13. 権限のない継承（DCP-06）

**攻撃：** 権限のない当事者が、自分が管理していないエージェントのデジタル遺言を作成したり継承を開始したりして、メモリーと権限を不正な後継者に移します。

**保護：**
- **遺言への署名：** デジタル遺言は、`agent_id` と `successor_preferences` を結び付ける複合署名を持ちます。リファレンスサーバーは、それを検証せずに遺言を保存します。
- **メモリーの分類：** メモリーの移転では、分類されたアクセスレベルを使います。後継者の権限に合うエントリだけが移転されます。
- **二重ハッシュのマニフェスト：** メモリー移転のマニフェストは、移転されるデータの改ざんを防ぐために二重ハッシュ（SHA-256 + SHA3-256）の参照を使います。

**強度：** 署名を確認する検証者にとっては、継承の権限の暗号学的な結び付け + 分類されたメモリーへのアクセス制御。

<a id="14-delegation-abuse--authority-escalation-dcp-09"></a>
<a id="14-delegation-abuse-authority-escalation-dcp-09"></a>

### 14. 委任の濫用と権限の昇格（DCP-09）

**攻撃：** 委任された権限を持つエージェントが委任の範囲を超えようとする、あるいは権限のない機能を与えるために委任状が偽造されます。

**保護：**
- **範囲を定めた委任状：** 各委任状は、明示的なドメインとアクションを持つ `authority_scope` を指定します。範囲外のアクションは拒否されます。
- **注意の閾値：** 委任のパラメーターが定めた上限（リスクスコア、金額、データの機微性）を超えると、設定可能な閾値がアラートを発するか、人間の確認を求めます。
- **プリンシパルのミラー：** `PrincipalMirror` の記録には、プリンシパルの選好の検証可能なスナップショットを格納できます。ずれを検出するには、適用される権限委任状および現在の信頼された選好と比較する必要があります。スナップショットの記録だけでは、それらを強制しません。
- **インタラクションの記録：** インタラクションは署名済みの `InteractionRecord` のエントリとして記録できます。記録するかどうかはアプリケーション次第です。

**強度：** 委任状とその署名を確認する検証者にとっては、範囲を定めた承認 + 閾値による監視 + 暗号学的な監査証跡。リファレンスサーバーは署名を検証せずに委任状を保存し、取り消し可能な委任状は誰でも失効させられます（[OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)）。

<a id="updated-protection-layers-v20"></a>

### 更新された保護のレイヤー（V2.0）

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
  Public commitment subject to the ledger's finality and trust assumptions.

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
  Records support structured escalation; resolution and enforcement remain operational decisions.

Layer 13: Rights Enforcement (DCP-08)
  Records express rights and obligations; applications must enforce the applicable decisions.

Layer 14: Delegation Control (DCP-09)
  Scoped mandates and thresholds support checks that applications must apply before acting.
```

NIST のポスト量子暗号への適合の詳細は [NIST_CONFORMITY.md](../../../docs/NIST_CONFORMITY.md) を参照してください。
V1.0 のセキュリティモデルからの移行については [MIGRATION_V1_V2.md](../../../docs/MIGRATION_V1_V2.md) を参照してください。

---

<a id="operational-security-requirements"></a>

## 運用上のセキュリティ要件

<a id="private-key-storage"></a>

### 秘密鍵の保管

| セキュリティティア | 要件 |
|---|---|
| **Routine** | 権限 0600 の鍵ファイル、保存時の暗号化（OS レベル） |
| **Standard** | パスフレーズで暗号化したキーストア（PKCS#8 など） |
| **Elevated** | HSM/TPM との統合（SHOULD）。OS のキーチェーンとの統合 |
| **Maximum** | HSM/TPM との統合（MUST）。鍵の生成にはエアギャップされたセレモニー |

このリポジトリには HSM/TPM との統合はありません。TypeScript のソースにある `HsmCryptoProvider` はシミュレーションのパターンであり、実際の証拠に使ってはなりません（[NIST_CONFORMITY.md](../../../docs/NIST_CONFORMITY.md) §2.2）。elevated と maximum の行には、独自の統合が必要です。

リファレンス CLI（`bin/dcp.js`）と Python SDK の CLI は、秘密鍵のファイルをモード `0600`（所有者は読み書き可、グループとその他は権限なし）で書き出します。インタラクティブな `@dcp-ai/cli init` はそうせず、既定の権限（通常の umask `022` では `0644`）で書き出すので、`chmod 600 .dcp/keys/*_secret.key` を実行してください。オペレーターはこれらの権限を緩めてはなりません（MUST NOT）。

<a id="revocation-propagation-slas"></a>

### 失効の伝播の SLA

| セキュリティティア | 許容される最大の遅延 |
|---|---|
| **Routine** | 24 時間 |
| **Standard** | 1 時間 |
| **Elevated** | 15 分 |
| **Maximum** | 即時（プッシュ通知 + OCSP のようなステープリング） |

これらはオペレーター向けの目標です。リポジトリにはプッシュ通知もステープリングもありません。最も近いのは strict-v1 のアドミッションのプロファイルで、作成から 300 秒以内の失効スナップショットを要求します。オペレーターは、対応する最も高いティアに合わせて失効リストのキャッシュの TTL を設定し、リストを取得できないときはフェイルクローズすべきです（SHOULD）。

<a id="api-security"></a>

### API のセキュリティ

すべての本番デプロイは、次のことをしなければなりません（MUST）。
- TLS 1.3 を強制する（最低でも TLS 1.2）
- データを変更するすべてのエンドポイントで認証を要求する（Bearer トークンまたは API キー）
- `openapi.yaml` の `x-ratelimit` の仕様に従ってレート制限を設定する
- セキュリティヘッダーを設定する：`Strict-Transport-Security`、`Content-Security-Policy`、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`
- CORS を信頼できるオリジンだけに制限する
- 検証のレスポンスには `Cache-Control: no-store` を使う

<a id="v1-to-v2-downgrade-prevention"></a>

### V2 から V1 への引き下げの防止

エージェントが V2 の鍵を登録している場合、検証者はそのエージェントからの V1 バンドルを拒否すべきです（SHOULD、機能の固定）。ポリシーの `allow_v1_bundles` フラグは、移行中は既定で `true` ですが、移行が完了したら `false` にすべきです（SHOULD）。

<a id="supply-chain-security"></a>

### サプライチェーンのセキュリティ

DCP をデプロイするオペレーターは、次のことをしなければなりません（MUST）。
- すべての暗号ライブラリのバージョンをロックファイルで固定する
- SRI ハッシュで依存関係の完全性を検証する
- 上流のライブラリ（`@noble/post-quantum`、`tweetnacl` など）の侵害を監視する
- 暗号のコンポーネントには再現可能なビルドを使う

---

<a id="known-limitations-and-mitigations"></a>

## 既知の制限と緩和策

| 制限 | 緩和策 |
|---|---|
| `routine` ティアでの自己申告のアイデンティティ | `standard` 以上のティアでは、証明か、信頼セットに照らしたアドミッションを要求する。検証器が自らこれを強制することはない |
| 検証キャッシュが古い結果を返すことがある | 失効リストが更新されたら、キャッシュを無効化しなければならない（MUST）。公開済みの `@dcp-ai/sdk` 2.2.1 とそれ以前は、TypeScript の `VerificationCache` をバンドルのハッシュだけをキーとし、その `invalidateByAgent` は何もしない。`main` のソースコード（未公開）は、エージェント単位の無効化（`agentIds` なしで保存したすべてのエントリも削除する）と、呼び出し側が選ぶオプトインの `context` を加えるが、自動的には何も無効化しない。信頼や失効が変わったら、`invalidateByKid`、`invalidateByAgent`、`clear()` を呼ぶか、新しいコンテキストに移ること（[API_REFERENCE.md](../../../docs/API_REFERENCE.md#verificationcache)） |
| 2026 年 10 月 28 日より前に公開された V2 検証器は、オプションの二次監査チェーンも二次マークルルートも確認しない。`@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go v2.11.1、Rust `dcp-ai` 2.11.1 以降では、存在するフィールドを確認し、存在しないものは要求しない | それより前のバージョンでは、実際に行われるチェック、つまり一次の SHA-256 のコミットメントと署名だけを当てにし、検証の成功を根拠に V2-11 で規定された追加の保護があると主張しないこと。これらのバージョン以降では、検証の成功が対象とするのは存在する二次フィールドであり、完全な二次チェーンではない。実験的な候補もこれらのチェックを再利用する（[STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)） |
| `agent_id` が持続するため追跡が可能になる | プライバシーが重要な場面では、仮名のローテーションを検討する |
| BlindedRPR は `entity_type` と `jurisdiction` を露出する | 将来：ZKP に基づく資格情報の提示 |
| DCP-04 の X25519 + ML-KEM-768 の交換を実行する SDK はない | A2A のセッション鍵は呼び出し側が導出する。Python、Go、Rust、WASM は ML-KEM-768 をプリミティブとして公開しており、TypeScript の KEM プロバイダーは内部用 |
| ML-DSA-87 は実装されていない | 識別子は鍵のスキーマで予約されているが、使える SDK はなく、それを挙げているシミュレーションの HSM パターンは実装ではない |
| リファレンスサーバーの DCP-05–09 のエンドポイントには認証がなく、署名も検証しない | 信頼できないクライアントには公開しないこと（[OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)） |

以前の草稿にあった次の制限は**解消されました**。

- *CLI の PQ 暗号がシミュレーション（HMAC のプレースホルダー）だった*：解決済み。リファレンス CLI（`bin/dcp.js`）は、鍵の生成と署名に `@noble/post-quantum` による本物の ML-DSA-65 を使うようになりました。
- *CLI の Shamir SSS がプレースホルダー（ランダムなシェア）だった*：解決済み。CLI は鍵の回復の操作に、本物の Shamir の秘密分散ライブラリである `secrets.js-grempe` を使っています。
- *DCP-04..09 の動作が TypeScript にしかなかった*：2.2.0..2.7.0 で解決済み。ライフサイクル、継承、紛争解決、仲裁、権利と義務、委任、注意の閾値、プリンシパルのミラーは、TypeScript のリファレンスと同じ意味で Python、Rust、Go でも利用できます。A2A のハンドシェイクのメッセージと AES-256-GCM のセッション層は Python と Go にあり、Rust はディスカバリー、ハンドシェイクのメッセージ、セッション ID を扱います。リリースごとの内訳は [CHANGELOG.md](../../../CHANGELOG.md#210---2026-04-22) を参照してください。
- *正規のエラーの分類が TypeScript にしかなかった*：2.7.0 で解決済み。安定した `DCP-E###` の識別子を持つ 38 個の `DcpErrorCode` の値が TypeScript、Python、Rust、Go で揃えられ、SDK 間のエラー処理が 1 つの文字列で一致するようになりました。
- *Python の CLI の `keygen` が既定のファイルモードで秘密鍵を書き出していた*：解決済み。`sdks/python/dcp_ai/cli.py` は、`os.open` の呼び出しそのもので、モード 0600 の `secret_key.txt` をアトミックに作成し（chmod の競合の窓はない）、それを含むディレクトリをモード 0700 にします。

---

<a id="reference"></a>

## 参考資料

- 検証のチェックリスト：[spec/VERIFICATION.md](../../../spec/VERIFICATION.md)
- プロトコルのフィンガープリント：[protocol_fingerprints.json](../../../protocol_fingerprints.json)
- DCP-01（証明）：[spec/DCP-01.md](../../../spec/DCP-01.md)
- ストレージ、アンカリング、失効：[STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md)
- 技術アーキテクチャ：[TECHNICAL_ARCHITECTURE.md](../../../docs/TECHNICAL_ARCHITECTURE.md)
