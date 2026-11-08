<sub>[English](../../../../docs/conformance/SECURITY_COVERAGE.md) · [中文](../../../zh-CN/docs/conformance/SECURITY_COVERAGE.md) · [Español](../../../es/docs/conformance/SECURITY_COVERAGE.md) · **日本語** · [Português](../../../pt-BR/docs/conformance/SECURITY_COVERAGE.md)</sub>

<a id="security-guarantees-and-conformance-coverage"></a>

# セキュリティ保証と適合性テストのカバレッジ

> [英語版](../../../../docs/conformance/SECURITY_COVERAGE.md)の参考訳です。更新日：08/11/2026。相違がある場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せず保持しています。

本書は規範要件とリポジトリの実行可能なテストを対応付けた参考情報です。新しいプロファイル、認証、全入力をテストしたという主張、特定のデプロイ環境が合格した証拠ではありません。テスト結果は、その実行で記録した正確な実装、入力、ポリシー、検証時刻、ツールバージョンに適用されます。

[検証チェックリスト](../../spec/VERIFICATION.md)、[正規化プロファイル](../../spec/CANONICALIZATION_PROFILE.md)、[受け入れ判定プロファイル](../../spec/profiles/admission/README.md)が引き続き判断の基準です。参照実装とテストキットのどちらにも不具合があり得ます。仕様と再現可能なケースに基づいて差異を解決してください。実装間の一致によって正しさが決まるわけではありません。

<a id="what-the-guarantees-mean"></a>

## 保証の意味

| 層 | 検査によって確認できること | 確認できないこと |
|---|---|---|
| スキーマ | 入力が許可された構造とフィールド値を持つこと | 有効な署名、誠実な主張、プリンシパルの身元、認可 |
| 暗号学的検証 | 調べた署名、ハッシュ、関係が、指定された鍵、ポリシー、時刻における適用規則を満たすこと | 名指しされたプリンシパルが信頼されること、記録された出来事が実際に起きたこと、ツールの実行許可 |
| プリンシパルへの信頼 | 検証済みのプリンシパル署名の構成要素が、運用者が帯域外で指定した信頼集合と一致すること | その信頼元の範囲を超えた身元保証、操作の実行権限 |
| `strict-v1` の受け入れ判定 | 検証、プリンシパルへの信頼、署名された宛先・セッション制約、十分に新しい失効状態がプロファイルを満たすこと | 一回限りの使用、スナップショット後の失効、操作の認可 |
| アダプターによる制御の適用 | 統合が、保護対象ハンドラーの実行前に運用者の受け入れ判断を適用すること | コアプロトコルが提供する性質、または外部適合性キットが証明した性質 |

`action_authorized` は `false` のままです。ブロックまたはエスカレーションされた操作について検証や受け入れ判定を通過した記録は、その記録上の判断の証拠であり、実行許可ではありません。セッションの結合は不整合なセッションの継ぎ合わせを防ぎますが、bundle を消費したり、一回限りの使用にしたりはしません。

<a id="reading-the-evidence"></a>

## 証拠の読み方

[キットの README](../../tools/conformance/README.md)は、コマンド、契約、レポートフィールド、終了コードを定義しています。各テスト対象面は異なります。

- **参照実装：** `tools/conformance.js` は参照ヘルパーと `lib/verify.js` を呼びます。後者は V2 スキーマを検証し、暗号学的検証を TypeScript に委譲します。
- **外部プリミティブ：** 契約 `/1` は指定した実装を通じて正規化とダイジェストをテストします。
- **外部証拠：** 契約 `/2` は Merkle ルート、複合署名、V2 bundle 検証をテストします。リポジトリは TypeScript、Python、Go、Rust、WASM のラッパーを提供します。
- **外部受け入れ判定：** 契約 `/3` は検証と組み合わせた受け入れ判定と設定の読み込みをテストします。TypeScript、Python、Go、Rust のラッパーを提供しています。WASM には受け入れ判定 API がありません。
- **外部の委任：** 契約 `/4` は DCP-09 §3.5.2 の委任状チェーンの判定結果をテストします。TypeScript、Python、Go、Rust のラッパーを提供しています。WASM には委任状チェーンの API がありません。
- **外部の実効ポリシー：** 契約 `/5`（オプトイン）は、検証器が同じ検証の中で解決した検証モードとセキュリティティアとともに、V2 bundle の検証をテストします。TypeScript、Python、Go、Rust、WASM のラッパーを提供しています。
- **SDK とアダプターのスイート：** それぞれ独自の入口と範囲を持つ別のテストです。キットの一覧に項目があっても、キットがそのテストを実行したことにはなりません。

番号付きの契約は実行ツールのインターフェースであり、DCP プロトコルのバージョンではありません。ラッパーの識別情報は自己申告です。5 個のラッパーが 5 者の独立した外部採用者を意味するわけではありません。WASM は Rust とコードを共有し、これらのラッパーはすべて同じリポジトリに属します。

否定結果は、正常に動作する肯定対照があって初めて有用です。署名を更新せずに署名対象を変更すると、複数の原因で失敗し得ます。`spec_step` ラベルやエラーメッセージの一致だけでは、特定の検査が拒否の原因だったとは証明できません。規則を切り分ける有効・無効の対は、個別に構築した拒否対象 bundle とスイート単位の肯定対照だけの場合よりも強い証拠となります。

<a id="v2-verification-map"></a>

## V2 検証マップ

以下のケース名は [bundle ベクトル](../../../../tests/interop/v2/bundle_vectors.json)を参照します。`M`、`R`、`A` はそれぞれ `must_reject`、`must_reject_bundles`、`must_accept_bundles` です。外部 ID は `external.v2.bundle_vectors.` に、それぞれ `must_reject`、`must_reject_bundles`、`must_accept` とケース名を続けます。`signed_bundle` が基準の肯定ケースです。これは追跡可能な代表例であり、網羅的な一覧や完全性の評価ではありません。

| 規範規則 | 選択した既存のケースまたはスイート | 範囲と残る制限 |
|---|---|---|
| V2-1：バージョンの選択 | M `dcp_bundle_version_1_0`, `dcp_bundle_version_3_0` | V2 の入口での拒否。V1 の全要件をテストするものではない |
| V2-2：エンベロープと成果物のスキーマ検証 | 参照 `v2.signed_bundle.schema_invalid_payload_rejected`、スキーマスイート、明示的に選択するスキーマ検証カタログ（57 ケース） | SDK 検証器は `@dcp-ai/sdk` 2.3.0、`@dcp-ai/wasm` 2.1.3、`dcp-ai` 2.10.2（PyPI）、Go v2.13.0、Rust `dcp-ai` 2.13.0 以降、V2-2 を自ら実行する。それ以前のバージョンは実行しない。後述の境界を参照 |
| V2-3：マニフェスト、ペイロードハッシュ、監査の結合 | M `intent_payload_hash_wrong`, `audit_entries_truncated`; R `manifest_intent_hash_mismatch`, `audit_chain_hash_wrong`; A `empty_audit_trail` | ハッシュとチェーン結合の例。全フィールドや不正な構造を切り分けて網羅してはいない |
| V2-4：セッション、時刻、未署名メタデータの整合性 | R `intent_session_nonce_differs`, `session_expired_with_offset`, `session_longer_than_policy_max_with_late_created_at`; M `signature_signer_id_other`; A `session_duration_at_millisecond_precision` | 固定時刻でのテスト。要求されたポリシーと実効モードを区別する必要がある |
| V2-5：署名構造と正規エンコード | M `bundle_classical_sig_b64_with_trailing_bits`, `intent_classical_sig_b64_unpadded`; R `classical_only_bundle_signature_without_pq` | エンコードの例は全署名位置や欠陥の組み合わせを網羅していない |
| V2-6：プリンシパルによるマニフェストへの署名 | R `bundle_signed_by_agent_keys`; 参照 `v2.signed_bundle.forged_classical_signature_rejected` | 役割の結合と署名の例。自己申告のプリンシパルへの信頼は確立しない |
| V2-7：存在する PQ 署名の検証 | M `bundle_pq_signature_invalid`, `bundle_pq_slot_holds_ed25519` | 従来の証拠カタログでは選択されたポリシーで実行する。全実効モードを主張するには対応する対照が必要 |
| V2-8：各成果物をコンテキストと署名者の役割に基づいて検証 | M `rpr_classical_signature_invalid`, `intent_signed_by_principal`, `policy_decision_signed_under_intent_context` | 成果物と役割の例。構成要素、コンテキスト、鍵の全組み合わせではない |
| V2-9：宣言による引き下げを許さずティアを導出 | R `classical_only_intent_action_type_constructor`, `classical_only_intent_security_tier_constructor` | 判定の例。`/2` の bundle 操作は報告された解決済みティアを評価しない。`/5` の実効ポリシーのカタログは評価する |
| V2-10：実効モードとアルゴリズムポリシーの適用 | R `classical_only_payment_from_low_risk_passport`; 4 モードの `classical_only_routine` | モードの例。従来の証拠カタログにアルゴリズム許可リストとアドバイザリー専用のマトリクスはない |
| V2-11：存在する副次フィールドの検証 | [副次ベクトル](../../../../tests/interop/v2/secondary_sha3_vectors.json)の `external.v2.secondary_sha3` | 肯定対照と不正・不一致フィールド。欠落したリンクは任意なので、受理は完全な副次チェーンを意味しない |
| V2-12：チェックポイントの結合と検証 | A `pq_checkpoint_over_the_trail`; R `pq_checkpoint_listed_but_missing`, `pq_checkpoint_event_range_count_wrong`, `pq_checkpoint_pq_signature_invalid` | 所属、範囲、署名の例。不正な範囲や構成要素の全組み合わせではない |
| V2-13：鍵 ID の導出と鍵の有効性確認 | R `passport_key_kid_not_derived`, `passport_key_public_key_with_trailing_bits`, `rpr_binding_key_revoked` | 鍵、エンコード、状態の例。鍵ポリシー全体の網羅ではない |
| V2-14：成果物間の整合性 | R `passport_principal_binding_reference_other`, `audit_entry_policy_decision_other`; A `blocked_action_recorded`, `escalated_action_recorded` | 証拠の整合性と操作の許可は異なる |

コーパスの期待値は、宣言されたポリシー、ケースごとの上書き設定、検証時刻と併せて解釈する必要があります。有効なハイブリッド bundle は `pq_only` でも検証に成功し得ます。結合に必要な従来型署名のバイト列を含むことは、否定対照になる理由ではありません。要求された `classical_only` は、操作のティアによってより厳しい実効モードに解決される場合があります。

<a id="schema-and-cryptographic-api-boundary"></a>

### スキーマと暗号 API の境界

V2-2 はスキーマ検証を要求します。`@dcp-ai/sdk` 2.3.0、`@dcp-ai/wasm` 2.1.3、`dcp-ai` 2.10.2（PyPI）、Go v2.13.0、Rust `dcp-ai` 2.13.0 以降では、TypeScript、Python、Go、Rust、WASM の各 SDK の V2 検証器が自らこれを実行します。対象は `verifySignedBundleV2` とその対応関数、最初に検証を行う結合されたアドミッション API、実験的な候補の検証器です。以前の検証結果からアドミッションを評価する場合は、これを再実行しません。それ以前の SDK バージョンには含まれていません。このゲートは、署名済み bundle のエンベロープと四つのペイロード（`responsible_principal_record`、`agent_passport`、`intent`、`policy_decision`）を `schemas/v2` に照らして検証します。実行されるのは、検証器のポリシーと時計の確認の後、検証器がマニフェスト、ペイロードのハッシュ、鍵、署名を確認する前です。すべての SDK は `schemas/v2` から生成された同じ表現（`tools/schema-ir/`）を解釈し、CI はそれを再生成してコピーを比較します。

- **閉じたオブジェクトと開いたオブジェクト。** 閉じたオブジェクト（`additionalProperties: false`。たとえばエンベロープ、`SignedPayload`、`composite_sig`、監査エントリー、チェックポイント）の未知のメンバーは、ハッシュと署名が有効なままでも拒否されます。intent の `target` や監査の `evidence` のような開いたオブジェクトでも、宣言されたメンバーは制約を保ちます（たとえば `target.channel` は必須で、列挙された値をとります）。この層で検査されないのは、スキーマが記述していない追加のメンバーだけで、コミットメントの下にあるものは正規化に届くことがあります。`bundle` オブジェクト自体の追加のメンバーは受け入れられます。スキーマが `bundle` を開いたままにしており、そのメンバーは（bundle が含む署名済みの成果物やマニフェストとは異なり）どのコミットメントの下にもなく、後続のどの検査もそれを読まないためです。
- **欠落と `null`。** 必須メンバーの欠落も、スキーマが別の型を期待する位置の `null` も拒否され、診断は異なります（`required`、`type`）。マニフェストの `session_issued_at` と `session_expires_at` は、存在する場合は文字列でなければならず、`null` は拒否されます。
- **診断。** スキーマの失敗は `verified: false` と `schema: <JSON pointer> <keyword>[ <member>]` 形式のエラーを返します。最大 16 件で、その後に `schema: further errors not listed` が続き、入力の値も暗号に関する詳細も含みません。以前はより深い検査が報告していた拒否が、今はスキーマの診断になる場合があります。スキーマの失敗は、深い検査が実行されたことを示しません。
- **候補のオーバーレイ。** 呼び出し側が明示的に選択する実験的な `dcp-jcs-v2` の経路での唯一の違いはマニフェストの `canonicalization_profile` で、`dcp-jcs-v2` でなければなりません。既定のプロファイルと署名済みのバイト列は変わりません。
- **`date-time`。** 形式の確認は参照検証器が適用しているもの、つまり full モードの ajv-formats 3.0.1 で、その癖も含みます。区切りとして任意の ECMAScript の空白文字または `t`、`+hh` と `+hhmm` のオフセット、オフセットで移した時刻が 23:59 のときの秒 60 を受け入れます。これはスキーマ層の互換性の境界であり、厳密な RFC 3339 ではありません。V2-4、V2-13、V2-14 の時刻パーサーは別の後続の層のままで、スキーマが受け入れた時刻を拒否することがあります。
- **パーサーが先。** JSON パーサーが拒否するものは V2-2 に届きません。Go はオブジェクトでないルートを従来のパースエラーとして報告します。Rust の API はパース済みの `serde_json::Value` を受け取るため、serde_json の拒否（孤立サロゲート、`1e400`）は呼び出し側のものです。WASM のバインディングは、ポリシーのパースエラー、`JSON parse error`、バージョンの振り分けを V2-2 の前に保っています。
- **受理の変更。** 以前は SDK の検証器が受け入れていたスキーマ上無効な bundle は、今は `verified: false` を返します。スキーマだけの API は追加されず、スキーマもプロファイルも変わりません。

V2 チェックリスト全体への適合を主張する実装者は、暗号学的検査だけでなく V2-2 も満たす必要があります。テストを通すためにスキーマを弱めたり、部分的な API を完全な検査として説明したりしないでください。キットはこれらの層を分けて報告します。

未知のメンバーが一律に禁止されているわけではありません。一部のスキーマオブジェクトは開いています。署名対象オブジェクトの拡張がスキーマ上許容されても、古い署名が有効なままになるわけではありません。署名対象が変わればハッシュと署名の再計算が必要です。ここでは必須拡張の新しい仕組みを定義していません。

明示的に選択する[スキーマ検証カタログ](../../../../tools/conformance/external-schema-validation-catalog.json)は、署名済みの 57 ケースを実装に通します。13 の肯定ケースと 44 の否定ケースで、各否定ケースは同じ実行で基準ケースが検証に成功した場合にだけ数えられます。CI は五つの SDK ラッパーでこれを実行します。明示的に選択する[スキーマ診断カタログ](../../../../tools/conformance/external-schema-catalog.json)は 15 の閉包ケースを保持します。基準データと許可された拡張を肯定対照とし、閉じたオブジェクトの拡張や列挙外の値には規範上の拒否を維持します。SDK ケースの失敗は失敗のままで、どちらのカタログに合格しても、対象はそのケースだけです。別の `tools/conformance/schema-boundary.js` レポートは、スキーマ検証、有限のコーパスの整合性、コーパスの時刻でのスキーマと SDK の組み合わせを区別します。この組み合わせは SDK 単体が V2-2 を実装する証拠ではなく、整合性ヘルパーも汎用の規範検証器ではありません。

<a id="verifier-policy-samples"></a>

### 検証器ポリシーのサンプル

明示的に選択する[ポリシーカタログ](../../../../tools/conformance/external-policy-catalog.json)のバージョン 2.0 は、既存の `/2` 契約で 2 つのスイートに 108 ケースを追加します。最初のスイートはバージョン 1.1 の 74 ケースを保ちます。内訳は肯定対照 10、存在する無効な PQ 署名 24、アルゴリズムリストとアドバイザリ 14、既に版管理されたティアケース 26 です。2 つ目は V2-10 の明確化（下記）の 34 ケースを実行します。各リクエストには正確なポリシーと検証時刻が含まれます。既定の証拠カタログは変更せず、バージョン 1.1 は [`external-policy-catalog-1.1.json`](../../../../tools/conformance/external-policy-catalog-1.1.json) としてバイト単位で保管されます。

新しい routine ティアのハイブリッド対照は、実効 `classical_only` と他の 3 モードを検査します。standard ティアのハイブリッド対照では、要求した `classical_only` が `hybrid_preferred` に引き上げられます。コーパスはこの導出を記録しますが、`/2` が評価するのは判定であり、実装が報告するティアや実効モードではありません。オプトインの実効ポリシーのカタログ（後述）は、契約 `/5` でそれらを評価します。

PQ の否定ケースでは bundle、パスポート、チェックポイントの PQ 署名だけを変更し、古典署名は有効なままです。アルゴリズムリストのケースでは同じ bundle のままポリシーだけを変更します。ティアケースは別々に署名された既存 bundle と、同じ要求モードの routine 対照を再利用するため、単一変更の対ではありません。各否定ケースには、同じ実行で肯定対照が成功することが必要です。

[VERIFICATION.md](../../../../spec/VERIFICATION.md) の手順 V2-10 の明確化（05/11/2026）は、コーパスの 3 つの質問を解決します。[`verifier_policy_clarification_vectors.json`](../../../../tests/interop/v2/verifier_policy_clarification_vectors.json) がそのケースを保持し、要求したモードがそのまま実効モードになるよう routine の基礎を使います。

- **Q1.** `pq_only` では、古典のリストとアドバイザリによる除外はハイブリッドの bundle を受け入れます。`hybrid_required` では同じポリシーがそれを拒否します。
- **Q2.** bundle の署名、パスポート、チェックポイントで、PQ の構成要素がその古典のバイトに対して検証される一方で失敗する古典の構成要素は、`pq_only` では受け入れられ、他の 3 つのモードでは拒否されます。正準でない古典の `sig_b64` と未知の古典の kid は `pq_only` で拒否されます。
- **Q3.** PQ のリストとアドバイザリによる除外は、`classical_only` と `hybrid_preferred` で古典のみの bundle を受け入れ、同じポリシーでハイブリッドの bundle を拒否します。

`verifier_policy_vectors.json` は除外した Q1 のケースを履歴として保ちます。これらのケースはこれらの規則のサンプルであり、すべての位置、アルゴリズム、鍵の状態を網羅するものではありません。未検査の組み合わせがあることだけでは、仕様の矛盾は証明できません。これらはポリシーのサンプルです。スキーマ検証（V2-2）には専用のカタログがあり、05/11/2026 以降のリリースの SDK の検証器内で実行され、それ以前のリリースでは実行されません。これらのサンプルは完全な V2 適合性を確立しません。

<a id="structural-samples"></a>

### 構造に関するサンプル

明示的に選択する[構造カタログ](../../../../tools/conformance/external-structural-catalog.json)は、`/2` に16ケースを追加します。陽性対照2件と陰性ケース14件で、署名エンコーディング、チェックポイントの署名成分と範囲、マニフェストのコミットメント、小数を含むペイロード、セッション時刻の順序、および古典署名を無効化した後にPQ署名を正しく再計算したバンドルを扱います。実効モードは `hybrid_preferred` です。これらの古典署名の陰性ケースは `pq_only` の結果を主張しません。

エンコーディングの4ケースは、デコード後の署名バイト列を保持します。チェックポイント範囲には監査列内の実際の位置を使い、識別子は意図的にソートしていません。変更したマニフェストには再署名します。時刻の順序を逆転させたセッションには、許容クロックスキュー内の別の陽性対照があります。各陰性ケースは、同じ実行内ですべての対照が合格することを必要とします。

分離には明示的な限界があります。小数は `dcp-jcs-v1` で表現できないため、元のハッシュと署名は変更後の内容に対応しません。逆向きの範囲にも、その範囲に対する有効なルートはありません。成分の検査は意図した欠陥を記録しますが、SDKのどの検査が拒否の原因になったかは特定しません。これらは構造のサンプルです。スキーマ検証（V2-2）には専用のカタログがあり、05/11/2026 以降のリリースの SDK の検証器内で実行され、それ以前のリリースでは実行されません。これらのサンプルは完全な適合性を証明しません。

<a id="effective-mode-and-tier"></a>

### 実効モードとティア

オプトインの[実効ポリシーのカタログ](../../../../tools/conformance/external-effective-policy-catalog.json)は、契約 `/5` で 130 ケースを実行します。評価するのは判定結果と、実装の検証器が同じ検証の中で解決した検証モードとセキュリティティアで、返されたとおりのものを使い、キットが計算し直すことはありません。112 ケースは 2 つの値の両方を必須とします。V2-2 を通る bundle を持つ検証器ポリシーと明確化の 94 ケース、要求した各モードでの elevated と maximum の有効な肯定例、`risk_score` の境界、明示・宣言した `security_tier` の下限、デフォルトを置き換えるパスポートのオーバーライドを加える署名済みの 17 ケース、そして対照 1 つです。bundle が V2-2 に失敗する 14 ケースと、それより前の 4 つの拒否では、値が欠けていても構いません。報告された値は、それでも既知で整合的でなければなりません。先行する失敗の後に値を解決するかどうかは SDK ごとに異なり、どちらも認められます。制御された実装により、要求したモードやデフォルトのモード、ティアの下限だけ、宣言したティア、ポリシー決定の `resolved_tier` を報告するラッパーを判定が失敗させることを示しています。DCP-09 のチェーンの下限、`@dcp-ai/wasm` の JavaScript API、ブラウザは対象外で、合格が示すのはこれらのケースだけです。

<a id="admission-map"></a>

## 受け入れ判定マップ

[共有受け入れ判定ベクトル](../../../../tests/interop/v2/admission_vectors.json)と[外部受け入れ判定カタログ](../../../../tools/conformance/external-admission-catalog.json)は、組み合わせ API と設定ローダーで次のグループをテストします。各ケースの正確な `rule`、入力、期待フィールドを読んでください。グループ名は網羅性の証明ではありません。

| 要件 | テスト対象面 | 制限 |
|---|---|---|
| T1–T2：プリンシパルと構成要素の鍵を運用者の信頼に結び付ける | `external.admission.outcomes` | 信頼は帯域外で供給する。キットは現実世界の身元を確立しない |
| P1–P4：V2、署名された宛先とセッション期間、プリンシパルのハイブリッド署名 | 結果と組み合わせケース | 構造上の検査と検証済みであることの検査は異なる。不正値の全組み合わせは列挙していない |
| R1–R5：スナップショットの可用性、形式、鮮度、対象の状態 | 結果 | 新しいスナップショットでも、その `checked_at` 後の失効イベントは証明しない |
| 設定：未知のフィールド、不正な信頼設定、プロファイルの弱体化を拒否 | `external.admission.config` | 複数欠陥のケースでは複数の規範エラーが許容され得る。付随的なメッセージ表現が規則ではない |
| 組み合わせ手順と結果 | 結果と組み合わせケース | `action_authorized:false`、記録された判断、信頼・プロファイルの結果を評価する。完全な `signer_keys` 出力は直接比較しない |
| A1–A3：保護対象ハンドラー、運用者設定、情報源、テナント、キャッシュ | 別のアダプターテスト | 外部キットの対象外。SDK の結果は統合による制御の適用を証明しない |

計算済みの検証結果を受け取る評価器は、同じ bundle、ポリシー、時刻に対する結果を呼び出し側が渡すことを信頼します。外部受け入れ判定操作は組み合わせ API を使います。そのテストに合格しても、呼び出し側が任意に渡す検証オブジェクトが安全になるわけではありません。

<a id="delegation-map"></a>

## 委任マップ

[外部の委任カタログ](../../../../tools/conformance/external-delegation-catalog.json)（バージョン 2.0.0）は、コミット済みの[委任状チェーン](../../../../tests/interop/v2/mandate_chain_vectors.json)、[チェーンの時刻](../../../../tests/interop/v2/mandate_chain_time_vectors.json)、[繰り返されるドメイン](../../../../tests/interop/v2/mandate_domain_vectors.json)のベクトルを `verify_mandate_chain` で実行します。各規範ケースは [DCP-09 §3.5.2](../../../../spec/DCP-09.md) の規則を示し、判定結果と、受理されたチェーンでは実効の層を判定します。

| 要件 | テストする対象 | 制限 |
|---|---|---|
| 規則 1–2：ルートとサブ委任状の署名、署名者の役割とコンテキスト、親とのリンク、深さ、`human_id` | `external.delegation.chain` | 鍵はリクエストで与えられ、キットはそれがプリンシパルやエージェントの鍵であることを確認しない |
| 規則 3：再委任の許可と最大の深さ | `external.delegation.chain` | コミット済みのチェーンであり、すべての深さではない |
| 規則 4：有効期間、その入れ子、RFC 3339 の瞬間としての検証時刻（ミリ秒で比較） | `external.delegation.chain`、`external.delegation.chain_time` | ミリ秒の精度は §3.5.2 の明確化（05/11/2026）以降規範的。保管されたカタログのバージョン 1.0.0 では、その 3 ケースは参考 |
| 規則 1–2：各署名鍵が有効で、その `expires_at` が存在しないか `null` か検証時刻より前ではない（05/11/2026 の明確化） | `external.delegation.chain_time` | `expires_at` に関する 7 ケース。`status` が `active` でない鍵を持つケースはない。バージョン 1.0.0 ではこの 7 ケースは参考 |
| 規則 5：アクション、データの分類、上限の縮小。±(2^53 − 1) の範囲の上限。1 つの委任状で繰り返されるドメイン | `external.delegation.chain`、`external.delegation.domains` | エラーの文言は診断で、拒否は判定結果で判定する |
| 規則 6：層の下限と実効の層 | `external.delegation.chain` | 実効の層は受理されたチェーンで判定する。`tier_floor`（`computeSecurityTier`）はカタログの対象外 |
| 規則 7：ルートまたは中間の委任状の失効 | `external.delegation.chain` | 失効はリクエスト内の失効 ID のローカルな集合であり、失効情報の提供元ではない |

拒否は、そのコントロール、すなわち関係（`same_chain`、`single_mandate`、`same_shape` または `suite`）がバイトで確認された規範的に受理されるチェーンがある場合にだけ数えられます。これらの関係のどれも、2 つのケースの違いが 1 つの欠陥だけであることを示しません。検証されたチェーンは受け入れ判定でも承認でもありません。

カタログのバージョン 1.0.0 は [`external-delegation-catalog-1.0.0.json`](../../../../tools/conformance/external-delegation-catalog-1.0.0.json) としてバイト単位で保管され、87 ケースを判定し、10 の参考ケースを別に報告します。バージョン 2.0.0 は 97 ケースすべてを判定します。ランナーは各バージョンの分類を固定するため、1.0.0 の報告は 1.0.0 だけの証拠です。

<a id="differential-samples"></a>

### 差分サンプル

[差分テストのハーネス](../../../../tools/difffuzz/README.md)は、同じバイト列で SDK を比較します。一致は決して判定基準ではありません。

- **委任状チェーン。** `run-mandates.mjs` は、署名し直した DCP-09 チェーンを契約 `/4` で 4 つのチェーン検証器に送ります。各実行は、73 バリアントを適用できる各深さで網羅し（167 ケース）、その後、上限のあるランダム変異体を実行します。§3.5.2、正規化プロファイル、RFC 8259 に根拠のあるケースだけが規則の証拠になります。観察と、署名できない値や数値表現によって帰属が限定されるケースは別に報告し、それらの間の不一致も検出事項のままです。
- **WASM を含む bundle。** `run.mjs --sdks five` は、4 つの bundle 検証器に、WASM にコンパイルして Node で実行する Rust SDK を加えます。4 SDK の検出事項が 5 SDK の証拠として読まれることはありません。

有限のキャンペーンは、これらのケースが一致することを示すか、一致しない箇所を記録します。網羅的ではありません。WASM は委任状チェーンを検証しません。また、契約 `/4` がすべての SDK に運ばない入力（`NaN` トークン、バイトオーダーマーク、`1e400`）は、別のトランスポートのプローブで測定します。ラッパーの拒否が SDK の拒否として数えられることはなく、TypeScript と Python の SDK が `1e400` に返す拒否も意味上の規則の証拠にはなりません。

<a id="local-source-additions-07112026"></a>

## ローカルのソースでの追加（07/11/2026）

これらの行は、公開されたパッケージではなく、TypeScript、Python、Go、Rust の SDK のローカルのソースを記述します。
それぞれは 4 つの SDK のテストスイートが実行する共有ベクターで確認されます。外部キットにはまだこれらのための契約が
ないため、キットの結果はこれらの規則について何も示しません。いずれも完全な適合やエンタープライズでの準備完了を主張する
ものではありません。

**オプションの領域。** それを呼び出すコードだけが使います。

| 要件 | 確認している対象 | 制限 |
|---|---|---|
| 委任付きアドミッション（[アドミッションプロファイル § 10](../../../../spec/profiles/admission/README.md#10-delegated-admission-opt-in)） | [`delegated_admission_vectors.json`](../../../../tests/interop/v2/delegated_admission_vectors.json)：71 件のケースと 6 件の構成のケース | `now` でのみ確認。`delegation_active` と `action_authorized` は `false`。WASM の API なし |
| バイトからのアドミッション（§ 11） | [`v1_ingress_vectors.json`](../../../../tests/interop/v2/v1_ingress_vectors.json)：26 件のケースと 30 件のドメインの差異 | サイズと時間の予算は対象外。解析済みの値を受け取る関数は、パーサーが失ったものを取り戻せない |
| マンデートの確認応答とアクティベーション（[DCP-09 § 3.3.1](../../../../spec/DCP-09.md#331-mandate-acknowledgment-opt-in)、§ 12） | [`mandate_acknowledgment_vectors.json`](../../../../tests/interop/v2/mandate_acknowledgment_vectors.json)：TypeScript と Python では 93 件。Go と Rust では 89 件で、コンテナーがリストでない 4 件を、型付きの API では運べないため明示的に除外 | 署名付きの宣言であり、時系列や理解の証明ではない。認可なし。全体的なリプレイの確認なし。バイトからのアクティベーションなし。WASM の API なし |

**Ed25519 の検証（暗号プロファイル）。** SDK の検証器が確認するすべての Ed25519 署名に適用されます。

| 要件 | 確認している対象 | 制限 |
|---|---|---|
| V1 のオブジェクトと V2 の既定のプロバイダーでの [P-ED-1](../../../../spec/profiles/crypto/README.md#p-ed-1-ed25519-acceptance-criterion) | [`ed25519_ped1_vectors.json`](../../../../tests/interop/v2/ed25519_ped1_vectors.json) とその検査器（4 つの SDK のスイート内）、`wasm32` で実行した Rust のプロバイダー | 08/11/2026 以降は、参照検証器、CLI の V1 経路、playground、そして Node と Chrome 上の WASM も対象です。インストールされた SDK からこれを受け継ぐものは[公開インターフェース](#public-interfaces-mp-03-08112026)を参照してください。独自のプロバイダーはオペレーターの責任です |

<a id="public-interfaces-mp-03-08112026"></a>

## 公開インターフェース（MP-03、08/11/2026）

この節も、公開パッケージではなくローカルのソースを説明します。各機能について、それが通る公開関数と、そこで
その機能に届く証拠を示します。

- **WASM** は `@dcp-ai/wasm` の `DcpWasm` クラスです。
- **生**は、Node で実行するその wasm-bindgen のエクスポート（`@dcp-ai/wasm/pkg`）を指します。
- **Chrome** での実行は、キットの[ブラウザーラッパー](../../tools/conformance/README.md#browser-wrapper-dcpwasm-in-chrome)を通ります。

| 機能 | TypeScript、Python、Go、Rust | WASM | 主張しないこと |
|---|---|---|---|
| `dcp-jcs-v1` の正準バイトとダイジェスト | キット `/1`（38） | 生で `/1`（38）。Chrome では `/1`（38）：正準化は `JSON.parse` の後に `DcpWasm.canonicalize`、ダイジェストはテキストに対して `dualHash` と `sha3_256` | パーサーがすでに変更したバイト（後述のパース表を参照） |
| V2 検証：バンドル、Merkle ルート、複合署名 | キット `/2`（241：バンドル 211、複合 24、Merkle 6 ケース）、ポリシー（108）、構造（16）、スキーマ（57）、`/5`（130） | 同じカタログを生で（552 ケース。`/1` を含めて 590）。Chrome ではそれぞれ専用の `DcpWasm` メソッドで：バンドルは `verifyBundle`、複合ケースは `compositeVerify`、Merkle ケースは `dualMerkleRoot` | アドミッション、信頼、認可 |
| 複合署名、ドメイン分離、セキュリティティア | キット `/2` の複合ケース（24）、SDK スイート内の interop ベクター | Chrome での直接呼び出し（103）：`domainSeparatedMessage` 20（interop ベクターの 19 コンテキストと `MandateAcknowledgment`）、`computeSecurityTier` 79、ペイロード・コンテキスト・署名の否定例を伴う 2 つのハイブリッド署名・検証の往復、そして P-ED-1 の 2 つの複合原像 | `/5` は `computeSecurityTier` を使いません。`verifyBundle` が報告するモードとティアを読みます |
| P-ED-1 | 4 つの SDK スイート内のコーパス | Node 上の `wasm32` で Rust のプロバイダー：プロバイダー 67 ケース、V1 オブジェクト 4 件、実際の ML-DSA-65 鍵を使う複合 2 ケース。Chrome では、`classical_only` のバインディングで `compositeVerify` を通した 2 つの複合原像 | 生の Ed25519 メソッドを持たない `DcpWasm` を通したコーパス全体 |
| `strict-v1` のアドミッション | キット `/3`（140） | 非対応 | — |
| 委任状チェーン | キット `/4`（97） | 非対応 | — |
| 委任アドミッション、バイトからのアドミッション、アクティベーション | 上記の SDK スイートと、バイト関数とアクティベーション関数の設定エラー | 非対応 | キットの契約 |

WASM には、委任状チェーン、アドミッション、アクティベーションの API がありません。これは試験運用（D-04）の範囲で
あって、ブラウザーの限界ではありません。ブラウザーアプリケーションのバックエンドが、4 つの SDK のいずれかで委任を
検査し、アドミッションを行います。クライアントが制御する入力からブラウザーで計算したアドミッションは、サーバー上の
何も認可しません。

**SDK 以外での P-ED-1。** TweetNaCl で自ら Ed25519 を計算する検証器は、まず P-ED-1 を検査します。その際、バイト用
ヘルパーの 3 つの同一コピーのいずれかを使います：`tools/`、`cli/lib/`、`playground/js/core/ed25519-ped1.js`。その他の
検証器は、読み込む SDK からのみ P-ED-1 を得ます。

| 検証器 | Ed25519 の経路 | P-ED-1 |
|---|---|---|
| 参照 V1（`tools/crypto.js` の `verifyObject`）：`lib/verify.js` と `bin/dcp.js` の V1、transparency log の gossip、失効サービス | 自前の検査、その後 TweetNaCl | ソースにあり。`tools/ed25519-ped1-consumers.test.mjs` |
| V1 ファイルに対する `dcp-ai verify` | 自前の検査（`cli/lib/ed25519-ped1.js`） | ソースにあり。公開済みの `@dcp-ai/cli` にはない |
| V2 ファイルに対する `dcp-ai verify`、参照 V2、サーバー | インストールされた `@dcp-ai/sdk` | それを持つ SDK でのみ。CI はワークスペースの SDK をビルドしてインストールします。公開済みのどの `@dcp-ai/sdk`（2.3.0 以前）にもなく、それらからインストールしたコピーにもありません |
| Playground（PQ 署名がシミュレーションのデモ） | 自前の検査 | ソースにあり |
| Express、OpenClaw | 2.2.0 に固定された `@dcp-ai/sdk` | ロックでは適用されません。CI はワークスペースの SDK でもそれらのテストを実行します |
| Anthropic MCP、Google A2A | 2.2.0 に固定された `@dcp-ai/sdk` | 適用されません（記録済みの限界） |
| FastAPI、LangChain、OpenAI、CrewAI | このツリーの Python SDK | 適用されます |

**エラー、拒否、結果の欠如。** 各公開関数は独自のエラー契約を保ち、どれも正規化しません。P-ED-1 が拒否するのは、
その関数の型・サイズ・デコードの先行検査を通過した入力だけです。エラーだったものはエラーのままです。キットと
ブラウザーハーネスでは、`error`、`unsupported`、欠けたケース、クラッシュ、タイムアウトが、期待される拒否を満たす
ことはありません。

| 関数 | 拒否 | エラー |
|---|---|---|
| Ed25519 プロバイダー、V1 の `verifyObject`（SDK、参照、CLI、playground） | `false`：S >= L、P-ED-1、または方程式 | それぞれ独自です。無効な base64 は、その関数が base64 をデコードする箇所（プロバイダーの鍵、`verifyObject` の署名と鍵）だけです。TypeScript と参照検証器は、無効な base64 と、デコードした署名や鍵のサイズ誤りで例外を投げます。playground の `verifyDetached` はバイトを受け取り、サイズ誤りと `Uint8Array` でない値で例外を投げます。Python はサイズ誤りで PyNaCl の `ValueError` を送出します。Go は署名長の誤りで `false` を、鍵長の誤りでエラーを返します。Rust はどちらの長さの誤りでも、展開できない鍵でもエラーを返します。CLI は INVALID とエラーで 1、VALID の場合だけ 0 で終了します |
| `compositeVerify` | `valid: false` と各コンポーネントの判定 | `pq_over_classical` で PQ 署名がないことは、Rust と WASM 経由ではエラーで、TypeScript、Python、Go はブール値を返します |
| バンドル検証 | 診断付きの `verified: false`。不正な入力でも同じ | WASM の `verifyBundle` は、自身の JSON とポリシーのパースエラーも同じ形で報告します |
| `strict-v1` のアドミッション（`admitSignedBundleV2`） | `admitted: false` とコード。`action_authorized` は常に `false` | `AdmissionConfigError`（Go では `*AdmissionConfigError`）。無効なプロファイル、または検証者ポリシーと一緒に渡されたプロファイルは、バンドルを検証する前に拒否されます。その他の設定エラーがどこで見つかるかは SDK によります。たとえばトラストセットのないプロファイルは、TypeScript では検証後のアドミッション中（`evaluateAdmissionV2`）に、Rust では検証前に見つかります。いずれの場合もエラーとなり、結果はありません |
| 委任アドミッション、アクティベーション | 委任アドミッション：`admitted: false` とコード。アクティベーション：`composition`（委任アドミッションの結果）、`activation`、`delegation_active`、`ACK_*` コード。`action_authorized` は常に `false` | オペレーターの設定が無効なときは、どの証拠も読む前に `AdmissionConfigError` |
| バイトからのアドミッション | イングレスの拒否は結果です：`ingress.accepted: false` とその層・クラス、アドミッションなし | まずイングレスが判定し、受け入れられたバイトはその後 `admitSignedBundleV2` と同じようにアドミッションされ、その設定エラーを伴います（Rust では `IngressError::Config`）。バイトでない入力は、TypeScript と Python では `TypeError` です |
| `DcpWasm` のメソッド | バインディングの報告どおり | `Error('<method>: …')`。`canonicalize` はタグ付きの `wasm_canonicalize_v2_result` を読み、`hashObject` と `deriveKid` は 16 進形式の値だけを返します。生のエクスポートは `{"error": …}` を帯域内に保ち、`wasm_canonicalize_v2` はそれを、正準形がそのオブジェクトである値と区別できません |

この表を裏付けるテスト：

- 各 SDK の P-ED-1 コーパスのテスト
- `sdks/wasm/test/interface-errors.mjs` と `sdks/wasm/test/schema-v2.mjs`
- 設定エラーのテスト `e5-config-errors.test.ts`、`test_e5_config_errors.py`、`e5_config_errors_test.go`、
  `tests/e5_config_errors.rs`

**誰がパースするか。** どの関数も、他の関数のために入力を修復しません。それぞれ自分のパーサーが生成したものを読みます。

| 関数 | パーサー | パーサーの前の検査 |
|---|---|---|
| `verifySignedBundleV2`、`admitSignedBundleV2` と、その Python と Rust の対応関数 | 呼び出し側のもの（`JSON.parse`、`json.loads`、`serde_json`） | なし |
| Go の `VerifySignedBundleV2At`、`AdmitSignedBundleV2` | SDK の `encoding/json`（`[]byte` に対して） | なし。バイトを受け取ることは[アドミッション § 11](../../../../spec/profiles/admission/README.md#11-admission-from-bytes-opt-in)のイングレスではありません |
| 各 SDK の `FromBytes` アドミッション関数 | SDK | イングレス：スキャナー、ポータブルなドメイン、その後パーサーの照合。アドミッションの前 |
| `DcpWasm` のメソッド | 呼び出し側の `JSON.parse`、その後 `JSON.stringify` が書いたものに対する `serde_json` | なし。また不可能です：JavaScript の値はすでにパース済みです |
| WASM の生のエクスポート | テキストに対する `serde_json` | なし |
| `experimentalCandidateIngress` とその対応関数 | 実験的な候補自身のもの | そのスキャナー。§ 11 のイングレスではなく、`dcp-jcs-v1` を何も変えません |

<a id="claims-for-core-and-profiles"></a>

## コアとプロファイルについて主張できる範囲

| 対象面 | キットから報告できること | 分けて扱う必要があること |
|---|---|---|
| コアのデータ表現 | 実際にテストした正確な `dcp-jcs-v1` 正規バイト列とダイジェスト | 未テストの入力と実験候補 |
| V2 証拠検証 | 選択した bundle、Merkle、署名ケースの結果 | 別途確認されない限り、完全な V2 適合、特にスキーマのカバレッジ |
| 暗号プリミティブ | テストしたドメイン分離、構成要素の検証、結合 | 検証ポリシー、プリンシパルへの信頼、受け入れ判定 |
| `strict-v1` の受け入れ判定 | 選択した受け入れ判定・設定ケースの結果 | デプロイ環境での制御の適用、操作の認可 |
| V1 | コミット済みフィクスチャに対する参照スキーマ・整合性検査 | 独立した第三者の V1 適合性 |
| A2A とガバナンス | 名前を明示したスイートで実際にテストした規則のみ | 各プロファイルの完全な機能適合性 |
| DCP-05 から DCP-08 | 内部スキーマ・通信形式スイートが明示する検査 | これらの文書のライフサイクル、権利その他の完全な意味論 |
| DCP-09 | 内部スキーマ・通信形式スイートが明示する検査と、外部の委任カタログで選択した委任状チェーンのケースの判定結果 | 委譲の完全な意味論、有効性ヘルパー、鍵への信頼、受け入れ判定、行為の承認 |
| 実験的な `dcp-jcs-v2` | 個別に選択した実験テスト | 規範またはデフォルトとしての地位。`dcp-jcs-v1` は不変 |

部分集合の結果には、その範囲と制限を明記する必要があります。`unsupported`、ケースの欠落、異常終了、タイムアウト、省略されたマトリクスを合格にしてはいけません。マトリクスを実行せずに終了する予約済みの SDK テストは、そのマトリクスが実行された証拠にはなりません。

<a id="further-validation"></a>

## 追加の検証

[監査資料](AUDIT_DOSSIER.md)は、レビューの基準、再現のコマンド、成果物の由来、既知の限界を示します。[実装者ガイド](IMPLEMENTER_GUIDE.md)は、独立して結果を再現・報告する方法を説明します。外部実装と独立したセキュリティレビューは追加のマイルストーンです。このリポジトリのテストはそれらの代わりにはなりません。

性能測定には専用の[文書化された実行ツール](../../tools/conformance/README.md#performance-baseline)を使います。端から端までの時間は、暗号プリミティブへのコスト帰属や早期終了がないことの証明にはなりません。具体的なコストを測定してから、検証判断と互換性を維持して最適化してください。
