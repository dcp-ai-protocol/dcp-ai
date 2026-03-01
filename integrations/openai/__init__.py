"""
dcp-ai OpenAI integration — V2 wrapper with DCP governance.

Supports V2 composite signatures, session nonces, integer risk scores
(millirisk), and automatic V2 audit trail generation.

Usage:
    from dcp_ai.openai import DCPOpenAIClient

    client = DCPOpenAIClient(
        openai_client=OpenAI(),
        passport=passport_v2_dict,
        rpr=rpr_v2_dict,
        session_nonce=nonce,
    )
    response = client.chat_completions_create(
        model="gpt-4",
        messages=[{"role": "user", "content": "Hello"}],
    )
"""

from __future__ import annotations

import json
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
from dcp_ai.verify import verify_signed_bundle


def _hash_object(obj: Any) -> str:
    canonical = canonicalize_v2(obj)
    return f"sha256:{sha256_hex(canonical.encode('utf-8'))}"


def _generate_session_nonce() -> str:
    return os.urandom(32).hex()


# ── Tool definitions for OpenAI Function Calling ──

DCP_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "dcp_verify_bundle",
            "description": "Verify a DCP signed bundle (V1 or V2) from another AI agent",
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
            "description": "Declare an intent before performing an action (DCP-02 V2)",
            "parameters": {
                "type": "object",
                "required": ["action_type", "target_channel"],
                "properties": {
                    "action_type": {
                        "type": "string",
                        "enum": [
                            "browse", "api_call", "send_email", "create_calendar_event",
                            "initiate_payment", "update_crm", "write_file", "execute_code",
                        ],
                    },
                    "target_channel": {
                        "type": "string",
                        "enum": [
                            "web", "api", "email", "calendar", "payments",
                            "crm", "filesystem", "runtime",
                        ],
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


def handle_dcp_tool_call(
    tool_name: str,
    arguments: dict[str, Any],
    session_nonce: str = "",
) -> str:
    """Handle DCP tool calls from OpenAI function calling (V2-aware)."""
    if tool_name == "dcp_verify_bundle":
        try:
            bundle = json.loads(arguments.get("signed_bundle_json", "{}"))
            result = verify_signed_bundle(bundle)
            return json.dumps(result)
        except Exception as e:
            return json.dumps({"verified": False, "errors": [str(e)]})

    if tool_name == "dcp_declare_intent":
        intent = IntentV2(
            dcp_version="2.0",
            intent_id=f"intent-{uuid4().hex[:8]}",
            session_nonce=session_nonce or _generate_session_nonce(),
            agent_id="self",
            human_id="self",
            timestamp=datetime.now(timezone.utc).isoformat(),
            action_type=arguments.get("action_type", "api_call"),
            target={"channel": arguments.get("target_channel", "api")},
            data_classes=arguments.get("data_classes", ["none"]),
            estimated_impact=arguments.get("estimated_impact", "low"),
        )
        return json.dumps({"intent_declared": True, "intent": intent.model_dump()})

    return json.dumps({"error": f"Unknown tool: {tool_name}"})


class DCPOpenAIClient:
    """
    Wrapper around the OpenAI client that injects V2 DCP governance.
    Automatically declares intents and creates V2 audit entries.
    """

    def __init__(
        self,
        openai_client: Any,
        passport: dict[str, Any],
        rpr: dict[str, Any],
        secret_key: str = "",
        session_nonce: str = "",
        auto_intent: bool = True,
    ) -> None:
        self.client = openai_client
        self.passport = passport
        self.rpr = rpr
        self.secret_key = secret_key
        self.session_nonce = session_nonce or _generate_session_nonce()
        self.auto_intent = auto_intent
        self.audit_trail: list[dict[str, Any]] = []
        self._prev_hash = "GENESIS"

    def _log_audit(
        self,
        intent_id: str,
        i_hash: str,
        outcome: str,
        evidence: Optional[dict[str, Any]] = None,
    ) -> None:
        entry = AuditEventV2(
            dcp_version="2.0",
            audit_id=f"audit-{uuid4().hex[:8]}",
            session_nonce=self.session_nonce,
            prev_hash=self._prev_hash,
            hash_alg="sha256",
            timestamp=datetime.now(timezone.utc).isoformat(),
            agent_id=self.passport.get("agent_id", ""),
            human_id=self.rpr.get("human_id", ""),
            intent_id=intent_id,
            intent_hash=i_hash,
            policy_decision="approved",
            outcome=outcome,
            evidence=evidence or {"tool": "openai"},
            pq_checkpoint_ref=None,
        )
        entry_dict = entry.model_dump()
        self._prev_hash = _hash_object(entry_dict)
        self.audit_trail.append(entry_dict)

    def chat_completions_create(self, **kwargs: Any) -> Any:
        """Create a chat completion with V2 DCP governance."""
        intent = IntentV2(
            dcp_version="2.0",
            intent_id=f"intent-{uuid4().hex[:8]}",
            session_nonce=self.session_nonce,
            agent_id=self.passport.get("agent_id", ""),
            human_id=self.rpr.get("human_id", ""),
            timestamp=datetime.now(timezone.utc).isoformat(),
            action_type="api_call",
            target={"channel": "api"},
            data_classes=["none"],
            estimated_impact="low",
        )
        i_hash = _hash_object(intent.model_dump())

        if self.auto_intent and "tools" not in kwargs:
            kwargs["tools"] = DCP_TOOLS

        response = self.client.chat.completions.create(**kwargs)

        self._log_audit(
            intent.intent_id,
            i_hash,
            outcome="chat_completion",
            evidence={
                "tool": "openai",
                "result_ref": response.id if hasattr(response, "id") else None,
            },
        )

        return response

    def get_audit_trail(self) -> list[dict[str, Any]]:
        return self.audit_trail

    def get_session_nonce(self) -> str:
        return self.session_nonce
