# Quickstart: Agno + DCP-AI

[Agno](https://www.agno.com/) is a Python framework and runtime for building AI agents. The [`agno-dcp`](https://github.com/dcp-ai-protocol/agno-dcp) integration wraps Agno's `Agent`, `Team`, `Workflow`, and MCP primitives with the full DCP-AI governance stack: cryptographic identity (DCP-01), signed policy gating (DCP-02), tamper-evident audit (DCP-03), and signed inter-agent messaging (DCP-04).

Unlike the other Python integrations (`dcp-ai[fastapi]`, `dcp-ai[langchain]`, ...), `agno-dcp` ships as a **separate package** because it depends on Agno as a peer dependency. The cryptographic primitives are imported from `dcp-ai>=2.8.1` so bundles produced by `agno-dcp` are byte-exact compatible with every DCP-AI verifier.

The full source, end-to-end design notes, and API reference live in the dedicated repository: <https://github.com/dcp-ai-protocol/agno-dcp>. This page is a 60-second onramp.

---

## Install

```bash
pip install agno-dcp
```

For production with Postgres-backed storage:

```bash
pip install "agno-dcp[postgres]"
```

Requires Python 3.11+. Agno itself is a peer dependency; install your preferred Agno version separately.

---

## Wrap an Agno agent

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

    # 5. Periodically seal a tamper-evident root signature
    root = await audit.seal_root()
    print(f"Sealed Merkle root: {root.root_hash}, entries: {root.entry_count}")


asyncio.run(main())
```

The corresponding `policies.yaml`:

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

The matcher supports dotted paths (`payload.discount_pct`) and the operators `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`. The first matching rule wins; if none match, the `default` verdict applies.

---

## What `run_tool` does under the hood

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

Strict vs observation mode:

* `dcp_strict_mode=True`: a deny verdict raises `PolicyDenied` and the tool does not run.
* `dcp_strict_mode=False` (default): the deny is logged and audited, but the tool still runs. Useful for onboarding when you want audit trails before you have policy coverage.

---

## Teams and workflows

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

Both wrappers reuse the team's audit chain so an external auditor sees a coherent ordering of agent actions and team coordination.

---

## Verify an audit chain offline

```bash
agno-dcp verify --sqlite ./agent.db
agno-dcp verify --postgres-url $DATABASE_URL --agent-id agent:abc123 --range 0:1000
```

The CLI walks the chain, recomputes every `entry_hash`, validates the `prev_hash` linkage, and verifies the embedded signature on every sealed Merkle root. Exits non-zero on corruption.

---

## Compliance bundle export

For auditor handoff, ship a signed ZIP:

```python
from pathlib import Path
from agno_dcp import ComplianceBundleExporter

exporter = ComplianceBundleExporter(audit, storage)
zip_path = await exporter.export(
    framework="eu_ai_act",   # or "nist_ai_rmf"
    output_dir=Path("./bundles"),
)
```

The archive contains the audit log in index order, every sealed Merkle root, the relevant Citizenship Bundles, and the framework mapping (EU AI Act articles 12, 13, 14, 15, 50, or NIST AI RMF Govern/Map/Measure/Manage subcategories). The whole archive is signed with the audit chain's keypair so an auditor detects tampering between export and review.

---

## Production deployment

Swap `SQLiteStorage` for `PostgresStorage` and the application code stays identical:

```python
from agno_dcp import PostgresStorage  # requires the [postgres] extra

storage = PostgresStorage("postgresql+psycopg://user:pass@host/db")
await storage.initialize()
audit = MerkleAuditChain(storage=storage)
```

The bundled idempotent schema (`agno_dcp/storage/schema.sql`) reuses the same database that hosts Agno's own tables; the `dcp_*` prefix on every table avoids collisions.

---

## Status

`agno-dcp v0.1.0` (April 2026) is an **early access** release. Suitable for evaluation, demo work, and internal pilots. End-to-end demo, AWS / GCP KMS key custody, and DCP-05 through DCP-09 (lifecycle, succession, dispute, rights, delegation) are scheduled for future minor releases.

Status of the package on the registries:

* PyPI: <https://pypi.org/project/agno-dcp/>
* Source: <https://github.com/dcp-ai-protocol/agno-dcp>
* CI status: visible on the GitHub Actions tab of the repo.

---

## Further reading

* [agno-dcp README](https://github.com/dcp-ai-protocol/agno-dcp#readme) for the full quickstart and comparison table.
* [agno-dcp `docs/why.md`](https://github.com/dcp-ai-protocol/agno-dcp/blob/main/docs/why.md) for the pitch (when to adopt it, when not to).
* [agno-dcp `docs/architecture.md`](https://github.com/dcp-ai-protocol/agno-dcp/blob/main/docs/architecture.md) for the layered diagram and hook semantics.
* [agno-dcp `docs/compliance_mapping.md`](https://github.com/dcp-ai-protocol/agno-dcp/blob/main/docs/compliance_mapping.md) for the EU AI Act and NIST AI RMF mappings.
* [DCP-AI v2.0 spec](DCP-AI-v2.0.md) for the protocol-level normative reference.
