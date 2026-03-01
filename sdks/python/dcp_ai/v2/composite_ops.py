"""
DCP v2.0 Composite Signature Operations.

Implements cryptographically-bound hybrid signatures where the PQ signature
covers the classical signature, preventing stripping attacks.
"""

from __future__ import annotations

import base64
from typing import NamedTuple

from dcp_ai.v2.composite_sig import CompositeSignature, SignatureEntry
from dcp_ai.v2.crypto_provider import CryptoProvider
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import domain_separated_message


class CompositeKeyInfo(NamedTuple):
    kid: str
    alg: str
    secret_key_b64: str
    public_key_b64: str


class CompositeVerifyResult(NamedTuple):
    valid: bool
    classical_valid: bool
    pq_valid: bool


async def composite_sign(
    registry: AlgorithmRegistry,
    context: str,
    canonical_payload_bytes: bytes,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
) -> CompositeSignature:
    """Produce a composite-bound hybrid signature.

    The PQ signature covers the classical signature, binding them together.
    """
    classical_provider = registry.get_signer(classical_key.alg)
    pq_provider = registry.get_signer(pq_key.alg)

    dsm = domain_separated_message(context, canonical_payload_bytes)

    classical_sig = await classical_provider.sign(dsm, classical_key.secret_key_b64)

    composite_message = dsm + classical_sig
    pq_sig = await pq_provider.sign(composite_message, pq_key.secret_key_b64)

    return CompositeSignature(
        classical=SignatureEntry(
            alg=classical_key.alg,
            kid=classical_key.kid,
            sig_b64=base64.b64encode(classical_sig).decode("ascii"),
        ),
        pq=SignatureEntry(
            alg=pq_key.alg,
            kid=pq_key.kid,
            sig_b64=base64.b64encode(pq_sig).decode("ascii"),
        ),
        binding="pq_over_classical",
    )


async def classical_only_sign(
    registry: AlgorithmRegistry,
    context: str,
    canonical_payload_bytes: bytes,
    key: CompositeKeyInfo,
) -> CompositeSignature:
    """Produce a classical-only composite signature (transition mode)."""
    provider = registry.get_signer(key.alg)
    dsm = domain_separated_message(context, canonical_payload_bytes)
    sig = await provider.sign(dsm, key.secret_key_b64)

    return CompositeSignature(
        classical=SignatureEntry(
            alg=key.alg,
            kid=key.kid,
            sig_b64=base64.b64encode(sig).decode("ascii"),
        ),
        pq=None,
        binding="classical_only",
    )


async def composite_verify(
    registry: AlgorithmRegistry,
    context: str,
    canonical_payload_bytes: bytes,
    composite_sig: CompositeSignature,
    classical_pubkey_b64: str,
    pq_pubkey_b64: str | None = None,
    strategy: str = "parallel",
) -> CompositeVerifyResult:
    """Verify a composite-bound hybrid signature.

    For pq_over_classical binding, both signatures are verified and the PQ
    signature's coverage of the classical signature is confirmed.

    Strategies:
      - "parallel" (default): Both verified concurrently via asyncio.gather
      - "pq_first": PQ verified first; if it fails, skip classical (fast-fail)
    """
    import asyncio

    dsm = domain_separated_message(context, canonical_payload_bytes)

    if composite_sig["binding"] == "classical_only":
        if composite_sig["pq"] is not None:
            return CompositeVerifyResult(valid=False, classical_valid=False, pq_valid=False)
        classical_provider = registry.get_signer(composite_sig["classical"]["alg"])
        classical_sig_bytes = base64.b64decode(composite_sig["classical"]["sig_b64"])
        classical_valid = await classical_provider.verify(
            dsm, classical_sig_bytes, classical_pubkey_b64
        )
        return CompositeVerifyResult(
            valid=classical_valid, classical_valid=classical_valid, pq_valid=False
        )

    if composite_sig["binding"] != "pq_over_classical":
        return CompositeVerifyResult(valid=False, classical_valid=False, pq_valid=False)

    if composite_sig["pq"] is None or pq_pubkey_b64 is None:
        return CompositeVerifyResult(valid=False, classical_valid=False, pq_valid=False)

    classical_provider = registry.get_signer(composite_sig["classical"]["alg"])
    pq_provider = registry.get_signer(composite_sig["pq"]["alg"])

    classical_sig_bytes = base64.b64decode(composite_sig["classical"]["sig_b64"])
    pq_sig_bytes = base64.b64decode(composite_sig["pq"]["sig_b64"])

    composite_message = dsm + classical_sig_bytes

    if strategy == "pq_first":
        pq_valid = await pq_provider.verify(
            composite_message, pq_sig_bytes, pq_pubkey_b64
        )
        if not pq_valid:
            return CompositeVerifyResult(valid=False, classical_valid=False, pq_valid=False)
        classical_valid = await classical_provider.verify(
            dsm, classical_sig_bytes, classical_pubkey_b64
        )
        return CompositeVerifyResult(
            valid=classical_valid and pq_valid,
            classical_valid=classical_valid,
            pq_valid=pq_valid,
        )

    classical_valid, pq_valid = await asyncio.gather(
        classical_provider.verify(dsm, classical_sig_bytes, classical_pubkey_b64),
        pq_provider.verify(composite_message, pq_sig_bytes, pq_pubkey_b64),
    )

    return CompositeVerifyResult(
        valid=classical_valid and pq_valid,
        classical_valid=classical_valid,
        pq_valid=pq_valid,
    )
