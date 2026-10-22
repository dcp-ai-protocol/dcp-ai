"""
DCP v2.0 bundle build / sign / verify — Python port of the TypeScript SDK's
builder-v2.ts, signer-v2.ts and verify-v2.ts, checked against a bundle built
by the TypeScript SDK (tests/interop/v2/cross_sdk_vectors.json).
"""

from __future__ import annotations

import asyncio
import base64
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from dcp_ai.v2 import (
    DCP_CONTEXTS,
    DEFAULT_VERIFIER_POLICY,
    PQ_ONLY_VERIFIER_POLICY,
    BundleBuilderV2,
    BundleManifest,
    canonicalize_v2,
    classical_only_sign,
    generate_session_nonce,
    prepare_payload,
    sign_bundle_v2,
    sign_bundle_v2_classical_only,
    verify_signed_bundle_v2,
)
from tests.generate_cross_sdk_vectors import build_signed_bundle, composite_keys, make_registry, sign_payload

REPO_ROOT = Path(__file__).resolve().parents[3]
CROSS_SDK_PATH = REPO_ROOT / "tests" / "interop" / "v2" / "cross_sdk_vectors.json"
SCHEMAS_V2 = REPO_ROOT / "schemas" / "v2"

HYBRID_REQUIRED = {
    **DEFAULT_VERIFIER_POLICY,
    "default_mode": "hybrid_required",
    "risk_overrides": {"low": "hybrid_required", "medium": "hybrid_required", "high": "hybrid_required"},
}


@pytest.fixture(scope="module")
def registry():
    return make_registry()


@pytest.fixture(scope="module")
def agent_keys():
    return asyncio.run(composite_keys())


@pytest.fixture(scope="module")
def principal_keys():
    return asyncio.run(composite_keys())


@pytest.fixture
def signed(registry, agent_keys, principal_keys):
    """A valid signed bundle; passport risk_tier "high" resolves to hybrid_required."""
    return asyncio.run(build_signed_bundle(registry, agent_keys, principal_keys))


@pytest.fixture
def signed_medium(registry, agent_keys, principal_keys):
    """Risk tier "medium" resolves to hybrid_preferred under the default policy."""
    return asyncio.run(build_signed_bundle(registry, agent_keys, principal_keys, risk_tier="medium"))


def flip_first_byte(sig_b64: str) -> str:
    raw = bytearray(base64.b64decode(sig_b64))
    raw[0] ^= 0xFF
    return base64.b64encode(bytes(raw)).decode("ascii")


def rebuild(bundle: dict) -> dict:
    """Recompute the manifest from the bundle's own artifacts."""
    return (
        BundleBuilderV2(bundle["manifest"]["session_nonce"])
        .responsible_principal_record(bundle["responsible_principal_record"])
        .agent_passport(bundle["agent_passport"])
        .intent(bundle["intent"])
        .policy_decision(bundle["policy_decision"])
        .add_audit_entries(bundle["audit_entries"])
        .add_pq_checkpoints(bundle.get("pq_checkpoints") or [])
        .enable_dual_hash()
        .build()
    )


async def resign(registry, signed: dict, principal_keys, **kwargs) -> dict:
    return await sign_bundle_v2(
        rebuild(signed["bundle"]), registry, "human", "human-cross-sdk", *principal_keys, dual_hash=True, **kwargs
    )


def assert_error(result: dict, prefix: str) -> None:
    assert result["verified"] is False
    assert any(e.startswith(prefix) or prefix in e for e in result["errors"]), result["errors"]


# ---------------------------------------------------------------------------
# Build + sign + verify round trip
# ---------------------------------------------------------------------------


class TestRoundTrip:
    @pytest.mark.asyncio
    async def test_verifies_under_default_policy(self, registry, signed):
        result = await verify_signed_bundle_v2(signed, registry)
        assert result["errors"] == []
        assert result["verified"] is True
        details = result["details"]
        assert details["verification_mode"] == "hybrid_required"
        assert details["session_nonce"] == signed["bundle"]["manifest"]["session_nonce"]
        for flag in ("manifest_valid", "signature_valid", "policy_satisfied", "hash_chain_valid"):
            assert details[flag] is True, flag

    def test_manifest_and_signature_shape(self, signed):
        bundle, signature = signed["bundle"], signed["signature"]
        manifest = bundle["manifest"]
        assert bundle["dcp_bundle_version"] == "2.0"
        assert manifest["canonicalization_profile"] == "dcp-jcs-v1"
        assert manifest["audit_count"] == 3
        assert manifest["audit_merkle_root"].startswith("sha256:")
        assert manifest["audit_merkle_root_secondary"].startswith("sha3-256:")
        assert manifest["intent_hash"] == bundle["intent"]["payload_hash"]
        assert signature["manifest_hash"] == prepare_payload(manifest)[1]
        assert signature["hash_alg"] == "sha256+sha3-256"
        assert signature["composite_sig"]["binding"] == "pq_over_classical"
        assert signature["created_at"].endswith("Z")
        json.dumps(signed)  # plain JSON all the way down

    @pytest.mark.parametrize("producer", ["python", "typescript"])
    def test_matches_v2_json_schema(self, producer, signed, ts_signed):
        schemas = [json.loads(p.read_text()) for p in SCHEMAS_V2.glob("*.schema.json")]
        refs = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in schemas)
        schema = next(s for s in schemas if s["$id"].endswith("/signed_bundle.schema.json"))
        validator = Draft202012Validator(schema, registry=refs)
        bundle = signed if producer == "python" else ts_signed
        assert [e.message for e in validator.iter_errors(bundle)] == []
        assert BundleManifest.model_validate(bundle["bundle"]["manifest"])

    @pytest.mark.asyncio
    async def test_pq_only_policy(self, registry, signed):
        result = await verify_signed_bundle_v2(signed, registry, PQ_ONLY_VERIFIER_POLICY)
        assert result["verified"] is True, result["errors"]
        assert result["details"]["verification_mode"] == "pq_only"

    @pytest.mark.asyncio
    async def test_accepts_verifier_policy_model(self, registry, signed):
        from dcp_ai.v2 import VerifierPolicy

        result = await verify_signed_bundle_v2(signed, registry, VerifierPolicy())
        assert result["verified"] is True, result["errors"]


# ---------------------------------------------------------------------------
# Cross-SDK: bundle built and signed by the TypeScript SDK
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def ts_signed():
    with open(CROSS_SDK_PATH) as f:
        return json.load(f)["typescript"]["signed_bundle_v2"]


class TestTypeScriptBundle:
    @pytest.mark.asyncio
    async def test_verifies(self, registry, ts_signed):
        result = await verify_signed_bundle_v2(ts_signed, registry)
        assert result["errors"] == []
        assert result["verified"] is True
        assert result["details"]["verification_mode"] == "hybrid_required"

    def test_builder_recomputes_manifest_byte_for_byte(self, ts_signed):
        manifest = ts_signed["bundle"]["manifest"]
        assert canonicalize_v2(rebuild(ts_signed["bundle"])["manifest"]) == canonicalize_v2(manifest)
        assert ts_signed["signature"]["manifest_hash"] == prepare_payload(manifest)[1]

    @pytest.mark.asyncio
    async def test_tampered_typescript_bundle_fails(self, registry, ts_signed):
        tampered = json.loads(json.dumps(ts_signed))
        tampered["signature"]["composite_sig"]["pq"]["sig_b64"] = flip_first_byte(
            tampered["signature"]["composite_sig"]["pq"]["sig_b64"]
        )
        assert_error(await verify_signed_bundle_v2(tampered, registry), "PQ signature invalid")


# ---------------------------------------------------------------------------
# Negative cases (mirroring the TypeScript v2 suite)
# ---------------------------------------------------------------------------


class TestIntegrity:
    @pytest.mark.asyncio
    async def test_tampered_payload(self, registry, signed):
        signed["bundle"]["intent"]["payload"]["action_type"] = "initiate_payment"
        assert_error(await verify_signed_bundle_v2(signed, registry), "intent: payload_hash mismatch")

    @pytest.mark.asyncio
    async def test_tampered_manifest(self, registry, signed):
        signed["bundle"]["manifest"]["audit_count"] = 2
        assert_error(await verify_signed_bundle_v2(signed, registry), "Manifest audit_count=2")

    @pytest.mark.asyncio
    async def test_manifest_nonce_mismatch(self, registry, signed):
        signed["bundle"]["manifest"]["session_nonce"] = generate_session_nonce()
        assert_error(await verify_signed_bundle_v2(signed, registry), "Session nonce in manifest")

    @pytest.mark.asyncio
    async def test_unknown_canonicalization_profile(self, registry, signed):
        signed["bundle"]["manifest"]["canonicalization_profile"] = "dcp-jcs-v2"
        assert_error(await verify_signed_bundle_v2(signed, registry), "Unknown canonicalization_profile")

    @pytest.mark.asyncio
    async def test_broken_prev_hash_chain(self, registry, signed, principal_keys):
        entries = signed["bundle"]["audit_entries"]
        entries[0], entries[1] = entries[1], entries[0]
        result = await verify_signed_bundle_v2(await resign(registry, signed, principal_keys), registry)
        assert_error(result, "prev_hash chain break at entry[0]")

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("field", "value", "error"),
        [("status", "revoked", "is revoked"), ("expires_at", "2020-01-01T00:00:00Z", "has expired")],
    )
    async def test_invalid_passport_key(self, registry, signed, agent_keys, principal_keys, field, value, error):
        passport = signed["bundle"]["agent_passport"]["payload"]
        passport["keys"][0][field] = value
        signed["bundle"]["agent_passport"] = await sign_payload(
            registry, passport, DCP_CONTEXTS["AgentPassport"], agent_keys
        )
        result = await verify_signed_bundle_v2(await resign(registry, signed, principal_keys), registry)
        assert_error(result, error)

    @pytest.mark.asyncio
    async def test_pq_checkpoints_bound_to_manifest(self, registry, signed, principal_keys):
        nonce = signed["bundle"]["manifest"]["session_nonce"]
        signed["bundle"]["pq_checkpoints"] = [{"checkpoint_id": "ckpt-1", "session_nonce": nonce}]
        with_checkpoint = await resign(registry, signed, principal_keys)
        result = await verify_signed_bundle_v2(with_checkpoint, registry)
        assert result["verified"] is True, result["errors"]

        checkpoints = with_checkpoint["bundle"]["pq_checkpoints"]
        checkpoints.append({"checkpoint_id": "ckpt-injected", "session_nonce": nonce})
        assert_error(await verify_signed_bundle_v2(with_checkpoint, registry), "Manifest pq_checkpoints")
        checkpoints.clear()
        assert_error(await verify_signed_bundle_v2(with_checkpoint, registry), "Manifest pq_checkpoints")

    @pytest.mark.asyncio
    async def test_malformed_input_fails_without_raising(self, registry):
        for bad in ({}, {"bundle": {"dcp_bundle_version": "2.0"}, "signature": {}}):
            result = await verify_signed_bundle_v2(bad, registry)
            assert_error(result, "Malformed signed bundle")


class TestSignatures:
    """VERIFICATION.md V2-7 (present PQ signatures must verify) and V2-8 (per-artifact signatures)."""

    @pytest.mark.asyncio
    async def test_invalid_bundle_pq_sig_rejected_under_hybrid_preferred(self, registry, signed_medium):
        sig = signed_medium["signature"]["composite_sig"]
        sig["pq"]["sig_b64"] = flip_first_byte(sig["pq"]["sig_b64"])
        result = await verify_signed_bundle_v2(signed_medium, registry)
        assert result["details"]["verification_mode"] == "hybrid_preferred"
        assert_error(result, "PQ signature invalid")

    @pytest.mark.asyncio
    async def test_invalid_artifact_pq_sig_rejected_under_hybrid_preferred(self, registry, signed_medium):
        sig = signed_medium["bundle"]["agent_passport"]["composite_sig"]
        sig["pq"]["sig_b64"] = flip_first_byte(sig["pq"]["sig_b64"])
        assert_error(await verify_signed_bundle_v2(signed_medium, registry), "agent_passport: PQ")

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("name", "context", "signer"),
        [
            ("responsible_principal_record", "ResponsiblePrincipal", "agent"),  # must be the principal
            ("intent", "Intent", "principal"),  # must be the agent
            ("policy_decision", "Intent", "agent"),  # wrong context tag
        ],
    )
    async def test_artifact_signed_by_wrong_key_or_context(
        self, registry, signed, agent_keys, principal_keys, name, context, signer
    ):
        keys = agent_keys if signer == "agent" else principal_keys
        payload = signed["bundle"][name]["payload"]
        signed["bundle"][name] = await sign_payload(registry, payload, DCP_CONTEXTS[context], keys)
        assert_error(await verify_signed_bundle_v2(signed, registry), f"{name}:")

    @pytest.mark.asyncio
    async def test_absent_artifact_pq_sig_only_tolerated_by_hybrid_preferred(self, registry, signed_medium, agent_keys):
        intent = signed_medium["bundle"]["intent"]
        canonical_bytes, _ = prepare_payload(intent["payload"])
        intent["composite_sig"] = await classical_only_sign(
            registry, DCP_CONTEXTS["Intent"], canonical_bytes, agent_keys[0]
        )
        preferred = await verify_signed_bundle_v2(signed_medium, registry)
        assert preferred["verified"] is True, preferred["errors"]
        assert any(w.startswith("intent: PQ signature missing") for w in preferred["warnings"])
        assert_error(await verify_signed_bundle_v2(signed_medium, registry, HYBRID_REQUIRED), "intent:")

    @pytest.mark.asyncio
    async def test_classical_only_bundle_signature(self, registry, signed_medium, principal_keys):
        reclassical = await sign_bundle_v2_classical_only(
            signed_medium["bundle"], registry, "human", "human-cross-sdk", principal_keys[0]
        )
        preferred = await verify_signed_bundle_v2(reclassical, registry)
        assert preferred["verified"] is True, preferred["errors"]
        assert any("PQ signature missing" in w for w in preferred["warnings"])
        assert_error(await verify_signed_bundle_v2(reclassical, registry, HYBRID_REQUIRED), "composite binding")
        assert_error(
            await verify_signed_bundle_v2(reclassical, registry, PQ_ONLY_VERIFIER_POLICY),
            "pq_only mode requires PQ signature",
        )

    @pytest.mark.asyncio
    async def test_advisory_rejected_algorithm(self, registry, signed):
        policy = {"advisory_rejected_algs": ["ml-dsa-65"]}
        assert_error(await verify_signed_bundle_v2(signed, registry, policy), "rejected by active advisory")

    @pytest.mark.asyncio
    async def test_unknown_mode_fails_closed(self, registry, signed):
        policy = {"default_mode": "anything", "risk_overrides": {}}
        assert_error(await verify_signed_bundle_v2(signed, registry, policy), "Unknown verification mode")


class TestSessionAndAudience:
    @pytest.mark.asyncio
    async def test_expired_session(self, registry, signed, principal_keys):
        expired = await resign(registry, signed, principal_keys, session_expires_at="2020-01-01T00:00:00.000Z")
        assert_error(await verify_signed_bundle_v2(expired, registry), "Session expired")

    @pytest.mark.asyncio
    async def test_max_session_duration_ignores_unsigned_created_at(self, registry, signed, principal_keys):
        expires = datetime.now(timezone.utc) + timedelta(hours=2)
        expires_at = expires.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        long_session = await resign(registry, signed, principal_keys, session_expires_at=expires_at)
        ok = await verify_signed_bundle_v2(long_session, registry, {"max_session_duration_seconds": 3 * 3600})
        assert ok["verified"] is True, ok["errors"]

        one_hour = {"max_session_duration_seconds": 3600}
        assert_error(await verify_signed_bundle_v2(long_session, registry, one_hour), "exceeds policy max")
        # signature.created_at is not signed: moving it up to the expiry must not shorten the session.
        long_session["signature"]["created_at"] = expires_at
        assert_error(await verify_signed_bundle_v2(long_session, registry, one_hour), "exceeds policy max")

    @pytest.mark.asyncio
    async def test_session_expiry_required(self, registry, signed):
        policy = {"require_session_expiry": True}
        assert_error(await verify_signed_bundle_v2(signed, registry, policy), "Policy requires session_expires_at")

    @pytest.mark.asyncio
    async def test_audience_binding(self, registry, signed, principal_keys):
        bound = await resign(registry, signed, principal_keys, intended_verifier="verifier-a")
        ok = await verify_signed_bundle_v2(
            bound, registry, {"require_audience_binding": True, "verifier_id": "verifier-a"}
        )
        assert ok["verified"] is True, ok["errors"]
        other = await verify_signed_bundle_v2(
            bound, registry, {"require_audience_binding": True, "verifier_id": "verifier-b"}
        )
        assert_error(other, "Bundle intended for verifier 'verifier-a'")


class TestBuilder:
    def test_missing_artifacts(self, signed):
        bundle = signed["bundle"]
        builder = (
            BundleBuilderV2(bundle["manifest"]["session_nonce"])
            .responsible_principal_record(bundle["responsible_principal_record"])
            .agent_passport(bundle["agent_passport"])
        )
        with pytest.raises(ValueError, match="Missing intent"):
            builder.build()
        builder.intent(bundle["intent"]).policy_decision(bundle["policy_decision"])
        with pytest.raises(ValueError, match="At least one audit entry"):
            builder.build()

    def test_session_nonce_mismatch(self, signed):
        bundle = signed["bundle"]
        builder = (
            BundleBuilderV2(generate_session_nonce())
            .responsible_principal_record(bundle["responsible_principal_record"])
            .agent_passport(bundle["agent_passport"])
            .intent(bundle["intent"])
            .policy_decision(bundle["policy_decision"])
            .add_audit_entries(bundle["audit_entries"])
        )
        with pytest.raises(ValueError, match="Session nonce mismatch"):
            builder.build()

    def test_pq_checkpoint_ids_in_manifest(self, signed):
        bundle = signed["bundle"]
        nonce = bundle["manifest"]["session_nonce"]
        checkpoint = {"checkpoint_id": "ckpt-1", "session_nonce": nonce}
        built = (
            BundleBuilderV2(nonce)
            .responsible_principal_record(bundle["responsible_principal_record"])
            .agent_passport(bundle["agent_passport"])
            .intent(bundle["intent"])
            .policy_decision(bundle["policy_decision"])
            .add_audit_entries(bundle["audit_entries"])
            .add_pq_checkpoint(checkpoint)
            .build()
        )
        assert built["manifest"]["pq_checkpoints"] == ["ckpt-1"]
        assert built["pq_checkpoints"] == [checkpoint]
        assert "audit_merkle_root_secondary" not in built["manifest"]
