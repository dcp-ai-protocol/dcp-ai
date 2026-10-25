<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai--crewai-template"></a>
<a id="dcp-ai-crewai-template"></a>

# DCP-AI + CrewAI のテンプレート

> [英語版](README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

マルチエージェントのクルーのための DCP v2.0 のプロトコルの流れを示します。このテンプレートは、すべてのエージェントが DCP のパスポートを受け取り、すべての行動が監査される、CrewAI 風のマルチエージェントのワークフローをシミュレートします。

> **注記：** このテンプレートは、実行時に CrewAI や dcp-ai のライブラリに依存せずに、DCP のデータ構造とライフサイクルを示します。自分の CrewAI のプロジェクトに DCP を組み込むための参考となる、独立した Python のシミュレーションです。本当の鍵と署名には、[docs/QUICKSTART_CREWAI.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_CREWAI.md) に従ってください。

<a id="quick-start"></a>

## クイックスタート

1. 依存関係をインストールします（任意 — テンプレートはそれらなしでも動きます）：
   ```bash
   pip install -r requirements.txt
   ```

2. シミュレーションを実行します：
   ```bash
   python main.py
   ```

<a id="what-this-template-does"></a>

## このテンプレートがすること

- すべてのエージェントが DCP v2.0 のパスポートを持つマルチエージェントのクルーをシミュレートする
- 各エージェントの行動は Intent → PolicyDecision → AuditEntry を生成する。ポリシーの手順はスタブで、`evaluate_policy`
  は常に `approve`（リスク 75）を返す
- クルーの実行は、**プレースホルダー**の鍵と署名（`«generated»`、`«sig»`）を持つ Citizenship Bundle を作る。何にも署名されず、バンドルは検証を通らない
- DCP v2.0 のデータの流れを示す：セッションの nonce、鍵のエントリー、マニフェスト、複合署名のフィールド

<a id="files"></a>

## ファイル

- `main.py` — マルチエージェントの DCP の流れのシミュレーション（独立した Python）
- `requirements.txt` — Python の依存関係（本当の CrewAI と DCP の SDK との統合用）

<a id="integrating-with-real-crewai"></a>

## 本当の CrewAI との統合

本当の CrewAI のクルーに DCP を組み込むには、各エージェントのタスクの実行を、`main.py` に示す DCP のライフサイクルで包みます：

```python
# Fragment: agent and task are your CrewAI objects; DCPCrewMember comes from main.py
from crewai import Agent, Task, Crew

# Use the DCP helpers from main.py to wrap agent actions
member = DCPCrewMember(name="researcher", role="analyst")

# Before each task: declare intent + get policy
intent = member.declare_intent("api_call", "api", "api.openai.com")
policy = member.evaluate_policy(intent)
if policy["decision"] != "approve":
    raise RuntimeError(f"DCP policy decision: {policy['decision']}")  # do not run the task

# Execute the CrewAI task
crew = Crew(agents=[agent], tasks=[task])
result = crew.kickoff()

# After each task: log audit entry
member.log_action(intent, policy, str(result), "crewai.task")
```
