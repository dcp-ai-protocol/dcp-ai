"""
Mandate acknowledgment (MP-02 F4): the frozen tests/interop/v2/mandate_acknowledgment_vectors.json through the public
API, and what the vectors cannot express: the composition equal to admit_delegated_bundle_v2, the snapshot against a
provider that changes the caller's inputs, an altered PQ component with a valid classical one, the creation contract,
the new context kept out of DCP_CONTEXTS, and the record tables against their schemas. Mirrors
sdks/typescript/src/__tests__/mandate-acknowledgment.test.ts.
"""

from __future__ import annotations

import base64
import copy
import hashlib
import json
from pathlib import Path

import pytest

import dcp_ai.v2
import dcp_ai.v2.mandate_acknowledgment as module
from dcp_ai.providers import Ed25519Provider, MlDsa65Provider, SlhDsa192fProvider
from dcp_ai.v2 import (
    DCP_CONTEXTS,
    MANDATE_ACKNOWLEDGMENT_CONTEXT,
    MANDATE_ACKNOWLEDGMENT_FORMAT,
    AlgorithmRegistry,
    admit_delegated_bundle_v2,
    create_mandate_acknowledgment,
    domain_separated_message,
    evaluate_delegation_activation_v2,
)
from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import CompositeKeyInfo, composite_sign, composite_verify
from dcp_ai.v2.experimental_candidate_ingress import CandidateIngressAccept, experimental_candidate_ingress
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms

ROOT = Path(__file__).resolve().parents[3]
CORPUS = ROOT / "tests" / "interop" / "v2" / "mandate_acknowledgment_vectors.json"
V = json.loads(CORPUS.read_text())
ACK_SCHEMA = json.loads((ROOT / "schemas" / "v2" / "mandate_acknowledgment.schema.json").read_text())
THRESHOLD_SCHEMA = json.loads((ROOT / "schemas" / "v2" / "awareness_threshold.schema.json").read_text())
NOW = rfc3339_epoch_ms(V["now"])
CASES = {c["name"]: c for c in V["cases"]}


def new_registry(ed25519: Ed25519Provider | None = None) -> AlgorithmRegistry:
    r = AlgorithmRegistry()
    r.register_signer(ed25519 or Ed25519Provider())
    r.register_signer(MlDsa65Provider())
    r.register_signer(SlhDsa192fProvider())
    return r


REGISTRY = new_registry()


def operator_of(c: dict) -> dict:
    return {
        "trust": copy.deepcopy(V["trust_sets"][c["trust"]]),
        **({"profile": copy.deepcopy(V["profiles"][c["profile"]])} if c["profile"] else {}),
        **({"policy": copy.deepcopy(V["policies"][c["policy"]])} if c["policy"] else {}),
        **({"max_revocation_age_seconds": c["max_revocation_age_seconds"]} if c["max_revocation_age_seconds"] is not None else {}),
        "revocation": copy.deepcopy(V["revocations"][c["revocation"]]),
        "mandate_revocation": copy.deepcopy(V["mandate_revocations"][c["mandate_revocation"]]),
        "now_ms": NOW,
    }


def container_of(v, source: dict):
    return [copy.deepcopy(source[n]) for n in v] if isinstance(v, list) else copy.deepcopy(v["not_an_array"])


def evidence_of(c: dict) -> dict:
    return {
        "signed_bundle": copy.deepcopy(V["signed_bundles"][c["leaf"]]),
        "mandate_chain": [copy.deepcopy(V["mandates"][n]) for n in c["chain"]],
        "delegator_bundles": [copy.deepcopy(V["signed_bundles"][n]) for n in c["delegators"]],
        "acknowledgments": container_of(c["acknowledgments"], V["acknowledgments"]),
        "awareness_thresholds": container_of(c["awareness_thresholds"], V["awareness_thresholds"]),
    }


def outcome(r: dict) -> dict:
    return {
        "composition_admitted": r["composition"]["admitted"],
        "activation": r["activation"],
        "delegation_active": r["delegation_active"],
        "codes": [e["code"] for e in r["errors"]],
        "verified": [a["verified"] for a in r["acknowledgments"]],
    }


def test_the_corpus_is_the_frozen_one():
    assert hashlib.sha256(CORPUS.read_bytes()).hexdigest() == "e98a14a0ef8ecaff7a08bf394b7555f0d0ae69c29aac1b6b1ec75527f9503f8b"
    assert len(V["cases"]) == 93 and len(V["text_cases"]) == 3 and len(V["go_bytes_cases"]) == 1
    assert sorted({c["group"] for c in V["cases"]}) == ["BIND", "CARD", "DOM", "FORM", "MULTI", "NOACT", "POS", "PREC", "REV", "SIG", "TIME"]
    assert "secret" not in CORPUS.read_text().lower()


@pytest.mark.asyncio
@pytest.mark.parametrize("c", V["cases"], ids=[f"{c['group']}-{c['name']}" for c in V["cases"]])
async def test_vector(c):
    evidence = evidence_of(c)
    r = await evaluate_delegation_activation_v2(evidence, REGISTRY, operator_of(c))
    assert outcome(r) == c["expected"]
    assert r["action_authorized"] is False and r["composition"]["action_authorized"] is False
    assert r["composition"]["activation"] == "not_evaluated"
    f2 = await admit_delegated_bundle_v2(
        {k: evidence[k] for k in ("signed_bundle", "mandate_chain", "delegator_bundles")}, REGISTRY, operator_of(c)
    )
    assert r["composition"] == f2
    assert r["inputs"] == {
        "now": NOW,
        "acknowledgments": len(c["acknowledgments"]) if isinstance(c["acknowledgments"], list) else None,
        "awareness_thresholds": len(c["awareness_thresholds"]) if isinstance(c["awareness_thresholds"], list) else None,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("tc", V["text_cases"], ids=[tc["name"] for tc in V["text_cases"]])
async def test_text_case_lone_surrogate_in_the_host_value(tc):
    base = CASES[tc["base_case"]]
    evidence = evidence_of(base)
    value = json.loads(tc["text"])  # json.loads keeps the lone surrogate as a code point
    evidence[tc["replace"]["container"]][tc["replace"]["index"]] = value
    r = await evaluate_delegation_activation_v2(evidence, REGISTRY, operator_of(base))
    assert [e["code"] for e in r["errors"]] == tc["expected_codes"]
    assert r["delegation_active"] is False


def test_go_bytes_case_metadata():
    """The exact value is the host value 1 and both expectations are explicit; Go chooses by its real parse."""
    for g in V["go_bytes_cases"]:
        canonical = canonicalize_v2(V["awareness_thresholds"]["thr_root_one"])
        assert g["expected_canonical_of"] == "awareness_thresholds.thr_root_one"
        assert g["expected_canonical_sha256"] == hashlib.sha256(canonical.encode()).hexdigest()
        assert V["awareness_thresholds"]["thr_root_one"]["threshold_rules"][0]["value"] == g["expected_exact_value"]
        scanned = experimental_candidate_ingress(g["go_text"].encode())
        assert isinstance(scanned, CandidateIngressAccept) and scanned.canonical.decode() == canonical
        base = CASES[g["base_case"]]["expected"]
        assert {k: g["expectations"]["parser_matches_canonical"][k] for k in ("activation", "delegation_active", "codes")} == {
            "activation": base["activation"], "delegation_active": base["delegation_active"], "codes": base["codes"]}
        assert g["expectations"]["parser_differs_or_fails"]["codes"] == ["ACK_PARSER_MISMATCH"]


def test_integral_float_is_read_as_a_float_and_admitted():
    assert CORPUS.read_text().count('"value": 4242.0,') == 1
    value = V["awareness_thresholds"]["thr_root_float"]["threshold_rules"][0]["value"]
    assert type(value) is float and value == 4242.0


# ── The evaluation ──


@pytest.mark.asyncio
async def test_leaves_its_inputs_unchanged():
    c = CASES["depth_two_any_order"]
    evidence, operator = evidence_of(c), operator_of(c)
    before = copy.deepcopy((evidence, operator))
    r = await evaluate_delegation_activation_v2(evidence, REGISTRY, operator)
    assert r["delegation_active"] is True
    assert (evidence, operator) == before


@pytest.mark.asyncio
async def test_a_provider_that_changes_the_callers_inputs_during_verification_changes_nothing():
    c = CASES["depth_two_any_order"]
    evidence, operator = evidence_of(c), operator_of(c)
    calls = {"n": 0}

    class Tampering(Ed25519Provider):
        async def verify(self, message, signature, public_key_b64):
            if calls["n"] == 0:
                evidence["acknowledgments"].clear()
                evidence["awareness_thresholds"][0]["threshold_rules"] = []
                evidence["mandate_chain"][0]["agent_id"] = "agent:intruder"
                operator["revocation"]["keys"] = {}
                operator["now_ms"] = NOW + 10 * 365 * 86_400_000
            calls["n"] += 1
            return await super().verify(message, signature, public_key_b64)

    r = await evaluate_delegation_activation_v2(evidence, new_registry(Tampering()), operator)
    assert calls["n"] > 0
    assert outcome(r) == c["expected"]


def _flip_pq(record: dict) -> None:
    raw = bytearray(base64.b64decode(record["composite_sig"]["pq"]["sig_b64"]))
    raw[200] ^= 1
    record["composite_sig"]["pq"]["sig_b64"] = base64.b64encode(bytes(raw)).decode()


@pytest.mark.asyncio
@pytest.mark.parametrize("policy", ["profile strict", "pq_only", "weak_classical"])
@pytest.mark.parametrize("target,code", [("awareness_thresholds", "ACK_THRESHOLD_SIGNATURE_INVALID"), ("acknowledgments", "ACK_SIGNATURE_INVALID")])
async def test_an_altered_pq_component_with_a_valid_classical_one_is_rejected(policy, target, code):
    base = CASES["root_only"]
    c = base if policy == "profile strict" else {**base, "profile": None, "policy": policy, "max_revocation_age_seconds": 300}
    evidence = evidence_of(c)
    _flip_pq(evidence[target][0])
    r = await evaluate_delegation_activation_v2(evidence, REGISTRY, operator_of(c))
    assert r["composition"]["admitted"] is True
    assert [e["code"] for e in r["errors"]] == [code]
    assert r["delegation_active"] is False


def test_the_public_api_is_the_selected_exports_only():
    for name in ("evaluate_delegation_activation_v2", "create_mandate_acknowledgment", "MANDATE_ACKNOWLEDGMENT_CONTEXT", "MANDATE_ACKNOWLEDGMENT_FORMAT"):
        assert name in dcp_ai.v2.__all__ and hasattr(dcp_ai.v2, name)
    for name in ("_acknowledgment_form_error", "_threshold_form_error", "_mandate_hash", "_chain_hashes", "_take_delegated_snapshot", "_compose_delegated", "ACK_FIELDS"):
        assert not hasattr(dcp_ai.v2, name)
    assert module.__all__ == ["MANDATE_ACKNOWLEDGMENT_CONTEXT", "MANDATE_ACKNOWLEDGMENT_FORMAT", "create_mandate_acknowledgment", "evaluate_delegation_activation_v2"]


# ── The new context (design § 9) ──


def test_the_context_produces_the_vector_of_the_corpus():
    d = V["domain_separation"]
    assert d["context"] == MANDATE_ACKNOWLEDGMENT_CONTEXT
    assert domain_separated_message(MANDATE_ACKNOWLEDGMENT_CONTEXT, d["payload_canonical"].encode()).hex() == d["dsm_hex"]


def test_the_context_stays_out_of_dcp_contexts():
    assert len(DCP_CONTEXTS) == 19
    assert MANDATE_ACKNOWLEDGMENT_CONTEXT not in DCP_CONTEXTS.values()


# ── The record tables against their schemas ──


def test_acknowledgment_table_matches_the_schema():
    assert ACK_SCHEMA["additionalProperties"] is False
    assert sorted(ACK_SCHEMA["properties"]) == sorted(module.ACK_FIELDS)
    assert sorted(ACK_SCHEMA["required"]) == sorted(module.ACK_FIELDS)
    assert ACK_SCHEMA["properties"]["acknowledgment_format"]["const"] == MANDATE_ACKNOWLEDGMENT_FORMAT


def test_threshold_tables_match_the_schema():
    assert THRESHOLD_SCHEMA["additionalProperties"] is False
    assert sorted(THRESHOLD_SCHEMA["properties"]) == sorted(module.THRESHOLD_FIELDS)
    assert sorted(THRESHOLD_SCHEMA["required"]) == sorted(module.THRESHOLD_FIELDS)
    rule = THRESHOLD_SCHEMA["properties"]["threshold_rules"]["items"]
    assert sorted(rule["properties"]) == sorted(module.RULE_FIELDS) and sorted(rule["required"]) == sorted(module.RULE_FIELDS)
    assert tuple(rule["properties"]["operator"]["enum"]) == module.RULE_OPERATORS
    assert tuple(rule["properties"]["action_if_triggered"]["enum"]) == module.RULE_ACTIONS


@pytest.mark.parametrize("value,ok", [
    (9007199254740991, True), (-9007199254740991, True), (9007199254740992, False), (-9007199254740992, False),
    (5.0, True), (1.5, False), (True, False), (False, False), (2.0**53, False),
], ids=["max", "min", "max+1", "min-1", "integral-float", "fraction", "true", "false", "float-2^53"])
def test_the_integer_domain(value, ok):
    assert module._is_safe_integer_value(value) is ok


# ── Creation (design § 3.2) ──


async def fresh_keys() -> tuple[CompositeKeyInfo, CompositeKeyInfo]:
    ed = await Ed25519Provider().generate_keypair()
    pq = await MlDsa65Provider().generate_keypair()
    return (
        CompositeKeyInfo(ed["kid"], "ed25519", ed["secret_key_b64"], ed["public_key_b64"]),
        CompositeKeyInfo(pq["kid"], "ml-dsa-65", pq["secret_key_b64"], pq["public_key_b64"]),
    )


def chain() -> list[dict]:
    return [copy.deepcopy(V["mandates"]["root"]), copy.deepcopy(V["mandates"]["sub"])]


async def threshold_for(keys, **over) -> dict:
    sub = V["mandates"]["sub"]
    payload = {
        "dcp_version": "2.0", "threshold_id": "threshold:creation", "session_nonce": sub["session_nonce"], "agent_id": sub["agent_id"],
        "human_id": sub["human_id"], "threshold_rules": [{"dimension": "spend", "operator": "gt", "value": 100, "action_if_triggered": "notify"}],
        "timestamp": "2026-11-02T01:00:00.000Z", **over,
    }
    sig = await composite_sign(REGISTRY, "DCP-AI.v2.Awareness", canonicalize_v2(payload).encode(), keys[0], keys[1])
    return {**payload, "composite_sig": dict(sig)}


def counting_registry() -> tuple[AlgorithmRegistry, dict]:
    calls = {"signs": 0}

    class Counting(Ed25519Provider):
        async def sign(self, message, secret_key_b64):
            calls["signs"] += 1
            return await super().sign(message, secret_key_b64)

    return new_registry(Counting()), calls


@pytest.mark.asyncio
async def test_creation_computes_the_hashes_and_signs_under_the_new_context():
    keys = await fresh_keys()
    u = await threshold_for(keys)
    a = await create_mandate_acknowledgment(REGISTRY, *keys, mandate_chain=chain(), awareness_threshold=u, acknowledgment_id="ack:creation", acknowledged_at="2026-11-02T02:00:00Z")
    assert module._acknowledgment_form_error(a) is None
    sub = V["mandates"]["sub"]
    assert {k: v for k, v in a.items() if k != "composite_sig"} == {
        "dcp_version": "2.0", "acknowledgment_format": MANDATE_ACKNOWLEDGMENT_FORMAT, "acknowledgment_id": "ack:creation",
        "mandate_id": sub["mandate_id"], "mandate_hash": module._mandate_hash(sub),
        "chain_hash": module._chain_hashes([V["mandates"]["root"], sub])[1], "session_nonce": sub["session_nonce"],
        "human_id": sub["human_id"], "agent_id": sub["agent_id"], "awareness_threshold_id": "threshold:creation",
        "awareness_threshold_hash": module._threshold_hash(u), "acknowledged_at": "2026-11-02T02:00:00Z",
    }
    payload = canonicalize_v2({k: v for k, v in a.items() if k != "composite_sig"}).encode()
    r = await composite_verify(REGISTRY, MANDATE_ACKNOWLEDGMENT_CONTEXT, payload, a["composite_sig"], keys[0].public_key_b64, keys[1].public_key_b64)
    assert r.valid and r.classical_valid and r.pq_valid


@pytest.mark.asyncio
async def test_creation_modifies_no_input_and_takes_no_digest():
    keys = await fresh_keys()
    u = await threshold_for(keys)
    c = chain()
    before = copy.deepcopy((c, u))
    await create_mandate_acknowledgment(REGISTRY, *keys, mandate_chain=c, awareness_threshold=u, acknowledgment_id="ack:creation", acknowledged_at="2026-11-02T02:00:00Z")
    assert (c, u) == before
    with pytest.raises(TypeError):
        await create_mandate_acknowledgment(REGISTRY, *keys, mandate_chain=c, awareness_threshold=u, acknowledgment_id="ack:creation", mandate_hash="sha256:00")  # type: ignore[call-arg]


@pytest.mark.asyncio
async def test_creation_copies_its_arguments_before_the_first_await():
    keys = await fresh_keys()
    u = await threshold_for(keys)
    c = chain()
    coroutine = create_mandate_acknowledgment(REGISTRY, *keys, mandate_chain=c, awareness_threshold=u, acknowledgment_id="ack:creation", acknowledged_at="2026-11-02T02:00:00Z")
    task = __import__("asyncio").ensure_future(coroutine)
    await __import__("asyncio").sleep(0)  # the coroutine runs up to its first await
    c.clear()
    u["threshold_rules"] = []
    a = await task
    assert a["mandate_id"] == V["mandates"]["sub"]["mandate_id"]
    assert a["awareness_threshold_hash"] != module._threshold_hash(u)


def _rejections():
    def keys_with(keys, component, **over):
        k = keys[0] if component == "classical" else keys[1]
        k2 = CompositeKeyInfo(**{**k._asdict(), **over})
        return (k2, keys[1]) if component == "classical" else (keys[0], k2)

    sub = V["mandates"]["sub"]
    return [
        ("lone surrogate mandate_id (independent review)", lambda k: ({"mandate_chain": [chain()[0], {**chain()[1], "mandate_id": "mandate:lone-\ud800"}]}, k, {})),
        # Python only: a str with a surrogate cannot be encoded as UTF-8, so a mandate carrying one anywhere has no hash.
        ("lone surrogate elsewhere in a mandate", lambda k: ({"mandate_chain": [chain()[0], {**chain()[1], "authority_scope": [{**chain()[1]["authority_scope"][0], "domain": "procurement\ud800"}]}]}, k, {})),
        ("pq kid not derived (independent review)", lambda k: ({}, keys_with(k, "pq", kid="x"), {})),
        ("classical kid of another key", lambda k: ({}, keys_with(k, "classical", kid=k[1].kid), {})),
        ("threshold of another agent", lambda k: ({}, k, {"agent_id": V["mandates"]["root"]["agent_id"]})),
        ("threshold of another session", lambda k: ({}, k, {"session_nonce": V["mandates"]["root"]["session_nonce"]})),
        ("instant before the mandate", lambda k: ({"acknowledged_at": "2026-11-01T23:59:59.999Z"}, k, {"timestamp": "2026-11-01T00:00:00Z"})),
        ("instant before the threshold", lambda k: ({"acknowledged_at": "2026-11-02T00:30:00Z"}, k, {})),
        ("instant after valid_until", lambda k: ({"acknowledged_at": "2027-11-01T00:00:00.001Z"}, k, {})),
        ("value outside the integer domain", lambda k: ({}, k, {"threshold_rules": [{"dimension": "spend", "operator": "gt", "value": 9007199254740992, "action_if_triggered": "notify"}]})),
        ("five astral code points", lambda k: ({"acknowledgment_id": "😀😀😀😀😀"}, k, {})),
        ("chain whose sub-mandate does not name its parent", lambda k: ({"mandate_chain": [copy.deepcopy(V["mandates"]["root_future"]), copy.deepcopy(sub)]}, k, {})),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("name,make", _rejections(), ids=[r[0] for r in _rejections()])
async def test_creation_rejects_without_signing(name, make):
    keys = await fresh_keys()
    args, use_keys, threshold_over = make(keys)
    if "threshold_rules" in threshold_over:
        u = await threshold_for(keys)
        u["threshold_rules"] = threshold_over["threshold_rules"]
    else:
        u = await threshold_for(keys, **threshold_over)
    registry, calls = counting_registry()
    params = {"mandate_chain": chain(), "awareness_threshold": u, "acknowledgment_id": "ack:creation", "acknowledged_at": "2026-11-02T02:00:00Z", **args}
    with pytest.raises((ValueError, TypeError), match="create_mandate_acknowledgment") as excinfo:
        await create_mandate_acknowledgment(registry, *use_keys, **params)
    assert calls["signs"] == 0
    assert keys[0].secret_key_b64 not in str(excinfo.value) and keys[1].secret_key_b64 not in str(excinfo.value)
