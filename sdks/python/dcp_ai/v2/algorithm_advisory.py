"""
DCP v2.0 Algorithm Deprecation Advisory System (Gap #4).

Signed advisories enable coordinated ecosystem response to algorithm
breaks. Verifiers consume advisories to automatically deprecate/warn
about affected algorithms.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field


AdvisorySeverity = Literal["critical", "high", "medium", "low"]
AdvisoryAction = Literal["deprecate", "warn", "revoke"]


class AlgorithmAdvisory(BaseModel):
    type: Literal["algorithm_advisory"] = "algorithm_advisory"
    advisory_id: str
    severity: AdvisorySeverity
    affected_algorithms: list[str]
    action: AdvisoryAction
    replacement_algorithms: list[str] = Field(default_factory=list)
    effective_date: str
    grace_period_days: int = 90
    description: str
    issued_at: str
    issuer: str
    composite_sig: dict[str, Any] | None = None


class AdvisoryCheckResult(BaseModel):
    affected_algorithms: list[str]
    action: AdvisoryAction
    severity: AdvisorySeverity
    advisory_id: str
    description: str
    grace_period_expired: bool


def check_advisory(
    advisory: AlgorithmAdvisory,
    now: datetime | None = None,
) -> AdvisoryCheckResult:
    """Check an advisory against the current date."""
    current = now or datetime.now(timezone.utc)
    effective = datetime.fromisoformat(advisory.effective_date.replace("Z", "+00:00"))
    grace_end = effective.timestamp() + advisory.grace_period_days * 86400
    grace_expired = current.timestamp() >= grace_end

    return AdvisoryCheckResult(
        affected_algorithms=advisory.affected_algorithms,
        action=advisory.action,
        severity=advisory.severity,
        advisory_id=advisory.advisory_id,
        description=advisory.description,
        grace_period_expired=grace_expired,
    )


def evaluate_advisories(
    advisories: list[AlgorithmAdvisory],
    now: datetime | None = None,
) -> dict[str, Any]:
    """Evaluate all advisories and determine affected algorithms."""
    current = now or datetime.now(timezone.utc)
    deprecated: set[str] = set()
    warned: set[str] = set()
    revoked: set[str] = set()
    active: list[AdvisoryCheckResult] = []

    for advisory in advisories:
        effective = datetime.fromisoformat(advisory.effective_date.replace("Z", "+00:00"))
        if current < effective:
            continue

        result = check_advisory(advisory, current)
        active.append(result)

        for alg in advisory.affected_algorithms:
            if advisory.action == "revoke":
                revoked.add(alg)
            elif advisory.action == "deprecate":
                if result.grace_period_expired:
                    deprecated.add(alg)
                else:
                    warned.add(alg)
            elif advisory.action == "warn":
                warned.add(alg)

    return {
        "deprecated": deprecated,
        "warned": warned,
        "revoked": revoked,
        "active_advisories": active,
    }


def apply_advisories_to_policy(
    accepted_algs: list[str],
    advisory_result: dict[str, Any],
) -> dict[str, Any]:
    """Filter accepted algorithms based on advisory results."""
    blocked = advisory_result["deprecated"] | advisory_result["revoked"]
    removed: list[str] = []
    warnings: list[str] = []
    filtered: list[str] = []

    for alg in accepted_algs:
        if alg in blocked:
            removed.append(alg)
        else:
            filtered.append(alg)
            if alg in advisory_result["warned"]:
                warnings.append(f"Algorithm {alg} has an active advisory warning")

    return {"filtered_algs": filtered, "removed_algs": removed, "warnings": warnings}
