<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="dcp-reference-gateway"></a>

# DCP のリファレンスゲートウェイ

> [英語版](README.md)の参考訳です（26/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

Digital Citizenship Protocol の V1、V2、フェーズ 3（PQ 優先）を実装する HTTP の検証サービスです。**メモリ上のストレージ**：外部のデータベースは不要で、再起動の後には何も残りません（[永続化](#persistence)を参照）。どの第三者でも運用できるように設計されており、プロトコルは中央のサーバーを必要としません。

<a id="quick-start"></a>

## クイックスタート

チェックアウトのルートから実行します。`@dcp-ai/sdk` 2.2.0 は npm で公開済みですが、ルートはそのソースをテストするため意図的にワークスペース SDK に依存しています。先にビルドしてください。

```bash
(cd sdks/typescript && npm install && npm run build)
npm install
node server/index.js
# or: npm run server
```

既定のポート：`3000`。`PORT=4000 node server/index.js` で変更できます。管理用のエンドポイントを使い、新しいエージェントを登録するには `OPERATOR_TOKEN` を設定してください。

<a id="endpoints"></a>

## エンドポイント

<a id="core"></a>

### コア

| メソッド | パス | 説明 |
|--------|------|-------------|
| GET | `/` , `/health` | ヘルスチェック：`{ ok, service, supported_versions, registered_agents, registered_keys }` |
| GET | `/.well-known/dcp-capabilities.json` | プロトコルのケイパビリティの発見（アルゴリズム、機能、ワイヤ形式）。サーバーが宣伝している内容であり、確認済みの保証ではありません。`hsm_provider: true` と `application/cbor` を挙げていますが、HSM はなく、ボディは JSON としてしか読みません |
| POST | `/verify` | 署名付きバンドルを検証する（V1 か V2 かを自動判別し、V2 は `VERIFIER_POLICY` に照らして確認） |
| POST | `/v2/admit` | オペレーターが信頼するプリンシパルに対するアドミッション、設定されていれば strict-v1 も（`docs/ADMISSION.md`）。ボディからは `signed_bundle` だけを読みます。未設定なら 501 |
| POST | `/anchor` | スタブ：501 を返す（オペレーターごとに実装） |

<a id="v2-identity--intent"></a>
<a id="v2-identity-intent"></a>

### V2：身元と意図

| メソッド | パス | 説明 |
|--------|------|-------------|
| POST | `/v2/passport/register` | 自己署名のエージェントのパスポートを登録する。新しい `agent_id` にはオペレーターのトークンが必要（[信頼モデル](#trust-model)を参照） |
| POST | `/v2/intent/declare` | 登録済みのエージェントの意図を宣言し、サーバーの（署名のない）ポリシー判断を受け取る。意図の `composite_sig` は検証されません |
| POST | `/v2/audit/append` | エージェントのチェーンに監査イベントを追加する |
| POST | `/v2/audit/compact` | マークルの要約で監査チェーンを圧縮する |
| POST | `/v2/bundle/verify` | V2 のバンドルの完全な検証：スキーマ、マニフェスト、Ed25519 + ML-DSA-65 の複合署名、セッションの結び付け、監査チェーン（`lib/verify.js` と `@dcp-ai/sdk` による）を `VERIFIER_POLICY` に照らして確認。V1 のバンドルには 400 |

<a id="v2-key-management"></a>

### V2：鍵の管理

| メソッド | パス | 説明 |
|--------|------|-------------|
| GET | `/v2/keys/:kid` | 決定的な鍵 ID で鍵を検索する |
| POST | `/v2/keys/rotate` | 鍵のローテーション：新しい鍵による保有の証明と、古い鍵による認可 |
| POST | `/v2/emergency-revoke` | 緊急失効（パニックボタン） |

<a id="v2-multi-party--governance"></a>
<a id="v2-multi-party-governance"></a>

### V2：マルチパーティとガバナンス

| メソッド | パス | 説明 |
|--------|------|-------------|
| POST | `/v2/multi-party/authorize` | M-of-N のマルチパーティ承認。署名は登録済みの当事者の鍵で確認されます |
| POST | `/v2/governance/register` | ガバナンスの鍵セットを登録する（**オペレーター**） |
| GET | `/.well-known/governance-keys.json` | 公開されたガバナンスの鍵 |

<a id="phase-3-policy--advisories"></a>
<a id="phase-3-policy-advisories"></a>

### フェーズ 3：ポリシーとアドバイザリー

| メソッド | パス | 説明 |
|--------|------|-------------|
| GET | `/v2/policy` | 現在の検証器のポリシー（モード、アルゴリズム、制約） |
| POST | `/v2/policy/mode` | 検証器のモードを切り替える（`classical_only`、`hybrid_preferred`、`hybrid_required`、`pq_only`）（**オペレーター**） |
| GET | `/.well-known/algorithm-advisories.json` | 公開されたアルゴリズムのアドバイザリー |
| POST | `/v2/advisory/publish` | スキーマで検証したアルゴリズムのアドバイザリーを公開する。最大 1000 件（**オペレーター**） |
| GET | `/v2/advisory/check` | 特定のアルゴリズムが影響を受けるかを確認する |
| POST | `/v2/advisory/auto-apply` | アドバイザリーを検証器のポリシーに自動適用する（**オペレーター**） |

**オペレーター**のエンドポイントは、検証器の信頼の設定を変更します。`Authorization: Bearer <OPERATOR_TOKEN>` が必要で、
そうでなければ 401 を返します。`OPERATOR_TOKEN` が設定されていなければロックされたままです。

<a id="dcp-05-to-dcp-09"></a>

### DCP-05 から DCP-09

ライフサイクル、承継、紛争、権利、委任の記録のための 31 のエンドポイントで、[docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints) に一覧があります。各記録をそのスキーマで検証しますが、**署名は一切検証せず、トークンも不要**で、`OPERATOR_TOKEN` でも保護されません。サーバーに到達できる人なら誰でも、エージェントを廃止または再稼働させ、取り消し可能なマンデートを取り消し、紛争を解決済みにできます。信頼できないクライアントに公開しないでください。

<a id="environment-variables"></a>

## 環境変数

| 変数 | 既定値 | 説明 |
|----------|---------|-------------|
| `PORT` | `3000` | 待ち受ける HTTP のポート |
| `OPERATOR_TOKEN` | — | オペレーターのエンドポイントと、新しい `agent_id` の登録のための Bearer トークン。未設定なら両方ともロックされます |
| `VERIFIER_MODE` | `hybrid_required` | 起動時の検証モード：`classical_only`、`hybrid_preferred`、`hybrid_required`、`pq_only` のいずれか。無効な値ではサーバーが停止します |
| `ALLOW_V1_BUNDLES` | `true` | `false` にすると `POST /verify` が V1 のバンドルを拒否します（`pq_only` では常に拒否） |
| `TRUST_PROXY` | — | クライアントの IP を `X-Forwarded-For` に付け加えるプロキシ（Fly、nginx）の背後でだけ `true`。そのときレート制限はその最後のホップを基準にし、そうでなければソケットのアドレスを基準にします。クライアントはヘッダーを偽造できるからです |
| `REGISTRATIONS_PER_HOUR` | `20` | クライアントごと 1 時間あたりの `POST /v2/passport/register` の呼び出し回数。超えると 429 |
| `MAX_REGISTERED_KEYS` | `10000` | レジストリの鍵の数。それ以降の新しいエージェントとローテーションには 507 が返ります（何も追い出されません） |
| `DCP_TRUSTED_PRINCIPALS_FILE` | — | `POST /v2/admit` の信頼セット（`schemas/v2/principal_trust_set.schema.json`）。アドミッションのたびに読み、内容が変わると読み直します。無効なファイルでは起動時にサーバーが停止し、後で壊れた場合はアドミッションを拒否します（503）。アドミッションの変数を空の値で設定すると、サーバーが停止します |
| `DCP_ADMISSION_PROFILE_FILE` | — | strict-v1 のプロファイル（`schemas/v2/admission_profile.schema.json`）。前後の 2 つの変数が必要で、矛盾があるとサーバーが停止します |
| `DCP_REVOCATION_LIST_URL` | — | strict-v1 のための、失効サービスの `/.well-known/dcp-revocations.json` 形式の完全な拒否リスト：`https`（平文の `http` はループバックのホストだけ）、リダイレクトなし、最大 16 MiB。`DCP_REVOCATION_LIST_AUTHORIZATION` で `Authorization` ヘッダーを設定し、`DCP_REVOCATION_TIMEOUT_MS`（既定 5000）でリクエストの時間を制限します |
| `MAX_KEYS_PER_AGENT` | `64` | エージェントが生涯で登録できる鍵の数。それ以降のローテーションには 409 が返ります。頻繁にローテーションするエージェントでは引き上げてください（引退した鍵ごとに約 100 バイトの墓標がかかります） |

`REQUIRE_SESSION_BINDING`、`REQUIRE_COMPOSITE_BINDING`、`MAX_KEY_AGE_DAYS`、`PQ_CHECKPOINT_INTERVAL`、
`ADVISORY_POLL_INTERVAL_MS` は Docker と Fly の設定に出てきますが、まだ読まれていません。組み込みのポリシー
（`server/index.js` の `VERIFIER_POLICY`：セッションの結び付けと複合バインディングが必須、鍵の経過日数の閾値は 365 日）が適用され、
`GET /v2/policy` で確認できます。

<a id="trust-model"></a>

## 信頼モデル

- **パスポートの登録**では、パスポートの複合の自己署名（`DCP-AI.v2.AgentPassport`、Ed25519 + ML-DSA-65。クラシカルだけの
  署名は `classical_only` / `hybrid_preferred` のモードでのみ受け付けます）を、それが列挙する鍵で検証します。その署名が
  それを作った鍵（クラシカルな鍵と、ある場合は PQ 鍵）の保有を証明し、登録されるのはそれらの鍵だけです。他人の公開鍵を列挙しても何も登録されません。鍵と署名は、
  そのアルゴリズムのサイズちょうどの正規の base64 でなければなりません。
- **新しい** `agent_id` の登録には `Authorization: Bearer <OPERATOR_TOKEN>` が必要です（そうでなければ 401）。パスポートは
  自己署名にすぎず、プリンシパルの RPR も同じなので、信頼のアンカーがなければ、誰でも被害者の `agent_id` を先に名乗り、
  緊急失効させることができてしまいます。そこで、新しいエージェントについてはオペレーターが保証します。それを再登録する
  （たとえば緊急失効トークンを差し替える）には、署名済みのパスポートは公開されており古いものを再送できるため、`VERIFIER_MODE`
  が新しいエージェントに何を許していても、`created_at` が登録済みのものより新しく、かつエージェントの有効な鍵（そのエージェントに
  登録され、失効しておらず、期限切れでないもの）だけで署名されたパスポートが必要です。そうでなければ 409 です。登録済みの鍵の
  エントリはそのまま保持されるため、新しいパスポートで鍵の `expires_at` を延ばすことはできず、トークンのないパスポートでは
  登録済みのトークンが残ります。
- 登録した系統の有効な鍵をすべて失った（たとえば ML-DSA-65 の鍵が期限切れになった）エージェントは、再登録できません。残った
  鍵だけでトークンを差し替えてはならないからです。復旧は、緊急失効トークン（失効させてから新しい `agent_id` を登録する）か、
  オペレーターを通じて行いますが、オペレーター向けの API はまだありません。ほかのエージェントに登録された kid も 409 となり、
  緊急失効したエージェントは再登録できません。
- **鍵のローテーション**は、`@dcp-ai/sdk` の `createKeyRotation` が作る `KeyRotationRecord` を受け取ります。新しい鍵が
  `{old_kid, new_kid, timestamp}` に `DCP-AI.v2.KeyRotation` のもとで署名し（保有の証明）、古い鍵が連署します。古い鍵は有効
  （失効しておらず、期限切れでない）でなければならず、その後は失効したものとして記録されます。
- **マルチパーティ承認**：各当事者は `{operation, operation_payload, party_id, role}` に `DCP-AI.v2.MultiPartyAuth` のもとで
  署名します（`sdks/typescript/src/core/multi-party-auth.ts` の `createPartyAuthorization`。`@dcp-ai/sdk` 2.2.0 はエクスポート
  していません）。当事者は `/v2/passport/register` で登録した身元であり、その署名の kid は、その `party_id` に登録された有効な
  （失効しておらず、期限切れでない）鍵でなければなりません。各当事者は、どの役割で署名しても、`required_parties` に対して
  1 回だけ数えられます。役割は署名者が主張するもので、どこかで照会されるわけではありません。
- **オペレーターのエンドポイント**は `OPERATOR_TOKEN` だけで保護されています。アドバイザリーの `composite_sig` は構造だけを
  確認します。`@dcp-ai/sdk` にはまだ `AlgorithmAdvisory` のコンテキストタグがないため、アドバイザリーはオペレーターが保証します。
- 鍵のレジストリは、`MAX_REGISTERED_KEYS`（10,000）個の鍵を保持すると、古い鍵を追い出す代わりに新しいエージェントと
  ローテーションを拒否します（507）。追い出された `agent_id` は、それを守る履歴を失ってしまうからです（再登録には引き続きオペレーターのトークンが必要ですが、鍵は何でもよくなります）。1 つのエージェントが
  レジストリを埋め尽くさないよう、ローテーションではそのエージェントの引退した鍵のうち直近の 4 つだけを保持し、上限の確認の
  前に最も古いものを外すため、満杯のレジストリでもローテーションは収まります。外された鍵は墓標として残り、`GET /v2/keys/:kid`
  は `key: null` とともに `revoked: true, retired: true` を返し、その鍵は誰も二度と登録できません。エージェントが生涯で登録
  できる鍵は最大 `MAX_KEYS_PER_AGENT`（64）個なので、その墓標の数にも上限があり、それを超えるとローテーションには 409 が
  返ります。登録はクライアントごとにレート制限され（`REGISTRATIONS_PER_HOUR`）、登録されたパスポートからは署名済みの
  パスポート全体ではなく `created_at` だけを保持します。

<a id="usage-examples"></a>

## 使用例

ヘルスチェック、モードの切り替え、ケイパビリティの発見を除き、以下のリクエストはテンプレートです。バンドル、署名、鍵は
プレースホルダー（`...`、`<64 hex>`）なので、そのままでは動かず、作り出した値で埋めてはなりません。

<a id="health-check"></a>

### ヘルスチェック

```bash
curl -s http://localhost:3000/health | jq .
```

<a id="v1-bundle-verification"></a>

### V1 のバンドルの検証

```bash
curl -s -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d '{
    "signed_bundle": {
      "bundle": { ... },
      "signature": { "alg": "ed25519", "sig_b64": "...", "signer": { "public_key_b64": "..." } }
    }
  }'
```

<a id="v2-passport-registration"></a>

### V2 のパスポートの登録

ボディは `AgentPassportV2` の `SignedPayload` で、それが列挙する鍵によって
`compositeSign(registry, DCP_CONTEXTS.AgentPassport, canonicalBytes, keys)` で署名されたものです（SDK で作ったバンドルの
`agent_passport` がこの形です）。

```bash
curl -s -X POST http://localhost:3000/v2/passport/register \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "signed_passport": {
      "payload": {
        "dcp_version": "2.0",
        "agent_id": "agent:research-bot-001",
        "session_nonce": "<64 hex>",
        "keys": [
          { "kid": "<32 hex>", "alg": "ed25519", "public_key_b64": "...", "created_at": "...", "expires_at": null, "status": "active" },
          { "kid": "<32 hex>", "alg": "ml-dsa-65", "public_key_b64": "...", "created_at": "...", "expires_at": null, "status": "active" }
        ],
        "principal_binding_reference": "human:alice-001",
        "capabilities": ["browse"],
        "risk_tier": "low",
        "created_at": "...",
        "status": "active",
        "emergency_revocation_token": "sha256:<64 hex>"
      },
      "payload_hash": "sha256:...",
      "composite_sig": {
        "classical": { "alg": "ed25519", "kid": "<32 hex>", "sig_b64": "..." },
        "pq": { "alg": "ml-dsa-65", "kid": "<32 hex>", "sig_b64": "..." },
        "binding": "pq_over_classical"
      }
    }
  }'
```

レスポンス：201 `{ ok, agent_id, registered_kids }`、400（スキーマや kid の不一致、または正規の base64 でない鍵）、
401（オペレーターのトークンのない新しい `agent_id`）、403（署名が無効、またはエージェントが失効済み）、409（エージェントが
ほかの鍵で登録済み、パスポートが登録済みのものより新しくない、エージェントに登録した系統の有効な鍵がない、または kid が
引退済みかほかのエージェントのもの）、429（レート制限）、507（レジストリが満杯）。

<a id="key-rotation"></a>

### 鍵のローテーション

```bash
# body = createKeyRotation(registry, { oldKid, oldAlg, oldSecretKeyB64, newKid, newAlg,
#                                      newSecretKeyB64, newPublicKeyB64, timestamp, expiresAt })
curl -s -X POST http://localhost:3000/v2/keys/rotate \
  -H "Content-Type: application/json" \
  -d '{
    "old_kid": "<32 hex>",
    "new_key": { "kid": "<32 hex>", "alg": "ed25519", "public_key_b64": "...", "created_at": "...", "expires_at": null, "status": "active" },
    "timestamp": "2026-03-01T00:00:00Z",
    "proof_of_possession": { "alg": "ed25519", "kid": "<new kid>", "sig_b64": "..." },
    "authorization_sig": { "alg": "ed25519", "kid": "<old kid>", "sig_b64": "..." }
  }'
```

<a id="switching-the-verifier-mode-operator"></a>

### 検証器のモードの切り替え（オペレーター）

```bash
curl -s -X POST http://localhost:3000/v2/policy/mode \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "mode": "pq_only" }'
```

<a id="v2-intent-declaration"></a>

### V2 の意図の宣言

ボディは登録済みのエージェントの `IntentV2` の `SignedPayload` です。その `composite_sig` は必要ですが、検証されません。サーバーは自ら意図を採点し、`{ ok, policy_decision, security_tier, verification_mode, checkpoint_interval }` を返します。ポリシー判断には署名がありません（リスク 800 から `block`、500 から `escalate`）。

以下のリクエストは形を示すだけです。送る前に、省略記号とプレースホルダーをあなたの署名付きペイロードに置き換えてください。文字どおりの `{ ... }` の断片は有効な JSON ではありません。

```bash
curl -s -X POST http://localhost:3000/v2/intent/declare \
  -H "Content-Type: application/json" \
  -d '{
    "signed_intent": {
      "payload": {
        "dcp_version": "2.0",
        "intent_id": "intent:...",
        "session_nonce": "<64 hex>",
        "agent_id": "agent:research-bot-001",
        "human_id": "human:alice-001",
        "timestamp": "...",
        "action_type": "api_call",
        "target": { "channel": "api" },
        "data_classes": ["pii"],
        "estimated_impact": "medium",
        "requires_consent": false
      },
      "payload_hash": "sha256:...",
      "composite_sig": { "classical": { ... }, "pq": { ... }, "binding": "pq_over_classical" }
    }
  }'
```

<a id="v2-bundle-verification"></a>

### V2 のバンドルの検証

```bash
curl -s -X POST http://localhost:3000/v2/bundle/verify \
  -H "Content-Type: application/json" \
  -d '{
    "signed_bundle": {
      "bundle": {
        "dcp_bundle_version": "2.0",
        "manifest": { "session_nonce": "...", "rpr_hash": "sha256:...", ... },
        "responsible_principal_record": { "payload": { ... }, "payload_hash": "sha256:...", "composite_sig": { ... } },
        "agent_passport": { ... },
        "intent": { ... },
        "policy_decision": { ... },
        "audit_entries": [ ... ]
      },
      "signature": {
        "hash_alg": "sha256",
        "created_at": "...",
        "signer": { "type": "human", "id": "...", "kids": ["..."] },
        "manifest_hash": "sha256:...",
        "composite_sig": {
          "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
          "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
          "binding": "pq_over_classical"
        }
      }
    },
    "public_key_b64": "..."
  }'
```

形式は `schemas/v2/signed_bundle.schema.json` です。`@dcp-ai/sdk` の `BundleBuilderV2` + `signBundleV2`、または `dcp sign-bundle --composite` で作ってください。`public_key_b64` は任意で、クラシカルな署名者を固定します。規範以前のエンベロープ（最上位の `dcp_version` / `bundle_manifest`）は拒否されます。

<a id="emergency-revocation"></a>

### 緊急失効

秘密値は、パスポートとともに登録された `emergency_revocation_token` の原像です。クライアントの IP ごとに 1 分あたり 5 回までに
制限されています。

```bash
curl -s -X POST http://localhost:3000/v2/emergency-revoke \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent:research-bot-001",
    "revocation_secret": "<64 hex>"
  }'
```

<a id="capability-discovery"></a>

### ケイパビリティの発見

```bash
curl -s http://localhost:3000/.well-known/dcp-capabilities.json | jq .
```

<a id="architecture"></a>

## アーキテクチャ

```
                    ┌──────────────────────────┐
                    │    DCP Reference Gateway  │
                    ├──────────────────────────┤
                    │  V1 Verification          │
                    │  V2 Composite Verification│
                    │  Key Registry (in-memory) │
                    │  Audit Chains (in-memory) │
                    │  Policy Engine (Phase 3)  │
                    │  Advisory System           │
                    │  Governance Keys           │
                    └──────────────────────────┘
```

<a id="limitations"></a>

## 制限

- **メモリ上のストレージ**：すべての状態（パスポート、鍵、監査チェーン、アドバイザリー）は再起動で失われます。[永続化](#persistence)を参照してください。
- **バンドルの検証以外での署名**：バンドルの検証、パスポートの登録、鍵のローテーション、マルチパーティ承認は、本物の Ed25519 と ML-DSA-65 / SLH-DSA の署名を確認します。`/v2/advisory/publish` と `/v2/governance/register` は確認せず（オペレーターのトークンが唯一の保護です）、`/v2/intent/declare`、`/v2/audit/*`、DCP-05 から DCP-09 のエンドポイントも確認しません。これらはトークンも不要です（[DCP-05 から DCP-09](#dcp-05-to-dcp-09) を参照）。
- **アンカリング**：`POST /anchor` は 501 を返します。あなたのブロックチェーン（Ethereum、Bitcoin）または透明性ログを使って実装してください。

<a id="persistence"></a>

## 永続化

ディスクには何も書き込みません。再起動、デプロイ、マシンの停止で、パスポートと鍵のレジストリは消去されます。そのため、
消去の後は登録の履歴がなくなり、オペレーターのトークンを持つ人なら、どの `agent_id` もほかの鍵で再登録でき、緊急失効も忘れられます。そこで `deploy/fly/verification.toml` は、ゼロまで
縮小する代わりに 1 台のマシンを動かし続けます（`min_machines_running = 1`）が、デプロイと再起動では引き続き空の状態から
始まります。本番のデプロイには永続的なストアが必要です。

<a id="deployment"></a>

## デプロイ

- 本番では TLS を備えたリバースプロキシ（nginx、Caddy）の背後で実行し、それがクライアントの IP を `X-Forwarded-For` に付け加える場合にだけ `TRUST_PROXY=true` を設定してください。
- 自動再起動にはプロセスマネージャー（systemd、PM2）を使ってください。
- コンテナでのデプロイについては [Docker のセットアップ](../docker/README.md)を参照してください。

<a id="reference"></a>

## 参考

- [spec/VERIFICATION.md](../spec/VERIFICATION.md) — 規範的な検証のチェックリスト
- [spec/DCP-AI-v2.0.md](../spec/DCP-AI-v2.0.md) — V2 のプロトコル仕様
- [docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md) — オペレーターガイド
