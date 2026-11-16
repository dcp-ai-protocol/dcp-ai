"""The Python adapter of the phase 4 matrix, over sdks/python (PYTHONPATH). Modes: produce, ring, verify.
The same reading of the run as adapters/common.mjs: inputs, outputs and result lines in one format."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone

from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider
from dcp_ai.v2.bundle import BundleBuilderV2, sign_bundle_v2
from dcp_ai.v2.composite_ops import CompositeKeyInfo, composite_sign
from dcp_ai.v2.crypto_provider import derive_kid
from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.experimental_candidate_produce import sign_bundle, sign_payload
from dcp_ai.v2.experimental_candidate_router import JSON_LOADS_BYTES, HistoricalAdapter
from dcp_ai.v2.experimental_candidate_verify import create_verifier
from dcp_ai.v2.signed_payload import prepare_payload
from dcp_ai.v2.verify import verify_signed_bundle_v2

SDKS = ["ts", "py", "go", "rust", "wasm"]
PARTS = [
    ("rpr", "DCP-AI.v2.ResponsiblePrincipal", "principal"),
    ("passport", "DCP-AI.v2.AgentPassport", "agent"),
    ("intent", "DCP-AI.v2.Intent", "agent"),
    ("policy", "DCP-AI.v2.PolicyDecision", "agent"),
]

mode, run = sys.argv[1], sys.argv[2]
specs = json.load(open(os.environ["DCP_PHASE4_SPECS"], encoding="utf-8"))
run_id = os.environ["DCP_PHASE4_RUN_ID"]
now_ms = int(datetime.fromisoformat(specs["session"]["now"].replace("Z", "+00:00")).timestamp() * 1000)
registry = AlgorithmRegistry()
registry.register_signer(Ed25519Provider())
registry.register_signer(MlDsa65Provider())


def stamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def read(*path: str) -> bytes:
    with open(os.path.join(run, *path), "rb") as f:
        return f.read()


def write(data: bytes, *path: str) -> None:
    os.makedirs(os.path.join(run, *path[:-1]), exist_ok=True)
    with open(os.path.join(run, *path), "wb") as f:
        f.write(data)


def meta(case_id: str) -> dict:
    return json.loads(read("inputs", case_id, "meta.json"))


def keys() -> dict:
    return json.loads(read("inputs", "keys.json"))


def sdk_keys(k: dict, classical: bool) -> dict:
    c = {"kid": k["classical"]["kid"], "alg": "ed25519", "secret_key_b64": k["classical"]["sk64"], "public_key_b64": k["classical"]["pk"]}
    if classical:
        return {"classical": c}
    return {"classical": c, "pq": {"kid": k["pq"]["kid"], "alg": "ml-dsa-65", "secret_key_b64": k["pq"]["sk"], "public_key_b64": k["pq"]["pk"]}}


def piece(case_id: str, m: str, name: str) -> dict:
    data = read("inputs", case_id, f"{name}.json")
    return {"bytes": data} if m == "bytes" else {"value": json.loads(data)}


def with_extensions(part: dict) -> dict:
    """S09: members an artifact and its composite_sig do not sign, added to the intent artifact."""
    if "value" in part:
        a = part["value"]
        return {"value": {**a, "x_artifact_ext": "unsigned", "composite_sig": {**a["composite_sig"], "x_sig_ext": "unsigned"}}}
    head = b'{"composite_sig":{'
    if not part["bytes"].startswith(head):
        raise ValueError("an artifact that is not canonical")
    return {"bytes": b'{"x_artifact_ext":"unsigned","composite_sig":{"x_sig_ext":"unsigned",' + part["bytes"][len(head):]}


def produced(sdk: str, name: str, data: bytes, index: list) -> None:
    write(data, "produced", sdk, f"{name}.bin")
    index.append({"case": name, "sha256": hashlib.sha256(data).hexdigest(), "run_id": run_id, "created_at": stamp()})


async def assemble(case_id: str, m: str, artifacts: dict) -> bytes:
    md = meta(case_id)
    parts = {
        "rpr": artifacts["rpr"], "passport": artifacts["passport"],
        "intent": with_extensions(artifacts["intent"]) if md["extensions"] else artifacts["intent"], "policy_decision": artifacts["policy"],
        "audit_entries": [piece(case_id, m, e) for e in md["entries"]],
    }
    if md["checkpoint"]:
        parts["pq_checkpoints"] = [piece(case_id, m, "checkpoint-0")]
    signer = {"signer_type": "human", "signer_id": "human:candidate-principal", "keys": sdk_keys(keys()["principal"], md["classical"])}
    options = {"session_nonce": md["session_nonce"], "session_issued_at": md["session_issued_at"], "session_expires_at": md["session_expires_at"],
               "created_at": md["created_at"], "dual_hash": md["dual_hash"]}
    return (await sign_bundle(registry, parts, signer, options)).bytes


async def produce() -> None:
    k = keys()
    lines = [f"{who}.{c} {derive_kid(k[who][c]['alg'], base64.b64decode(k[who][c]['pk']))}" for who in ("principal", "agent") for c in ("classical", "pq")]
    write(("\n".join(lines) + "\n").encode(), "kids", "py.json")
    index: list = []
    for c in specs["cases"]:
        md = meta(c["id"])
        for m in c["modes"]:
            artifacts = {}
            for name, context, who in PARTS:
                r = await sign_payload(registry, context, piece(c["id"], m, name), sdk_keys(k[who], md["classical"]))
                artifacts[name] = {"bytes": r.bytes} if m == "bytes" else {"value": r.signed_payload}
                if c["id"] == "S01" and m == "bytes":
                    write(r.bytes, "produced", "py", "artifacts", f"{name}.bin")
            produced("py", f"{c['id']}-{m}", await assemble(c["id"], m, artifacts), index)
    write(json.dumps(index, indent=2).encode(), "produced", "py", "index.json")


async def ring() -> None:
    nxt = SDKS[(SDKS.index("py") + 1) % len(SDKS)]
    artifacts = {name: {"bytes": read("produced", nxt, "artifacts", f"{name}.bin")} for name, _, _ in PARTS}
    index: list = []
    produced("py", "R", await assemble("S01", "bytes", artifacts), index)
    write(json.dumps(index, indent=2).encode(), "produced", "py", "ring.json")


def items() -> list:
    out = []
    for producer in SDKS:
        for file in ("index.json", "ring.json"):
            path = os.path.join(run, "produced", producer, file)
            if os.path.exists(path):
                for e in json.loads(read("produced", producer, file)):
                    out.append((producer, e["case"], read("produced", producer, f"{e['case']}.bin"), {"transport": "bare", "accepted": ["dcp-jcs-v2"]}))
        neg = os.path.join(run, "negatives", producer, "index.json")
        if os.path.exists(neg):
            for e in json.loads(read("negatives", producer, "index.json")):
                out.append((producer, e["case"], read("negatives", producer, f"{e['case']}.bin"), e["config"]))
    return out


async def verify() -> None:
    verifiers: dict = {}
    calls = {"n": 0}

    def counted(unit: bytes):
        calls["n"] += 1
        return JSON_LOADS_BYTES.decode(unit)

    adapter = HistoricalAdapter(JSON_LOADS_BYTES.name, counted)
    lines = []
    for producer, case, data, config in items():
        key = (config["transport"], tuple(config["accepted"]))
        if key not in verifiers:
            verifiers[key] = create_verifier(transport=config["transport"], accepted_profiles=list(config["accepted"]), historical=adapter)
        calls["n"] = 0
        r = await verifiers[key].verify(data, registry, now_ms=now_ms)
        v = r.verification
        lines.append(json.dumps({
            "run_id": run_id, "consumer": "py", "producer": producer, "case": case, "created_at": stamp(),
            "outcome": r.route.outcome, "class": getattr(r.route, "reject_class", None), "entered": r.entered,
            "verified": None if v is None else v["verified"], "decoder_calls": calls["n"], "errors": [] if v is None else list(v["errors"])[:3],
        }))
    os.makedirs(os.path.join(run, "results"), exist_ok=True)
    with open(os.path.join(run, "results", "py.jsonl"), "a", encoding="utf-8") as f:
        f.write("".join(line + "\n" for line in lines))


N, WARMUP = 20, 3


def cpu() -> str:
    """The CPU model, for the cost evidence."""
    try:
        if sys.platform == "darwin":
            return subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True, check=True).stdout.strip()
        with open("/proc/cpuinfo", encoding="utf-8") as f:
            return next(line.split(":", 1)[1].strip() for line in f if line.startswith("model name"))
    except (OSError, subprocess.SubprocessError, StopIteration):
        return platform.processor() or "unknown"


async def measure(fn) -> dict:
    for _ in range(WARMUP):
        await fn()
    samples = []
    for _ in range(N):
        t0 = time.perf_counter()
        await fn()
        samples.append((time.perf_counter() - t0) * 1000)
    s = sorted(samples)
    median = s[(N - 1) // 2] if N % 2 else (s[N // 2 - 1] + s[N // 2]) / 2
    return {"median_ms": median, "p90_ms": s[-(-9 * N // 10) - 1], "samples_ms": samples}


async def cost() -> None:
    """Gate 10: today's builder and signer against the candidate producer, and the three verifications."""
    md = meta("S01")
    k = keys()
    payloads = {name: json.loads(read("inputs", "S01", f"{name}.json")) for name, _, _ in PARTS}
    entries = [json.loads(read("inputs", "S01", f"{e}.json")) for e in md["entries"]]

    def info(who: str) -> tuple[CompositeKeyInfo, CompositeKeyInfo]:
        x = sdk_keys(k[who], False)
        return CompositeKeyInfo(**x["classical"]), CompositeKeyInfo(**x["pq"])

    async def produce_v1() -> bytes:
        a = {}
        for name, context, who in PARTS:
            data, payload_hash = prepare_payload(payloads[name])
            a[name] = {"payload": payloads[name], "payload_hash": payload_hash, "composite_sig": await composite_sign(registry, context, data, *info(who))}
        bundle = (BundleBuilderV2(md["session_nonce"]).responsible_principal_record(a["rpr"]).agent_passport(a["passport"]).intent(a["intent"])
                  .policy_decision(a["policy"]).add_audit_entries(entries).build())
        bundle["manifest"]["session_issued_at"] = md["session_issued_at"]
        signed = await sign_bundle_v2(bundle, registry, "human", "human:candidate-principal", *info("principal"), session_expires_at=md["session_expires_at"])
        return json.dumps(signed).encode()

    async def produce_candidate() -> bytes:
        a = {}
        for name, context, who in PARTS:
            a[name] = {"value": (await sign_payload(registry, context, {"value": payloads[name]}, sdk_keys(k[who], False))).signed_payload}
        parts = {"rpr": a["rpr"], "passport": a["passport"], "intent": a["intent"], "policy_decision": a["policy"], "audit_entries": [{"value": e} for e in entries]}
        signer = {"signer_type": "human", "signer_id": "human:candidate-principal", "keys": sdk_keys(k["principal"], False)}
        options = {"session_nonce": md["session_nonce"], "session_issued_at": md["session_issued_at"], "session_expires_at": md["session_expires_at"], "created_at": md["created_at"]}
        return (await sign_bundle(registry, parts, signer, options)).bytes

    v1, candidate = await produce_v1(), await produce_candidate()
    write(v1, "cost", "py-v1.bin")
    write(candidate, "cost", "py-candidate.bin")
    verifier = create_verifier(transport="bare", accepted_profiles=["dcp-jcs-v1", "dcp-jcs-v2"], historical=JSON_LOADS_BYTES)

    async def today():
        return await verify_signed_bundle_v2(json.loads(v1), registry, now_ms=now_ms)

    async def v1_path():
        return await verifier.verify(v1, registry, now_ms=now_ms)

    async def candidate_path():
        return await verifier.verify(candidate, registry, now_ms=now_ms)

    a, b, c = await today(), await v1_path(), await candidate_path()
    u1, u2 = json.loads(v1), json.loads(candidate)
    parts = lambda u: [u["bundle"][n]["payload_hash"] for n in ("responsible_principal_record", "agent_passport", "intent", "policy_decision")]  # noqa: E731
    session = lambda u: [u["bundle"]["manifest"].get(n) for n in ("session_nonce", "session_issued_at", "session_expires_at")]  # noqa: E731
    checks = {
        "same_payload_hashes": parts(u1) == parts(u2) and all(type(h) is str for h in parts(u1)),
        "same_session": session(u1) == session(u2) and all(type(x) is str for x in session(u1)),
        "same_entries": u1["bundle"]["audit_entries"] == u2["bundle"]["audit_entries"],
        "today_verified": a["verified"] is True,
        "v1_path": b.entered == "dcp-jcs-v1" and b.verification["verified"] is True,
        "candidate": c.entered == "dcp-jcs-v2" and c.verification["verified"] is True,
    }
    if not all(checks.values()):
        raise SystemExit(f"the pair is not equivalent: {checks}")
    secondary = lambda u: type(u["bundle"]["manifest"].get("audit_merkle_root_secondary")) is str  # noqa: E731
    differences = {
        "secondary_root": {"v1": secondary(u1), "candidate": secondary(u2)},
        "profile": {"v1": u1["bundle"]["manifest"].get("canonicalization_profile"), "candidate": u2["bundle"]["manifest"]["canonicalization_profile"]},
        "serialization": {"v1": "json.dumps (separators with spaces, ASCII escapes, insertion order)", "candidate": "canonical bytes (dcp-jcs, from the producer)"},
    }
    boundaries = {
        "produce_v1": "the four artifacts signed with today's signer, the v1 builder, the bundle signed, serialized to bytes",
        "produce_candidate": "the four artifacts signed by the candidate producer (value inputs), the bundle assembled and signed, canonical bytes",
        "verify_today": "json.loads of the bytes, then verify_signed_bundle_v2(dict): the object API, with the decode a caller of bytes needs",
        "verify_v1_path": "the bytes into the phase 3 verifier (accepting dcp-jcs-v1 and dcp-jcs-v2): ingress, route, the historical decoder, today's verifier",
        "verify_candidate": "the bytes into the same verifier: ingress, route, the candidate verifier",
    }
    t0 = time.perf_counter()
    ops = {
        "produce_v1": await measure(produce_v1),
        "produce_candidate": await measure(produce_candidate),
        "verify_today": await measure(today),
        "verify_v1_path": await measure(v1_path),
        "verify_candidate": await measure(candidate_path),
    }
    report = {"sdk": "py", "run_id": run_id, "created_at": stamp(), "n": N, "warmup": WARMUP, "platform": "Python (sdks/python)",
              "versions": {"python": platform.python_version()}, "cpu": cpu(), "bytes": {"v1": len(v1), "candidate": len(candidate)},
              "differences": differences, "boundaries": boundaries, "checks": checks, "ops": ops, "measured_ms": (time.perf_counter() - t0) * 1000}
    write(json.dumps(report, indent=2).encode(), "cost", "py.json")


modes = {"produce": produce, "ring": ring, "verify": verify, "cost": cost}
if mode not in modes:
    raise SystemExit(f"unknown mode {mode}")
asyncio.run(modes[mode]())
