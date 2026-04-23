"""
DCP v2.0 Adaptive Security Tier Engine — Python port.
"""

from __future__ import annotations

from typing import Any

_SENSITIVE_DATA_CLASSES = frozenset(
    {"pii", "financial_data", "health_data", "credentials", "children_data"}
)
_HIGH_VALUE_DATA_CLASSES = frozenset({"credentials", "children_data"})

_TIER_TO_VERIFICATION_MODE = {
    "routine": "classical_only",
    "standard": "hybrid_preferred",
    "elevated": "hybrid_required",
    "maximum": "hybrid_required",
}
_TIER_TO_CHECKPOINT_INTERVAL = {
    "routine": 50,
    "standard": 10,
    "elevated": 1,
    "maximum": 1,
}
_TIER_RANK = {"routine": 0, "standard": 1, "elevated": 2, "maximum": 3}


def compute_security_tier(intent: dict[str, Any]) -> str:
    """Compute the security tier from an intent's risk score, data classes, and action type."""
    score = int(intent.get("risk_score", 0) or 0)
    data_classes = intent.get("data_classes") or []
    has_high_value = any(d in _HIGH_VALUE_DATA_CLASSES for d in data_classes)
    has_sensitive = any(d in _SENSITIVE_DATA_CLASSES for d in data_classes)
    is_payment = intent.get("action_type") == "initiate_payment"

    if score >= 800 or has_high_value:
        return "maximum"
    if score >= 500 or has_sensitive or is_payment:
        return "elevated"
    if score >= 200:
        return "standard"
    return "routine"


def max_tier(a: str, b: str) -> str:
    """Return the stricter of two tiers (used for floors that must never downgrade)."""
    return a if _TIER_RANK.get(a, 0) >= _TIER_RANK.get(b, 0) else b


def tier_to_verification_mode(tier: str) -> str:
    """Map a tier to the corresponding verification mode."""
    return _TIER_TO_VERIFICATION_MODE[tier]


def tier_to_checkpoint_interval(tier: str) -> int:
    """Map a tier to its PQ-checkpoint interval (number of events between checkpoints)."""
    return _TIER_TO_CHECKPOINT_INTERVAL[tier]
