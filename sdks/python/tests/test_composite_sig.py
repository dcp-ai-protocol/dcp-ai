"""
DCP-AI v2.0 Composite Signature Tests (Python SDK)

Tests composite-bound hybrid signatures, proof-of-possession,
and key rotation using Ed25519 (PQ providers require pqcrypto).
"""

import asyncio
import pytest

from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS
from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import (
    CompositeKeyInfo,
    composite_sign,
    composite_verify,
    classical_only_sign,
)
from dcp_ai.v2.proof_of_possession import (
    generate_registration_pop,
    verify_registration_pop,
    create_key_rotation,
    verify_key_rotation,
)


@pytest.fixture
def registry():
    r = AlgorithmRegistry()
    r.register_signer(Ed25519Provider())
    return r


@pytest.fixture
def ed25519_kp():
    async def _gen():
        p = Ed25519Provider()
        return await p.generate_keypair()
    return asyncio.get_event_loop().run_until_complete(_gen())


# ---------------------------------------------------------------------------
# Composite Signature Operations
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_classical_only_sign_verify(registry):
    p = Ed25519Provider()
    kp = await p.generate_keypair()
    key = CompositeKeyInfo(
        kid=kp["kid"],
        alg="ed25519",
        secret_key_b64=kp["secret_key_b64"],
        public_key_b64=kp["public_key_b64"],
    )
    payload = canonicalize_v2({"test": "classical_only"}).encode("utf-8")

    sig = await classical_only_sign(
        registry, DCP_CONTEXTS["AgentPassport"], payload, key
    )
    assert sig["binding"] == "classical_only"
    assert sig["pq"] is None

    result = await composite_verify(
        registry,
        DCP_CONTEXTS["AgentPassport"],
        payload,
        sig,
        kp["public_key_b64"],
    )
    assert result.valid is True
    assert result.classical_valid is True
    assert result.pq_valid is False


@pytest.mark.asyncio
async def test_classical_only_wrong_key_fails(registry):
    p = Ed25519Provider()
    kp1 = await p.generate_keypair()
    kp2 = await p.generate_keypair()
    key = CompositeKeyInfo(
        kid=kp1["kid"],
        alg="ed25519",
        secret_key_b64=kp1["secret_key_b64"],
        public_key_b64=kp1["public_key_b64"],
    )
    payload = canonicalize_v2({"test": "wrong_key"}).encode("utf-8")

    sig = await classical_only_sign(
        registry, DCP_CONTEXTS["Intent"], payload, key
    )

    result = await composite_verify(
        registry,
        DCP_CONTEXTS["Intent"],
        payload,
        sig,
        kp2["public_key_b64"],
    )
    assert result.valid is False


@pytest.mark.asyncio
async def test_domain_separation_prevents_replay(registry):
    p = Ed25519Provider()
    kp = await p.generate_keypair()
    key = CompositeKeyInfo(
        kid=kp["kid"],
        alg="ed25519",
        secret_key_b64=kp["secret_key_b64"],
        public_key_b64=kp["public_key_b64"],
    )
    payload = canonicalize_v2({"data": "shared"}).encode("utf-8")

    sig = await classical_only_sign(
        registry, DCP_CONTEXTS["Intent"], payload, key
    )

    result = await composite_verify(
        registry,
        DCP_CONTEXTS["AuditEvent"],
        payload,
        sig,
        kp["public_key_b64"],
    )
    assert result.valid is False


# ---------------------------------------------------------------------------
# Proof of Possession
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_registration_pop_round_trip(registry):
    p = Ed25519Provider()
    kp = await p.generate_keypair()
    challenge = {
        "kid": kp["kid"],
        "agent_id": "test-agent",
        "timestamp": "2026-02-25T00:00:00Z",
        "nonce": "deadbeef",
    }

    pop = await generate_registration_pop(
        registry, challenge, "ed25519", kp["secret_key_b64"]
    )
    assert pop["alg"] == "ed25519"
    assert pop["kid"] == kp["kid"]

    valid = await verify_registration_pop(
        registry, challenge, pop, kp["public_key_b64"]
    )
    assert valid is True


@pytest.mark.asyncio
async def test_registration_pop_wrong_key_fails(registry):
    p = Ed25519Provider()
    kp1 = await p.generate_keypair()
    kp2 = await p.generate_keypair()
    challenge = {
        "kid": kp1["kid"],
        "agent_id": "test-agent",
        "timestamp": "2026-02-25T00:00:00Z",
        "nonce": "abc123",
    }

    pop = await generate_registration_pop(
        registry, challenge, "ed25519", kp1["secret_key_b64"]
    )

    valid = await verify_registration_pop(
        registry, challenge, pop, kp2["public_key_b64"]
    )
    assert valid is False


# ---------------------------------------------------------------------------
# Key Rotation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_key_rotation_round_trip(registry):
    p = Ed25519Provider()
    old_kp = await p.generate_keypair()
    new_kp = await p.generate_keypair()

    record = await create_key_rotation(
        registry,
        old_kid=old_kp["kid"],
        old_alg="ed25519",
        old_secret_key_b64=old_kp["secret_key_b64"],
        new_kid=new_kp["kid"],
        new_alg="ed25519",
        new_secret_key_b64=new_kp["secret_key_b64"],
        new_public_key_b64=new_kp["public_key_b64"],
        timestamp="2026-06-01T00:00:00Z",
    )

    assert record["type"] == "key_rotation"
    assert record["old_kid"] == old_kp["kid"]
    assert record["new_kid"] == new_kp["kid"]

    valid, pop_valid, auth_valid = await verify_key_rotation(
        registry, record, old_kp["public_key_b64"], new_kp["public_key_b64"]
    )

    assert valid is True
    assert pop_valid is True
    assert auth_valid is True


@pytest.mark.asyncio
async def test_key_rotation_wrong_old_key_fails(registry):
    p = Ed25519Provider()
    old_kp = await p.generate_keypair()
    new_kp = await p.generate_keypair()
    wrong_kp = await p.generate_keypair()

    record = await create_key_rotation(
        registry,
        old_kid=old_kp["kid"],
        old_alg="ed25519",
        old_secret_key_b64=old_kp["secret_key_b64"],
        new_kid=new_kp["kid"],
        new_alg="ed25519",
        new_secret_key_b64=new_kp["secret_key_b64"],
        new_public_key_b64=new_kp["public_key_b64"],
        timestamp="2026-06-01T00:00:00Z",
    )

    valid, pop_valid, auth_valid = await verify_key_rotation(
        registry, record, wrong_kp["public_key_b64"], new_kp["public_key_b64"]
    )

    assert valid is False
    assert auth_valid is False
