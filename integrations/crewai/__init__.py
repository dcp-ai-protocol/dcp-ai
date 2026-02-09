"""
dcp-ai CrewAI/AutoGen integration — Multi-agent governance with DCP.

Each agent in a crew gets its own passport and generates independent audit trails.

Usage:
    from dcp_ai.crewai import DCPCrew, DCPCrewAgent

    agent1 = DCPCrewAgent(
        role="researcher",
        passport=passport1_dict,
        hbr=hbr_dict,
        secret_key=sk1,
    )
    agent2 = DCPCrewAgent(
        role="writer",
        passport=passport2_dict,
        hbr=hbr_dict,
        secret_key=sk2,
    )

    crew = DCPCrew(agents=[agent1, agent2])
    result = crew.kickoff(task="Write a report on AI governance")
    audit = crew.get_combined_audit_trail()
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from dcp_ai.merkle import intent_hash, hash_object
from dcp_ai.models import (
    Intent,
    IntentTarget,
    PolicyDecision,
    AuditEntry,
    AuditEvidence,
)
from dcp_ai.bundle import BundleBuilder, sign_bundle
from dcp_ai.models import HumanBindingRecord, AgentPassport


class DCPCrewAgent:
    """
    A CrewAI-compatible agent with DCP citizenship.
    Each agent has its own passport, audit trail, and signing key.
    """

    def __init__(
        self,
        role: str,
        passport: dict[str, Any],
        hbr: dict[str, Any],
        secret_key: str = "",
        goal: str = "",
        backstory: str = "",
    ) -> None:
        self.role = role
        self.passport = passport
        self.hbr = hbr
        self.secret_key = secret_key
        self.goal = goal
        self.backstory = backstory
        self.audit_trail: list[dict[str, Any]] = []
        self._prev_hash = "GENESIS"

    def log_action(
        self,
        action_type: str = "api_call",
        outcome: str = "completed",
        evidence: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Log an action as a DCP audit entry."""
        intent = Intent(
            intent_id=f"intent-{uuid4().hex[:8]}",
            agent_id=self.passport.get("agent_id", ""),
            human_id=self.hbr.get("human_id", ""),
            timestamp=datetime.now(timezone.utc).isoformat(),
            action_type=action_type,  # type: ignore
            target=IntentTarget(channel="api"),  # type: ignore
            data_classes=["none"],
            estimated_impact="low",  # type: ignore
        )
        i_hash = intent_hash(intent.model_dump())

        entry = AuditEntry(
            audit_id=f"audit-{uuid4().hex[:8]}",
            prev_hash=self._prev_hash,
            timestamp=datetime.now(timezone.utc).isoformat(),
            agent_id=self.passport.get("agent_id", ""),
            human_id=self.hbr.get("human_id", ""),
            intent_id=intent.intent_id,
            intent_hash=i_hash,
            policy_decision="approved",  # type: ignore
            outcome=outcome,
            evidence=AuditEvidence(**(evidence or {"tool": f"crewai:{self.role}"})),
        )
        entry_dict = entry.model_dump()
        self._prev_hash = hash_object(entry_dict)
        self.audit_trail.append(entry_dict)
        return entry_dict

    def get_audit_trail(self) -> list[dict[str, Any]]:
        return self.audit_trail


class DCPCrew:
    """
    A crew of DCP-enabled agents. Manages multi-agent governance,
    combining audit trails and generating per-agent signed bundles.
    """

    def __init__(
        self,
        agents: list[DCPCrewAgent],
        verbose: bool = False,
    ) -> None:
        self.agents = agents
        self.verbose = verbose

    def kickoff(self, task: str) -> dict[str, Any]:
        """
        Simulate a crew execution. Each agent logs their participation.
        In production, this wraps the actual CrewAI kickoff.
        """
        results: dict[str, Any] = {"task": task, "agents": []}

        for agent in self.agents:
            agent.log_action(
                action_type="api_call",
                outcome=f"participated_in_task:{task[:50]}",
                evidence={"tool": f"crewai:{agent.role}", "result_ref": None},
            )
            results["agents"].append({
                "role": agent.role,
                "agent_id": agent.passport.get("agent_id", ""),
                "audit_entries": len(agent.audit_trail),
            })

        return results

    def get_combined_audit_trail(self) -> list[dict[str, Any]]:
        """Get combined audit trail from all agents, sorted by timestamp."""
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
        """Get per-agent audit trails keyed by agent_id."""
        bundles: dict[str, list[dict[str, Any]]] = {}
        for agent in self.agents:
            agent_id = agent.passport.get("agent_id", agent.role)
            bundles[agent_id] = agent.audit_trail
        return bundles
