<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="dcp_aicrewai--crewai-integration"></a>
<a id="dcp_aicrewai-crewai-integration"></a>

# dcp_ai.crewai — CrewAI との統合

> [英語版](README.md)の参考訳です（26/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

マルチエージェントのガバナンスのための、DCP と CrewAI の統合です。各エージェントは自分の DCP のパスポートと監査証跡を持ち、クルー全体の証跡を組み合わせることもできます。

`DCPCrewAgent` と `DCPCrew` は、クルーと並べて DCP の記録を保持します。V2 の形のハッシュチェーンでつながった監査エントリーと、ライフサイクルと承継の記録です。何にも署名せず、CrewAI を自ら実行することもありません。CrewAI のクルーの署名付きで検証可能な市民権バンドルには、[docs/QUICKSTART_CREWAI.md](../../docs/QUICKSTART_CREWAI.md) のようにコア SDK を使ってください。

<a id="supported-dcp-specifications"></a>

## サポートする DCP の仕様

DCP-01 から DCP-09。部分的なもので、これらの仕様の形に沿った署名されていない記録です。完全には実装して
いません。

<a id="installation"></a>

## インストール

**PyPI 公開済み（26/10/2026）。** `dcp-ai` 2.10.0 はここで説明する実装を含みます。2.9.0 から更新し、環境またはロックファイルを更新してください。[Python のリリースノート](../../docs/PYTHON_RELEASE.md)を参照してください。

2.10.0 は以下の条件に従ってチームのセッション nonce を対象のエージェントと共有し、2.9.0 の動作を修正します。これらの補助機能は引き続き未署名記録を生成し、CrewAI 自体は実行しません。検証可能なバンドルには SDK の署名 API を使ってください。

```bash
pip install "dcp-ai[crewai]>=2.10.0,<3"
```

ソース開発の場合：

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "/path/to/dcp-ai/sdks/python[crewai]"
```

<a id="quickstart"></a>

## クイックスタート

```python
from dcp_ai.crewai import DCPCrewAgent, DCPCrew

# Fields of the principal's RPR and of each agent's passport, in their V2 form.
# DCPCrewAgent reads human_id, agent_id and capabilities; it does not need full,
# signed payloads (those also carry session_nonce and keys).
rpr = {
    "dcp_version": "2.0",
    "human_id": "rpr:human-001",
    "legal_name": "Example Operator",
    "entity_type": "natural_person",
    "jurisdiction": "ES",
    "liability_mode": "owner_responsible",
    "override_rights": True,
    "issued_at": "2026-01-01T00:00:00Z",
    "expires_at": None,
}


def passport(agent_id: str, capabilities: list[str], risk_tier: str) -> dict:
    return {
        "dcp_version": "2.0",
        "agent_id": agent_id,
        "principal_binding_reference": rpr["human_id"],
        "capabilities": capabilities,
        "risk_tier": risk_tier,
        "status": "active",
        "created_at": "2026-01-01T00:00:00Z",
    }


researcher = DCPCrewAgent(
    role="researcher",
    passport=passport("agent:researcher-001", ["browse", "api_call"], "low"),
    rpr=rpr,
    goal="Research and gather information",
    backstory="Expert in information retrieval",
)

writer = DCPCrewAgent(
    role="writer",
    passport=passport("agent:writer-001", ["file_write"], "medium"),
    rpr=rpr,
    goal="Produce high-quality content",
    backstory="Professional writer with AI experience",
)

# Create crew with DCP governance
crew = DCPCrew(agents=[researcher, writer], verbose=True)

# Record each agent's participation in the task
result = crew.kickoff(task="Research AI trends and write a summary")
print(result)

# Combined audit trail (ordered by timestamp)
trail = crew.get_combined_audit_trail()
for entry in trail:
    print(f"[{entry['agent_id']}] {entry['intent_id']} -> {entry['outcome']}")
```

<a id="api-reference"></a>

## API リファレンス

### `DCPCrewAgent`

クルーのメンバーの DCP の記録です。そのパスポート、そのプリンシパルの RPR、そして自身の監査証跡です。

```python
DCPCrewAgent(
    role: str,                     # Agent role in the crew
    passport: dict[str, Any],     # DCP Agent Passport
    rpr: dict[str, Any],          # Responsible Principal Record
    secret_key: str = "",         # Kept on the agent; DCPCrewAgent does not sign with it
    session_nonce: str = "",      # Session nonce; a fresh one when empty, which a DCPCrew replaces with its own
    goal: str = "",               # Agent goal
    backstory: str = "",          # Agent context/backstory
)
```

<a id="methods"></a>

#### メソッド

| メソッド | シグネチャ | 説明 |
|--------|-----------|-------------|
| `log_action(action_type, outcome, evidence?, impact?, data_classes?)` | `(str, str, dict?, str?, list?) -> dict` | 行動を V2 の形の監査エントリーとして、ハッシュチェーンでつないで記録する（背後の意図はハッシュされ、保持されない）。廃止済みなら例外を投げる。 |
| `get_audit_trail()` | `() -> list[dict]` | エージェントの監査証跡を返す |
| `commission(purpose, capabilities, risk_tier)` | `(str, list?, str?) -> dict` | エージェントを稼働させる（DCP-05 §3.1） |
| `report_vitality(metrics)` | `(dict) -> dict` | バイタリティの指標を報告する（DCP-05 §4.1） |
| `decommission(mode, reason)` | `(str, str) -> dict` | エージェントを廃止する（DCP-05 §5.1） |
| `create_testament(successor_preferences, memory_classification)` | `(list, str) -> dict` | デジタル遺言を作る（DCP-06 §3.1） |

#### `log_action`

```python
entry = researcher.log_action(
    action_type="api_call",
    outcome="success",
    evidence={"url": "https://api.example.com", "status": 200},
)
# entry contains chained intent_hash and prev_hash
```

各監査エントリーには次が含まれます：

- `intent_hash`：関連する意図の SHA-256
- `prev_hash`：最初のエントリーでは `"GENESIS"`、以降のエントリーでは直前のエントリーの SHA-256

### `DCPCrew`

DCP のガバナンスを持つマルチエージェントのクルーです。

```python
DCPCrew(
    agents: list[DCPCrewAgent],   # List of DCP agents
    session_nonce: str = "",      # Crew nonce, a fresh one when empty; given to every agent that has not logged and was not given its own
    verbose: bool = False,        # Verbose logging
)
```

<a id="methods-1"></a>
<a id="methods_1"></a>

#### メソッド

| メソッド | シグネチャ | 説明 |
|--------|-----------|-------------|
| `kickoff(task)` | `(str) -> dict` | タスクについてエージェントごとに 1 つの監査エントリーを記録する。CrewAI は実行しない |
| `get_combined_audit_trail()` | `() -> list[dict]` | すべてのエージェントを組み合わせた証跡、タイムスタンプ順 |
| `get_agent_bundles()` | `() -> dict[str, list[dict]]` | `agent_id` ごとの個別の証跡 |
| `commission_all(purpose?)` | `(str?) -> list[dict]` | クルーのすべてのエージェントを稼働させる（DCP-05 §3.1） |
| `succession(from_agent, to_agent)` | `(DCPCrewAgent, DCPCrewAgent) -> dict` | 承継の記録を作る（DCP-06 §4.1） |
| `delegate(human_id, agent, authority_scope)` | `(str, DCPCrewAgent, list) -> dict` | エージェントへの署名されていない委任の記録（DCP-09 §3.1）。署名されたマンデートは `dcp_ai.v2` の `create_delegation_mandate` で作る |
| `get_lifecycle_summary()` | `() -> list[dict]` | 各エージェントのライフサイクルの状態を得る |

### `get_combined_audit_trail()`

すべてのエージェントの監査証跡を組み合わせ、時系列に並べます。読むためのビューです。各エントリーは `_agent_role`
フィールドを加えたコピーで、このフィールドは V2 の監査エントリーの一部ではありません。組み合わせたリストはハッシュ
チェーンではありません（各エージェントのエントリーは、自身の証跡の中でだけつながります）。これらのコピーを監査
エントリーとして正規化、ハッシュ化、署名しないでください。

```python
combined = crew.get_combined_audit_trail()
# [
#   {"agent_id": "agent:researcher-001", "timestamp": "...", "intent_id": "...", "outcome": "...", "_agent_role": "researcher", ...},
#   {"agent_id": "agent:writer-001", "timestamp": "...", "intent_id": "...", "outcome": "...", "_agent_role": "writer", ...},
#   ...
# ]
```

### `get_agent_bundles()`

エージェントごとに分けた証跡を返します：

```python
bundles = crew.get_agent_bundles()
# {
#   "agent:researcher-001": [entry1, entry2, ...],
#   "agent:writer-001": [entry3, entry4, ...],
# }
```

<a id="per-agent-trails"></a>

## エージェントごとの証跡

クイックスタートの続きで、各エージェントは自身のハッシュチェーンでつながった証跡を保持します：

```python
crew = DCPCrew(agents=[researcher, writer])
crew.kickoff(task="Analyze the AI market")

# Unsigned records: seal signed bundles with the core SDK (docs/QUICKSTART_CREWAI.md)
for agent_id, trail in crew.get_agent_bundles().items():
    print(f"\n--- {agent_id} ({len(trail)} entries) ---")
    for entry in trail:
        print(f"  {entry['intent_id']}: {entry['outcome']}")
```

<a id="development"></a>

## 開発

チェックアウトから：

```bash
cd sdks/python
pip install -e ".[crewai,dev]"
pytest -v
```

<a id="dependencies"></a>

### 依存関係

- `dcp-ai` — DCP の SDK（merkle、models、bundle）
- `crewai` — マルチエージェントのフレームワーク（extra がインストールする。`dcp_ai.crewai` 自体はインポートしない）

<a id="license"></a>

## ライセンス

Apache-2.0
