"""
DCP-09 v2.0 Awareness Threshold Engine — Python port.

Configures and evaluates when an agent must notify its human principal.
Significance is scored in 0..=1000 (millipoints).
"""

from __future__ import annotations

from typing import Any

from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import CompositeKeyInfo, composite_sign
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS
from dcp_ai.v2.lifecycle import _utc_now

_SIGNIFICANCE_WEIGHTS: dict[str, float] = {
    "financial_impact": 0.25,
    "data_sensitivity": 0.20,
    "relationship_impact": 0.20,
    "irreversibility": 0.20,
    "precedent_setting": 0.15,
}


def evaluate_significance(context: dict[str, float]) -> int:
    """Evaluate the significance of an action in 0..=1000."""
    total = 0.0
    for key, weight in _SIGNIFICANCE_WEIGHTS.items():
        v = float(context.get(key, 0.0))
        v = max(0.0, min(1.0, v))
        total += v * weight
    return round(total * 1000)


def _evaluate_operator(operator: str, actual: float, threshold: float) -> bool:
    if operator == "gt":
        return actual > threshold
    if operator == "lt":
        return actual < threshold
    if operator == "gte":
        return actual >= threshold
    if operator == "lte":
        return actual <= threshold
    if operator == "eq":
        return actual == threshold
    raise ValueError(f"Unknown threshold operator: {operator}")


def should_notify_human(
    significance: float,
    thresholds: list[dict[str, Any]],
) -> dict[str, Any]:
    """Determine whether a human should be notified given significance + rules.

    Each rule has: dimension, operator, value, action_if_triggered.
    Returns: {notify, triggered_rules, actions}.
    """
    triggered: list[dict[str, Any]] = []
    actions: list[str] = []
    for rule in thresholds:
        value = significance if rule.get("dimension") == "significance" else 0
        if _evaluate_operator(rule["operator"], value, rule["value"]):
            triggered.append(rule)
            action = rule.get("action_if_triggered")
            if action and action not in actions:
                actions.append(action)
    return {
        "notify": bool(triggered),
        "triggered_rules": triggered,
        "actions": actions,
    }


async def create_awareness_threshold(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    threshold_id: str,
    session_nonce: str,
    agent_id: str,
    human_id: str,
    threshold_rules: list[dict[str, Any]],
) -> dict[str, Any]:
    """Create an awareness threshold configuration."""
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "threshold_id": threshold_id,
        "session_nonce": session_nonce,
        "agent_id": agent_id,
        "human_id": human_id,
        "threshold_rules": threshold_rules,
        "timestamp": _utc_now(),
    }
    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry, DCP_CONTEXTS["Awareness"], canonical.encode("utf-8"), classical_key, pq_key
    )
    return {**payload, "composite_sig": composite}


async def create_advisory_declaration(
    registry: AlgorithmRegistry,
    classical_key: CompositeKeyInfo,
    pq_key: CompositeKeyInfo,
    *,
    declaration_id: str,
    session_nonce: str,
    agent_id: str,
    human_id: str,
    significance_score: int,
    action_summary: str,
    recommended_response: str,
    response_deadline: str,
) -> dict[str, Any]:
    """Create an advisory declaration to notify the human."""
    payload: dict[str, Any] = {
        "dcp_version": "2.0",
        "declaration_id": declaration_id,
        "session_nonce": session_nonce,
        "agent_id": agent_id,
        "human_id": human_id,
        "significance_score": significance_score,
        "action_summary": action_summary,
        "recommended_response": recommended_response,
        "response_deadline": response_deadline,
        "human_response": None,
        "proceeded_without_response": False,
        "timestamp": _utc_now(),
    }
    canonical = canonicalize_v2(payload)
    composite = await composite_sign(
        registry, DCP_CONTEXTS["Awareness"], canonical.encode("utf-8"), classical_key, pq_key
    )
    return {**payload, "composite_sig": composite}
