<sub>[English](QUICKSTART_AGNO.md) · [中文](QUICKSTART_AGNO.zh-CN.md) · [Español](QUICKSTART_AGNO.es.md) · **日本語** · [Português](QUICKSTART_AGNO.pt-BR.md)</sub>

<a id="quickstart-agno--dcp-ai"></a>
<a id="quickstart-agno-dcp-ai"></a>

# クイックスタート：Agno + DCP-AI

> [英語版](QUICKSTART_AGNO.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

[Agno](https://www.agno.com/) は、AI エージェントを構築するための Python のフレームワーク兼ランタイムです。[`agno-dcp`](https://github.com/dcp-ai-protocol/agno-dcp) の統合は、Agno の `Agent`、`Team`、`Workflow`、MCP のプリミティブを、DCP-01 から DCP-04 をモデルにしたガバナンスで包みます。署名済みのエージェントのアイデンティティレコード、署名済みのポリシー判断、署名済みのルートチェックポイントを持つハッシュで連結された監査チェーン、署名済みの MCP メッセージです。

> **▸ 動作を見る：** [agno-dcp-demo.fly.dev](https://agno-dcp-demo.fly.dev) — ワンクリックのシナリオ、Server-Sent Events によるライブの監査ログ、署名済みの Compliance Bundle のエクスポートを備えた、銀行の債権回収のワークフローです。ソース：[`dcp-ai-protocol/agno-dcp-demo`](https://github.com/dcp-ai-protocol/agno-dcp-demo)。

ほかの Python の統合（`dcp-ai[fastapi]`、`dcp-ai[langchain]` など）とは異なり、`agno-dcp` は Agno をピア依存関係とするため、**別パッケージ**として配布されています。`dcp-ai>=2.8.1` を必要とし、その SDK の Ed25519 の `sign_object`（正規化 `dcp-jcs-v1`）で署名するため、生成される各署名はどの DCP-AI SDK の `verify_object` でも確認できます。

> **`agno-dcp` 0.1.0 が生成するもの（2026 年 10 月 25 日にソースと照合して確認）。**
>
> * そのレコード（`CitizenshipBundle` のアイデンティティレコード、監査エントリとルート、コンプライアンスの ZIP）は `agno-dcp` 独自の形式です。DCP V1 や V2 の署名済みバンドルでは**ない**ため、`dcp verify-bundle` も `verifySignedBundleV2` も受け付けません。規範的なバンドルを作るには、SDK のクイックスタート（[QUICKSTART.md](QUICKSTART.md)）を使ってください。
> * その署名（アイデンティティレコード、意図、ポリシー判断、MCP メッセージ、封印されたルート、コンプライアンスのマニフェスト）は、`dcp_security_tier` の値にかかわらず Ed25519 のみです。`tier-3` と `tier-4` は記録されますが、README には Ed25519 + ML-DSA-65 のハイブリッドと書かれているにもかかわらず、0.1.0 のコードは ML-DSA-65 の署名を一切行いません。監査エントリは 1 件ずつ署名されるのではなくハッシュで連結され、署名を持つのは封印されたルートだけです。

完全なソース、エンドツーエンドの設計メモ、API リファレンスは専用のリポジトリにあります：<https://github.com/dcp-ai-protocol/agno-dcp>。このページは 60 秒の入門です。

---

<a id="install"></a>

## インストール

> **パッケージの状況（2026 年 10 月 25 日）。** PyPI にある `agno-dcp` のリリースは 0.1.0 の 1 つだけです。これは**アーリーアクセス**のリリースで、その README には、規制対象のデータを扱う本番デプロイにはまだ推奨されないと書かれています。このページの例は、0.1.0 のソースと静的に照合しました（エクスポートされた名前、キーワード引数、CLI のフラグ）。実行には Agno とモデルのプロバイダーが必要なため、ここでは実行していません。

```bash
pip install agno-dcp
```

Postgres をバックエンドとするストレージで本番運用する場合：

```bash
pip install "agno-dcp[postgres]"
```

Python 3.11 以上が必要です。Agno 自体はピア依存関係なので、好みのバージョンの Agno を別途インストールしてください。

---

<a id="wrap-an-agno-agent"></a>

## Agno のエージェントを包む

これは断片です。`crm_lookup` と `payment_plan_offer` は自分で用意する Agno のツール関数で、`model` はそのまま Agno に渡されるので、お使いの Agno のバージョンが受け付けるモデルを指定してください。

```python
import asyncio

from agno_dcp import (
    DCPAgent,
    PolicyEngine,
    MerkleAuditChain,
    SQLiteStorage,
)


async def main() -> None:
    # 1. Storage and audit chain (DCP-03)
    storage = SQLiteStorage("./agent.db")
    audit = MerkleAuditChain(storage=storage)

    # 2. Policy engine from a YAML file (DCP-02)
    policy = PolicyEngine.from_yaml("policies.yaml")

    # 3. Wrap an Agno Agent
    agent = DCPAgent(
        # Native Agno arguments (forwarded as-is)
        name="Collections Agent",
        model="claude:sonnet-4",
        tools=[crm_lookup, payment_plan_offer],
        instructions="You help customers reschedule overdue invoices.",
        # DCP-AI governance arguments
        dcp_human_principal="ops@example.com",
        dcp_security_tier="tier-3",
        dcp_audit_chain=audit,
        dcp_policy_engine=policy,
        dcp_strict_mode=True,
    )
    await agent.dcp_initialize()

    # 4. Run a tool through the full DCP-AI pipeline:
    #    intent + policy gate + tool execution + audit
    result = await agent.run_tool(
        crm_lookup,
        {"customer_id": 12345},
    )

    # 5. Periodically seal a signed root checkpoint
    root = await audit.seal_root()
    print(f"Sealed Merkle root: {root.root_hash}, entries: {root.entry_count}")


asyncio.run(main())
```

対応する `policies.yaml`：

```yaml
version: "1.0"
default: deny
rules:
  - name: "Allow CRM lookups"
    when:
      action_type: tool_call
      tool_name: crm_lookup
    then: allow

  - name: "Limit payment discounts"
    when:
      action_type: tool_call
      tool_name: payment_plan_offer
      payload.discount_pct:
        gt: 20
    then: deny
    reason: "Discounts above 20% require human approval"
```

マッチャーはドット区切りのパス（`payload.discount_pct`）と、演算子 `eq`、`ne`、`gt`、`gte`、`lt`、`lte`、`in`、`nin` に対応しています。最初に一致したルールが優先され、どれにも一致しない場合は `default` の判定が適用されます。

---

<a id="what-run_tool-does-under-the-hood"></a>

## `run_tool` が内部で行うこと

```
DCPAgent.run_tool(tool, args)
  ├── 1. Build and sign IntentDeclaration with the agent's keypair
  ├── 2. PolicyGate.evaluate
  │      ├── verify intent signature
  │      ├── PolicyEngine.evaluate -> signed PolicyDecision
  │      ├── persist intent + decision
  │      └── append INTENT_DECLARED + POLICY_DECISION audit events
  ├── 3. If deny + strict_mode -> raise PolicyDenied
  ├── 4. Execute tool (sync or async)
  ├── 5. Append TOOL_EXECUTED (or ERROR) audit event
  └── 6. Return tool result
```

厳格モードと観察モード：

* `dcp_strict_mode=True`：拒否の判定は `PolicyDenied` を送出し、ツールは実行されません。
* `dcp_strict_mode=False`（既定）：拒否はログに記録され監査されますが、ツールはそのまま実行されます。ポリシーを整える前に監査証跡がほしい導入時に便利です。

---

<a id="teams-and-workflows"></a>

## チームとワークフロー

上の `async` 関数の中で続く断片です（`collections_agent`、`risk_agent`、`evaluate_credit_fn` は自分で用意します）。

```python
from agno_dcp import DCPTeam, DCPWorkflow

team = DCPTeam(
    dcp_team_name="Collections + Risk",
    dcp_human_principal="ops@example.com",
    members=[collections_agent, risk_agent],
    dcp_audit_chain=audit,  # shared chain across the team
)
await team.dcp_initialize()

workflow = DCPWorkflow(
    dcp_workflow_id="escalation",
    dcp_human_principal="ops@example.com",
    dcp_audit_chain=audit,
    dcp_strict_mode=True,
)
await workflow.dcp_initialize()
result = await workflow.run_step("evaluate_credit", evaluate_credit_fn, {"amount": 5000})
```

`DCPTeam` は、メンバーの `DCPAgent` にチームの監査チェーンへ書き込ませます。`DCPWorkflow` は `dcp_audit_chain` として渡したチェーンを使い、渡さなければ独自のメモリー内のチェーンを開始します。両方に同じチェーンを渡すと、監査人はエージェントのアクションとチームの連携を 1 つの順序で確認できます。

---

<a id="verify-an-audit-chain-offline"></a>

## 監査チェーンをオフラインで検証する

```bash
agno-dcp verify --sqlite ./agent.db
agno-dcp verify --postgres-url $DATABASE_URL --agent-id agent:abc123 --range 0:1000
```

CLI はすべての `entry_hash` を再計算し、`prev_hash` の連結を確認し、**最新の**封印されたルートの署名を、そのルートに保存された公開鍵で確認します。ハッシュのチェーンが壊れているか、その署名が無効な場合は、0 以外の終了コードを返します。

0.1.0 では、終了コード 0 はルートの完全な確認を意味しません。

* 確認されるのは最新のルートだけです。
* 解析できないルートのレコードは `notes` に挙げられて読み飛ばされ、終了コードは `notes` を無視するので、`notes` を読んでください（または `--json` を使ってください）。
* ルートはエントリと照合されず、その鍵もあなたが信頼する鍵と照合されません。そのため、データベースに書き込める人は、エントリを書き換え、ハッシュを再計算し、新しい鍵で新しいルートを封印でき、それでも確認は通ってしまいます。監査の署名者の公開鍵と封印されたルートはデータベースの外に保管し、自分で照合してください。

---

<a id="compliance-bundle-export"></a>

## コンプライアンスバンドルのエクスポート

監査人への引き渡しには、署名済みの ZIP を送ります。

```python
from pathlib import Path
from agno_dcp import ComplianceBundleExporter

exporter = ComplianceBundleExporter(audit, storage)
zip_path = await exporter.export(
    framework="eu_ai_act",   # or "nist_ai_rmf"
    output_dir=Path("./bundles"),
)
```

アーカイブには、インデックス順の監査ログ、封印されたすべてのマークルルート、関連する Citizenship Bundle、フレームワークとの対応（EU AI 法の第 12、13、14、15、50 条、または NIST AI RMF の Govern/Map/Measure/Manage のサブカテゴリー）が含まれます。その `manifest.json` はアーカイブの内容のハッシュを持ち、監査チェーンの鍵で署名されているため、監査人はエクスポートからレビューまでの間に加えられた変更を検出できます。

---

<a id="production-deployment"></a>

## 本番デプロイ

`SQLiteStorage` を `PostgresStorage` に置き換えても、アプリケーションのコードは同じままです。

```python
import os

from agno_dcp import PostgresStorage  # requires the [postgres] extra

# For example postgresql+psycopg://host/db, with credentials kept out of the code.
storage = PostgresStorage(os.environ["DATABASE_URL"])
await storage.initialize()
audit = MerkleAuditChain(storage=storage)
```

`PostgresStorage` は初回使用時に読み込まれるため `agno_dcp.__all__` には載っていませんが、extra をインストールすれば `from agno_dcp import PostgresStorage` が使えます。同梱の冪等なスキーマ（`agno_dcp/storage/schema.sql`）は、Agno 自身のテーブルがあるのと同じデータベースを再利用します。すべてのテーブルに付く `dcp_*` の接頭辞が衝突を防ぎます。

---

<a id="status"></a>

## 状況

`agno-dcp v0.1.0`（2026 年 4 月）は**アーリーアクセス**のリリースで、評価、デモ、社内のパイロットに適しています。その公開の契約は `agno_dcp/__init__.py` にある一覧です。上流の README は、DCP-05 から DCP-09（ライフサイクル、継承、紛争、権利、委任）と、ハードウェアによる鍵の保管（AWS KMS、GCP Cloud KMS）を今後の作業として挙げています。

レジストリでのパッケージの状況：

* PyPI：<https://pypi.org/project/agno-dcp/>
* ソース：<https://github.com/dcp-ai-protocol/agno-dcp>
* CI の状況：リポジトリの GitHub Actions タブで確認できます。

---

<a id="further-reading"></a>

## 関連資料

* 完全なクイックスタートと比較表は [agno-dcp の README](https://github.com/dcp-ai-protocol/agno-dcp#readme)。
* 導入の意義（採用すべきとき、すべきでないとき）は [agno-dcp の `docs/why.md`](https://github.com/dcp-ai-protocol/agno-dcp/blob/main/docs/why.md)。
* レイヤー図とフックの意味は [agno-dcp の `docs/architecture.md`](https://github.com/dcp-ai-protocol/agno-dcp/blob/main/docs/architecture.md)。
* EU AI 法と NIST AI RMF への対応は [agno-dcp の `docs/compliance_mapping.md`](https://github.com/dcp-ai-protocol/agno-dcp/blob/main/docs/compliance_mapping.md)。
* プロトコルレベルの規範的なリファレンスは [DCP-AI v2.0 の仕様](../spec/DCP-AI-v2.0.md)。
