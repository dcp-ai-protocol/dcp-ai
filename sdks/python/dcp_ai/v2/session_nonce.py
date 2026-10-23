"""
DCP v2.0 Session Nonce — anti-splicing defense. Python port.
"""

from __future__ import annotations

import re
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any

_SESSION_NONCE_HEX_LEN = 64
_SESSION_NONCE_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def generate_session_nonce() -> str:
    """Generate a cryptographically random 256-bit session nonce (64 hex chars)."""
    return secrets.token_hex(32)


def is_valid_session_nonce(nonce: Any) -> bool:
    """Return True iff the input is a well-formed session nonce."""
    if not isinstance(nonce, str):
        return False
    if len(nonce) != _SESSION_NONCE_HEX_LEN:
        return False
    return bool(_SESSION_NONCE_PATTERN.match(nonce))


def verify_session_binding(artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    """Verify all artifacts share the same session_nonce.

    Returns {'valid': bool, 'nonce'?: str, 'error'?: str}.
    """
    if not artifacts:
        return {"valid": False, "error": "No artifacts to verify"}
    first = artifacts[0].get("session_nonce")
    if not first or not is_valid_session_nonce(first):
        return {"valid": False, "error": f"Invalid session_nonce in artifact[0]: {first!r}"}
    for i, art in enumerate(artifacts[1:], start=1):
        n = art.get("session_nonce")
        if n != first:
            return {
                "valid": False,
                "error": f"Session nonce mismatch: artifact[0]={first}, artifact[{i}]={n}",
            }
    return {"valid": True, "nonce": first}


_DEFAULT_SESSION_DURATIONS: dict[str, int] = {
    "routine": 86400,
    "standard": 14400,
    "elevated": 3600,
    "maximum": 900,
}


def generate_session_expiry(
    duration_seconds: int | None = None,
    tier: str | None = None,
) -> str:
    """Generate an ISO-8601 session expiry timestamp."""
    if duration_seconds is None:
        duration_seconds = _DEFAULT_SESSION_DURATIONS.get(tier or "", 14400)
    expires = datetime.now(timezone.utc) + timedelta(seconds=duration_seconds)
    # ISO-8601 UTC with Z suffix, matching TS new Date().toISOString()
    return expires.strftime("%Y-%m-%dT%H:%M:%S.") + f"{expires.microsecond // 1000:03d}Z"


# [0-9], not \d, which also matches non-ASCII digits.
_RFC3339 = re.compile(
    r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]+))?(?:Z|([+-])([0-9]{2}):([0-9]{2}))"
)


_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_EPOCH_ORDINAL = _EPOCH.date().toordinal()
# 400 Gregorian years are exactly 146097 days, so year 0000, which datetime
# cannot hold, is counted from the same date in year 0400.
_GREGORIAN_CYCLE_DAYS = 146097


def rfc3339_epoch_ms(value: Any) -> int | None:
    """Milliseconds since the Unix epoch of an RFC 3339 timestamp with a ``Z`` or
    ``±hh:mm`` offset, or None, as the TypeScript SDK's parseRfc3339 returns them.

    Years 0000 to 9999 are valid and digits beyond milliseconds are dropped
    (spec/VERIFICATION.md V2-4). None for anything else: a date without a time, a
    time without an offset, an impossible date or time, or a non-string.
    """
    m = _RFC3339.fullmatch(value) if isinstance(value, str) else None
    if m is None:
        return None
    year, month, day, hour, minute, second = (int(g) for g in m.group(1, 2, 3, 4, 5, 6))
    offset_hours, offset_minutes = (int(m.group(9)), int(m.group(10))) if m.group(8) else (0, 0)
    if hour > 23 or minute > 59 or second > 59 or offset_hours > 23 or offset_minutes > 59:
        return None
    cycles = 1 if year == 0 else 0
    try:
        days = date(year + 400 * cycles, month, day).toordinal() - cycles * _GREGORIAN_CYCLE_DAYS - _EPOCH_ORDINAL
    except ValueError:  # an impossible date
        return None
    millis = int((m.group(7) or "")[:3].ljust(3, "0"))
    offset = (-1 if m.group(8) == "-" else 1) * (offset_hours * 60 + offset_minutes)
    return ((days * 24 + hour) * 60 + minute - offset) * 60_000 + second * 1000 + millis


def parse_rfc3339(value: Any) -> datetime | None:
    """The instant of an RFC 3339 timestamp with a ``Z`` or ``±hh:mm`` offset, or None.

    The instant of rfc3339_epoch_ms, as a UTC datetime at millisecond precision.
    None for anything else: a date without a time, a time without an offset, an
    impossible date or time, a non-string, or an instant before year 0001, which
    datetime cannot hold (rfc3339_epoch_ms takes it).
    """
    millis = rfc3339_epoch_ms(value)
    if millis is None:
        return None
    try:
        return _EPOCH + timedelta(milliseconds=millis)
    except OverflowError:
        return None


def is_session_expired(expires_at: str) -> bool:
    """Return True if `expires_at` has passed.

    A value that is not an RFC 3339 timestamp counts as expired, so a malformed
    expiry fails closed.
    """
    t = parse_rfc3339(expires_at)
    return t is None or t < datetime.now(timezone.utc)
