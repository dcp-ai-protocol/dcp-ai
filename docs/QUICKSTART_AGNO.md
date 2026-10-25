# Quickstart: Agno + DCP-AI

[Agno](https://www.agno.com/) is a Python framework and runtime for building AI agents. The [`agno-dcp`](https://github.com/dcp-ai-protocol/agno-dcp) integration wraps Agno's `Agent`, `Team`, `Workflow`, and MCP primitives with governance modelled on DCP-01 to DCP-04: a signed agent identity record, signed policy decisions, a hash-linked audit chain with signed root checkpoints, and signed MCP messages.

> **▸ See it running:** [agno-dcp-demo.fly.dev](https://agno-dcp-demo.fly.dev) — a banking collections workflow with one-click scenarios, a live audit log over Server-Sent Events, and signed Compliance Bundle export. Source: [`dcp-ai-protocol/agno-dcp-demo`](https://github.com/dcp-ai-protocol/agno-dcp-demo).

Unlike the other Python integrations (`dcp-ai[fastapi]`, `dcp-ai[langchain]`, ...), `agno-dcp` ships as a **separate package** because it depends on Agno as a peer dependency. It requires `dcp-ai>=2.8.1` and signs with that SDK's Ed25519 `sign_object` (canonicalization `dcp-jcs-v1`), so each signature it makes can be checked with `verify_object` in any DCP-AI SDK.

> **What `agno-dcp` 0.1.0 produces (checked against its source on 25/10/2026).**
>
> * Its records (the `CitizenshipBundle` identity record, audit entries and roots, the compliance ZIP) are `agno-dcp` formats. They are **not** DCP V1 or V2 signed bundles, so `dcp verify-bundle` and `verifySignedBundleV2` do not accept them. To produce normative bundles, use the SDK quickstarts ([QUICKSTART.md](QUICKSTART.md)).
> * Its signatures (identity record, intents, policy decisions, MCP messages, sealed roots, compliance manifest) use Ed25519 only, whatever `dcp_security_tier` says. `tier-3` and `tier-4` are recorded, but the 0.1.0 code makes no ML-DSA-65 signature, even though its README describes an Ed25519 + ML-DSA-65 hybrid. Audit entries are not signed one by one: they are linked by hashes, and only the sealed roots carry a signature.

The full source, end-to-end design notes, and API reference live in the dedicated repository: <https://github.com/dcp-ai-protocol/agno-dcp>. This page is a 60-second onramp.

---

## Install

> **Package state (25/10/2026).** PyPI has one release of `agno-dcp`, 0.1.0. It is an **early access** release: its README says it is not yet recommended for production deployments that handle regulated data. The examples on this page were checked statically against the 0.1.0 source (exported names, keyword arguments, CLI flags). They were not run here, because running them needs Agno and a model provider.

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

This is a fragment: `crm_lookup` and `payment_plan_offer` are your own Agno tool functions, and `model` is passed to Agno unchanged, so give a model your Agno version accepts.

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

A fragment that continues inside the `async` function above (`collections_agent`, `risk_agent` and `evaluate_credit_fn` are yours):

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

A `DCPTeam` makes its `DCPAgent` members write to the team's audit chain. A `DCPWorkflow` uses the chain you pass as `dcp_audit_chain`; without one it starts its own in-memory chain. Passing the same chain to both gives an auditor one ordering of agent actions and team coordination.

---

## Verify an audit chain offline

```bash
agno-dcp verify --sqlite ./agent.db
agno-dcp verify --postgres-url $DATABASE_URL --agent-id agent:abc123 --range 0:1000
```

The CLI recomputes every `entry_hash`, checks the `prev_hash` linkage, and checks the signature of the **latest** sealed root against the public key stored in that root. It exits non-zero when the hash chain breaks or that signature is invalid.

An exit code of 0 is not a full check of the roots in 0.1.0:

* only the latest root is looked at;
* a root record that does not parse is listed under `notes` and skipped, and the exit code ignores `notes`, so read them (or `--json`);
* the root is not compared with the entries, and its key is not compared with one you trust. So someone who can write to the database can rewrite entries, recompute the hashes and seal a new root with a new key, and the check still passes. Keep the audit signer's public key and the sealed roots outside the database, and compare them yourself.

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

The archive contains the audit log in index order, every sealed Merkle root, the relevant Citizenship Bundles, and the framework mapping (EU AI Act articles 12, 13, 14, 15, 50, or NIST AI RMF Govern/Map/Measure/Manage subcategories). Its `manifest.json` carries a hash of the archive contents and is signed with the audit chain's key, so an auditor can detect changes made between export and review.

---

## Production deployment

Swap `SQLiteStorage` for `PostgresStorage` and the application code stays identical:

```python
import os

from agno_dcp import PostgresStorage  # requires the [postgres] extra

# For example postgresql+psycopg://host/db, with credentials kept out of the code.
storage = PostgresStorage(os.environ["DATABASE_URL"])
await storage.initialize()
audit = MerkleAuditChain(storage=storage)
```

`PostgresStorage` is loaded on first use, so it is not listed in `agno_dcp.__all__`, but `from agno_dcp import PostgresStorage` works once the extra is installed. The bundled idempotent schema (`agno_dcp/storage/schema.sql`) reuses the same database that hosts Agno's own tables; the `dcp_*` prefix on every table avoids collisions.

---

## Status

`agno-dcp v0.1.0` (April 2026) is an **early access** release, suitable for evaluation, demo work, and internal pilots. Its public contract is the list in `agno_dcp/__init__.py`. The upstream README lists DCP-05 through DCP-09 (lifecycle, succession, dispute, rights, delegation) and hardware-backed key custody (AWS KMS, GCP Cloud KMS) as future work.

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
* [DCP-AI v2.0 spec](../spec/DCP-AI-v2.0.md) for the protocol-level normative reference.
