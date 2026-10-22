"""
Cross-SDK vector generator — Python section.

Writes the `python` section of tests/interop/v2/cross_sdk_vectors.json: an
SLH-DSA-192f signature, an ML-KEM-768 encapsulation and a full signed V2 bundle
(hybrid Ed25519 + ML-DSA-65), all produced by this SDK, for the other SDKs to
verify (sdks/typescript/src/__tests__/cross-sdk.test.ts). The `typescript`
section comes from sdks/typescript/src/__tests__/generate-cross-sdk-vectors.ts.

build_signed_bundle() is also the fixture factory for tests/test_bundle_v2.py.

Run: cd sdks/python && python tests/generate_cross_sdk_vectors.py
"""

from __future__ import annotations

import asyncio
import base64
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dcp_ai.providers import Ed25519Provider, MlDsa65Provider, MlKem768Provider, SlhDsa192fProvider
from dcp_ai.v2 import (
    DCP_CONTEXTS,
    AlgorithmRegistry,
    BundleBuilderV2,
    CompositeKeyInfo,
    canonicalize_v2,
    composite_sign,
    domain_separated_message,
    generate_session_nonce,
    prepare_payload,
    sign_bundle_v2,
)

OUTPUT_PATH = Path(__file__).resolve().parents[3] / "tests" / "interop" / "v2" / "cross_sdk_vectors.json"


def make_registry() -> AlgorithmRegistry:
    registry = AlgorithmRegistry()
    registry.register_signer(Ed25519Provider())
    registry.register_signer(MlDsa65Provider())
    return registry


async def composite_keys() -> tuple[CompositeKeyInfo, CompositeKeyInfo]:
    ed = await Ed25519Provider().generate_keypair()
    pq = await MlDsa65Provider().generate_keypair()
    return (
        CompositeKeyInfo(ed["kid"], "ed25519", ed["secret_key_b64"], ed["public_key_b64"]),
        CompositeKeyInfo(pq["kid"], "ml-dsa-65", pq["secret_key_b64"], pq["public_key_b64"]),
    )


def key_entries(keys: tuple[CompositeKeyInfo, CompositeKeyInfo]) -> list[dict[str, Any]]:
    return [
        {
            "kid": k.kid,
            "alg": k.alg,
            "public_key_b64": k.public_key_b64,
            "created_at": "2026-10-21T00:00:00Z",
            "expires_at": None,
            "status": "active",
        }
        for k in keys
    ]


async def sign_payload(
    registry: AlgorithmRegistry,
    payload: dict[str, Any],
    context: str,
    keys: tuple[CompositeKeyInfo, CompositeKeyInfo],
) -> dict[str, Any]:
    canonical_bytes, payload_hash = prepare_payload(payload)
    sig = await composite_sign(registry, context, canonical_bytes, *keys)
    return {"payload": payload, "payload_hash": payload_hash, "composite_sig": sig}


async def build_signed_bundle(
    registry: AlgorithmRegistry,
    agent_keys: tuple[CompositeKeyInfo, CompositeKeyInfo],
    principal_keys: tuple[CompositeKeyInfo, CompositeKeyInfo],
    risk_tier: str = "high",
) -> dict[str, Any]:
    """Same artifacts as the TS generator: principal signs RPR and bundle, agent the rest."""
    nonce = generate_session_nonce()
    agent_id = "agent-cross-sdk-py"
    rpr = {
        "dcp_version": "2.0",
        "human_id": "human-cross-sdk",
        "session_nonce": nonce,
        "legal_name": "Cross SDK Test Principal",
        "entity_type": "natural_person",
        "jurisdiction": "US",
        "liability_mode": "owner_responsible",
        "override_rights": True,
        "issued_at": "2026-10-21T00:00:00Z",
        "expires_at": None,
        "contact": None,
        "binding_keys": key_entries(principal_keys),
    }
    passport = {
        "dcp_version": "2.0",
        "agent_id": agent_id,
        "session_nonce": nonce,
        "keys": key_entries(agent_keys),
        "principal_binding_reference": "human-cross-sdk",
        "capabilities": ["api_call", "browse"],
        "risk_tier": risk_tier,
        "created_at": "2026-10-21T00:00:00Z",
        "status": "active",
    }
    intent = {
        "dcp_version": "2.0",
        "intent_id": "intent-cross-sdk-py",
        "session_nonce": nonce,
        "agent_id": agent_id,
        "human_id": "human-cross-sdk",
        "timestamp": "2026-10-21T12:00:00Z",
        "action_type": "api_call",
        "target": {"channel": "api", "domain": "example.com"},
        "data_classes": ["none"],
        "estimated_impact": "low",
        "requires_consent": False,
    }
    policy = {
        "dcp_version": "2.0",
        "intent_id": intent["intent_id"],
        "session_nonce": nonce,
        "decision": "approve",
        "risk_score": 120,
        "reasons": ["low risk action"],
        "required_confirmation": None,
        "applied_policy_hash": "sha256:" + "0" * 64,
        "timestamp": "2026-10-21T12:00:01Z",
    }
    audit_entries = []
    prev_hash = "GENESIS"
    for i in range(3):
        entry = {
            "dcp_version": "2.0",
            "audit_id": f"audit-py-{i}",
            "session_nonce": nonce,
            "prev_hash": prev_hash,
            "hash_alg": "sha256",
            "timestamp": f"2026-10-21T12:0{i}:30Z",
            "agent_id": agent_id,
            "human_id": "human-cross-sdk",
            "intent_id": intent["intent_id"],
            "intent_hash": prepare_payload(intent)[1],
            "policy_decision": "approved",
            "outcome": f"action_{i}_completed",
            "evidence": {"tool": "http_client", "result_ref": None, "evidence_hash": None},
            "pq_checkpoint_ref": None,
        }
        audit_entries.append(entry)
        prev_hash = prepare_payload(entry)[1]

    bundle = (
        BundleBuilderV2(nonce)
        .responsible_principal_record(
            await sign_payload(registry, rpr, DCP_CONTEXTS["ResponsiblePrincipal"], principal_keys)
        )
        .agent_passport(await sign_payload(registry, passport, DCP_CONTEXTS["AgentPassport"], agent_keys))
        .intent(await sign_payload(registry, intent, DCP_CONTEXTS["Intent"], agent_keys))
        .policy_decision(await sign_payload(registry, policy, DCP_CONTEXTS["PolicyDecision"], agent_keys))
        .add_audit_entries(audit_entries)
        .enable_dual_hash()
        .build()
    )
    return await sign_bundle_v2(
        bundle, registry, "human", "human-cross-sdk", *principal_keys, dual_hash=True
    )


async def main() -> None:
    slh = SlhDsa192fProvider()
    slh_kp = await slh.generate_keypair()
    message = domain_separated_message(
        DCP_CONTEXTS["AgentPassport"],
        canonicalize_v2({"agent_id": "agent-cross-sdk-py", "dcp_version": "2.0"}).encode("utf-8"),
    )
    slh_sig = await slh.sign(message, slh_kp["secret_key_b64"])

    kem = MlKem768Provider()
    kem_kp = await kem.generate_keypair()
    encapsulated = await kem.encapsulate(kem_kp["public_key_b64"])

    registry = make_registry()
    signed_bundle = await build_signed_bundle(registry, await composite_keys(), await composite_keys())

    vectors = json.loads(OUTPUT_PATH.read_text()) if OUTPUT_PATH.exists() else {}
    vectors["python"] = {
        "_generator": "sdks/python/tests/generate_cross_sdk_vectors.py",
        "_generated_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "slh_dsa_192f": {
            "kid": slh_kp["kid"],
            "public_key_b64": slh_kp["public_key_b64"],
            "message_hex": message.hex(),
            "sig_b64": base64.b64encode(slh_sig).decode("ascii"),
        },
        "ml_kem_768": {
            "public_key_b64": kem_kp["public_key_b64"],
            "secret_key_b64": kem_kp["secret_key_b64"],
            "ciphertext_b64": encapsulated["ciphertext_b64"],
            "shared_secret_hex": encapsulated["shared_secret"].hex(),
        },
        "signed_bundle_v2": signed_bundle,
    }
    OUTPUT_PATH.write_text(json.dumps(vectors, indent=2) + "\n")
    print(f"Wrote python section to {OUTPUT_PATH}")


if __name__ == "__main__":
    asyncio.run(main())
