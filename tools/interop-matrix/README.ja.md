<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="interop-matrix-live-agents-across-the-four-sdks"></a>

# 相互運用のマトリクス：4 つの SDK にまたがる稼働中のエージェント

> [英語版](README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

`run.mjs` は **SDK ごとに 1 つのエージェントのプロセス**（TypeScript、Python、Go、Rust）を起動し、
互いに協働させます。ある SDK の上に作ったエージェントがアイデンティティを作り、意図を宣言し、行動し、
市民権のバンドルに署名します。別の SDK の上に作ったエージェントは、相手を信頼する前にそうするように、
それらを検証します。ここでの検証とは、バンドルが一貫しており、それ自身が列挙する鍵で署名されていることを意味します。
相手への信頼、アドミッション、行動の認可ではありません（シナリオ 2 はアドミッションを扱いますが、それも
どの行動も認可しません）。プロセスはオーケストレーターが中継するメッセージ以外に何も共有しないため、
すべての組（4 つの SDK で 16 組。各 SDK とそれ自身の組を含む）はファイルの比較ではなく、本当の相互運用です。
5 番目の、検証だけをするエージェント `ref` は、リファレンスの検証器 `lib/verify.js`（`node bin/dcp.js verify-bundle`
と検証サーバーが実行するもの）を実行します。これは `@dcp-ai/sdk` の検証器（2.2.0 が npm に出るまではワークスペースの SDK）の
前に、すべてのアーティファクトを `schemas/v2` に照らして検証します。SDK の検証器はこれをしません。

オーケストレーターは間のネットワークでもあります。転送中のバンドルを改ざんし、各
検証器は改ざんされたすべてのバンドルを同じように拒否しなければなりません。予期しない判定、クラッシュ、時間切れは
どれも実行を失敗させます。

シナリオ 1（`run.mjs`）は、DCP-01（アイデンティティ）、DCP-02（意図とポリシー）、DCP-03（監査）の一部を
SDK の間で試します。これらの仕様の完全な適合性テストではありません。
シナリオ 2（`admission.mjs`）は、4 つの SDK にまたがって `strict-v1` のプロファイル
（`spec/profiles/admission`）のもとでのアドミッションを扱います。DCP-04 の A2A のハンドシェイクには、まず SDK の作業が必要です
（最後のロードマップを参照）。

<a id="run"></a>

## 実行

```bash
(cd sdks/typescript && npm install && npm run build) # agents/ts imports sdks/typescript/dist
npm install                                           # agents/ref: the reference verifier, on that SDK
pip install -e sdks/python                            # dependencies of agents/py
node tools/interop-matrix/run.mjs                     # all four SDKs and the reference verifier
node tools/interop-matrix/run.mjs --agents ts,py      # a subset
node tools/interop-matrix/admission.mjs               # scenario 2, the four SDKs, with its negative control
```

Go と安定版の Rust のツールチェーンが `PATH` になければなりません。`run.mjs` は `agents/go` と `agents/rust` をビルドします。
オプション：`--agents a,b`（`ts`、`py`、`go`、`rust`、`ref` のいずれか）、`--python PATH`（既定は `$INTEROP_PYTHON` または `python3`）、`--timeout MS`
（リクエストごと、既定は 60000）、`--out DIR`（既定は `tools/interop-matrix/out` で、レポートと、
予期しない判定を出したすべてのバンドルがここに書かれます）。`admission.mjs` は `ref` を除いて同じ
オプション（既定は `--out tools/interop-matrix/out/admission`）に加え、
`--skip-negative-control`、`--negative-control`、`--check-negative-control`、`--replay FILE`
（後述）を受け取ります。

<a id="the-agent-protocol"></a>

## エージェントのプロトコル

エージェントは stdin から 1 行に 1 つの JSON のリクエストを読み、各リクエストにちょうど 1 行の JSON の応答を
stdout に順番に書きます。それ以外はすべて stderr に出します。

```json
{"id": 1, "cmd": "identity", "args": {"owner_name": "Interop Owner", "jurisdiction": "CL"}}
{"id": 1, "ok": true, "result": {"agent_id": "agent:…", "human_id": "rpr:…", "session_nonce": "…"}}
{"id": 2, "ok": false, "error": "message"}
```

エージェントは自身の状態（鍵、アイデンティティ、意図、監査証跡）を、プロセスが生きている間メモリーに保持します。
鍵がそこから出ることはありません。以下で契約が定める値は、書かれたとおりに正確に生成しなければなりません。
それ以外はすべて SDK 自身の問題で、それこそがマトリクスがテストするものです（SDK が独自に加える省略可能な
フィールド、たとえば Go の SHA3 の `audit_merkle_root_secondary` は、すべての検証器が受け入れる限り
問題ありません）。

### `identity` `{owner_name, jurisdiction}` → `{agent_id, human_id, session_nonce, principal_keys, agent_keys}`

2 つの複合鍵ペア（Ed25519 + ML-DSA-65）を生成します。1 つは人のプリンシパル用、1 つは
エージェント用です。新しいセッションの nonce（64 文字の 16 進数）、`human_id` = `rpr:<uuid4>`、`agent_id` = `agent:<uuid4>` も作ります。
鍵のエントリー：`{kid, alg, public_key_b64, created_at: <now RFC 3339>, expires_at: null, status: "active"}`。

- **RPR**（`schemas/v2/responsible_principal_record.schema.json`）：`dcp_version "2.0"`、`human_id`、
  `session_nonce`、`legal_name` = `owner_name`、`entity_type "natural_person"`、`jurisdiction`、
  `liability_mode "owner_responsible"`、`override_rights true`、`issued_at` は現在時刻、`expires_at null`、
  `contact null`、`binding_keys` = 人の 2 つの鍵のエントリー。`ResponsiblePrincipal` のコンテキストのもとで、
  **人**の鍵で複合署名（`pq_over_classical`）された `SignedPayload`。
- **パスポート**（`agent_passport.schema.json`）：`dcp_version "2.0"`、`agent_id`、`session_nonce`、
  `keys` = エージェントの 2 つの鍵のエントリー、`principal_binding_reference` = `human_id`、
  `capabilities ["api_call", "payments"]`、`risk_tier "medium"`、`created_at` は現在時刻、
  `status "active"`。`AgentPassport` のもとで**エージェント**の鍵で複合署名される。

`principal_keys` と `agent_keys` は公開の半分で、`[{kid, alg, public_key_b64}]`、クラシカルのものが
先です。シナリオ 2 はそれらから、帯域外でプリンシパルを登録します。

2 回目の `identity` は 1 回目を、それに伴う意図と証跡とともに置き換えます。

### `intent` `{action_type, channel, data_classes, estimated_impact, risk_score, applied_policy_hash}` → `{intent_id, decision, security_tier}`

- **意図**（`intent.schema.json`）：`dcp_version "2.0"`、`intent_id` = `intent:<uuid4>`、
  `session_nonce`、`agent_id`、`human_id`、`timestamp` は現在時刻、`action_type`、
  `target {channel, to: null}`、`data_classes`、`estimated_impact`、
  `requires_consent` = （`estimated_impact` が `"high"` か）、`security_tier` = この意図と `risk_score` についての
  SDK のセキュリティティアの計算（DCP-AI v2.0 §14.2）。
- **ポリシー判断**（`policy_decision.schema.json`）：`dcp_version "2.0"`、`intent_id`、
  `session_nonce`、`decision` = `risk_score` < 500 なら `approve`、< 800 なら `escalate`、それ以外は
  `block`。`risk_score`、`reasons ["interop-matrix: risk_score <n>"]`、`required_confirmation` は
  approve なら `null`、それ以外は `{"type": "human_approve", "fields": ["action_type"]}`、
  `applied_policy_hash` は引数から、`timestamp` は現在時刻、`resolved_tier` = 意図の
  `security_tier`。

どちらも**エージェント**の鍵で複合署名されます（`Intent`、`PolicyDecision` のコンテキスト）。

### `act` `{intent_id, outcome, tool, result_ref}` → `{audit_id, count}`

その意図の証跡に監査エントリー（`audit_entry.schema.json`）を 1 つ追加します：`dcp_version "2.0"`、
`audit_id` = `audit:<uuid4>`、`session_nonce`、`prev_hash` = 証跡の最初のエントリーなら `"GENESIS"`、
それ以外は `"sha256:" + hex(sha256(canonical(previous entry)))`、`hash_alg "sha256"`、
`timestamp` は現在時刻、`agent_id`、`human_id`、`intent_id`、
`intent_hash` = `"sha256:" + hex(sha256(canonical(intent payload)))`、
`policy_decision` = 判断に応じて `approved` / `escalated` / `blocked`、`outcome`、
`evidence {tool, result_ref, evidence_hash: "sha256:" + hex(sha256(utf8(result_ref)))}`、
`pq_checkpoint_ref null`。`count` は証跡の長さです。このエントリーは合成の記録です。`act` は何も実行せず、
`outcome`、`tool`、`result_ref` はオーケストレーターが送る文字列です。

### `bundle` `{intent_id, session_issued_at?, session_expires_at?, intended_verifier?}` → `{signed_bundle}`

その意図の市民権のバンドル（`signed_bundle.schema.json`）です。署名された RPR、パスポート、
意図、ポリシー判断、意図の証跡の全体、そしてマニフェスト：`session_nonce`、
`rpr_hash` / `passport_hash` / `intent_hash` / `policy_hash`（ペイロードのハッシュ）、
`audit_merkle_root`（`"sha256:"` + SDK の監査の Merkle ルート）、`audit_count`、
`canonicalization_profile "dcp-jcs-v1"`。署名：`hash_alg "sha256"`、`created_at` は現在時刻、
`signer {type: "human", id: human_id, kids: [human classical kid, human pq kid]}`、
`manifest_hash`、`Bundle` のコンテキストのもとで**人**の鍵による `composite_sig`。SDK の
バンドルのビルダーと署名者を使ってください。Go と Rust のビルダーは `audit_merkle_root_secondary` も書きます。
省略可能な引数は、署名の前に、与えられたとおりにマニフェストに入ります。

### `verify` `{signed_bundle, mode}` → `{valid, errors}`

SDK の V2 のバンドルの検証器です。`mode` が `""` なら既定の検証器のポリシーで、それ以外の値は、相互運用のテストと同じく、
`default_mode` とすべてのリスクティアに適用される検証モードです。不正な形式の
バンドルは `valid: false` の結果で、決してエラーの応答にはなりません。

### `rotate_principal` `{}` → `{human_id, principal_keys}`

プリンシパルの新しい複合鍵ペアと、同じ `human_id`、現在時刻の `issued_at`、
新しい `binding_keys` を持ち、新しい鍵で署名された新しい RPR です。以降のバンドルはそれらを使います。

<a id="configure-tenant-trust_set-profile---or-config_error"></a>
<a id="configure-tenant-trust_set-profile-or-config_error"></a>

### `configure` `{tenant, trust_set, profile}` → `{}` または `{config_error}`

テナントの運用者の設定で、SDK 自身のローダーで読み込みます。信頼セット
（`createPrincipalTrustStore` とその対応物）と `strict-v1` のプロファイル
（`resolveStrictV1Profile`）です。設定のエラーは `{config_error: <CONFIG_* code>}` です。

<a id="admit-tenant-signed_bundle-revocation-now_ms--the-admission-result"></a>
<a id="admit-tenant-signed_bundle-revocation-now_ms-the-admission-result"></a>

### `admit` `{tenant, signed_bundle, revocation, now_ms}` → アドミッションの結果

テナントのプロファイルと信頼セット、失効のスナップショット、時計を使った、SDK の統合された
アドミッションの API（`admitSignedBundleV2` とその対応物）です。結果は SDK 自身の JSON の形
（spec §8）から `verification` を除き、`verification_errors` を加えたものです。

### `shutdown` `{}` → `{}`

エージェントは応答した後に終了します。

<a id="scenario-1-dcp-01-to-dcp-03"></a>

## シナリオ 1：DCP-01 から DCP-03

各 SDK を**生成側**として：`identity`、3 回の `act` を伴う定型の意図（`api_call`、チャネル `api`、
`["none"]`、影響 `low`、リスク 100）、1 回の `act` を伴う支払いの意図（`initiate_payment`、
チャネル `payments`、`["financial_data"]`、影響 `high`、リスク 900 なのでブロックされる）
（拒否も証拠です）、そして両方の `bundle`。次に各 SDK を**検証側**として、両方の
バンドルを既定のポリシーと `hybrid_required` のもとで確認します。どちらも検証を通らなければなりません。

その後、オーケストレーターは転送中の定型のバンドルを改ざんし、各検証器は、注記がない限り両方のモードで、
それぞれのコピーを拒否しなければなりません：

| 攻撃 | 何が変わるか |
|---|---|
| `intent_changed` | 署名の後に `intent.payload.estimated_impact` が `high` になる |
| `audit_reordered` | 最初の 2 つの監査エントリーの位置が入れ替わる |
| `audit_entry_dropped` | 最後の監査エントリーが削除され、マニフェストは保たれる |
| `session_spliced` | マニフェストの `session_nonce` が置き換えられる |
| `bundle_signature_swapped` | バンドルの署名が支払いのバンドルのものになる |
| `passport_swapped` | パスポートが別のエージェント（次の SDK の生成側）のものになる |
| `pq_stripped` | バンドルの署名の `pq` の枠が削除される（`classical_only`）。`hybrid_required` のみ |
| `intent_from_other_bundle` | 意図とポリシー判断が支払いのバンドルから来る（同じセッションと署名者） |
| `trail_from_other_bundle` | 監査証跡が支払いのバンドルから来る（同じセッションと署名者） |

クラッシュする、時間切れになる、順番を外れて答えるエージェントは停止され、以降のそれへのリクエストは
ただちに失敗するため、壊れたエージェントは失敗として現れ、実行が止まったままになることはありません。

<a id="scenario-2-admission-under-strict-v1"></a>

## シナリオ 2：`strict-v1` のもとでのアドミッション

各 SDK を**生成側**として：`identity`、1 回の `act` を伴う定型の意図（リスク 100 なので `approve`）、
そしてマニフェストがセッションの期間 `[T0, T0 + 300 s]`（プロファイルの最大）に署名する 3 つのバンドルです。
1 つはこの検証器（`verifier:interop-admission`）向け、1 つは別のオーディエンス向け、そして
`rotate_principal` の後に、ローテーションしたプリンシパルの鍵で署名したものです。

オーケストレーターが運用者です。生成側が報告した公開鍵から各プリンシパルを登録し
（アドミッション中のバンドルからは決して登録しません）、信頼セットを作り、失効の
スナップショットを提供します。生成側のエージェントと鍵で、`checked_at` は時計の 10 秒前です。各アドミッションは
固定の時刻 `T0 + 120 s`（期限切れのケースは期限の 1 ミリ秒後）に実行されます。テナント A と B は、
ハーネスが行う運用者の設定の選択です。どの統合もキャッシュも関与しません。

各 SDK を**利用側**として、各生成側について以下の 13 のケースを、この順に、1 つの
プロセスで実行します。期待される `verified`、`principal_trust`、`profile`、`profile_compliance`、`admitted`、
`action_authorized`（常に `false`）、`recorded_decision`、`trust_set_version`、コードの集合は、
仕様から来て `admission.mjs` に書かれており、決して SDK からは来ません。

| ケース | 設定 | 期待値 |
|---|---|---|
| `trusted_admitted` | テナント A が登録済みのすべてのプリンシパルを信頼する | 受け入れ |
| `trust_withdrawn` | このプリンシパルを除いたテナント A、同じバンドル | `TRUST_PRINCIPAL_UNKNOWN` |
| `trust_restored` | 以前と同じテナント A、同じバンドル | 受け入れ |
| `tenant_b_empty_trust` | テナント B、空の信頼セット | `TRUST_PRINCIPAL_UNKNOWN` |
| `principal_key_revoked` | 新しいスナップショットがプリンシパルの鍵を失効させる | `REVOCATION_REVOKED` |
| `agent_key_revoked` | 新しいスナップショットがエージェントの鍵を失効させる | `REVOCATION_REVOKED` |
| `other_audience` | 別の検証器向けに署名されたバンドル | `PROFILE_AUDIENCE_MISMATCH`, `VERIFICATION_FAILED` |
| `session_expired` | 署名された期限の 1 ミリ秒後の時計 | `PROFILE_SESSION_EXPIRED`, `VERIFICATION_FAILED` |
| `rotation_new_keys_not_enrolled` | ローテーションしたバンドル、更新していない信頼セット | `TRUST_KEY_NOT_ANCHORED` |
| `rotation_overlap_new_keys` | 古い鍵と新しい鍵が有効 | 受け入れ |
| `rotation_overlap_old_keys` | 同じ、元のバンドル | 受け入れ |
| `rotation_old_keys_retired` | 古い鍵が `revoked`、元のバンドル | `TRUST_KEY_REVOKED` |
| `rotation_new_keys_after_retirement` | 同じ、ローテーションしたバンドル | 受け入れ |

不一致があると、出力ディレクトリに最小の再現が書かれます。そのアドミッションについて利用側に与えられたものすべてで、
テナントの**実効の**信頼セットとプロファイル（最後に読み込まれたもの。前のケースが読み込んだ場合も
`configuration_loaded_in` とともに含む）、そしてそれが返したものです。公開の材料だけで、秘密鍵は含みません。

```bash
node tools/interop-matrix/admission.mjs --replay tools/interop-matrix/out/admission/<producer>-<consumer>-<case>.json
```

`--replay` は、記録された SDK の新しい利用側を起動し、記録されたテナントを設定し、記録された
バンドルを記録された時計でアドミッションにかけ、記録された出力と完全に一致することを求めます。
両側のすべてのキー（正規化したフィールド、コード、検証器のエラー、呼び出しが失敗したときの `error`）で、
片側にだけあるキーは違いとなるため、異なる 2 つのエラーが再現と見なされることはありません。
再現すれば 0、異なれば 1、記録が不完全なら 2 で終了します。

**ネガティブコントロール。** マトリクスの後、ランナーは `ts` の組について、新しい一時ディレクトリと
新しい実行 ID で、最大 120 秒、`--negative-control` を付けて自身を起動します。その実行は
`trust_withdrawn` の期待される `admitted` を反転します。コントロールが合格するのは、子が 1 で終了し、その
レポートがこの実行で書いたもの（同じ実行 ID）で `negative_control_run: true` を持ち、唯一の
組 `ts>ts` が 13 中 12 で、失敗がちょうど 1 つ、`trust_withdrawn` の `admitted` のフィールドである場合だけです。
`--check-negative-control` はコントロール自体をテストします。正しい実行を受け入れ、起動できない子
（レポートがない場合と、同じディレクトリに前の実行が残したレポートがある場合）と、止まったままの子
（時間の上限で停止）を拒否しなければなりません。`--negative-control-case NAME` は代わりに別の
ケースを反転し、意図的に再現のファイルを作ります。

最初の実行：16 組 × 13 ケース = 208 の結果がすべて期待どおりで、ネガティブコントロールは
求められたとおりに失敗しました。

<a id="what-the-first-run-found"></a>

## 最初の実行が見つけたこと

16 の SDK の組とリファレンスの検証器は、すべてのバンドルとすべての攻撃について一致します。エージェントを
書く中で、次の SDK の欠落が見つかりました。どれも SDK の検証器の間の判定の食い違いではありません：

- **Go の `SignBundleV2` が `signature.signer.id` を空のままにしていた**：署名者の ID を受け取っていませんでした。4 つの
  SDK の検証器はそのようなバンドルを受け入れ、リファレンスの検証器、CLI、サーバーは拒否していました
  （`signer/id must NOT have fewer than 6 characters`）。修正済み：署名者は今ではバンドルの RPR の `human_id` で、
  Go のエージェントは `SignBundleV2` をそのまま使います。`signature.signer` のブロック（`id`、`kids`）、
  `created_at`、`manifest_hash` は、署名されたマニフェストの外にある認証されていないメタデータです。どの
  検証器もそれらを RPR と照合せず、`manifest_hash` を再計算もしません（5 つすべてがゼロを受け入れます）。
  それらの形を制約するのはスキーマだけです。
- **Go の型付きのペイロードにティアのフィールドがなかった**：`IntentV2` には `security_tier` がなく、
  `PolicyDecisionV2` には `resolved_tier` がありませんでした。今は両方あります。（`contact` と `target.to` は
  スキーマ上は省略可能なので、Go のエージェントのマップが `null` を書くのは契約に合わせるためだけです。）
- **Rust のネイティブの API にはバンドルのビルダーも署名者もなかった**ため、Rust のエージェントは
  プリミティブからマニフェストを組み立てて署名していました。修正済み：`build_bundle_v2` と `sign_bundle_v2`
  （`dcp_ai::v2::bundle`）で、エージェントは今それを使います。`wasm` のフィーチャーの `wasm_build_bundle` と
  `wasm_sign_bundle` は今それらを呼びます。以前は `wasm_sign_bundle` が `created_at ""` を書き、
  `signer.id` を書かなかったため、リファレンスの検証器はそれが署名したすべてのバンドルを拒否していました。
- **空の監査証跡**：`spec/VERIFICATION.md` が認めるとおり（64 個のゼロのルート）、すべての検証器は
  監査エントリーのない正しく署名されたバンドルを受け入れます。PQ のチェックポイントに使われる
  `auditEventsMerkleRoot` のヘルパーは、4 つの SDK すべてで同じく空のリストを拒否します。

> **注記（2026 年 10 月 25 日）。** 上の発見は、最初の実行で記録されたとおりに残しています。最初のものは `main` では
> もう当てはまりません。4 つの SDK の検証器は今では、署名されていない `signature` のブロックを署名された内容と照合します
> （`spec/VERIFICATION.md` V2-4）。`signer.id` は RPR の `human_id`、`signer.kids` は複合署名の kid、
> `manifest_hash` は正規のマニフェストの SHA-256、`hash_alg` は許可された値でなければならないため、ゼロは
> 拒否されます。`signature.created_at` は、どの検証器も認証しない、署名されていないメタデータのままです。

<a id="roadmap"></a>

## ロードマップ

1. シナリオ 1（DCP-01 から 03）と 2（アドミッション）を CI で。
2. DCP-04：現在すべての SDK は `A2A_HELLO` と `A2A_WELCOME` を作りますが、どれも
   `A2A_CONFIRM` / `A2A_ESTABLISHED` や DCP-04 §3.4 のセッション鍵の導出を実装しておらず、メッセージが告げる
   ハイブリッドの X25519 + ML-KEM-768 の KEM を持つのは TypeScript だけで、Rust にはセッションの層がありません。
   それらが揃えば、プロトコルに `hello`、`welcome`、`confirm`、`send`、`receive` が加わり、
   オーケストレーターは 2 つのエージェントの間でメッセージを再送し、並べ替え、つなぎ替えます。
3. 異なる SDK のエージェントが 1 ホップずつ作る DCP-09 のマンデートの連鎖。
