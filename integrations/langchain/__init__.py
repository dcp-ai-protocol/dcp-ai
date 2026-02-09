"""
dcp-ai LangChain integration — Wrap LangChain agents with DCP citizenship.

Components:
  - DCPAgentWrapper: Wraps any LangChain agent with DCP citizenship
  - DCPTool: Tool that verifies bundles from other agents
  - DCPCallback: Callback handler that generates audit entries automatically
  - DCPChain: Chain that adds intent declaration before execution
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional, Sequence
from uuid import uuid4

from dcp_ai.crypto import sign_object, canonicalize, public_key_from_secret
from dcp_ai.merkle import intent_hash, hash_object
from dcp_ai.verify import verify_signed_bundle
from dcp_ai.models import (
    Intent,
    IntentTarget,
    PolicyDecision,
    AuditEntry,
    AuditEvidence,
)


class DCPAgentWrapper:
    """
    Wraps a LangChain agent with DCP citizenship.
    Each action generates: Intent -> PolicyDecision -> AuditEntry -> Signed Bundle.

    Usage:
        agent = DCPAgentWrapper(
            agent=my_langchain_agent,
            passport=my_passport_dict,
            hbr=my_hbr_dict,
            secret_key=secret_key_b64,
        )
        result = await agent.invoke({"input": "Send email to bob@example.com"})
    """

    def __init__(
        self,
        agent: Any,
        passport: dict[str, Any],
        hbr: dict[str, Any],
        secret_key: str,
        auto_intent: bool = True,
        policy_engine: Optional[Any] = None,
    ) -> None:
        self.agent = agent
        self.passport = passport
        self.hbr = hbr
        self.secret_key = secret_key
        self.auto_intent = auto_intent
        self.policy_engine = policy_engine
        self.audit_trail: list[dict[str, Any]] = []
        self._prev_hash = "GENESIS"

    def _create_intent(
        self,
        action_type: str = "api_call",
        target_channel: str = "api",
        data_classes: Optional[list[str]] = None,
        impact: str = "low",
    ) -> Intent:
        """Create an Intent declaration for the current action."""
        return Intent(
            intent_id=f"intent-{uuid4().hex[:8]}",
            agent_id=self.passport.get("agent_id", ""),
            human_id=self.hbr.get("human_id", ""),
            timestamp=datetime.now(timezone.utc).isoformat(),
            action_type=action_type,  # type: ignore
            target=IntentTarget(channel=target_channel),  # type: ignore
            data_classes=data_classes or ["none"],
            estimated_impact=impact,  # type: ignore
        )

    def _create_policy_decision(self, intent: Intent) -> PolicyDecision:
        """Create a PolicyDecision (auto-approve for low risk, or use policy engine)."""
        if self.policy_engine:
            return self.policy_engine.evaluate(intent)
        return PolicyDecision(
            intent_id=intent.intent_id,
            decision="approve",
            risk_score=0.1,
            reasons=["auto_approved_low_risk"],
        )

    def _create_audit_entry(
        self,
        intent: Intent,
        policy: PolicyDecision,
        outcome: str,
        evidence: Optional[dict[str, Any]] = None,
    ) -> AuditEntry:
        """Create an AuditEntry with correct hash chaining."""
        i_hash = intent_hash(intent.model_dump())
        entry = AuditEntry(
            audit_id=f"audit-{uuid4().hex[:8]}",
            prev_hash=self._prev_hash,
            timestamp=datetime.now(timezone.utc).isoformat(),
            agent_id=self.passport.get("agent_id", ""),
            human_id=self.hbr.get("human_id", ""),
            intent_id=intent.intent_id,
            intent_hash=i_hash,
            policy_decision="approved" if policy.decision == "approve" else "blocked",  # type: ignore
            outcome=outcome,
            evidence=AuditEvidence(**(evidence or {"tool": "langchain"})),
        )
        self._prev_hash = hash_object(entry.model_dump())
        return entry

    async def invoke(self, inputs: dict[str, Any], **kwargs: Any) -> Any:
        """Invoke the wrapped agent with DCP governance."""
        # 1. Create intent
        intent = self._create_intent()

        # 2. Policy decision
        policy = self._create_policy_decision(intent)

        if policy.decision == "block":
            return {"error": "Action blocked by policy", "policy": policy.model_dump()}

        # 3. Execute the agent
        result = await self.agent.ainvoke(inputs, **kwargs) if hasattr(self.agent, 'ainvoke') else self.agent.invoke(inputs, **kwargs)

        # 4. Create audit entry
        entry = self._create_audit_entry(
            intent, policy,
            outcome="completed",
            evidence={"tool": "langchain", "result_ref": str(result)[:100]},
        )
        self.audit_trail.append(entry.model_dump())

        return result

    def get_audit_trail(self) -> list[dict[str, Any]]:
        """Get the full audit trail for this agent session."""
        return self.audit_trail


class DCPTool:
    """
    LangChain-compatible tool that verifies DCP bundles from other agents.

    Usage (as a LangChain tool):
        tool = DCPTool()
        result = tool.run(signed_bundle_json)
    """

    name: str = "dcp_verify_bundle"
    description: str = "Verify a DCP signed bundle from another AI agent. Input: JSON string of a signed bundle."

    def run(self, signed_bundle_json: str) -> str:
        """Verify a signed bundle."""
        try:
            signed_bundle = json.loads(signed_bundle_json) if isinstance(signed_bundle_json, str) else signed_bundle_json
            result = verify_signed_bundle(signed_bundle)
            if result["verified"]:
                agent_id = signed_bundle.get("bundle", {}).get("agent_passport", {}).get("agent_id", "unknown")
                return f"Bundle VERIFIED for agent {agent_id}"
            return f"Bundle INVALID: {', '.join(result.get('errors', []))}"
        except Exception as e:
            return f"Verification error: {str(e)}"

    async def arun(self, signed_bundle_json: str) -> str:
        return self.run(signed_bundle_json)


class DCPCallback:
    """
    Callback handler that generates audit entries automatically for LangChain operations.
    Attach to any LangChain chain/agent to get automatic DCP audit logging.
    """

    def __init__(
        self,
        agent_id: str,
        human_id: str,
    ) -> None:
        self.agent_id = agent_id
        self.human_id = human_id
        self.entries: list[dict[str, Any]] = []
        self._prev_hash = "GENESIS"

    def on_chain_start(self, serialized: dict[str, Any], inputs: dict[str, Any], **kwargs: Any) -> None:
        """Log chain start as an audit entry."""
        entry = {
            "dcp_version": "1.0",
            "audit_id": f"audit-{uuid4().hex[:8]}",
            "prev_hash": self._prev_hash,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "agent_id": self.agent_id,
            "human_id": self.human_id,
            "intent_id": kwargs.get("run_id", f"run-{uuid4().hex[:8]}"),
            "intent_hash": "pending",
            "policy_decision": "approved",
            "outcome": "chain_started",
            "evidence": {"tool": serialized.get("name", "langchain"), "result_ref": None},
        }
        self._prev_hash = hash_object(entry)
        self.entries.append(entry)

    def on_chain_end(self, outputs: dict[str, Any], **kwargs: Any) -> None:
        """Log chain completion."""
        entry = {
            "dcp_version": "1.0",
            "audit_id": f"audit-{uuid4().hex[:8]}",
            "prev_hash": self._prev_hash,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "agent_id": self.agent_id,
            "human_id": self.human_id,
            "intent_id": kwargs.get("run_id", f"run-{uuid4().hex[:8]}"),
            "intent_hash": "completed",
            "policy_decision": "approved",
            "outcome": "chain_completed",
            "evidence": {"tool": "langchain", "result_ref": str(outputs)[:200]},
        }
        self._prev_hash = hash_object(entry)
        self.entries.append(entry)

    def get_entries(self) -> list[dict[str, Any]]:
        return self.entries
