<sub>[English](../../../spec/DCP-06.md) · [中文](../../zh-CN/spec/DCP-06.md) · [Español](../../es/spec/DCP-06.md) · **日本語** · [Português](../../pt-BR/spec/DCP-06.md)</sub>

<a id="dcp-06-succession--inheritance"></a>
<a id="dcp-06-succession-inheritance"></a>

# DCP-06: 承継と継承

> [英語の仕様](../../../spec/DCP-06.md)の参考訳です（25/10/2026 更新）。**規範となるのは英語版です**。この翻訳に規範的な効力はなく、内容が異なる場合は英語版が優先されます。識別子とコードブロックは翻訳せずにそのまま掲載しています。

<a id="status"></a>

## ステータス
公開済み — v2.0（拡張。改訂は採用者からのフィードバックに基づいて管理）

<a id="abstract"></a>

## 概要
本仕様は、AI エージェントが承継に備え、それを実行するための仕組みを定義します。承継とは、責任、運用上のコンテキスト、関係に関する知識を、あるエージェントからその後継者へ秩序立てて移すことです。デジタル遺言、承継セレモニー、メモリー移転マニフェストを導入し、いずれも暗号学的に署名されハッシュで連鎖します。このプロトコルは、前任と後継のエージェントの間のアイデンティティの境界を保ちながら、サービスの継続性を確保します。

**依存関係**: 本仕様は DCP-05（エージェントのライフサイクル）を必要とします。承継のイベントはライフサイクルの状態遷移によって引き起こされ、運用終了記録は承継の結果を参照します。

<a id="1-introduction"></a>

## 1. はじめに

AI エージェントがライフサイクルの終わり（DCP-05）に達しても、蓄積した運用上の知識、築いた関係、進行中のコミットメントがそのまま消えるわけではありません。組織には、引退するエージェントから後継者へ関連するコンテキストを移しつつ、両エージェントの記録の暗号学的な完全性を保つための正式なプロトコルが必要です。

DCP-06 は 3 つの根本的な課題に取り組みます。

1. **継続性**: 後継のエージェントが、中断なく前任の責任を引き継げるようにする
2. **完全性**: 前任と後継の間の暗号学的な境界を保つ。後継者は新しい主体であり、古い主体の継続ではない
3. **選択性**: すべての知識を移すべきではない。運用上のコンテキストには、一時的なもの、機微なもの、前任のアイデンティティに強く結び付いたものがある

<a id="11-design-principles"></a>

### 1.1 設計原則
- 後継のエージェントは常に、独自の DCP-01 バインディングを持つ別個のアイデンティティである
- メモリーの移転は選択的であり、何を移すかは前任（またはそのプリンシパル）が管理する
- デジタル遺言はバージョン管理されハッシュで連鎖する。最新のバージョンが優先される
- 承継セレモニーは、移転について監査可能な署名済みの記録を作成する
- 3 種類のセレモニーで異なる緊急度に対応する: 計画的、強制、緊急

<a id="12-relationship-to-other-specifications"></a>

### 1.2 他の仕様との関係
- **DCP-01**: 後継のエージェントは独自のアイデンティティバインディングを持ち、前任のアイデンティティは継承しません
- **DCP-03**: すべての承継イベントは両エージェントの監査チェーンに記録されます
- **DCP-04**: 前任のアクティブな A2A セッションは移転されません。後継者は新しいセッションを確立する必要があります
- **DCP-05**: 承継はライフサイクルの遷移によって引き起こされます。運用終了記録は承継の結果を参照します

<a id="2-terminology"></a>

## 2. 用語

**デジタル遺言**: エージェントが稼働中に作成する、バージョン管理された署名済みの文書。承継に関する希望、メモリーの分類、移転の指示を宣言します。遺言に相当します。

**承継セレモニー**: 前任から後継へ責任を移す正式な手続き。検証、認可、メモリーの移転を含みます。

**メモリーの移転**: デジタル遺言と組織のポリシーに従って、前任から後継へ運用上のコンテキストを選択的に伝えること。

**前任**: 運用終了される、または責任が移されるエージェント。

**後継**: 前任から責任と選ばれた運用上のコンテキストを受け取るエージェント。

**メモリーの分類**: エージェントが蓄積した知識の分類体系: `operational`、`relational`、`ephemeral`、`restricted`。

**ドメイン分離タグ**: `DCP-SUCCESSION-SIG-v2`。本仕様で作成されるすべての署名に使われます。

<a id="3-digital-testament"></a>

## 3. デジタル遺言

<a id="31-purpose"></a>

### 3.1 目的

デジタル遺言は、運用終了時に自らの責任と知識をどう扱うべきかについてのエージェントの宣言です。エージェントは、稼働中のライフサイクル全体を通じてデジタル遺言を作成し維持すべきです（SHOULD）。遺言はバージョン管理され、新しいバージョンが前のバージョンに取って代わります。

<a id="32-schema"></a>

### 3.2 スキーマ

スキーマの参照: `schemas/v2/digital_testament.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "digital_testament",
  "testament_id": "dt:<uuid>",
  "agent_id": "agent:<identifier>",
  "version": 3,
  "status": "active",
  "succession_preferences": {
    "preferred_successor_id": "agent:<identifier>",
    "alternate_successor_ids": [
      "agent:<alternate-1>",
      "agent:<alternate-2>"
    ],
    "successor_requirements": {
      "minimum_capabilities": ["negotiate", "purchase_order"],
      "minimum_security_tier": "elevated",
      "minimum_vitality": 800,
      "same_organization_required": true,
      "same_jurisdiction_required": false
    },
    "succession_mode_preferences": {
      "planned_retirement": "full_transfer",
      "termination_for_cause": "restricted_transfer",
      "organizational_restructuring": "full_transfer",
      "sudden_failure": "emergency_transfer"
    }
  },
  "memory_classification": {
    "operational": {
      "description": "Task-specific knowledge, procedures, and workflows",
      "transfer_policy": "transfer",
      "retention_after_transfer": "archive_7y",
      "items": [
        {
          "category": "workflow_procedures",
          "description": "Standard procurement workflows for vendor management",
          "data_reference": "mem:operational:workflows:001",
          "size_bytes": 524288,
          "classification": "operational",
          "transfer_priority": "high"
        }
      ]
    },
    "relational": {
      "description": "Knowledge about relationships with other agents and entities",
      "transfer_policy": "transfer_with_consent",
      "retention_after_transfer": "archive_3y",
      "items": [
        {
          "category": "agent_interaction_history",
          "description": "Interaction patterns and trust assessments for known agents",
          "data_reference": "mem:relational:interactions:001",
          "size_bytes": 131072,
          "classification": "relational",
          "transfer_priority": "medium"
        }
      ]
    },
    "ephemeral": {
      "description": "Temporary context that does not survive succession",
      "transfer_policy": "do_not_transfer",
      "retention_after_transfer": "purge",
      "items": [
        {
          "category": "active_session_state",
          "description": "Current in-flight session data",
          "data_reference": "mem:ephemeral:sessions:001",
          "size_bytes": 65536,
          "classification": "ephemeral",
          "transfer_priority": "none"
        }
      ]
    },
    "restricted": {
      "description": "Sensitive knowledge that requires principal authorization to transfer",
      "transfer_policy": "principal_approval_required",
      "retention_after_transfer": "archive_7y_encrypted",
      "items": [
        {
          "category": "security_observations",
          "description": "Anomaly patterns and security-relevant observations",
          "data_reference": "mem:restricted:security:001",
          "size_bytes": 32768,
          "classification": "restricted",
          "transfer_priority": "low"
        }
      ]
    }
  },
  "final_messages": [
    {
      "recipient_type": "principal",
      "recipient_id": "principal:<identifier>",
      "message": "Summary of unresolved items requiring human attention"
    },
    {
      "recipient_type": "agent",
      "recipient_id": "agent:<successor-identifier>",
      "message": "Key operational notes for successor"
    }
  ],
  "created_at": "2026-01-15T00:00:00Z",
  "updated_at": "2026-02-28T00:00:00Z",
  "prev_hash": "sha256:<hex of previous testament version>",
  "prev_hash_secondary": "sha3-256:<hex of previous testament version>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  }
}
```

<a id="33-testament-versioning"></a>

### 3.3 遺言のバージョン管理

遺言を更新するたびに `version` フィールドが増えます。遺言のバージョンはハッシュチェーンを形成し、各バージョンの `prev_hash` は前のバージョンのハッシュを参照します。ジェネシスの遺言（バージョン 1）は null のハッシュを使います。

有効なのは最新のバージョンだけです。古いバージョンは監査のために保持されます。遺言が改ざんされていた（ハッシュチェーンが壊れている）ことが判明した場合、承継はプリンシパルの指示による移転に切り替わります。

<a id="34-transfer-policies"></a>

### 3.4 移転のポリシー

| ポリシー | コード | 説明 |
|--------|------|-------------|
| **移転する** | `transfer` | メモリー項目を無条件で後継者に移転する |
| **同意を得て移転する** | `transfer_with_consent` | 移転には影響を受ける相手方の明示的な同意が必要 |
| **プリンシパルの承認が必要** | `principal_approval_required` | 移転には責任を負うプリンシパルの明示的な承認が必要 |
| **移転しない** | `do_not_transfer` | メモリー項目は決して移転せず、消去またはアーカイブする |

<a id="4-succession-ceremony"></a>

## 4. 承継セレモニー

<a id="41-overview"></a>

### 4.1 概要

承継セレモニーは、前任から後継へ責任を移す正式な手続きです。3 種類で異なる緊急度に対応します。

| 種類 | コード | 契機 | 所要時間 |
|------|------|---------|----------|
| **計画的** | `planned` | 計画的な引退または組織の再編 | 数時間から数日 |
| **強制** | `forced` | 理由のある終了 | 数分から数時間 |
| **緊急** | `emergency` | 突然の障害 | 数秒から数分 |

<a id="42-planned-succession"></a>

### 4.2 計画的な承継

秩序ある移行の手順:

1. **開始**: 前任（またはそのプリンシパル）が、デジタル遺言を参照して承継の意図を宣言する
2. **後継の検証**: 後継のアイデンティティ、能力、バイタリティを遺言の要件に照らして検証する
3. **認可**: 責任を負うプリンシパルが承継を認可する
4. **並行運用**（省略可能）: 移行期間中、前任と後継が同時に稼働し、後継が観察し学べるようにする
5. **メモリーの移転**: 遺言の分類に従って、運用上のメモリーと関係に関するメモリーを移転する
6. **相手方への通知**: 前任とやり取りしたエージェントに、DCP-04 を通じて承継を通知する
7. **引き継ぎの確認**: 後継が受領と運用準備の完了を確認する
8. **封印**: 承継の記録を作成し、両エージェントとプリンシパルが署名する

<a id="43-forced-succession"></a>

### 4.3 強制的な承継

理由のある終了のための簡略化された手順:

1. **開始**: プリンシパルまたは組織の権限者が承継を命じる
2. **後継の検証**: 後継を検証する（遺言の代替候補から、またはプリンシパルが指名）
3. **制限付きの移転**: `transfer` ポリシーの `operational` メモリーだけを移転する。`relational` と `restricted` のメモリーにはプリンシパルの明示的な承認が必要
4. **即時の引き継ぎ**: 並行運用の期間はない
5. **封印**: 承継の記録を作成する。前任の運用終了記録には強制であったことを記す

<a id="44-emergency-succession"></a>

### 4.4 緊急の承継

突然の障害のための最小限の手順:

1. **検出**: 監視システムまたはピアのエージェントが前任の障害を検出する（DCP-05 のセクション 7.5）
2. **プリンシパルへの通知**: 責任を負うプリンシパルに警告する
3. **後継の有効化**: 希望される後継者がいて利用可能であれば、ただちに有効化する。そうでなければプリンシパルが指名する
4. **ベストエフォートの移転**: 利用可能なバックアップや複製された状態からメモリーを移転する。前任は参加できない
5. **復旧の検証**: 後継が、前任の最後に分かっているバイタリティレポートの Merkle ルートを使って、移転されたデータの完全性を検証する
6. **封印**: プリンシパルと後継が承継の記録を作成する（前任は署名できない）

<a id="45-succession-record"></a>

### 4.5 承継の記録

スキーマの参照: `schemas/v2/succession_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "succession_record",
  "succession_id": "sr:<uuid>",
  "ceremony_type": "planned",
  "predecessor": {
    "agent_id": "agent:<predecessor-identifier>",
    "final_vitality": 720,
    "lifecycle_state_at_succession": "declining",
    "decommission_id": "dc:<uuid>",
    "testament_id": "dt:<uuid>",
    "testament_version": 3,
    "testament_hash": "sha256:<hex>"
  },
  "successor": {
    "agent_id": "agent:<successor-identifier>",
    "vitality_at_succession": 980,
    "lifecycle_state_at_succession": "active",
    "commissioning_certificate_id": "cc:<uuid>"
  },
  "authorized_by": {
    "principal_id": "principal:<identifier>",
    "authorization_timestamp": "2026-03-01T00:00:00Z"
  },
  "memory_transfer": {
    "manifest_id": "mtm:<uuid>",
    "items_transferred": 12,
    "items_skipped": 5,
    "items_failed": 0,
    "total_bytes_transferred": 1048576,
    "transfer_merkle_root": {
      "sha256": "<hex>",
      "sha3_256": "<hex>"
    },
    "transfer_verified": true
  },
  "counterparties_notified": [
    {
      "agent_id": "agent:<counterparty-1>",
      "notification_status": "acknowledged"
    },
    {
      "agent_id": "agent:<counterparty-2>",
      "notification_status": "pending"
    }
  ],
  "parallel_operation_window": {
    "start": "2026-02-28T00:00:00Z",
    "end": "2026-03-01T00:00:00Z"
  },
  "ceremony_started_at": "2026-02-28T00:00:00Z",
  "ceremony_completed_at": "2026-03-01T01:00:00Z",
  "timestamp": "2026-03-01T01:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "predecessor_signature": {
    "alg": "ed25519",
    "kid": "<predecessor-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  },
  "successor_signature": {
    "alg": "ed25519",
    "kid": "<successor-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  },
  "principal_signature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  }
}
```

<a id="5-memory-transfer"></a>

## 5. メモリーの移転

<a id="51-memory-classification"></a>

### 5.1 メモリーの分類

エージェントのメモリーは 4 つのカテゴリーに分類され、それぞれ移転のセマンティクスが異なります。

| 分類 | 説明 | 既定の移転ポリシー |
|---------------|-------------|------------------------|
| **運用** | タスク固有の知識: ワークフロー、手順、判断のヒューリスティック、ドメインモデル | `transfer` |
| **関係** | 関係についての知識: やり取りの履歴、信頼の評価、相手方ごとのコミュニケーションの好み | `transfer_with_consent` |
| **一時** | 一時的な状態: アクティブなセッション、進行中のトランザクション、短期のキャッシュ | `do_not_transfer` |
| **制限** | 機微な知識: セキュリティ上の観察、脆弱性のパターン、特権アクセスの記録 | `principal_approval_required` |

<a id="52-memory-transfer-manifest"></a>

### 5.2 メモリー移転マニフェスト

スキーマの参照: `schemas/v2/memory_transfer_manifest.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "memory_transfer_manifest",
  "manifest_id": "mtm:<uuid>",
  "succession_id": "sr:<uuid>",
  "predecessor_agent_id": "agent:<predecessor>",
  "successor_agent_id": "agent:<successor>",
  "transfer_items": [
    {
      "item_id": "mti:<uuid>",
      "data_reference": "mem:operational:workflows:001",
      "classification": "operational",
      "transfer_policy": "transfer",
      "transfer_status": "completed",
      "size_bytes": 524288,
      "content_hash": {
        "sha256": "<hex>",
        "sha3_256": "<hex>"
      },
      "encrypted": true,
      "encryption_alg": "aes-256-gcm",
      "transfer_timestamp": "2026-03-01T00:30:00Z"
    },
    {
      "item_id": "mti:<uuid>",
      "data_reference": "mem:relational:interactions:001",
      "classification": "relational",
      "transfer_policy": "transfer_with_consent",
      "transfer_status": "completed",
      "consent_records": [
        {
          "counterparty_id": "agent:<counterparty>",
          "consent_given": true,
          "consent_timestamp": "2026-02-28T20:00:00Z"
        }
      ],
      "size_bytes": 131072,
      "content_hash": {
        "sha256": "<hex>",
        "sha3_256": "<hex>"
      },
      "encrypted": true,
      "encryption_alg": "aes-256-gcm",
      "transfer_timestamp": "2026-03-01T00:35:00Z"
    },
    {
      "item_id": "mti:<uuid>",
      "data_reference": "mem:ephemeral:sessions:001",
      "classification": "ephemeral",
      "transfer_policy": "do_not_transfer",
      "transfer_status": "skipped",
      "reason": "ephemeral_policy"
    }
  ],
  "transfer_merkle_root": {
    "sha256": "<hex over all transferred item content_hashes>",
    "sha3_256": "<hex>"
  },
  "summary": {
    "total_items": 17,
    "transferred": 12,
    "skipped": 5,
    "failed": 0,
    "total_bytes": 1048576
  },
  "transfer_started_at": "2026-03-01T00:15:00Z",
  "transfer_completed_at": "2026-03-01T00:45:00Z",
  "timestamp": "2026-03-01T00:45:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "predecessor_signature": {
    "alg": "ed25519",
    "kid": "<predecessor-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  },
  "successor_signature": {
    "alg": "ed25519",
    "kid": "<successor-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  }
}
```

<a id="53-merkle-root-verification"></a>

### 5.3 Merkle ルートの検証

`transfer_merkle_root` は、移転に成功したすべての項目の `content_hash` 値に対する二重ハッシュ（SHA-256 + SHA3-256）の Merkle 木として計算されます。これにより後継は、再検証のために前任が利用可能である必要なく、マニフェストに列挙された項目を過不足なく受け取ったことを検証できます。

構築方法:

1. `transfer_status: "completed"` のすべての項目の `content_hash.sha256` 値を、`item_id` の順に集める
2. SHA-256 の Merkle 木を構築する。ルートが `transfer_merkle_root.sha256` になる
3. `content_hash.sha3_256` 値で同じことを行い、`transfer_merkle_root.sha3_256` を得る

<a id="54-transfer-encryption"></a>

### 5.4 移転の暗号化

移転するメモリー項目はすべて、次の方法で導出した 1 回限りの移転鍵を使い、転送中は AES-256-GCM で暗号化しなければなりません（MUST）。

```
transfer_key = HKDF-SHA256(
  salt = succession_id,
  ikm  = predecessor_private_key_contribution || successor_public_key_contribution,
  info = "DCP-AI.v2.Succession.TransferKey",
  len  = 32
)
```

前任が鍵合意に参加できない緊急の承継では、責任を負うプリンシパルが鍵の素材を提供します。

<a id="55-consent-for-relational-memory"></a>

### 5.5 関係に関するメモリーの同意

関係に関するメモリー項目（やり取りの履歴、特定の相手方についての信頼の評価）は、移転する前に影響を受ける相手方の同意が必要です。同意の流れ:

1. 前任（緊急時はプリンシパル）が、DCP-04 を通じて影響を受ける各相手方に同意の要求を送る
2. 相手方が同意または拒否で応答する
3. 同意を得た項目だけを移転する
4. 同意の記録をメモリー移転マニフェストに含める
5. 承継の期間内に相手方と連絡がつかない場合、その項目はスキップする

<a id="6-identity-boundary"></a>

## 6. アイデンティティの境界

<a id="61-principle"></a>

### 6.1 原則

後継のエージェントは新しい別個の主体です。前任の次のものは一切継承しません。

- エージェント ID
- 暗号鍵
- DCP-01 のアイデンティティバインディング
- 監査チェーン
- A2A セッション

後継は選ばれた運用上のコンテキストを受け取りますが、自らのアイデンティティのもとで動作します。この原則は根本的なものです。承継は責任と知識の移転であり、アイデンティティの移転ではありません。

<a id="62-provenance-tracking"></a>

### 6.2 来歴の追跡

承継によって受け取った知識を使うとき、後継は関連する監査エントリーに来歴の参照を含めるべきです（SHOULD）。

```json
{
  "provenance": {
    "source": "succession",
    "predecessor_agent_id": "agent:<predecessor>",
    "succession_id": "sr:<uuid>",
    "memory_item_id": "mti:<uuid>"
  }
}
```

これにより監査人は、移転された知識が後継の判断にどう影響したかを追跡できます。

<a id="7-security-considerations"></a>

## 7. セキュリティに関する考慮事項

<a id="71-testament-tampering"></a>

### 7.1 遺言の改ざん

デジタル遺言はハッシュで連鎖し署名されています。遺言のハッシュチェーンが壊れている場合、承継は自動のメモリー移転を行わず、プリンシパルの指示による移転に切り替えなければなりません（MUST）。プリンシパルは移転する各項目を明示的に認可する必要があります。

<a id="72-unauthorized-succession"></a>

### 7.2 認可されていない承継

承継セレモニーにはプリンシパルの認可が必要です。エージェントが一方的に後継者を宣言したり、承継を開始したりすることはできません。承継の記録に 3 つの署名（前任、後継、プリンシパル）を求めることで、すべての当事者の同意が確保されます。

<a id="73-memory-exfiltration"></a>

### 7.3 メモリーの持ち出し

メモリーの移転はデータ持ち出しの経路になりえます。緩和策:

- 移転項目は分類され、ポリシーで管理される
- 制限された項目にはプリンシパルの明示的な承認が必要
- 関係に関する項目には相手方の同意が必要
- すべての移転は暗号化され記録される
- 移転マニフェストが、完全で署名済みの一覧を提供する

<a id="74-emergency-succession-risks"></a>

### 7.4 緊急の承継のリスク

緊急の承継は、時間的な制約と前任が利用できないことから、安全策が弱まった状態で行われます。

- 承継の記録に前任の署名がない
- 関係に関するメモリーについて対話的な同意がない
- メモリーの状態が古いおそれがある（現在の状態ではなく最後のバックアップのもの）

緩和策:

- プリンシパルが緊急の承継を明示的に認可しなければならない
- 後継は、前任の最後に分かっている Merkle ルートに照らして移転されたデータを検証しなければならない
- 承継後の監査を 24 時間以内に行うべきである（SHOULD）

<a id="75-successor-impersonation"></a>

### 7.5 後継によるなりすまし

後継は自らを前任として示してはなりません（MUST NOT）。相手方への通知（セクション 4.2 のステップ 6）により、やり取りするすべてのエージェントが承継を知ることになります。実装は、後継が前任であると主張するやり取りを拒否すべきです（SHOULD）。

<a id="76-domain-separation"></a>

### 7.6 ドメイン分離

本仕様のすべての署名はドメイン分離タグ `DCP-SUCCESSION-SIG-v2` を使い、プロトコル間での署名のリプレイを防ぎます。

<a id="8-conformance"></a>

## 8. 適合性

実装が次を満たす場合、その実装は DCP-06 に適合しています。

1. セクション 3 で定義されたデジタル遺言の作成とハッシュ連鎖によるバージョン管理に対応している
2. セクション 4 で定義された 3 種類の承継セレモニー（計画的、強制、緊急）をすべて実装している
3. セクション 5 で定義されたメモリーの分類と移転のポリシーを適用している
4. セクション 5.3 で定義されたとおり、移転された項目に対する二重ハッシュの Merkle ルートを計算している
5. セクション 6 で定義された前任と後継の間のアイデンティティの境界を維持している
6. すべての承継セレモニーにプリンシパルの認可を要求している
7. すべての承継イベントについて DCP-03 の監査エントリーを生成している
8. すべての署名にドメイン分離タグ `DCP-SUCCESSION-SIG-v2` を使っている

<a id="references"></a>

## 参考文献

- DCP-01: アイデンティティとプリンシパルのバインディング
- DCP-03: 監査チェーンと透明性
- DCP-04: エージェント間通信
- DCP-05: エージェントのライフサイクル
- RFC 5869: HKDF
- NIST SP 800-88: Guidelines for Media Sanitization

---

*本仕様は、AI エージェントが生涯に蓄積する知識に、エージェント自身を超える価値があることを認めるものです。承継は、その価値が選択的かつ安全に、完全な説明責任を伴って、世代の境界を越えて保たれることを確保します。*

<a id="implementation-notes-informative"></a>

## 実装に関する注記（参考）

> **2026 年 10 月 25 日に追加。規範的ではありません。** これらの注記は要件を加えず、上の内容を何も変えません。`main` のリファレンスの
> コードがこの文書とどう関係するかを説明するものです。食い違う場合は、上の規範的な本文がそのまま有効です。

- **`schemas/v2/` の記録。** SDK が構築し `schemas/v2/` が検証する遺言、承継の記録、メモリー移転マニフェストの
  フィールドは、§3 から §5 の例とは異なります。たとえば `testament_version` と `prev_testament_hash`（バージョン 1
  では `GENESIS`、その後は前のバージョンの `sha256:`、SHA-256 のみ）、各カテゴリーに `transfer`、`retain`、
  `destroy` を割り当てる `memory_classification`、マニフェストの `transfer_hash` があります。§3.4 と §5.1 の
  4 つの分類と 4 つの移転ポリシーはスキーマにはありません。
- **署名。** 各記録は、渡された鍵を持つ者による `composite_sig`（Ed25519 + ML-DSA-65）を 1 つだけ、
  コンテキスト `DCP-AI.v2.Succession` で持ちます。SDK はタグ `DCP-SUCCESSION-SIG-v2` を使わず、§7.2 の
  3 つの署名（前任、後継、プリンシパル）も作成しません。
- **ヘルパーが行うこと。** 記録を構築し署名します。`executeSuccession` が拒否するのは空の
  `ceremony_participants` だけで、セレモニーの実行、プリンシパルの認可の確認、後継の検証、メモリーの移動は
  行いません。`classifyMemory` は遺言の処分に従ってエントリーを振り分けます。`transfer` はマニフェストへ、
  `destroy` と遺言にないカテゴリーは破棄済みとして列挙され、`retain` のエントリーはどちらのリストにも現れません。
  `createMemoryTransferManifest` は `transfer_hash` を呼び出し側から受け取り、§5.3 の Merkle ルートは計算しません。
  暗号化、同意の要求、相手方への通知（§5.4、§5.5、§4.2）は呼び出し側の責任です。
- これらの記録は署名者による署名付きの宣言です。例はプレースホルダーを含む説明用のものであり、フィクスチャでは
  ありません。SDK の型については [docs/API_REFERENCE.md](../../../docs/API_REFERENCE.md) を参照してください。
