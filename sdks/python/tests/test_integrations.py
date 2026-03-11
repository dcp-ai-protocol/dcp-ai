"""
Integration tests for the 4 Python DCP integrations:
  - openai
  - langchain
  - crewai
  - fastapi
"""

from __future__ import annotations

import json
import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, AsyncMock

# ---------------------------------------------------------------------------
# OpenAI integration
# ---------------------------------------------------------------------------


class TestOpenAIToolCall:
    def test_verify_bundle_valid_json(self):
        from dcp_ai.openai import handle_dcp_tool_call

        bundle = {
            "bundle": {
                "responsible_principal_record": {"dcp_version": "1.0"},
                "agent_passport": {"agent_id": "a1"},
                "intent": {},
                "policy_decision": {},
                "audit_entries": [],
            },
            "signature": {"alg": "ed25519", "sig_b64": "fake"},
        }
        result = json.loads(
            handle_dcp_tool_call(
                "dcp_verify_bundle",
                {"signed_bundle_json": json.dumps(bundle)},
            )
        )
        assert isinstance(result.get("verified"), bool)

    def test_verify_bundle_invalid_json(self):
        from dcp_ai.openai import handle_dcp_tool_call

        result = json.loads(
            handle_dcp_tool_call(
                "dcp_verify_bundle",
                {"signed_bundle_json": "not-json!!!"},
            )
        )
        assert result["verified"] is False
        assert len(result["errors"]) > 0

    def test_declare_intent(self):
        from dcp_ai.openai import handle_dcp_tool_call

        result = json.loads(
            handle_dcp_tool_call(
                "dcp_declare_intent",
                {"action_type": "api_call", "target_channel": "api"},
                session_nonce="a" * 64,
            )
        )
        assert result["intent_declared"] is True
        intent = result["intent"]
        assert intent["action_type"] == "api_call"
        assert intent["session_nonce"] == "a" * 64

    def test_unknown_tool(self):
        from dcp_ai.openai import handle_dcp_tool_call

        result = json.loads(handle_dcp_tool_call("nonexistent", {}))
        assert "error" in result

    def test_dcp_tools_structure(self):
        from dcp_ai.openai import DCP_TOOLS

        assert len(DCP_TOOLS) == 6
        for tool in DCP_TOOLS:
            assert tool["type"] == "function"
            assert "name" in tool["function"]
            assert "parameters" in tool["function"]


class TestDCPOpenAIClient:
    def test_initialisation(self):
        from dcp_ai.openai import DCPOpenAIClient

        mock_client = MagicMock()
        passport = {"agent_id": "agent:test"}
        rpr = {"human_id": "rpr:test"}
        client = DCPOpenAIClient(
            openai_client=mock_client,
            passport=passport,
            rpr=rpr,
        )
        assert client.session_nonce
        assert len(client.session_nonce) == 64
        assert client.audit_trail == []

    def test_session_nonce_preserved(self):
        from dcp_ai.openai import DCPOpenAIClient

        nonce = "b" * 64
        client = DCPOpenAIClient(
            openai_client=MagicMock(),
            passport={"agent_id": "a"},
            rpr={"human_id": "h"},
            session_nonce=nonce,
        )
        assert client.get_session_nonce() == nonce

    def test_chat_completion_builds_audit_trail(self):
        from dcp_ai.openai import DCPOpenAIClient

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.id = "resp-123"
        mock_client.chat.completions.create.return_value = mock_response

        client = DCPOpenAIClient(
            openai_client=mock_client,
            passport={"agent_id": "agent:x"},
            rpr={"human_id": "rpr:y"},
        )
        result = client.chat_completions_create(
            model="gpt-4",
            messages=[{"role": "user", "content": "Hello"}],
        )
        assert result == mock_response
        trail = client.get_audit_trail()
        assert len(trail) == 1
        assert trail[0]["agent_id"] == "agent:x"
        assert trail[0]["outcome"] == "chat_completion"


# ---------------------------------------------------------------------------
# LangChain integration
# ---------------------------------------------------------------------------


class TestLangChainRiskScoring:
    def test_compute_risk_score_low(self):
        from dcp_ai.langchain import _compute_risk_score

        score = _compute_risk_score("browse", "low", ["none"])
        assert 0 <= score <= 1000
        assert score < 300

    def test_compute_risk_score_high(self):
        from dcp_ai.langchain import _compute_risk_score

        score = _compute_risk_score("initiate_payment", "high", ["financial_data"])
        assert score >= 500

    def test_compute_security_tier_routine(self):
        from dcp_ai.langchain import _compute_security_tier

        assert _compute_security_tier(100, ["none"], "browse") == "routine"

    def test_compute_security_tier_maximum(self):
        from dcp_ai.langchain import _compute_security_tier

        assert _compute_security_tier(900, ["credentials"], "execute_code") == "maximum"

    def test_compute_security_tier_elevated_payment(self):
        from dcp_ai.langchain import _compute_security_tier

        assert _compute_security_tier(300, ["none"], "initiate_payment") == "elevated"

    def test_compute_security_tier_elevated_sensitive(self):
        from dcp_ai.langchain import _compute_security_tier

        assert _compute_security_tier(300, ["pii"], "api_call") == "elevated"


class TestDCPAgentWrapper:
    def test_creates_intent_and_audit(self):
        from dcp_ai.langchain import DCPAgentWrapper

        mock_agent = MagicMock(spec=[])
        mock_agent.invoke = MagicMock(return_value={"output": "done"})

        wrapper = DCPAgentWrapper(
            agent=mock_agent,
            passport={"agent_id": "agent:lc1"},
            rpr={"human_id": "rpr:h1"},
        )
        import asyncio

        result = asyncio.new_event_loop().run_until_complete(
            wrapper.invoke({"input": "test"})
        )
        assert result == {"output": "done"}
        assert len(wrapper.get_audit_trail()) == 1
        assert wrapper.get_audit_trail()[0]["outcome"] == "completed"

    def test_session_nonce(self):
        from dcp_ai.langchain import DCPAgentWrapper

        wrapper = DCPAgentWrapper(
            agent=MagicMock(),
            passport={"agent_id": "a"},
            rpr={"human_id": "h"},
            session_nonce="c" * 64,
        )
        assert wrapper.get_session_nonce() == "c" * 64


class TestDCPTool:
    def test_run_with_invalid_bundle(self):
        from dcp_ai.langchain import DCPTool

        tool = DCPTool()
        result = tool.run("not-json")
        assert "error" in result.lower() or "invalid" in result.lower()

    def test_run_with_dict_input(self):
        from dcp_ai.langchain import DCPTool

        tool = DCPTool()
        result = tool.run({"bundle": {}, "signature": {}})
        assert isinstance(result, str)


class TestDCPCallback:
    def test_on_chain_start_and_end(self):
        from dcp_ai.langchain import DCPCallback

        cb = DCPCallback(agent_id="agent:cb", human_id="rpr:cb")
        cb.on_chain_start({"name": "test_chain"}, {"input": "hello"})
        cb.on_chain_end({"output": "world"})
        entries = cb.get_entries()
        assert len(entries) == 2
        assert entries[0]["outcome"] == "chain_started"
        assert entries[1]["outcome"] == "chain_completed"

    def test_hash_chain_integrity(self):
        from dcp_ai.langchain import DCPCallback

        cb = DCPCallback(agent_id="a", human_id="h")
        cb.on_chain_start({}, {})
        cb.on_chain_end({})
        entries = cb.get_entries()
        assert entries[0]["prev_hash"] == "GENESIS"
        assert entries[1]["prev_hash"] != "GENESIS"
        assert entries[1]["prev_hash"].startswith("sha256:")


# ---------------------------------------------------------------------------
# CrewAI integration
# ---------------------------------------------------------------------------


class TestDCPCrewAgent:
    def test_log_action_creates_audit_entry(self):
        from dcp_ai.crewai import DCPCrewAgent

        agent = DCPCrewAgent(
            role="researcher",
            passport={"agent_id": "agent:crew1"},
            rpr={"human_id": "rpr:h"},
        )
        entry = agent.log_action(action_type="api_call", outcome="success")
        assert entry["outcome"] == "success"
        assert entry["agent_id"] == "agent:crew1"
        assert entry["dcp_version"] == "2.0"
        assert len(agent.get_audit_trail()) == 1

    def test_hash_chain(self):
        from dcp_ai.crewai import DCPCrewAgent

        agent = DCPCrewAgent(
            role="writer",
            passport={"agent_id": "agent:w"},
            rpr={"human_id": "rpr:w"},
        )
        e1 = agent.log_action()
        e2 = agent.log_action()
        assert e1["prev_hash"] == "GENESIS"
        assert e2["prev_hash"] != "GENESIS"
        assert e2["prev_hash"].startswith("sha256:")

    def test_session_nonce(self):
        from dcp_ai.crewai import DCPCrewAgent

        agent = DCPCrewAgent(
            role="x",
            passport={"agent_id": "a"},
            rpr={"human_id": "h"},
            session_nonce="d" * 64,
        )
        assert agent.get_session_nonce() == "d" * 64


class TestDCPCrew:
    def _make_crew(self):
        from dcp_ai.crewai import DCPCrewAgent, DCPCrew

        a1 = DCPCrewAgent(
            role="researcher",
            passport={"agent_id": "agent:r"},
            rpr={"human_id": "rpr:h"},
        )
        a2 = DCPCrewAgent(
            role="writer",
            passport={"agent_id": "agent:w"},
            rpr={"human_id": "rpr:h"},
        )
        return DCPCrew(agents=[a1, a2])

    def test_kickoff_generates_audit_for_all_agents(self):
        crew = self._make_crew()
        result = crew.kickoff(task="Write a report")
        assert result["dcp_version"] == "2.0"
        assert len(result["agents"]) == 2
        for agent_info in result["agents"]:
            assert agent_info["audit_entries"] == 1

    def test_combined_audit_trail(self):
        crew = self._make_crew()
        crew.kickoff(task="Test task")
        combined = crew.get_combined_audit_trail()
        assert len(combined) == 2
        roles = {e["_agent_role"] for e in combined}
        assert roles == {"researcher", "writer"}

    def test_agent_bundles(self):
        crew = self._make_crew()
        crew.kickoff(task="Bundle test")
        bundles = crew.get_agent_bundles()
        assert "agent:r" in bundles
        assert "agent:w" in bundles

    def test_session_consistency_valid(self):
        crew = self._make_crew()
        crew.kickoff(task="Session test")
        result = crew.verify_session_consistency()
        assert result["valid"] is True
        assert result["errors"] == []

    def test_session_consistency_detects_mismatch(self):
        crew = self._make_crew()
        crew.kickoff(task="Test")
        crew.agents[0].audit_trail[0]["session_nonce"] = "tampered"
        result = crew.verify_session_consistency()
        assert result["valid"] is False
        assert len(result["errors"]) > 0


# ---------------------------------------------------------------------------
# FastAPI integration
# ---------------------------------------------------------------------------


class TestFastAPIVersionDetection:
    def test_detect_v2(self):
        from dcp_ai.fastapi import _detect_version

        bundle = {"bundle": {"dcp_bundle_version": "2.0"}}
        assert _detect_version(bundle) == "2.0"

    def test_detect_v1(self):
        from dcp_ai.fastapi import _detect_version

        bundle = {
            "bundle": {
                "responsible_principal_record": {"dcp_version": "1.0"},
            }
        }
        assert _detect_version(bundle) == "1.0"

    def test_detect_v1_with_payload(self):
        from dcp_ai.fastapi import _detect_version

        bundle = {
            "bundle": {
                "responsible_principal_record": {
                    "payload": {"dcp_version": "2.0"}
                },
            }
        }
        assert _detect_version(bundle) == "2.0"


class TestFastAPISessionBinding:
    def test_valid_session_binding(self):
        from dcp_ai.fastapi import _verify_session_binding

        nonce = "a" * 64
        bundle = {
            "manifest": {"session_nonce": nonce},
            "agent_passport": {"payload": {"session_nonce": nonce}},
            "responsible_principal_record": {"payload": {"session_nonce": nonce}},
            "intent": {"payload": {"session_nonce": nonce}},
            "policy_decision": {"payload": {"session_nonce": nonce}},
            "audit_entries": [{"session_nonce": nonce}],
        }
        valid, info = _verify_session_binding(bundle)
        assert valid is True
        assert info == nonce

    def test_missing_session_nonce(self):
        from dcp_ai.fastapi import _verify_session_binding

        bundle = {"manifest": {}}
        valid, info = _verify_session_binding(bundle)
        assert valid is False
        assert "missing" in info

    def test_mismatched_nonce(self):
        from dcp_ai.fastapi import _verify_session_binding

        bundle = {
            "manifest": {"session_nonce": "a" * 64},
            "agent_passport": {"payload": {"session_nonce": "b" * 64}},
            "responsible_principal_record": {"payload": {}},
            "intent": {"payload": {}},
            "policy_decision": {"payload": {}},
            "audit_entries": [],
        }
        valid, info = _verify_session_binding(bundle)
        assert valid is False
        assert "mismatch" in info


class TestFastAPIV2Structure:
    def _make_valid_v2_bundle(self):
        nonce = "a" * 64
        return {
            "bundle": {
                "dcp_bundle_version": "2.0",
                "manifest": {
                    "session_nonce": nonce,
                    "rpr_hash": "sha256:abc",
                    "passport_hash": "sha256:def",
                    "intent_hash": "sha256:ghi",
                    "policy_hash": "sha256:jkl",
                    "audit_merkle_root": "sha256:mno",
                },
                "responsible_principal_record": {
                    "payload": {"session_nonce": nonce},
                    "composite_sig": {"classical": "sig"},
                },
                "agent_passport": {
                    "payload": {"session_nonce": nonce},
                    "composite_sig": {"classical": "sig"},
                },
                "intent": {
                    "payload": {"session_nonce": nonce},
                    "composite_sig": {"classical": "sig"},
                },
                "policy_decision": {
                    "payload": {"session_nonce": nonce},
                    "composite_sig": {"classical": "sig"},
                },
                "audit_entries": [],
            },
            "signature": {
                "composite_sig": {
                    "classical": "sig",
                    "pq": "pq-sig",
                    "binding": "pq_over_classical",
                },
            },
        }

    def test_valid_v2_structure(self):
        from dcp_ai.fastapi import _verify_v2_structure

        result = _verify_v2_structure(self._make_valid_v2_bundle())
        assert result["verified"] is True
        assert result["errors"] == []

    def test_missing_bundle(self):
        from dcp_ai.fastapi import _verify_v2_structure

        result = _verify_v2_structure({})
        assert result["verified"] is False
        assert any("Missing bundle" in e for e in result["errors"])

    def test_missing_manifest(self):
        from dcp_ai.fastapi import _verify_v2_structure

        bundle = self._make_valid_v2_bundle()
        del bundle["bundle"]["manifest"]
        result = _verify_v2_structure(bundle)
        assert result["verified"] is False
        assert any("Missing manifest" in e for e in result["errors"])

    def test_missing_artifact(self):
        from dcp_ai.fastapi import _verify_v2_structure

        bundle = self._make_valid_v2_bundle()
        del bundle["bundle"]["intent"]
        result = _verify_v2_structure(bundle)
        assert result["verified"] is False
        assert any("intent" in e for e in result["errors"])

    def test_pq_binding_without_pq_sig(self):
        from dcp_ai.fastapi import _verify_v2_structure

        bundle = self._make_valid_v2_bundle()
        bundle["signature"]["composite_sig"] = {
            "classical": "sig",
            "binding": "pq_over_classical",
        }
        result = _verify_v2_structure(bundle)
        assert result["verified"] is False
        assert any("PQ" in e for e in result["errors"])


class TestFastAPIDCPAgentContext:
    def test_dataclass_defaults(self):
        from dcp_ai.fastapi import DCPAgentContext

        ctx = DCPAgentContext()
        assert ctx.dcp_version == "1.0"
        assert ctx.agent_id == ""
        assert ctx.capabilities == []
        assert ctx.composite_sig_valid is False
        assert ctx.blinded_rpr is False

    def test_dataclass_custom_values(self):
        from dcp_ai.fastapi import DCPAgentContext

        ctx = DCPAgentContext(
            dcp_version="2.0",
            agent_id="agent:test",
            session_nonce="nonce",
            composite_sig_valid=True,
        )
        assert ctx.dcp_version == "2.0"
        assert ctx.agent_id == "agent:test"
        assert ctx.composite_sig_valid is True
