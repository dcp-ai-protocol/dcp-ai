<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai--microsoft-autogen-bridge"></a>
<a id="dcp-ai-microsoft-autogen-bridge"></a>

# DCP-AI ↔ Microsoft AutoGen のブリッジ

> [英語版](README.md)の参考訳です（26/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

Microsoft AutoGen の会話のために、DCP の形をした記録を作ります。DCP の身元を持つエージェントの設定、メッセージの監査エントリ、関数呼び出しの意図、委任マンデートです。

記録は単純なオブジェクトです。**署名はなく、内容のハッシュもハッシュチェーンもありません**。ブリッジは暗号処理を行わず、AutoGen もインポートしません。これらは DCP のスキーマに合わせる必要がある下書きです。たとえば、意図の `action_type: "function_call"` はスキーマの列挙値になく、`session_nonce`、`human_id`、`estimated_impact`、`requires_consent` もありません。DCP の SDK（たとえば TypeScript SDK の `BundleBuilderV2` と `signBundleV2`）で署名し連鎖させても、それだけで規範的なバンドルになるわけではありません。先にスキーマに合わせてください。

<a id="installation"></a>

## インストール

```bash
npm install @dcp-ai/autogen
```

npm の 2.0.1（2026 年 10 月 26 日）は、`main` のソースと同じ `index.js` を持っています。依存関係はありません。

<a id="supported-dcp-specifications"></a>

## サポートする DCP の仕様

DCP-01 から DCP-09。部分的な対応付けであり、記録はこれらの仕様の形に従いますが、ブリッジはそれらを完全には実装していません。

<a id="overview"></a>

## 概要

このブリッジは、マルチエージェントのオーケストレーションのための Microsoft の AutoGen フレームワークと DCP-AI を統合します。次のものを提供します。

- **DCP 対応のエージェントの設定** — AutoGen のエージェントの定義を、DCP の身元、能力、セキュリティティアで拡張します。
- **メッセージの監査** — 渡されたメッセージについて、DCP の形をした監査エントリを作ります。
- **GroupChat のセッション** — 関連付けられた監査証跡のために、共有の DCP のセッションの nonce とともにグループチャットのエージェントをコピーします。
- **関数呼び出しの意図** — AutoGen の関数呼び出しを意図の下書きに変換します。実行前のポリシーの評価とゲートは、あなたが行います。

<a id="functions"></a>

## 関数

| 関数 | 説明 |
|---|---|
| `createDcpAutoGenAgent(config)` | DCP 対応の AutoGen のエージェントの設定を作る |
| `auditAutoGenMessage(message, sender, recipient)` | メッセージの DCP の監査エントリを作る |
| `createDcpGroupChat(agents, config)` | 共有のセッションの nonce を持つ DCP の GroupChat を作る |
| `autoGenFunctionToIntent(functionCall, agentConfig)` | 関数呼び出しを DCP の意図に変換する |
| `delegateGroupChatRole(groupChat, agentConfig, authorityScope)` | GroupChat のエージェントに権限の範囲を委任する（DCP-09） |

<a id="usage"></a>

## 使い方

```javascript
import {
  createDcpAutoGenAgent,
  auditAutoGenMessage,
  createDcpGroupChat,
  autoGenFunctionToIntent,
} from '@dcp-ai/autogen';

// Create DCP-aware agents
const coder = createDcpAutoGenAgent({
  name: 'Coder',
  system_message: 'You write code.',
  capabilities: ['code_generation', 'code_review'],
  security_tier: 'standard',
});

const reviewer = createDcpAutoGenAgent({
  name: 'Reviewer',
  system_message: 'You review code.',
  capabilities: ['code_review'],
  security_tier: 'elevated',
});

// Set up a group chat with shared session nonce
const chat = createDcpGroupChat([coder, reviewer], {
  security_tier: 'elevated',
  max_rounds: 20,
});

// Audit a message exchange
const auditEntry = auditAutoGenMessage(
  { role: 'assistant', content: 'Here is the code...' },
  coder,
  reviewer,
);

// Create an intent before executing a function
const intent = autoGenFunctionToIntent(
  { name: 'execute_code', arguments: { code: 'print("hello")' } },
  coder,
);
```

この例で `auditAutoGenMessage` が受け取るのは、グループチャットのセッションの nonce を持たない元の `coder` と `reviewer`
です。`createDcpGroupChat` は、nonce を持つエージェントのコピーを `chat.agents` に返します。この関数はエントリを返すだけで、
nonce を加えることも、エントリをどこかに保存することもありません。

<a id="security-tier-resolution"></a>

## セキュリティティアの決定

セキュリティティアの異なる 2 つのエージェントがやり取りするとき、監査エントリは 2 つのうち**高い方**のティアを使います。不明なティアは `standard` として扱います。

<a id="notes"></a>

## 注記

- 監査エントリの `content_hash` フィールドは既定で `null` です。メッセージの内容の SHA-256 のハッシュを計算するには、DCP の暗号レイヤーと統合してください。
- セッションの nonce は、GroupChat のすべてのエージェントが共有する、256 ビットのランダムな 16 進数の文字列です。
- 設定は、あなた自身の AutoGen（または Semantic Kernel）のコードが読む単純なオブジェクトで、ブリッジはどちらにも依存しません。
