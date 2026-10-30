<sub>[English](../../../../integrations/anthropic-mcp/README.md) · [中文](../../../zh-CN/integrations/anthropic-mcp/README.md) · [Español](../../../es/integrations/anthropic-mcp/README.md) · **日本語** · [Português](../../../pt-BR/integrations/anthropic-mcp/README.md)</sub>

<a id="dcp-ai--model-context-protocol-mcp-bridge"></a>
<a id="dcp-ai-model-context-protocol-mcp-bridge"></a>

# DCP-AI ↔ Model Context Protocol（MCP）のブリッジ

> [英語版](../../../../integrations/anthropic-mcp/README.md)の参考訳です（28/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

MCP のツール呼び出しに対する DCP の署名付き受領書と、MCP サーバーのための DCP のツールとリソースです。

<a id="installation"></a>

## インストール

**npm 公開済み（2026 年 10 月 26 日）。** `@dcp-ai/anthropic-mcp` 2.1.0 が `latest` で、`@dcp-ai/sdk` `^2.2.0` に依存します。以下で説明する機能は npm から利用できます。

署名付き受領書（`withDcpReceipt`、`createReceiptIdentity`、`verifyDcpReceipt`）を含みます。例には `@modelcontextprotocol/sdk` と `zod` も必要です。別途インストールしてください。

```bash
npm install @dcp-ai/anthropic-mcp@^2.1.0
```

全パッケージのバージョンは [npm リリース一覧](../../../../docs/NPM_RELEASES.md)を参照してください。

チェックアウトしたソースで開発する場合は、ローカルのパッケージをビルドしてインストールします。

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/integrations/anthropic-mcp
npm ci && npm run build
# then, in your project:
npm install /path/to/dcp-ai/integrations/anthropic-mcp
```

<a id="signed-receipts-per-tool-call"></a>

## ツール呼び出しごとの署名付き受領書

`withDcpReceipt` は任意の MCP のツールのハンドラーを包み、呼び出しのたびに受領書を伴って返るようにします。受領書は、
サーバーの鍵で作られた署名付きの宣言で、どのツールが呼ばれたか、どの意図と
ポリシー判断のもとか、そして入ったものと出たもののハッシュを示します。それらの鍵の持ち主が
これを宣言したことを示しますが、それだけでは鍵の持ち主が誰かは証明しません（[検証が証明すること](#what-verification-proves-and-what-it-does-not)を参照）。
また、ツールがその結果のとおりのことをしたことも証明しません。受領書は通常の **DCP v2.0 の署名付きバンドル**です。エージェントの Responsible Principal Record（DCP-01）と Agent
Passport、ツールが実行される*前に* Ed25519 + ML-DSA-65 で複合署名された Intent（DCP-02）、
Policy Decision、そして引数と結果の SHA-256 を持つ 1 つの監査エントリー（DCP-03）です。
通信路に新しいものはなく、どの DCP の検証器もオフラインで確認できます。

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { withDcpReceipt, createReceiptIdentity, verifyDcpReceipt } from '@dcp-ai/anthropic-mcp';

// One identity per session: new keys and session nonce, signed RPR and passport.
// Production deployments pass their own signed RPR and passport instead.
const identity = await createReceiptIdentity({ legalName: 'Example Operator', jurisdiction: 'CL' });

const server = new McpServer({ name: 'weather', version: '1.0.0' });
server.registerTool(
  'get_weather',
  { description: 'Weather for a city', inputSchema: { city: z.string() } },
  withDcpReceipt('get_weather', async ({ city }) => ({ content: [{ type: 'text', text: `Sunny in ${city}` }] }), { identity }),
);
```

これで、すべての結果が `_meta.dcp_receipt` を持ちます。呼び出し元、または後の誰でも、それを検証し、
それが*この*呼び出しの受領書であることを確認できます：

```typescript
// Fragment: `client` is an MCP client connected to the server above
const result = await client.callTool({ name: 'get_weather', arguments: { city: 'Santiago' } });
const { _meta, ...seen } = result;
const check = await verifyDcpReceipt(_meta.dcp_receipt, { tool: 'get_weather', arguments: { city: 'Santiago' }, result: seen });
check.verified; // false if the bundle, the tool name or the hash of { arguments, result } does not match
```

各呼び出しで起きること：

| ポリシー判断 | ツールの実行 | 返されるもの | 監査エントリー |
|---|---|---|---|
| `approve` | する | ハンドラーの結果 + `_meta.dcp_receipt` | `outcome: "completed"`、`result_ref` = 結果のハッシュ |
| `escalate` | しない | `{ content, isError: true, _meta }` | `outcome: "escalated"`、`policy_decision: "escalated"`、`result_ref: null` |
| `block` | しない | `{ content, isError: true, _meta }` | `outcome: "blocked"`、`policy_decision: "blocked"`、`result_ref: null` |
| ハンドラーが例外を投げる | する | `{ content, isError: true, _meta }` | `outcome: "failed"`、`result_ref` = そのエラーの結果のハッシュ |

拒否も証拠です。ブロックされた呼び出しの受領書は、エージェントが宣言した意図と、
それを止めた判断を示します。

<a id="classification-and-policy"></a>

### 分類とポリシー

既定では、すべての呼び出しはチャネル `api` 上の、`data_classes: ["none"]` を持つ影響の小さい `api_call` で、
既定のポリシーはそれを承認します（リスク 200）。ツールが本当に何をするかをラッパーに伝え、
既定値が合わないときは自分で判断してください：

```typescript
// Fragment: payInvoice is your tool handler, identity as above
withDcpReceipt('pay_invoice', payInvoice, {
  identity,
  classify: (tool, args) => ({
    action_type: 'initiate_payment',
    channel: 'payments',
    estimated_impact: 'high',
    data_classes: ['financial_data'],
  }),
  // Default policy: risk = impact (low 200 / medium 500 / high 900) + 150 per sensitive data class, capped at 1000;
  // approve < 500, escalate < 800, block >= 800. Replace it with your own:
  decide: (intent) => ({ decision: 'escalate', risk_score: 900, reasons: ['payments need a human'] }),
  appliedPolicyHash: 'sha256:…', // hash of the policy you applied (default: hash of the default rules)
});
```

上の `'sha256:…'` はプレースホルダーです。ポリシーの本当の `sha256:` と 64 文字の 16 進数を渡すか、
`appliedPolicyHash` を省いてください。

意図の `security_tier`（と判断の `resolved_tier`）は、SDK がその意図に与えるティア
（DCP-AI v2.0 §14.2）で、リスクスコアが示すもの（200 で standard、500 で elevated、800 で
maximum）を下回ることはないため、既定の呼び出しは `standard` です。`appliedPolicyHash` は `sha256:<64 hex>` でなければならず、
`createReceiptIdentity` はパスポートのスキーマの能力（`browse`、`api_call`、
`email`、`calendar`、`payments`、`crm`、`file_write`、`code_exec`）しか受け付けません。どちらも最初に拒否されます。
リファレンスの検証器がスキーマを検証するからです。

<a id="evidence-hashes"></a>

### 証拠のハッシュ

`evidence.evidence_hash` は、すべての深さでキーを並べた（`stableJson`）`{ arguments, result }` の JSON テキストに対する
`sha256:` で、`evidence.result_ref` はツールが実行された場合に結果だけに対して同じものです。`arguments` は受け取ったままの引数で、
ハンドラーが実行される前にコピーされるため、入力を書き換えるハンドラーが受領書の証明する内容を変えることはできません。
`result` は、ラッパーが返すものから `_meta` を除いたものそのもの（`resultSeen(result)`）です。受領書は `_meta` で運ばれ、
ハンドラー自身の `_meta` は伝送のメタデータであって証拠ではありません。むき出しの値を返すハンドラーは、それを
`{ content: [{ type: "text", text }] }` として包まれ、その包みがハッシュされます。引数は
JSON としてスナップショットを取られるため、`Date` は ISO の文字列としてハッシュされ、関数は捨てられ、
`AbortSignal`（MCP の SDK の `extra` にあるもの）は `{}` になります。MCP の `extra` が `requestId` を持つ場合、それは
`evidence.request_id` として記録され、`verifyDcpReceipt(receipt, { requestId })` がそれを確認します。

正規化のプロファイルと違い、`stableJson` はどんな JSON の数値も保つため、小数を含む引数と結果も
問題なくハッシュされます。キーは JavaScript の `sort()` で並べます。キーが整数の文字列であるオブジェクト
（`{ "10": 1, "9": 2 }`）は V8 が並べるとおりに並ぶため、ほかの言語で確認する必要があるときは、
JavaScript でハッシュを再計算するか、そのようなキーを避けてください。

<a id="what-verification-proves-and-what-it-does-not"></a>

### 検証が証明すること、しないこと

受領書は、すべての DCP のバンドルと同じく、自身のパスポートと RPR が列挙する鍵で検証されます。`verified` の結果だけでは、
受領書が自己一貫していて改ざんされていないことは証明しますが、それらの鍵が誰のものかは証明しません。
アイデンティティの確認にするには、`trustedKeys`（エージェントとそのプリンシパルについてすでに信頼している鍵。
レジストリ、または固定したパスポートと RPR から）を、`expectedAgentId` と `expectedHumanId` とともに渡してください。
そうすると、SDK が受領書の中で検証するすべての署名は、それらの鍵のいずれかで作られていなければならず、その鍵は
SDK が解決するのとまったく同じに解決され（そのアーティファクトの鍵のリストで、署名の `kid` を持つ最初の鍵）、
あなたのリストで有効かつ期限内でなければなりません。それが成り立った場合にだけ、結果は `anchored: true` を示します。`anchored` はバンドルの検証とは別に計算されるため、`verified` が `false` のときでも
`true` になることがあります。両方が `true` のときにだけ受領書を受け入れてください。パスポートのレジストリを信頼する検証器は、
エージェントが作るすべての受領書を、パスポートを読み直すことなくアンカーできます。

知っておくべき制限：

- 受領書は `intent_id` と `audit_id` によって 1 つの呼び出しに結び付けられ、サーバーが提供する場合は
  `request_id` によって MCP のリクエストに結び付けられます。セッションの期間とモードは、渡した `policy`（なければ
  `DEFAULT_VERIFIER_POLICY`）のもとで SDK の検証器が確認するものです。`verifyDcpReceipt` は独自の時間の窓や
  重複排除を加えないため、再送された受領書を検出しなければならない検証器は、
  見た ID の集合を自分で保持します。
- 各受領書は自己完結しています（1 つの監査エントリー、`prev_hash: "GENESIS"`）。セッションの受領書を
  1 つのバンドルにまとめることはロードマップにあります。
- `createReceiptIdentity` は RPR とパスポートに同じ鍵ペアで署名します（プリンシパルと
  エージェントが同一）。これはテストと最初の実行にだけ適しています。

<a id="dcp-tools-and-resources"></a>

## DCP のツールとリソース

ブリッジは DCP の操作を MCP のツールとリソースとしても公開するため、MCP に対応したモデルは次のことができます：

- **DCP のバンドルの検証** — 署名付きバンドルまたは受領書に対して、SDK の V2 の検証器（`verifySignedBundleV2`）を実行する。
- **DCP のアイデンティティの作成** — 新しい Responsible Principal Record と Agent Passport を用意する。
- **意図の宣言** — リスクティアの自動計算とともに、ポリシーの評価のために意図を提出する。
- **エージェントの状態の確認** — プレースホルダー。`dcp_check_agent` は `status: "check_pending"` を返し、何も取得も検証もしない。
- **ライフサイクルの管理（DCP-05）** — エージェントの稼働開始、バイタリティの報告、廃止。
- **承継（DCP-06）** — 後継者の希望を伴うデジタル遺言の作成。
- **紛争（DCP-07）** — 証拠のハッシュを伴う、エージェント間の紛争の申し立て。
- **権利（DCP-08）** — 管轄区域内でのエージェントの権利の宣言。
- **委任（DCP-09）** — 人からエージェントへの委任マンデートの作成。

<a id="supported-dcp-specifications"></a>

## サポートする DCP の仕様

DCP-01 から DCP-09。部分的なもので、署名付きの受領書とバンドルの検証、そしてそのほかの仕様の形に沿った
下書きです。完全には実装していません。

<a id="mcp-tools"></a>

## MCP のツール

| ツール | 説明 |
|---|---|
| `dcp_verify_bundle` | DCP v2.0 の署名付きバンドルまたは受領書を SDK の V2 の検証器で検証する |
| `dcp_create_identity` | 新しい DCP のデジタルアイデンティティ（RPR + パスポート）を作る |
| `dcp_declare_intent` | ポリシーの評価のために意図を宣言する |
| `dcp_check_agent` | プレースホルダー：何も取得も検証もせずに `check_pending` を返す |
| `dcp_commission_agent` | エージェントを稼働させる（DCP-05） |
| `dcp_report_vitality` | エージェントのバイタリティの指標を報告する（DCP-05） |
| `dcp_decommission_agent` | エージェントを廃止する（DCP-05） |
| `dcp_create_testament` | デジタル遺言を作る（DCP-06） |
| `dcp_file_dispute` | エージェント間の紛争を申し立てる（DCP-07） |
| `dcp_declare_rights` | エージェントの権利を宣言する（DCP-08） |
| `dcp_create_mandate` | 委任マンデートを作る（DCP-09） |

<a id="mcp-resources"></a>

## MCP のリソース

| URI | 説明 |
|---|---|
| `dcp://protocol/version` | 現在の DCP のプロトコルのバージョンと機能 |
| `dcp://protocol/algorithms` | サポートする暗号アルゴリズム |
| `dcp://protocol/tiers` | セキュリティティアの定義と要件 |
| `dcp://protocol/lifecycle-states` | エージェントのライフサイクルの状態の定義（DCP-05） |

<a id="usage"></a>

## 使い方

<a id="registering-with-an-mcp-server"></a>

### MCP サーバーへの登録

`DCP_MCP_TOOLS` はツールの記述子（`name`、`description`、JSON Schema としての `inputSchema`）で、`DCP_MCP_RESOURCES` はリソースの記述子（`uri`、`name`、`description`、`mimeType`）です。パッケージはリソースの内容を提供しません。JSON Schema のツールの記述子をそのまま受け取る、MCP の TypeScript SDK の低レベルの `Server` を使った概略です（ここでは実行していません。MCP の SDK が必要です）：

```javascript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { DCP_MCP_TOOLS, DCP_MCP_RESOURCES, handleDcpToolCall } from '@dcp-ai/anthropic-mcp';

const server = new Server({ name: 'dcp', version: '1.0.0' }, { capabilities: { tools: {}, resources: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: DCP_MCP_TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const result = await handleDcpToolCall(request.params.name, request.params.arguments ?? {});
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: DCP_MCP_RESOURCES }));
// Serving a resource's contents (resources/read) is up to your server.
```

<a id="tool-call-examples"></a>

### ツール呼び出しの例

```javascript
import { handleDcpToolCall } from '@dcp-ai/anthropic-mcp';

// Fragment: myBundle is a signed bundle or receipt you hold
// Verify a bundle or a receipt
const result = await handleDcpToolCall('dcp_verify_bundle', {
  bundle_json: JSON.stringify(myBundle),
}); // { verified, errors, warnings, details, timestamp }

// Declare an intent
const intent = await handleDcpToolCall('dcp_declare_intent', {
  agent_id: 'agent:my-agent',
  action_type: 'api_call',
  description: 'Fetch weather data from external API',
  risk_score: 150,
});
```

<a id="notes"></a>

## 注記

- `dcp_verify_bundle` は `DEFAULT_VERIFIER_POLICY` のもとで `@dcp-ai/sdk` の `verifySignedBundleV2` を実行します（ハッシュ、マニフェスト、複合署名、セッションの結び付け、SHA-256 の監査チェーン）。JSON Schema の検証はせず（リファレンスの検証器 `lib/verify.js` が行います）、`@dcp-ai/sdk` 2.2.0 は V2-11 の二次の SHA3-256 のフィールドを確認しません（ロックファイルが 2.2.1 以降を解決すると、存在するものが確認されます）。また、`verified` の結果はアドミッションでも認可でもありません。
- `dcp_verify_bundle` と受領書を除き、ツールのハンドラーは下書きを返します。署名するための識別子とフィールドで、鍵や署名は決して返しません（`next_step` が何が足りないかを示します）。
- `dcp_create_identity` は識別子だけを返します — 鍵の生成と署名は別の手順です。
- リスクティアはリスクスコアから自動で計算されます：routine（<200）、standard（200-499）、elevated（500-799）、maximum（800+）。
