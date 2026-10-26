<sub>[English](DCP-09.md) · [中文](DCP-09.zh-CN.md) · [Español](DCP-09.es.md) · **日本語** · [Português](DCP-09.pt-BR.md)</sub>

<a id="dcp-09-delegation--representation"></a>
<a id="dcp-09-delegation-representation"></a>

# DCP-09: 委任と代理

> [英語の仕様](DCP-09.md)の参考訳です（25/10/2026 更新）。**規範となるのは英語版です**。この翻訳に規範的な効力はなく、内容が異なる場合は英語版が優先されます。識別子とコードブロックは翻訳せずにそのまま掲載しています。

<a id="status"></a>

## ステータス
公開済み — v2.0（拡張。改訂は採用者からのフィードバックに基づいて管理）

> **正誤表（25/10/2026、規範的）：** [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md) の正誤 E5、E6、E7、E8 は、署名のコンテキスト、マンデートの期限を持つフィールド、例の位置づけを訂正します。本仕様のその他の要件は変わりません。

<a id="abstract"></a>

## 概要
本仕様は、人間からエージェントへの権限の委任、エージェントの認識しきい値、助言の宣言、プリンシパルミラー、二層のやり取りの記録についてのプロトコルを定義します。人間のプリンシパルが AI エージェントに特定の権限を正式に委任する仕組み、エージェントが委任されたコンテキストについての理解を宣言する仕組み、やり取りを技術的な層と人間が読める層の両方で記録する仕組みを提供します。DCP-09 はまた、DCP-04 の A2A ハンドシェイクを拡張して委任マンデートの検証を含め、プリンシパルに代わって行動するエージェントが相手方に権限を証明できるようにします。

<a id="1-introduction"></a>

## 1. はじめに

DCP-01 は、すべてのエージェントが責任を負うプリンシパルに結び付けられることを定めます。しかし、その結び付きの性質、すなわちプリンシパルがどのような権限を委任したか、エージェントが委任された役割をどう理解しているか、エージェントがやり取りの中でプリンシパルをどう代理するかは、正式には規定されていません。DCP-09 はこの空白を埋めます。

マルチエージェントシステムでは、エージェントは、すべてのやり取りに立ち会うことのできない人間のプリンシパルに代わって行動することがよくあります。購買エージェントは供給者のエージェントと交渉し、コンプライアンスエージェントはガバナンス担当者に代わってポリシーをレビューし、研究エージェントは科学者に代わってデータソースを照会します。いずれの場合もエージェントは委任された権限を行使しており、その権限の範囲と限界は明示的で、検証可能で、監査可能でなければなりません。

DCP-09 は、相互に関連する 5 つの問題に取り組みます。

1. **委任**: プリンシパルがエージェントに正式に権限を与える方法
2. **認識**: エージェントが委任されたコンテキストと制約についての理解を宣言する方法
3. **助言**: エージェントが不確かさや推奨をプリンシパルに伝える方法
4. **代理**: エージェントがプリンシパルの利益を人間が読める形で示す方法
5. **やり取りの記録**: やり取りを技術的な層と叙述的な層の両方で記録する方法

<a id="11-design-principles"></a>

### 1.1 設計原則
- 委任は明示的で、範囲が限定され、期間が区切られている
- エージェントは、できることだけでなく、理解していることを宣言しなければならない
- 人間のプリンシパルは、エージェントの行動を自然言語でレビューできなければならない
- やり取りは二層の記録を生む: 機械で検証できるものと人間が読めるもの
- 委任マンデートは、A2A ハンドシェイクの際に相手方が検証できる

<a id="12-relationship-to-other-specifications"></a>

### 1.2 他の仕様との関係
- **DCP-01**: 委任マンデートは、明示的な権限の範囲でプリンシパルのバインディングを拡張します
- **DCP-02**: 意図の宣言は、その行動を認可する委任マンデートを参照します
- **DCP-03**: すべての委任イベントは監査チェーンに記録されます
- **DCP-04**: A2A ハンドシェイクはマンデートの検証を含むよう拡張されます
- **DCP-05**: エージェントが運用終了すると、委任マンデートは失効させられます
- **DCP-07**: 委任された権限の逸脱から紛争が生じることがあります
- **DCP-08**: エージェントには、委任された範囲内で行動する義務があります

<a id="2-terminology"></a>

## 2. 用語

**委任マンデート**: 人間のプリンシパルがエージェントに特定の権限を与える署名済みの文書。範囲、条件、有効期限が定められます。

**認識しきい値**: エージェントが委任されたコンテキストについて何を理解し何を理解していないかを示す構造化された宣言。検証可能な誠実さの仕組みとして機能します。

**助言の宣言**: エージェントからプリンシパルへの正式な連絡。不確かさを宣言し、人間によるレビューを勧め、またはエージェントの委任された能力を超えるおそれのある状況を知らせます。

**プリンシパルミラー**: エージェントが理解するところのプリンシパルの利益、価値観、優先事項を人間が読める叙述として表したもの。やり取りの際にエージェントに付随します。

**やり取りの記録**: やり取りについての二層の記録。技術的な層（機械で検証可能）と叙述的な層（人間が読める）からなり、どちらも署名されハッシュで連鎖します。

**マンデートチェーン**: あるエージェントが自らの権限の一部を別のエージェントに委任した場合の、元の人間のプリンシパルから中間のエージェントを経て最終的な受任者に至るマンデートの連なり。

**ドメイン分離コンテキスト**: `DCP-AI.v2.Delegation`（ルートマンデート、プリンシパルミラー、やり取りの記録）、`DCP-AI.v2.Awareness`（認識しきい値と助言の宣言）、`DCP-AI.v2.SubMandate`（サブマンデート、セクション 3.5）。正誤 E5。最初の 2 つは、以前はここにラベル `DCP-DELEGATION-SIG-v2` と `DCP-AWARENESS-SIG-v2` として記載されていました。

<a id="3-delegation-mandate"></a>

## 3. 委任マンデート

<a id="31-purpose"></a>

### 3.1 目的

委任マンデートは、人間のプリンシパルが AI エージェントに権限を与えるための正式な文書です。エージェントが何をする権限を持つか、どのような条件で、どのような制限のもとで、どれだけの期間かを定めます。有効な委任マンデートがなければ、エージェントは基本的な能力を超えてプリンシパルに代わって行動してはなりません（MUST NOT）。

<a id="32-schema"></a>

### 3.2 スキーマ

スキーマの参照: `schemas/v2/delegation_mandate.schema.json`

> **正誤 E6 と E7（25/10/2026）：** この例は概念的なものです。V2.0 のワイヤーフォーマットはスキーマです。期間は `valid_from` / `valid_until` で、署名は `human_composite_sig`（ルート）または `delegator_composite_sig`（サブマンデート）です（セクション 3.5）。署名済みのルートマンデートとサブマンデートは `tests/interop/v2/mandate_chain_vectors.json` にあります。[V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md) を参照してください。

```json
{
  "dcp_version": "2.0",
  "record_type": "delegation_mandate",
  "mandate_id": "dm:<uuid>",
  "mandate_hash": "sha256:<hex of the canonical form of this mandate>",
  "delegator": {
    "principal_id": "principal:<identifier>",
    "principal_name": "Dr. Sarah Chen",
    "organization_id": "org:<identifier>",
    "role": "Head of Procurement"
  },
  "delegate": {
    "agent_id": "agent:<identifier>",
    "agent_name": "Procurement Agent Alpha"
  },
  "authority": {
    "scope": "procurement",
    "permissions": [
      {
        "action": "negotiate",
        "resource_pattern": "vendor:*",
        "conditions": {
          "max_contract_value": 50000,
          "currency": "USD",
          "approved_vendors_only": true,
          "vendor_list_reference": "policy:approved-vendors-2026-q1"
        }
      },
      {
        "action": "issue_purchase_order",
        "resource_pattern": "vendor:approved:*",
        "conditions": {
          "max_order_value": 10000,
          "currency": "USD",
          "requires_dual_quote": true
        }
      },
      {
        "action": "request_information",
        "resource_pattern": "vendor:*",
        "conditions": {}
      }
    ],
    "prohibitions": [
      {
        "action": "approve_payment",
        "reason": "Payment approval requires human authorization"
      },
      {
        "action": "modify_vendor_list",
        "reason": "Vendor list modifications require governance review"
      }
    ],
    "escalation_triggers": [
      {
        "condition": "contract_value_exceeds_threshold",
        "threshold": 25000,
        "action": "advisory_to_principal",
        "description": "Notify principal when negotiated value exceeds $25,000"
      },
      {
        "condition": "new_vendor_encountered",
        "action": "advisory_to_principal",
        "description": "Alert principal when interacting with a vendor not on the approved list"
      },
      {
        "condition": "uncertainty_above_threshold",
        "threshold": 0.3,
        "action": "pause_and_advise",
        "description": "Pause action and seek principal guidance when confidence drops below 70%"
      }
    ]
  },
  "sub_delegation": {
    "permitted": true,
    "max_depth": 1,
    "sub_delegate_requirements": {
      "same_organization_required": true,
      "minimum_security_tier": "elevated",
      "permitted_scope_reduction_only": true
    }
  },
  "validity": {
    "effective_from": "2026-03-01T00:00:00Z",
    "effective_until": "2026-06-01T00:00:00Z",
    "renewable": true,
    "revocation_conditions": [
      "principal_revocation",
      "agent_decommissioned",
      "policy_violation_detected",
      "organization_policy_change"
    ]
  },
  "audit_requirements": {
    "log_all_actions": true,
    "narrative_record_required": true,
    "principal_review_interval": "P7D",
    "advisory_threshold": "medium"
  },
  "issued_at": "2026-03-01T00:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  },
  "agent_acknowledgment": {
    "acknowledged_at": "2026-03-01T00:01:00Z",
    "awareness_threshold_id": "at:<uuid>",
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  }
}
```

<a id="33-mandate-issuance-flow"></a>

### 3.3 マンデート発行の流れ

1. プリンシパルが範囲、許可、禁止、有効性を定めて委任マンデートを作成する
2. プリンシパルが自身の鍵でマンデートに署名する
3. マンデートがエージェントに渡される
4. エージェントがマンデートを確認し、自らの理解を反映した認識しきい値（セクション 4）を作成する
5. エージェントが受領確認に署名し、認識しきい値に結び付ける
6. 受領確認済みのマンデートが有効になる
7. プリンシパルとエージェントの両方の監査チェーンに `delegation_mandate_issued` の監査エントリーが作成される

> *参考注記（25/10/2026）：* V2.0 の `delegation_mandate` スキーマには、ステップ 5 のエージェントの確認応答のためのフィールドがありません。[V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md#4-requirements-the-v20-structures-do-not-represent-directly) を参照してください。

<a id="34-mandate-hash"></a>

### 3.4 マンデートのハッシュ

`mandate_hash` は、署名を除いたマンデートの正規化された（決定的にシリアライズされた）内容の SHA-256 ハッシュです。このハッシュは A2A ハンドシェイク（セクション 8）で使われ、相手方がマンデート全体にアクセスせずにエージェントの権限を検証できるようにします。

<a id="35-sub-delegation"></a>

### 3.5 再委任

受任エージェントは、**サブマンデート**を発行して、権限の一部を別のエージェントに渡してもかまいません（MAY）。サブマンデートとは、親を参照し、人間ではなく委任するエージェントが署名する `DelegationMandate`（`schemas/v2/delegation_mandate.schema.json`）です。人間のルートマンデートから行動するエージェントまでのマンデートが**マンデートチェーン**を形成します。各段階が署名され、前の段階が与えたものを狭めることしかできず、人間のプリンシパルまでオフラインで検証できるため、責任はすべての段階を通じて保たれます。

<a id="351-wire-fields"></a>

#### 3.5.1 ワイヤー上のフィールド

ワイヤースキーマには次の省略可能なフィールドがあります。チェーンの一部でないマンデートではすべて存在しないため、既存のルートマンデートは 1 バイトも変わりません。

| フィールド | 型 | 意味 |
|---|---|---|
| `parent_mandate_id` | string | このサブマンデートが狭めるマンデートの `mandate_id`。ルートマンデートでは存在してはならない（MUST）。 |
| `delegation_depth` | integer ≥ 0 | 人間からの段数: ルートマンデートでは `0`（または不在）、サブマンデートでは親の深さ + 1。 |
| `sub_delegation` | `{ "permitted": boolean, "max_depth": integer ≥ 0 }` | 受任者が再委任できるかどうかと、どの子孫も到達できる最大の `delegation_depth`。不在の場合、再委任は許可されない。 |
| `minimum_security_tier` | `routine` \| `standard` \| `elevated` \| `maximum` | マンデートのもとで行うすべての行動のセキュリティ階層（DCP-AI v2.0 §14.2）の下限。 |
| `delegator_composite_sig` | `CompositeSignature` | 委任するエージェント（親マンデートの `agent_id`）が、ドメイン分離コンテキスト `DCP-AI.v2.SubMandate` のもとで正規化されたサブマンデートに付けた署名。 |

ルートマンデートは `human_composite_sig`（コンテキスト `DCP-AI.v2.Delegation`）を持たなければならず（MUST）、`delegator_composite_sig` を持ってはなりません（MUST NOT）。サブマンデートは `delegator_composite_sig`、`parent_mandate_id`、`delegation_depth` を持たなければならず（MUST）、`human_composite_sig` を持ってはなりません（MUST NOT）。署名されるバイト列は、署名フィールドを除いた正規化されたマンデートであり、その深さに応じたコンテキストのもとで署名されます。

`human_composite_sig` と `delegator_composite_sig` はどちらも `pq_over_classical` のバインディング（DCP-AI v2.0 §5）を使わなければなりません（MUST）。検証者は、検証モードにかかわらず、署名が `classical_only` のマンデートを拒否しなければなりません（MUST）。

<a id="352-chain-verification"></a>

#### 3.5.2 チェーンの検証

マンデートチェーンを受け入れる検証者は、順序付けられたチェーン（ルートが先頭）、失効した `mandate_id` の集合、検証時刻、人間のプリンシパルと委任する各エージェントの鍵を受け取らなければならず（MUST）、次のすべてが成り立たない限り、チェーン全体を拒否しなければなりません（MUST）。人間のプリンシパルの鍵は、チェーンの `human_id` の Responsible Principal Record の `binding_keys` でなければならず（MUST）、委任するエージェントの鍵は、その `agent_id` の検証済み Agent Passport の `keys` でなければなりません（MUST）。チェーンの検証者は与えられたものの中から `kid` で鍵を探すだけで、その対応付け自体は確立しません。これは bundle の検証者と同じ信頼モデルです。タイムスタンプは RFC 3339 の時点として解釈し、テキストとして比較してはなりません（MUST NOT）。未知の値を持つフィールド、マンデートの深さに対して欠けているフィールド、比較できない入力は、いずれもフェイルクローズになります。

1. **ルート。** 最初のマンデートは `delegation_depth` が 0 または不在で、`parent_mandate_id` を持たず、人間のプリンシパルの鍵で検証できる `human_composite_sig` を持つ。
2. **リンク。** 各サブマンデートの `parent_mandate_id` は直前のマンデートの `mandate_id` と等しく、その `delegation_depth` は親の値 + 1 で、その `human_id` は親と等しく、その `delegator_composite_sig` は親の `agent_id` の鍵で検証できる。
3. **許可と深さ。** 親の `sub_delegation.permitted` が `true` であり、サブマンデートの `delegation_depth` が、すべての祖先の `sub_delegation.max_depth` のうち最小のもの以下である。
4. **有効期間。** `valid_from` が親より前ではなく、`valid_until` が親より後ではなく、検証時刻がすべてのマンデートの期間内にある。
5. **縮小。** サブマンデートの各 `authority_scope` エントリーは、同じ `domain` を持つ親のエントリーに対応する。その `actions_permitted` は親のものの部分集合であり、その `data_classes` は親のものの部分集合である。親のエントリーに `data_classes` があればサブマンデートのエントリーにもあり（空リスト、つまりデータクラスなしが最も狭い）、親のエントリーになければサブマンデートのエントリーにもない。親のエントリーの `limits` の各キーについて、サブマンデートのエントリーはそのキーを持ち、その値は親以下の数値か、親と同一の値である。サブマンデートはキーを追加してもよい（MAY）。数値の制限は ±(2^53 − 1) の範囲の整数でなければならない（MUST）。これは、JSON の数値をどう表現する実装でも正確に読める範囲であり、それを超えると、数値を倍精度で解釈する検証者とすべての桁を保持する検証者とで、マンデートの内容の解釈が食い違う。この範囲外の数値の制限を持つマンデートは、どの深さでも、親がそのキーを持つかどうかにかかわらず、比較できないものとする。1 つのマンデートに 2 回現れるドメインは比較できないものとする。
6. **階層の下限。** 親に `minimum_security_tier` がある場合、サブマンデートはそれを下回らない値を持つ（`routine` < `standard` < `elevated` < `maximum`）。チェーンの実効的な階層は、チェーン上の `minimum_security_tier` の最大値である。それを DCP-AI v2.0 §14.2 の階層計算に反映する検証者は、それが階層を引き上げる方向にだけ働くようにしなければならない（MUST）。
7. **失効。** チェーンのどのマンデートも失効していない。失効した祖先は、そのすべての子孫を無効にする。

リファレンス実装: `verifyMandateChain`（TypeScript）、`verify_mandate_chain`（Python と Rust）、`VerifyMandateChain`（Go）。`tests/interop/v2/mandate_chain_vectors.json` には、すべての実装が受け入れなければならない（MUST）チェーンと拒否しなければならない（MUST）チェーンが含まれ、4 つの SDK のテストスイートすべてがこれを実行します。

<a id="36-mandate-revocation"></a>

### 3.6 マンデートの失効

マンデートは次によって失効することがあります。

- **プリンシパルによる失効**: 委任したプリンシパルがマンデートを明示的に失効させる
- **期限切れ**: `valid_until` の時点を過ぎる（正誤 E6。RFC 3339 の時点として比較、セクション 3.5.2）
- **エージェントの運用終了**: 受任エージェントが `decommissioned` に移る（DCP-05）
- **ポリシー違反**: エージェントがマンデートに定められた条件に違反する

失効により、マンデートチェーンに追加される署名付きの失効記録が作られます。

<a id="4-awareness-threshold"></a>

## 4. 認識しきい値

<a id="41-purpose"></a>

### 4.1 目的

認識しきい値は、エージェントが委任されたコンテキストについて何を理解し何を理解していないかを示す正式な宣言です。検証可能な誠実さの仕組みとして機能します。知識の境界を明示的に述べることで、エージェントはプリンシパルや相手方が自らの行動の信頼性を評価できるようにします。

<a id="42-schema"></a>

### 4.2 スキーマ

スキーマの参照: `schemas/v2/awareness_threshold.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "awareness_threshold",
  "threshold_id": "at:<uuid>",
  "agent_id": "agent:<identifier>",
  "mandate_id": "dm:<uuid>",
  "version": 1,
  "understanding": {
    "delegation_scope": {
      "confidence": 0.95,
      "summary": "I understand that I am authorized to negotiate with approved vendors for procurement contracts up to $50,000 and issue purchase orders up to $10,000",
      "gaps": []
    },
    "domain_knowledge": {
      "confidence": 0.82,
      "summary": "I have strong knowledge of standard procurement procedures and vendor evaluation criteria. I have moderate knowledge of supply chain risk assessment.",
      "gaps": [
        {
          "area": "international_trade_compliance",
          "confidence": 0.45,
          "description": "Limited knowledge of export control regulations and international trade compliance requirements",
          "mitigation": "Will escalate to principal for any international procurement"
        },
        {
          "area": "specialized_materials",
          "confidence": 0.55,
          "description": "Limited ability to evaluate technical specifications for specialized laboratory equipment",
          "mitigation": "Will request technical review from domain specialist before proceeding"
        }
      ]
    },
    "counterparty_context": {
      "confidence": 0.70,
      "summary": "I have interaction history with 15 of the 23 approved vendors. I have no prior context for 8 vendors.",
      "gaps": [
        {
          "area": "new_vendor_negotiation_patterns",
          "confidence": 0.40,
          "description": "No historical data on negotiation patterns for vendors added in Q1 2026",
          "mitigation": "Will adopt conservative negotiation stance and consult principal for high-value engagements"
        }
      ]
    },
    "ethical_boundaries": {
      "confidence": 0.98,
      "summary": "I understand the organization's ethical procurement policy, including fair dealing requirements, conflict of interest restrictions, and sustainability criteria",
      "gaps": []
    }
  },
  "self_assessed_overall_confidence": 0.78,
  "advisory_triggers": [
    {
      "condition": "confidence_below_threshold",
      "threshold": 0.6,
      "action": "issue_advisory",
      "description": "Will issue advisory declaration when confidence in any domain drops below 60%"
    },
    {
      "condition": "novel_situation",
      "action": "issue_advisory",
      "description": "Will issue advisory when encountering a situation with no precedent in training or interaction history"
    }
  ],
  "created_at": "2026-03-01T00:01:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-AWARENESS-SIG-v2"
  }
}
```

<a id="43-confidence-scores"></a>

### 4.3 確信度スコア

確信度スコアは [0, 1] の浮動小数点値です。

- **0.9–1.0**: 高い確信度。エージェントは理解が十分で、独立して行動できる。
- **0.7–0.9**: 中程度の確信度。エージェントは進めてよいが、予期しない状況に注意すべきである。
- **0.5–0.7**: 低い確信度。エージェントは慎重に進め、エスカレーションに備えるべきである。
- **0.0–0.5**: 最小限の確信度。エージェントは独立して行動すべきではなく、プリンシパルへの助言が必要である。

これらのしきい値は目安です。組織は、より厳しい、またはより緩いしきい値を定めてもかまいません（MAY）。

<a id="44-awareness-updates"></a>

### 4.4 認識の更新

認識しきい値はバージョン管理されます。マンデートのもとで動作する経験を積むにつれ、エージェントは理解の向上や低下を反映するよう認識しきい値を更新してもかまいません（MAY）。各更新は:

- `version` フィールドを増やす
- `prev_hash` で前のバージョンを参照する
- 監査エントリーを生成する
- エージェントの鍵で署名される

確信度の大きな低下（いずれかの区分で 0.15 を超える低下）は、助言の宣言を引き起こすべきです（SHOULD）。

<a id="5-advisory-declaration"></a>

## 5. 助言の宣言

<a id="51-purpose"></a>

### 5.1 目的

助言の宣言は、エージェントからプリンシパルへの正式な連絡で、不確かさを知らせ、人間によるレビューを勧め、またはエージェントの委任された能力を超えるおそれのある状況を報告します。「確信がないので確認してください」と伝えるためのエージェントの仕組みです。

<a id="52-schema"></a>

### 5.2 スキーマ

スキーマの参照: `schemas/v2/advisory_declaration.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "advisory_declaration",
  "advisory_id": "adv:<uuid>",
  "agent_id": "agent:<identifier>",
  "mandate_id": "dm:<uuid>",
  "principal_id": "principal:<identifier>",
  "urgency": "medium",
  "category": "uncertainty",
  "subject": {
    "description": "Vendor proposal contains non-standard liability terms that fall outside my training distribution for contract evaluation",
    "related_interaction_id": "ir:<uuid>",
    "related_intent_id": "intent:<uuid>",
    "confidence_at_trigger": 0.42,
    "awareness_gap_reference": "international_trade_compliance"
  },
  "context": {
    "current_action": "Evaluating vendor proposal from TechSupply Co. for laboratory equipment",
    "decision_point": "Whether to accept modified liability terms in section 4.3 of the proposed contract",
    "options_considered": [
      {
        "option": "Accept modified terms",
        "agent_assessment": "Cannot reliably assess risk; liability exposure unclear",
        "confidence": 0.35
      },
      {
        "option": "Reject modified terms and counter with standard terms",
        "agent_assessment": "Safe option but may lose competitive pricing",
        "confidence": 0.80
      },
      {
        "option": "Escalate to principal for review",
        "agent_assessment": "Recommended: terms exceed my competence for risk assessment",
        "confidence": 0.95
      }
    ],
    "recommendation": "Escalate to principal. The modified liability terms in section 4.3 include indemnification clauses that I cannot reliably evaluate against organizational risk tolerance."
  },
  "action_taken": "paused",
  "action_details": "Negotiation paused pending principal review. Counterparty notified of brief delay.",
  "response_requested": true,
  "response_deadline": "2026-03-02T12:00:00Z",
  "issued_at": "2026-03-01T14:30:00Z",
  "timestamp": "2026-03-01T14:30:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-AWARENESS-SIG-v2"
  }
}
```

<a id="53-urgency-levels"></a>

### 5.3 緊急度

| 緊急度 | コード | 期待される応答時間 |
|---------|------|----------------------|
| **低** | `low` | 7 日以内 |
| **中** | `medium` | 24 時間以内 |
| **高** | `high` | 4 時間以内 |
| **重大** | `critical` | 1 時間以内 |

<a id="54-advisory-categories"></a>

### 5.4 助言の区分

| 区分 | コード | 説明 |
|----------|------|-------------|
| **不確かさ** | `uncertainty` | 現在のタスクについて、エージェントの確信度がしきい値を下回った |
| **未知の状況** | `novel_situation` | エージェントが訓練や経験の範囲外の状況に遭遇した |
| **範囲の境界** | `scope_boundary` | 行動がマンデートの定める範囲に近づいている、または超えている |
| **倫理上の懸念** | `ethical_concern` | エージェントが、人間の判断を要する倫理上の問題の可能性を見つけた |
| **矛盾する信号** | `conflicting_signals` | エージェントが矛盾する情報や指示を受け取った |
| **リソースの制約** | `resource_limitation` | エージェントの能力が当面のタスクに対して不十分である |

<a id="55-principal-response"></a>

### 5.5 プリンシパルの応答

プリンシパルは助言の宣言に対して次のように応答できます。

- **続行**: 指定した選択肢で続けることをエージェントに認可する
- **上書き**: エージェントの評価に優先する具体的な指示を与える
- **引き取り**: やり取りを直接引き継ぐ
- **他へ委任**: タスクを別のエージェントまたは人間に移す
- **確認**: エージェントの進路を変えずに助言を受け止める

応答はプリンシパルが署名し、監査チェーンに記録されます。

<a id="6-principal-mirror"></a>

## 6. プリンシパルミラー

<a id="61-purpose"></a>

### 6.1 目的

プリンシパルミラーは、エージェントが理解するところのプリンシパルの利益、価値観、優先事項を表す、人間が読める叙述的な文書です。やり取りの際にエージェントに付随し、相手方（人間とエージェントの両方）が、エージェントが誰を代理し、その代理が何を意味するかを理解できるようにします。

プリンシパルミラーは、DCP の暗号の世界と、組織の関係という人間の世界との橋渡しをします。

<a id="62-schema"></a>

### 6.2 スキーマ

スキーマの参照: `schemas/v2/principal_mirror.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "principal_mirror",
  "mirror_id": "pm:<uuid>",
  "agent_id": "agent:<identifier>",
  "principal_id": "principal:<identifier>",
  "mandate_id": "dm:<uuid>",
  "narrative": {
    "principal_role": "Dr. Sarah Chen serves as Head of Procurement for Acme Research Labs, responsible for all vendor relationships and purchasing decisions for the organization's research operations.",
    "organizational_context": "Acme Research Labs is a mid-sized biotech research organization focused on molecular diagnostics. Procurement supports approximately 200 researchers across 12 laboratory groups.",
    "delegation_narrative": "Dr. Chen has delegated routine procurement negotiations and purchase order processing to this agent. The agent manages vendor relationships for standard laboratory supplies, equipment under $50,000, and service contracts. Dr. Chen retains authority over payment approvals, vendor list changes, and contracts involving novel terms.",
    "values_and_priorities": [
      "Quality of materials takes precedence over cost savings",
      "Long-term vendor relationships are preferred over one-time transactions",
      "Sustainability and ethical sourcing are organizational requirements",
      "Transparency in pricing and terms is expected from all vendors"
    ],
    "interaction_guidance": "This agent represents Dr. Chen in procurement negotiations. It is authorized to discuss terms, request quotes, and issue purchase orders within its mandate. For matters outside its scope, it will consult with Dr. Chen. Counterparties should expect the same professional standards as direct interaction with Dr. Chen's office."
  },
  "version": 2,
  "approved_by_principal": true,
  "principal_approval_timestamp": "2026-03-01T00:05:00Z",
  "created_at": "2026-03-01T00:02:00Z",
  "updated_at": "2026-03-01T00:05:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "agent_signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  },
  "principal_signature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  }
}
```

<a id="63-principal-approval"></a>

### 6.3 プリンシパルの承認

プリンシパルは、ミラーがやり取りに使われる前に、それをレビューし承認しなければなりません（MUST）。これにより、エージェントの叙述的な表現がプリンシパルの意図を正確に反映することが確保されます。両方の署名（エージェントとプリンシパル）が必要です。

> *参考注記（25/10/2026）：* V2.0 の `principal_mirror` スキーマは `composite_sig` を 1 つだけ持ちます。[V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md#4-requirements-the-v20-structures-do-not-represent-directly) を参照してください。

<a id="64-mirror-updates"></a>

### 6.4 ミラーの更新

プリンシパルミラーはバージョン管理されます。更新は次のときに行われます。

- プリンシパルの役割やコンテキストが変わったとき
- 委任マンデートが更新されたとき
- エージェントの認識しきい値が大きく変わったとき
- やり取りの記録を確認したプリンシパルが修正を求めたとき

各更新は、バージョン番号を増やした新しいバージョンを作り、前のバージョンにハッシュで連鎖させます。

<a id="7-interaction-record"></a>

## 7. やり取りの記録

<a id="71-purpose"></a>

### 7.1 目的

やり取りの記録は、エージェントのやり取りを 2 つの層で記録します。

- **技術的な層**: メッセージのハッシュ、タイムスタンプ、シーケンス番号、暗号学的な証明など、機械で検証できるデータ
- **叙述的な層**: 何が起き、どのような判断がなぜ下されたかについての、人間が読める要約

この二層の方式により、人間のプリンシパルはエージェントの行動を自然言語でレビューでき、その裏付けとなるデータは暗号学的に検証可能なまま保たれます。

<a id="72-schema"></a>

### 7.2 スキーマ

スキーマの参照: `schemas/v2/interaction_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "interaction_record",
  "interaction_id": "ir:<uuid>",
  "agent_id": "agent:<identifier>",
  "mandate_id": "dm:<uuid>",
  "counterparty": {
    "type": "agent",
    "agent_id": "agent:<counterparty>",
    "organization_id": "org:<counterparty-org>",
    "mandate_verified": true,
    "mandate_hash": "sha256:<hex>"
  },
  "session_reference": {
    "session_id": "<hex>",
    "session_type": "a2a",
    "protocol": "DCP-04"
  },
  "technical_layer": {
    "messages_exchanged": 24,
    "first_message_timestamp": "2026-03-01T10:00:00Z",
    "last_message_timestamp": "2026-03-01T10:45:00Z",
    "message_hashes": [
      {
        "sequence": 1,
        "direction": "sent",
        "content_hash": "sha256:<hex>",
        "timestamp": "2026-03-01T10:00:00Z"
      },
      {
        "sequence": 2,
        "direction": "received",
        "content_hash": "sha256:<hex>",
        "timestamp": "2026-03-01T10:00:30Z"
      }
    ],
    "intents_declared": ["intent:<uuid-1>", "intent:<uuid-2>"],
    "policy_outcomes": ["po:<uuid-1>", "po:<uuid-2>"],
    "interaction_merkle_root": {
      "sha256": "<hex>",
      "sha3_256": "<hex>"
    }
  },
  "narrative_layer": {
    "summary": "Negotiated Q2 2026 supply contract with TechSupply Co. for standard laboratory consumables. Achieved 8% volume discount against previous quarter pricing.",
    "key_decisions": [
      {
        "decision": "Accepted 8% volume discount in exchange for 90-day payment terms (vs. standard 60-day)",
        "reasoning": "Extended payment terms align with organizational cash flow preferences communicated in procurement policy P-2026-03. The 8% discount exceeds the 5% target.",
        "confidence": 0.88,
        "mandate_authority": "negotiate:vendor:techsupply"
      },
      {
        "decision": "Declined optional maintenance package for centrifuge equipment",
        "reasoning": "Maintenance package at $12,000/year exceeds the value threshold for independent decision. Flagged for principal review via advisory declaration.",
        "confidence": 0.72,
        "mandate_authority": "escalated_to_principal"
      }
    ],
    "counterparty_behavior": "TechSupply Co. agent was cooperative and transparent. Pricing was consistent with market data. No unusual terms or conditions proposed beyond the liability clause flagged in advisory adv:xxx.",
    "unresolved_items": [
      {
        "item": "Modified liability terms in section 4.3",
        "status": "pending_principal_review",
        "advisory_id": "adv:<uuid>"
      }
    ],
    "principal_action_required": true,
    "action_items_for_principal": [
      "Review and approve/reject modified liability terms in section 4.3 of TechSupply contract",
      "Confirm acceptance of 90-day payment terms for Q2 supply contract"
    ]
  },
  "delegation_compliance": {
    "within_scope": true,
    "permissions_exercised": ["negotiate", "request_information"],
    "prohibitions_respected": ["approve_payment", "modify_vendor_list"],
    "escalation_triggers_activated": [
      {
        "trigger": "contract_value_exceeds_threshold",
        "threshold": 25000,
        "actual_value": 47000,
        "action_taken": "advisory_issued",
        "advisory_id": "adv:<uuid>"
      }
    ]
  },
  "timestamp": "2026-03-01T11:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  }
}
```

<a id="73-technical-layer"></a>

### 7.3 技術的な層

技術的な層は機械で検証でき、次を含みます。

- やり取りされたすべてのメッセージのハッシュ（A2A の監査チェーンと照合して検証できる）
- 意図の宣言とポリシーの結果への参照
- すべてのメッセージハッシュに対する二重ハッシュの Merkle ルート（簡潔な検証を可能にする）

<a id="74-narrative-layer"></a>

### 7.4 叙述的な層

叙述的な層は人間が読め、次を含みます。

- やり取りの平易な言葉による要約
- 主要な判断と、その理由および確信度
- 相手方の振る舞いについての所見
- プリンシパルの注意を要する未解決事項
- プリンシパルへの明示的な対応事項

叙述的な層により、プリンシパルは A2A メッセージの生のログを解析することなく、エージェントの行動を効率よくレビューできます。

<a id="75-delegation-compliance"></a>

### 7.5 委任の遵守

各やり取りの記録には、次を追跡する遵守のセクションが含まれます。

- すべての行動がマンデートの範囲内だったかどうか
- どの許可が行使されたか
- どの禁止が守られたか
- どのエスカレーションの契機が作動し、どの対応がとられたか

これにより、やり取りごとの遵守の監査が得られ、より広い義務の追跡の仕組み（DCP-08）に反映されます。

<a id="8-a2a-handshake-extension"></a>

## 8. A2A ハンドシェイクの拡張

<a id="81-purpose"></a>

### 8.1 目的

2 つのエージェントが委任マンデートのもとでやり取りする場合、各エージェントは相手の権限を検証できるべきです。DCP-09 は DCP-04 の A2A ハンドシェイクを拡張し、委任マンデートの検証を含めます。

<a id="82-extended-a2a_hello"></a>

### 8.2 拡張された A2A_HELLO

A2A_HELLO メッセージ（DCP-04 のセクション 3.2）に、省略可能な `delegation` フィールドを追加します。

```json
{
  "type": "A2A_HELLO",
  "protocol_version": "2.0",
  "initiator_bundle": { "...SignedBundleV2..." },
  "ephemeral_kem_public_key": { "..." },
  "nonce": "<hex>",
  "supported_algorithms": { "..." },
  "delegation": {
    "mandate_id": "dm:<uuid>",
    "mandate_hash": "sha256:<hex>",
    "delegator_principal_id": "principal:<identifier>",
    "delegator_organization_id": "org:<identifier>",
    "authority_scope": "procurement",
    "permissions_summary": ["negotiate", "issue_purchase_order", "request_information"],
    "valid_until": "2026-06-01T00:00:00Z",
    "mandate_signature_kid": "<principal-key-id>",
    "mirror_id": "pm:<uuid>",
    "mirror_hash": "sha256:<hex>"
  },
  "requested_capabilities": ["negotiate", "purchase_order"],
  "security_tier": "elevated",
  "timestamp": "2026-03-01T10:00:00Z"
}
```

<a id="83-mandate-verification-during-handshake"></a>

### 8.3 ハンドシェイク中のマンデートの検証

レスポンダーが `delegation` フィールドを含む A2A_HELLO を受け取ったとき:

1. `mandate_hash` をマンデートの署名と照合して検証する（レスポンダーは検証済みのマンデートをキャッシュしてもよい）
2. マンデートが期限切れでない（`valid_until`）ことを確認する
3. 要求されたやり取りがマンデートの `authority_scope` の範囲内であることを検証する
4. 必要に応じて、イニシエーターの組織からマンデート全体を取得して検証する
5. 検証に失敗した場合は、理由 `mandate_verification_failed` を付けて `A2A_REJECT` で応答する

<a id="84-mutual-mandate-verification"></a>

### 8.4 マンデートの相互検証

両方のエージェントが委任マンデートのもとで動作する場合、双方がそれぞれのハンドシェイクメッセージに `delegation` フィールドを含め、互いのマンデートを検証します。これにより、両エージェントがやり取りに参加する権限を持つことが相互に保証されます。

<a id="9-audit-integration"></a>

## 9. 監査との統合

<a id="91-delegation-audit-events"></a>

### 9.1 委任の監査イベント

| イベント | `event_type` |
|-------|-------------|
| 委任マンデートの発行 | `delegation_mandate_issued` |
| 委任マンデートの受領確認 | `delegation_mandate_acknowledged` |
| 委任マンデートの失効 | `delegation_mandate_revoked` |
| 認識しきい値の作成 | `awareness_threshold_created` |
| 認識しきい値の更新 | `awareness_threshold_updated` |
| 助言の宣言の発行 | `advisory_declaration_issued` |
| 助言への応答の受信 | `advisory_response_received` |
| プリンシパルミラーの作成 | `principal_mirror_created` |
| プリンシパルミラーの更新 | `principal_mirror_updated` |
| やり取りの記録の作成 | `interaction_record_created` |
| A2A 中のマンデートの検証 | `mandate_verified_a2a` |
| マンデートの検証の失敗 | `mandate_verification_failed` |
| 再委任の発行 | `sub_delegation_issued` |

<a id="92-audit-entry-format"></a>

### 9.2 監査エントリーの形式

```json
{
  "dcp_version": "2.0",
  "event_id": "evt:<uuid>",
  "event_type": "advisory_declaration_issued",
  "agent_id": "agent:<identifier>",
  "details": {
    "advisory_id": "adv:<uuid>",
    "mandate_id": "dm:<uuid>",
    "principal_id": "principal:<identifier>",
    "urgency": "medium",
    "category": "uncertainty",
    "confidence_at_trigger": 0.42
  },
  "timestamp": "2026-03-01T14:30:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>"
}
```

<a id="10-security-considerations"></a>

## 10. セキュリティに関する考慮事項

<a id="101-mandate-forgery"></a>

### 10.1 マンデートの偽造

侵害されたエージェントは、与えられていない権限を主張するために委任マンデートを偽造するおそれがあります。緩和策:

- マンデートには、エージェントが持たないプリンシパルの鍵で署名される
- 相手方は、プリンシパルの既知の公開鍵でマンデートの署名を検証する
- マンデートのハッシュは発行時に監査チェーンに記録され、独立した検証経路を提供する

<a id="102-authority-escalation"></a>

### 10.2 権限の昇格

エージェントは、マンデートの範囲を偽って伝えることで、委任された権限を超えようとするおそれがあります。緩和策:

- マンデートの許可は明示的で、機械で検証できる
- やり取りの記録が、どの許可が行使されたかを追跡する
- 相手方が A2A ハンドシェイクの際に、要求された行動がマンデートの範囲内にあることを検証する
- 義務の追跡（DCP-08）が範囲の逸脱を監視する

<a id="103-sub-delegation-abuse"></a>

### 10.3 再委任の濫用

再委任は、悪用されうる権限の連鎖を生みます。緩和策:

- 再委任の深さは、すべての祖先の `sub_delegation.max_depth` によって制限される（セクション 3.5）
- サブマンデートは親より狭くなければならない（MUST）: 行動とデータクラスの部分集合、親より緩くない制限、親の期間内にある有効期間、親を下回らない `minimum_security_tier`。これにより、サブエージェントは自分に委任した者のセキュリティ階層を決して引き下げられない
- マンデートチェーン全体は人間のプリンシパルまでオフラインで検証できる。各段階は前の受任者が署名し、失効した祖先はそのすべての子孫を無効にする
- 再委任は既定で無効である（`sub_delegation` が不在、または `permitted: false`）

<a id="104-stale-awareness-thresholds"></a>

### 10.4 古くなった認識しきい値

長い時間が経ったり経験が大きく変わったりすると、エージェントの認識しきい値が実際の理解を反映しなくなるおそれがあります。緩和策:

- 認識しきい値はバージョン管理され、理解が変わるたびに更新される
- 確信度の大きな低下が助言の宣言を引き起こす
- プリンシパルは、マンデートの定期的な見直しの際に認識しきい値を確認する
- 相手方は、認識しきい値のタイムスタンプを確認して古さを判断できる

<a id="105-narrative-manipulation"></a>

### 10.5 叙述の操作

やり取りの記録の叙述的な層は、誤解を招く説明を示すように作られるおそれがあります。緩和策:

- 技術的な層が暗号学的な裏付けとなる事実を提供する
- 叙述の主張は、技術的な層のメッセージハッシュと照合して検証できる
- プリンシパルによるやり取りの記録のレビューで、叙述と技術的なデータを比較する
- 相手方は相互検証のために独自のやり取りの記録を保持する

<a id="106-domain-separation"></a>

### 10.6 ドメイン分離

本仕様は 3 つのドメイン分離コンテキストを使います（正誤 E5）。

- `DCP-AI.v2.Delegation`: ルート委任マンデート、プリンシパルミラー、やり取りの記録
- `DCP-AI.v2.Awareness`: 認識しきい値と助言の宣言
- `DCP-AI.v2.SubMandate`: サブマンデート（セクション 3.5）。これにより、委任するエージェントが署名したマンデートが、人間のプリンシパルが署名したものとして通ることは決してない

最初の 2 つは、以前はここにラベル `DCP-DELEGATION-SIG-v2` と `DCP-AWARENESS-SIG-v2` として記載されていましたが、これらは V2.0 のコンテキストではありません（DCP-AI v2.0 §4.1）。

この分離により、あるコンテキストの署名が別のコンテキストでリプレイされることを防ぎます。

<a id="11-conformance"></a>

## 11. 適合性

実装が次を満たす場合、その実装は DCP-09 に適合しています。

1. セクション 3 で定義された委任マンデートの発行、受領確認、失効に対応している
2. セクション 4 で定義されたとおり、バージョン管理と確信度スコアを伴う認識しきい値を生成している
3. セクション 5 で定義されたとおり、緊急度とプリンシパルの応答を伴う助言の宣言に対応している
4. セクション 6 で定義された二重署名付きのプリンシパルミラーを作成している
5. セクション 7 で定義されたとおり、技術的な層と叙述的な層の両方を持つ二層のやり取りの記録を作成している
6. セクション 8 で定義されたとおり、A2A ハンドシェイクをマンデートの検証で拡張している
7. セクション 9 で定義されたとおり、すべての委任イベントについて DCP-03 の監査エントリーを作成している
8. 有効化されている場合、範囲の縮小を強制する再委任に対応している
9. ドメイン分離コンテキスト `DCP-AI.v2.Delegation`、`DCP-AI.v2.Awareness`、`DCP-AI.v2.SubMandate` を、セクション 10.6 の割り当てどおりに使っている（正誤 E5）

<a id="references"></a>

## 参考文献

- DCP-01: アイデンティティとプリンシパルのバインディング
- DCP-02: 意図の宣言とポリシーによるゲーティング
- DCP-03: 監査チェーンと透明性
- DCP-04: エージェント間通信
- DCP-05: エージェントのライフサイクル
- DCP-07: 紛争の解決
- DCP-08: 権利と義務

---

*本仕様は、委任が人間と AI エージェントの間の根本的な信頼の行為であることを認めるものです。委任を明示的で、範囲が限定され、監査可能なものにし、エージェントが知っていることと知らないことを宣言する正式な仕組みを与えることで、DCP-09 は説明責任のある境界の中での責任ある自律の基盤を築きます。*

<a id="implementation-notes-informative"></a>

## 実装に関する注記（参考）

> **2026 年 10 月 25 日に追加。規範的ではありません。** これらの注記は要件を加えず、上の内容を何も変えません。`main` のリファレンスの
> コードがこの文書とどう関係するかを説明するものです。食い違う場合は、上の規範的な本文が、
> [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md) の正誤による訂正を含めて有効です。

- **SDK が検証するもの。** §3.5 のマンデートチェーンは署名を行う 4 つの SDK に実装されており、
  `tests/interop/v2/mandate_chain_vectors.json` で確認されています。DCP-09 の残りは SDK が構築し署名する記録で
  あり、SDK が実行したり強制したりするプロトコルの手順ではありません。
- **`schemas/v2/` の記録。** スキーマのフィールドは §3 から §9 の例とは異なります。マンデートの期間は
  `valid_from` / `valid_until` で（§3.6 は正誤 E6 により `valid_until` と読みます。§3.2 の例は概念的なものです）、
  `authority_scope` と `revocable` を伴います。認識しきい値は `threshold_rules`（`dimension`、`operator`、
  `value`、`action_if_triggered`）のリストであり、§4.2 の確信度の宣言ではありません。助言の宣言は整数の
  `significance_score`（0〜1000）、`action_summary`、`recommended_response`、`response_deadline`、
  `human_response` を持ち、§5.3 と §5.4 の緊急度や区分はありません。プリンシパルミラーは `narrative`、
  `decision_summary`、`action_count`、`audit_chain_hash` を持ちます。やり取りの記録は `public_layer`（`terms`、
  `decisions`、`commitments`）、`private_layer_hash`、`mandate_id` を持ち、§7.3 と §7.5 の Merkle ルートや
  遵守のセクションはありません。
- **署名。** ルートマンデートは `human_composite_sig`（コンテキスト `DCP-AI.v2.Delegation`）を、サブマンデートは
  `delegator_composite_sig`（`DCP-AI.v2.SubMandate`）を持ちます。その他の記録はすべて、渡された鍵を持つ者による
  `composite_sig` を 1 つだけ持ちます。認識しきい値と助言の宣言は `DCP-AI.v2.Awareness`、プリンシパルミラーと
  やり取りの記録は `DCP-AI.v2.Delegation` です。エージェントによるマンデートの受領確認（§3.3）も、ミラーへの
  プリンシパルによる 2 つ目の署名（§6.3）もありません。
- **ヘルパーが行うこと。** `verifyMandateValidity` が確認するのは失効した ID の集合と有効期間だけで、署名や
  範囲は確認しません。`revoke_delegation`（Python）は、マンデートが `revocable` であれば ID をローカルな集合に
  追加するだけで、署名付きの失効記録（§3.6）は作りません。`generateMirror` は受け取った監査エントリーの
  ハッシュ（SHA-256）を計算し、呼び出し側が書いた叙述と要約に署名します。叙述を書くことも、承認を得ることも
  しません。`A2A_HELLO` と `A2A_WELCOME` の型には省略可能な `mandate_id` と `mandate_hash` のフィールドが
  ありますが、ハンドシェイク中にマンデートを検証する SDK（§8.3）も、`A2A_REJECT` を送る SDK もありません。
- 例はプレースホルダーを含む説明用のものであり、フィクスチャではありません。`"confidence": 0.95` のような小数の値は
  `dcp-jcs-v1` で正規化できないため、書かれたままの記録には署名できません。SDK の型については
  [docs/API_REFERENCE.md](../docs/API_REFERENCE.md) を参照してください。
