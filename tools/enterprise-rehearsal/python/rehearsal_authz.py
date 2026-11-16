"""Application authorization of the MP-05 rehearsal (TEST ONLY). Mirrors node/authz.mjs.

Runs after the SDK admitted the evidence. Both the operator policy and, on the delegated route, the scope of every
mandate of the chain must allow the action; the request arguments must match the signed intent. Nothing the agent
sends widens the policy. Python parses JSON 100.0 as a float and true as a bool: neither is an amount here.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

from dcp_ai.v2 import canonicalize_v2

MAX_SAFE = 9007199254740991


def _fail(code: str, detail: str) -> dict:
    return {"ok": False, "code": code, "detail": detail}


def _int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _same_members(o: dict, members: list) -> bool:
    return sorted(o.keys()) == sorted(members)


def args_sha256(args: Any) -> str:
    return "sha256:" + hashlib.sha256(canonicalize_v2(args).encode("utf-8")).hexdigest()


def route_path(contract: dict, route: str, action: str) -> str:
    return contract["routes"][route]["path"].replace("{action}", action)


def check_args(contract: dict, args: Any) -> str | None:
    spec = contract["args"]
    if not isinstance(args, dict) or not _same_members(args, spec["members"]):
        return "members"
    if not isinstance(args["sku"], str) or re.fullmatch(spec["sku_pattern"], args["sku"]) is None:
        return "sku"
    a = args["amount"]
    if not _int(a) or a < spec["amount"]["minimum"] or a > spec["amount"]["maximum"]:
        return "amount"
    if not isinstance(args["currency"], str) or args["currency"] not in spec["currencies"]:
        return "currency"
    return None


def check_intent(contract: dict, policy: dict, route: str, action: str, args: dict, intent: Any) -> str | None:
    a = contract["actions"][action]
    if not isinstance(intent, dict):
        return "intent"
    if intent.get("action_type") != a["action_type"]:
        return "action_type"
    t = intent.get("target")
    if not isinstance(t, dict) or not _same_members(t, contract["intent_binding"]["target_members"]):
        return "target"
    if t["channel"] != a["channel"]:
        return "target.channel"
    if t["domain"] != policy["domain"]:
        return "target.domain"
    if t["url"] != route_path(contract, route, action):
        return "target.url"
    x = t["x_rehearsal"]
    if not isinstance(x, dict) or not _same_members(x, contract["intent_binding"]["x_rehearsal_members"]):
        return "target.x_rehearsal"
    if x["action"] != action:
        return "target.x_rehearsal.action"
    if x["args_sha256"] != args_sha256(args):
        return "target.x_rehearsal.args_sha256"
    dc = intent.get("data_classes")
    if not isinstance(dc, list) or not all(isinstance(c, str) for c in dc) or len(set(dc)) != len(dc):
        return "data_classes"
    if set(dc) != set(a["data_classes"]):
        return "data_classes"
    return None


def authorize(
    contract: dict,
    policy: dict,
    route: str,
    action: Any,
    args: Any,
    intent: Any,
    *,
    agent_id: Any = None,
    principal_id: Any = None,
    chain: Any = None,
) -> dict:
    if route not in contract["routes"]:
        return _fail("APP_ACTION_NOT_AUTHORIZED", "route")
    if not isinstance(action, str) or action not in contract["actions"]:
        return _fail("APP_ACTION_NOT_AUTHORIZED", "unknown action")
    bad_args = check_args(contract, args)
    if bad_args:
        return _fail("APP_ARGS_INVALID", bad_args)
    bad_intent = check_intent(contract, policy, route, action, args, intent)
    if bad_intent:
        return _fail("APP_INTENT_MISMATCH", bad_intent)

    table = policy.get("direct_agents") if route == "direct" else policy.get("delegated_principals")
    actor = agent_id if route == "direct" else principal_id
    allowed = table.get(actor) if isinstance(table, dict) and isinstance(actor, str) else None
    if not isinstance(allowed, list) or action not in allowed:
        return _fail("APP_ACTION_NOT_AUTHORIZED", "operator policy")
    caps = policy.get("max_amount")
    cap = caps.get(action) if isinstance(caps, dict) else None
    if not _int(cap) or not 0 <= cap <= MAX_SAFE:
        return _fail("APP_ACTION_NOT_AUTHORIZED", "no operator cap")
    if args["amount"] > cap:
        return _fail("APP_ARGS_OUT_OF_SCOPE", "operator cap")
    limit = cap

    if route == "delegated":
        if not isinstance(chain, list) or not chain:
            return _fail("APP_DELEGATION_NOT_ACTIVE", "no chain")
        for i, m in enumerate(chain):
            at = f"mandate {i}"
            scope = m.get("authority_scope") if isinstance(m, dict) else None
            entries = [e for e in scope if isinstance(e, dict) and e.get("domain") == policy["domain"]] if isinstance(scope, list) else []
            if len(entries) != 1:
                return _fail("APP_DOMAIN_OUT_OF_SCOPE", at)
            e = entries[0]
            if not isinstance(e.get("actions_permitted"), list) or action not in e["actions_permitted"]:
                return _fail("APP_ACTION_OUT_OF_SCOPE", at)
            if not isinstance(e.get("data_classes"), list) or not all(c in e["data_classes"] for c in intent["data_classes"]):
                return _fail("APP_DATA_CLASS_OUT_OF_SCOPE", at)
            if "limits" in e:
                if not isinstance(e["limits"], dict):
                    return _fail("APP_ARGS_OUT_OF_SCOPE", f"{at} limits")
                if "max_amount" in e["limits"]:
                    mx = e["limits"]["max_amount"]
                    if not _int(mx) or not 0 <= mx <= MAX_SAFE or args["amount"] > mx:
                        return _fail("APP_ARGS_OUT_OF_SCOPE", f"{at} max_amount")
                    limit = min(limit, mx)
    return {
        "ok": True,
        "action": action,
        "amount": args["amount"],
        "single_use": contract["actions"][action]["single_use"],
        "limit": limit,
    }
