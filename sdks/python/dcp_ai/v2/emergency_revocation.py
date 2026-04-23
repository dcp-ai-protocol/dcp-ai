"""
DCP v2.0 Emergency Revocation — Python port.

Pre-registered revocation token allows revoking all agent keys without
requiring a private-key signature. The human keeps `revocation_secret`
offline; revealing its pre-image proves authorisation.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any

from dcp_ai.v2.session_nonce import generate_session_expiry  # just to register shared imports


def generate_emergency_revocation_token() -> dict[str, str]:
    """Generate a (revocation_secret, emergency_revocation_token) pair.

    The secret MUST be stored offline; the token is embedded in the passport.
    Returns {'revocation_secret': hex64, 'emergency_revocation_token': 'sha256:<hex64>'}.
    """
    secret_bytes = secrets.token_bytes(32)
    secret_hex = secret_bytes.hex()
    commit = hashlib.sha256(secret_bytes).hexdigest()
    return {
        "revocation_secret": secret_hex,
        "emergency_revocation_token": f"sha256:{commit}",
    }


def verify_emergency_revocation_secret(
    revocation_secret: str,
    commitment_token: str,
) -> bool:
    """Return True iff sha256(secret) matches the `sha256:<hex>` commitment token."""
    if not commitment_token.startswith("sha256:"):
        return False
    try:
        secret_bytes = bytes.fromhex(revocation_secret)
    except ValueError:
        return False
    if len(secret_bytes) != 32:
        return False
    expected_hex = commitment_token[len("sha256:"):]
    actual = hashlib.sha256(secret_bytes).hexdigest()
    return hmac.compare_digest(actual, expected_hex)


def build_emergency_revocation(
    *,
    agent_id: str,
    human_id: str,
    revocation_secret: str,
) -> dict[str, Any]:
    """Build an EmergencyRevocation request object ready to send to the gateway."""
    from datetime import datetime, timezone
    ts = datetime.now(timezone.utc)
    ts_iso = ts.strftime("%Y-%m-%dT%H:%M:%S.") + f"{ts.microsecond // 1000:03d}Z"
    return {
        "type": "emergency_revocation",
        "agent_id": agent_id,
        "human_id": human_id,
        "revocation_secret": revocation_secret,
        "timestamp": ts_iso,
        "reason": "key_compromise_emergency",
    }


# Expose so static analysers don't flag it as unused; we imported it to make
# absolutely sure the shared expiry helper stays in the public v2 surface.
_ = generate_session_expiry
