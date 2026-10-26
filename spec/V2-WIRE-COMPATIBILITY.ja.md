<sub>[English](V2-WIRE-COMPATIBILITY.md) · [中文](V2-WIRE-COMPATIBILITY.zh-CN.md) · [Español](V2-WIRE-COMPATIBILITY.es.md) · **日本語** · [Português](V2-WIRE-COMPATIBILITY.pt-BR.md)</sub>

<a id="dcp-ai-v20-wire-compatibility-errata-for-dcp-05-dcp-08-and-dcp-09"></a>

# DCP-AI v2.0 ワイヤーフォーマットの互換性：DCP-05、DCP-08、DCP-09 の正誤表

> [英語の仕様](V2-WIRE-COMPATIBILITY.md)の参考訳です（25/10/2026 更新）。**規範となるのは英語版です**。この翻訳に規範的な効力はなく、内容が異なる場合は英語版が優先されます。識別子とコードブロックは翻訳せずにそのまま掲載しています。

<a id="status"></a>

## ステータス

25/10/2026 公開。**規範的なのは、以下の正誤 E1〜E8 とセクション 2 の層の定義だけです。** DCP-AI v2.0、DCP-05、
DCP-08、DCP-09 のその他の要件はすべて、規範的な効力をそのまま保ちます。正規化プロファイルの要件、署名の規則、
スキーマ、各仕様の本文は一体として適用されます。どれかが他を覆すことはなく、ここで緩和されるものもありません。

これらの正誤は、仕様が V2.0 のワイヤーフォーマットのデータ（フィールド名、署名のコンテキスト、例の形式）を
**どう呼び、どう示すか**を訂正し、`schemas/v2/`、署名を行う 4 つの SDK、共有ベクターがすでに使っている形式に
合わせるものです。スキーマ、コンテキスト、正規化プロファイル、SDK の動作、受け入れの判断はいずれも変わりません。
別名も追加しません。ここで訂正したラベルやフィールド名がワイヤー上の名前の代わりに受け入れられることはなく、
これらの正誤より前に作成された記録が改名・変換されることもありません。

ここでいう互換性は、現在のスキーマと SDK のワイヤーフォーマットおよび受け入れ動作を対象とし、未確認の第三者
実装の動作を対象とはしません。例に記載された旧ラベルを使っていた実装には、明示的な移行の判断が必要です。
既存の署名済みの証拠のラベルを変更したり、内容を書き換えたりしてはならず、これらの正誤は署名コンテキスト間の
自動フォールバックを認めません。

<a id="1-scope"></a>

## 1. 範囲

| 正誤 | 仕様とセクション | 対象 |
|------|------------------|------|
| E1 | DCP-AI v2.0 §4.1 | すでに使われているコンテキスト登録表の行 |
| E2 | DCP-05 §2、§4.4（最後の文）、§10.5、§11 の項目 7 | ライフサイクル記録の署名コンテキスト |
| E3 | DCP-05 §5.1 と §6.2 | バイタリティレポートにおけるバイタリティのフィールド名 |
| E4 | DCP-08 §2、§9.5、§10 の項目 8 | 権利記録の署名コンテキスト |
| E5 | DCP-09 §2、§10.6、§11 の項目 9 | 委任記録と認識記録の署名コンテキスト |
| E6 | DCP-09 §3.6 | マンデートの期限を持つフィールド |
| E7 | DCP-05 §3.3、§4.2、§6.2、§8.2、§9.2。DCP-08 §4.2、§5.2、§6.2、§8.2。DCP-09 §3.2、§4.2、§5.2、§6.2、§7.2、§9.2 | JSON の例の位置づけ |
| E8 | DCP-05、DCP-08、DCP-09 の「実装に関する注記（参考）」 | 注記の優先順位の文 |

<a id="2-layers"></a>

## 2. 層

V2.0 の記録は 4 つの層で確認されます。これらの確認は互いに代わりにはなりません。1 つの確認に合格しただけでは、
完全な適合の証明にはなりません。検証（層 3）は記録を正規化するため層 1 を必要とし、層 4 は関係する記録について
層 1〜3 を必要とします。

1. **表現可能**：正規化プロファイル `dcp-jcs-v1` が記録を受け入れる
   （[CANONICALIZATION_PROFILE.md](CANONICALIZATION_PROFILE.md)）。整数でない数値は表現できません。
2. **スキーマ上有効**：記録が `schemas/v2/` の自身のスキーマに対して検証に通る。スキーマ上有効な記録でも表現
   できない場合があり（たとえばバイタリティのメトリクス `0.5`）、スキーマが確認するのは形と範囲であって意味では
   ありません。
3. **暗号学的に検証済み**：複合署名が、コンテキスト登録表が割り当てるコンテキストのもとで DCP-AI v2.0 §5 の定義どおりに
   検証される。古典署名はドメイン分離されたメッセージ `UTF8(context) || 0x00 || canonical bytes`（§4）に対する
   もので、`pq_over_classical` のバインディングでは、耐量子署名はそのメッセージに古典署名を続けたものに対する
   ものです。鍵を持つ者による宣言を認証するものであり、記録の内容が真実であることや、要求どおりに計算された
   ことを示すものではありません。
4. **機能的に適合**：実装が仕様そのものの要件（各「適合性」セクションの計算、署名者、手続き、間隔、強制）を
   満たす。層 1〜3 は関係する記録について必要ですが、この層には十分ではありません。

<a id="3-errata"></a>

## 3. 正誤

<a id="e1-context-registry-dcp-ai-v20-41"></a>

### E1. コンテキスト登録表（DCP-AI v2.0 §4.1）

§4.1 の表に `DCP-AI.v2.MultiPartyAuth`、`DCP-AI.v2.Lifecycle`、`DCP-AI.v2.Succession`、`DCP-AI.v2.Dispute`、
`DCP-AI.v2.Rights`、`DCP-AI.v2.Awareness` の行が加わり、`DCP-AI.v2.Delegation` の行にはプリンシパルミラーも
記載されます。これらのコンテキストは、署名を行う 4 つの SDK がすでに定義しており、
`tests/interop/v2/interop_vectors.json#domain_separation_all_contexts` がバイト単位でカバーしています。これらの
行はそれを記載するもので、タグを追加するものではありません。その他の行は変わりません。

<a id="e2-lifecycle-signatures-dcp-05"></a>

### E2. ライフサイクルの署名（DCP-05）

DCP-05 がドメイン分離タグ `DCP-LIFECYCLE-SIG-v2` を挙げている箇所では、V2.0 のワイヤー上のコンテキストは
`DCP-AI.v2.Lifecycle` で、DCP-AI v2.0 §4 と §5 の定義どおりに、各ライフサイクル記録（`schemas/v2/` の
`commissioning_certificate`、`vitality_report`、`decommissioning_record`）の `composite_sig` に適用されます。
ラベル `DCP-LIFECYCLE-SIG-v2` は V2.0 のコンテキストではありません。運用開始証明書が権限者の署名とプリンシパルの
副署を持つという §4.4 の要件は変わりません（セクション 4 を参照）。

<a id="e3-vitality-field-dcp-05"></a>

### E3. バイタリティのフィールド（DCP-05）

V2.0 のバイタリティレポートは、§5.1 の複合バイタリティをフィールド `vitality_score`（0〜1000 の整数、
`schemas/v2/vitality_report.schema.json`）に持ちます。§6.2 の例で `vitality` と呼ばれているフィールドがこの値
です。§5.1 の定義、構成要素、重み、`floor` と §5.2 のしきい値は変わりません。スキーマは範囲を確認し、署名は
宣言された値を認証しますが、どちらも値が §5.1 の要求どおりに計算されたことは示しません。V2.0 スキーマの
`metrics` オブジェクトは §5.1 の 4 つの構成要素のスコアとは別の量を持ち、そのメトリクスからスコアを計算する
SDK のヘルパーは別の入力を使い、切り捨てではなく丸めを行います。これらは §5.1 への適合を示しません。

<a id="e4-rights-signatures-dcp-08"></a>

### E4. 権利の署名（DCP-08）

DCP-08 がタグ `DCP-RIGHTS-SIG-v2` を挙げている箇所では、V2.0 のワイヤー上のコンテキストは `DCP-AI.v2.Rights` で、
`rights_declaration`、`obligation_record`、`rights_violation_report` の `composite_sig` に適用されます。権利宣言を
運用開始の権限者の鍵に対して検証するという §9.1 の要件は変わりません。

<a id="e5-delegation-and-awareness-signatures-dcp-09"></a>

### E5. 委任と認識の署名（DCP-09）

DCP-09 がタグ `DCP-DELEGATION-SIG-v2` と `DCP-AWARENESS-SIG-v2` を挙げている箇所では、V2.0 のワイヤー上の
コンテキストは次のとおりです。

| 記録 | 署名フィールド | コンテキスト |
|------|----------------|--------------|
| ルートの委任マンデート | `human_composite_sig` | `DCP-AI.v2.Delegation`（§3.5.1 にすでに記載） |
| サブマンデート | `delegator_composite_sig` | `DCP-AI.v2.SubMandate`（§3.5.1 にすでに記載） |
| プリンシパルミラー、やり取りの記録 | `composite_sig` | `DCP-AI.v2.Delegation` |
| 認識しきい値、助言の宣言 | `composite_sig` | `DCP-AI.v2.Awareness` |

§3.5 のマンデートチェーンの規則は変わりません。

<a id="e6-mandate-expiry-dcp-09-36"></a>

### E6. マンデートの期限（DCP-09 §3.6）

「`effective_until` のタイムスタンプを過ぎる」は「`valid_until` の時点を過ぎる」と読みます。V2.0 のマンデートの
期間は `valid_from` / `valid_until`（`schemas/v2/delegation_mandate.schema.json`、必須）で、§3.5.2 の要求どおり
RFC 3339 の時点として比較されます。§3.2 の例の `effective_from` / `effective_until` はこれらのフィールドです。
`valid_until` の代わりに `effective_until` を持つマンデートは、スキーマによって拒否され、キットが実行するとおり
TypeScript のチェーン検証器によっても拒否されます。

<a id="e7-examples"></a>

### E7. 例

セクション 1 に挙げたセクションの JSON の例は、各記録の内容を説明するものです。V2.0 のワイヤーフォーマットでも
フィクスチャでもなく、書かれたままでは、2 つの別々の理由から有効な V2.0 の記録ではありません。`alg`、`kid`、
`sig_b64`、`domain_sep` を持つ `signature` / `countersignature` / `agent_acknowledgment` のブロック、スキーマに
ない `record_type`、`prev_hash_secondary`、`merkle_root` のフィールド、スキーマと異なるその他のフィールド名は、
正規化できる場合でも記録をスキーマ上無効にします。整数でない値（たとえば `error_rate_percent: 0.3`、
`capacity_threshold: 0.80`、`threshold: 0.3`、`confidence: 0.95`）は `dcp-jcs-v1` のもとで表現できません。
`schemas/v2/` に公開されたスキーマを持つ記録では、そのワイヤーフォーマットは、そのスキーマと `dcp-jcs-v1` の
正規化を合わせたものに、E2、E4、E5 のとおりに署名したものです。挙げた例の一部には、それ自身の公開スキーマが
ありません。DCP-05 §3.3 の遷移記録と、DCP-05 §9.2、DCP-08 §8.2、DCP-09 §9.2 の監査エントリーで、後者は
`schemas/v2/audit_entry.schema.json` にも合致しません。このような例はスキーマを定義せず、これらの正誤によって
有効なワイヤー上の記録になることもありません。これらのセクションの本文が定める要件は変わりません。

<a id="e8-implementation-notes"></a>

### E8. 実装に関する注記

DCP-05、DCP-08、DCP-09 の参考注記にある「食い違う場合は、上の規範的な本文がそのまま有効です。」という文は、
「食い違う場合は、上の規範的な本文が、[V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md) の正誤による訂正を
含めて有効です。」と読みます。

<a id="4-requirements-the-v20-structures-do-not-represent-directly"></a>

## 4. V2.0 の構造が直接表現しない要件

これらの要件は引き続き規範的です。以下に挙げる記録の V2.0 スキーマは、記録ごとに署名を 1 つだけ、または閉じた
値の集合を持つため、これらの記録はこれらの要件を直接表現せず、SDK のヘルパーだけではこれらを満たしません。
これらの記録の外にある仕組みでこれらを満たせるかどうかは、機能的な要件そのものを示せるかどうかにかかっており、
これらの正誤はそれを確立も前提もしません。記録の中でこれらを表現するには、明示的でバージョン管理された設計
（新しいスキーマのバージョンまたはプロファイル）が必要です。これらの正誤はそのようなものを定義も有効化もしません。

| 要件 | V2.0 の記録がそれを持たない理由 |
|------|----------------------------------|
| DCP-05 §4.4：権限者の署名とプリンシパルの副署 | `composite_sig` が 1 つだけ。2 人目の署名者のためのフィールドがない |
| DCP-05 §5.1 の構成要素のスコア | スキーマの `metrics` は別の量。持つのは `vitality_score` だけ |
| DCP-05 §6 の小数のメトリクス | `dcp-jcs-v1` は整数しか受け入れないため、スキーマの [0, 1] のメトリクスは 0 か 1 しか表現できない |
| DCP-08 §4.3 の逆ドメイン表記による組織の権利 | `right_type` は 4 つの基本的な権利の閉じた enum |
| DCP-08 §9.1：運用開始の権限者による署名 | 記録は署名者の役割を示さず、ヘルパーもそれを確認しない |
| DCP-09 §3.3：エージェントの確認応答。§6.3：ミラーへのプリンシパルの署名 | 記録ごとに署名が 1 つ |

SDK のバイタリティスコアのヘルパーは、小数の入力を受け取ると、端数がちょうど半分の場合の扱いも互いに異なります
（`task_completion_rate` 0、`error_rate` 1、`human_satisfaction` 0.002、`policy_alignment` 0 の場合、
TypeScript のヘルパーは 1、Python のヘルパーは 0 を返します）。これらの入力は署名済みのレポートでは表現できず、
この相違は別の未解決事項であって、プロトコルの要件ではありません。

<a id="5-evidence"></a>

## 5. 根拠

| 正誤 | 参照 |
|------|------|
| E1 | `sdks/typescript/src/core/domain-separation.ts`、`interop_vectors.json#domain_separation_all_contexts`、キットのケース `ext.wire.contexts.registry_documented` |
| E2、E4、E5 | `schemas/v2/{commissioning_certificate,vitality_report,decommissioning_record,rights_declaration,obligation_record,rights_violation_report,delegation_mandate,principal_mirror,interaction_record,awareness_threshold,advisory_declaration}.schema.json`、キットのケース `ext.wire.dcp0*.*.signed`、`ext.wire.context.*` |
| E3 | `schemas/v2/vitality_report.schema.json#/properties/vitality_score`、キットのケース `ext.wire.dcp05.vitality_field_name.schema_rejected`、`ext.wire.tamper.vitality_score_changed` |
| E6 | `schemas/v2/delegation_mandate.schema.json#/required`、`tests/interop/v2/mandate_chain_vectors.json`（`expired_at_verification_time`、`validity_*`）、キットのケース `ext.wire.dcp09.effective_until.*` |
| E7、セクション 4 | キットのケース `ext.wire.dcp05.fractional_metric.*`、`ext.wire.dcp08.extension_signed_but_schema_invalid`、`ext.wire.dcp05.countersignature.schema_rejected`、`ext.wire.fixture.*` |

キットのケースは、[`tools/conformance`](../tools/conformance/README.md) のスイート `ext.dcp05_09.wire` に属します。
