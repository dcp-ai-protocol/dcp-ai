"""
dcp-ai OpenAI integration — Wrapper for the OpenAI client with DCP governance.

Usage:
    from dcp_ai.openai import DCPOpenAIClient

    client = DCPOpenAIClient(
        openai_client=OpenAI(),
        passport=passport_dict,
        hbr=hbr_dict,
        secret_key=secret_key_b64,
        auto_intent=True,
    )
    response = client.chat_completions_create(
        model="gpt-4",
        messages=[{"role": "user", "content": "Hello"}],
    )
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from dcp_ai.crypto import sign_object, public_key_from_secret
from dcp_ai.merkle import intent_hash, hash_object
from dcp_ai.models import (
    Intent,
    IntentTarget,
    PolicyDecision,
    AuditEntry,
    AuditEvidence,
)
from dcp_ai.verify import verify_signed_bundle


# ── Tool definitions for OpenAI Function Calling ──

DCP_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "dcp_verify_bundle",
            "description": "Verify a DCP signed bundle from another AI agent",
            "parameters": {
                "type": "object",
                "required": ["signed_bundle_json"],
                "properties": {
                    "signed_bundle_json": {
                        "type": "string",
                        "description": "JSON string of the signed bundle to verify",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "dcp_declare_intent",
            "description": "Declare an intent before performing an action (DCP-02)",
            "parameters": {
                "type": "object",
                "required": ["action_type", "target_channel"],
                "properties": {
                    "action_type": {
                        "type": "string",
                        "enum": ["browse", "api_call", "send_email", "create_calendar_event",
                                 "initiate_payment", "update_crm", "write_file", "execute_code"],
                    },
                    "target_channel": {
                        "type": "string",
                        "enum": ["web", "api", "email", "calendar", "payments", "crm", "filesystem", "runtime"],
                    },
                    "data_classes": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Types of data involved",
                    },
                    "estimated_impact": {
                        "type": "string",
                        "enum": ["low", "medium", "high"],
                    },
                },
            },
        },
    },
]


def handle_dcp_tool_call(tool_name: str, arguments: dict[str, Any]) -> str:
    """Handle DCP tool calls from OpenAI function calling."""
    if tool_name == "dcp_verify_bundle":
        try:
            bundle = json.loads(arguments.get("signed_bundle_json", "{}"))
            result = verify_signed_bundle(bundle)
            return json.dumps(result)
        except Exception as e:
            return json.dumps({"verified": False, "errors": [str(e)]})

    if tool_name == "dcp_declare_intent":
        intent = Intent(
            intent_id=f"intent-{uuid4().hex[:8]}",
            agent_id="self",
            human_id="self",
            timestamp=datetime.now(timezone.utc).isoformat(),
            action_type=arguments.get("action_type", "api_call"),  # type: ignore
            target=IntentTarget(channel=arguments.get("target_channel", "api")),  # type: ignore
            data_classes=arguments.get("data_classes", ["none"]),
            estimated_impact=arguments.get("estimated_impact", "low"),  # type: ignore
        )
        return json.dumps({"intent_declared": True, "intent": intent.model_dump()})

    return json.dumps({"error": f"Unknown tool: {tool_name}"})


class DCPOpenAIClient:
    """
    Wrapper around the OpenAI client that injects DCP governance.
    Automatically declares intents and creates audit entries for each API call.
    """

    def __init__(
        self,
        openai_client: Any,
        passport: dict[str, Any],
        hbr: dict[str, Any],
        secret_key: str = "",
        auto_intent: bool = True,
    ) -> None:
        self.client = openai_client
        self.passport = passport
        self.hbr = hbr
        self.secret_key = secret_key
        self.auto_intent = auto_intent
        self.audit_trail: list[dict[str, Any]] = []
        self._prev_hash = "GENESIS"

    def _log_audit(self, intent_id: str, i_hash: str, outcome: str, evidence: Optional[dict[str, Any]] = None) -> None:
        entry = AuditEntry(
            audit_id=f"audit-{uuid4().hex[:8]}",
            prev_hash=self._prev_hash,
            timestamp=datetime.now(timezone.utc).isoformat(),
            agent_id=self.passport.get("agent_id", ""),
            human_id=self.hbr.get("human_id", ""),
            intent_id=intent_id,
            intent_hash=i_hash,
            policy_decision="approved",  # type: ignore
            outcome=outcome,
            evidence=AuditEvidence(**(evidence or {"tool": "openai"})),
        )
        entry_dict = entry.model_dump()
        self._prev_hash = hash_object(entry_dict)
        self.audit_trail.append(entry_dict)

    def chat_completions_create(self, **kwargs: Any) -> Any:
        """Create a chat completion with DCP governance."""
        intent = Intent(
            intent_id=f"intent-{uuid4().hex[:8]}",
            agent_id=self.passport.get("agent_id", ""),
            human_id=self.hbr.get("human_id", ""),
            timestamp=datetime.now(timezone.utc).isoformat(),
            action_type="api_call",  # type: ignore
            target=IntentTarget(channel="api"),  # type: ignore
            data_classes=["none"],
            estimated_impact="low",  # type: ignore
        )
        i_hash = intent_hash(intent.model_dump())

        # Include DCP tools if auto_intent
        if self.auto_intent and "tools" not in kwargs:
            kwargs["tools"] = DCP_TOOLS

        response = self.client.chat.completions.create(**kwargs)

        self._log_audit(
            intent.intent_id, i_hash,
            outcome="chat_completion",
            evidence={"tool": "openai", "result_ref": response.id if hasattr(response, 'id') else None},
        )

        return response

    def get_audit_trail(self) -> list[dict[str, Any]]:
        return self.audit_trail
