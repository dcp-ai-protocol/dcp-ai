"""
Integration tests for the 4 Python DCP integrations:
  - openai
  - langchain
  - crewai
  - fastapi
"""

from __future__ import annotations

import base64
import copy
import json
from pathlib import Path

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

        assert _compute_security_tier(100, ["none"], "browse", "low") == "routine"

    def test_compute_security_tier_maximum(self):
        from dcp_ai.langchain import _compute_security_tier

        assert _compute_security_tier(900, ["credentials"], "execute_code", "high") == "maximum"

    def test_compute_security_tier_elevated_payment(self):
        from dcp_ai.langchain import _compute_security_tier

        assert _compute_security_tier(300, ["none"], "initiate_payment", "low") == "elevated"

    def test_compute_security_tier_elevated_sensitive(self):
        from dcp_ai.langchain import _compute_security_tier

        assert _compute_security_tier(300, ["pii"], "api_call", "low") == "elevated"


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

    def test_agents_share_the_crew_session_nonce(self):
        from dcp_ai.crewai import DCPCrewAgent, DCPCrew

        crew = self._make_crew()
        crew.kickoff(task="Write a report")
        nonces = {e["session_nonce"] for e in crew.get_combined_audit_trail()}
        assert nonces == {crew.session_nonce}

        given = DCPCrewAgent(role="r", passport={}, rpr={}, session_nonce="e" * 64)
        fresh = DCPCrewAgent(role="w", passport={}, rpr={})
        crew = DCPCrew(agents=[given, fresh], session_nonce="f" * 64)
        assert [a.session_nonce for a in crew.agents] == ["e" * 64, "f" * 64]

        # A nonce set after construction, or one already in the agent's trail, stays.
        assigned = DCPCrewAgent(role="a", passport={}, rpr={})
        assigned.session_nonce = "1" * 64
        logged = DCPCrewAgent(role="l", passport={}, rpr={})
        logged.log_action()
        own = logged.session_nonce
        crew = DCPCrew(agents=[assigned, logged], session_nonce="2" * 64)
        assert [a.session_nonce for a in crew.agents] == ["1" * 64, own]

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


class TestFastAPIV2Structure:
    """Shape pre-checks only: passing them is no verdict (see TestFastAPIMiddlewareV2)."""

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

    def test_well_formed_v2_bundle_has_no_shape_errors(self):
        from dcp_ai.fastapi import _v2_shape_errors

        assert _v2_shape_errors(self._make_valid_v2_bundle()) == []

    def test_missing_bundle(self):
        from dcp_ai.fastapi import _v2_shape_errors

        assert any("Missing bundle" in e for e in _v2_shape_errors({}))

    def test_missing_manifest(self):
        from dcp_ai.fastapi import _v2_shape_errors

        bundle = self._make_valid_v2_bundle()
        del bundle["bundle"]["manifest"]
        assert any("Missing manifest" in e for e in _v2_shape_errors(bundle))

    def test_missing_artifact(self):
        from dcp_ai.fastapi import _v2_shape_errors

        bundle = self._make_valid_v2_bundle()
        del bundle["bundle"]["intent"]
        assert any("intent" in e for e in _v2_shape_errors(bundle))

    def test_pq_binding_without_pq_sig(self):
        from dcp_ai.fastapi import _v2_shape_errors

        bundle = self._make_valid_v2_bundle()
        bundle["signature"]["composite_sig"] = {
            "classical": "sig",
            "binding": "pq_over_classical",
        }
        assert any("PQ" in e for e in _v2_shape_errors(bundle))


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


# ---------------------------------------------------------------------------
# FastAPI middleware: V2 bundles go through verify_signed_bundle_v2
# ---------------------------------------------------------------------------

_BUNDLE_VECTORS = Path(__file__).resolve().parents[3] / "tests" / "interop" / "v2" / "bundle_vectors.json"


def _flip_first_byte(b64: str) -> str:
    raw = bytearray(base64.b64decode(b64))
    raw[0] ^= 0x01
    return base64.b64encode(bytes(raw)).decode()


class TestFastAPIMiddlewareV2:
    """Every verifier must accept the interop vectors' signed_bundle under the
    default verifier policy, and reject it once a signature or a signed payload
    is changed."""

    @pytest.fixture(scope="class")
    def vectors(self):
        with open(_BUNDLE_VECTORS) as f:
            return json.load(f)

    @staticmethod
    def _client(**middleware_kwargs):
        from fastapi import Depends, FastAPI
        from fastapi.testclient import TestClient
        from dcp_ai.fastapi import DCPAgentContext, DCPVerifyMiddleware, require_dcp

        app = FastAPI()
        app.add_middleware(DCPVerifyMiddleware, require_bundle=True, **middleware_kwargs)

        @app.post("/action")
        async def action(agent: DCPAgentContext = Depends(require_dcp)):
            return {
                "agent_id": agent.agent_id,
                "human_id": agent.human_id,
                "session_nonce": agent.session_nonce,
                "composite_sig_valid": agent.composite_sig_valid,
                "session_binding_valid": agent.session_binding_valid,
                "warnings": getattr(agent, "warnings", None),
            }

        return TestClient(app)

    def _post(self, signed_bundle, **middleware_kwargs):
        return self._client(**middleware_kwargs).post("/action", json={"signed_bundle": signed_bundle})

    def test_accepts_the_honest_bundle(self, vectors):
        signed = copy.deepcopy(vectors["signed_bundle"])
        response = self._post(signed)
        assert response.status_code == 200, response.json()
        body = response.json()
        assert body["agent_id"] == "agent:interop-bot"
        assert body["human_id"] == "human:interop-principal"
        assert body["session_nonce"] == signed["bundle"]["manifest"]["session_nonce"]
        assert body["composite_sig_valid"] is True
        assert body["session_binding_valid"] is True

    def test_accepts_the_honest_bundle_from_the_header(self, vectors):
        client = self._client()
        response = client.post("/action", headers={"x-dcp-bundle": json.dumps(vectors["signed_bundle"])})
        assert response.status_code == 200, response.json()

    def test_rejects_a_corrupted_classical_bundle_signature(self, vectors):
        forged = copy.deepcopy(vectors["signed_bundle"])
        classical = forged["signature"]["composite_sig"]["classical"]
        classical["sig_b64"] = _flip_first_byte(classical["sig_b64"])
        response = self._post(forged)
        assert response.status_code == 403
        assert response.json()["verified"] is False
        assert any("signature" in e.lower() for e in response.json()["errors"])

    def test_rejects_a_changed_intent_payload_with_the_original_signatures(self, vectors):
        forged = copy.deepcopy(vectors["signed_bundle"])
        forged["bundle"]["intent"]["payload"]["action_type"] = "initiate_payment"
        response = self._post(forged)
        assert response.status_code == 403
        assert any("intent" in e for e in response.json()["errors"])

    def test_rejects_a_different_bundle_carrying_the_honest_bundle_signature(self, vectors):
        other = copy.deepcopy(vectors["must_accept_bundles"][0]["signed_bundle"])
        other["signature"]["composite_sig"] = copy.deepcopy(vectors["signed_bundle"]["signature"]["composite_sig"])
        response = self._post(other)
        assert response.status_code == 403

    def test_rejects_a_structurally_valid_but_unsigned_bundle(self):
        nonce = "a" * 64
        fake = lambda **payload: {"payload": {"session_nonce": nonce, **payload}, "composite_sig": {"classical": "sig"}}  # noqa: E731
        unsigned = {
            "bundle": {
                "dcp_bundle_version": "2.0",
                "manifest": {"session_nonce": nonce, "rpr_hash": "sha256:a", "passport_hash": "sha256:b",
                             "intent_hash": "sha256:c", "policy_hash": "sha256:d", "audit_merkle_root": "sha256:e"},
                "responsible_principal_record": fake(human_id="rpr:x"),
                "agent_passport": fake(agent_id="agent:y"),
                "intent": fake(),
                "policy_decision": fake(),
                "audit_entries": [],
            },
            "signature": {"composite_sig": {"classical": "sig", "pq": "pq-sig", "binding": "pq_over_classical"}},
        }
        response = self._post(unsigned)
        assert response.status_code == 403

    def test_rejects_a_session_nonce_mismatch(self, vectors):
        case = next(c for c in vectors["must_reject_bundles"] if c["name"] == "intent_session_nonce_differs")
        response = self._post(case["signed_bundle"])
        assert response.status_code == 403
        assert any("nonce" in e.lower() for e in response.json()["errors"])

    def test_composite_sig_valid_comes_from_the_verifier(self, vectors):
        # A classical-only bundle from a low-risk passport with a routine intent is
        # accepted under the default policy, and its signature verifies.
        signed = vectors["classical_only_routine_bundle"]["signed_bundle"]
        response = self._post(signed)
        assert response.status_code == 200, response.json()
        assert response.json()["composite_sig_valid"] is True

    def test_verifier_policy_default_mode_applies_to_every_risk_tier(self, vectors):
        signed = vectors["classical_only_routine_bundle"]["signed_bundle"]
        response = self._post(signed, verifier_policy={"default_mode": "hybrid_required"})
        assert response.status_code == 403

    def test_verifier_policy_is_checked_when_the_middleware_is_built(self):
        from pydantic import ValidationError
        from dcp_ai.fastapi import DCPVerifyMiddleware

        app = MagicMock()
        with pytest.raises(ValidationError):
            DCPVerifyMiddleware(app, verifier_policy={"default_mod": "hybrid_required"})
        with pytest.raises(ValidationError):
            DCPVerifyMiddleware(app, verifier_policy={"risk_overrides": ["hybrid_required"]})
        with pytest.raises(ValueError, match="verification mode"):
            DCPVerifyMiddleware(app, verifier_policy={"default_mode": "none"})
        policy = DCPVerifyMiddleware(app, verifier_policy={"risk_overrides": {"low": "hybrid_required"}}).verifier_policy
        assert policy["risk_overrides"] == {"low": "hybrid_required", "medium": "hybrid_preferred", "high": "hybrid_required"}

    def test_rejects_a_malformed_bundle(self, vectors):
        malformed = copy.deepcopy(vectors["signed_bundle"])
        malformed["bundle"]["intent"] = None
        response = self._post(malformed)
        assert response.status_code == 403
        assert any("intent" in e for e in response.json()["errors"])


class TestFastAPIMiddlewareV1:
    """A V1 bundle has one Ed25519 signature and no post-quantum one: it is
    accepted only when no risk tier of the verifier policy requires one."""

    _V1_BUNDLE = Path(__file__).resolve().parents[3] / "tests" / "conformance" / "examples" / "citizenship_bundle.signed.json"

    def _v1_bundle(self):
        with open(self._V1_BUNDLE) as f:
            return json.load(f)

    def _post(self, signed_bundle, **middleware_kwargs):
        return TestFastAPIMiddlewareV2._client(**middleware_kwargs).post("/action", json={"signed_bundle": signed_bundle})

    def test_accepts_a_v1_bundle_when_every_tier_allows_classical(self):
        response = self._post(self._v1_bundle(), verifier_policy={"default_mode": "hybrid_preferred"})
        assert response.status_code == 200, response.json()
        assert response.json()["agent_id"] == "did:agent:agent123"

    def test_accepts_the_v1_conformance_bundle_under_the_default_policy(self):
        # risk_tier medium (hybrid_preferred), a send_email intent with risk_score 0.21 (standard tier).
        response = self._post(self._v1_bundle())
        assert response.status_code == 200, response.json()

    def test_refuses_a_v1_payment_intent_under_the_default_policy(self, monkeypatch):
        import dcp_ai.fastapi

        calls = []
        monkeypatch.setattr(dcp_ai.fastapi, "verify_signed_bundle", lambda *a: calls.append(a) or {"verified": True})
        payment = self._v1_bundle()
        payment["bundle"]["intent"]["action_type"] = "initiate_payment"
        response = self._post(payment)
        assert response.status_code == 403
        assert any("V1 bundles are not accepted here" in e and "elevated" in e for e in response.json()["errors"])
        assert calls == []

    def test_refuses_a_v1_bundle_without_a_risk_score(self):
        unscored = self._v1_bundle()
        del unscored["bundle"]["policy_decision"]["risk_score"]
        response = self._post(unscored)
        assert response.status_code == 403
        assert any("V1 bundles are not accepted here" in e for e in response.json()["errors"])

    def test_refuses_a_v1_bundle_whose_risk_tier_is_unknown(self):
        odd = self._v1_bundle()
        odd["bundle"]["agent_passport"]["risk_tier"] = "constructor"
        response = self._post(odd)
        assert response.status_code == 403
        assert any("risk_tier" in e for e in response.json()["errors"])

    def test_rejects_a_v1_bundle_when_v1_is_not_allowed(self):
        response = self._post(
            self._v1_bundle(),
            verifier_policy={"default_mode": "hybrid_preferred", "allow_v1_bundles": False},
        )
        assert response.status_code == 403

    def test_rejects_an_undetectable_version_without_the_v1_verifier(self, monkeypatch):
        import dcp_ai.fastapi
        import dcp_ai.verify

        calls = []

        def spy(*args, **kwargs):
            calls.append(args)
            return {"verified": True}

        monkeypatch.setattr(dcp_ai.verify, "verify_signed_bundle", spy)
        monkeypatch.setattr(dcp_ai.fastapi, "verify_signed_bundle", spy, raising=False)
        unknown = self._v1_bundle()
        del unknown["bundle"]["responsible_principal_record"]["dcp_version"]
        response = self._post(unknown, verifier_policy={"default_mode": "hybrid_preferred"})
        assert response.status_code == 403
        assert any("version" in e.lower() for e in response.json()["errors"])
        assert calls == []


class TestFastAPIMiddlewareHardening:
    """Hostile input gets a 4xx, never a 500; the policy is resolved as documented."""

    @staticmethod
    def _client(**kwargs):
        from fastapi import FastAPI, Request
        from fastapi.testclient import TestClient
        from dcp_ai.fastapi import DCPVerifyMiddleware

        app = FastAPI()
        app.add_middleware(DCPVerifyMiddleware, require_bundle=True, **kwargs)

        @app.post("/action")
        async def action(request: Request):
            return {"agent": request.state.dcp_agent.agent_id}

        return TestClient(app, raise_server_exceptions=False)

    @pytest.mark.parametrize(
        "raw",
        [
            '{"bundle": {"dcp_bundle_version": "2.0", "n": ' + "9" * 4301 + "}}",
            "[" * 5000 + "]" * 5000,
            '{"bundle": {"responsible_principal_record": {"dcp_version": "1.0", "x": ' + '{"a": ' * 5000 + "1" + "}" * 5000 + "}}}",
        ],
        ids=["4301-digit integer", "deep array", "deep V1 object"],
    )
    def test_hostile_header_gets_403(self, raw):
        response = self._client().post("/action", headers={"x-dcp-bundle": raw})
        assert response.status_code == 403

    def test_rejects_pq_checkpoints_that_are_not_a_list(self):
        with open(_BUNDLE_VECTORS) as f:
            signed = json.load(f)["signed_bundle"]
        signed["bundle"]["pq_checkpoints"] = {}
        response = self._client().post("/action", json={"signed_bundle": signed})
        assert response.status_code == 403
        assert "Invalid pq_checkpoints" in response.json()["errors"]

    def test_risk_overrides_none_keeps_the_default_tiers(self):
        from dcp_ai.fastapi import DCPVerifyMiddleware
        from dcp_ai.v2.verify import DEFAULT_VERIFIER_POLICY

        policy = DCPVerifyMiddleware(MagicMock(), verifier_policy={"risk_overrides": None}).verifier_policy
        assert policy["risk_overrides"] == DEFAULT_VERIFIER_POLICY["risk_overrides"]

    def test_an_unknown_risk_tier_raises(self):
        from dcp_ai.fastapi import DCPVerifyMiddleware

        with pytest.raises(ValueError, match="risk tier"):
            DCPVerifyMiddleware(MagicMock(), verifier_policy={"risk_overrides": {"critical": "pq_only"}})

    def test_a_verifier_policy_instance_without_risk_overrides_applies_its_mode_everywhere(self):
        from dcp_ai.fastapi import DCPVerifyMiddleware
        from dcp_ai.v2.models import VerifierPolicy

        policy = DCPVerifyMiddleware(
            MagicMock(), verifier_policy=VerifierPolicy(default_mode="classical_only", risk_overrides=None)
        ).verifier_policy
        assert policy["risk_overrides"] == dict.fromkeys(("low", "medium", "high"), "classical_only")


def _bundle_vector_cases():
    with open(_BUNDLE_VECTORS) as f:
        vectors = json.load(f)
    cases = [pytest.param(vectors["signed_bundle"], None, id="accept signed_bundle")]
    cases += [pytest.param(c["signed_bundle"], None, id=f"accept {c['name']}") for c in vectors["must_accept_bundles"]]
    for c in vectors["must_reject"]:
        signed = copy.deepcopy(vectors["signed_bundle"])
        for mutation in c["mutations"]:
            node = signed
            for key in mutation["path"][:-1]:
                node = node[key]
            node[mutation["path"][-1]] = mutation["value"]
        cases.append(pytest.param(signed, c["error_contains"], id=f"reject {c['name']}"))
    cases += [pytest.param(c["signed_bundle"], c["error_contains"], id=f"reject {c['name']}") for c in vectors["must_reject_bundles"]]
    return cases


@pytest.mark.parametrize("signed_bundle,error_contains", _bundle_vector_cases())
def test_fastapi_middleware_on_the_shared_bundle_vectors(signed_bundle, error_contains):
    response = TestFastAPIMiddlewareV2._client().post("/action", json={"signed_bundle": signed_bundle})
    if error_contains is None:
        assert response.status_code == 200, response.json()
    else:
        assert response.status_code == 403
        assert error_contains.lower() in " ".join(response.json()["errors"]).lower()
