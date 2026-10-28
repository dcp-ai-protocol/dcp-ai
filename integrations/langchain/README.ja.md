<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="dcp_ailangchain--langchain-integration"></a>
<a id="dcp_ailangchain-langchain-integration"></a>

# dcp_ai.langchain — LangChain との統合

> [英語版](README.md)の参考訳です（28/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

DCP と LangChain の統合です。LangChain のエージェントを包み、完了した呼び出しのたびに、V2 の形のハッシュチェーンでつながった監査証跡にエントリーを残します。また、バンドルの検証ツールとコールバックのハンドラーを提供します。

ラッパーは**署名されていない記録**を保持します。意図、ポリシー判断、監査エントリーは署名されず、受け取る `secret_key` は使われません。LangChain のエージェントの署名付きで検証可能なバンドルには、[docs/QUICKSTART_LANGCHAIN.md](../../docs/QUICKSTART_LANGCHAIN.md) のようにコア SDK を使ってください。

<a id="supported-dcp-specifications"></a>

## サポートする DCP の仕様

DCP-01 から DCP-09。部分的なもので、これらの仕様の形に沿った署名されていない記録と、`DCPTool` によるバンドルの検証です。
完全には実装していません。

<a id="installation"></a>

## インストール

**PyPI 公開済み（26/10/2026）。** `dcp-ai` 2.10.0 はここで説明する実装を含みます。2.9.0 から更新し、環境またはロックファイルを更新してください。[Python のリリースノート](../../docs/PYTHON_RELEASE.md)を参照してください。

2.9.0 はすべてのバンドルを V1 に送ります。2.10.0 は規範的検証器で V2 を検証し、V1 と V2 に設定したポリシーを適用します。以下の未署名記録とコールバックの制限は変わりません。

```bash
pip install "dcp-ai[langchain]>=2.10.1,<3"
```

ソース開発の場合：

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "/path/to/dcp-ai/sdks/python[langchain]"
```

<a id="quickstart"></a>

## クイックスタート

```python
import asyncio

from dcp_ai.langchain import DCPAgentWrapper

# The wrapper reads agent_id from the passport and human_id from the RPR;
# it does not check or sign them.
passport = {"agent_id": "agent:research-assistant-001", "capabilities": ["browse", "api_call"]}
rpr = {"human_id": "rpr:human-001"}


async def main() -> None:
    wrapped = DCPAgentWrapper(
        agent=my_langchain_agent,  # Fragment: your LangChain agent (ainvoke or invoke)
        passport=passport,
        rpr=rpr,
    )

    # invoke is a coroutine: await it
    result = await wrapped.invoke({"input": "Search for information about AI"})

    for entry in wrapped.get_audit_trail():
        print(f"[{entry['timestamp']}] {entry['intent_id']}: {entry['policy_decision']} -> {entry['outcome']}")


asyncio.run(main())
```

<a id="api-reference"></a>

## API リファレンス

### `DCPAgentWrapper`

```python
DCPAgentWrapper(
    agent: Any,                         # LangChain agent: ainvoke is used when present, else invoke
    passport: dict[str, Any],           # agent_id is read
    rpr: dict[str, Any],                # human_id is read
    secret_key: str = "",               # Accepted but not used: nothing is signed
    session_nonce: str = "",            # A fresh one when empty
    auto_intent: bool = True,           # Stored, not used: invoke always creates an intent
    policy_engine: Any = None,          # Object with evaluate(intent) -> PolicyDecisionV2
    pq_checkpoint_interval: int = 10,   # Stored, not used: no PQ checkpoints are made
)
```

<a id="methods"></a>

#### メソッド

| メソッド | 説明 |
|--------|-------------|
| `await invoke(inputs, **kwargs)` | 意図とポリシー判断（ローカルのもので、リストとしては保持されない）を作り、エージェントを実行し、それが戻った場合に監査エントリーを記録する（下記参照）。エージェントが廃止済みか、判断が `block` の場合は、監査エントリーなしでエラーの dict を返す。エージェントの例外はそのまま伝わり、監査エントリーを残さない。 |
| `get_audit_trail()` | ハッシュチェーンでつながった監査エントリー。コピーではなくメモリー上のリストそのものなので、それを変えると証跡が変わる。 |
| `get_session_nonce()` | セッションの nonce。 |
| `commission(purpose, capabilities, risk_tier)` | エージェントを稼働させる（DCP-05 §3.1）。 |
| `report_vitality(metrics_dict)` | バイタリティの指標を報告し、スコアを計算する（DCP-05 §4.1）。 |
| `decommission(termination_mode, reason)` | エージェントを廃止する（DCP-05 §5.1）。 |
| `declare_rights(rights, jurisdiction)` | 権利を宣言する（DCP-08 §3.1）。 |

<a id="what-invoke-does-on-main-25102026"></a>

#### `invoke` がすること（`main`、2026 年 10 月 25 日）

1. 意図を作ります。常に `action_type: "api_call"`、チャネル `api`、`estimated_impact: "low"`、`data_classes: ["none"]` です。
2. ポリシー判断を得ます。`policy_engine` がなければ、判断は常に `approve` です。ある場合、その `evaluate(intent)` は `PolicyDecisionV2`（`dcp_ai.v2.models` から）を返さなければならず、単なる dict は `AttributeError` を投げます。
3. 判断が `block` でない限りエージェントを実行します。ブロックされた呼び出しはエラーの dict を返し、**監査エントリーを残しません**。`escalate` の判断はエージェントを**止めません**。エージェントは実行され、その監査エントリーには `outcome: "completed"` とともに `policy_decision: "blocked"` が記録されます。人が承認するまで実行してはならないものには `block` を使ってください。
4. エージェントが戻った場合、監査エントリーを記録してチェーンにつなげます。`intent_hash` と、`GENESIS` から直前のエントリーのハッシュへの `prev_hash` です。

`evidence.result_ref` はエージェントの結果の最初の 100 文字を、ハッシュではなくテキストとして保持するため、出力に含まれる個人データが入ることがあります。監査証跡は出力と同じ保護が必要なデータとして扱うか、保持しないでください。

### `DCPTool`

エージェントの中から DCP のバンドルを検証する、LangChain 風のツールです。単純なクラス（`name`、`description`、`run`、`arun`）で、LangChain の `BaseTool` ではありません。お使いの LangChain のバージョンに合わせて包んでください。たとえば：

```python
from langchain_core.tools import StructuredTool
from dcp_ai.langchain import DCPTool

dcp = DCPTool()
verify_tool = StructuredTool.from_function(
    func=dcp.run, coroutine=dcp.arun, name=dcp.name, description=dcp.description,
)
```

<a id="attributes"></a>

#### 属性

| 属性 | 値 |
|-----------|-------|
| `name` | `"dcp_verify_bundle"` |
| `description` | `"Verify a DCP signed bundle..."` |

<a id="methods-1"></a>
<a id="methods_1"></a>

#### メソッド

| メソッド | シグネチャ | 説明 |
|--------|-----------|-------------|
| `run(signed_bundle_json)` | `(str \| dict) -> str` | 同期の検証。イベントループが実行中でもそうでなくてもよい |
| `arun(signed_bundle_json)` | `(str \| dict) -> str` | 非同期の検証 |

V2 のバンドルは、`DCPTool(verifier_policy=...)` のもとで、`dcp_ai.v2` の `verify_signed_bundle_v2` によって検証されます
（複合署名、セッションの結び付け、マニフェスト、アーティファクト間の一貫性、SHA-256 の監査チェーン（2.10.1 以降では、2.10.0 とは異なり、存在する V2-11 の二次の SHA3-256 のフィールドも）、鍵の有効性）。ポリシーは、`DEFAULT_VERIFIER_POLICY` の上に設定する
`VerifierPolicy` のフィールドの dict（`risk_overrides` なしの `default_mode` はすべてのリスクティアに適用されます）か、
完全な `VerifierPolicy` で、既定は `DEFAULT_VERIFIER_POLICY` です。Ed25519 の署名しかなく、intended_verifier もセッションの
期間も持たない V1 のバンドルは、ポリシーが `allow_v1_bundles` を持ち、ed25519 を受け入れ（`accepted_classical_algs`、
`advisory_rejected_algs` に項目なし）、オーディエンスの結び付け、セッションの期限、セッションの最大期間を求めず、その
リスクティアとセキュリティティアについてクラシカルのみのバンドルを受け入れる場合（`spec/VERIFICATION.md` V2-10）にだけ
受け入れられます。そのアーティファクトはオブジェクトで、パスポートの `agent_id` と RPR の `human_id` は文字列でなければ
なりません。結果は `Bundle VERIFIED (v<version>) for agent <agent_id>` または `Bundle INVALID: <errors>` で、検証器の
エラーを伴います。テキストは制限され（最大 20 件のエラーで各 500 文字、`agent_id` は 200 文字）、バンドルから来る部分は
制御文字と書式文字がエスケープされます（改行は `\u000a`）。モデルのコンテキストに入るからです。

`DCPTool` は、あなたのコードがツールを作るときに設定するポリシー（`DCPTool(verifier_policy=...)`）のもとでの
暗号的な検証で、ポリシーがバンドルやモデルから取られることはありません。アンカーされたプリンシパルのアドミッションではなく、
どの行動も認可しません（[docs/ADMISSION.md](../../docs/ADMISSION.md) を参照）。

### `DCPCallback`

LangChain のチェーンのイベントを、V2 の形の監査エントリー（署名なし、ハッシュチェーン）として記録します。単純なクラスで、LangChain の `BaseCallbackHandler` ではありません。LangChain 1.x はこれをコールバックとして拒否し（`AttributeError`、`langchain-core` 1.7 で確認）、また LangChain が `UUID` を渡すのに対し、これは `run_id` を文字列として必要とします。独自のハンドラーから呼んでください：

```python
from langchain_core.callbacks import BaseCallbackHandler
from dcp_ai.langchain import DCPCallback

dcp_log = DCPCallback(agent_id="agent:research-assistant-001", human_id="rpr:human-001")


class DCPHandler(BaseCallbackHandler):
    """Hands LangChain's chain events to DCPCallback."""

    # LangChain passes run_id as a UUID; DCPCallback records it as the entry's intent_id, a string
    def on_chain_start(self, serialized, inputs, *, run_id, **kwargs):
        dcp_log.on_chain_start(serialized or {}, inputs, run_id=str(run_id))

    def on_chain_end(self, outputs, *, run_id, **kwargs):
        dcp_log.on_chain_end(outputs, run_id=str(run_id))


# Fragment: chain is your LangChain chain or agent
chain.invoke({"input": "..."}, config={"callbacks": [DCPHandler()]})
entries = dcp_log.get_entries()
```

`on_chain_end` は出力の最初の 200 文字を `evidence.result_ref` として保持し、そこには個人データが入ることがあります。

<a id="methods-2"></a>
<a id="methods_2"></a>

#### メソッド

| メソッド | 説明 |
|--------|-------------|
| `on_chain_start(serialized, inputs, **kwargs)` | チェーンの開始を記録する |
| `on_chain_end(outputs, **kwargs)` | チェーンの終了を記録する |
| `on_lifecycle_event(event_type, details)` | ライフサイクルのイベントを記録する（DCP-05） |
| `get_entries()` | 監査エントリーのリストを返す |

<a id="advanced-example--agent-with-a-custom-policy-engine"></a>
<a id="advanced-example-agent-with-a-custom-policy-engine"></a>

## 高度な例 — 独自のポリシーエンジンを持つエージェント

ラッパーの意図は常に影響の小さい `api_call` なので、ポリシーエンジンはほかのことで判断します。ここでは、人が操作する停止スイッチです：

```python
from datetime import datetime, timezone

from dcp_ai.langchain import DCPAgentWrapper
from dcp_ai.v2.models import PolicyDecisionV2


class StopSwitch:
    """Approves until a human stops the agent; then blocks every call."""

    def __init__(self) -> None:
        self.stopped = False

    def evaluate(self, intent):
        return PolicyDecisionV2(
            dcp_version="2.0",
            intent_id=intent.intent_id,
            session_nonce=intent.session_nonce,
            decision="block" if self.stopped else "approve",
            risk_score=1000 if self.stopped else 100,
            reasons=["stopped by a human" if self.stopped else "default-allow"],
            timestamp=datetime.now(timezone.utc).isoformat(),
        )


switch = StopSwitch()
wrapped = DCPAgentWrapper(
    agent=my_agent,  # Fragment: your LangChain agent
    passport=passport,
    rpr=rpr,
    policy_engine=switch,
)
# switch.stopped = True  ->  the next await wrapped.invoke(...) returns an error dict and does not run the agent
```

<a id="development"></a>

## 開発

チェックアウトから：

```bash
cd sdks/python
pip install -e ".[langchain,dev]"
pytest -v
```

<a id="dependencies"></a>

### 依存関係

- `dcp-ai` — DCP の SDK（crypto、merkle、verify、models）
- `langchain` + `langchain-core` — エージェントのフレームワーク

<a id="license"></a>

## ライセンス

Apache-2.0
