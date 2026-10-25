"""EXPERIMENTAL candidate dcp-jcs-v2, phase 4 (Python): the producers, as the TypeScript ones. Positives
are verified by the phase 3 bytes verifier, and today's API still refuses their profile. Every rejection of
the contract happens with zero calls to the real signers (counted by subclassing the real providers; each
call still signs). Host values: exact types, floats normalized, copies taken when the function is called.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections import OrderedDict
from enum import IntEnum

import pytest

from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider
from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.composite_ops import CompositeKeyInfo, composite_sign, composite_verify
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.domain_separation import DCP_CONTEXTS
from dcp_ai.v2.experimental_candidate_ingress import CandidateIngressAccept, experimental_candidate_ingress
from dcp_ai.v2.experimental_candidate_produce import ExperimentalCandidateProduceError, sign_bundle, sign_payload
from dcp_ai.v2.experimental_candidate_router import JSON_LOADS_BYTES
from dcp_ai.v2.experimental_candidate_verify import create_verifier
from dcp_ai.v2.session_nonce import generate_session_nonce
from dcp_ai.v2.signed_payload import prepare_payload
from dcp_ai.v2.verify import verify_signed_bundle_v2

NOW = 1_792_886_400_000  # 2026-10-25T00:00:00Z
SIGNS = {"n": 0}


class CountingEd25519(Ed25519Provider):
    async def sign(self, message, secret_key_b64):
        SIGNS["n"] += 1
        return await super().sign(message, secret_key_b64)


class CountingMlDsa65(MlDsa65Provider):
    async def sign(self, message, secret_key_b64):
        SIGNS["n"] += 1
        return await super().sign(message, secret_key_b64)


REGISTRY = AlgorithmRegistry()
REGISTRY.register_signer(CountingEd25519())
REGISTRY.register_signer(CountingMlDsa65())
VERIFY = AlgorithmRegistry()
VERIFY.register_signer(Ed25519Provider())
VERIFY.register_signer(MlDsa65Provider())


def _keys() -> dict[str, CompositeKeyInfo]:
    c = asyncio.run(Ed25519Provider().generate_keypair())
    p = asyncio.run(MlDsa65Provider().generate_keypair())
    return {
        "classical": CompositeKeyInfo(c["kid"], "ed25519", c["secret_key_b64"], c["public_key_b64"]),
        "pq": CompositeKeyInfo(p["kid"], "ml-dsa-65", p["secret_key_b64"], p["public_key_b64"]),
    }


PRINCIPAL = _keys()
AGENT = _keys()


def classical(k):
    return {"classical": k["classical"]}


def sha256_of(v) -> str:
    return "sha256:" + hashlib.sha256(canonicalize_v2(v).encode()).hexdigest()


def rejected(run, cls: str, part: str | None = None) -> ExperimentalCandidateProduceError:
    """A contract rejection with this class (and part), and no signer call while producing it."""
    SIGNS["n"] = 0
    with pytest.raises(ExperimentalCandidateProduceError) as e:
        asyncio.run(run())
    assert e.value.reject_class == cls, str(e.value)
    if part is not None:
        assert e.value.part == part
    assert SIGNS["n"] == 0
    return e.value


def usage_error(run) -> None:
    SIGNS["n"] = 0
    with pytest.raises(TypeError):
        asyncio.run(run())
    assert SIGNS["n"] == 0


def scenario(*, classical_only=False, target=None, intent=None, passport=None, policy=None, entries=2, as_="value"):
    nonce = generate_session_nonce()
    pk = classical(PRINCIPAL) if classical_only else PRINCIPAL
    ak = classical(AGENT) if classical_only else AGENT

    def key_entries(k):
        return [{"kid": x.kid, "alg": x.alg, "public_key_b64": x.public_key_b64, "created_at": "2026-10-21T00:00:00Z",
                 "expires_at": None, "status": "active"} for x in ([k["classical"]] + ([k["pq"]] if "pq" in k else []))]

    rpr = {"dcp_version": "2.0", "human_id": "human:candidate-principal", "session_nonce": nonce, "legal_name": "Candidate Principal",
           "entity_type": "natural_person", "jurisdiction": "US-CA", "liability_mode": "owner_responsible", "override_rights": True,
           "issued_at": "2026-10-21T00:00:00Z", "expires_at": None, "contact": None, "binding_keys": key_entries(pk)}
    pp = {"dcp_version": "2.0", "agent_id": "agent:candidate-bot", "session_nonce": nonce,
          "keys": [{**k, "expires_at": "2099-12-31T18:59:59-05:00"} for k in key_entries(ak)],
          "principal_binding_reference": rpr["human_id"], "capabilities": ["browse", "api_call"], "risk_tier": "medium",
          "created_at": "2026-10-21T00:00:00Z", "status": "active", **(passport or {})}
    base = {"dcp_version": "2.0", "intent_id": "intent:candidate-001", "session_nonce": nonce, "agent_id": pp["agent_id"],
            "human_id": rpr["human_id"], "timestamp": "2026-10-21T12:00:00Z", "action_type": "send_email",
            "target": {"channel": "email", "to": "bob@example.com", "domain": "example.com"}, "data_classes": ["contact_info"],
            "estimated_impact": "medium", "requires_consent": False, **(intent or {})}
    it = {**base, "target": {**base["target"], **(target or {})}}
    pd = {"dcp_version": "2.0", "intent_id": it["intent_id"], "session_nonce": nonce, "decision": "approve", "risk_score": 450,
          "reasons": ["Known recipient domain"], "required_confirmation": None, "applied_policy_hash": sha256_of({"policy": "default"}),
          "timestamp": "2026-10-21T12:00:01Z", **(policy or {})}
    audit = []
    for i in range(entries):
        audit.append({"dcp_version": "2.0", "audit_id": f"audit:candidate-00{i + 1}", "session_nonce": nonce,
                      "prev_hash": "GENESIS" if i == 0 else sha256_of(audit[i - 1]), "hash_alg": "sha256",
                      "timestamp": f"2026-10-21T12:0{i + 1}:00Z", "agent_id": pp["agent_id"], "human_id": rpr["human_id"],
                      "intent_id": it["intent_id"], "intent_hash": sha256_of(it), "policy_decision": "approved", "outcome": "email_sent",
                      "evidence": {"tool": "smtp", "result_ref": None, "evidence_hash": None}, "pq_checkpoint_ref": None})

    def artifact(context, payload, k):
        r = asyncio.run(sign_payload(REGISTRY, context, {"value": payload}, k))
        return {"bytes": r.bytes} if as_ == "bytes" else {"value": r.signed_payload}

    parts = {
        "rpr": artifact(DCP_CONTEXTS["ResponsiblePrincipal"], rpr, pk),
        "passport": artifact(DCP_CONTEXTS["AgentPassport"], pp, ak),
        "intent": artifact(DCP_CONTEXTS["Intent"], it, ak),
        "policy_decision": artifact(DCP_CONTEXTS["PolicyDecision"], pd, ak),
        "audit_entries": [{"bytes": json.dumps(e).encode()} if as_ == "bytes" else {"value": e} for e in audit],
    }
    return {
        "parts": parts,
        "signer": {"signer_type": "human", "signer_id": rpr["human_id"], "keys": pk},
        "options": {"session_nonce": nonce, "session_issued_at": "2026-10-21T00:00:00Z",
                    "session_expires_at": "2099-12-31T23:59:59+05:00", "created_at": "2026-10-21T12:05:00Z"},
        "payloads": {"rpr": rpr, "passport": pp, "intent": it, "policy": pd},
        "entries": audit,
    }


VERIFIER = create_verifier(transport="bare", accepted_profiles=["dcp-jcs-v2"], historical=JSON_LOADS_BYTES)


def produce_and_verify(s):
    out = asyncio.run(sign_bundle(REGISTRY, s["parts"], s["signer"], s["options"]))
    r = asyncio.run(VERIFIER.verify(out.bytes, VERIFY, None, now_ms=NOW))
    assert r.entered == "dcp-jcs-v2"
    assert r.verification["errors"] == [] and r.verification["verified"] is True
    today = asyncio.run(verify_signed_bundle_v2(json.loads(out.bytes), VERIFY, None, now_ms=NOW))
    assert today["verified"] is False and "Unknown canonicalization_profile: dcp-jcs-v2" in today["errors"]
    return json.loads(out.bytes)


def nest(n, leaf):
    return leaf if n == 0 else [nest(n - 1, leaf)]


# ── sign_payload ──


def test_sign_payload_signs_the_exact_value_without_a_profile():
    SIGNS["n"] = 0
    payload = {"a": 1, "b": "x", "c": [True, None]}
    r = asyncio.run(sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": payload}, AGENT))
    assert SIGNS["n"] == 2
    assert r.signed_payload["payload_hash"] == prepare_payload(payload)[1]
    assert sorted(r.signed_payload) == ["composite_sig", "payload", "payload_hash"]
    assert b"canonicalization_profile" not in r.bytes
    v = asyncio.run(composite_verify(VERIFY, DCP_CONTEXTS["Intent"], prepare_payload(payload)[0], r.signed_payload["composite_sig"],
                                     AGENT["classical"].public_key_b64, AGENT["pq"].public_key_b64))
    assert v.valid
    again = experimental_candidate_ingress(r.bytes)
    assert isinstance(again, CandidateIngressAccept) and again.canonical == r.bytes


def test_sign_payload_classical_only_and_long_mantissa_from_bytes():
    SIGNS["n"] = 0
    r = asyncio.run(sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": {"a": 1}}, classical(AGENT)))
    assert SIGNS["n"] == 1 and r.signed_payload["composite_sig"]["binding"] == "classical_only"
    r = asyncio.run(sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"bytes": b'{"exact_one":1.' + b"0" * 800 + b"}"}, AGENT))
    assert r.signed_payload["payload"]["exact_one"] == 1 and b'"payload":{"exact_one":1}' in r.bytes


def test_sign_payload_artifact_fits_in_64_levels():
    ok = asyncio.run(sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": {"d": nest(62, 0)}}, classical(AGENT)))
    assert isinstance(experimental_candidate_ingress(ok.bytes), CandidateIngressAccept)
    e = rejected(lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": {"d": nest(63, 0)}}, AGENT), "DEPTH_EXCEEDED", "payload")
    assert e.path == "/d" + "/0" * 62
    rejected(lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"bytes": json.dumps({"d": nest(63, 0)}).encode()}, AGENT), "DEPTH_EXCEEDED", "payload")


def test_sign_payload_shape_and_usage():
    rejected(lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": [1]}, AGENT), "TYPE_UNSUPPORTED", "payload")
    rejected(lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": None}, AGENT), "TYPE_UNSUPPORTED", "payload")
    for run in (
        lambda: sign_payload(REGISTRY, "DCP-AI.v2.Unknown", {"value": {}}, AGENT),
        lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": {}, "bytes": b"{}"}, AGENT),
        lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"bytes": "{}"}, AGENT),
        lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": {}}, {"classical": {"kid": 7}}),
    ):
        usage_error(run)


def test_bytes_are_copied_through_the_buffer_protocol_and_subclasses_are_refused():
    calls = {"n": 0}

    class Lying(bytes):
        def __bytes__(self):
            calls["n"] += 1
            return b'{"n":1}'

    usage_error(lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"bytes": Lying(b'{"n":1.5}')}, AGENT))
    assert calls["n"] == 0
    rejected(lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"bytes": bytearray(b'{"n":1.5}')}, AGENT), "NUMBER_NOT_INTEGER", "payload")
    data = bytearray(b'{"n":2}')
    pending = sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"bytes": memoryview(data)}, AGENT)
    data[5:6] = b"3"
    assert asyncio.run(pending).signed_payload["payload"] == {"n": 2}


# ── sign_bundle positives ──


def test_bundle_hybrid_from_values():
    unit = produce_and_verify(scenario())
    assert unit["bundle"]["manifest"]["canonicalization_profile"] == "dcp-jcs-v2"
    assert unit["signature"]["created_at"] == "2026-10-21T12:05:00Z" and unit["signature"]["hash_alg"] == "sha256"
    assert "audit_merkle_root_secondary" not in unit["bundle"]["manifest"]


def test_bundle_from_bytes_received():
    s = scenario(as_="bytes")
    unit = produce_and_verify(s)
    assert unit["bundle"]["intent"] == json.loads(s["parts"]["intent"]["bytes"])


def test_bundle_accepts_an_artifact_signed_by_todays_api():
    s = scenario()
    canonical_bytes, payload_hash = prepare_payload(s["payloads"]["intent"])
    v1 = {"payload": s["payloads"]["intent"], "payload_hash": payload_hash,
          "composite_sig": asyncio.run(composite_sign(REGISTRY, DCP_CONTEXTS["Intent"], canonical_bytes, AGENT["classical"], AGENT["pq"]))}
    s["parts"]["intent"] = {"value": v1}
    assert produce_and_verify(s)["bundle"]["intent"] == json.loads(json.dumps(v1))


def test_bundle_classical_only_routine():
    s = scenario(classical_only=True, passport={"risk_tier": "low"}, policy={"risk_score": 0},
                 intent={"action_type": "browse", "target": {"channel": "web"}, "data_classes": ["none"], "estimated_impact": "low"})
    unit = produce_and_verify(s)
    assert unit["signature"]["composite_sig"]["binding"] == "classical_only"
    assert unit["signature"]["signer"]["kids"] == [PRINCIPAL["classical"].kid]


def test_bundle_dual_hash_and_empty_audit():
    s = scenario()
    s["options"]["dual_hash"] = True
    unit = produce_and_verify(s)
    assert unit["bundle"]["manifest"]["audit_merkle_root_secondary"].startswith("sha3-256:")
    assert unit["signature"]["hash_alg"] == "sha256+sha3-256"
    s = scenario(entries=0)
    s["options"]["dual_hash"] = True
    unit = produce_and_verify(s)
    m = unit["bundle"]["manifest"]
    assert unit["bundle"]["audit_entries"] == [] and m["audit_count"] == 0
    assert m["audit_merkle_root"] == "sha256:" + "0" * 64 and m["audit_merkle_root_secondary"] == "sha3-256:" + "0" * 64


def _checkpoint(s, extra=None):
    root = json.loads(asyncio.run(sign_bundle(REGISTRY, s["parts"], s["signer"], s["options"])).bytes)["bundle"]["manifest"]["audit_merkle_root"]
    cp = {"checkpoint_id": "ckpt-1", "session_nonce": s["options"]["session_nonce"],
          "event_range": {"from_audit_id": s["entries"][0]["audit_id"], "to_audit_id": s["entries"][1]["audit_id"], "count": 2},
          "merkle_root": root, **(extra or {})}
    sig = asyncio.run(composite_sign(REGISTRY, DCP_CONTEXTS["AuditEvent"], prepare_payload(cp)[0], AGENT["classical"], AGENT["pq"]))
    return {**cp, "composite_sig": sig}


def test_bundle_checkpoint_and_extensions_kept():
    s = scenario(target={"x_payload_ext": {"kept": 1}})
    s["entries"][1] = {**s["entries"][1], "x_entry_ext": "kept"}
    s["parts"]["audit_entries"] = [{"value": e} for e in s["entries"]]
    intent = s["parts"]["intent"]["value"]
    s["parts"]["intent"] = {"value": {**intent, "x_artifact_ext": "unsigned", "composite_sig": {**intent["composite_sig"], "x_sig_ext": "unsigned"}}}
    s["parts"]["pq_checkpoints"] = [{"value": _checkpoint(s, {"x_checkpoint_ext": [1, 2]})}]
    unit = produce_and_verify(s)
    b = unit["bundle"]
    assert b["manifest"]["pq_checkpoints"] == ["ckpt-1"]
    assert b["intent"]["payload"]["target"]["x_payload_ext"] == {"kept": 1}
    assert b["audit_entries"][1]["x_entry_ext"] == "kept" and b["pq_checkpoints"][0]["x_checkpoint_ext"] == [1, 2]
    assert b["intent"]["x_artifact_ext"] == "unsigned" and b["intent"]["composite_sig"]["x_sig_ext"] == "unsigned"


def test_bundle_boundaries_of_section_9():
    e000, smile = chr(0xE000), chr(0x1F600)
    target = {"limits": {"max": 9007199254740991, "min": -9007199254740991}, "keys": {smile: 2, e000: 1},
              "strings": [chr(0xFEFF) + "start", chr(0xFFFD), chr(0x2028), chr(0)], "__proto__": "data", "constructor": "data"}
    unit = produce_and_verify(scenario(target=target))
    t = unit["bundle"]["intent"]["payload"]["target"]
    assert t["limits"] == {"max": 9007199254740991, "min": -9007199254740991}
    assert list(t["keys"]) == [e000, smile] and t["__proto__"] == "data"


def test_bundle_unit_depth_including_the_signature():
    produce_and_verify(scenario(target={"d": nest(59, "deep")}))  # payload 61, unit 64
    s = scenario(target={"d": nest(60, "deep")})  # payload 62, unit 65
    e = rejected(lambda: sign_bundle(REGISTRY, s["parts"], s["signer"], s["options"]), "DEPTH_EXCEEDED", "unit")
    assert e.path.startswith("/bundle/intent/payload/target/d")


# ── sign_bundle rejections ──


def test_commitments_chain_session_and_signer():
    s = scenario()
    intent = s["parts"]["intent"]["value"]
    bad = {**s["parts"], "intent": {"value": {**intent, "payload": {**intent["payload"], "action_type": "send_fax"}}}}
    assert rejected(lambda: sign_bundle(REGISTRY, bad, s["signer"], s["options"]), "COMMITMENT_MISMATCH", "intent").path == "/payload_hash"
    without = {k: v for k, v in intent.items() if k != "payload_hash"}
    rejected(lambda: sign_bundle(REGISTRY, {**s["parts"], "intent": {"value": without}}, s["signer"], s["options"]), "COMMITMENT_MISMATCH", "intent")
    first = {**s["entries"][0], "prev_hash": sha256_of({"earlier": "v1 evidence"})}
    chain = {**s["parts"], "audit_entries": [{"value": first}, {"value": s["entries"][1]}]}
    assert rejected(lambda: sign_bundle(REGISTRY, chain, s["signer"], s["options"]), "CHAIN_NOT_GENESIS").path == "/0/prev_hash"
    broken = {**s["parts"], "audit_entries": [{"value": s["entries"][0]}, {"value": {**s["entries"][1], "prev_hash": "sha256:" + "0" * 64}}]}
    assert rejected(lambda: sign_bundle(REGISTRY, broken, s["signer"], s["options"]), "CHAIN_BREAK").path == "/1/prev_hash"
    other = generate_session_nonce()
    rejected(lambda: sign_bundle(REGISTRY, s["parts"], s["signer"], {**s["options"], "session_nonce": other}), "SESSION_INVALID", "parts")
    rejected(lambda: sign_bundle(REGISTRY, s["parts"], s["signer"], {**s["options"], "session_nonce": "x"}), "SESSION_INVALID", "options")
    rejected(lambda: sign_bundle(REGISTRY, s["parts"], s["signer"], {**s["options"], "session_issued_at": "yesterday"}), "SESSION_INVALID")
    rejected(lambda: sign_bundle(REGISTRY, s["parts"], s["signer"], {**s["options"], "session_issued_at": "2100-01-01T00:00:00Z"}), "SESSION_INVALID")
    no_start = {k: v for k, v in s["options"].items() if k != "session_issued_at"}
    rejected(lambda: sign_bundle(REGISTRY, s["parts"], s["signer"], no_start), "SESSION_ISSUED_AT_REQUIRED")
    rejected(lambda: sign_bundle(REGISTRY, s["parts"], {**s["signer"], "signer_id": "human:else"}, s["options"]), "SIGNER_MISMATCH", "signer")


def test_domain_of_received_bytes_by_class():
    s = scenario()
    entry = json.dumps(s["entries"][1], separators=(",", ":"))
    cases = [
        (b"\xef\xbb\xbf" + entry.encode(), "BOM", 0),
        (entry[:-1].encode(), "SYNTAX", len(entry) - 1),
        (entry.replace('"outcome":"email_sent"', '"outcome":"email_sent","outcome":"email_sent"').encode(), "DUPLICATE_KEY", None),
        (entry.replace('"hash_alg":"sha256"', '"hash_alg":"sha256","n":1.5').encode(), "NUMBER_NOT_INTEGER", None),
        (entry.replace('"hash_alg":"sha256"', '"hash_alg":"sha256","n":9007199254740992').encode(), "NUMBER_OUT_OF_RANGE", None),
        (entry.replace("email_sent", "email\\ud800sent").encode(), "SURROGATE_UNPAIRED", None),
        (entry[:20].encode() + b"\xff" + entry[20:].encode(), "UTF8_INVALID", 20),
    ]
    for data, cls, offset in cases:
        parts = {**s["parts"], "audit_entries": [{"value": s["entries"][0]}, {"bytes": data}]}
        e = rejected(lambda: sign_bundle(REGISTRY, parts, s["signer"], s["options"]), cls, "audit_entries")
        assert e.path == "/1"
        if offset is not None:
            assert e.offset == offset


# ── host values ──


def _payload_of(value):
    return asyncio.run(sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": value}, AGENT)).signed_payload["payload"]


def test_numbers_exact_types_and_floats():
    out = _payload_of({"a": 1.0, "b": -0.0, "c": 5, "d": 9007199254740991.0})
    assert out == {"a": 1, "b": 0, "c": 5, "d": 9007199254740991} and all(type(v) is int for v in out.values())
    for value, cls in [(float("nan"), "NUMBER_NOT_FINITE"), (float("inf"), "NUMBER_NOT_FINITE"), (0.5, "NUMBER_NOT_INTEGER"),
                       (2 ** 53, "NUMBER_OUT_OF_RANGE"), (1e21, "NUMBER_OUT_OF_RANGE"), (-(2 ** 63), "NUMBER_OUT_OF_RANGE")]:
        assert rejected(lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": {"n": value}}, AGENT), cls, "payload").path == "/n"
    assert _payload_of({"t": True})["t"] is True


# Gate 2 (§4.1 of the phase 4 contract): each R and T cell of Python, by corpus ID, as the value of the corpus
# document. R: the exact value (int, or a float that holds it); T: the float a parser would give, whose class
# may change. n-huge-exponent has no R cell: its 5000-digit exponent cannot be materialized as an int (N); its
# T cell uses 1e99999, a shorter literal that float() also turns into inf. The 9 parser IDs (P) are documented,
# not tested.
GATE2_CELLS = [
    ("n-two53", "R", 2 ** 53, "NUMBER_OUT_OF_RANGE"),
    ("n-1e20", "R", 10 ** 20, "NUMBER_OUT_OF_RANGE"),
    ("n-1e20", "R", 1e20, "NUMBER_OUT_OF_RANGE"),
    ("n-1e21", "R", 10 ** 21, "NUMBER_OUT_OF_RANGE"),
    ("n-1e21", "R", 1e21, "NUMBER_OUT_OF_RANGE"),
    ("n-fraction", "R", 0.5, "NUMBER_NOT_INTEGER"),
    ("n-two53-plus-one", "R", 2 ** 53 + 1, "NUMBER_OUT_OF_RANGE"),
    ("n-neg-two53-plus-one", "R", -(2 ** 53 + 1), "NUMBER_OUT_OF_RANGE"),
    ("n-int64-max", "R", 2 ** 63 - 1, "NUMBER_OUT_OF_RANGE"),
    ("n-sci-over", "R", 9007199254740993, "NUMBER_OUT_OF_RANGE"),
    ("n-overflow", "R", 10 ** 400, "NUMBER_OUT_OF_RANGE"),
    ("n-overflow", "T", float("1e400"), "NUMBER_NOT_FINITE"),
    ("n-huge-exponent", "T", float("1e99999"), "NUMBER_NOT_FINITE"),
    ("n-nan", "T", float("nan"), "NUMBER_NOT_FINITE"),
    ("n-negative-infinity", "T", float("-inf"), "NUMBER_NOT_FINITE"),
]


@pytest.mark.parametrize("case_id,cell,value,cls", GATE2_CELLS)
def test_gate2_host_value_cells(case_id, cell, value, cls):
    assert rejected(lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": {"n": value}}, AGENT), cls, "payload").path == "/n"


@pytest.mark.parametrize("levels", [65, 129])
def test_gate2_depth_cells(levels):
    rejected(lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": nest(levels, 1)}, AGENT), "DEPTH_EXCEEDED", "payload")


def test_exact_types_only():
    class Level(IntEnum):
        ONE = 1

    class Text(str):
        pass

    for value, path in [(OrderedDict(a=1), "/v"), (Level.ONE, "/v"), (Text("x"), "/v"), ((1, 2), "/v"), ({1, 2}, "/v"), (b"x", "/v")]:
        assert rejected(lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": {"v": value}}, AGENT), "TYPE_UNSUPPORTED").path == path
    rejected(lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": {1: "a"}}, AGENT), "KEY_NOT_STRING")
    lone = chr(0xD800)
    assert rejected(lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": {"s": "a" + lone}}, AGENT), "SURROGATE_UNPAIRED").path == "/s"
    rejected(lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": {"k" + lone: 1}}, AGENT), "SURROGATE_UNPAIRED")
    cycle: dict = {}
    cycle["self"] = cycle
    rejected(lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": cycle}, AGENT), "DEPTH_EXCEEDED")


def test_a_foreign_key_is_rejected_without_running_its_hooks():
    hooks: list[str] = []

    class Key:
        def __str__(self):
            hooks.append("str")
            raise RuntimeError("str")

        def __repr__(self):
            hooks.append("repr")
            raise RuntimeError("repr")

        def __eq__(self, other):
            hooks.append("eq")
            raise RuntimeError("eq")

        def __hash__(self):
            return 7

    value = {"outer": {Key(): 1}}
    keyed_parts = {Key(): {"value": {}}}
    hooks.clear()
    assert rejected(lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": value}, AGENT), "KEY_NOT_STRING", "payload").path == "/outer"
    usage_error(lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], keyed_parts, AGENT))
    usage_error(lambda: sign_payload(REGISTRY, DCP_CONTEXTS["Intent"], {"value": {}}, {"classical": {Key(): "x"}}))
    assert hooks == []


def test_none_is_not_absent_and_absent_options_leave_no_member():
    s = scenario()
    bare = {k: v for k, v in s["options"].items() if k not in ("session_issued_at", "session_expires_at", "created_at")}
    unit = produce_and_verify({**s, "options": bare})
    for member in ("session_issued_at", "session_expires_at", "intended_verifier", "audit_merkle_root_secondary", "pq_checkpoints"):
        assert member not in unit["bundle"]["manifest"]
    assert unit["signature"]["created_at"].endswith("Z")
    for options in ({**s["options"], "dual_hash": None}, {**s["options"], "created_at": None}, {**s["options"], "created_at": "not a date"},
                    {**s["options"], "intended_verifier": None}):
        usage_error(lambda: sign_bundle(REGISTRY, s["parts"], s["signer"], options))
    usage_error(lambda: sign_bundle(REGISTRY, {**s["parts"], "pq_checkpoints": None}, s["signer"], s["options"]))
    usage_error(lambda: sign_bundle(REGISTRY, {**s["parts"], "audit_entries": tuple(s["parts"]["audit_entries"])}, s["signer"], s["options"]))


def test_inputs_options_and_keys_are_copied_when_called():
    s = scenario()
    reference = produce_and_verify(s)
    keys = {"classical": PRINCIPAL["classical"]._asdict(), "pq": PRINCIPAL["pq"]._asdict()}
    options = dict(s["options"])
    pending = sign_bundle(REGISTRY, s["parts"], {**s["signer"], "keys": keys}, options)
    s["parts"]["intent"]["value"]["payload"]["action_type"] = "changed"
    s["entries"][1]["outcome"] = "changed"
    options["session_nonce"] = generate_session_nonce()
    keys["classical"]["kid"] = "changed"
    out = asyncio.run(pending)
    unit = json.loads(out.bytes)
    assert unit["bundle"]["manifest"] == reference["bundle"]["manifest"]
    assert unit["bundle"]["audit_entries"] == reference["bundle"]["audit_entries"]
    assert unit["signature"]["signer"]["kids"][0] == PRINCIPAL["classical"].kid
    assert asyncio.run(VERIFIER.verify(out.bytes, VERIFY, None, now_ms=NOW)).verification["verified"] is True
