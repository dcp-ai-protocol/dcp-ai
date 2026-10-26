<sub>[English](EU_AI_ACT_MAPPING.md) · [中文](EU_AI_ACT_MAPPING.zh-CN.md) · [Español](EU_AI_ACT_MAPPING.es.md) · **日本語** · [Português](EU_AI_ACT_MAPPING.pt-BR.md)</sub>

<a id="dcp-ai-and-the-eu-ai-act--mapping-of-logging-human-oversight-and-record-keeping-obligations"></a>
<a id="dcp-ai-and-the-eu-ai-act-mapping-of-logging-human-oversight-and-record-keeping-obligations"></a>

# DCP-AI と EU AI 法 — ロギング、人間による監督、記録保存の義務との対応

> [英語版](EU_AI_ACT_MAPPING.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

**仕様のバージョン：** 2.0
**最終更新：** 2026 年 10 月
**法令レビューの日付：** 2026 年 10 月 22 日
**ステータス：** 参考情報。法令の資料は 2026 年 10 月 22 日に読んだもの（第 7 節）。実装の対応付けは 2026 年 10 月 25 日時点の `main` の仕様、スキーマ、SDK を記述し、最後のリリースである v2.10.0 と異なる点、そして仕様が求めていても SDK の関数が行わない点を明記する

この文書は、規則 (EU) 2026/1744（「Digital Omnibus on AI」）によって改正された規則 (EU) 2024/1689（「AI 法」）の義務のうち、トレーサビリティ、ロギング、人間による監督、記録保存、説明、インシデントの証拠に関わるものを、DCP-AI のアーティファクト、サービス、SDK の関数に対応付けます。構成は [NIST_CONFORMITY.md](NIST_CONFORMITY.md) にならい、番号付きの節、対応表、実装者向けチェックリスト、そしてギャップの明示的な一覧から成ります。

以下で引用する条文はすべて、2026 年 10 月 22 日に EUR-Lex の公式テキストで読んだものです。基礎となるテキストは公布されたままの規則（CELEX 32024R1689）で、改正は官報に掲載された Digital Omnibus on AI から取っています。どの日付がどのテキストに基づくかは第 4 節に記します。本文が規則を引用する箇所では、引用は数語に限り、EUR-Lex で読んだとおり英語のまま残しています。それ以外はすべて言い換えであり、法的な文言として読むべきではありません。

---

<a id="1-scope-and-disclaimer"></a>

## 1. 範囲と免責

DCP-AI はプロトコルであり、証拠の形式です。署名付きのアーティファクト（バンドルの中では Responsible Principal Record、Agent Passport、Intent、Policy Decision がそれぞれ `SignedPayload` であり、ライフサイクル、紛争、権利、委任の記録はそれぞれの関数が署名します）、署名済みのバンドルが 1 件ずつ署名する代わりに監査のマークルルートを通じてコミットする監査エントリ、改ざんを検出できる監査証跡、任意のアンカリングと透明性ログ、そしてそれぞれが自らの経路の範囲だけを確認するローカルの検証器（たとえば V2 のバンドルには `verifySignedBundleV2`）を定義します。

DCP-AI は次のものでは**ありません**。

- AI 法に基づく適合性評価、整合規格、共通仕様、または適合の推定。
- 特定の AI システムのリスク管理システム（第 9 条）、品質管理システム、技術文書（第 11 条）、市販後モニタリング計画（第 72 条）。
- 法的助言。ある エージェントが「AI システム」に当たるか、高リスクか、誰が提供者で誰が導入者かは、組織が法務の助言を得て判断することです。

この文書が行うのはもっと限られたことです。列挙した義務ごとに、証拠を生成する、または制御を課す DCP の仕組みを挙げ、その仕組みがどこまで及ぶか（`supports`、`partial`、`out of scope`）を述べ、提供者や導入者が自ら行うべきことを示します。`supports` と記した行は、第 5 節のとおりに設定すれば仕組みが存在し、その行に書かれたとおりに機能することを意味します。義務が果たされたことは意味しません。

第 3 節で使うカバレッジの値：

| 値 | 意味 |
|-------|---------|
| `supports` | DCP のアーティファクト、検証器のルール、またはリファレンスサービスが、義務の求める仕組みを実装しています。それを正しく運用するのは、引き続き組織の役割です（第 5 節）。 |
| `partial` | DCP は証拠や構成要素を生成しますが、義務の実質的な部分（文書、プロセス、報告、人間の判断）はプロトコルが生成できるものではありません。 |
| `out of scope` | DCP はこれを扱っておらず、これについて引用すべきではありません。 |

---

<a id="2-roles-provider-and-deployer-versus-operator-responsible-principal-and-agent"></a>

## 2. 役割：提供者と導入者、そしてオペレーター、責任あるプリンシパル、エージェント

AI 法は義務を[第 3 条](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_3)で定義された役割に結び付けます。**提供者**（第 3 条 (3)）は、AI システムを開発し、または開発させ、自らの名義で市場に出し、またはサービスに供する者です。**導入者**（第 3 条 (4)）は、私的で非職業的な活動の場合を除き、AI システムを「under its authority」で使用する者です。**AI システム**（第 3 条 (1)）は、「varying levels of autonomy」で動作し、受け取った入力から出力の生成方法を推論する機械ベースのシステムです。規則の義務は、AI システムとその背後にある法的主体に結び付きます。

DCP の役割は、エージェントのインスタンスと、それについて責任を負う人または組織に結び付きます。

| DCP の役割 | 記録される場所 | AI 法での典型的な役割 | 注記 |
|----------|---------------------|---------------------|-------|
| **責任あるプリンシパル** | `schemas/v2/responsible_principal_record.schema.json`：`human_id`、`legal_name`、`entity_type`（`natural_person` または `organization`）、`jurisdiction`、`liability_mode`（`owner_responsible`）、`override_rights`、`binding_keys` | **導入者**、または第 26 条 (2) に基づき導入者が人間による監督を割り当てる自然人 | RPR は、エージェントの行動に責任を負う者を名指しします。`entity_type` が `organization` の場合は通常導入者そのもの、`natural_person` の場合は通常、導入者の内部で `override_rights` を持つ人です。 |
| **エージェント** | `schemas/v2/agent_passport.schema.json`：`agent_id`、`keys`、`principal_binding_reference`、`capabilities`、`risk_tier`、`status` | **AI システム**（またはその構成要素） | DCP のエージェントは、独自の鍵とライフサイクルの状態を持つ、デプロイされたインスタンスです。基盤となるモデルやフレームワークの提供者は、DCP のどのアーティファクトにも現れません。 |
| **オペレーター**（検証サービス、ポリシーエンジン、透明性ログ、アンカーサービス、失効サービスの） | `server/`、`services/`、検証器のポリシー（[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md)） | 通常は**導入者**。提供者がシステムの一部として制御を提供する場合は**提供者**、あるいは第三者 | オペレーターは、検証器のポリシー、監査データの保持、アンカリングの頻度を決めます。第 5 節のいくつかの項目はオペレーターの担当です。 |
| **相手方エージェント**（DCP-04、DCP-09） | `interaction_record.counterparty_agent_id`、委任マンデート | 別の AI システム。別の導入者のものの場合もある | インタラクション記録は、各当事者に相手方のマンデートの証拠を与えます。 |

対応付けへの二つの帰結：

1. **提供者側の義務の多くは `partial` です。** DCP は、モデル、学習データ、意図された目的を知りません。説明責任のレイヤーがどう機能するか（第 3 節、第 11 条の行）は文書化できますが、AI システムそのものは文書化できません。
2. **導入者側のロギングと監督の義務は、DCP が最も強い部分です。** 意図のゲート、ポリシー判断、監査チェーン、RPR の `override_rights`、アドバイザリー宣言、ライフサイクルの状態は、署名付きの証拠を生成する、導入者向けの制御です。

DCP-AI の仕様は、RPR によって結び付けられた人を「human」や「principal」と呼びます。この文書ではその人を「責任あるプリンシパル」と呼び、「導入者」と「提供者」は規則の意味で使います。

---

<a id="3-mapping-table"></a>

## 3. 対応表

各行：EUR-Lex で読んだ条文、義務の短い言い換え、正確な参照付きの DCP の仕組み、カバレッジ、そして組織が引き続き行うべきこと。仕様への参照は `spec/DCP-AI-v2.0.md`（「core §n」）と、プロファイル仕様 `spec/DCP-05.md` から `spec/DCP-09.md` を指します。関数名は TypeScript SDK（`@dcp-ai/sdk`、`sdks/typescript/src/index.ts`）のものです。Python、Go、Rust、WASM の SDK は、それぞれの命名でそれぞれ異なる範囲を扱うため、何を公開しているかは各 SDK の README で確認してください（[API_REFERENCE.md](API_REFERENCE.md) も参照）。

<a id="31-logging-and-tamper-evidence"></a>

### 3.1 ロギングと改ざんの証拠

| 条文 | 義務（言い換え） | DCP の仕組み | カバレッジ | 組織に残ること |
|---------|------------------------|---------------|----------|-----------------------------------|
| [第 12 条 (1)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_12) | 高リスクシステムは、そのライフタイム全体にわたって、イベントの自動記録（ログ）を技術的に可能にしなければならない。 | ゲートを通るすべての行動は監査エントリを生成し、署名済みのバンドルは監査のマークルルートを通じてそのエントリにコミットします（エントリは 1 件ずつ署名されるわけではありません。`schemas/v2/audit_entry.schema.json`：`audit_id`、`timestamp`、`agent_id`、`human_id`、`intent_id`、`intent_hash`、`policy_decision`、`outcome`、`evidence`）。SDK が自ら行動をゲートに通したりログを書いたりすることはありません。アプリケーションが各エントリを作り、ビルダーに渡します（`BundleBuilderV2`。補助として `prevHashForEntry` と `intentHash`）。DCP-05 §9、DCP-07 §9、DCP-08 §8、DCP-09 §9 は、ライフサイクル、紛争、権利、委任のイベントについて監査エントリを定めていますが、それらのイベント向けの SDK の関数はエントリを自動的には作らないため、アプリケーションが作らなければなりません。 | `supports` | AI システムの関連するすべての行動を意図のゲートに通し、その監査エントリを書くこと。DCP の外で行われる行動（モデルの推論、UI のイベント、意図として宣言されていないツール呼び出し）は DCP では記録されません。 |
| [第 12 条 (2)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_12) | ロギングは、意図された目的に適したトレーサビリティを与えなければならない。リスク状況の特定、市販後モニタリング（第 72 条）、導入者による監視（第 26 条 (5)）に関係するイベント。 | 各監査エントリは、意図（`intent_id`、`intent_hash` = 正規化した意図の SHA-256、DCP-03）、ポリシーの結果（`policy_decision`：`approved`、`escalated`、`blocked`）、結果（`outcome`）、Action Evidence（`evidence.tool`、`evidence.result_ref`、`evidence.evidence_hash`）を結び付けます。Policy Decision は `risk_score`（整数 0..1000）、`reasons`、`applied_policy_hash`、`resolved_tier` を持ちます。セッション内のすべてのアーティファクトは `session_nonce` を共有します（core §8）。 | `supports` | `action_type`、`data_classes`、`estimated_impact` を、システムの意図された目的を反映するように定義すること。後で判断を読み直せるよう、`applied_policy_hash` の背後にあるポリシーのバージョンを保持すること。 |
| [第 12 条 (3)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_12) | 遠隔生体識別システム（附属書 III の 1(a)）について：各使用の期間、参照データベース、一致した入力データ、結果を検証した自然人の身元。 | 対応するのは最後の項目だけです。`schemas/v2/human_confirmation.schema.json` は `human_id`、`intent_id`、`decision`（`approve`／`deny`）、複合署名を記録します。DCP には参照データベースや一致した入力のフィールドはありません。 | `out of scope` | 生体認証に固有のログの内容は提供者の設計です。Human Confirmation は、誰が結果を確認したかの証拠にはなりますが、一致そのものの証拠にはなりません。 |
| [第 19 条 (1)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_19) と[第 26 条 (6)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_26) | 提供者（第 19 条）と導入者（第 26 条 (6)）は、自動生成されたログを、意図された目的に適した期間、「of at least six months」、自らの管理下に保持する。ただし EU または加盟国の法（特にデータ保護法）が別に定める場合を除く。 | **保持するものの改ざんの証拠**：ハッシュチェーン（`prev_hash`、DCP-03）、二重ハッシュチェーン（`prev_hash_secondary`、`hash_alg: "sha256+sha3-256"`、core §10.3、`spec/VERIFICATION.md` V2-11）、バンドルのマニフェストにあるマークルルート（`audit_merkle_root`、`audit_merkle_root_secondary`、`audit_count`；`merkleRootForAuditEntries`、`dualMerkleRoot`）、PQ チェックポイント（`schemas/v2/pq_checkpoint.schema.json`、`createPQCheckpoint`、`PQCheckpointManager`、core §10.2）、圧縮チェックポイント（`schemas/v2/audit_compaction.schema.json`、`sdks/typescript/src/core/audit-compaction.ts` の `createAuditCompaction`、core §10.4）により、検証器は後日いつでも、保持されたログがコミット後に改変されたかどうかを検出できます。現在の SDK の検証器は一次チェーンとマークルルートを確認しますが、二次チェーンや `audit_merkle_root_secondary` はまだ再計算しないため、二次のコミットメントを確認済みの証拠として当てにしないでください（[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains)）。**保持そのもの**：DCP は保持期間もストレージも定義しません。[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md) はストレージの選択肢（保有者が持つポータブルなバンドル、アンカーされたハッシュ、分散された失効）を挙げ、[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md) は、失効サービスに永続的なストレージ上の `REVOCATION_STATE_PATH` を与えない限り、リファレンスのゲートウェイとサービスは状態をメモリに保持し、「a restart, a deploy or a crash wipes their state」と述べています。DCP-08 §3.5（Immutable Record）は、監査、バイタリティ、ライフサイクルの記録が「shall be preserved intact for the retention period specified in the commissioning certificate and decommissioning record」と述べ、DCP-08 の権利宣言の例は `minimum_retention_period: "P7Y"` を使いますが、期間を強制するスキーマのフィールドはありません。 | `partial` | 署名済みのバンドルと監査エントリ（ハッシュだけでなく）を、少なくとも 6 か月、意図された目的や業種の法令が求める場合はそれ以上、永続的なストレージに保存すること。圧縮（core §10.4）では、チェックポイントを有効なチェーンに残したまま、圧縮したイベントをアーカイブできます。アーカイブしたイベントも保持期間中は保持しなければなりません。古い署名を検証できるよう、廃止時にエージェントの公開鍵をアーカイブすること（DCP-05 §8.4）。`human_id` を含むエントリを保持する GDPR 上の根拠を決め、エントリが組織の外に出る場合はブラインド RPR（3.7 の行）を適用すること。 |
| [第 26 条 (6)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_26) 第 2 段落、[第 19 条 (2)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_19) | 金融機関は、EU の金融サービス法が求める文書の一部としてログを保持する。 | バンドルと監査エントリはポータブルな JSON（CBOR は任意、core §16）で、既存の記録システムの中にアーカイブできます。 | `partial` | バンドルのアーカイブを、金融サービス法のもとですでに適用されている記録保持のスケジュールに対応付けること。 |
| [第 73 条 (6)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_73) 第 2 段落 | 重大なインシデントの後、提供者は、当局に通知する前に、その原因の事後評価に影響するような方法で AI システムを変更してはならない。 | アンカリング（`services/anchor`、[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md) の `anchor_receipt`）と透明性ログ（`services/transparency-log`：`POST /add`、`GET /proof/:index`、`GET /root/signed`、RFC 6962 のツリー、Ed25519 で署名されたツリーヘッド）は、監査証跡の状態へのコミットメントを記録するため、事後の評価者は、保持されたログがコミットされた内容と一致するかどうかを判断できます（[SECURITY_MODEL.md](SECURITY_MODEL.md) §6、「Retroactive modification」）。そのコミットメントの時刻は、ログやアンカーのオペレーターへの信頼に依存します。インシデントがいつ起きたかも、記録が真実であることも示しません。 | `partial` | 第 73 条のインシデント報告の期限より短い頻度で、監査のマークルルートをアンカーするかログに記録すること（第 5 節）。リファレンスのアンカーサービスはまだオンチェーンのトランザクションを送信しません（`tx_hash: null`）。透明性ログか、`contracts/ethereum/src/DCPAnchor.sol` に対する本番のアンカーを使ってください。 |

<a id="32-human-oversight"></a>

### 3.2 人間による監督

| 条文 | 義務（言い換え） | DCP の仕組み | カバレッジ | 組織に残ること |
|---------|------------------------|---------------|----------|-----------------------------------|
| [第 14 条 (1)–(3)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_14) | 高リスクシステムは、使用中に自然人が効果的に監督できるように設計されなければならない。措置はリスク、自律性、文脈に比例し、提供者が組み込むか導入者が実施する。 | **意図のゲート**（DCP-02）：宣言された Intent と Policy Decision（`approve`、`escalate`、`block`）なしには行動しません。`required_confirmation` は、行動の前に Human Confirmation を求めます。**適応的な精査**：セキュリティティア（core §14、`computeSecurityTier`、`effectiveVerificationMode`）は、`risk_score`、`data_classes`（`pii`、`financial_data`、`health_data`、`credentials`、`children_data`）、`action_type: "initiate_payment"`、`estimated_impact: "high"` に応じて上がり、検証器はそれを下げてはなりません（MUST NOT、core §14.3）。**ライフサイクルの状態**（DCP-05 §3）：`commissioned`、`active`、`declining`、`decommissioned`。仕様は `declining` からの再有効化にプリンシパルの承認を求めていますが、`validateStateTransition` が確認するのは遷移が許されたエッジの一つであることだけで、承認は確認しません。 | `partial` | どの行動をゲートに通し、どのポリシーが `escalate` を返すかを決めること。宣言されたものに対してゲートを強制するのはアプリケーションまたはその統合で、検証器は得られた証拠を確認します。AI システムにゲートを呼び出させるのは提供者です。監督の*措置*（誰が、どのように、どんな訓練で）は、第 26 条 (2) に基づき導入者が担います。 |
| [第 14 条 (4)(a)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_14) | 監督者は、システムの能力と限界を理解し、異常や予期しない性能の検出を含め、その動作を監視できなければならない。 | **認識の閾値**（DCP-09 §4、`schemas/v2/awareness_threshold.schema.json`）：`dimension`、`operator`、`value`、`action_if_triggered`（`notify`、`escalate`、`block`）を持つ署名付きの `threshold_rules[]`。`createAwarenessThreshold`、`evaluateSignificance`、`shouldNotifyHuman`。**プリンシパルのミラー**（DCP-09 §6、`schemas/v2/principal_mirror.schema.json`、`generateMirror`）。**バイタリティレポート**（DCP-05 §5–6、`createVitalityReport`）と異常検出（§6.5）。**オブザーバビリティ**（[OBSERVABILITY.md](OBSERVABILITY.md)、`dcpTelemetry`）：ティアごとの検証のレイテンシ、検証したバンドル、エラー、チェックポイントのレイテンシ。 | `partial` | AI システムそのものの能力と限界（正確性、堅牢性、既知の故障モード）は、提供者の使用説明書（第 13 条）から来ます。DCP が監督者に伝えるのは、エージェントが*何をしたか*と、*理解していないと宣言したこと*であり、モデルに何ができるかではありません。 |
| [第 14 条 (4)(b)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_14) | 監督者は、自動化バイアスを認識していなければならない。 | なし。 | `out of scope` | 訓練と UI の設計。インタラクション記録のナラティブレイヤー（次の行）は推論を見えるようにでき、それは役に立ちますが、DCP は自動化バイアスを扱いません。 |
| [第 14 条 (4)(c)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_14) | 監督者は、システムの出力を正しく解釈できなければならない。 | **インタラクション記録**（DCP-09 §7、`schemas/v2/interaction_record.schema.json`）：人が読める `public_layer`（`terms`、`decisions`、`commitments`）と、技術的な詳細にコミットする `private_layer_hash`。`generateInteractionRecord`。DCP-09 §7.3–7.4 は技術レイヤーとナラティブレイヤーを説明します（仕様の例は、スキーマの必須フィールドよりも詳しい内容です）。**アドバイザリー宣言**（DCP-09 §5、`schemas/v2/advisory_declaration.schema.json`）：`action_summary`、`recommended_response`、`significance_score`。Policy Decision の **`reasons`**。 | `partial` | モデルの出力（スコア、分類、生成されたコンテンツ）の解釈は、提供者と導入者が担います。DCP が説明するのは、エージェントが宣言した意図と、記録されたとおりの推論であり、モデルの出力ではありません。 |
| [第 14 条 (4)(d)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_14) | 監督者は、システムを使用しないこと、またはその出力を無視、オーバーライド、反転することを決められなければならない。 | RPR の **`override_rights`**（必須の真偽値）。ブラインド RPR にもそのままコピーされます（core §12.1）。責任あるプリンシパルのオーバーライドの権利は、結び付けの署名済みかつ公開された属性です。エスカレートされた意図に対する `decision: "deny"` の **Human Confirmation**。**アドバイザリーへの応答**（DCP-09 §5.5）：続行、オーバーライド、引き継ぎ、他所への委任、確認のみ。プリンシパルが署名し、監査チェーンに記録されます。`advisory_declaration.human_response`、`response_deadline`、`proceeded_without_response`。`action_if_triggered: "block"` の**認識ルール**。 | `supports` | 高リスクの文脈で使うすべてのエージェントで `override_rights: true` を設定し、アプリケーションまたはその統合に `deny` と `block` を強制させること。検証器はどちらの判断も実行せず、人間が判断したことも確認しません。また、検証もアドミッションも行動を認可しません（アドミッションの結果は `action_authorized: false` を持ちます）。プリンシパルが誰かを定め、その人の鍵を本人の管理下に置くこと（第 5 節）。 |
| [第 14 条 (4)(e)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_14) | 監督者は、「stop」ボタンなどによってシステムに介入し、または中断して、安全な状態にできなければならない。 | **緊急失効**（core §11.3、`schemas/v2/emergency_revocation.schema.json`）：パスポートに事前登録された `emergency_revocation_token` は `SHA-256(revocation_secret)` です。秘密値を明かすと、署名なしでエージェントのすべての鍵が失効します（`generateEmergencyRevocationToken`、`buildEmergencyRevocation`、`verifyEmergencyRevocationSecret`。失効サービスとゲートウェイの `POST /v2/emergency-revoke`、失効サービスの `GET /v2/check/kid/:kid`。kid 単位の署名付き失効は失効サービスの `POST /v2/revoke`）。**失効記録**（`schemas/v2/revocation_record.schema.json`。`reason` の列挙値に `key_compromise_emergency` を含む）。`declining` または `decommissioned` への**ライフサイクルの遷移**（DCP-05 §3.2、`validateStateTransition`、`createDecommissioningRecord`）、`termination_for_cause` モード（§7.3）。署名者の kid が失効したとき、検証器はキャッシュした結果を無効にしなければなりません（MUST、core §14.5）。 | `partial` | 失効が止めるのは、失効を確認するすべての検証器によるエージェントのバンドルの*受け入れ*です。実行中のプロセスを止めることも、すでに行われた行動を取り消すこともありません。AI システムの安全な状態での動作は提供者の設計です。失効をアプリケーションレベルのキルスイッチと組み合わせ、ティアの失効伝播のレイテンシを満たしてください（[SECURITY_MODEL.md](SECURITY_MODEL.md)、「Revocation Propagation SLAs」）。 |
| [第 14 条 (5)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_14) | 遠隔生体識別（附属書 III の 1(a)）について：少なくとも 2 人の有能な自然人が検証しない限り、識別に基づく行動をしない（法執行、移民、国境管理、庇護には例外がある）。 | **マルチパーティ承認**（`schemas/v2/multi_party_authorization.schema.json`、ゲートウェイの `POST /v2/multi-party/authorize`。各当事者の署名は登録された鍵で検証され、1 回だけ数えられます）。 | `partial` | DCP は、異なる 2 人の鍵の保有者が意図を承認したことの証拠にはなりますが、彼らの能力や、識別が「別々に検証された」ことの証拠にはなりません。2 人ルールは導入者のプロセスです。 |
| [第 26 条 (1)–(2)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_26) | 導入者は、使用説明書に従ってシステムを使用し、必要な能力、訓練、権限、支援を持つ自然人に人間による監督を割り当てる。 | RPR は、エージェントを、名指しされ `override_rights` を持つ自然人または組織に結び付けます。Delegation Mandate（DCP-09 §3、`schemas/v2/delegation_mandate.schema.json`、`createDelegationMandate`、`verifyMandateValidity`、`revokeDelegation`）は、エージェントがプリンシパルに代わって何をしてよいかを示します（`authority_scope`：`domain`、`actions_permitted`、`data_classes`、`limits`。DCP-09 §3.2 の例にある禁止事項の一覧はスキーマのフィールドではありません）。`interaction_record` と DCP-09 §7.5 は委任の遵守を記録します。 | `partial` | 能力、訓練、支援は、記録の外にある組織上の事実です。監督する人を RPR で名指しするか（`entity_type: "natural_person"`）、`organization` の RPR を割り当てられた人々に対応付ける内部の台帳を維持してください。 |
| [第 26 条 (5)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_26) | 導入者はシステムの動作を監視し、第 72 条に基づき提供者に情報を提供し、使用がリスクをもたらしうる場合は提供者または販売者と市場監視当局に通知して使用を停止する。重大なインシデントはまず提供者に通知する。 | **動作の証拠**：監査チェーン、Policy Decision、インタラクション記録、`compliance_status` を持つ義務の記録（DCP-08 §5、`recordObligation`、`checkRightsCompliance`）、バイタリティレポート。**停止**：パスポートの `status`（`suspended`、`declining`、`decommissioned`）、失効、緊急失効。**エスカレーション**：DCP-08 §6.4 は、義務の不履行が DCP-07 の紛争を開くこと、そして DCP-07 §3.2 のエスカレーションの期限を定めています。SDK はそれを自動的には開きません（`reportViolation` は、呼び出し側が渡す `dispute_id`、または `null` を受け取ります）。 | `partial` | 提供者、販売者、市場監視当局に通知すること、そしてリスクがあると判断することは、導入者の行為です。DCP には当局への通知のためのアーティファクトはありません。 |

<a id="33-traceability-of-decisions"></a>

### 3.3 判断のトレーサビリティ

| 条文 | 義務（言い換え） | DCP の仕組み | カバレッジ | 組織に残ること |
|---------|------------------------|---------------|----------|-----------------------------------|
| [第 12 条 (2)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_12)、[第 13 条 (1)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_13) | システムの動作のトレーサビリティ。導入者が出力を解釈し、適切に使用できるほど十分に透明な動作。 | **行動ごとの判断の連鎖**：Intent（`schemas/v2/intent.schema.json`：`action_type`、`target.channel`、`target.to`／`domain`／`url`、`data_classes`、`estimated_impact`、`requires_consent`、`security_tier`）→ Policy Decision（`decision`、`risk_score`、`reasons`、`applied_policy_hash`、`resolved_tier`）→ 任意の Human Confirmation → `outcome` と `evidence` を持つ監査エントリ。バンドルのマニフェスト（core §9、`schemas/v2/bundle_manifest.schema.json`）は `rpr_hash`、`passport_hash`、`intent_hash`、`policy_hash` と監査のマークルルートを持ち、バンドルの複合署名はマニフェストを対象とします。検証はローカルで再現可能です（`spec/VERIFICATION.md`、`verifySignedBundleV2`、ゲートウェイの `POST /v2/bundle/verify`）。**インタラクション記録**（DCP-09 §7）は、相手方、マンデート、ナラティブレイヤーを加えます。 | `supports` | 各 `applied_policy_hash` の背後にあるポリシーの本文やルールを保持すること。`reasons` は自由記述です。1 年後にレビューする人が読める理由を書いてください。 |
| [第 12 条 (2)(a)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_12) | ログは、第 79 条 (1) の意味でのリスク、または実質的な変更につながりうる状況の特定に役立たなければならない。 | `risk_score`、`resolved_tier`、`estimated_impact`、`data_classes` は行動ごとに署名され、照会できます。`escalated` と `blocked` の結果は明示的です。認識の閾値とアドバイザリー宣言は、エージェント自身の不確かさを記録します（`significance_score`。DCP-09 §4.2–4.3 のドメインごとの `confidence` スコアは仕様の例に現れるもので、`schemas/v2/awareness_threshold.schema.json` にはありません）。 | `supports` | 意図された目的にとって何がリスク状況に当たるかを定め、それについて警告すること。DCP が提供するのはシグナルであり、警告のポリシーではありません。 |
| [第 86 条 (1)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_86) | 附属書 III（2 を除く）の高リスクシステムの出力に基づいて導入者が行った、法的効果または同程度に重大な悪影響を伴う判断の影響を受けた人は、判断における AI システムの役割と判断の主な要素について、導入者から明確で意味のある説明を得ることができる。 | 署名付きの Intent、Policy Decision（`decision`、`reasons`、`risk_score`）、Human Confirmation（誰がいつ承認したか）、そして署名済みバンドルがコミットする監査エントリ（`outcome`、`evidence`）に、インタラクション記録の `public_layer.decisions` とアドバイザリーの `action_summary` を加えると、導入者は、エージェントが何を意図し、ポリシーが何を決めたか、記録された確認（確認した人の現実の身元は DCP の外で確立されます）、そして宣言された結果についての署名付きの宣言を得ます。 | `partial` | 影響を受けた人への説明は、導入者が平易な言葉で書く文書です。DCP が提供するのは署名付きの宣言であり、行動が実際に行われたことを証明するものでも、誰かの法的な身元を確立するものでもありません。意図としてゲートを通らなかった判断や、出力の背後にあるモデルの推論は、記録にありません。 |

<a id="34-explanation-redress-and-disputes"></a>

### 3.4 説明、救済、紛争

| 条文 | 義務（言い換え） | DCP の仕組み | カバレッジ | 組織に残ること |
|---------|------------------------|---------------|----------|-----------------------------------|
| [第 27 条 (1)(e)–(f)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_27) | 基本権影響評価（公的機関、公共サービスの提供者、附属書 III の 5(b) と (c)）は、実施する人間による監督の措置と、リスクが現実化した場合に取る措置（内部ガバナンスと苦情処理の仕組みを含む）を記述する。 | 具体的で文書化できる監督の措置：RPR の `override_rights`、`escalate` を伴う意図のゲート、Human Confirmation、認識の閾値、アドバイザリー宣言、ライフサイクルの制御、緊急失効。内部ガバナンスとエスカレーション：DCP-07 の 3 段階のモデル（直接交渉、文脈に応じた仲裁、人間への上訴、§5）と `createDispute`、`escalateDispute`、`resolveDispute`、`createObjection`。DCP-08 の侵害報告（`reportViolation`）。 | `partial` | 評価そのもの（プロセス、影響を受ける人、リスク、第 27 条 (1)(a)–(d)）は導入者が担います。DCP-07 と DCP-08 は、エージェントとそのプリンシパルの間の仕組みであり、影響を受けた自然人のための苦情の窓口ではありません（第 6 節）。Omnibus は第 27 条 (4)–(5) を改正し、GDPR のデータ保護影響評価への相互参照を認めました。 |
| [第 86 条](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_86) | 説明を受ける権利（3.3 の行を参照）。 | **人間への上訴**（DCP-07 §5.3）：紛争のどの当事者も、いつでも責任あるプリンシパルにエスカレートできます。人間の判断はプロトコルの中では最終的であり、仲裁の決定として記録されます（`schemas/v2/arbitration_resolution.schema.json`）。**紛争の記録**（`schemas/v2/dispute_record.schema.json`：`dispute_type`、`human_appeal` を含む `escalation_level`、`status`、`evidence_hashes`）。**ナラティブレイヤー**（DCP-09 §7.4）：平易な言葉の要約、推論を伴う主な判断、未解決の問題、プリンシパルが取るべき行動。 | `partial` | これらの仕組みは、導入者自身の人々に、エージェントの判断を見直す文書化された道筋を与えます。第 86 条に基づく影響を受けた人の権利は、プロトコルの外で、導入者に対して行使されます。 |
| [第 26 条 (11)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_26)、[第 50 条 (1)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_50) | 自然人について判断を行う、またはその判断を支援する附属書 III のシステムの導入者は、その人々に知らせる。提供者は、AI システムと対話する人が、明らかな場合を除き、そのことを知らされるようにする。 | Agent Passport は、行為者が名指しされたプリンシパルに結び付いた AI エージェントであることの、署名付きで検証可能な宣言であり、どの相手方にも提示できます（`presentFull`、`presentCompact`、`presentReference`。ほかのエージェントには DCP-04 のハンドシェイク）。 | `partial` | 自然人への開示（UI、文言、「at the latest at the time of the first interaction」というタイミング、第 50 条 (5)）は、提供者と導入者が担います。DCP は開示を裏付ける検証可能な証明を与えますが、開示そのものは行いません。 |
| [第 50 条 (2)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_50)、[第 50 条 (4)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_50) | 合成コンテンツの機械可読なマーキング。ディープフェイクと、公共の関心事に関する AI 生成テキストの開示。 | なし。`evidence.evidence_hash` はアーティファクトの宣言されたバイト列を結び付けることはできますが、そのアーティファクトが実際に生成されたことも、マーキングされたことも証明しません。 | `out of scope` | コンテンツのマーキングと検出は、別の技術的措置です。 |

<a id="35-incident-reporting-and-post-market-monitoring"></a>

### 3.5 インシデントの報告と市販後モニタリング

| 条文 | 義務（言い換え） | DCP の仕組み | カバレッジ | 組織に残ること |
|---------|------------------------|---------------|----------|-----------------------------------|
| [第 72 条 (1)–(2)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_72) | 提供者は、導入者から提供されるデータやほかの AI システムとの相互作用を含め、ライフタイムを通じた性能のデータを能動的に収集・分析する、文書化された市販後モニタリングのシステムを設ける。 | **導入者が提供者に渡せるデータ**：結果と証拠を伴う監査エントリ、`risk_score` を伴う Policy Decision、義務の記録（`schemas/v2/obligation_record.schema.json`：`obligation_type`、`compliance_status`、`evidence_hashes`。DCP-08 §5.2 の例にある `compliance_history` はスキーマのフィールドではありません）、バイタリティレポート（DCP-05 §6）、相手方エージェントとのインタラクション記録（DCP-09 §7）、紛争と侵害の報告。それぞれが署名されているか、署名済みのバンドルによってコミットされており、提供者は導入者のデータベースを信頼せずにそれを検証できます。 | `partial` | モニタリングのシステムと計画は提供者が担います。Omnibus は第 72 条 (3) を置き換えました。計画は引き続き附属書 IV の文書の一部であり、テンプレートのための欧州委員会の実施法は削除され、欧州委員会は 2027 年 9 月 2 日までに、テンプレートを含むガイダンスを採択しなければなりません（第 4 節）。 |
| [第 73 条 (1)–(5)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_73) | 提供者は、重大なインシデント（第 3 条 (49)：死亡または健康への重大な害、重要インフラの重大かつ不可逆的な混乱、基本権に関する義務の侵害、財産または環境への重大な害）を市場監視当局に報告する。因果関係またはその合理的な可能性を確認した直後に、遅くとも認識から 15 日以内。広範な侵害または重要インフラのインシデントでは 2 日、死亡の場合は 10 日。不完全な初回報告の後に完全な報告を続けてもよい。 | **時系列の証拠**：大半の署名付きアーティファクトが持つ、署名者が宣言したタイムスタンプ（PQ チェックポイントとマルチパーティ承認には一つもなく、バンドルのマニフェストには任意の署名付きセッション期間 `session_issued_at` と `session_expires_at` だけがあります）、透明性ログの署名付きツリーヘッドと包含証明、アンカーの受領証。**インシデントに関連するアーティファクト**：緊急失効（どの失効がいつ宣言されたか。プロセスが止まったことの証明ではありません）、ライフサイクルの `termination_for_cause` と `sudden_failure`（DCP-05 §7.3、§7.5）と廃止記録による監査チェーンの封印（§8.3）、`evidence_hashes` を持つ紛争の記録、`evidence_hashes` を持つ権利侵害の報告。 | `partial` | インシデントが「重大」だと判断し、因果関係を確認し、当局に報告を提出するのは、提供者（および第 26 条 (5) に基づき導入者）の行為です。DCP には重大なインシデントの報告のアーティファクトはありません。`rights_violation_report` はエージェント自身の DCP-08 の権利に関するもので、`dispute_record` はエージェント間の対立に関するものです。2 日、10 日、15 日の期間内に証拠を保てる頻度で、アンカーするかログに記録してください。 |
| [第 73 条 (6)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_73) 第 1 段落 | 報告の後、提供者は調査し、リスク評価を行い、是正措置を取る。 | 保持した証拠の再検証（実行の再現ではありません）：保持したバンドルに対する `verifySignedBundleV2`、エージェント間の一貫性の確認（DCP-07 §9.2）、監査イベント `dispute_compliance_verified`／`dispute_compliance_failed`。 | `partial` | 調査と是正措置は提供者が担います。 |

<a id="36-technical-documentation"></a>

### 3.6 技術文書

| 条文 | 義務（言い換え） | DCP の仕組み | カバレッジ | 組織に残ること |
|---------|------------------------|---------------|----------|-----------------------------------|
| [第 11 条 (1)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_11)、[附属書 IV](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#anx_IV) の 1(b)、2(c)、2(h)、3 | 市場に出す前に作成し、最新に保つ技術文書で、少なくとも附属書 IV の要素を含むもの。その中には、システムがほかの AI システムを含むほかのソフトウェアとどう相互作用するか（1(b)）、システムのアーキテクチャ（2(c)）、サイバーセキュリティの措置（2(h)）、人間による監督の措置を含む、システムの監視、動作、制御（3）がある。 | 説明責任のレイヤーについての、再利用できるバージョン管理された記述：`spec/DCP-AI-v2.0.md`（規範）、`spec/DCP-01.md`–`spec/DCP-09.md`、`spec/BUNDLE.md`、`spec/VERIFICATION.md`、`spec/CANONICALIZATION_PROFILE.md`。`schemas/v2/` の JSON Schema。[TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)（レイヤー、サービス、デプロイ）。[SECURITY_MODEL.md](SECURITY_MODEL.md)（脅威モデル、保護、運用上の要件）。[NIST_CONFORMITY.md](NIST_CONFORMITY.md)（暗号アルゴリズム）。`spec/AUDIT-v2.0-FINAL.md`。ほかのエージェントとの相互運用性：DCP-04 と DCP-09 §8 のハンドシェイク拡張。 | `partial` | 附属書 IV は AI システムについての文書です。意図された目的、開発、データ、検証、指標、リスク管理（第 9 条）、ライフサイクルを通じた変更、適用した規格、適合宣言、市販後モニタリング計画。これらの節は提供者が担います。DCP の文書は、1(b)、2(c)、2(h)、3 のうち説明責任のレイヤーを記述する部分について、バージョンを固定して引用できます（第 5 節）。Omnibus は第 11 条 (1) を改正し、簡素化した文書を小規模ミッドキャップ企業にも広げました。 |
| [第 13 条 (3)(d)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_13)、[第 13 条 (3)(f)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_13) | 使用説明書は、人間による監督の措置（第 14 条）と、該当する場合は、導入者が第 12 条に基づいてログを収集、保存、解釈できるようにする仕組みを記述する。 | ログの形式（`schemas/v2/audit_entry.schema.json`）、連鎖とマークルのルール（DCP-03、core §10）、検証のチェックリスト（`spec/VERIFICATION.md`）、ストレージの選択肢（[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)）、CLI（`dcp validate-bundle`、`dcp merkle-root`）がまさにその仕組みであり、3.2 節の監督の制御は記述できる措置です。 | `partial` | 使用説明書を書くこと。DCP のゲートを提供する提供者は、ロギングの仕組みと監督の制御についてこの文書と仕様を参照し、どれが組み込まれているか（第 14 条 (3)(a)）、どれを導入者が運用しなければならないか（第 14 条 (3)(b)）を示すことができます。 |
| [第 9 条](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_9) | リスク管理システム：継続的で、文書化され、ライフサイクル全体にわたるもの。リスクの特定、推定、評価。措置。事前に定めた指標による試験。 | `risk_score`、`risk_tier`、セキュリティティアは行動ごとの実行時のゲートのシグナルであり、監査証跡は第 9 条 (2)(c)（市販後のデータから生じるリスク）のデータソースです。DCP-08 の義務の記録は、署名された `compliance_status` と `evidence_hashes` を持ちます。DCP-08 §5.2 の例が示す `threshold` と `measurement_interval` を持つ `compliance_criteria` は、スキーマのフィールドではありません。 | `partial` | リスク管理システムは提供者のプロセスであり、プロトコルの機能ではありません。DCP のリスクスコアを第 9 条のリスク評価として示さないでください。 |

<a id="37-data-protection-crossover"></a>

### 3.7 データ保護との交差

| 条文 | 義務（言い換え） | DCP の仕組み | カバレッジ | 組織に残ること |
|---------|------------------------|---------------|----------|-----------------------------------|
| [第 19 条 (1)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_19)、[第 26 条 (6)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_26)（「unless provided otherwise in ... Union law on the protection of personal data」という但し書き）、[第 26 条 (9)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_26) | ログの保持はデータ保護法に従う。導入者は、第 13 条の情報を GDPR のデータ保護影響評価に使う。 | **ブラインド RPR**（core §12.1、`schemas/v2/blinded_rpr.schema.json`、`generatePiiSalt`、`blindRpr`、`verifyBlindedRpr`。Python では `blind_rpr`／`verify_blinded_rpr`、Go では `BlindRPR`／`VerifyBlindedRPR`）：RPR の `legal_name` と `contact` を、ソルト付きのコミットメント `pii_hash = sha256(canonical({contact, legal_name, pii_salt}))` に置き換えます。`pii_salt`（ランダムな 32 バイト）は完全な RPR とともに署名され、呼び出し側が非公開に保たなければなりません（`blindRpr` はそれを省きますが、完全な RPR には残ります）。ブラインドされた記録は、`human_id`、`override_rights`、`jurisdiction`、`liability_mode`、`binding_keys`、有効期間を保持します。完全な RPR とそのソルトを削除すると、公開されたコミットメントは開けなくなり、仕様はこれを、変更できないログとアンカーに対する消去として位置付けています（GDPR 第 17 条）。ただし、それだけで GDPR への準拠や匿名化が成り立つわけではありません。`human_id`、ほかのコピー、漏れた原像が残るからです。`human_id` は不透明でなければならず（MUST）、個人データから導出してはなりません（MUST NOT）。**アンカーと透明性ログはハッシュしか保持しません**（[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)、「What goes on-chain」）。 | `supports` | アンカーと透明性ログにはハッシュだけを送り、RPR は、ブラインドされたものであっても送らないこと。組織の外の相手方にはブラインド RPR だけを示すこと。完全な RPR のすべてのコピー（共有したコピーを含む）を削除手続きの対象にすること。`human_id` を不透明にすること。`human_id` を含む監査エントリについて、GDPR 上の保持の根拠を定めること。データ保護影響評価と法的根拠は導入者が担います。ソルトのない旧来の `pii_hash` のコミットメントは非推奨で、個人データを推測した人なら誰でもそれを確認できます（core §12.1）。 |

---

<a id="4-application-timeline"></a>

## 4. 適用のタイムライン

<a id="41-status-of-the-legal-text-at-the-review-date"></a>

### 4.1 レビュー日時点での法令テキストの状況

- **基本となる法令。** 2024 年 6 月 13 日の規則 (EU) 2024/1689。2024 年 7 月 12 日に官報 L に掲載（[EUR-Lex、CELEX 32024R1689](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689)）。[第 113 条](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_113)：掲載の翌日から起算して 20 日目に発効し、2026 年 8 月 2 日から適用。以下の段階的な日付があります。
- **Digital Omnibus on AI。** 欧州委員会は 2025 年 11 月 19 日、デジタル簡素化パッケージの一部としてこれを提案しました。欧州議会と理事会の政治的合意は 2026 年 5 月 7 日に発表されました。この法令は、規則 (EU) 2024/1689、(EU) 2018/1139、(EU) 2023/1230 を改正する **2026 年 7 月 8 日の規則 (EU) 2026/1744** として採択され、2026 年 7 月 24 日に官報 L 2026/1744 に掲載され、その第 4 条により掲載の翌日から起算して 3 日目の **2026 年 7 月 27 日**に発効しました（[EUR-Lex、ELI reg/2026/1744](https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng)）。EUR-Lex はこれを「In force」と表示しています。欧州委員会の AI 法の政策ページ（最終更新 2026 年 10 月 19 日）と 2026 年 7 月 27 日のニュースも同じ日付を示しています。
- **この文書にとっての意味。** レビュー日の時点で、タイムラインはもはや提案ではなく、延期は制定された法です。提案段階（2025 年 11 月から 2026 年 7 月まで）には、欧州委員会の FAQ は延期を、規格と支援ツールが利用できるかどうかに連動して、附属書 III について「maximum 16 months later」、附属書 I について「maximum 12 months later」と説明していました。以下の暦日は制定されたものです。「制定時」と記した日付は基本法令の第 113 条から、「改正後」と記した日付は規則 (EU) 2026/1744 の第 1 条 (39)–(40) から来ています。

<a id="42-dates"></a>

### 4.2 日付

| 日付 | 規定 | 出典 | この対応付けとの関係 |
|------|-----------|--------|---------------------------|
| 2024 年 8 月 1 日 | 規則 (EU) 2024/1689 の発効 | 第 113 条第 1 段落（制定時） | — |
| 2025 年 2 月 2 日 | 第 I 章と第 II 章（一般規定、禁止される行為） | 第 113 条第 3 段落 (a)（制定時。改正後の文言は日付を維持し、第 5 条の新たな禁止を除外） | 提供者と導入者の定義（第 2 節）。 |
| 2025 年 8 月 2 日 | 第 III 章第 4 節、第 V 章（汎用 AI モデル）、第 VII 章、第 XII 章と第 78 条（第 101 条を除く） | 第 113 条第 3 段落 (b)（制定時） | この文書では扱いません。 |
| 2026 年 7 月 27 日 | 規則 (EU) 2026/1744 の発効。AI 法の第 102 条から第 110 条が適用される | 規則 2026/1744 第 4 条、第 113 条第 3 段落の新しい (d)（改正後） | — |
| 2026 年 8 月 2 日 | AI 法の一般的な適用日。第 50 条（透明性の義務）と第 IX 章（第 72 条の市販後モニタリング、第 73 条の重大なインシデント、第 86 条の説明を受ける権利）を含む | 第 113 条第 2 段落（制定時、改正なし） | 第 50 条、第 72 条、第 73 条、第 86 条は、延期された第 III 章第 1–3 節には含まれません。特定のシステムに対する実際の適用範囲は、その高リスクの分類に左右され、その実質的な要件は以下の日付から適用されます。組織は、第 IX 章を改正後の第 111 条 (2) とあわせて、法務の助言を得て読むべきです。 |
| 2026 年 12 月 2 日 | 第 5 条 (1) 第 1 段落 (ba) と (bb)、第 5 条 (1a) と (1b) の新たな禁止。2026 年 8 月 2 日より前に市場に出された生成 AI システムの提供者が第 50 条 (2) のマーキングに従う期限 | 第 113 条第 3 段落 (a)（改正後）、第 111 条 (4)（改正後） | 第 50 条 (2) は DCP の範囲外です（3.4 節）。 |
| 2027 年 9 月 2 日 | 市販後モニタリング計画について、テンプレートを含む欧州委員会のガイダンス | 第 72 条 (3)（改正後） | 3.5 節。 |
| 2027 年 12 月 2 日 | 第 6 条 (2) と附属書 III に基づき高リスクに分類される AI システムに対する第 III 章第 1、2、3 節（第 6 条 (5) を除く第 6–27 条） | 第 113 条第 3 段落 (c)(i)（改正後。制定時は 2026 年 8 月 2 日） | この対応付けの第 9、11、12、13、14、19、26、27 条は、この日から附属書 III のシステムに適用されます。 |
| 2028 年 8 月 2 日 | 第 6 条 (1) と附属書 I（規制対象製品の安全部品）に基づき高リスクに分類される AI システムに対する第 III 章第 1、2、3 節 | 第 113 条第 3 段落 (c)(ii)（改正後。制定時は、第 6 条 (1) の義務は 2027 年 8 月 2 日から適用） | 同じ条文を、附属書 I のシステムについて。 |
| 2030 年 8 月 2 日 | 公的機関が使用することを意図し、第 III 章の適用日より前に市場に出された、またはサービスに供された高リスク AI システム | 第 111 条 (2)（改正後） | 公共部門の導入者の既存システム。 |

既存システムの猶予：改正後の第 111 条 (2) は、第 III 章の適用日より前に市場に出された、またはサービスに供された高リスクシステムには、その日の後に「significant changes in their designs」を受けた場合に限って規則を適用します。

<a id="43-what-the-omnibus-did-and-did-not-change-in-the-articles-mapped-here"></a>

### 4.3 この対応付けの条文について、Omnibus が変えたことと変えなかったこと

2026 年 10 月 22 日に規則 (EU) 2026/1744 の第 1 条と照合して確認：

| 条文 | Omnibus による改正 | 効果 |
|---------|------------------------|--------|
| 第 9、12、13、14、19、26、86 条 | なし | 内容は変わりません。第 9、12、13、14、19、26 条の適用日は第 III 章とともに移ります（4.2 節）。 |
| 第 11 条 (1) | あり、第 2 段落 | 簡素化した技術文書を小規模ミッドキャップ企業にも拡大。 |
| 第 27 条 (4)–(5) | あり | 基本権影響評価は、GDPR のデータ保護影響評価の一部を参照し、または含めることができます。AI オフィスのテンプレートはそれを可能にしなければなりません。 |
| 第 50 条 (7) | あり | 欧州委員会（もはや AI オフィスではない）が、生成コンテンツの検出、マーキング、ラベル付けに関する行動規範を奨励し、欧州 AI 委員会の意見を考慮して、第 56 条 (6) の手続きでその適切性を評価します。行動規範を*承認する*実施法は削除され、規範が不適切な場合に*共通ルール*を定める実施法は残ります。第 50 条 (1)–(6) は変わりません。 |
| 第 72 条 (3) | あり | 実施法によるテンプレートは、2027 年 9 月 2 日までの、テンプレートを含む欧州委員会のガイダンスに置き換えられます。 |
| 第 73 条 | 直接はなし | 新しい第 75 条 (1a) は、AI オフィスの管轄にあるシステムの重大なインシデントの報告を AI オフィスに回し、第 73 条 (2)–(9) を準用します。 |
| 第 111 条 | あり | 第 2 項を置き換え（猶予、公的機関について 2030 年 8 月 2 日の期限）、第 4 項を追加（すでに市場にある生成システムについて、第 50 条 (2) の 2026 年 12 月 2 日の期限）。 |
| 第 113 条 | あり、第 3 段落 | (a) と (c) を置き換え、(d) を追加（4.2 節）。 |

2026 年 10 月 22 日より後に公表されたもの（さらなる改正、委任法や実施法、整合規格、第 72 条 (3) または第 73 条 (7) に基づく欧州委員会のガイダンス）は、ここには反映されていません。

---

<a id="5-implementer-checklist"></a>

## 5. 実装者向けチェックリスト

第 3 節の `supports` の行が自らのデプロイで成り立つように、導入者またはオペレーターが設定し、運用しなければならないこと。（提供者）と記した項目は、AI システムの中に DCP のゲートを組み込んで提供する提供者向けです。

<a id="51-logging-and-retention-arts-12-19-266"></a>

### 5.1 ロギングと保持（第 12 条、第 19 条、第 26 条 (6)）

- [ ] AI システムの関連するすべての行動は、実行前に Intent として宣言され、Policy Decision によってゲートを通る。ゲートを迂回する行動は、使用説明書に列挙され、正当化されている（提供者）。
- [ ] 監査エントリは、二重ハッシュチェーン（`hash_alg: "sha256+sha3-256"`、`prev_hash_secondary`）とともに、解決されたティアの間隔で PQ チェックポイントを伴って生成される（core §14.1：50、10、または 1 イベントごと）。
- [ ] 署名済みのバンドルと監査エントリ（ハッシュだけでなく）が、組織の管理下にある永続的なストレージに書き込まれる。リファレンスのゲートウェイ、アンカー、透明性ログ、失効サービスは状態をメモリに保持するため、記録の保管場所にはならない（[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md)、「Reference services keep state in memory only」）。失効サービスには `REVOCATION_STATE_PATH` を設定し、ほかのサービスを当てにする前に永続的なストレージを追加すること。
- [ ] それらの記録の保持期間が少なくとも 6 か月に定められ、意図された目的、業種の法令（例：金融サービス）、または進行中のインシデントが求める場合は延長され、データ保護法が求める場合に限って短縮される。
- [ ] 圧縮チェックポイントは、保持期間中の圧縮したイベントのアーカイブとあわせてのみ使われる。
- [ ] 各 `applied_policy_hash` の背後にあるポリシーの本文やルールがバージョン管理され、同じ期間保持される。
- [ ] 保持した署名を検証できるよう、エージェントの公開鍵とガバナンスの鍵セットが廃止時にアーカイブされる（DCP-05 §8.4）。
- [ ] 保持したバンドルが、アーカイブした鍵と失効の状態に照らして、`verifySignedBundleV2`（または `dcp verify-bundle`）で定期的に再検証され、その結果が記録される。

<a id="52-tamper-evidence-and-anchoring-art-736-evidence-for-arts-7273"></a>

### 5.2 改ざんの証拠とアンカリング（第 73 条 (6)、第 72–73 条の証拠）

- [ ] 監査のマークルルート（またはバンドルのハッシュ）が、決まった頻度で透明性ログに送られ、かつ／またはアンカーされる。適用される最も短いインシデント報告の期間（第 73 条 (3) に基づく 2 日）より短い頻度を選ぶこと。典型的には 1 時間ごとまたは 1 日ごとのバッチ（[TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)、レイヤー 4）。
- [ ] 透明性ログが、永続的な `OPERATOR_KEY`（再起動後も署名付きツリーヘッドを検証し続けられるように）、永続的なストレージ、そして鍵を固定した少なくとも 1 つのゴシップのピア（`GOSSIP_PEERS`）で動いている。
- [ ] 包含証明とアンカーの受領証（`anchor_receipt`：チェーン、トランザクション、ブロック、または `log_url` と `log_index`）が、それらが対象とするバンドルと一緒に保存される。
- [ ] オンチェーンのアンカリングが求められる場合、`contracts/ethereum/src/DCPAnchor.sol` に対する本番のアンカー、または Bitcoin の OP_RETURN のフローがデプロイされている。リファレンスのアンカーサービスだけでは `tx_hash: null` が記録される。

<a id="53-human-oversight-arts-14-2612"></a>

### 5.3 人間による監督（第 14 条、第 26 条 (1)–(2)）

- [ ] 高リスクの文脈にある各エージェントが、`override_rights: true`、有効な `expires_at`、そしてエージェントの実行環境ではなく責任あるプリンシパルが保持する `binding_keys` を持つ RPR を持っている。
- [ ] 責任あるプリンシパル（または `organization` の RPR が対応付けられる人々）が、第 26 条 (2) に基づき人間による監督を割り当てられた自然人であり、その対応付けが内部の台帳で維持されている。
- [ ] 導入者が人間に承認させたい行動の種類、データクラス、影響のレベルについて、ポリシーのルールが `required_confirmation` を伴う `escalate` を返す。アプリケーションは、Human Confirmation がない場合や `deny` の場合に処理を止める。
- [ ] 重要な次元について、`action_if_triggered` を `escalate` または `block` にした認識の閾値がマンデートごとに宣言されている。アドバイザリー宣言は DCP-09 §5.3 と整合する `response_deadline` を持ち、`proceeded_without_response` が監視されている。
- [ ] 各エージェントの緊急失効の秘密値が存在し、エージェントの実行環境の外で責任あるプリンシパルが保持している。そしてアプリケーションには、失効が発動したときにプロセスを止めるキルスイッチがある（失効だけでは実行中のプロセスは止まらない）。
- [ ] 検証器が、自らが扱う最も高いティアの伝播レイテンシの範囲内で失効の状態を確認し（[SECURITY_MODEL.md](SECURITY_MODEL.md)、「Revocation Propagation SLAs」）、検証キャッシュの TTL が core §14.5 に従っている。TypeScript の `VerificationCache` はバンドルのハッシュだけをキーにしており、その `invalidateByAgent` は何もしないため、失効や信頼が変わったときはキャッシュを空にすること（[API_REFERENCE.md](API_REFERENCE.md)）。
- [ ] 遠隔生体識別について、第 14 条 (5) の 2 人ルールが意図に対するマルチパーティ承認で実装され、導入者のプロセスとして文書化されている。

<a id="54-key-custody-and-verifier-policy"></a>

### 5.4 鍵の保管と検証器のポリシー

- [ ] 秘密鍵が、[SECURITY_MODEL.md](SECURITY_MODEL.md) のティアの要件（「Private Key Storage」）に従って保管されている。`elevated` では HSM または TPM を使うべきであり（SHOULD）、`maximum` では使わなければならない（MUST）。このリポジトリは HSM や TPM との統合を提供しない（TypeScript のコードにある `HsmCryptoProvider` はシミュレーション）ため、その保管は組織自身のインフラが担う。
- [ ] 検証器のポリシー（`VerifierPolicy`、`VERIFIER_MODE`）が少なくとも `hybrid_preferred` を使い、`risk_overrides` がティアのモードを下回ることはない。移行が完了したら `ALLOW_V1_BUNDLES=false`。
- [ ] オペレーターのエンドポイントが `OPERATOR_TOKEN` で保護されている。`TRUST_PROXY` は、クライアントの IP を付け加えるプロキシの背後でのみ設定する。
- [ ] リファレンスのゲートウェイの DCP-05–09 のエンドポイントは、`OPERATOR_TOKEN` で保護されず、署名も検証しないため、信頼できないクライアントに公開されない（[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#dcp-0509-service-endpoints)）。それらが保持する記録は、検証済みの証拠として扱われない。

<a id="55-data-protection-section-37"></a>

### 5.5 データ保護（3.7 節）

- [ ] RPR が `pii_salt` とともに作成される。アンカーと透明性ログが受け取るのはハッシュだけで、組織の外の相手方が見るのはブラインド RPR だけである。
- [ ] `human_id` が不透明な識別子であり、メールアドレスや名前、あるいはそのいずれかのハッシュではない。
- [ ] 削除手続きが、規制当局や相手方と共有したコピーを含め、完全な RPR のすべてのコピーを対象にしており、コミットメントの消去が実際に成り立つ。
- [ ] データ保護影響評価（および第 27 条が適用される場合は基本権影響評価）が、`human_id` を含む DCP の記録とその保持を列挙している。

<a id="56-documentation-arts-11-13--provider"></a>
<a id="56-documentation-arts-11-13-provider"></a>

### 5.6 文書（第 11 条、第 13 条） — 提供者

- [ ] 使用説明書が、どの監督の措置がシステムに組み込まれているか（第 14 条 (3)(a)）、どれを導入者が運用しなければならないか（第 14 条 (3)(b)）を示し、この文書、`spec/DCP-AI-v2.0.md`、`spec/VERIFICATION.md`、`schemas/v2/` の固定したバージョンを参照して、ログの形式と検証の仕組み（第 13 条 (3)(f)）を記述している。
- [ ] 附属書 IV の技術文書が、説明責任のレイヤー（1(b)、2(c)、2(h)、3）についてのみ DCP を引用し、使用している DCP 仕様のバージョン、SDK パッケージのバージョン、検証器のポリシーを明記している。

---

<a id="6-gaps-what-dcp-does-not-address"></a>

## 6. ギャップ：DCP が扱わないこと

誰もこれらについて DCP を引用しないよう、ここに明記します。

| 領域 | DCP が扱わない理由 |
|------|---------------------------|
| **高リスクの分類、提供者と導入者の判定** | AI システムと組織に関する法的な判断です。DCP はシステムの意図された目的を知りません。 |
| **リスク管理システム（第 9 条）、品質管理、適合性評価、CE マーキング、EU データベースへの登録（第 49 条、第 71 条）** | 提供者のプロセスと行政上の行為です。`risk_score` は行動ごとのゲートのシグナルであり、リスク評価ではありません。 |
| **AI システムの技術文書（第 11 条、附属書 IV の 1(a)、1(c)–(h)、2(a)–(b)、2(d)–(g)、4–9）** | モデル、データ、検証、変更を記述するものです。DCP が文書化するのは説明責任のレイヤーだけです。 |
| **使用説明書（第 13 条 (2)–(3)）** | 提供者の文書です。DCP はその中で引用できますが、それを置き換えることはできません。 |
| **自動化バイアス、監督者の能力と訓練（第 14 条 (4)(b)、第 26 条 (2)）** | 人的要因であり、DCP が生成するどの記録の外にもあります。 |
| **AI システムを安全な状態で停止すること（第 14 条 (4)(e)）** | 失効はエージェントのバンドルの受け入れを止めるだけで、プロセスを止めることも行動を取り消すこともありません。 |
| **生体認証に固有のロギング（第 12 条 (3)(a)–(c)）と 2 人による検証そのもの（第 14 条 (5)）** | DCP には参照データベースや一致した入力のフィールドがなく、能力を証明することもできません。 |
| **コンテンツのマーキングとディープフェイクの開示（第 50 条 (2)、50 条 (4)）** | 生成コンテンツに対する別の技術的措置です。 |
| **自然人への開示（第 26 条 (11)、第 50 条 (1)、第 50 条 (5)）** | UI と文言は提供者と導入者が担います。DCP はエージェントの身元についての検証可能な証明を提供するだけです。 |
| **市場監視当局と提供者への通知（第 26 条 (5)、第 73 条）** | DCP には通知のアーティファクトがありません。`rights_violation_report` はエージェントの DCP-08 の権利（記憶の完全性、尊厳ある移行、アイデンティティの一貫性、不変の記録）に関するもので、`dispute_record` はエージェント間の対立に関するものです。どちらも重大なインシデントの報告ではありません。 |
| **影響を受けた自然人のための苦情と説明（第 27 条 (1)(f)、第 85 条、第 86 条）** | DCP-07 の紛争と DCP-08 の権利は、エージェントとそのプリンシパルの間の仕組みです。影響を受けた人はプロトコルの当事者ではありません。 |
| **市販後モニタリング計画（第 72 条 (3)）** | 提供者の附属書 IV の文書の一部です。DCP の記録はその入力データです。 |
| **保持の強制** | DCP のフィールドも検証器のルールも、保持期間を強制しません。DCP-08 §3.5 が原則を述べ、組織がそれを実装します。廃止記録の `data_disposition`（`transferred`、`archived`、`destroyed`）は判断を記録するだけで、強制はしません。DCP-05 §8.2 の例が示す `archive_retention_period` は、`schemas/v2/decommissioning_record.schema.json` のフィールドではありません。 |
| **意図のゲートの外にある行動** | モデルの推論、UI のイベント、意図として宣言されていないツール呼び出しは、DCP の記録を生成しません。 |
| **PQ チェックポイントの内容（v2.10.0）** | リリース v2.10.0 では、PQ チェックポイントの内容を確認する SDK の検証器はありません（`spec/VERIFICATION.md` V2-12、[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md)）。チェックポイントは生成され、署名されますが、検証器が確認するのはチェーンとマークルルートだけです。**`main` の SDK 検証器はすでに内容を検査します**。npm SDK 2.2.0 と WASM 2.1.0 にもこの検査が含まれます。他の環境の公開は別です（[CHANGELOG.md](../CHANGELOG.md)、[npm 一覧](NPM_RELEASES.md)）。 |
| **リファレンスサービスにおける永続的なストレージ** | リファレンスのゲートウェイ、アンカー、透明性ログは状態をメモリに保持します。失効サービスも、`REVOCATION_STATE_PATH` が永続的なストレージを指していない限り（オプトイン）同様です。アンカーサービスはオンチェーンのトランザクションを送信しません。 |
| **リファレンスのゲートウェイの DCP-05–09 のエンドポイントの認証** | スキーマは検証しますが、署名を検証せず、トークンも要求しません。そこに到達できる人なら誰でも、ライフサイクル、紛争、マンデートの状態を変更できます（[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#dcp-0509-service-endpoints)）。 |

---

<a id="7-sources-read-for-the-legal-review-22-october-2026"></a>

## 7. 法令レビューで読んだ資料（2026 年 10 月 22 日）

公式テキスト：

- 規則 (EU) 2024/1689、公布されたままのテキスト、EUR-Lex の HTML：https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689 — 表題と官報のヘッダー、第 III 章第 1–4 節と第 IX 章第 1–4 節の見出し、第 3 条（1、3、4、12、49）、第 9、11、12、13、14、19、26、27、50、72、73、85、86、113 条と附属書 IV、アンカー `#art_<n>` と `#anx_IV`。
- 規則 (EU) 2026/1744（Digital Omnibus on AI）：https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng — 表題、官報の参照、前文 39–41、第 1 条の (10)、(13)、(20)、(30)、(31)、(39)、(40)、第 4 条。

欧州委員会の公式ページ：

- AI 法の政策ページ：https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai（最終更新 2026 年 10 月 19 日）。
- 2026 年 5 月 7 日のニュース、政治的合意：https://digital-strategy.ec.europa.eu/en/news/eu-agrees-simplify-ai-rules-boost-innovation-and-ban-nudification-apps-protect-citizens
- 2026 年 7 月 27 日のニュース、発効：https://digital-strategy.ec.europa.eu/en/news/ai-omnibus-enters-force
- デジタルパッケージの FAQ（提案段階）：https://digital-strategy.ec.europa.eu/en/faqs/digital-package（最終更新 2025 年 11 月 20 日）。

この対応付けが依拠するリポジトリの文書：`spec/DCP-AI-v2.0.md`（§8–§12、§14、§18）、`spec/DCP-01.md`–`spec/DCP-03.md`、`spec/DCP-05.md`、`spec/DCP-07.md`、`spec/DCP-08.md`、`spec/DCP-09.md`、`spec/VERIFICATION.md`、`schemas/v2/*.schema.json`、[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)、[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md)、[SECURITY_MODEL.md](SECURITY_MODEL.md)、[TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)、[OBSERVABILITY.md](OBSERVABILITY.md)、`services/README.md`、`sdks/typescript/src/index.ts`。

この文書は参考情報です。仕様を変更するものではなく、法的助言でもありません。
