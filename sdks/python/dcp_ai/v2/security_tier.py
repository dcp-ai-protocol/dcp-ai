"""
DCP v2.0 Adaptive Security Tier Engine — Python port.
"""

from __future__ import annotations

from typing import Any

# Values allowed by schemas/v2/intent.schema.json.
_ACTION_TYPES = frozenset(
    {
        "browse", "api_call", "send_email", "create_calendar_event",
        "initiate_payment", "update_crm", "write_file", "execute_code",
    }
)
_DATA_CLASSES = frozenset(
    {
        "none", "contact_info", "pii", "credentials",
        "financial_data", "health_data", "children_data", "company_confidential",
    }
)
_IMPACTS = frozenset({"low", "medium", "high"})
_MAXIMUM_DATA_CLASSES = frozenset({"credentials", "children_data"})
_ELEVATED_DATA_CLASSES = frozenset({"pii", "financial_data", "health_data"})

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


def _is(value: Any, allowed: frozenset[str]) -> bool:
    # Signed payloads may hold any JSON type; only strings can be enum values.
    return isinstance(value, str) and value in allowed


def compute_security_tier(
    intent: dict[str, Any], policy_decision: dict[str, Any] | None = None
) -> str:
    """Compute the security tier (spec §14.2) from an intent and the bundle's policy decision.

    ``risk_score`` is read from the policy decision only; with no policy decision it
    counts as 0, as does a non-numeric value. A value outside the intent schema enums,
    including a missing ``action_type``, ``estimated_impact`` or ``data_classes``, fails
    closed to at least ``elevated``. An explicit ``intent["security_tier"]`` can only
    raise the result.
    """
    if not isinstance(intent, dict):
        intent = {}
    if not isinstance(policy_decision, dict):
        policy_decision = {}
    score = policy_decision.get("risk_score")
    if isinstance(score, bool) or not isinstance(score, (int, float)):
        score = 0
    data_classes = intent.get("data_classes")
    if not isinstance(data_classes, list):
        data_classes = [None]
    action_type = intent.get("action_type")
    impact = intent.get("estimated_impact")
    unknown = (
        not _is(action_type, _ACTION_TYPES)
        or not _is(impact, _IMPACTS)
        or not all(_is(d, _DATA_CLASSES) for d in data_classes)
    )

    if score >= 800 or any(_is(d, _MAXIMUM_DATA_CLASSES) for d in data_classes):
        tier = "maximum"
    elif (
        score >= 500
        or unknown
        or any(_is(d, _ELEVATED_DATA_CLASSES) for d in data_classes)
        or action_type == "initiate_payment"
        or impact == "high"
    ):
        tier = "elevated"
    elif score >= 200 or impact == "medium":
        tier = "standard"
    else:
        tier = "routine"

    explicit = intent.get("security_tier")
    if explicit is None:
        return tier
    return max_tier(tier, explicit)


def _known_tier(tier: Any) -> str:
    # A tier name, or "elevated" for anything else: unknown names fail closed.
    return tier if isinstance(tier, str) and tier in _TIER_RANK else "elevated"


def max_tier(a: str, b: str) -> str:
    """Return the stricter of two tiers (used for floors that must never downgrade).

    An unknown tier name counts as "elevated".
    """
    a, b = _known_tier(a), _known_tier(b)
    return a if _TIER_RANK[a] >= _TIER_RANK[b] else b


def tier_to_verification_mode(tier: str) -> str:
    """Map a tier to the corresponding verification mode (unknown names: hybrid_required)."""
    return _TIER_TO_VERIFICATION_MODE[_known_tier(tier)]


def tier_to_checkpoint_interval(tier: str) -> int:
    """Map a tier to its PQ-checkpoint interval (number of events between checkpoints)."""
    return _TIER_TO_CHECKPOINT_INTERVAL[_known_tier(tier)]
