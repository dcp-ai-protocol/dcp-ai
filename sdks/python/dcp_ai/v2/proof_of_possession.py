"""
DCP v2.0 Proof of Possession (PoP) for key registration and rotation.
"""

from __future__ import annotations

import base64
from typing import Any

from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_sig import SignatureEntry
from dcp_ai.v2.crypto_provider import CryptoProvider
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS, domain_separated_message


async def generate_registration_pop(
    registry: AlgorithmRegistry,
    challenge: dict[str, str],
    alg: str,
    secret_key_b64: str,
) -> SignatureEntry:
    """Generate a proof-of-possession for initial key registration.

    The key signs a challenge payload containing its own kid + agent_id + timestamp
    under the ProofOfPossession context.
    """
    provider = registry.get_signer(alg)
    canonical = canonicalize_v2(challenge)
    dsm = domain_separated_message(
        DCP_CONTEXTS["ProofOfPossession"],
        canonical.encode("utf-8"),
    )
    sig = await provider.sign(dsm, secret_key_b64)

    return SignatureEntry(
        alg=alg,
        kid=challenge["kid"],
        sig_b64=base64.b64encode(sig).decode("ascii"),
    )


async def verify_registration_pop(
    registry: AlgorithmRegistry,
    challenge: dict[str, str],
    pop: SignatureEntry,
    public_key_b64: str,
) -> bool:
    """Verify a proof-of-possession for key registration."""
    provider = registry.get_signer(pop["alg"])
    canonical = canonicalize_v2(challenge)
    dsm = domain_separated_message(
        DCP_CONTEXTS["ProofOfPossession"],
        canonical.encode("utf-8"),
    )
    sig = base64.b64decode(pop["sig_b64"])
    return await provider.verify(dsm, sig, public_key_b64)


async def create_key_rotation(
    registry: AlgorithmRegistry,
    old_kid: str,
    old_alg: str,
    old_secret_key_b64: str,
    new_kid: str,
    new_alg: str,
    new_secret_key_b64: str,
    new_public_key_b64: str,
    timestamp: str,
    expires_at: str | None = None,
) -> dict[str, Any]:
    """Create a key rotation record with proof-of-possession.

    The new key signs (old_kid + new_kid + timestamp) under KeyRotation context.
    The old key counter-signs to authorize the rotation.
    """
    rotation_payload: dict[str, str] = {
        "old_kid": old_kid,
        "new_kid": new_kid,
        "timestamp": timestamp,
    }
    canonical = canonicalize_v2(rotation_payload)
    dsm = domain_separated_message(
        DCP_CONTEXTS["KeyRotation"],
        canonical.encode("utf-8"),
    )

    new_provider = registry.get_signer(new_alg)
    old_provider = registry.get_signer(old_alg)

    pop_sig = await new_provider.sign(dsm, new_secret_key_b64)
    auth_sig = await old_provider.sign(dsm, old_secret_key_b64)

    return {
        "type": "key_rotation",
        "old_kid": old_kid,
        "new_kid": new_kid,
        "new_key": {
            "kid": new_kid,
            "alg": new_alg,
            "public_key_b64": new_public_key_b64,
            "created_at": timestamp,
            "expires_at": expires_at,
            "status": "active",
        },
        "timestamp": timestamp,
        "proof_of_possession": SignatureEntry(
            alg=new_alg,
            kid=new_kid,
            sig_b64=base64.b64encode(pop_sig).decode("ascii"),
        ),
        "authorization_sig": SignatureEntry(
            alg=old_alg,
            kid=old_kid,
            sig_b64=base64.b64encode(auth_sig).decode("ascii"),
        ),
    }


async def verify_key_rotation(
    registry: AlgorithmRegistry,
    record: dict[str, Any],
    old_public_key_b64: str,
    new_public_key_b64: str,
) -> tuple[bool, bool, bool]:
    """Verify a key rotation record (both PoP and authorization signatures).

    Returns (valid, pop_valid, auth_valid).
    """
    rotation_payload: dict[str, str] = {
        "old_kid": record["old_kid"],
        "new_kid": record["new_kid"],
        "timestamp": record["timestamp"],
    }
    canonical = canonicalize_v2(rotation_payload)
    dsm = domain_separated_message(
        DCP_CONTEXTS["KeyRotation"],
        canonical.encode("utf-8"),
    )

    pop = record["proof_of_possession"]
    auth = record["authorization_sig"]

    new_provider = registry.get_signer(pop["alg"])
    old_provider = registry.get_signer(auth["alg"])

    pop_sig = base64.b64decode(pop["sig_b64"])
    auth_sig = base64.b64decode(auth["sig_b64"])

    pop_valid = await new_provider.verify(dsm, pop_sig, new_public_key_b64)
    auth_valid = await old_provider.verify(dsm, auth_sig, old_public_key_b64)

    return (pop_valid and auth_valid, pop_valid, auth_valid)
