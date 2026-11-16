"""Cross-SDK check of P2a (TEST ONLY): evaluates the cases the Node tests wrote, with the installed Python SDK and the
Python authorization and ledger helpers of this kit, and prints one result per case as JSON.

    <consumer>/python/bin/python -I python/cross_check.py CASES.json
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from rehearsal_authz import authorize  # noqa: E402
from rehearsal_ledger import action_key  # noqa: E402
from rehearsal_sources import (  # noqa: E402
    agent_key_snapshot,
    assert_installed_sdk,
    composition_subjects,
    load_contract,
    mandate_snapshot,
)

from dcp_ai.providers import Ed25519Provider, MlDsa65Provider  # noqa: E402
from dcp_ai.v2 import AlgorithmRegistry, admit_signed_bundle_v2, evaluate_delegation_activation_v2  # noqa: E402


def registry() -> AlgorithmRegistry:
    r = AlgorithmRegistry()
    r.register_signer(Ed25519Provider())
    r.register_signer(MlDsa65Provider())
    return r


async def run_case(c: dict, contract: dict, reg: AlgorithmRegistry) -> dict:
    now_ms = int(time.time() * 1000)
    op = c["operator"]
    ev = c["evidence"]
    out: dict = {"name": c["name"]}
    if c["route"] == "delegated":
        evidence = {
            "signed_bundle": ev["signedBundle"],
            "mandate_chain": ev["mandateChain"],
            "delegator_bundles": ev["delegatorBundles"],
            "acknowledgments": ev["acknowledgments"],
            "awareness_thresholds": ev["awarenessThresholds"],
        }
        operator = {
            "trust": op["trust"],
            "profile": op["profile"],
            "revocation": agent_key_snapshot(op["deny_list"], composition_subjects(evidence)),
            "mandate_revocation": mandate_snapshot(op["mandate_list"], evidence["mandate_chain"]),
            "now_ms": now_ms,
        }
        r = await evaluate_delegation_activation_v2(evidence, reg, operator)
        comp = r["composition"]
        out.update(
            admitted=comp["admitted"],
            delegation_active=r["delegation_active"],
            action_authorized=r["action_authorized"] or comp["action_authorized"],
            composition_codes=sorted({e["code"] for e in comp["errors"]}),
            activation_codes=[e["code"] for e in r["errors"]],
            verified=[a["verified"] for a in r["acknowledgments"]],
        )
        if comp["admitted"] and not r["delegation_active"]:
            out.update(app="APP_DELEGATION_NOT_ACTIVE", ledger_key=None)
            return out
        passed = comp["admitted"]
        chain = evidence["mandate_chain"]
    else:
        bundle = ev["signedBundle"]
        r = await admit_signed_bundle_v2(
            bundle,
            reg,
            profile=op["profile"],
            trust=op["trust"],
            revocation=agent_key_snapshot(op["deny_list"], composition_subjects(bundle)),
            now_ms=now_ms,
        )
        out.update(admitted=r["admitted"], action_authorized=r["action_authorized"], codes=sorted({e["code"] for e in r["errors"]}))
        passed = r["admitted"]
        chain = None
    if not passed:
        out.update(app=None, ledger_key=None)
        return out
    leaf = ev["signedBundle"]["bundle"]
    decision = authorize(
        contract,
        op["policy"],
        c["route"],
        c["action"],
        c["args"],
        leaf["intent"]["payload"],
        agent_id=leaf["agent_passport"]["payload"]["agent_id"],
        principal_id=leaf["responsible_principal_record"]["payload"]["human_id"],
        chain=chain,
    )
    out["app"] = "OK" if decision["ok"] else decision["code"]
    out["ledger_key"] = action_key(op["tenant"], leaf["intent"]["payload_hash"]) if decision["ok"] else None
    return out


async def main(path: str) -> None:
    assert_installed_sdk()
    contract = load_contract()
    reg = registry()
    cases = json.loads(Path(path).read_text(encoding="utf-8"))
    results = [await run_case(c, contract, reg) for c in cases]
    print(json.dumps(results))


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
