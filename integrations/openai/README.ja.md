<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="dcp_aiopenai--openai-integration"></a>
<a id="dcp_aiopenai-openai-integration"></a>

# dcp_ai.openai — OpenAI との統合

> [英語版](README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

OpenAI の Python クライアントのための DCP のラッパーです。チャットの呼び出しごとに意図を作り、呼び出しが戻ったときに監査エントリーを記録し、関数呼び出しのための DCP のツールを提供し、監査証跡をハッシュチェーンでつないで保持します。

ラッパーは**署名されていない記録**を保持し、**どのポリシーも評価しません**。すべての呼び出しが実行され、その監査エントリーには `policy_decision: "approved"` が記録されます。受け取る `secret_key` は使われません。署名付きのバンドルと、関数呼び出しの周りのポリシーのゲートには、[docs/QUICKSTART_OPENAI.md](../../docs/QUICKSTART_OPENAI.md) に従ってください。

<a id="supported-dcp-specifications"></a>

## サポートする DCP の仕様

DCP-01 から DCP-09。部分的なもので、これらの仕様の形に沿った署名されていない記録と下書き、そして
`dcp_verify_bundle` によるバンドルの検証です。完全には実装していません。

<a id="installation"></a>

## インストール

> **リリースの状況（2026 年 10 月 25 日）。** PyPI には `dcp-ai` 2.9.0 があります。そこでは、`handle_dcp_tool_call` の `dcp_verify_bundle` ツールはすべてのバンドルを V1 の検証器に送ります。V2 のバンドルはすべて拒否され、V1 のバンドルはどの検証器のポリシーにもよらず受け入れられます。`verifier_policy` 引数、`averify_bundle_tool_call`、そして以下で説明する V2 の検証は `main` のソースにあります（[CHANGELOG.md](../../CHANGELOG.md) の `[Unreleased]` の節を参照）。

チェックアウトから（このページのバージョン）：

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install "/path/to/dcp-ai/sdks/python[openai]"
```

公開されたバージョン（2.9.0）、上記の制限あり：

```bash
pip install "dcp-ai[openai]"
```

例は OpenAI の API を呼び出します。環境に `OPENAI_API_KEY` が必要で、OpenAI から課金されます。

<a id="quickstart"></a>

## クイックスタート

```python
from openai import OpenAI
from dcp_ai.openai import DCPOpenAIClient

client = OpenAI()  # reads OPENAI_API_KEY from the environment

# The wrapper reads agent_id from the passport and human_id from the RPR;
# it does not check or sign them.
passport = {"agent_id": "agent:gpt-assistant-001", "capabilities": ["browse", "api_call"], "risk_tier": "medium"}
rpr = {"human_id": "rpr:human-001"}

dcp_client = DCPOpenAIClient(openai_client=client, passport=passport, rpr=rpr)

# Without tools of your own, the DCP tools are added (auto_intent=True), so the
# model may answer with tool calls instead of text.
response = dcp_client.chat_completions_create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Summarize today's news"}],
)
message = response.choices[0].message
print(message.content or message.tool_calls)

for entry in dcp_client.get_audit_trail():
    print(f"[{entry['timestamp']}] {entry['intent_id']} -> {entry['outcome']}")
```

<a id="api-reference"></a>

## API リファレンス

### `DCPOpenAIClient`

```python
DCPOpenAIClient(
    openai_client: Any,           # OpenAI() instance
    passport: dict[str, Any],     # agent_id and, for commission, capabilities and risk_tier are read
    rpr: dict[str, Any],          # human_id is read
    secret_key: str = "",         # Accepted but not used: nothing is signed
    session_nonce: str = "",      # A fresh one when empty
    auto_intent: bool = True,     # Adds DCP_TOOLS to calls that pass no tools
)
```

<a id="methods"></a>

#### メソッド

| メソッド | 説明 |
|--------|-------------|
| `chat_completions_create(**kwargs)` | 意図を作り、`client.chat.completions.create(**kwargs)` を呼び、それが戻った場合に監査エントリーを記録する。例外を投げた呼び出しは例外をそのまま伝え、監査エントリーを残さない。 |
| `commission(purpose, capabilities?)` | エージェントを稼働させる（DCP-05 §3.1）。署名されていない証明書を返し、監査エントリーを記録する。証明書と `commissioned` の状態はローカルのもので、何かが証明されたりほかに送られたりはしない。 |
| `get_audit_trail()` | ハッシュチェーンでつながった監査エントリー。コピーではなくメモリー上のリストそのものなので、それを変えると証跡が変わる。 |
| `get_session_nonce()` | セッションの nonce。 |

<a id="chat_completions_create-flow"></a>

#### `chat_completions_create` の流れ

1. 意図を作ります：`action_type: "api_call"`、チャネル `api`、`estimated_impact: "low"`、`data_classes: ["none"]`。
2. `auto_intent` が有効で、呼び出しが `tools` を渡さない場合、`DCP_TOOLS` を加えます。
3. `client.chat.completions.create()` を実行します。ポリシー判断は行われず、呼び出しは常に実行されます。
4. 呼び出しが戻った場合、`policy_decision: "approved"` と、`evidence.result_ref` として応答の `id` を持つ監査エントリーを、直前のエントリーにつなげて記録します。

### `DCP_TOOLS`

DCP のための OpenAI の関数呼び出しのツール定義です：

```python
# Fragment: client as in the Quickstart
from dcp_ai.openai import DCP_TOOLS

messages = [{"role": "user", "content": "Declare your intent to make an API call"}]
response = client.chat.completions.create(
    model="gpt-4",
    messages=messages,
    tools=DCP_TOOLS,
)
```

<a id="available-tools"></a>

#### 利用できるツール

| ツール | パラメーター | 説明 |
|------|------------|-------------|
| `dcp_verify_bundle` | `signed_bundle_json: string` | DCP の Signed Bundle を検証する |
| `dcp_declare_intent` | `action_type: enum`, `target_channel: enum`, `data_classes?: string[]`, `estimated_impact?: enum` | 行動の前に意図を宣言する（DCP-02） |
| `dcp_commission_agent` | `purpose: string`, `capabilities?: string[]`, `risk_tier?: enum` | エージェントを稼働させる（DCP-05 §3.1） |
| `dcp_report_vitality` | `task_completion_rate`, `error_rate`, `human_satisfaction`, `policy_alignment` | バイタリティの指標を報告する（DCP-05 §4.1） |
| `dcp_declare_rights` | `rights: string[]`, `jurisdiction: string` | エージェントの権利を宣言する（DCP-08 §3.1） |
| `dcp_create_mandate` | `human_id: string`, `authority_scope: string[]`, `valid_from?: string`, `valid_until?: string` | 委任マンデートを作る（DCP-09 §3.1） |

**`action_type`**: `browse`, `api_call`, `send_email`, `create_calendar_event`, `initiate_payment`, `update_crm`, `write_file`, `execute_code`

**`target_channel`**: `web`, `api`, `email`, `calendar`, `payments`, `crm`, `filesystem`, `runtime`

**`estimated_impact`**: `low`, `medium`, `high`

### `handle_dcp_tool_call(tool_name, arguments, session_nonce="", verifier_policy=None)`

OpenAI が返す DCP のツール呼び出しを処理し、JSON の文字列を返します。`dcp_verify_bundle` 以外のツールは、署名されていない下書きを返します（たとえば `dcp_declare_intent` は、`agent_id` と `human_id` を `"self"` にした `{"intent_declared": true, "intent": {...}}` を返します）。これらの下書きは、署名できる状態の規範的なアーティファクトではありません。`"self"` は、
スキーマが `agent_id` と `human_id` に求める 6 文字より短く、証明書、権利、マンデートの下書きには
スキーマのフィールドが欠けています。それらを適合させ、スキーマに照らして検証し、コア SDK で署名してください。

`dcp_verify_bundle` は、`verifier_policy` のもとで `dcp_ai.v2` の `verify_signed_bundle_v2` によって V2 のバンドルを
検証します。ポリシーは、`DEFAULT_VERIFIER_POLICY` の上に設定する `VerifierPolicy` のフィールドの dict
（`risk_overrides` なしの `default_mode` はすべてのリスクティアに適用されます）か、完全な `VerifierPolicy` で、既定は
`DEFAULT_VERIFIER_POLICY` です。Ed25519 の署名しかなく、intended_verifier もセッションの期間も持たない V1 のバンドルは、
ポリシーが `allow_v1_bundles` を持ち、ed25519 を受け入れ（`accepted_classical_algs`、`advisory_rejected_algs` に項目
なし）、オーディエンスの結び付け、セッションの期限、セッションの最大期間を求めず、そのリスクティアとセキュリティティア
についてクラシカルのみのバンドルを受け入れる場合（`spec/VERIFICATION.md` V2-10）にだけ受け入れられます。その
アーティファクトはオブジェクトで、パスポートの `agent_id` と RPR の `human_id` は文字列でなければなりません。結果は
`verified`、`dcp_version`、検証器の `errors` と `warnings`（それぞれ最大 20 件、各 500 文字）、そして V2 ではその
`details`（各値も同じように制限）を持つ JSON で、バンドルが提供したテキストの制御文字と書式文字はエスケープされます。
イベントループが実行中でもそうでなくても動き、スレッドの現在のイベントループを元のままにします。非同期のコードは代わりに
`averify_bundle_tool_call(arguments, verifier_policy)` を await できます。

`dcp_verify_bundle` は、あなたのコードが渡すポリシーのもとでの暗号的な検証です。`verifier_policy` はあなたの呼び出しの
引数で、モデルの `arguments` から読まれることは決してありません。アンカーされたプリンシパルのアドミッションではなく、
どの行動も認可しません（[docs/ADMISSION.md](../../docs/ADMISSION.md) を参照）。

```python
# Fragment: response is a chat completion with tool calls
import json

from dcp_ai.openai import handle_dcp_tool_call

for tool_call in response.choices[0].message.tool_calls or []:
    if tool_call.type == "function" and tool_call.function.name.startswith("dcp_"):
        result = handle_dcp_tool_call(
            tool_call.function.name,
            json.loads(tool_call.function.arguments),
        )
        print(result)  # JSON with the result
```

<a id="advanced-example--function-calling-with-dcp"></a>
<a id="advanced-example-function-calling-with-dcp"></a>

## 高度な例 — DCP による関数呼び出し

```python
# Fragment: passport and rpr as in the Quickstart
import json

from openai import OpenAI
from dcp_ai.openai import DCPOpenAIClient, handle_dcp_tool_call

dcp_client = DCPOpenAIClient(openai_client=OpenAI(), passport=passport, rpr=rpr)

# No tools passed: the DCP tools are added, so the model can call them
response = dcp_client.chat_completions_create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Declare your intent to make an API call"}],
)

for tc in response.choices[0].message.tool_calls or []:
    if tc.type == "function":
        result = handle_dcp_tool_call(tc.function.name, json.loads(tc.function.arguments))
        print(f"Tool: {tc.function.name} -> {result}")
```

<a id="development"></a>

## 開発

チェックアウトから：

```bash
cd sdks/python
pip install -e ".[openai,dev]"
pytest -v
```

<a id="dependencies"></a>

### 依存関係

- `dcp-ai` — DCP の SDK（crypto、merkle、verify、models）
- `openai` — OpenAI の公式クライアント

<a id="license"></a>

## ライセンス

Apache-2.0
