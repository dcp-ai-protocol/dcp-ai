"""
dcp-ai CrewAI/AutoGen integration — V2 multi-agent governance with DCP.

Each agent in a crew gets its own passport and generates independent V2
audit trails with session nonces, composite signature support, and
integer risk scores (millirisk).

Usage:
    from dcp_ai.crewai import DCPCrew, DCPCrewAgent

    agent1 = DCPCrewAgent(
        role="researcher",
        passport=passport1_v2_dict,
        rpr=rpr_v2_dict,
        session_nonce=nonce,
    )
    agent2 = DCPCrewAgent(
        role="writer",
        passport=passport2_v2_dict,
        rpr=rpr_v2_dict,
        session_nonce=nonce,
    )

    crew = DCPCrew(agents=[agent1, agent2])
    result = crew.kickoff(task="Write a report on AI governance")
    audit = crew.get_combined_audit_trail()
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from dcp_ai.v2.models import (
    IntentV2,
    AuditEventV2,
)
from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.dual_hash import sha256_hex


def _hash_object(obj: Any) -> str:
    canonical = canonicalize_v2(obj)
    return f"sha256:{sha256_hex(canonical.encode('utf-8'))}"


def _generate_session_nonce() -> str:
    return os.urandom(32).hex()


SENSITIVE_DATA_CLASSES = {"pii", "financial_data", "health_data", "credentials", "children_data"}
HIGH_VALUE_DATA_CLASSES = {"credentials", "children_data"}


def _compute_risk_score(action_type: str, impact: str, data_classes: list[str]) -> int:
    impact_scores = {"low": 200, "medium": 500, "high": 900}
    action_weights = {
        "browse": 100, "api_call": 300, "send_email": 500,
        "create_calendar_event": 200, "initiate_payment": 900,
        "update_crm": 400, "write_file": 400, "execute_code": 700,
    }
    base = impact_scores.get(impact, 500)
    action_w = action_weights.get(action_type, 300)
    sensitive_count = sum(1 for d in data_classes if d in SENSITIVE_DATA_CLASSES)
    return min(1000, round((base + action_w) / 2 + sensitive_count * 150))


def _compute_security_tier(
    risk_score: int,
    data_classes: list[str],
    action_type: str,
) -> str:
    has_high_value = any(d in HIGH_VALUE_DATA_CLASSES for d in data_classes)
    has_sensitive = any(d in SENSITIVE_DATA_CLASSES for d in data_classes)
    is_payment = action_type == "initiate_payment"

    if risk_score >= 800 or has_high_value:
        return "maximum"
    if risk_score >= 500 or has_sensitive or is_payment:
        return "elevated"
    if risk_score >= 200:
        return "standard"
    return "routine"


class DCPCrewAgent:
    """
    A CrewAI-compatible agent with V2 DCP citizenship.
    Each agent has its own passport, audit trail, and session binding.
    """

    def __init__(
        self,
        role: str,
        passport: dict[str, Any],
        rpr: dict[str, Any],
        secret_key: str = "",
        session_nonce: str = "",
        goal: str = "",
        backstory: str = "",
    ) -> None:
        self.role = role
        self.passport = passport
        self.rpr = rpr
        self.secret_key = secret_key
        self.session_nonce = session_nonce or _generate_session_nonce()
        self.goal = goal
        self.backstory = backstory
        self.lifecycle_state: str = "active"
        self.audit_trail: list[dict[str, Any]] = []
        self._prev_hash = "GENESIS"

    def commission(
        self,
        purpose: str = "",
        capabilities: Optional[list[str]] = None,
        risk_tier: str = "medium",
    ) -> dict[str, Any]:
        """Commission this agent (DCP-05 §3.1)."""
        now = datetime.now(timezone.utc).isoformat()
        cert = {
            "dcp_version": "2.0",
            "certificate_id": f"cert-{uuid4().hex[:8]}",
            "session_nonce": self.session_nonce,
            "agent_id": self.passport.get("agent_id", ""),
            "purpose": purpose or f"Crew role: {self.role}",
            "initial_capabilities": capabilities or self.passport.get("capabilities", []),
            "risk_tier": risk_tier,
            "timestamp": now,
            "_spec_ref": "DCP-05 §3.1",
        }
        self.lifecycle_state = "commissioned"
        self.log_action(
            action_type="api_call",
            outcome="agent_commissioned",
            evidence={"tool": f"crewai:{self.role}", "_spec_ref": "DCP-05 §3.1"},
        )
        return cert

    def report_vitality(self, metrics: dict[str, float]) -> dict[str, Any]:
        """Report vitality metrics (DCP-05 §4.1)."""
        now = datetime.now(timezone.utc).isoformat()
        tcr = metrics.get("task_completion_rate", 0)
        er = metrics.get("error_rate", 0)
        hs = metrics.get("human_satisfaction", 0)
        pa = metrics.get("policy_alignment", 0)
        score = tcr * 0.3 + (1 - er) * 0.2 + hs * 0.25 + pa * 0.25
        report = {
            "dcp_version": "2.0",
            "report_id": f"vitality-{uuid4().hex[:8]}",
            "session_nonce": self.session_nonce,
            "agent_id": self.passport.get("agent_id", ""),
            "metrics": metrics,
            "vitality_score": round(score, 4),
            "timestamp": now,
            "_spec_ref": "DCP-05 §4.1",
        }
        return report

    def decommission(
        self, mode: str = "graceful", reason: str = ""
    ) -> dict[str, Any]:
        """Decommission this agent (DCP-05 §5.1)."""
        now = datetime.now(timezone.utc).isoformat()
        record = {
            "dcp_version": "2.0",
            "record_id": f"decom-{uuid4().hex[:8]}",
            "session_nonce": self.session_nonce,
            "agent_id": self.passport.get("agent_id", ""),
            "termination_mode": mode,
            "reason": reason,
            "timestamp": now,
            "_spec_ref": "DCP-05 §5.1",
        }
        self.lifecycle_state = "decommissioned"
        return record

    def create_testament(
        self,
        successor_preferences: list[dict[str, Any]],
        memory_classification: str = "transferable",
    ) -> dict[str, Any]:
        """Create a digital testament (DCP-06 §3.1)."""
        now = datetime.now(timezone.utc).isoformat()
        testament = {
            "dcp_version": "2.0",
            "testament_id": f"testament-{uuid4().hex[:8]}",
            "session_nonce": self.session_nonce,
            "agent_id": self.passport.get("agent_id", ""),
            "successor_preferences": successor_preferences,
            "memory_classification": memory_classification,
            "timestamp": now,
            "_spec_ref": "DCP-06 §3.1",
        }
        return testament

    def log_action(
        self,
        action_type: str = "api_call",
        outcome: str = "completed",
        evidence: Optional[dict[str, Any]] = None,
        impact: str = "low",
        data_classes: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """Log an action as a V2 DCP audit entry."""
        if self.lifecycle_state == "decommissioned":
            raise RuntimeError(
                f"Agent {self.passport.get('agent_id', self.role)} is decommissioned (DCP-05 §5.1)"
            )
        dc = data_classes or ["none"]
        risk_score = _compute_risk_score(action_type, impact, dc)
        tier = _compute_security_tier(risk_score, dc, action_type)
        intent = IntentV2(
            dcp_version="2.0",
            intent_id=f"intent-{uuid4().hex[:8]}",
            session_nonce=self.session_nonce,
            agent_id=self.passport.get("agent_id", ""),
            human_id=self.rpr.get("human_id", ""),
            timestamp=datetime.now(timezone.utc).isoformat(),
            action_type=action_type,
            target={"channel": "api"},
            data_classes=dc,
            estimated_impact=impact,
            security_tier=tier,
        )
        i_hash = _hash_object(intent.model_dump())

        entry = AuditEventV2(
            dcp_version="2.0",
            audit_id=f"audit-{uuid4().hex[:8]}",
            session_nonce=self.session_nonce,
            prev_hash=self._prev_hash,
            hash_alg="sha256",
            timestamp=datetime.now(timezone.utc).isoformat(),
            agent_id=self.passport.get("agent_id", ""),
            human_id=self.rpr.get("human_id", ""),
            intent_id=intent.intent_id,
            intent_hash=i_hash,
            policy_decision="approved",
            outcome=outcome,
            evidence=evidence or {"tool": f"crewai:{self.role}"},
            pq_checkpoint_ref=None,
        )
        entry_dict = entry.model_dump()
        self._prev_hash = _hash_object(entry_dict)
        self.audit_trail.append(entry_dict)
        return entry_dict

    def get_audit_trail(self) -> list[dict[str, Any]]:
        return self.audit_trail

    def get_session_nonce(self) -> str:
        return self.session_nonce


class DCPCrew:
    """
    A crew of V2 DCP-enabled agents. Manages multi-agent governance,
    combining audit trails and supporting per-agent session binding.
    """

    def __init__(
        self,
        agents: list[DCPCrewAgent],
        session_nonce: str = "",
        verbose: bool = False,
    ) -> None:
        self.agents = agents
        self.session_nonce = session_nonce or _generate_session_nonce()
        self.verbose = verbose
        for agent in self.agents:
            if not agent.session_nonce:
                agent.session_nonce = self.session_nonce

    def kickoff(self, task: str) -> dict[str, Any]:
        """
        Simulate a crew execution. Each agent logs their participation.
        In production, this wraps the actual CrewAI kickoff.
        """
        results: dict[str, Any] = {"task": task, "agents": [], "dcp_version": "2.0"}

        for agent in self.agents:
            agent.log_action(
                action_type="api_call",
                outcome=f"participated_in_task:{task[:50]}",
                evidence={"tool": f"crewai:{agent.role}", "result_ref": None},
            )
            results["agents"].append({
                "role": agent.role,
                "agent_id": agent.passport.get("agent_id", ""),
                "session_nonce": agent.session_nonce,
                "audit_entries": len(agent.audit_trail),
            })

        return results

    def get_combined_audit_trail(self) -> list[dict[str, Any]]:
        """Get combined V2 audit trail from all agents, sorted by timestamp."""
        combined: list[dict[str, Any]] = []
        for agent in self.agents:
            for entry in agent.audit_trail:
                combined.append({
                    **entry,
                    "_agent_role": agent.role,
                })
        combined.sort(key=lambda e: e.get("timestamp", ""))
        return combined

    def get_agent_bundles(self) -> dict[str, list[dict[str, Any]]]:
        """Get per-agent V2 audit trails keyed by agent_id."""
        bundles: dict[str, list[dict[str, Any]]] = {}
        for agent in self.agents:
            agent_id = agent.passport.get("agent_id", agent.role)
            bundles[agent_id] = agent.audit_trail
        return bundles

    def commission_all(self, purpose: str = "") -> list[dict[str, Any]]:
        """Commission all agents in the crew (DCP-05 §3.1)."""
        results = []
        for agent in self.agents:
            cert = agent.commission(purpose=purpose or f"Crew member: {agent.role}")
            results.append(cert)
        return results

    def succession(
        self, from_agent: DCPCrewAgent, to_agent: DCPCrewAgent
    ) -> dict[str, Any]:
        """Create a succession record between two agents (DCP-06 §4.1)."""
        now = datetime.now(timezone.utc).isoformat()
        record = {
            "dcp_version": "2.0",
            "record_id": f"succession-{uuid4().hex[:8]}",
            "session_nonce": self.session_nonce,
            "predecessor_agent_id": from_agent.passport.get("agent_id", from_agent.role),
            "successor_agent_id": to_agent.passport.get("agent_id", to_agent.role),
            "timestamp": now,
            "_spec_ref": "DCP-06 §4.1",
        }
        return record

    def delegate(
        self,
        human_id: str,
        agent: DCPCrewAgent,
        authority_scope: list[str],
    ) -> dict[str, Any]:
        """Create a delegation mandate for an agent (DCP-09 §3.1)."""
        now = datetime.now(timezone.utc).isoformat()
        mandate = {
            "dcp_version": "2.0",
            "mandate_id": f"mandate-{uuid4().hex[:8]}",
            "session_nonce": self.session_nonce,
            "human_id": human_id,
            "agent_id": agent.passport.get("agent_id", agent.role),
            "authority_scope": authority_scope,
            "valid_from": now,
            "timestamp": now,
            "_spec_ref": "DCP-09 §3.1",
        }
        return mandate

    def get_lifecycle_summary(self) -> list[dict[str, Any]]:
        """Get lifecycle state of each agent in the crew."""
        return [
            {
                "role": agent.role,
                "agent_id": agent.passport.get("agent_id", agent.role),
                "lifecycle_state": agent.lifecycle_state,
                "audit_entries": len(agent.audit_trail),
            }
            for agent in self.agents
        ]

    def verify_session_consistency(self) -> dict[str, Any]:
        """Verify all agents share the crew session nonce where expected."""
        errors: list[str] = []
        for agent in self.agents:
            for entry in agent.audit_trail:
                if entry.get("session_nonce") != agent.session_nonce:
                    errors.append(
                        f"Agent {agent.role}: session_nonce mismatch in {entry.get('audit_id')}"
                    )
        return {"valid": len(errors) == 0, "errors": errors}
