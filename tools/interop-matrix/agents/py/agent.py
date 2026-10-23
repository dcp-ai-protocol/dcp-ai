"""Python agent for tools/interop-matrix (protocol in ../../README.md).

Imports the LOCAL SDK source (sdks/python), put first on sys.path so a stale
installed dcp-ai never shadows it; its dependencies come from
`pip install -e sdks/python`.
"""
import asyncio
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "sdks" / "python"))

from dcp_ai.providers.ed25519_provider import Ed25519Provider  # noqa: E402
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider  # noqa: E402
from dcp_ai.v2.bundle import BundleBuilderV2, sign_bundle_v2  # noqa: E402
from dcp_ai.v2.canonicalize import canonicalize_v2  # noqa: E402
from dcp_ai.v2.composite_ops import CompositeKeyInfo, composite_sign  # noqa: E402
from dcp_ai.v2.crypto_registry import AlgorithmRegistry  # noqa: E402
from dcp_ai.v2.domain_separation import DCP_CONTEXTS  # noqa: E402
from dcp_ai.v2.dual_hash import sha256_hex  # noqa: E402
from dcp_ai.v2.security_tier import compute_security_tier  # noqa: E402
from dcp_ai.v2.session_nonce import generate_session_nonce  # noqa: E402
from dcp_ai.v2.signed_payload import prepare_payload  # noqa: E402
from dcp_ai.v2.verify import DEFAULT_VERIFIER_POLICY, verify_signed_bundle_v2  # noqa: E402

registry = AlgorithmRegistry()
registry.register_signer(Ed25519Provider())
registry.register_signer(MlDsa65Provider())

state = None


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sha256(text):
    return f"sha256:{sha256_hex(text.encode('utf-8'))}"


async def key_pair():
    pair = []
    for alg in ("ed25519", "ml-dsa-65"):
        k = await registry.get_signer(alg).generate_keypair()
        pair.append(CompositeKeyInfo(k["kid"], alg, k["secret_key_b64"], k["public_key_b64"]))
    return pair  # [classical, pq]


def entries(keys, at):
    return [
        {"kid": k.kid, "alg": k.alg, "public_key_b64": k.public_key_b64, "created_at": at, "expires_at": None, "status": "active"}
        for k in keys
    ]


async def signed(payload, context, keys):
    canonical_bytes, payload_hash = prepare_payload(payload)
    sig = await composite_sign(registry, DCP_CONTEXTS[context], canonical_bytes, *keys)
    return {"payload": payload, "payload_hash": payload_hash, "composite_sig": sig}


def lookup(intent_id):
    it = state["intents"].get(intent_id) if state else None
    if it is None:
        raise ValueError(f"unknown intent {intent_id}")
    return it


async def identity(owner_name, jurisdiction):
    global state
    human, agent = await key_pair(), await key_pair()
    at = now()
    nonce = generate_session_nonce()
    human_id = f"rpr:{uuid.uuid4()}"
    agent_id = f"agent:{uuid.uuid4()}"
    rpr = {
        "dcp_version": "2.0", "human_id": human_id, "session_nonce": nonce, "legal_name": owner_name,
        "entity_type": "natural_person", "jurisdiction": jurisdiction, "liability_mode": "owner_responsible",
        "override_rights": True, "issued_at": at, "expires_at": None, "contact": None,
        "binding_keys": entries(human, at),
    }
    passport = {
        "dcp_version": "2.0", "agent_id": agent_id, "session_nonce": nonce, "keys": entries(agent, at),
        "principal_binding_reference": human_id, "capabilities": ["api_call", "payments"],
        "risk_tier": "medium", "created_at": at, "status": "active",
    }
    state = {
        "human": human, "agent": agent, "nonce": nonce, "human_id": human_id, "agent_id": agent_id, "intents": {},
        "rpr": await signed(rpr, "ResponsiblePrincipal", human),
        "passport": await signed(passport, "AgentPassport", agent),
    }
    return {"agent_id": agent_id, "human_id": human_id, "session_nonce": nonce}


async def intent(action_type, channel, data_classes, estimated_impact, risk_score, applied_policy_hash):
    if state is None:
        raise ValueError("no identity")
    at = now()
    draft = {
        "dcp_version": "2.0", "intent_id": f"intent:{uuid.uuid4()}", "session_nonce": state["nonce"],
        "agent_id": state["agent_id"], "human_id": state["human_id"], "timestamp": at, "action_type": action_type,
        "target": {"channel": channel, "to": None}, "data_classes": data_classes,
        "estimated_impact": estimated_impact, "requires_consent": estimated_impact == "high",
    }
    tier = compute_security_tier(draft, {"risk_score": risk_score})
    payload = {**draft, "security_tier": tier}
    decision = "approve" if risk_score < 500 else "escalate" if risk_score < 800 else "block"
    policy = {
        "dcp_version": "2.0", "intent_id": payload["intent_id"], "session_nonce": state["nonce"],
        "decision": decision, "risk_score": risk_score, "reasons": [f"interop-matrix: risk_score {risk_score}"],
        "required_confirmation": None if decision == "approve" else {"type": "human_approve", "fields": ["action_type"]},
        "applied_policy_hash": applied_policy_hash, "timestamp": at, "resolved_tier": tier,
    }
    state["intents"][payload["intent_id"]] = {
        "intent": await signed(payload, "Intent", state["agent"]),
        "policy": await signed(policy, "PolicyDecision", state["agent"]),
        "trail": [],
    }
    return {"intent_id": payload["intent_id"], "decision": decision, "security_tier": tier}


async def act(intent_id, outcome, tool, result_ref):
    it = lookup(intent_id)
    trail = it["trail"]
    decision = it["policy"]["payload"]["decision"]
    trail.append({
        "dcp_version": "2.0", "audit_id": f"audit:{uuid.uuid4()}", "session_nonce": state["nonce"],
        "prev_hash": sha256(canonicalize_v2(trail[-1])) if trail else "GENESIS", "hash_alg": "sha256",
        "timestamp": now(), "agent_id": state["agent_id"], "human_id": state["human_id"], "intent_id": intent_id,
        "intent_hash": sha256(canonicalize_v2(it["intent"]["payload"])),
        "policy_decision": {"approve": "approved", "escalate": "escalated", "block": "blocked"}[decision],
        "outcome": outcome, "evidence": {"tool": tool, "result_ref": result_ref, "evidence_hash": sha256(result_ref)},
        "pq_checkpoint_ref": None,
    })
    return {"audit_id": trail[-1]["audit_id"], "count": len(trail)}


async def bundle(intent_id):
    it = lookup(intent_id)
    built = (
        BundleBuilderV2(state["nonce"])
        .responsible_principal_record(state["rpr"])
        .agent_passport(state["passport"])
        .intent(it["intent"])
        .policy_decision(it["policy"])
        .add_audit_entries(it["trail"])
        .build()
    )
    classical, pq = state["human"]
    return {"signed_bundle": await sign_bundle_v2(built, registry, "human", state["human_id"], classical, pq)}


async def verify(signed_bundle, mode):
    policy = DEFAULT_VERIFIER_POLICY
    if mode:
        policy = {**DEFAULT_VERIFIER_POLICY, "default_mode": mode, "risk_overrides": dict.fromkeys(("low", "medium", "high"), mode)}
    r = await verify_signed_bundle_v2(signed_bundle, registry, policy)
    return {"valid": r["verified"] is True, "errors": r["errors"]}


async def shutdown():
    return {}


COMMANDS = {f.__name__: f for f in (identity, intent, act, bundle, verify, shutdown)}


async def main():
    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            return
        if not line.strip():
            continue
        req_id, cmd = None, None
        try:
            req = json.loads(line)
            req_id, cmd = req.get("id"), req.get("cmd")
            handler = COMMANDS.get(cmd)
            if handler is None:
                raise ValueError(f"unknown command {cmd}")
            resp = {"id": req_id, "ok": True, "result": await handler(**(req.get("args") or {}))}
        except Exception as exc:  # noqa: BLE001 - every failure becomes an error response
            resp = {"id": req_id, "ok": False, "error": f"{type(exc).__name__}: {exc}"}
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()
        if cmd == "shutdown":
            return


asyncio.run(main())
