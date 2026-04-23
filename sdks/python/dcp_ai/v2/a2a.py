"""
DCP-04 v2.0 Agent-to-Agent protocol — Python port.

Mirrors sdks/typescript/src/a2a/{discovery,handshake,session}.ts. AES-256-GCM
symmetric channel; the ephemeral KEM negotiation is out of scope here (both
parties supply the derived shared secret / session key as input to
`create_session`).

Requires the `cryptography` package, which is a transitive dep of pynacl
on most installs. If absent, session encryption/decryption raises
ImportError with a clear install hint.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


def _utc_iso() -> str:
    ts = datetime.now(timezone.utc)
    return ts.strftime("%Y-%m-%dT%H:%M:%S.") + f"{ts.microsecond // 1000:03d}Z"


# ── Discovery ──


def create_agent_directory(
    organization: str,
    agents: list[dict[str, Any]],
) -> dict[str, Any]:
    return {"dcp_version": "2.0", "organization": organization, "agents": agents}


def find_agent_by_capability(
    directory: dict[str, Any],
    required_capabilities: list[str],
) -> dict[str, Any] | None:
    for agent in directory.get("agents", []):
        if agent.get("status") != "active":
            continue
        caps = agent.get("capabilities", [])
        if all(c in caps for c in required_capabilities):
            return agent
    return None


def find_agent_by_id(directory: dict[str, Any], agent_id: str) -> dict[str, Any] | None:
    for agent in directory.get("agents", []):
        if agent.get("agent_id") == agent_id and agent.get("status") == "active":
            return agent
    return None


def validate_directory_entry(entry: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if not entry.get("agent_id"):
        errors.append("Missing agent_id")
    if not entry.get("agent_name"):
        errors.append("Missing agent_name")
    caps = entry.get("capabilities")
    if not isinstance(caps, list) or not caps:
        errors.append("capabilities must be non-empty array")
    if not entry.get("bundle_endpoint"):
        errors.append("Missing bundle_endpoint")
    if not entry.get("a2a_endpoint"):
        errors.append("Missing a2a_endpoint")
    if entry.get("status") not in {"active", "suspended", "revoked"}:
        errors.append("Invalid status")
    return errors


# ── Handshake ──


def generate_nonce() -> str:
    """Generate a 256-bit handshake nonce (64 hex chars)."""
    return secrets.token_hex(32)


def create_hello(
    initiator_bundle: dict[str, Any],
    kem_public_key_b64: str,
    requested_capabilities: list[str],
    security_tier: str,
    *,
    mandate_id: str | None = None,
    mandate_hash: str | None = None,
) -> dict[str, Any]:
    msg: dict[str, Any] = {
        "type": "A2A_HELLO",
        "protocol_version": "2.0",
        "initiator_bundle": initiator_bundle,
        "ephemeral_kem_public_key": {
            "alg": "x25519-ml-kem-768",
            "public_key_b64": kem_public_key_b64,
        },
        "nonce": generate_nonce(),
        "supported_algorithms": {
            "signing": ["ed25519", "ml-dsa-65"],
            "kem": ["x25519-ml-kem-768"],
            "cipher": ["aes-256-gcm"],
        },
        "requested_capabilities": requested_capabilities,
        "security_tier": security_tier,
        "timestamp": _utc_iso(),
    }
    if mandate_id is not None:
        msg["mandate_id"] = mandate_id
    if mandate_hash is not None:
        msg["mandate_hash"] = mandate_hash
    return msg


def create_welcome(
    responder_bundle: dict[str, Any],
    kem_public_key_b64: str,
    kem_ciphertext_b64: str,
    resolved_tier: str,
    *,
    mandate_id: str | None = None,
    mandate_hash: str | None = None,
) -> dict[str, Any]:
    msg: dict[str, Any] = {
        "type": "A2A_WELCOME",
        "protocol_version": "2.0",
        "responder_bundle": responder_bundle,
        "ephemeral_kem_public_key": {
            "alg": "x25519-ml-kem-768",
            "public_key_b64": kem_public_key_b64,
        },
        "nonce": generate_nonce(),
        "kem_ciphertext": {
            "alg": "x25519-ml-kem-768",
            "ciphertext_b64": kem_ciphertext_b64,
        },
        "selected_algorithms": {
            "signing": "ed25519",
            "kem": "x25519-ml-kem-768",
            "cipher": "aes-256-gcm",
        },
        "resolved_security_tier": resolved_tier,
        "timestamp": _utc_iso(),
    }
    if mandate_id is not None:
        msg["mandate_id"] = mandate_id
    if mandate_hash is not None:
        msg["mandate_hash"] = mandate_hash
    return msg


def derive_session_id(
    agent_id_a: str,
    agent_id_b: str,
    nonce_a_hex: str,
    nonce_b_hex: str,
    session_key: bytes,
) -> str:
    """Derive a stable session identifier from the two nonces + session key."""
    sep = b"\x00"
    parts = [
        b"DCP-AI.v2.A2A.Session",
        agent_id_a.encode("utf-8"),
        agent_id_b.encode("utf-8"),
        bytes.fromhex(nonce_a_hex) + bytes.fromhex(nonce_b_hex),
        session_key,
    ]
    data = sep.join([parts[0]] + parts[1:])
    # The TS version puts a 0x00 between each field:
    data = (
        parts[0] + sep
        + parts[1] + sep
        + parts[2] + sep
        + parts[3]
        + parts[4]
    )
    return hashlib.sha256(data).hexdigest()[:64]


def create_close_message(
    session_id: str,
    reason: str,
    final_sequence: int,
    audit_summary_hash: str,
) -> dict[str, Any]:
    return {
        "type": "A2A_CLOSE",
        "session_id": session_id,
        "reason": reason,
        "final_sequence": final_sequence,
        "audit_summary_hash": audit_summary_hash,
        "timestamp": _utc_iso(),
    }


# ── Session (AES-256-GCM) ──


@dataclass
class A2ASession:
    session_id: str
    session_key: bytes
    agent_id_local: str
    agent_id_remote: str
    security_tier: str
    rekeying_interval: int = 1000
    message_counter_send: int = 0
    message_counter_recv: int = 0
    created_at: str = field(default_factory=_utc_iso)
    last_activity: str = field(default_factory=_utc_iso)
    status: str = "active"  # "active" | "rekeying" | "closed"


def create_session(
    session_id: str,
    session_key: bytes,
    local_agent_id: str,
    remote_agent_id: str,
    security_tier: str,
    rekeying_interval: int = 1000,
) -> A2ASession:
    if len(session_key) != 32:
        raise ValueError("session_key must be 32 bytes (256 bits)")
    return A2ASession(
        session_id=session_id,
        session_key=session_key,
        agent_id_local=local_agent_id,
        agent_id_remote=remote_agent_id,
        security_tier=security_tier,
        rekeying_interval=rekeying_interval,
    )


def _aesgcm():
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        return AESGCM
    except ImportError as exc:
        raise ImportError(
            "DCP-AI A2A session encryption requires the 'cryptography' package. "
            "Install with: pip install cryptography"
        ) from exc


def encrypt_message(session: A2ASession, payload: dict[str, Any]) -> dict[str, Any]:
    if session.status != "active":
        raise ValueError(f"Cannot send on {session.status} session")
    AESGCM = _aesgcm()
    sequence = session.message_counter_send
    session.message_counter_send += 1
    timestamp = _utc_iso()
    iv = secrets.token_bytes(12)
    aad = (
        session.session_id.encode("utf-8")
        + str(sequence).encode("ascii")
        + session.agent_id_local.encode("utf-8")
        + timestamp.encode("utf-8")
    )
    plaintext = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    gcm = AESGCM(session.session_key)
    ct = gcm.encrypt(iv, plaintext, aad)
    # ct == ciphertext || tag (tag is last 16 bytes)
    ciphertext, tag = ct[:-16], ct[-16:]
    session.last_activity = timestamp
    return {
        "session_id": session.session_id,
        "sequence": sequence,
        "type": "A2A_MESSAGE",
        "encrypted_payload": base64.b64encode(ciphertext).decode("ascii"),
        "iv": base64.b64encode(iv).decode("ascii"),
        "tag": base64.b64encode(tag).decode("ascii"),
        "sender_agent_id": session.agent_id_local,
        "timestamp": timestamp,
    }


def decrypt_message(session: A2ASession, message: dict[str, Any]) -> dict[str, Any]:
    if message["session_id"] != session.session_id:
        raise ValueError("Session ID mismatch")
    if message["sender_agent_id"] != session.agent_id_remote:
        raise ValueError("Unexpected sender")
    AESGCM = _aesgcm()

    if message["sequence"] <= session.message_counter_recv - 1 and session.message_counter_recv > 0:
        if message["sequence"] < session.message_counter_recv - 1000:
            raise ValueError("Message sequence too old (outside window)")

    iv = base64.b64decode(message["iv"])
    tag = base64.b64decode(message["tag"])
    ciphertext = base64.b64decode(message["encrypted_payload"])
    aad = (
        message["session_id"].encode("utf-8")
        + str(message["sequence"]).encode("ascii")
        + message["sender_agent_id"].encode("utf-8")
        + message["timestamp"].encode("utf-8")
    )
    gcm = AESGCM(session.session_key)
    plaintext = gcm.decrypt(iv, ciphertext + tag, aad)
    session.message_counter_recv = max(session.message_counter_recv, int(message["sequence"]) + 1)
    session.last_activity = message["timestamp"]
    return json.loads(plaintext.decode("utf-8"))


def needs_rekeying(session: A2ASession) -> bool:
    return session.message_counter_send >= session.rekeying_interval


def generate_resume_proof(session: A2ASession, last_seen_sequence: int) -> str:
    data = (session.session_id + str(last_seen_sequence)).encode("utf-8")
    return hmac.new(session.session_key, data, hashlib.sha256).hexdigest()


def verify_resume_proof(session: A2ASession, last_seen_sequence: int, proof: str) -> bool:
    expected = generate_resume_proof(session, last_seen_sequence)
    return hmac.compare_digest(expected, proof)


def derive_rekeyed_session_key(
    old_session_key: bytes,
    new_shared_secret: bytes,
    session_id: str,
) -> bytes:
    info = ("DCP-AI.v2.A2A.Rekey" + session_id).encode("utf-8")
    return hmac.new(old_session_key, new_shared_secret + info, hashlib.sha256).digest()
