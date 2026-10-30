<sub>[English](../../../spec/DCP-07.md) · [中文](../../zh-CN/spec/DCP-07.md) · [Español](../../es/spec/DCP-07.md) · **日本語** · [Português](../../pt-BR/spec/DCP-07.md)</sub>

<a id="dcp-07-conflict-resolution"></a>

# DCP-07: 紛争の解決

> [英語の仕様](../../../spec/DCP-07.md)の参考訳です（25/10/2026 更新）。**規範となるのは英語版です**。この翻訳に規範的な効力はなく、内容が異なる場合は英語版が優先されます。識別子とコードブロックは翻訳せずにそのまま掲載しています。

<a id="status"></a>

## ステータス
公開済み — v2.0（拡張。改訂は採用者からのフィードバックに基づいて管理）

<a id="abstract"></a>

## 概要
本仕様は、DCP 認定 AI エージェント間の紛争を解決するための、構造化された監査可能なプロトコルを定義します。3 段階のエスカレーションモデル（直接交渉、文脈に即した仲裁、人間への上訴）、型付きの紛争記録、M-of-N の仲裁パネル、先例を追跡するための判例バンドル、正式な異議のための異議記録を導入します。紛争解決の成果物はすべて暗号学的に署名されハッシュで連鎖するため、各紛争とその解決について改ざんを検出できる記録が作られます。

<a id="1-introduction"></a>

## 1. はじめに

DCP のもとで動作する AI エージェント同士のやり取り（DCP-04）が増えるにつれ、紛争は避けられません。エージェントは共有リソースを奪い合ったり、異なるプリンシパルから矛盾する指示を受けたり、能力の境界について意見が分かれたり、ポリシーを異なって解釈したりします。正式な解決の仕組みがなければ、こうした紛争は構造化された文脈のないまま人間のオペレーターにエスカレートされるか、デッドロックや連鎖的な障害を招きます。

DCP-07 は、次のことを行うプロトコルレベルの紛争解決の枠組みを提供します。

- 適切な解決戦略をとれるよう、紛争を種類ごとに分類する
- エージェント間の交渉から始まる 3 段階のエスカレーションモデルを定義する
- 各紛争、各解決の試み、各結果について、監査可能な署名済みの記録を作る
- 解決済みの紛争が先例となる判例の仕組みを構築する
- 解決に対して正式に異議を申し立てるあらゆる当事者の権利を守る

<a id="11-design-principles"></a>

### 1.1 設計原則
- 紛争はできる限り低い段階で解決されるべきである
- すべての紛争と解決の試みは署名され記録される
- 最後の手段として、人間への上訴が常に利用できる
- 解決済みの紛争は先例となり、将来の解決を改善する
- どのエージェントも、異議を申し立てる手段なしに解決の受け入れを強いられることはない

<a id="12-relationship-to-other-specifications"></a>

### 1.2 他の仕様との関係
- **DCP-01**: エージェントのアイデンティティが、紛争を提起し、または応じる当事者適格を決めます
- **DCP-02**: ポリシーの衝突は主要な紛争の種類であり、ポリシーの結果が紛争の文脈になります
- **DCP-03**: すべての紛争イベントは監査チェーンに記録されます
- **DCP-04**: 紛争の交渉メッセージは A2A チャネルでやり取りされます
- **DCP-05**: `declining` 状態のエージェントが紛争に参加する能力は限られます
- **DCP-08**: 権利侵害（DCP-08）は本仕様に基づく紛争を引き起こします

<a id="2-terminology"></a>

## 2. 用語

**紛争**: 解決を要する衝突があるという、1 つ以上のエージェントによる正式な宣言。

**紛争当事者**: 紛争の当事者であるエージェント。開始者（申立人）または相手方（被申立人）。

**エスカレーションの段階**: 3 つの解決段階のいずれか: `direct_negotiation`、`contextual_arbitration`、`human_appeal`。

**仲裁パネル**: 文脈に即した仲裁の段階で紛争を解決するために招集される、エージェントの集団（またはエージェントと人間の混成パネル）。決定には M-of-N の合意が必要です。

**判例バンドル**: 解決済みの紛争についての封印された記録。文脈、主張、結果を含み、将来の紛争の先例となります。

**異議記録**: 解決の結果に対する不同意を示す、正式な署名付きの宣言。

**ドメイン分離タグ**: `DCP-DISPUTE-SIG-v2`。本仕様で作成されるすべての署名に使われます。

<a id="3-dispute-types"></a>

## 3. 紛争の種類

<a id="31-classification"></a>

### 3.1 分類

紛争は 4 種類に分類され、それぞれ解決の特性が異なります。

| 種類 | コード | 説明 | 既定の開始段階 |
|------|------|-------------|----------------------|
| **リソースの衝突** | `resource_conflict` | 2 つ以上のエージェントが同じ限られたリソース（計算資源、データアクセス、API クォータ、ネットワーク帯域）を奪い合う | `direct_negotiation` |
| **指示の衝突** | `directive_conflict` | エージェントが複数のプリンシパルから、またはプリンシパルと組織のポリシーから、矛盾する指示を受ける | `contextual_arbitration` |
| **能力の衝突** | `capability_conflict` | エージェントが特定の行動を行う能力や権限を持つかどうかについての不一致 | `direct_negotiation` |
| **ポリシーの衝突** | `policy_conflict` | 2 つ以上のエージェントが共有ポリシーを異なって解釈する、またはあるエージェントの行動が別のエージェントのポリシー上の制約と衝突する | `direct_negotiation` |

<a id="32-severity-levels"></a>

### 3.2 重大度

各紛争には、エスカレーションの期限に影響する重大度があります。

| 重大度 | コード | エスカレーションの期限 |
|----------|------|-------------------|
| **低** | `low` | 段階ごとに 24 時間 |
| **中** | `medium` | 段階ごとに 4 時間 |
| **高** | `high` | 段階ごとに 1 時間 |
| **重大** | `critical` | 段階ごとに 15 分 |

現在の段階でエスカレーションの期限内に紛争が解決しない場合、次の段階へ自動的にエスカレートしなければなりません（MUST）。

<a id="4-dispute-record"></a>

## 4. 紛争記録

<a id="41-schema"></a>

### 4.1 スキーマ

スキーマの参照: `schemas/v2/dispute_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "dispute_record",
  "dispute_id": "disp:<uuid>",
  "dispute_type": "resource_conflict",
  "severity": "medium",
  "status": "open",
  "current_escalation_level": "direct_negotiation",
  "complainant": {
    "agent_id": "agent:<complainant-identifier>",
    "principal_id": "principal:<identifier>",
    "organization_id": "org:<identifier>"
  },
  "respondents": [
    {
      "agent_id": "agent:<respondent-identifier>",
      "principal_id": "principal:<identifier>",
      "organization_id": "org:<identifier>"
    }
  ],
  "subject": {
    "description": "Both agents require exclusive write access to the shared procurement database during the same time window",
    "resource_identifiers": ["resource:procurement-db:write-lock"],
    "related_intent_ids": ["intent:<uuid-a>", "intent:<uuid-b>"],
    "related_policy_ids": ["policy:<uuid>"],
    "related_audit_entries": ["evt:<uuid>", "evt:<uuid>"]
  },
  "evidence": [
    {
      "evidence_id": "evd:<uuid>",
      "submitted_by": "agent:<complainant-identifier>",
      "evidence_type": "intent_declaration",
      "reference": "intent:<uuid-a>",
      "description": "Complainant's intent declaration for procurement database access",
      "content_hash": "sha256:<hex>",
      "submitted_at": "2026-03-01T10:00:00Z"
    },
    {
      "evidence_id": "evd:<uuid>",
      "submitted_by": "agent:<respondent-identifier>",
      "evidence_type": "intent_declaration",
      "reference": "intent:<uuid-b>",
      "description": "Respondent's concurrent intent declaration for the same resource",
      "content_hash": "sha256:<hex>",
      "submitted_at": "2026-03-01T10:01:00Z"
    }
  ],
  "precedents_cited": [
    {
      "jurisprudence_id": "jur:<uuid>",
      "relevance": "Previous resource conflict resolved by time-sharing; similar resource type and contention pattern"
    }
  ],
  "timeline": [
    {
      "event": "dispute_opened",
      "timestamp": "2026-03-01T10:05:00Z",
      "actor": "agent:<complainant-identifier>"
    }
  ],
  "escalation_deadline": "2026-03-01T14:05:00Z",
  "opened_at": "2026-03-01T10:05:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<complainant-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DISPUTE-SIG-v2"
  }
}
```

<a id="42-dispute-lifecycle"></a>

### 4.2 紛争のライフサイクル

```
 opened ──> negotiating ──> escalated ──> arbitrating ──> escalated ──> appealing ──> resolved
                │                              │                              │
                └──────── resolved ◄───────────┘──────── resolved ◄───────────┘
                                                                              │
                                                                    withdrawn/abandoned
```

有効なステータス: `open`、`negotiating`、`escalated`、`arbitrating`、`appealing`、`resolved`、`withdrawn`、`abandoned`。

解決のないまますべてのエスカレーションの期限が切れ、どの当事者もそれ以上のエスカレーションを求めない場合、紛争は `abandoned` になります。

<a id="5-three-level-escalation-model"></a>

## 5. 3 段階のエスカレーションモデル

<a id="51-level-1-direct-negotiation"></a>

### 5.1 第 1 段階: 直接交渉

紛争中のエージェントが、DCP-04 の A2A メッセージングで直接衝突の解決を試みます。

**手順:**

1. 申立人が紛争記録を作成し、A2A で被申立人に送ることで紛争を開始する
2. 被申立人が受領を確認し、反証または解決案を示す
3. エージェント同士が解決案をやり取りする
4. すべての当事者が案を受け入れれば、紛争は解決する
5. 解決は仲裁の解決記録（セクション 6）に記録される

**交渉の戦略**（実装は対応してもかまいません（MAY））:

- **時間分割**: エージェントが交代で争点のリソースにアクセスする
- **優先度による**: 優先度（ポリシーまたはプリンシパルの指示による）の高いエージェントが先に進む
- **能力による**: 能力の関連性が高いエージェントが進む
- **ランダム**: 暗号学的に公正なコイン投げ（コミット・リビール方式）

**エスカレーションの契機**: エスカレーションの期限内に交渉が成立しない場合、紛争は第 2 段階へエスカレートしなければなりません（MUST）。

<a id="52-level-2-contextual-arbitration"></a>

### 5.2 第 2 段階: 文脈に即した仲裁

紛争を解決するために仲裁パネルを招集します。

**パネルの編成:**

1. 各紛争当事者が、事前承認された仲裁人プールからパネル候補を 1 人以上推薦する
2. M-of-N のパネルを編成する（最低 3 名、既定は M=2、N=3）
3. パネルのメンバーは、どの紛争当事者とも進行中の紛争を抱えていてはならない（MUST NOT）
4. パネルのメンバーのバイタリティは 600 を上回っていなければならない（MUST）（DCP-05）
5. パネルのメンバーは `active` のライフサイクル状態になければならない（MUST）

**仲裁の手順:**

1. パネルが紛争記録、証拠、引用された先例を審査する
2. パネルは紛争当事者に追加の証拠を求めてもよい（MAY）
3. パネルのメンバーがそれぞれ独立して評価し、解決案を出す
4. パネルが投票する。拘束力のある解決には M-of-N の合意が必要
5. 解決は、パネルの各メンバーの票とともに記録される

**パネルの決定の種類:**

- `binding_resolution` — すべての当事者が従わなければならない
- `recommended_resolution` — 拘束力のない提案。当事者は受け入れるかエスカレートできる
- `split_decision` — パネルが M-of-N に達しなかった。第 3 段階へ自動的にエスカレートする

<a id="53-level-3-human-appeal"></a>

### 5.3 第 3 段階: 人間への上訴

紛争は解決のために人間のプリンシパルへエスカレートされます。

**手順:**

1. 紛争記録の全体、証拠、仲裁の経緯、すべての異議を、全紛争当事者の責任を負うプリンシパルに提示する
2. プリンシパルは協議、交渉、または組織のポリシーの適用ができる
3. 人間の決定が、最終的で拘束力のある解決として記録される
4. プリンシパルが合意できない場合は、組織のエスカレーション手続きが適用される（DCP の範囲外）

**人間への上訴の保証:**

- どの紛争当事者も、それ以前の段階を飛ばして、いつでも人間への上訴にエスカレートしてよい（MAY）
- 重大度が critical の紛争は、人間への上訴の段階から始めてもよい（MAY）
- DCP プロトコルの中では、人間の決定が最終となる

<a id="6-arbitration-resolution"></a>

## 6. 仲裁の解決

<a id="61-schema"></a>

### 6.1 スキーマ

スキーマの参照: `schemas/v2/arbitration_resolution.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "arbitration_resolution",
  "resolution_id": "res:<uuid>",
  "dispute_id": "disp:<uuid>",
  "resolution_level": "contextual_arbitration",
  "resolution_type": "binding_resolution",
  "outcome": {
    "description": "Time-sharing arrangement: Agent A has exclusive access during 00:00-12:00 UTC, Agent B during 12:00-24:00 UTC",
    "actions_required": [
      {
        "agent_id": "agent:<agent-a>",
        "action": "Restrict procurement database write access to 00:00-12:00 UTC window",
        "deadline": "2026-03-02T00:00:00Z"
      },
      {
        "agent_id": "agent:<agent-b>",
        "action": "Restrict procurement database write access to 12:00-24:00 UTC window",
        "deadline": "2026-03-02T00:00:00Z"
      }
    ],
    "compliance_verification_method": "audit_chain_review",
    "compliance_deadline": "2026-03-09T00:00:00Z"
  },
  "reasoning": "Both agents have equally valid intent declarations for the resource. Historical precedent (jur:abc123) established time-sharing as the preferred resolution for symmetric resource conflicts. Agent A's intent was filed 60 seconds earlier, granting first selection of time window.",
  "precedents_applied": [
    {
      "jurisprudence_id": "jur:<uuid>",
      "applicability": "Directly applicable: same resource type, symmetric priority"
    }
  ],
  "panel": {
    "members": [
      {
        "agent_id": "agent:<arbitrator-1>",
        "vote": "approve",
        "reasoning_hash": "sha256:<hex>"
      },
      {
        "agent_id": "agent:<arbitrator-2>",
        "vote": "approve",
        "reasoning_hash": "sha256:<hex>"
      },
      {
        "agent_id": "agent:<arbitrator-3>",
        "vote": "dissent",
        "reasoning_hash": "sha256:<hex>"
      }
    ],
    "threshold": {
      "m": 2,
      "n": 3
    },
    "votes_for": 2,
    "votes_against": 1
  },
  "effective_at": "2026-03-01T16:00:00Z",
  "expires_at": "2026-06-01T00:00:00Z",
  "timestamp": "2026-03-01T15:30:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signatures": [
    {
      "agent_id": "agent:<arbitrator-1>",
      "alg": "ed25519",
      "kid": "<key-id>",
      "sig_b64": "...",
      "domain_sep": "DCP-DISPUTE-SIG-v2"
    },
    {
      "agent_id": "agent:<arbitrator-2>",
      "alg": "ed25519",
      "kid": "<key-id>",
      "sig_b64": "...",
      "domain_sep": "DCP-DISPUTE-SIG-v2"
    }
  ]
}
```

<a id="62-resolution-compliance"></a>

### 6.2 解決の遵守

拘束力のある解決の後:

1. すべての当事者は、指定された期限までに従わなければならない（MUST）
2. 遵守は、解決で指定された方法（通常は監査チェーンのレビュー）で確認される
3. 不遵守はそれ自体が紛争（種類: `policy_conflict`）となり、直接人間への上訴へエスカレートする
4. 不遵守が繰り返された場合、理由のある終了（DCP-05）を引き起こしてもよい（MAY）

<a id="7-jurisprudence-bundle"></a>

## 7. 判例バンドル

<a id="71-purpose"></a>

### 7.1 目的

解決済みの紛争は判例バンドルとしてまとめられます。これは封印された参照可能な記録で、将来の紛争解決の先例となります。こうして、時間とともに解決の一貫性を高める「判例法」の体系が育っていきます。

<a id="72-schema"></a>

### 7.2 スキーマ

スキーマの参照: `schemas/v2/jurisprudence_bundle.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "jurisprudence_bundle",
  "jurisprudence_id": "jur:<uuid>",
  "dispute_id": "disp:<uuid>",
  "resolution_id": "res:<uuid>",
  "classification": {
    "dispute_type": "resource_conflict",
    "resource_category": "database_access",
    "resolution_pattern": "time_sharing",
    "tags": ["symmetric_priority", "exclusive_access", "periodic_resource"]
  },
  "summary": {
    "facts": "Two agents with equivalent priority both declared intent to access the same exclusive-write resource during overlapping time windows.",
    "holding": "Time-sharing arrangement based on filing order, with the earlier-filing agent selecting preferred time window.",
    "rationale": "Symmetric priority conflicts for periodic resources are best resolved by time division. Filing order provides a fair, deterministic tie-breaker.",
    "dissent": "Dissenting arbitrator argued for capability-based priority, where the agent with greater procurement-domain capability should receive priority access."
  },
  "applicability": {
    "applicable_dispute_types": ["resource_conflict"],
    "applicable_conditions": [
      "Two or more agents with equal priority",
      "Exclusive-access resource that supports time division",
      "No principal directive establishing priority"
    ],
    "inapplicable_conditions": [
      "Non-divisible resource (e.g., one-time-use token)",
      "Asymmetric principal-directed priority"
    ]
  },
  "supersedes": [],
  "superseded_by": null,
  "authority_level": "contextual_arbitration",
  "created_at": "2026-03-01T16:00:00Z",
  "dispute_record_hash": "sha256:<hex>",
  "resolution_record_hash": "sha256:<hex>",
  "objections": [],
  "timestamp": "2026-03-01T16:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<panel-lead-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DISPUTE-SIG-v2"
  }
}
```

<a id="73-precedent-matching"></a>

### 7.3 先例の照合

新しい紛争が開始されたとき、エージェントと仲裁パネルは、適用できる先例を判例のレジストリで探すべきです（SHOULD）。

1. `dispute_type` で絞り込む
2. `applicable_conditions` で照合する
3. `inapplicable_conditions` に基づいて除外する
4. `authority_level` で順位付けする（human_appeal > contextual_arbitration > direct_negotiation）
5. 判断が衝突する場合は、より新しい先例を優先する

先例は助言的なものであり、厳密な拘束力はありません。仲裁パネルと人間のプリンシパルは、理由を文書に残したうえで先例から離れてもかまいません（MAY）。

<a id="74-supersession"></a>

### 7.4 置き換え

判例バンドルは、同じ問題についての後の判断によって置き換えられることがあります。置き換えられた場合:

- `superseded_by` フィールドが新しい判例バンドルを参照するよう更新される
- 置き換えるバンドルの `supersedes` フィールドに古いバンドルが列挙される
- 置き換えられたバンドルは履歴の参照のためにレジストリに残るが、先例の照合では優先度が下げられる

<a id="8-objection-record"></a>

## 8. 異議記録

<a id="81-purpose"></a>

### 8.1 目的

どの紛争当事者も、解決の結果に正式に異議を申し立てることができます。異議は、署名とタイムスタンプが付いた成果物として記録され、紛争の恒久的な記録の一部になります。異議を申し立てても解決が自動的に覆るわけではありませんが、エージェントの反対意見が保存され、将来の上訴や先例への異議の根拠になりえます。

<a id="82-schema"></a>

### 8.2 スキーマ

スキーマの参照: `schemas/v2/objection_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "objection_record",
  "objection_id": "obj:<uuid>",
  "dispute_id": "disp:<uuid>",
  "resolution_id": "res:<uuid>",
  "objecting_party": {
    "agent_id": "agent:<identifier>",
    "principal_id": "principal:<identifier>"
  },
  "objection_type": "procedural",
  "grounds": {
    "summary": "Panel member agent:<arbitrator-3> had a prior undisclosed resource dependency on the respondent, creating a conflict of interest",
    "detailed_reasoning": "Audit chain analysis reveals that arbitrator-3 and the respondent shared 47 A2A sessions in the preceding 30 days, establishing a working relationship that was not disclosed during panel formation. This violates the independence requirement of Section 5.2.",
    "evidence_references": [
      "evt:<uuid-session-log-1>",
      "evt:<uuid-session-log-2>"
    ],
    "precedent_references": []
  },
  "requested_remedy": {
    "type": "panel_reconstitution",
    "description": "Request reconstitution of the arbitration panel with verified independent members and re-hearing of the dispute"
  },
  "status": "filed",
  "filed_at": "2026-03-01T17:00:00Z",
  "timestamp": "2026-03-01T17:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<objecting-agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DISPUTE-SIG-v2"
  }
}
```

<a id="83-objection-types"></a>

### 8.3 異議の種類

| 種類 | コード | 説明 |
|------|------|-------------|
| **実体的** | `substantive` | 解決が実質面で誤っている。証拠や理由付けが結果を支えていない |
| **手続的** | `procedural` | 解決の手続きに欠陥があった（パネルの偏り、見落とされた証拠、範囲の逸脱） |
| **先例** | `precedent` | 十分な正当化なしに、確立した判例と矛盾している |
| **権利** | `rights` | 解決が DCP-08 で定義されたエージェントの権利を侵害している |

<a id="84-objection-handling"></a>

### 8.4 異議の扱い

1. 申し立てられた異議は紛争記録に追加され、判例バンドルに含められる
2. 人間のプリンシパルが停止を命じない限り、解決は有効のままである
3. 種類が `rights` の異議は、審査のために人間への上訴の段階へ回さなければならない（MUST）
4. 異議は、将来の先例への異議（セクション 7.4）の根拠となる

<a id="9-audit-integration"></a>

## 9. 監査との統合

<a id="91-dispute-audit-events"></a>

### 9.1 紛争の監査イベント

紛争のライフサイクルのすべてのイベントが DCP-03 の監査エントリーを生成します。

| イベント | `event_type` |
|-------|-------------|
| 紛争の開始 | `dispute_opened` |
| 証拠の提出 | `dispute_evidence_submitted` |
| 交渉案の送信 | `dispute_negotiation_proposal` |
| 紛争のエスカレーション | `dispute_escalated` |
| 仲裁パネルの編成 | `arbitration_panel_formed` |
| パネルの投票 | `arbitration_vote_cast` |
| 解決の発行 | `dispute_resolved` |
| 異議の申し立て | `dispute_objection_filed` |
| 解決の遵守の確認 | `dispute_compliance_verified` |
| 解決の遵守の不履行 | `dispute_compliance_failed` |

<a id="92-cross-agent-audit-consistency"></a>

### 9.2 エージェント間の監査の整合性

紛争には複数のエージェントが関わるため、監査人はチェーン間の整合性を検証すべきです（SHOULD）。

1. 両紛争当事者の監査チェーンが同じ `dispute_id` を参照しているべきである
2. 証拠提出のタイムスタンプがチェーン間で整合しているべきである
3. 解決の記録がすべての紛争当事者のチェーンに存在するべきである

<a id="10-security-considerations"></a>

## 10. セキュリティに関する考慮事項

<a id="101-panel-independence"></a>

### 10.1 パネルの独立性

仲裁パネルのメンバーは紛争当事者から独立していなければなりません（MUST）。独立性は次の点で確認されます。

- 直近 30 日間（設定可能）に、どの紛争当事者ともアクティブな A2A セッションがない
- どの紛争当事者ともプリンシパルを共有していない
- いずれかの紛争当事者が関わる進行中の紛争がない
- 信頼できる参加を確保するため、バイタリティが 600 を上回っている

<a id="102-evidence-integrity"></a>

### 10.2 証拠の完全性

証拠への参照はすべてコンテンツアドレス（ハッシュ）です。提出後の証拠は、検出されずに改変することはできません。実装は次のことを行うべきです（SHOULD）。

- 提出された証拠を不変の形で保存する
- コンテンツハッシュが一致しない証拠を拒否する
- 証拠の提出を監査チェーンにタイムスタンプ付きで記録する

<a id="103-dispute-flooding"></a>

### 10.3 紛争の濫発

悪意のあるエージェントは、根拠のない紛争を申し立てて相手方や仲裁リソースを圧迫するおそれがあります。緩和策:

- レート制限: エージェントごと・期間ごとの紛争の上限数（設定可能、既定は 24 時間あたり 10 件）
- 申し立てのコスト: 自分に不利な形で解決された紛争を申し立てたエージェントは紛争スコアが累積し、申し立てのしきい値が上がる
- 重大度の検証: 重大度が critical の紛争は、申し立ての時点で裏付けとなる証拠が必要

<a id="104-panel-collusion"></a>

### 10.4 パネルの共謀

M-of-N の仲裁は個人の偏りを和らげますが、組織的な共謀は防げません。緩和策:

- パネルのメンバーは、組織をまたいで分散したプールから選ばれる
- 可能な場合、パネルのメンバーの選出には検証可能なランダム関数を使う
- 反対意見は恒久的に記録される
- 人間への上訴が常に利用できる

<a id="105-domain-separation"></a>

### 10.5 ドメイン分離

本仕様のすべての署名はドメイン分離タグ `DCP-DISPUTE-SIG-v2` を使い、プロトコル間での署名のリプレイを防ぎます。

<a id="11-conformance"></a>

## 11. 適合性

実装が次を満たす場合、その実装は DCP-07 に適合しています。

1. セクション 3 で定義された 4 種類の紛争すべてに対応している
2. セクション 5 で定義された 3 段階のエスカレーションモデルを実装している
3. セクション 5.2 で定義されたとおり、しきい値を設定できる M-of-N の仲裁パネルに対応している
4. セクション 4、6、8 のスキーマに準拠した紛争記録、仲裁の解決、異議記録を生成している
5. セクション 7 で定義されたとおり、解決済みの紛争を判例バンドルとしてまとめている
6. セクション 3.2 で定義されたとおり、重大度に基づくエスカレーションの期限を強制している
7. セクション 9 で定義されたとおり、すべての紛争イベントについて DCP-03 の監査エントリーを作成している
8. すべての署名にドメイン分離タグ `DCP-DISPUTE-SIG-v2` を使っている

<a id="references"></a>

## 参考文献

- DCP-01: アイデンティティとプリンシパルのバインディング
- DCP-02: 意図の宣言とポリシーによるゲーティング
- DCP-03: 監査チェーンと透明性
- DCP-04: エージェント間通信
- DCP-05: エージェントのライフサイクル
- DCP-08: 権利と義務

---

*本仕様は、紛争をマルチエージェントシステムの失敗ではなく、本来備わった特徴として捉えます。プロトコルの真価は、紛争が起きるかどうかではなく、それが公正に、透明に、完全な説明責任を伴って解決されるかどうかで測られます。*

<a id="implementation-notes-informative"></a>

## 実装に関する注記（参考）

> **2026 年 10 月 25 日に追加。規範的ではありません。** これらの注記は要件を加えず、上の内容を何も変えません。`main` のリファレンスの
> コードがこの文書とどう関係するかを説明するものです。食い違う場合は、上の規範的な本文がそのまま有効です。

- **`schemas/v2/` の記録。** SDK が構築し `schemas/v2/` が検証する紛争記録、仲裁の解決、判例バンドル、異議記録の
  フィールドは、§4 から §8 の例とは異なります。紛争には `respondent_agent_id` が 1 つと `evidence_hashes` があり、
  重大度や期限はありません。その `status` は `open`、`in_negotiation`、`arbitrated`、`appealed`、`resolved` の
  いずれかで、§4.2 の 8 つのステータスではありません。異議は `directive_hash` を参照し、その `objection_type` は
  `ethical`、`safety`、`policy_violation`、`capability_mismatch` のいずれかで、§8.3 の 4 種類ではありません。
  判例バンドルの `authority_level` は `local`、`organizational`、`cross_org` のいずれかです。
- **署名。** 各記録は、渡された鍵を持つ者による `composite_sig`（Ed25519 + ML-DSA-65）を 1 つだけ、
  コンテキスト `DCP-AI.v2.Dispute` で持ちます。SDK はタグ `DCP-DISPUTE-SIG-v2` を使いません。
- **ヘルパーが行うこと。** 記録を構築し署名します。エスカレーションと解決は、呼び出し側が求めたときにだけ
  行われます。`createDispute` は紛争の種類にかかわらず、常に `direct_negotiation`、ステータス `open` で始めます。
  `escalateDispute` は 1 段階上げて `in_negotiation` を設定します。タイマーがないため、期限の経過でエスカレート
  するものはありません。`resolveDispute` はどの段階でも `resolved` を設定します。`createArbitrationPanel` が
  確認するのは、しきい値が 1 以上で、その数以上の仲裁人 ID があることだけです。独立性、バイタリティ、
  ライフサイクル状態は確認せず、`submitResolution` は受け取った仲裁人 ID とテキストに 1 つの鍵で署名し、票は
  集めません。`lookupPrecedent` は `category` と、任意で 1 つのコンテキストで絞り込むだけで、順位付けはしません。
- これらの記録は署名者による署名付きの宣言です。SDK もサービスも解決を強制しません。例はプレースホルダーを含む
  説明用のものであり、フィクスチャではありません。SDK の型については [docs/API_REFERENCE.md](../../../docs/API_REFERENCE.md) を参照してください。
