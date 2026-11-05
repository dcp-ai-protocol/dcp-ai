"""Mandate chain child for the Python SDK (contract dcp-ai-perf-mandate/1, tools/conformance/perf-scale.js): the dcp_ai
package of this checkout (sdks/python), put first on sys.path here, with the native dependencies of the interpreter
that runs it. Run it with -I. Timed per call: json.loads of the workload bytes, a {chain, keys} document, then
await verify_mandate_chain(registry, chain, set(), keys, now=...) with no revoked mandate and the request's
verification instant, all inside one persistent asyncio loop. The registry is set up once. A malformed request exits 2.
"""

import asyncio
import base64
import binascii
import calendar
import gc
import hashlib
import json
import os
import platform
import sys
import time
from datetime import datetime, timezone

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "sdks", "python"))

CONTRACT = "dcp-ai-perf-mandate/1"


def refuse(message):
    sys.stderr.write(f"perf child: {message}\n")
    sys.exit(2)


def keys_are(obj, keys):
    return isinstance(obj, dict) and set(obj) == set(keys)


def read_request():
    try:
        req = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as e:
        refuse(f"the request is not UTF-8 JSON ({e})")
    if not keys_are(req, ["contract", "run_id", "nonce", "verification_time", "warmup", "samples", "workloads"]) or req["contract"] != CONTRACT:
        refuse(f"the request must be exactly a {CONTRACT} request")
    count = lambda n: isinstance(n, int) and not isinstance(n, bool) and n >= 1
    if not (isinstance(req["run_id"], str) and isinstance(req["nonce"], str) and count(req["warmup"]) and count(req["samples"])):
        refuse("run_id, nonce, warmup and samples have the wrong types")
    t = req["verification_time"]
    if not (isinstance(t, str) and t.endswith("Z") and len(t) == 20):
        refuse("verification_time must be YYYY-MM-DDTHH:MM:SSZ")
    try:
        req["now"] = datetime.fromtimestamp(calendar.timegm(time.strptime(t, "%Y-%m-%dT%H:%M:%SZ")), tz=timezone.utc)
    except ValueError:
        refuse("verification_time is not a valid instant")
    if not isinstance(req["workloads"], list) or not req["workloads"]:
        refuse("workloads must be a non-empty array")
    seen = set()
    for w in req["workloads"]:
        if not (keys_are(w, ["id", "input_b64", "input_sha256", "expect"]) and isinstance(w["id"], str) and w["id"] not in seen
                and keys_are(w["expect"], ["verified"]) and isinstance(w["expect"]["verified"], bool)):
            refuse("a workload has the wrong shape")
        seen.add(w["id"])
        try:
            data = base64.b64decode(w["input_b64"], validate=True)
        except (binascii.Error, ValueError):
            refuse(f"workload {w['id']}: input_b64 is not base64")
        if base64.b64encode(data).decode() != w["input_b64"] or hashlib.sha256(data).hexdigest() != w["input_sha256"]:
            refuse(f"workload {w['id']}: input_b64 does not match input_sha256")
        w["bytes"] = data
    return req


def problem(expect, r):
    if not (isinstance(r, dict) and isinstance(r.get("valid"), bool) and isinstance(r.get("errors"), list)
            and all(isinstance(e, str) for e in r["errors"])):
        return "malformed_result"
    if r["valid"] != expect:
        return "verdict"
    if r["valid"] and r["errors"]:
        return "contradiction"
    if not r["valid"] and not r["errors"]:
        return "no_errors"
    return None


async def measure(req, registry, verify):
    first, samples = {}, {w["id"]: [] for w in req["workloads"]}
    for phase, rounds in (("warmup", req["warmup"]), ("sample", req["samples"])):
        for index in range(rounds):
            for w in req["workloads"]:
                t0 = time.perf_counter_ns()
                doc = json.loads(w["bytes"])
                r = await verify(registry, doc["chain"], set(), doc["keys"], now=req["now"])
                t1 = time.perf_counter_ns()
                why = problem(w["expect"]["verified"], r)
                if why:
                    errors = [e for e in r.get("errors", []) if isinstance(e, str)] if isinstance(r, dict) else []
                    return {"status": "check_failed", "failure": {"id": w["id"], "phase": phase, "index": index,
                            "verified": isinstance(r, dict) and r.get("valid") is True, "errors": errors, "reason": why}}
                first.setdefault(w["id"], list(r["errors"]))
                if phase == "sample":
                    samples[w["id"]].append(t1 - t0)
    return {"status": "ok", "results": [{"id": w["id"], "verified": w["expect"]["verified"], "errors_first": first[w["id"]],
            "warmup_checked": req["warmup"], "checked": req["samples"], "samples_ns": samples[w["id"]]} for w in req["workloads"]]}


async def main():
    req = read_request()
    import dcp_ai
    from dcp_ai.providers import Ed25519Provider, MlDsa65Provider
    from dcp_ai.v2 import verify_mandate_chain
    from dcp_ai.v2.crypto_registry import AlgorithmRegistry

    registry = AlgorithmRegistry()
    registry.register_signer(Ed25519Provider())
    registry.register_signer(MlDsa65Provider())
    body = await measure(req, registry, verify_mandate_chain)
    implementation = {"sdk": "python", "entrypoint": "verify_mandate_chain", "source": "checkout",
                      "clock": "time.perf_counter_ns", "unit": "ns",
                      "runtime": {"python": sys.version.split()[0], "implementation": platform.python_implementation(),
                                  "gc_enabled": gc.isenabled(), "executable": sys.executable},
                      "loaded": {"dcp_ai_file": os.path.abspath(dcp_ai.__file__)}}
    status = body.pop("status")
    sys.stdout.write(json.dumps({"contract": CONTRACT, "run_id": req["run_id"], "nonce": req["nonce"], "status": status,
                                 "implementation": implementation, **body}))


if __name__ == "__main__":
    asyncio.run(main())
