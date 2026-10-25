<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai--a2a-agent-to-agent-protocol-bridge"></a>
<a id="dcp-ai-a2a-agent-to-agent-protocol-bridge"></a>

# DCP-AI ↔ A2A（Agent-to-Agent）プロトコルのブリッジ

> [英語版](README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

署名付きの DCP の Agent Passport を A2A の Agent Card の中に入れて運び、A2A の利用者が、タスクを委任する前に、
パスポートのハッシュと自己署名をオフラインで検証できるようにします。パスポートは責任あるプリンシパルを名指ししますが、
このブリッジはそのプリンシパルの RPR を検証せず、アドミッションも確立しません。また、A2A のタスクを DCP の意図と
監査エントリに対応付けます。

<a id="installation"></a>

## インストール

> **リリースの状況（2026 年 10 月 25 日）。** npm にある `@dcp-ai/google-a2a` 2.0.0 には、Agent Card の中のパスポート（`attachPassportToAgentCard`、`agentCardPassport`、`verifyAgentCardPassport`）がありません。それらは `main` のソース（バージョン 2.1.0、未公開）にあります。ソースのパッケージの `@dcp-ai/sdk` の依存関係は `^2.0.0` で、通常の npm のインストールでは 2.1.1 に解決されます。そのため、下のローカルの SDK での置き換えをせずにこのチェックアウトをビルドすると、古い暗号プロバイダーが使われます。`verifyAgentCardPassport` は SDK の複合署名の関数を使い、完全な検証器 `verifySignedBundleV2` は使いません。

チェックアウトから（このページのバージョン、`main` の SDK を使用）：

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/sdks/typescript && npm install && npm run build
cd ../../integrations/google-a2a && npm install
npm install --no-save --package-lock=false --ignore-scripts --install-links ../../sdks/typescript
npm run build
# then, in your project:
npm install /path/to/dcp-ai/integrations/google-a2a
```

公開されたバージョン（2.0.0）：

```bash
npm install @dcp-ai/google-a2a
```

<a id="the-passport-inside-the-agent-card"></a>

## Agent Card の中のパスポート

A2A では、Agent Card が `capabilities.extensions`（`AgentExtension`：`uri`、`description`、`required`、`params`）で拡張を
宣言できます。DCP のパスポートの拡張は、URI が `https://dcp-ai.org/a2a/extensions/passport/v2` で、エージェントの
`SignedPayload<AgentPassportV2>`（DCP-01）を `params.passport` に入れて運びます。これは、エージェントが自ら列挙する
Ed25519 + ML-DSA-65 の鍵で署名したパスポートで、Responsible Principal Record への `principal_binding_reference` を
持ちます。ワイヤ形式に新しいものはありません。

```typescript
// Fragment: signedPassport is your agent's SignedPayload<AgentPassportV2>
import { passportToAgentCard, verifyAgentCardPassport, agentCardToPassport } from '@dcp-ai/google-a2a';

// Publisher: the signed passport (as produced by the DCP SDK or @dcp-ai/openclaw) goes into the card.
const card = passportToAgentCard(signedPassport, 'https://my-agent.example.com/a2a');

// Consumer: check passport consistency; trust and endpoint possession require the steps below.
const check = await verifyAgentCardPassport(card);
if (!check.verified) throw new Error(check.errors.join('; '));
check.passport.agent_id; // the verified DCP agent
```

<a id="what-verification-proves-and-what-it-does-not"></a>

### 検証が証明すること、しないこと

`verifyAgentCardPassport` は、拡張が存在すること、`payload_hash` が一致すること、複合署名が `pq_over_classical`
（Ed25519 と ML-DSA-65 または SLH-DSA-192f、各枠はそのアルゴリズムに固定）で、パスポート自身が列挙する鍵（有効で、
期限切れでなく、各 `kid` がその公開鍵のハッシュであるもの）によって AgentPassport のコンテキストで検証できること、
タイムスタンプが RFC 3339 のパターンに合い、`Date.parse` で解析できること（暦の完全な確認ではなく、2 月 30 日のようなありえない日付の一部は正規化されて通ります）、パスポートが `active` であること、そして `metadata.dcp_agent_id` と、指定された
場合の `expectedAgentId` が同じエージェントを指すことを確認します。これらの列挙した確認のいずれかに通らないカードは
拒否されます。これはパスポートの JSON Schema による完全な検証ではないため、これらの確認の外にあるフィールドは
検証されません。

パスポートは公開されており、誰でも自分のカードにコピーできます。そのため、`verified` の結果だけで証明されるのは、
パスポートが**それ自体として一貫している**こと、つまり列挙された鍵で署名されていることです。カードを提供している者が
それらの鍵を持っていることも、`url`、`name`、`provider`、`skills` がパスポートのエージェントのものであることも証明しません。
これを身元の確認にするには：

- `trustedKeys` を渡してください。そのエージェントについてすでに信頼している鍵（レジストリ、固定した以前のパスポート、
  またはプリンシパルがエージェントのために署名する場合に、バンドルの外でアンカーしているプリンシパルの RPR の
  `binding_keys`。RPR に有効な署名があるだけでは、それを信頼する理由にはなりません）と
  `expectedAgentId` です。両方の署名鍵がその中になければならず、信頼するエントリ自体も `active` で期限切れでない
  必要があります（あなたの鍵の記録がパスポートのコピーより優先されます）。そのとき、結果は `anchored: true` になります。`anchored` は `trustedKeys` が渡されたことを示すだけで、検証に失敗した場合でもそうなります。アンカーした確認には `verified && anchored` を求めてください。
- エージェントの身元としては、カードの署名のないフィールドではなく、`result.passport` だけを使ってください。
- タスクを委任する前に、エンドポイントに保有の証明を求めてください。SDK の `generateRegistrationPoP` /
  `verifyRegistrationPoP`、または DCP-04 の A2A のセッションです。
  `verifyRegistrationPoP` が確認するのは、渡されたチャレンジに対する署名だけです。あなた自身のプロトコルで、検証者から
  新しく予測できない nonce を発行し、その有効期限と一回限りの使用を強制し、それを kid、エージェント、エンドポイントに
  結び付けなければなりません。エンドポイントが自ら送ってきた、または再利用した PoP を信頼しないでください。A2A 1.0 の
  `AgentCard.signatures`（カードに対する JWS）は、カードの残りの部分を結び付けるためのプロトコル自身の方法ですが、この
  ブリッジはそれを実装していません。

`attachPassportToAgentCard(card, signedPassport)` は、すでにあるカードに拡張を加え（以前の DCP のパスポートを置き換え）、
`agentCardPassport(card)` はそれを読み、`agentCardToPassport(card)` は、カードがパスポートを持つ場合、骨組みの代わりに
そのパスポートを返します。

<a id="supported-dcp-specifications"></a>

## サポートする DCP の仕様

DCP-01 から DCP-09。部分的な対応付け（以下の関数）であり、これらの仕様の完全な実装ではありません。

<a id="overview"></a>

## 概要

Google の A2A プロトコルは、エージェントの発見と通信のための標準を定めています。このブリッジは、DCP の身元と監査の概念を A2A のプリミティブに対応付けます。

- **Agent Passport ↔ Agent Card** — 上記の信頼と保有の証明の制限のもとで、発見可能な A2A の Agent Card で DCP のパスポートを運びます。
- **A2A のタスク → DCP の意図** — ポリシーの評価と監査の記録のために、受け取った A2A のタスクの要求を DCP の意図に変換します。
- **監査の包み込み** — 追跡可能性のために、A2A のタスクの実行に DCP の監査エントリを付けます。

<a id="functions"></a>

## 関数

| 関数 | 方向 | 説明 |
|---|---|---|
| `passportToAgentCard(passport, endpoint)` | DCP → A2A | Agent Passport（署名付きまたは素のもの）を A2A の Agent Card に変換する。署名付きのものは DCP の拡張に入れて運ぶ |
| `attachPassportToAgentCard(card, signedPassport)` | DCP → A2A | 既存のカードの `capabilities.extensions` に署名付きのパスポートを入れる |
| `agentCardPassport(card)` | A2A → DCP | カードが運ぶ署名付きのパスポート（あれば） |
| `verifyAgentCardPassport(card, options?)` | A2A → DCP | 運ばれているパスポートをオフラインで検証する |
| `agentCardToPassport(card)` | A2A → DCP | 運ばれているパスポート、またはそれのないカードについては骨組み |
| `wrapA2ATaskWithAudit(task, agentId, intentId)` | A2A + DCP | タスクを DCP の監査エントリで包む |
| `a2aTaskToIntent(task, agentId)` | A2A → DCP | タスクの要求を DCP の意図に変換する |
| `addMandateToA2AHandshake(handshake, mandate)` | DCP → A2A | DCP-09 のマンデートを A2A のハンドシェイクに挿入する |
| `createLifecycleNotification(agentId, event, details)` | DCP → A2A | ライフサイクルのイベント（DCP-05）の A2A の通知を作る |

<a id="agent-card-metadata"></a>

## Agent Card のメタデータ

DCP のメタデータは、Agent Card の `metadata` フィールドに埋め込まれます。

```json
{
  "dcp_agent_id": "agent:uuid",
  "dcp_version": "2.0",
  "dcp_security_tier": "standard",
  "dcp_owner_rpr_hash": "sha256:...",
  "dcp_lifecycle_state": "active",
  "dcp_mandate_id": null
}
```

これらのフィールドは署名のないカードのデータです。`dcp_security_tier` は常に `"standard"`（計算されません）で、`dcp_owner_rpr_hash` は、パスポートの `owner_rpr_hash`、V2 のパスポートの場合はその `principal_binding_reference`（RPR の `human_id` で、ハッシュではありません）を持ちます。発見の助けにはなりますが、身元は検証済みのパスポート（`result.passport`）からしか得られません。

<a id="usage"></a>

## 使い方

```javascript
// Fragment: myPassport and incomingTask come from your application
import { passportToAgentCard, a2aTaskToIntent } from '@dcp-ai/google-a2a';

// Publish a DCP agent as an A2A Agent Card
const card = passportToAgentCard(myPassport, 'https://my-agent.example.com/a2a');

// Convert an incoming A2A task to a DCP Intent
const intent = a2aTaskToIntent(incomingTask, 'agent:my-agent-id');
```

<a id="notes"></a>

## 注記

- Agent Card の `authentication.schemes` は、このエージェントが DCP のバンドルによる認証を使うことを示すために `['dcp-bundle']` に設定されます。
- パスポートの skills は DCP の能力から導出され、人が読める名前にするためにアンダースコアが空白に置き換えられます。
- DCP の拡張のないカードの骨組みへの変換（A2A → DCP）は部分的な記録を生成し、使う前に鍵の生成と署名が必要です。
- このブリッジが書くカードのフィールド（`authentication`、`metadata`、…）は A2A 1.0 より前のもので、A2A 1.0 のカードは `supportedInterfaces` と `securitySchemes` を使います。`capabilities.extensions` は両方で有効です。カードの残りを A2A 1.0 に合わせるのは別の変更です。
