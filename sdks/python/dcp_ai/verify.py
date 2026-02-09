"""
Full DCP signed bundle verification.
Checks schema, signature, bundle_hash, merkle_root, intent_hash chain, and prev_hash chain.
"""

from __future__ import annotations

import hashlib
from typing import Any

from dcp_ai.crypto import canonicalize, verify_object
from dcp_ai.merkle import merkle_root_for_audit_entries, hash_object, intent_hash


def verify_signed_bundle(
    signed_bundle: dict[str, Any],
    public_key_b64: str | None = None,
) -> dict[str, Any]:
    """
    Verify a Signed Bundle: schema + signature + bundle_hash + merkle_root + hash chains.

    Args:
        signed_bundle: The signed bundle dict.
        public_key_b64: Optional Ed25519 public key; falls back to signer.public_key_b64.

    Returns:
        dict with 'verified' (bool) and optional 'errors' list.
    """
    if not signed_bundle or not isinstance(signed_bundle, dict):
        return {"verified": False, "errors": ["Invalid signed bundle format."]}

    bundle = signed_bundle.get("bundle")
    signature = signed_bundle.get("signature", {})

    if not bundle or not signature.get("sig_b64"):
        return {"verified": False, "errors": ["Invalid signed bundle format."]}

    pub_key = public_key_b64 or signature.get("signer", {}).get("public_key_b64")
    if not pub_key:
        return {
            "verified": False,
            "errors": ["Missing public key (provide public_key_b64 or bundle must include signer.public_key_b64)."],
        }

    errors: list[str] = []

    # 1) Signature verification
    if not verify_object(bundle, signature["sig_b64"], pub_key):
        return {"verified": False, "errors": ["SIGNATURE INVALID"]}

    # 2) bundle_hash
    bundle_hash = signature.get("bundle_hash", "")
    if isinstance(bundle_hash, str) and bundle_hash.startswith("sha256:"):
        expected_hex = hashlib.sha256(canonicalize(bundle).encode("utf-8")).hexdigest()
        got = bundle_hash[len("sha256:"):]
        if got != expected_hex:
            return {"verified": False, "errors": ["BUNDLE HASH MISMATCH"]}

    # 3) merkle_root
    merkle_root = signature.get("merkle_root", "")
    if isinstance(merkle_root, str) and merkle_root.startswith("sha256:"):
        audit_entries = bundle.get("audit_entries", [])
        expected_merkle = merkle_root_for_audit_entries(audit_entries) if isinstance(audit_entries, list) else None
        got_merkle = merkle_root[len("sha256:"):]
        if not expected_merkle or got_merkle != expected_merkle:
            return {"verified": False, "errors": ["MERKLE ROOT MISMATCH"]}

    # 4) intent_hash and prev_hash chain
    intent_obj = bundle.get("intent")
    expected_intent_hash = intent_hash(intent_obj)
    audit_entries = bundle.get("audit_entries", [])
    prev_hash_expected = "GENESIS"

    for i, entry in enumerate(audit_entries):
        if entry.get("intent_hash") != expected_intent_hash:
            errors.append(
                f"intent_hash (entry {i}): expected {expected_intent_hash}, got {entry.get('intent_hash')}"
            )
            return {"verified": False, "errors": errors}
        if entry.get("prev_hash") != prev_hash_expected:
            errors.append(
                f"prev_hash chain (entry {i}): expected {prev_hash_expected}, got {entry.get('prev_hash')}"
            )
            return {"verified": False, "errors": errors}
        prev_hash_expected = hash_object(entry)

    return {"verified": True}
