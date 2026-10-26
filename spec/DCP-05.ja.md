<sub>[English](DCP-05.md) · [中文](DCP-05.zh-CN.md) · [Español](DCP-05.es.md) · **日本語** · [Português](DCP-05.pt-BR.md)</sub>

<a id="dcp-05-agent-lifecycle"></a>

# DCP-05: エージェントのライフサイクル

> [英語の仕様](DCP-05.md)の参考訳です（25/10/2026 更新）。**規範となるのは英語版です**。この翻訳に規範的な効力はなく、内容が異なる場合は英語版が優先されます。識別子とコードブロックは翻訳せずにそのまま掲載しています。

<a id="status"></a>

## ステータス
公開済み — v2.0（拡張。改訂は採用者からのフィードバックに基づいて管理）

> **正誤表（25/10/2026、規範的）：** [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md) の正誤 E2、E3、E7、E8 は、署名のコンテキスト、バイタリティのフィールド名、例の位置づけを訂正します。本仕様のその他の要件は変わりません。

<a id="abstract"></a>

## 概要
本仕様は、DCP 認定 AI エージェントのライフサイクル全体を定義します。運用開始から、稼働中の業務、能力の低下を経て、最終的な運用終了までを扱います。ライフサイクルの状態機械、バイタリティ指標、運用開始証明書、バイタリティレポート、運用終了記録を導入します。いずれも暗号学的に署名され、ハッシュで連鎖し、独立して検証できます。このプロトコルにより、エージェントの運用履歴は改ざんを検出できるものになり、ライフサイクル状態間の遷移は認可され監査可能になり、4 つの異なる終了モードで終了時のあらゆるシナリオに対応できます。

<a id="1-introduction"></a>

## 1. はじめに

DCP-01 から DCP-04 は、AI エージェントのアイデンティティ、意図、監査、通信を定めます。しかしこれらの仕様は、エージェントが安定した運用状態にあることを前提としています。実際には、エージェントの寿命は有限です。作られ、稼働し、劣化し、引退または終了させられます。DCP-05 は包括的なライフサイクルモデルを定義して、この空白を埋めます。

ライフサイクルのプロトコルがないと、組織は次のようなリスクに直面します。

- エージェントがいつ運用を開始し、いつ運用から外されたかについて、権威ある記録がない
- 信頼モデルに反映される継続的な健全性の監視がない
- 秩序ある引退や緊急終了のための標準化された手順がない
- エージェントの誕生から終わりまでをつなぐ、改ざんを検出できる履歴がない

<a id="11-design-principles"></a>

### 1.1 設計原則
- ライフサイクルの状態遷移はすべて署名し記録しなければならない（MUST）
- バイタリティ指標は、遡及的な改ざんを防ぐためにハッシュで連鎖させなければならない（MUST）
- 運用終了では、封印され独立して検証できる記録を作成しなければならない（MUST）
- ライフサイクルのイベントは既存の DCP 監査チェーン（DCP-03）に統合される
- 人間のプリンシパルがライフサイクルの遷移について最終的な権限を持つ

<a id="12-relationship-to-other-specifications"></a>

### 1.2 他の仕様との関係
- **DCP-01**: ライフサイクルの状態はアイデンティティモデルを拡張します。運用終了したエージェントのアイデンティティは監査のために残りますが、新しい行動を認可することはできません
- **DCP-02**: 意図の宣言は `active` 状態のエージェントからのものだけが有効です
- **DCP-03**: すべてのライフサイクルイベントは、エージェントのハッシュチェーンに監査エントリーを生成します
- **DCP-04**: エージェントが `active` 状態から外れるとき、A2A セッションを終了しなければなりません（MUST）
- **DCP-06**: 承継と継承（別途定義）は、ここで定義するライフサイクルの状態に依存します

<a id="2-terminology"></a>

## 2. 用語

**運用開始（commissioning）**: エージェントのアイデンティティを作り、責任を負うプリンシパルに結び付け、運用に投入する正式な行為。出生証明書と職務の任命を合わせたものに相当します。

**バイタリティ**: エージェントの運用上の健全性、能力の完全性、信頼上の立場を表す複合指標（整数、0〜1000）。1000 は完全な運用能力、0 は完全な無能力を示します。

**バイタリティレポート**: エージェントのバイタリティ指標とその構成要素のスコアについての、定期的で署名されハッシュで連鎖した記録。

**運用終了（decommissioning）**: エージェントを恒久的に運用から外し、その運用記録を封印する正式な行為。

**ライフサイクル状態**: エージェントがとる 4 つの正規の状態のいずれか: `commissioned`、`active`、`declining`、`decommissioned`。

**終了モード**: エージェントが `decommissioned` 状態に移る方法: `planned_retirement`、`termination_for_cause`、`organizational_restructuring`、`sudden_failure`。

**ドメイン分離コンテキスト**: `DCP-AI.v2.Lifecycle`（DCP-AI v2.0 §4.1。正誤 E2。以前はここにラベル `DCP-LIFECYCLE-SIG-v2` が記載されていました）。プロトコル間のリプレイを防ぐため、本仕様で作成されるすべての署名に使われます。

<a id="3-lifecycle-state-machine"></a>

## 3. ライフサイクルの状態機械

<a id="31-states"></a>

### 3.1 状態

エージェントは、どの時点でも次の状態のうちちょうど 1 つになければなりません（MUST）。

| 状態 | コード | 説明 |
|-------|------|-------------|
| **運用開始済み** | `commissioned` | エージェントのアイデンティティが作られプリンシパルに結び付けられたが、まだ稼働状態には置かれていない。発行されたばかりでまだ有効化されていない資格情報に相当する。 |
| **稼働中** | `active` | エージェントは完全に運用可能。意図の宣言、行動の実行、A2A セッションへの参加、監査エントリーの生成ができる。 |
| **低下中** | `declining` | エージェントのバイタリティが設定可能なしきい値を下回ったか、プリンシパルが管理された段階的縮小を開始した。エージェントは引き続き動作してもよい（MAY）が、能力は制限される。新たな長期的コミットメントは拒否すべきである（SHOULD）。 |
| **運用終了** | `decommissioned` | エージェントは恒久的に運用から外れている。アイデンティティの記録は監査と履歴の検証のために残るが、新しい行動、セッション、意図の宣言を開始してはならない（MUST NOT）。 |

<a id="32-valid-transitions"></a>

### 3.2 有効な遷移

```
                  activate
 commissioned ──────────────> active
                               │  │
                               │  │ decline (vitality < threshold
                               │  │         OR principal-initiated)
                               │  v
                               │  declining
                               │  │
                               │  │ reactivate (vitality restored
                               │  │            AND principal-approved)
                               │  │───────────> active
                               │  │
                  decommission │  │ decommission
                  (any mode)   │  │ (any mode)
                               v  v
                          decommissioned
```

有効な遷移:

1. `commissioned` -> `active`（有効化）
2. `active` -> `declining`（バイタリティの低下、またはプリンシパルが開始した低下）
3. `declining` -> `active`（再有効化。プリンシパルの承認と、しきい値を上回るバイタリティが必要）
4. `active` -> `decommissioned`（直接の終了）
5. `declining` -> `decommissioned`（低下中の状態からの終了）

無効な遷移:

- `decommissioned` -> 任意の状態（終端状態であり、元に戻せない）
- `commissioned` -> `declining`（先に有効化が必要）
- `commissioned` -> `decommissioned`（先に有効化が必要。運用開始が誤りだった場合は `termination_for_cause` を使う。これは暗黙に有効化してただちに運用終了する）

<a id="33-transition-record"></a>

### 3.3 遷移の記録

すべての状態遷移は、署名された記録を作成しなければなりません（MUST）。

```json
{
  "dcp_version": "2.0",
  "record_type": "lifecycle_transition",
  "transition_id": "lt:<uuid>",
  "agent_id": "agent:<identifier>",
  "from_state": "active",
  "to_state": "declining",
  "reason": "vitality_threshold_breach",
  "vitality_at_transition": 340,
  "threshold": 400,
  "authorized_by": {
    "principal_id": "principal:<identifier>",
    "role": "responsible_principal"
  },
  "timestamp": "2026-03-01T00:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  }
}
```

<a id="4-commissioning-certificate"></a>

## 4. 運用開始証明書

<a id="41-purpose"></a>

### 4.1 目的

運用開始証明書は、エージェントの存在の基礎となる文書です。エージェントの作成時のパラメーター、結び付けられたプリンシパル、初期の能力、認可した主体を記録します。エージェントのライフサイクルチェーンの最初のエントリーでなければなりません（MUST）。

<a id="42-schema"></a>

### 4.2 スキーマ

スキーマの参照: `schemas/v2/commissioning_certificate.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "commissioning_certificate",
  "certificate_id": "cc:<uuid>",
  "agent_id": "agent:<identifier>",
  "agent_name": "Human-readable agent name",
  "agent_description": "Purpose and scope of the agent",
  "principal_binding": {
    "principal_id": "principal:<identifier>",
    "principal_name": "Responsible Human or Entity",
    "organization_id": "org:<identifier>",
    "binding_type": "direct",
    "authority_level": "full"
  },
  "initial_capabilities": [
    "negotiate",
    "purchase_order",
    "data_query"
  ],
  "operational_parameters": {
    "intended_lifespan": "P365D",
    "vitality_report_interval": "PT1H",
    "vitality_decline_threshold": 400,
    "vitality_critical_threshold": 200,
    "max_concurrent_sessions": 100,
    "security_tier": "elevated",
    "permitted_domains": ["procurement", "finance"]
  },
  "initial_vitality": 1000,
  "cryptographic_identity": {
    "ed25519_public_key": "<base64>",
    "ml_dsa_65_public_key": "<base64>",
    "key_generation_timestamp": "2026-03-01T00:00:00Z"
  },
  "commissioning_authority": {
    "authority_id": "auth:<identifier>",
    "authority_name": "Organization Commissioning Authority",
    "authorization_reference": "AUTH-2026-0042"
  },
  "metadata": {
    "model_identifier": "model-name-v1.0",
    "deployment_environment": "production",
    "geographic_jurisdiction": "US"
  },
  "commissioned_at": "2026-03-01T00:00:00Z",
  "prev_hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "prev_hash_secondary": "sha3-256:0000000000000000000000000000000000000000000000000000000000000000",
  "signature": {
    "alg": "ed25519",
    "kid": "<authority-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  },
  "countersignature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  }
}
```

<a id="43-commissioning-flow"></a>

### 4.3 運用開始の流れ

1. 運用開始の権限者がエージェントの暗号学的アイデンティティを生成する
2. 権限者が運用開始証明書を作成し署名する
3. 責任を負うプリンシパルが証明書に副署し、説明責任を引き受ける
4. 証明書がエージェントのライフサイクルチェーンのジェネシスエントリー（`prev_hash` は null）として記録される
5. DCP-03 の監査チェーンに `agent_commissioned` の監査エントリーが作成される
6. エージェントが `commissioned` 状態に移る
7. 準備完了の確認後、エージェントが `active` 状態に移る

<a id="44-countersignature-requirement"></a>

### 4.4 副署の要件

運用開始証明書は 2 つの署名を持たなければなりません（MUST）。

- **権限者の署名**: エージェントの運用開始を認可された主体（組織のルート鍵、または委任された運用開始用の鍵）
- **プリンシパルの副署**: エージェントについての説明責任を引き受ける、責任を負うプリンシパル

どちらの署名もドメイン分離コンテキスト `DCP-AI.v2.Lifecycle` を使わなければなりません（MUST）（正誤 E2）。

> *参考注記（25/10/2026）：* V2.0 の `commissioning_certificate` スキーマは `composite_sig` を 1 つだけ持ち、副署のためのフィールドはありません。[V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md#4-requirements-the-v20-structures-do-not-represent-directly) を参照してください。

<a id="5-vitality-metric"></a>

## 5. バイタリティ指標

<a id="51-definition"></a>

### 5.1 定義

バイタリティは、エージェントの総合的な運用適性を表す [0, 1000] の範囲の整数です。4 つの構成要素のスコアを組み合わせたものです。

| 構成要素 | 重み | 範囲 | 説明 |
|-----------|--------|-------|-------------|
| **能力の完全性** | 0.30 | 0–1000 | エージェントが宣言した能力を正しく実行できるかを測る。自己テスト、能力の探査、外部の検証から得る。 |
| **信頼上の立場** | 0.25 | 0–1000 | 監査履歴、ポリシーの遵守、ピアによる評価に基づいて、エージェントの信頼性を測る。 |
| **リソースの健全性** | 0.25 | 0–1000 | 計算リソースの可用性を測る: メモリー、レイテンシー、スループット、エラー率。 |
| **ポリシーの遵守** | 0.20 | 0–1000 | 宣言した意図と組織のポリシーへの準拠を測る。DCP-02 のポリシー結果の記録から得る。 |

複合バイタリティ:
```
vitality = floor(0.30 * capability_integrity + 0.25 * trust_standing +
                 0.25 * resource_health + 0.20 * policy_compliance)
```

V2.0 のバイタリティレポートでは、この値はフィールド `vitality_score` に入ります（正誤 E3）。

<a id="52-thresholds"></a>

### 5.2 しきい値

組織は運用開始証明書で、エージェントごとに 2 つのしきい値を設定します。

- **低下しきい値**（既定値 400）: バイタリティがこの値を下回ると、エージェントは `declining` 状態に移る
- **危険しきい値**（既定値 200）: バイタリティがこの値を下回ると、ただちに介入が必要になる。責任を負うプリンシパルが運用継続を明示的に認可しない限り、エージェントを運用終了すべきである（SHOULD）

<a id="53-vitality-decay-and-recovery"></a>

### 5.3 バイタリティの低下と回復

バイタリティは固定ではありません。構成要素のスコアは次に基づいて変わります。

- **自己評価**: エージェントが報告する能力テストの結果
- **外部の探査**: 検証サービスによるヘルスチェック
- **監査の分析**: 監査チェーンの異常についての自動レビュー
- **ピアの報告**: DCP-04 を通じて、他のエージェントがやり取りの品質を報告する

回復: `declining` のエージェントのバイタリティが低下しきい値を上回り、責任を負うプリンシパルが承認した場合、エージェントは `active` に戻ってもかまいません（MAY）。

<a id="6-vitality-report"></a>

## 6. バイタリティレポート

<a id="61-purpose"></a>

### 6.1 目的

バイタリティレポートはハッシュで連鎖した系列を形成し、エージェントの健全性の時間的な履歴を、改ざんを検出できる形で提供します。運用開始証明書で指定された間隔で生成されます。

<a id="62-schema"></a>

### 6.2 スキーマ

スキーマの参照: `schemas/v2/vitality_report.schema.json`

> **正誤 E3 と E7（25/10/2026）：** この例のフィールド `vitality` は、V2.0 のワイヤーフォーマットでは `vitality_score` です。また、この例全体は概念的なものです。ワイヤーフォーマットはスキーマであり、その `metrics` は `dcp-jcs-v1` のもとでは 0 または 1 しか表現できません。[V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md) を参照してください。

```json
{
  "dcp_version": "2.0",
  "record_type": "vitality_report",
  "report_id": "vr:<uuid>",
  "agent_id": "agent:<identifier>",
  "sequence_number": 42,
  "lifecycle_state": "active",
  "vitality": 872,
  "components": {
    "capability_integrity": {
      "score": 920,
      "details": {
        "tests_passed": 47,
        "tests_failed": 2,
        "tests_total": 49,
        "last_test_timestamp": "2026-03-01T12:00:00Z"
      }
    },
    "trust_standing": {
      "score": 850,
      "details": {
        "successful_interactions": 1203,
        "failed_interactions": 12,
        "policy_violations": 0,
        "peer_trust_score": 880
      }
    },
    "resource_health": {
      "score": 810,
      "details": {
        "avg_response_latency_ms": 45,
        "error_rate_percent": 0.3,
        "memory_utilization_percent": 72,
        "throughput_ops_per_sec": 150
      }
    },
    "policy_compliance": {
      "score": 900,
      "details": {
        "intents_declared": 500,
        "intents_completed": 495,
        "policy_outcomes_compliant": 498,
        "policy_outcomes_noncompliant": 2
      }
    }
  },
  "anomalies": [],
  "recommendations": [],
  "report_interval": "PT1H",
  "report_window": {
    "from": "2026-03-01T11:00:00Z",
    "to": "2026-03-01T12:00:00Z"
  },
  "timestamp": "2026-03-01T12:00:05Z",
  "prev_hash": "sha256:<hex of previous vitality report>",
  "prev_hash_secondary": "sha3-256:<hex of previous vitality report>",
  "merkle_root": {
    "sha256": "<hex>",
    "sha3_256": "<hex>"
  },
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  }
}
```

<a id="63-hash-chaining"></a>

### 6.3 ハッシュによる連鎖

バイタリティレポートはハッシュチェーンを形成します。各レポートの `prev_hash` と `prev_hash_secondary` は、直前のバイタリティレポートの SHA-256 と SHA3-256 のハッシュを参照します。運用開始後最初のバイタリティレポートは、運用開始証明書のハッシュを参照します。

二重ハッシュ（SHA-256 + SHA3-256）の方式は DCP-03 の監査チェーンと同じパターンに従い、単一のアルゴリズムが破られた場合への耐性を与えます。

<a id="64-merkle-root"></a>

### 6.4 Merkle ルート

各バイタリティレポートには、構成要素のスコアとその詳細に対する二重ハッシュの Merkle ルートが含まれます。これにより選択的開示が可能になります。エージェントは、特定の構成要素の詳細だけを明かしながら、全体のバイタリティスコアを証明できます。

<a id="65-anomaly-detection"></a>

### 6.5 異常の検出

`anomalies` 配列には、構造化された異常レポートを含めてもかまいません（MAY）。

```json
{
  "anomaly_id": "anom:<uuid>",
  "type": "capability_degradation",
  "severity": "warning",
  "component": "capability_integrity",
  "description": "Test pass rate dropped 15% in the last reporting interval",
  "detected_at": "2026-03-01T11:45:00Z",
  "data": {
    "previous_pass_rate": 0.98,
    "current_pass_rate": 0.83
  }
}
```

異常の重大度: `info`、`warning`、`critical`。

<a id="7-termination-modes"></a>

## 7. 終了モード

<a id="71-overview"></a>

### 7.1 概要

エージェントは 4 つの終了モードのいずれかで `decommissioned` 状態に至ります。モードごとに手続き上の要件が異なります。

| モード | コード | 契機 | 猶予期間 |
|------|------|---------|--------------|
| **計画的な引退** | `planned_retirement` | エージェントが目的を果たしたか、予定された寿命の終わりに達した | 完全（設定可能、既定は 72 時間） |
| **理由のある終了** | `termination_for_cause` | エージェントがポリシーに違反した、安全でない振る舞いをした、または侵害された | 最小（設定可能、既定は 1 時間） |
| **組織の再編** | `organizational_restructuring` | エージェントの成績とは無関係な、引退させるという事業上の判断 | 標準（設定可能、既定は 24 時間） |
| **突然の障害** | `sudden_failure` | エージェントが応答しなくなった、または致命的な障害を起こした | なし（プリンシパルによる事後の運用終了） |

<a id="72-planned-retirement"></a>

### 7.2 計画的な引退

秩序ある終了の手順:

1. 責任を負うプリンシパルが猶予期間を付けて引退の通知を出す
2. エージェントが `declining` 状態に入る（まだでなければ）
3. エージェントが進行中の作業を完了するか引き継ぐ
4. エージェントが理由 `complete` ですべての A2A セッションを終了する
5. エージェントが最終のバイタリティレポートを生成する
6. 設定されていれば、エージェントが承継プロトコル（DCP-06）を実行する
7. 運用終了記録が作成され署名される
8. エージェントが `decommissioned` に移る

<a id="73-termination-for-cause"></a>

### 7.3 理由のある終了

ポリシー違反や侵害による緊急の終了:

1. 責任を負うプリンシパルまたは組織の権限者が終了命令を出す
2. エージェントの資格情報にただちに失効のフラグが付けられる
3. すべての A2A セッションが理由 `revocation` で終了される
4. 最小限の猶予期間で、進行中の操作を完了（またはロールバック）させる
5. `cause` の詳細を含む運用終了記録が作成される
6. エージェントが `decommissioned` に移る
7. インシデント後の分析で監査の要約が生成される

<a id="74-organizational-restructuring"></a>

### 7.4 組織の再編

事業上の理由による引退:

1. 組織がエージェントに影響する再編の通知を出す
2. 作業の引き継ぎのための標準の猶予期間
3. エージェントが組織のポリシーに従って作業を完了するか引き継ぐ
4. 後継者が指名されていれば承継プロトコル（DCP-06）が実行される
5. 運用終了記録が作成される
6. エージェントが `decommissioned` に移る

<a id="75-sudden-failure"></a>

### 7.5 突然の障害

エージェントが予期せず故障した場合:

1. 監視システムまたはピアのエージェントが無応答を検出する
2. 設定可能なタイムアウト（既定: 5 分間の無応答）の後に `sudden_failure` イベントが発生する
3. 責任を負うプリンシパルに通知される
4. プリンシパルがエージェントに代わって事後の運用終了記録を作成する
5. プリンシパルが自身の鍵で運用終了記録に署名する（エージェントは署名できないため）
6. エージェントがアクティブなセッションにあった場合、A2A の相手方に通知される
7. 設定されていれば、承継プロトコル（DCP-06）が緊急モードで実行される

<a id="8-decommissioning-record"></a>

## 8. 運用終了記録

<a id="81-purpose"></a>

### 8.1 目的

運用終了記録は、エージェントのライフサイクルチェーンの終端の文書です。エージェントの運用履歴を封印し、エージェントがどのように、なぜ引退したかについての恒久的で検証可能な記録を提供します。

<a id="82-schema"></a>

### 8.2 スキーマ

スキーマの参照: `schemas/v2/decommissioning_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "decommissioning_record",
  "decommission_id": "dc:<uuid>",
  "agent_id": "agent:<identifier>",
  "agent_name": "Human-readable agent name",
  "termination_mode": "planned_retirement",
  "lifecycle_summary": {
    "commissioned_at": "2026-01-01T00:00:00Z",
    "activated_at": "2026-01-01T01:00:00Z",
    "decommissioned_at": "2026-03-01T00:00:00Z",
    "total_active_duration": "P59D",
    "total_vitality_reports": 1416,
    "final_vitality": 720,
    "average_vitality": 865,
    "min_vitality": 410,
    "max_vitality": 995,
    "total_audit_entries": 15230,
    "total_a2a_sessions": 342,
    "total_intents_declared": 8901,
    "policy_violations": 2
  },
  "audit_chain_seal": {
    "final_audit_hash": "sha256:<hex>",
    "final_audit_hash_secondary": "sha3-256:<hex>",
    "audit_merkle_root": {
      "sha256": "<hex>",
      "sha3_256": "<hex>"
    },
    "total_entries": 15230
  },
  "vitality_chain_seal": {
    "final_vitality_hash": "sha256:<hex>",
    "final_vitality_hash_secondary": "sha3-256:<hex>",
    "vitality_merkle_root": {
      "sha256": "<hex>",
      "sha3_256": "<hex>"
    },
    "total_reports": 1416
  },
  "succession_reference": {
    "successor_agent_id": "agent:<identifier>",
    "succession_record_id": "sr:<uuid>",
    "memory_transfer_complete": true
  },
  "reason": "Agent fulfilled its intended operational lifespan",
  "cause_details": null,
  "key_disposition": {
    "private_keys_destroyed": true,
    "destruction_method": "secure_erasure",
    "destruction_witness": "principal:<identifier>",
    "public_keys_archived": true,
    "archive_location": "org-key-archive-2026"
  },
  "data_disposition": {
    "operational_data": "transferred_to_successor",
    "audit_data": "archived",
    "session_data": "purged",
    "archive_retention_period": "P7Y"
  },
  "decommissioned_at": "2026-03-01T00:00:00Z",
  "decommissioned_by": {
    "principal_id": "principal:<identifier>",
    "role": "responsible_principal"
  },
  "prev_hash": "sha256:<hex of final vitality report or last lifecycle record>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id or principal-key-id for sudden_failure>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  },
  "countersignature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  }
}
```

<a id="83-chain-sealing"></a>

### 8.3 チェーンの封印

運用終了記録には、監査チェーンとバイタリティチェーンの両方についての Merkle ルートの封印が含まれます。これらの封印により、将来の検証者は、チェーン全体を再生することなく、エージェントの履歴記録の完全性と整合性を確認できます。

<a id="84-key-disposition"></a>

### 8.4 鍵の処分

運用終了にあたって:

- 秘密鍵は安全に破棄しなければならない（MUST）
- 公開鍵は、履歴上の成果物を将来検証するために保管しなければならない（MUST）
- 破棄の方法と立会人を記録しなければならない（MUST）
- `sudden_failure` の場合、鍵の破棄は責任を負うプリンシパルが行う

<a id="85-sudden-failure-special-handling"></a>

### 8.5 突然の障害の特別な扱い

エージェントが突然故障し、自身の運用終了記録に署名できない場合:

1. 責任を負うプリンシパルが自身の鍵で記録に署名する
2. `signature.kid` はエージェントの鍵ではなく、プリンシパルの鍵を参照する
3. `principal_signed_on_behalf` フラグを `true` に設定する
4. 理由には、利用可能な診断情報を含めなければならない（MUST）
5. エージェントの最後のバイタリティレポートが利用できればそのハッシュを `prev_hash` として使い、そうでなければ最後に分かっている監査エントリーのハッシュを使う

<a id="9-integration-with-dcp-03-audit-chain"></a>

## 9. DCP-03 監査チェーンとの統合

<a id="91-lifecycle-audit-events"></a>

### 9.1 ライフサイクルの監査イベント

すべてのライフサイクルイベントは、DCP-03 の監査チェーンにエントリーを生成します。

| イベント | `event_type` |
|-------|-------------|
| 運用開始証明書の作成 | `agent_commissioned` |
| エージェントの有効化 | `agent_activated` |
| エージェントが低下中の状態に入った | `agent_declining` |
| 低下中からのエージェントの再有効化 | `agent_reactivated` |
| バイタリティレポートの生成 | `vitality_report_generated` |
| バイタリティのしきい値割れ | `vitality_threshold_breach` |
| 運用終了の開始 | `decommissioning_initiated` |
| 運用終了の完了 | `agent_decommissioned` |

<a id="92-audit-entry-format"></a>

### 9.2 監査エントリーの形式

```json
{
  "dcp_version": "2.0",
  "event_id": "evt:<uuid>",
  "event_type": "agent_declining",
  "agent_id": "agent:<identifier>",
  "lifecycle_state": "declining",
  "vitality": 380,
  "trigger": "vitality_threshold_breach",
  "details": {
    "threshold": 400,
    "vitality_report_id": "vr:<uuid>"
  },
  "timestamp": "2026-03-01T00:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>"
}
```

<a id="10-security-considerations"></a>

## 10. セキュリティに関する考慮事項

<a id="101-lifecycle-chain-integrity"></a>

### 10.1 ライフサイクルチェーンの完全性

運用開始証明書、バイタリティレポート、遷移の記録、運用終了記録をハッシュで連鎖させた系列は、改ざんを検出できるライフサイクルチェーンを形成します。履歴上の記録を変更すると、その後のハッシュがすべて無効になります。

<a id="102-vitality-report-authenticity"></a>

### 10.2 バイタリティレポートの真正性

バイタリティレポートはエージェント自身が報告するものです。実装は、自己申告のデータを外部の検証で補うべきです（SHOULD）。

- 検証サービスによるヘルスの探査
- ピアのエージェントによるやり取りの品質の報告
- 組織の監視システム
- 能力の自動テスト

侵害されたエージェントは自身のバイタリティを偽ることができます。外部の検証元が多層防御を提供します。

<a id="103-termination-authorization"></a>

### 10.3 終了の認可

ライフサイクルの遷移を開始できるのは、認可されたプリンシパルだけです。認可モデル:

- **有効化**: 運用開始の権限者または責任を負うプリンシパル
- **低下**: 自動（バイタリティのしきい値）または責任を負うプリンシパル
- **再有効化**: 責任を負うプリンシパルのみ（明示的な承認が必要）
- **運用終了**: 責任を負うプリンシパル、組織の権限者、または自動（突然の障害の検出）

<a id="104-post-decommissioning-verification"></a>

### 10.4 運用終了後の検証

運用終了後も、エージェントの公開鍵は保管されたままです。誰でも、エージェントの過去の署名、監査チェーン、バイタリティレポートを検証できます。運用終了記録のチェーンの封印により、履歴全体を再生せずに効率よく検証できます。

<a id="105-domain-separation"></a>

### 10.5 ドメイン分離

本仕様のすべての署名はドメイン分離コンテキスト `DCP-AI.v2.Lifecycle` を使います（正誤 E2）。これにより、ライフサイクルの目的で作成された署名が、DCP プロトコルの他のコンテキスト（たとえば意図の宣言や A2A セッション）でリプレイされることを防ぎます。

<a id="106-sudden-failure-risks"></a>

### 10.6 突然の障害のリスク

突然の障害には特有のセキュリティリスクがあります。

- エージェントは自身の運用終了記録に署名できない
- エージェントの秘密鍵の素材が不明な状態にあるおそれがある
- 進行中の操作が不整合な状態にあるおそれがある

緩和策:

- プリンシパルが署名した運用終了記録には明確な印が付けられる
- 鍵の素材は侵害されたものと推定しなければならない（MUST）。失効を発行すべきである（SHOULD）
- 相手方のエージェントは、故障したエージェントからの進行中のデータを信頼できない可能性があるものとして扱うべきである（SHOULD）

<a id="11-conformance"></a>

## 11. 適合性

実装が次を満たす場合、その実装は DCP-05 に適合しています。

1. セクション 3 で定義された 4 つのライフサイクル状態と有効な遷移をすべて実装している
2. セクション 4 で定義された二重署名付きの運用開始証明書を生成している
3. セクション 6 で定義されたとおり、設定された間隔でハッシュ連鎖のバイタリティレポートを作成している
4. セクション 7 で定義された 4 つの終了モードすべてに対応している
5. セクション 8 で定義された封印済みの運用終了記録を生成している
6. セクション 9 で定義されたとおり、すべてのライフサイクルイベントについて DCP-03 の監査エントリーを作成している
7. すべての署名にドメイン分離コンテキスト `DCP-AI.v2.Lifecycle` を使っている（正誤 E2）
8. ハッシュチェーンのすべてのリンクに二重ハッシュ（SHA-256 + SHA3-256）を実装している

<a id="references"></a>

## 参考文献

- DCP-01: アイデンティティとプリンシパルのバインディング
- DCP-02: 意図の宣言とポリシーによるゲーティング
- DCP-03: 監査チェーンと透明性
- DCP-04: エージェント間通信
- DCP-06: 承継と継承
- NIST SP 800-88: Guidelines for Media Sanitization（鍵の破棄）
- RFC 3339: Date and Time on the Internet

---

*本仕様は、AI エージェントにも、あらゆる運用システムと同様に有限の寿命があることを認めるものです。デジタル市民権のためのプロトコルは、エージェントがどう生きるかだけでなく、どう終わるか、すなわち尊厳と説明責任と完全な記録を伴って終わることも考慮しなければなりません。*

<a id="implementation-notes-informative"></a>

## 実装に関する注記（参考）

> **2026 年 10 月 25 日に追加。規範的ではありません。** これらの注記は要件を加えず、上の内容を何も変えません。`main` のリファレンスの
> コードがこの文書とどう関係するかを説明するものです。食い違う場合は、上の規範的な本文が、
> [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md) の正誤による訂正を含めて有効です。

- **`schemas/v2/` の記録。** SDK が構築し `schemas/v2/` が検証する運用開始証明書、バイタリティレポート、
  運用終了記録のフィールドは、§3 から §9 の例とは異なります。たとえばバイタリティレポートには `vitality_score`、
  `state`、`metrics`、`prev_report_hash` があり、運用終了記録には `final_vitality_score` と `data_disposition`
  があります。どれにも `prev_hash_secondary`、`merkle_root`、`countersignature`、`domain_sep` はありません。
  §3.3 の遷移の記録と §9.2 の監査エントリーにはスキーマがありません。
- **署名。** 各記録は、渡された鍵を持つ者による `composite_sig`（Ed25519 + ML-DSA-65）を 1 つだけ、
  コンテキスト `DCP-AI.v2.Lifecycle` で持ちます（正誤 E2）。SDK は §4.4 の権限者の署名とプリンシパルの副署を
  作成しません。
- **遷移。** `validateStateTransition` は 6 本の辺を受け入れます。§3.2 の 5 本と、`commissioned` ->
  `decommissioned` です。確認するのは状態の組だけで、プリンシパルの承認、バイタリティ、署名者は確認しません。
- **バイタリティスコア。** `computeVitalityScore` は [0, 1] の 4 つの指標（`task_completion_rate`、反転した
  `error_rate`、`human_satisfaction`、`policy_alignment`）を §5.1 の重みで受け取り、最も近い整数に丸めます
  （`Math.round`）。§5.1 は 0〜1000 で採点される別の構成要素と `floor` を使います。バイタリティチェーンは各
  レポートを `prev_report_hash`（SHA-256 のみ）でつなぎます。
- **小数の指標。** `dcp-jcs-v1` は整数しか受け付けないため、`metrics` に `0.83` のような小数を含む
  バイタリティレポートは正規化も署名もできません。スキーマの範囲 [0, 1] では、署名済みレポートの各指標は 0 か 1
  しか持てません。§6 の例にも小数（`error_rate_percent`、`previous_pass_rate`）がありますが、これらは
  プレースホルダーを含む説明用のものであり、フィクスチャではありません。
- これらの記録は署名者による署名付きの宣言であり、状態、スコア、処分が真実であることを証明するものではありません。
  また、§7 と §8 の猶予期間、鍵の破棄、セッションの終了を強制するものは SDK にもサービスにもありません。SDK の型については [docs/API_REFERENCE.md](../docs/API_REFERENCE.md) を参照してください。
