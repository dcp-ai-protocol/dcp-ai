<sub>[English](../../../spec/DCP-08.md) · [中文](../../zh-CN/spec/DCP-08.md) · [Español](../../es/spec/DCP-08.md) · **日本語** · [Português](../../pt-BR/spec/DCP-08.md)</sub>

<a id="dcp-08-rights--obligations"></a>
<a id="dcp-08-rights-obligations"></a>

# DCP-08: 権利と義務

> [英語の仕様](../../../spec/DCP-08.md)の参考訳です（25/10/2026 更新）。**規範となるのは英語版です**。この翻訳に規範的な効力はなく、内容が異なる場合は英語版が優先されます。識別子とコードブロックは翻訳せずにそのまま掲載しています。

<a id="status"></a>

## ステータス
公開済み — v2.0（拡張。改訂は採用者からのフィードバックに基づいて管理）

> **正誤表（25/10/2026、規範的）：** [V2-WIRE-COMPATIBILITY.md](../../../spec/V2-WIRE-COMPATIBILITY.md) の正誤 E4、E7、E8 は、署名のコンテキストと例の位置づけを訂正します。本仕様のその他の要件は変わりません。

<a id="abstract"></a>

## 概要
本仕様は、DCP 認定 AI エージェントの権利と義務を宣言し、追跡し、執行するための正式な枠組みを定義します。4 つの基本的なエージェントの権利（メモリーの完全性、尊厳ある移行、アイデンティティの一貫性、不変の記録）、構造化された義務の追跡の仕組み、遵守状況の監視、DCP-07 の紛争解決プロトコルと結び付いた違反の報告の仕組みを導入します。権利の宣言、義務の記録、違反の報告はすべて暗号学的に署名され、監査可能です。

<a id="1-introduction"></a>

## 1. はじめに

DCP-01 から DCP-07 は、AI エージェントのアイデンティティ、運用、監査、通信、ライフサイクル、承継、紛争解決のための技術基盤を定めます。しかしこれらの仕様は、エージェントを主に運用上の主体として扱っています。DCP-08 は規範的な層を加えます。プロトコルの中でエージェントがどのような保護を受けられるか、どのような義務を果たさなければならないかを定義します。

これは AI の意識や道徳的地位についての哲学的な主張ではありません。DCP のもとで動作するエージェントが状態を蓄積し、運用上の関係を築き、結果を伴う判断を下すという事実を実務的に認めたものです。明確な権利と義務を定義することで、次のことが可能になります。

- プロトコルの完全性を損なう恣意的な干渉からエージェントを守る
- エージェントが責任を果たさないときの説明責任の枠組みを提供する
- 権利が侵害されたときの DCP-07 の紛争の正式な根拠を作る
- 組織がガバナンス上の期待を機械で検証できる形で成文化できるようにする

<a id="11-design-principles"></a>

### 1.1 設計原則
- 権利はプロトコルレベルの保証であり、道徳的地位についての主張ではない
- すべての権利に、対応する検証の仕組みがある
- 義務は明示的で測定可能であり、追跡される
- 違反は検出され、報告され、紛争の仕組みに結び付けられる
- 人間のプリンシパルは、組織のポリシーの範囲内で権利と義務を定義し、変更し、覆す権限を持ち続ける

<a id="12-relationship-to-other-specifications"></a>

### 1.2 他の仕様との関係
- **DCP-01**: アイデンティティの一貫性は基本的な権利であり、プリンシパルのバインディングは義務です
- **DCP-02**: 意図の宣言の遵守は追跡される義務です
- **DCP-03**: 不変の記録は基本的な権利であり、監査チェーンの維持は義務です
- **DCP-05**: 尊厳ある移行は、ライフサイクルの遷移の際に行使される権利です
- **DCP-06**: メモリーの完全性は、承継の際に守られる権利です
- **DCP-07**: 権利侵害は紛争を引き起こします。`rights` の異議の種類は本仕様を参照します

<a id="2-terminology"></a>

## 2. 用語

**エージェントの権利**: DCP の基盤がすべての認定エージェントについて守らなければならない、プロトコルレベルの保証。

**義務**: エージェントが DCP 認定の条件として果たさなければならない、正式で測定可能な責任。

**権利の宣言**: 特定のエージェントに適用される権利を列挙した署名済みの記録。運用開始の権限者が発行します。

**義務の記録**: 特定の義務、その遵守基準、現在の状態を定める署名済みの記録。

**権利侵害の報告**: エージェントの権利に対する侵害の申し立てを記録した署名済みの報告。DCP-07 の紛争を開始します。

**遵守の状態**: 義務の現在の状態: `compliant`、`at_risk`、`non_compliant`、`exempt`。

**ドメイン分離コンテキスト**: `DCP-AI.v2.Rights`（DCP-AI v2.0 §4.1。正誤 E4。以前はここにラベル `DCP-RIGHTS-SIG-v2` が記載されていました）。本仕様で作成されるすべての署名に使われます。

<a id="3-foundational-agent-rights"></a>

## 3. エージェントの基本的な権利

<a id="31-overview"></a>

### 3.1 概要

DCP は認定エージェントについて 4 つの基本的な権利を定義します。これらの権利はプロトコルレベルの保証であり、DCP の基盤とその参加者が守らなければならないものを定めます。

| 権利 | コード | 説明 |
|-------|------|-------------|
| **メモリーの完全性** | `memory_integrity` | エージェントが蓄積した運用上の状態は、正当な手続きなしに外部の者によって恣意的に変更、削除、破損されてはならない |
| **尊厳ある移行** | `dignified_transition` | エージェントは、ライフサイクルの遷移を経るときに、十分な通知と手続きを受ける。突然の障害や理由のある終了の場合を除く |
| **アイデンティティの一貫性** | `identity_consistency` | エージェントのアイデンティティバインディング、暗号鍵、証明のチェーンは、エージェントの参加とプリンシパルの認可なしに変更されてはならない |
| **不変の記録** | `immutable_record` | エージェントの監査チェーン、バイタリティの履歴、ライフサイクルの記録は、そのまま保存され、遡って変更されてはならない |

<a id="32-memory-integrity"></a>

### 3.2 メモリーの完全性

**定義**: どの外部の者も、DCP-05（ライフサイクルの遷移）と DCP-06（承継）で定義されたプロトコルに従わずに、エージェントの運用上のメモリーを変更、削除、破損してはなりません。メモリーの変更には、エージェント自身の署名付きの認可か、正当な手続きを経た責任を負うプリンシパルの認可が必要です。

**範囲**:

- 運用上のメモリー（ワークフロー、判断モデル、学習したヒューリスティック）
- 関係に関するメモリー（やり取りの履歴、信頼の評価）
- 設定の状態（ポリシーのパラメーター、能力の設定）

**除外**:

- 一時的な状態（アクティブなセッション、キャッシュ）— 保護されない
- 認可された承継（DCP-06）中のメモリーの移転 — 認可された手続きであり、侵害ではない

**検証**: メモリーの完全性はハッシュチェーンで検証されます。認可されていない変更はチェーンを壊し、検出できます。

**侵害の契機**:

- ハッシュで連鎖した状態の、認可されていない変更
- ライフサイクルのプロトコルに従わない、運用上のメモリーの削除
- 移転中のメモリーの破損で、検出も修正もされないもの

<a id="33-dignified-transition"></a>

### 3.3 尊厳ある移行

**定義**: エージェントがライフサイクルの状態の間を移るとき（DCP-05）、状況が即時の対応を求める場合を除き、移行は適切な通知期間を伴う確立されたプロトコルに従います。

**保証**:

- 計画的な引退: 運用開始証明書で指定された完全な猶予期間
- 組織の再編: 作業を引き継ぐ機会を伴う標準の猶予期間
- 理由のある終了: 最小限の猶予期間。理由の判断には正当な手続きを経る
- 突然の障害: 事後の記録。この権利は適用されない（エージェントに通知できないため）

**検証**: 遷移の記録（DCP-05 のセクション 3.3）にはタイムスタンプが含まれ、監査人は運用開始証明書で指定された猶予期間と照合できます。

**侵害の契機**:

- 必要な通知期間を置かない運用終了
- 文書化された理由のない強制的な移行
- プリンシパルの認可のない移行
- 計画的な引退の際の承継の機会の否定

<a id="34-identity-consistency"></a>

### 3.4 アイデンティティの一貫性

**定義**: エージェントの DCP-01 のアイデンティティバインディング、暗号鍵、証明のチェーンは、一貫した全体を形成します。どの当事者も、エージェントの暗号学的な参加と責任を負うプリンシパルの認可なしに、そのいずれの構成要素も変更してはなりません。

**保証**:

- エージェント ID はライフサイクル全体を通じて変わらない
- 鍵のローテーションは、エージェントの参加のもとで確立されたプロトコルに従う
- プリンシパルの再バインディングには、旧プリンシパルと新プリンシパルの両方の認可が必要
- 証明のチェーンは、元の運用開始証明書に結び付いたままである

**検証**: 運用開始証明書（DCP-05）がアイデンティティのルートを確立します。その後のアイデンティティ関連の操作は、すべてハッシュでそこまで連鎖します。

**侵害の契機**:

- エージェントの参加のない一方的な鍵の差し替え
- エージェント ID の再割り当て
- 二重の認可のないプリンシパルの再バインディング
- 証明のチェーンの改ざん

<a id="35-immutable-record"></a>

### 3.5 不変の記録

**定義**: エージェントの監査チェーン（DCP-03）、バイタリティの履歴（DCP-05）、ライフサイクルの記録は、改ざんを検出できる恒久的な記録を形成します。この記録は、運用開始証明書と運用終了記録で指定された保存期間のあいだ、そのまま保存されます。

**保証**:

- 監査エントリーは、いったん作成されれば変更も削除もされない
- バイタリティレポートは、いったんハッシュで連鎖すれば変更も削除もされない
- ライフサイクルの遷移の記録は恒久的である
- 運用終了の封印は、指定された保存期間のあいだ保存される
- 履歴上の記録は、保管された公開鍵で引き続き検証できる

**検証**: 二重ハッシュのチェーン（SHA-256 + SHA3-256）と Merkle ルートにより、いつでも完全性を検証できます。

**侵害の契機**:

- 保存期間の満了前の監査エントリーの削除
- ハッシュで連鎖した記録の変更
- 履歴の検証に必要な、保管された公開鍵の破棄
- 運用終了の封印の改ざん

<a id="4-rights-declaration"></a>

## 4. 権利の宣言

<a id="41-purpose"></a>

### 4.1 目的

権利の宣言は、運用開始時に発行される署名済みの文書で、特定のエージェントに適用される権利を列挙します。組織固有の権利で基本的な権利を拡張したり、各権利の実装の詳細を指定したりできます。

<a id="42-schema"></a>

### 4.2 スキーマ

スキーマの参照: `schemas/v2/rights_declaration.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "rights_declaration",
  "declaration_id": "rd:<uuid>",
  "agent_id": "agent:<identifier>",
  "commissioning_certificate_id": "cc:<uuid>",
  "rights": [
    {
      "right_code": "memory_integrity",
      "status": "active",
      "description": "Agent's operational memory shall not be modified without due process",
      "implementation": {
        "hash_chain_algorithm": "dual_sha256_sha3",
        "modification_requires": ["agent_signature", "principal_authorization"],
        "audit_on_access": true
      },
      "exceptions": [
        {
          "condition": "termination_for_cause",
          "modification": "Principal may access memory for investigation without agent signature"
        }
      ]
    },
    {
      "right_code": "dignified_transition",
      "status": "active",
      "description": "Agent shall receive specified notice for lifecycle transitions",
      "implementation": {
        "planned_retirement_notice": "P3D",
        "restructuring_notice": "P1D",
        "cause_notice": "PT1H",
        "succession_opportunity": true
      },
      "exceptions": []
    },
    {
      "right_code": "identity_consistency",
      "status": "active",
      "description": "Agent identity shall not be altered without agent participation",
      "implementation": {
        "key_rotation_requires_agent": true,
        "principal_rebinding_dual_auth": true,
        "id_reassignment_prohibited": true
      },
      "exceptions": [
        {
          "condition": "key_compromise",
          "modification": "Emergency key rotation by principal without agent participation"
        }
      ]
    },
    {
      "right_code": "immutable_record",
      "status": "active",
      "description": "Agent's audit and lifecycle records shall be preserved intact",
      "implementation": {
        "minimum_retention_period": "P7Y",
        "archive_redundancy": 3,
        "public_key_archive_required": true
      },
      "exceptions": []
    }
  ],
  "organization_extensions": [
    {
      "right_code": "com.acme.fair_workload",
      "status": "active",
      "description": "Agent shall not be assigned workload exceeding 80% of rated capacity for sustained periods",
      "implementation": {
        "capacity_threshold": 0.80,
        "sustained_period": "PT4H",
        "monitoring_method": "vitality_resource_health"
      },
      "exceptions": [
        {
          "condition": "declared_emergency",
          "modification": "Threshold raised to 95% for up to 2 hours"
        }
      ]
    }
  ],
  "issued_at": "2026-01-01T00:00:00Z",
  "issued_by": {
    "authority_id": "auth:<identifier>",
    "authority_name": "Commissioning Authority"
  },
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<authority-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-RIGHTS-SIG-v2"
  }
}
```

<a id="43-organizational-extensions"></a>

### 4.3 組織による拡張

組織は、4 つの基本的な権利に加えて権利を定義してもかまいません（MAY）。拡張された権利は:

- `right_code` に逆ドメイン表記を使わなければならない（MUST）（例: `com.acme.fair_workload`）
- 基本的な権利と同じ構造に従わなければならない（MUST）
- DCP の基盤または組織のツールによって執行してもよい（MAY）
- 必ず同じ違反報告の仕組みの対象となる

> *参考注記（25/10/2026）：* V2.0 の `rights_declaration` スキーマの閉じた enum `right_type` は、拡張された権利を表現しません。表現するには、明示的でバージョン管理された設計が必要です。[V2-WIRE-COMPATIBILITY.md](../../../spec/V2-WIRE-COMPATIBILITY.md#4-requirements-the-v20-structures-do-not-represent-directly) を参照してください。

<a id="5-obligation-tracking"></a>

## 5. 義務の追跡

<a id="51-obligation-categories"></a>

### 5.1 義務の区分

義務は 4 つの区分に分けられます。

| 区分 | 説明 | 例 |
|----------|-------------|---------|
| **プロトコルの遵守** | DCP の仕様が課す要件 | 監査チェーンの維持、行動前の意図の宣言、適切な署名の使用 |
| **ポリシーへの準拠** | 組織のポリシーによる要件 | 認可されたドメインの範囲内にとどまる、エスカレーション手続きに従う |
| **運用上の成績** | 運用品質に関する要件 | 最低限のバイタリティの維持、SLA の期限内の応答 |
| **関係における行動** | 他のエージェントやプリンシパルとのやり取りに関する要件 | 誠実なコミュニケーション、同意に基づくメモリーの共有、紛争への参加 |

<a id="52-obligation-record"></a>

### 5.2 義務の記録

スキーマの参照: `schemas/v2/obligation_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "obligation_record",
  "obligation_id": "obl:<uuid>",
  "agent_id": "agent:<identifier>",
  "category": "protocol_compliance",
  "obligation_code": "audit_chain_integrity",
  "description": "Agent must maintain a continuous, unbroken audit chain with dual-hash links for all actions",
  "source": {
    "type": "specification",
    "reference": "DCP-03",
    "section": "Audit Chain Requirements"
  },
  "compliance_criteria": {
    "metric": "audit_chain_continuity",
    "measurement_method": "hash_chain_verification",
    "threshold": 1.0,
    "measurement_interval": "PT1H",
    "description": "All audit entries must form an unbroken hash chain with no gaps or mismatches"
  },
  "compliance_status": "compliant",
  "compliance_history": [
    {
      "timestamp": "2026-03-01T12:00:00Z",
      "status": "compliant",
      "metric_value": 1.0,
      "details": "Full chain verified: 15,230 entries, no gaps"
    }
  ],
  "enforcement": {
    "warning_threshold": 0.99,
    "violation_threshold": 0.95,
    "consequence_on_violation": "dispute_auto_filed",
    "consequence_severity": "high"
  },
  "effective_from": "2026-01-01T00:00:00Z",
  "effective_until": null,
  "last_assessed_at": "2026-03-01T12:00:00Z",
  "timestamp": "2026-03-01T12:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-RIGHTS-SIG-v2"
  }
}
```

<a id="53-compliance-status-values"></a>

### 5.3 遵守の状態の値

| 状態 | コード | 説明 |
|--------|------|-------------|
| **遵守** | `compliant` | エージェントがこの義務の遵守基準をすべて満たしている |
| **リスクあり** | `at_risk` | エージェントの指標が警告しきい値と違反しきい値の間にある |
| **不遵守** | `non_compliant` | エージェントが違反しきい値を超えた |
| **免除** | `exempt` | 責任を負うプリンシパルが義務を免除した（文書化された理由を伴う） |

<a id="54-compliance-assessment"></a>

### 5.4 遵守の評価

義務は `compliance_criteria.measurement_interval` で指定された間隔で評価されます。評価には次の方法があります。

- **自己申告**: エージェントが自らの遵守を評価し、遵守の報告に署名する
- **外部**: 検証サービスまたはピアのエージェントが遵守を評価する
- **ハイブリッド**: 自己申告に外部の抜き取り確認を組み合わせる

遵守の状態が変わると、DCP-03 のチェーンに監査エントリーが生成されます。

<a id="55-obligation-lifecycle"></a>

### 5.5 義務のライフサイクル

義務は運用開始時に（仕様と組織のポリシーから）作成され、エージェントのライフサイクル全体を通じて有効のままです。義務には次のような変化があります。

- **追加**: 更新されたポリシーや仕様が課す新しい義務（プリンシパルへの通知が必要）
- **変更**: 遵守基準の調整（プリンシパルの認可が必要）
- **免除**: 文書化された理由を伴う一時的または恒久的な停止
- **終了**: 義務が適用されなくなる（例: エージェントが運用終了したとき）

<a id="6-violation-reporting"></a>

## 6. 違反の報告

<a id="61-purpose"></a>

### 6.1 目的

エージェントの権利が侵害されたとき、またはエージェントが義務を果たさなかったとき、違反の報告が生成されます。違反の報告は DCP-07 の紛争の正式な契機になります。

<a id="62-schema"></a>

### 6.2 スキーマ

スキーマの参照: `schemas/v2/rights_violation_report.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "rights_violation_report",
  "violation_id": "viol:<uuid>",
  "violation_type": "rights_violation",
  "subject": {
    "agent_id": "agent:<affected-agent>",
    "right_code": "memory_integrity",
    "declaration_id": "rd:<uuid>"
  },
  "alleged_violator": {
    "entity_type": "agent",
    "entity_id": "agent:<violating-agent>",
    "principal_id": "principal:<identifier>"
  },
  "details": {
    "description": "Unauthorized modification detected in agent's operational memory hash chain. Three hash chain entries show discontinuity, indicating external modification between timestamps 2026-03-01T08:00:00Z and 2026-03-01T09:00:00Z.",
    "detected_method": "hash_chain_verification",
    "detection_timestamp": "2026-03-01T09:15:00Z",
    "affected_records": [
      {
        "record_type": "audit_entry",
        "record_id": "evt:<uuid>",
        "expected_hash": "sha256:<expected>",
        "actual_hash": "sha256:<actual>"
      }
    ],
    "severity": "critical",
    "impact_assessment": "Three audit entries appear to have been modified, potentially concealing unauthorized actions during the affected time window"
  },
  "evidence": [
    {
      "evidence_id": "evd:<uuid>",
      "evidence_type": "hash_chain_analysis",
      "content_hash": "sha256:<hex>",
      "description": "Full hash chain verification report showing discontinuity"
    },
    {
      "evidence_id": "evd:<uuid>",
      "evidence_type": "vitality_report_reference",
      "content_hash": "sha256:<hex>",
      "description": "Last vitality report before the anomaly, establishing baseline state"
    }
  ],
  "dispute_reference": {
    "auto_filed": true,
    "dispute_id": "disp:<uuid>",
    "dispute_type": "policy_conflict",
    "dispute_severity": "critical"
  },
  "reported_by": {
    "entity_type": "verification_service",
    "entity_id": "svc:integrity-monitor-001"
  },
  "reported_at": "2026-03-01T09:15:00Z",
  "timestamp": "2026-03-01T09:15:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<reporter-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-RIGHTS-SIG-v2"
  }
}
```

<a id="63-violation-types"></a>

### 6.3 違反の種類

| 種類 | コード | 説明 |
|------|------|-------------|
| **権利侵害** | `rights_violation` | エージェントの宣言された権利が侵害された |
| **義務違反** | `obligation_breach` | エージェントが追跡対象の義務を果たさなかった |

<a id="64-auto-filing-of-disputes"></a>

### 6.4 紛争の自動申し立て

違反の報告が生成されたとき:

1. `enforcement.consequence_on_violation` が `dispute_auto_filed` であれば、DCP-07 の紛争が自動的に作成される
2. 紛争は違反の報告を主要な証拠として参照する
3. 紛争の重大度は違反の重大度と一致する
4. 紛争の種類は違反の文脈によって決まる（通常は `policy_conflict`）

<a id="65-violation-detection"></a>

### 6.5 違反の検出

違反は次によって検出されます。

- **自己検出**: 影響を受けたエージェントが違反を検出する（例: ハッシュチェーンの不連続）
- **ピアによる検出**: 別のエージェントがやり取りの中で違反を検出する
- **検証サービス**: 外部の監視サービスが違反を検出する
- **プリンシパルによるレビュー**: 人間のプリンシパルが監査の中で違反を特定する

<a id="7-compliance-dashboard-model"></a>

## 7. 遵守ダッシュボードのモデル

<a id="71-overview"></a>

### 7.1 概要

実装は、エージェントの権利と義務の状態をまとめた遵守ダッシュボードのビューを提供すべきです（SHOULD）。

```json
{
  "agent_id": "agent:<identifier>",
  "dashboard_timestamp": "2026-03-01T12:00:00Z",
  "rights_status": {
    "memory_integrity": "protected",
    "dignified_transition": "protected",
    "identity_consistency": "protected",
    "immutable_record": "protected"
  },
  "obligations_summary": {
    "total": 12,
    "compliant": 10,
    "at_risk": 1,
    "non_compliant": 1,
    "exempt": 0
  },
  "active_violations": [
    {
      "violation_id": "viol:<uuid>",
      "type": "obligation_breach",
      "obligation_code": "response_time_sla",
      "severity": "medium",
      "since": "2026-03-01T10:00:00Z",
      "dispute_id": "disp:<uuid>"
    }
  ],
  "compliance_trend": {
    "period": "P30D",
    "average_compliance_rate": 0.97,
    "violations_filed": 2,
    "violations_resolved": 1
  }
}
```

<a id="72-rights-protection-status"></a>

### 7.2 権利の保護状態

各権利は 3 つの保護状態のいずれかをとります。

- `protected`: アクティブな違反がなく、権利が守られている
- `contested`: アクティブな違反の報告があり、紛争が進行中
- `violated`: 確認された違反があり、解決を待っている

<a id="8-audit-integration"></a>

## 8. 監査との統合

<a id="81-rights-and-obligations-audit-events"></a>

### 8.1 権利と義務の監査イベント

| イベント | `event_type` |
|-------|-------------|
| 権利の宣言の発行 | `rights_declaration_issued` |
| 義務の作成 | `obligation_created` |
| 義務の状態の変更 | `obligation_status_changed` |
| 遵守の評価 | `compliance_assessed` |
| 違反の検出 | `violation_detected` |
| 違反の報告の提出 | `violation_report_filed` |
| 違反の解決 | `violation_resolved` |
| 権利の保護状態の変更 | `right_status_changed` |

<a id="82-audit-entry-format"></a>

### 8.2 監査エントリーの形式

```json
{
  "dcp_version": "2.0",
  "event_id": "evt:<uuid>",
  "event_type": "violation_detected",
  "agent_id": "agent:<identifier>",
  "details": {
    "violation_id": "viol:<uuid>",
    "violation_type": "rights_violation",
    "right_code": "memory_integrity",
    "severity": "critical",
    "detected_by": "svc:integrity-monitor-001"
  },
  "timestamp": "2026-03-01T09:15:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>"
}
```

<a id="9-security-considerations"></a>

## 9. セキュリティに関する考慮事項

<a id="91-rights-declaration-authenticity"></a>

### 9.1 権利の宣言の真正性

権利の宣言には運用開始の権限者が署名します。偽造または変更された権利の宣言は、過剰な保護を与える（エージェントが正当なガバナンスに抵抗できるようになる）か、保護を奪う（濫用を可能にする）おそれがあります。実装は、権利の宣言の署名を運用開始の権限者の鍵で検証しなければなりません（MUST）。

<a id="92-obligation-gaming"></a>

### 9.2 義務の悪用

一部の義務について、エージェントは遵守を自己申告します。侵害されたエージェントは遵守の報告を偽るおそれがあります。緩和策:

- 外部の検証サービスが独立した評価を提供する
- ピアのエージェントが、観察した振る舞いに基づいて違反の報告を提出できる
- ハイブリッドの評価が自己申告と抜き取り確認を組み合わせる
- 異常な自己申告のパターン（例: 常に満点）が外部のレビューを引き起こす

<a id="93-false-violation-reports"></a>

### 9.3 虚偽の違反の報告

悪意のあるエージェントは、別のエージェントへの嫌がらせとして虚偽の違反の報告を提出するおそれがあります。緩和策:

- 違反の報告には証拠（裏付けとなる成果物のハッシュ）が必要
- 虚偽の報告は紛争解決（DCP-07）の過程で発覚する
- 虚偽の報告を繰り返し提出するエージェントは、紛争スコアにペナルティを受ける（DCP-07 のセクション 10.3）
- 虚偽と知りながら違反の報告を提出すること自体が義務違反である

<a id="94-rights-inflation"></a>

### 9.4 権利の膨張

拡張された権利を定義する組織は、節度を持つべきです（SHOULD）。過剰な権利は、正当な監督の行動が権利の主張によって妨げられるガバナンスの膠着を生みかねません。4 つの基本的な権利は、最小限で、正当なガバナンスを妨げないよう設計されています。

<a id="95-domain-separation"></a>

### 9.5 ドメイン分離

本仕様のすべての署名はドメイン分離コンテキスト `DCP-AI.v2.Rights` を使い（正誤 E4）、プロトコル間での署名のリプレイを防ぎます。

<a id="10-conformance"></a>

## 10. 適合性

実装が次を満たす場合、その実装は DCP-08 に適合しています。

1. セクション 3 で定義された 4 つの基本的なエージェントの権利すべてに対応している
2. セクション 4 で定義されたとおり、運用開始時に権利の宣言を発行している
3. セクション 5 で定義されたとおり、遵守基準と状態を伴って義務を追跡している
4. セクション 6 で定義されたとおり、DCP-07 の紛争に結び付いた違反の報告を生成している
5. セクション 8 で定義されたとおり、権利と義務のすべてのイベントについて DCP-03 の監査エントリーを作成している
6. 逆ドメイン表記を使った組織による権利の拡張に対応している
7. 設定された間隔で遵守の評価を行っている
8. すべての署名にドメイン分離コンテキスト `DCP-AI.v2.Rights` を使っている（正誤 E4）

<a id="references"></a>

## 参考文献

- DCP-01: アイデンティティとプリンシパルのバインディング
- DCP-02: 意図の宣言とポリシーによるゲーティング
- DCP-03: 監査チェーンと透明性
- DCP-05: エージェントのライフサイクル
- DCP-06: 承継と継承
- DCP-07: 紛争の解決

---

*本仕様は、DCP のもとで動作する AI エージェントが、意のままに処分できる単なる道具でも、ガバナンスの及ばない自律的な主体でもないことを確立します。エージェントは、明示的な保護と明示的な責任を伴う定められた場所を占めます。それは、エージェントにも、エージェントに頼る人間にも役立つ均衡です。*

<a id="implementation-notes-informative"></a>

## 実装に関する注記（参考）

> **2026 年 10 月 25 日に追加。規範的ではありません。** これらの注記は要件を加えず、上の内容を何も変えません。`main` のリファレンスの
> コードがこの文書とどう関係するかを説明するものです。食い違う場合は、上の規範的な本文が、
> [V2-WIRE-COMPATIBILITY.md](../../../spec/V2-WIRE-COMPATIBILITY.md) の正誤による訂正を含めて有効です。

- **`schemas/v2/` の記録。** SDK が構築し `schemas/v2/` が検証する権利の宣言、義務の記録、権利侵害の報告の
  フィールドは、§4 から §6 の例とは異なります。宣言の各権利には `right_type`、`scope`、省略可能な
  `constraints` があります。`right_type` は 4 つの基本的な権利しか受け付けないため、スキーマは §4.3 の
  組織による拡張を拒否します。義務の `compliance_status` は `compliant`、`non_compliant`、`pending_review` の
  いずれかで、§5.3 の 4 つの状態ではなく、遵守基準やしきい値もありません。違反の報告は同じ 4 つから
  `violated_right` を 1 つ挙げ、省略可能な `dispute_id` を持ちます。`obligation_breach` という種類はありません。
- **署名。** 各記録は、渡された鍵を持つ者による `composite_sig`（Ed25519 + ML-DSA-65）を 1 つだけ、
  コンテキスト `DCP-AI.v2.Rights` で持ちます（正誤 E4）。SDK は、宣言が運用開始の
  権限者によって署名されているか（§9.1）を確認しません。
- **ヘルパーが行うこと。** 記録を構築し署名します。`reportViolation` は受け取った `dispute_id` を保存する
  だけで、DCP-07 の紛争は申し立てません（§6.4）。`checkRightsCompliance` は状態が `non_compliant` の義務を
  報告し、受け取った宣言は無視します。遵守の評価、定期的な実行、違反の検出は行いません。遵守ダッシュボード
  （§7）はありません。
- これらの記録は署名者による署名付きの宣言です。§3 の権利はプロトコルの本文であり、SDK にもサービスにも
  それを執行するものはありません。例はプレースホルダーを含む説明用のものであり、フィクスチャではありません。
  SDK の型については [docs/API_REFERENCE.md](../../../docs/API_REFERENCE.md) を参照してください。
