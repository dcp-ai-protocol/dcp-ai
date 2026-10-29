"""Gate 7, dcp-jcs-v1 side (docs/proposals/canonicalization-candidate/README.md §9): a defect of each unit class,
injected at byte level into a dcp-jcs-v1 bundle, keeps today's verdict. The public fixture
tests/interop/candidate/gate7-v1-negatives.json has 38 cases over the frozen phase 3 bases with a reasoned
expectation for each of 10 configurations; this file runs the two Python ones (76 checks) and, apart, the 3
envelope boundary cases (no equivalence claimed).

For each case the experimental verifier (§17, bare, ["dcp-jcs-v1"]) and today's route of this SDK, written out here
(json.loads, then verify_signed_bundle_v2; never the adapter object or the router), get the same bytes, clock and
policy. Their results must be equal on every declared field and both must match the expectation. A verifier
exception on either side is never parity and never a rejection. The verifiers really entered are counted through
the module's own references (monkeypatch), as in phase 3.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
from pathlib import Path

import pytest

from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider
from dcp_ai.v2 import experimental_candidate_verify as ecv
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.experimental_candidate_router import JSON_LOADS_BYTES, JSON_LOADS_STRICT_DECODE, HistoricalAdapter
from dcp_ai.v2.experimental_candidate_verify import create_verifier
from dcp_ai.v2.verify import verify_signed_bundle_v2

ROOT = Path(__file__).resolve().parents[3]
F = json.loads((ROOT / "tests" / "interop" / "candidate" / "gate7-v1-negatives.json").read_text(encoding="utf-8"))
P3 = json.loads((ROOT / "tests" / "interop" / "candidate" / "phase3-signed-vectors.json").read_text(encoding="utf-8"))
MUTATIONS = [f"M{i:02d}" for i in range(1, 19)]
APPROVED = [f"G7-{t}-{s}" for t in ("V1", "AB") for s in ["C00", *MUTATIONS]]
CONFIGS = ("py.json_loads_bytes", "py.json_loads_strict_decode")
ADAPTER = {"py.json_loads_bytes": JSON_LOADS_BYTES, "py.json_loads_strict_decode": JSON_LOADS_STRICT_DECODE}
# Today's decoders, written out as a current caller writes them.
TODAY_DECODE = {"py.json_loads_bytes": lambda b: json.loads(b), "py.json_loads_strict_decode": lambda b: json.loads(b.decode("utf-8"))}
DECLARED_TOP = {"verified", "errors", "warnings", "details"}
DECLARED_DETAILS = {
    "session_nonce", "session_expires_at", "intended_verifier", "manifest_valid", "signature_valid", "policy_satisfied",
    "hash_chain_valid", "pq_checkpoints_valid", "verification_mode", "resolved_tier", "advisory_rejected_algs", "signer_keys",
}
NOW = F["now_ms"]
REGISTRY = AlgorithmRegistry()
REGISTRY.register_signer(Ed25519Provider())
REGISTRY.register_signer(MlDsa65Provider())


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def apply_edits(base: bytes, edits: list) -> bytes:
    out = base
    for e in edits:
        if "prefix" in e:
            out = e["prefix"].encode() + out
        elif "prefix_hex" in e:
            out = bytes.fromhex(e["prefix_hex"]) + out
        elif "append" in e:
            out = out + e["append"].encode()
        elif "append_hex" in e:
            out = out + bytes.fromhex(e["append_hex"])
        elif "drop_last" in e:
            out = out[: len(out) - e["drop_last"]]
        elif "replace_once" in e:
            find = e["replace_once"].encode()
            assert out.count(find) == 1, f"anchor not unique: {e['replace_once']}"
            out = out.replace(find, bytes.fromhex(e["with_hex"]) if "with_hex" in e else e["with"].encode())
        else:
            raise AssertionError(f"unknown edit {e}")
    return out


def base_bytes(name: str) -> bytes:
    return P3["bases"][name]["input_json"].encode()


def case_bytes(c: dict) -> bytes:
    return base_bytes(c["base"]) if c["mutation"] is None else apply_edits(base_bytes(c["base"]), F["mutations"][c["mutation"]]["edits"])


def by_id(cid: str) -> dict:
    return next(c for c in F["cases"] if c["id"] == cid)


# ── The two routes, each classified into exactly one outcome ──

async def today(cfg: str, data: bytes, now: int = NOW) -> dict:
    try:
        value = TODAY_DECODE[cfg](data)
    except (ValueError, RecursionError) as e:  # JSONDecodeError and UnicodeDecodeError are ValueErrors
        return {"outcome": "host_decode_error", "kind": type(e).__name__}
    try:
        return {"outcome": "verified_result", "result": await verify_signed_bundle_v2(value, REGISTRY, None, now_ms=now)}
    except Exception as e:  # noqa: BLE001 - any verifier exception is recorded, never a verdict
        return {"outcome": "verifier_error", "message": repr(e)}


async def experimental(cfg: str, data: bytes, transport: str = "bare", now: int = NOW) -> dict:
    calls = [0]
    entries: list[str] = []
    real = ADAPTER[cfg]

    def decode(unit: bytes):
        calls[0] += 1
        return real.decode(unit)

    original_v1, original_v2 = ecv.verify_signed_bundle_v2, ecv._verify_signed_bundle_v2_with_profile

    async def v1(*args, **kwargs):
        entries.append("dcp-jcs-v1")
        return await original_v1(*args, **kwargs)

    async def v2_(*args, **kwargs):
        entries.append(args[4])
        return await original_v2(*args, **kwargs)

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(ecv, "verify_signed_bundle_v2", v1)
        mp.setattr(ecv, "_verify_signed_bundle_v2_with_profile", v2_)
        verifier = create_verifier(transport=transport, accepted_profiles=["dcp-jcs-v1"], historical=HistoricalAdapter(real.name, decode))
        try:
            r = await verifier.verify(data, REGISTRY, None, now_ms=now)
        except Exception as e:  # noqa: BLE001
            return {"outcome": "verifier_error", "message": repr(e)}
    return {"outcome": "returned", "route": r.route, "entered": r.entered, "verification": r.verification, "calls": calls[0], "entries": entries}


# ── The judgement: pure, so the self-tests can feed it fakes ──

def route_shape(route, transport: bool) -> dict:
    if route.outcome == "v1_path":
        return {"outcome": "v1_path", "profile_source": route.profile_source, "warning_classes": [w.reject_class for w in route.warnings],
                "historical": "decoded" if route.historical.ok else "failed"}
    if route.outcome == "reject":
        if transport:
            return {"outcome": "reject", "class": route.reject_class, "detail": route.detail}
        return {"outcome": "reject", "class": route.reject_class, "offset": route.offset}
    return {"outcome": route.outcome}


def undeclared(r: dict) -> list[str]:
    out = sorted(set(r) - DECLARED_TOP)
    out += [f"details.{k}" for k in sorted(set(r.get("details", {})) - DECLARED_DETAILS)]
    return out


def shape_problems(r: dict, name: str) -> list[str]:
    s = F["verification_shapes"][name]
    p = []
    if r.get("verified") is not s["verified"]:
        p.append(f"verified {r.get('verified')}, expected {s['verified']}")
    errors = r.get("errors")
    if not isinstance(errors, list) or len(errors) != s["error_count"]:
        p.append(f"{len(errors or [])} errors, expected {s['error_count']}: {errors}")
    for sub in s["errors_contain"]:
        if not any(sub in e for e in errors or []):
            p.append(f"no error contains {sub!r}: {errors}")
    if r.get("warnings") != s["warnings"]:
        p.append(f"warnings {r.get('warnings')}, expected {s['warnings']}")
    for k, v in s["fields"].items():
        if r.get("details", {}).get(k) != v:
            p.append(f"{k} {r.get('details', {}).get(k)!r}, expected {v!r}")
    return p


def judge(exp: dict, t: dict | None, x: dict, transport: bool = False) -> list[str]:
    if x["outcome"] == "verifier_error":
        return [f"experimental verifier_error: {x['message']}"]
    if t is not None and t["outcome"] == "verifier_error":
        return [f"today verifier_error: {t['message']}"]
    p = []
    got = route_shape(x["route"], transport)
    if got != exp["route"]:
        p.append(f"route {got}, expected {exp['route']}")
    if x["calls"] != exp["adapter_calls"]:
        p.append(f"adapter calls {x['calls']}, expected {exp['adapter_calls']}")
    if x["entered"] != exp["entered"]:
        p.append(f"entered {x['entered']}, expected {exp['entered']}")
    wanted = [] if exp["entered"] == "none" else ["dcp-jcs-v1"]
    if x["entries"] != wanted:
        p.append(f"verifier entries {x['entries']}, expected {wanted}")
    if x["entries"] != ([] if x["entered"] == "none" else [x["entered"]]):
        p.append(f"verifier entries {x['entries']} contradict entered {x['entered']}")
    v = x["verification"]
    if exp["verification"] is None:
        if v is not None:
            p.append("a verification where none was expected")
    elif v is None:
        p.append(f"no verification, expected {exp['verification']}")
    else:
        p += [f"experimental result has undeclared field {k}" for k in undeclared(v)]
        p += [f"experimental: {m}" for m in shape_problems(v, exp["verification"])]
    if t is None:
        return p
    if t["outcome"] != exp["today"]["outcome"]:
        p.append(f"today {t['outcome']}, expected {exp['today']['outcome']}")
    elif t["outcome"] == "host_decode_error":
        if t["kind"] != exp["today"]["kind"]:
            p.append(f"today decoder error {t['kind']}, expected {exp['today']['kind']}")
        if x["entered"] != "none":
            p.append("today refused the bytes but the experimental route entered a verifier")
    elif t["outcome"] == "verified_result":
        p += [f"today result has undeclared field {k}" for k in undeclared(t["result"])]
        if exp["verification"] is not None:
            p += [f"today: {m}" for m in shape_problems(t["result"], exp["verification"])]
        if v is None:
            p.append("today verified a result but the experimental route entered no verifier")
        elif t["result"] != v:
            p.append(f"the routes differ: today {json.dumps(t['result'])[:300]} / experimental {json.dumps(v)[:300]}")
    return p


async def run_case(c: dict, cfg: str) -> tuple[list[str], dict, dict]:
    data = case_bytes(c)
    frozen = bytes(data)
    t = await today(cfg, data)
    x = await experimental(cfg, data)
    problems = judge(c["expected"][cfg], t, x)
    if data != frozen:
        problems.append("the input buffer was changed")
    return problems, t, x


def gate(results: list[dict]) -> list[dict]:
    """A failed or missing control invalidates every case of its base, in the same configuration."""
    out = []
    for r in results:
        if r["id"].endswith("C00"):
            out.append(r)
            continue
        cid = r["id"][:6] + "C00"
        control = next((o for o in results if o["cfg"] == r["cfg"] and o["id"] == cid), None)
        if control is None:
            out.append({**r, "problems": [f"control_missing: {cid}", *r["problems"]]})
        elif control["problems"]:
            out.append({**r, "problems": [f"control_failed: {cid}", *r["problems"]]})
        else:
            out.append(r)
    return out


# ── Fixture ──

def test_fixture_carries_exactly_the_approved_ids_and_configurations():
    ids = [c["id"] for c in F["cases"]]
    assert sorted(ids) == sorted(APPROVED) and len(set(ids)) == 38
    assert len(F["configurations"]) == 10 and set(CONFIGS) <= set(F["configurations"])
    assert all(list(c["expected"]) == F["configurations"] for c in F["cases"])
    assert [c["id"] for c in F["boundary"]["cases"]] == ["G7E-1", "G7E-2", "G7E-3"]


def test_every_input_is_rebuilt_with_the_recorded_hash():
    assert F["now_ms"] == P3["now_ms"]
    for b in ("B-v1", "B-absent"):
        assert sha(base_bytes(b)) == F["bases"][b]["input_sha256"]
    for c in F["cases"]:
        assert sha(case_bytes(c)) == c["input_sha256"], c["id"]
    for c in F["boundary"]["cases"]:
        assert sha(apply_edits(base_bytes(c["base"]), c["edits"])) == c["input_sha256"], c["id"]


# ── 38 cases x 2 Python configurations ──

def test_each_route_equals_today_and_both_equal_the_expectation():
    async def run():
        results = []
        for cfg in CONFIGS:
            for c in F["cases"]:
                problems, _, _ = await run_case(c, cfg)
                results.append({"id": c["id"], "cfg": cfg, "problems": problems})
        return results

    results = asyncio.run(run())
    assert len(results) == 76  # completeness: zero executed checks can never pass
    failures = [f"{r['cfg']} {r['id']}: {' | '.join(r['problems'])}" for r in gate(results) if r["problems"]]
    assert failures == []


# ── Envelope boundary (separate; no equivalence with any server) ──

def test_envelope_boundary():
    async def run():
        checks = 0
        control = by_id("G7-V1-C00")
        for cfg in CONFIGS:
            bare = await experimental(cfg, case_bytes(control))
            for c in F["boundary"]["cases"]:
                x = await experimental(cfg, apply_edits(base_bytes(c["base"]), c["edits"]), "envelope")
                assert judge(c["expected"][cfg], None, x, True) == [], f"{cfg} {c['id']}"
                if c["id"] == "G7E-1":
                    assert x["verification"] == bare["verification"], f"{cfg}: G7E-1 differs from the bare control"
                checks += 1
        return checks

    assert asyncio.run(run()) == 6


# ── The judgement can fail ──

CFG = "py.json_loads_bytes"


def test_reports_the_experimental_route_outside_the_bundle_window():
    c = by_id("G7-V1-C00")
    data = case_bytes(c)
    t = asyncio.run(today(CFG, data))
    late = asyncio.run(experimental(CFG, data, "bare", 4102531200000))  # 2100-01-02T00:00:00Z
    assert any(m.startswith("the routes differ") for m in judge(c["expected"][CFG], t, late))


def test_reports_one_changed_error_entry():
    c = by_id("G7-V1-M10")
    problems, t, x = asyncio.run(run_case(c, CFG))
    assert problems == []
    altered = {**x, "verification": {**x["verification"], "errors": ["intent: payload_hash mismatch (altered)"]}}
    assert any(m.startswith("the routes differ") for m in judge(c["expected"][CFG], t, altered))


def test_reports_a_verifier_exception_even_when_both_throw():
    boom = {"outcome": "verifier_error", "message": "provider exploded"}
    assert judge(by_id("G7-V1-C00")["expected"][CFG], boom, boom) == ["experimental verifier_error: provider exploded"]


def test_reports_a_second_a_candidate_or_a_missing_entry():
    c = by_id("G7-V1-C00")
    _, t, x = asyncio.run(run_case(c, CFG))
    assert x["entries"] == ["dcp-jcs-v1"]
    for entries in (["dcp-jcs-v1", "dcp-jcs-v1"], ["dcp-jcs-v2"], []):
        assert any(m.startswith("verifier entries") for m in judge(c["expected"][CFG], t, {**x, "entries": entries})), entries
    g7e2 = next(b for b in F["boundary"]["cases"] if b["id"] == "G7E-2")
    rejected = asyncio.run(experimental(CFG, apply_edits(base_bytes(g7e2["base"]), g7e2["edits"]), "envelope"))
    assert rejected["entries"] == []
    assert any(m.startswith("verifier entries") for m in judge(g7e2["expected"][CFG], None, {**rejected, "entries": ["dcp-jcs-v1"]}, True))


def test_never_passes_a_case_whose_control_is_missing():
    assert gate([{"id": "G7-V1-M01", "cfg": CFG, "problems": []}])[0]["problems"] == ["control_missing: G7-V1-C00"]


def test_fails_a_fake_in_which_both_routes_reject_everything():
    class Reject:
        outcome, reject_class, offset, detail = "reject", "SYNTAX", 0, None

    fake_t = {"outcome": "host_decode_error", "kind": "JSONDecodeError"}
    fake_x = {"outcome": "returned", "route": Reject(), "entered": "none", "verification": None, "calls": 1, "entries": []}
    out = gate([{"id": c["id"], "cfg": CFG, "problems": judge(c["expected"][CFG], fake_t, fake_x)} for c in F["cases"]])
    assert [o for o in out if not o["problems"]] == []
    assert len([o for o in out if o["problems"][0].startswith("control_failed")]) == 36


def test_fails_a_fake_in_which_both_routes_accept_everything():
    _, t, x = asyncio.run(run_case(by_id("G7-V1-C00"), CFG))
    ok = t["result"]
    fake_t = {"outcome": "verified_result", "result": copy.deepcopy(ok)}
    fake_x = {**x, "verification": copy.deepcopy(ok)}
    out = {c["id"]: judge(c["expected"][CFG], fake_t, fake_x) for c in F["cases"]}
    negatives = [c["id"] for c in F["cases"] if c["expected"][CFG]["verification"] != "py.ok"]
    assert len(negatives) > 10
    assert all(out[i] for i in negatives)
