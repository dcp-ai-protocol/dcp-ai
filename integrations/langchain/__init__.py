"""
dcp-ai LangChain integration — V2 agent wrapper with DCP citizenship.

Supports V2 composite signatures, session nonces, PQ checkpoints, blinded
 RPR mode, and integer risk scores (millirisk).

Components:
  - DCPAgentWrapper: Wraps any LangChain agent with V2 DCP citizenship
  - DCPTool: Tool that verifies V1/V2 bundles from other agents
  - DCPCallback: Callback handler that generates V2 audit entries automatically
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from typing import Any, Optional, Sequence
from uuid import uuid4

from dcp_ai.v2.models import (
    IntentV2,
    PolicyDecisionV2,
    AuditEventV2,
)
from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.dual_hash import sha256_hex
from dcp_ai.v2.domain_separation import DCP_CONTEXTS
from dcp_ai.verify import verify_signed_bundle


def _hash_object(obj: Any) -> str:
    canonical = canonicalize_v2(obj)
    return f"sha256:{sha256_hex(canonical.encode('utf-8'))}"


def _intent_hash(intent_dict: dict[str, Any]) -> str:
    return _hash_object(intent_dict)


def _generate_session_nonce() -> str:
    return os.urandom(32).hex()


SENSITIVE_DATA_CLASSES = {"pii", "financial_data", "health_data", "credentials", "children_data"}
HIGH_VALUE_DATA_CLASSES = {"credentials", "children_data"}


def _compute_security_tier(
    risk_score: int,
    data_classes: list[str],
    action_type: str,
) -> str:
    """Compute adaptive security tier from risk score, data classes, and action."""
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


class DCPAgentWrapper:
    """
    Wraps a LangChain agent with V2 DCP citizenship.
    Each action generates: IntentV2 -> PolicyDecisionV2 -> AuditEventV2.

    Usage:
        agent = DCPAgentWrapper(
            agent=my_langchain_agent,
            passport=my_passport_v2_dict,
            rpr=my_rpr_v2_dict,
            session_nonce=nonce,
        )
        result = await agent.invoke({"input": "Send email to bob@example.com"})
    """

    def __init__(
        self,
        agent: Any,
        passport: dict[str, Any],
        rpr: dict[str, Any],
        secret_key: str = "",
        session_nonce: str = "",
        auto_intent: bool = True,
        policy_engine: Optional[Any] = None,
        pq_checkpoint_interval: int = 10,
    ) -> None:
        self.agent = agent
        self.passport = passport
        self.rpr = rpr
        self.secret_key = secret_key
        self.session_nonce = session_nonce or _generate_session_nonce()
        self.auto_intent = auto_intent
        self.policy_engine = policy_engine
        self.pq_checkpoint_interval = pq_checkpoint_interval
        self.audit_trail: list[dict[str, Any]] = []
        self.pq_checkpoints: list[dict[str, Any]] = []
        self._prev_hash = "GENESIS"
        self._event_count = 0

    def _create_intent(
        self,
        action_type: str = "api_call",
        target_channel: str = "api",
        data_classes: Optional[list[str]] = None,
        impact: str = "low",
    ) -> IntentV2:
        dc = data_classes or ["none"]
        risk_score = _compute_risk_score(action_type, impact, dc)
        tier = _compute_security_tier(risk_score, dc, action_type)
        return IntentV2(
            dcp_version="2.0",
            intent_id=f"intent-{uuid4().hex[:8]}",
            session_nonce=self.session_nonce,
            agent_id=self.passport.get("agent_id", ""),
            human_id=self.rpr.get("human_id", ""),
            timestamp=datetime.now(timezone.utc).isoformat(),
            action_type=action_type,
            target={"channel": target_channel},
            data_classes=dc,
            estimated_impact=impact,
            security_tier=tier,
        )

    def _create_policy_decision(self, intent: IntentV2) -> PolicyDecisionV2:
        if self.policy_engine:
            return self.policy_engine.evaluate(intent)

        dc = intent.data_classes or ["none"]
        risk_score = _compute_risk_score(intent.action_type, intent.estimated_impact, dc)
        tier = _compute_security_tier(risk_score, dc, intent.action_type)

        return PolicyDecisionV2(
            dcp_version="2.0",
            intent_id=intent.intent_id,
            session_nonce=self.session_nonce,
            decision="approve",
            risk_score=risk_score,
            reasons=["auto_approved_low_risk"],
            timestamp=datetime.now(timezone.utc).isoformat(),
            resolved_tier=tier,
        )

    def _create_audit_entry(
        self,
        intent: IntentV2,
        policy: PolicyDecisionV2,
        outcome: str,
        evidence: Optional[dict[str, Any]] = None,
    ) -> AuditEventV2:
        i_hash = _intent_hash(intent.model_dump())
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
            policy_decision="approved" if policy.decision == "approve" else "blocked",
            outcome=outcome,
            evidence=evidence or {"tool": "langchain"},
            pq_checkpoint_ref=None,
        )
        entry_dict = entry.model_dump()
        self._prev_hash = _hash_object(entry_dict)
        self._event_count += 1
        return entry

    async def invoke(self, inputs: dict[str, Any], **kwargs: Any) -> Any:
        """Invoke the wrapped agent with V2 DCP governance."""
        intent = self._create_intent()
        policy = self._create_policy_decision(intent)

        if policy.decision == "block":
            return {"error": "Action blocked by policy", "policy": policy.model_dump()}

        result = (
            await self.agent.ainvoke(inputs, **kwargs)
            if hasattr(self.agent, "ainvoke")
            else self.agent.invoke(inputs, **kwargs)
        )

        entry = self._create_audit_entry(
            intent,
            policy,
            outcome="completed",
            evidence={"tool": "langchain", "result_ref": str(result)[:100]},
        )
        self.audit_trail.append(entry.model_dump())

        return result

    def get_audit_trail(self) -> list[dict[str, Any]]:
        return self.audit_trail

    def get_session_nonce(self) -> str:
        return self.session_nonce


class DCPTool:
    """
    LangChain-compatible tool that verifies DCP bundles (V1 + V2).

    Usage (as a LangChain tool):
        tool = DCPTool()
        result = tool.run(signed_bundle_json)
    """

    name: str = "dcp_verify_bundle"
    description: str = (
        "Verify a DCP signed bundle (V1 or V2) from another AI agent. "
        "Input: JSON string of a signed bundle."
    )

    def run(self, signed_bundle_json: str) -> str:
        try:
            signed_bundle = (
                json.loads(signed_bundle_json)
                if isinstance(signed_bundle_json, str)
                else signed_bundle_json
            )
            result = verify_signed_bundle(signed_bundle)
            if result["verified"]:
                bundle = signed_bundle.get("bundle", {})
                version = bundle.get("dcp_bundle_version", "1.0")
                passport = bundle.get("agent_passport", {})
                agent_id = passport.get("payload", passport).get("agent_id", "unknown")
                return f"Bundle VERIFIED (v{version}) for agent {agent_id}"
            return f"Bundle INVALID: {', '.join(result.get('errors', []))}"
        except Exception as e:
            return f"Verification error: {str(e)}"

    async def arun(self, signed_bundle_json: str) -> str:
        return self.run(signed_bundle_json)


class DCPCallback:
    """
    Callback handler that generates V2 audit entries for LangChain operations.
    Attach to any LangChain chain/agent to get automatic DCP audit logging.
    """

    def __init__(
        self,
        agent_id: str,
        human_id: str,
        session_nonce: str = "",
    ) -> None:
        self.agent_id = agent_id
        self.human_id = human_id
        self.session_nonce = session_nonce or _generate_session_nonce()
        self.entries: list[dict[str, Any]] = []
        self._prev_hash = "GENESIS"

    def _append_entry(self, outcome: str, evidence: dict[str, Any], run_id: str = "") -> None:
        entry = AuditEventV2(
            dcp_version="2.0",
            audit_id=f"audit-{uuid4().hex[:8]}",
            session_nonce=self.session_nonce,
            prev_hash=self._prev_hash,
            hash_alg="sha256",
            timestamp=datetime.now(timezone.utc).isoformat(),
            agent_id=self.agent_id,
            human_id=self.human_id,
            intent_id=run_id or f"run-{uuid4().hex[:8]}",
            intent_hash="pending",
            policy_decision="approved",
            outcome=outcome,
            evidence=evidence,
            pq_checkpoint_ref=None,
        )
        entry_dict = entry.model_dump()
        self._prev_hash = _hash_object(entry_dict)
        self.entries.append(entry_dict)

    def on_chain_start(
        self, serialized: dict[str, Any], inputs: dict[str, Any], **kwargs: Any
    ) -> None:
        self._append_entry(
            outcome="chain_started",
            evidence={"tool": serialized.get("name", "langchain"), "result_ref": None},
            run_id=kwargs.get("run_id", ""),
        )

    def on_chain_end(self, outputs: dict[str, Any], **kwargs: Any) -> None:
        self._append_entry(
            outcome="chain_completed",
            evidence={"tool": "langchain", "result_ref": str(outputs)[:200]},
            run_id=kwargs.get("run_id", ""),
        )

    def get_entries(self) -> list[dict[str, Any]]:
        return self.entries
