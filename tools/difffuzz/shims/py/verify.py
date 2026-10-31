"""Python SDK shim for the differential fuzzer.

Usage: python verify.py [mode] [--loop]
  stdin: one signed bundle (JSON document); with --loop, one compact JSON
         document per line.
  stdout: one line per document: {"valid": bool, "errors": [string]}
  mode: empty for DEFAULT_VERIFIER_POLICY, or a verification mode applied to
        default_mode and to every risk tier (as the interop tests do).
Exit code 0 for a verdict; anything else is a crash of the verifier.

Usage: python -I verify.py --batch   (the driver's protocol, dcp-difffuzz/2; see README.md)
  stdin: one request {protocol, run_id, nonce, now_ms, cases: [{id, policy, bundle_b64}]}; stdout: one response
  with exactly one result per case: verdict {verified, errors}, parse_rejected {message}, error {message} (the SDK
  raised) or unsupported. Each case is verified under its own explicit policy at now_ms. A malformed request exits 2.

The local SDK source is put first on sys.path so a stale installed copy of
dcp-ai never shadows it; its dependencies still come from
`pip install -e sdks/python`.
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "sdks" / "python"))

from dcp_ai.providers.ed25519_provider import Ed25519Provider  # noqa: E402
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider  # noqa: E402
from dcp_ai.v2.crypto_registry import AlgorithmRegistry  # noqa: E402
from dcp_ai.v2.verify import DEFAULT_VERIFIER_POLICY, verify_signed_bundle_v2  # noqa: E402

args = [a for a in sys.argv[1:]]
loop = "--loop" in args
mode = next((a for a in args if not a.startswith("--")), "")
policy = None
if mode:
    policy = {**DEFAULT_VERIFIER_POLICY, "default_mode": mode, "risk_overrides": dict.fromkeys(("low", "medium", "high"), mode)}

registry = AlgorithmRegistry()
registry.register_signer(Ed25519Provider())
registry.register_signer(MlDsa65Provider())


def verdict(text: str) -> str:
    try:
        doc = json.loads(text)
    except ValueError as exc:
        return json.dumps({"valid": False, "errors": [f"JSON parse error: {exc}"]})
    r = asyncio.run(verify_signed_bundle_v2(doc, registry, policy))
    return json.dumps({"valid": r["verified"] is True, "errors": r["errors"]})


def bad_request(why: str) -> None:
    sys.stderr.write(f"invalid request: {why}\n")
    sys.exit(2)


async def batch() -> None:
    import base64

    try:
        req = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    except ValueError as exc:
        bad_request(f"not JSON: {exc}")
    if (not isinstance(req, dict) or set(req) != {"protocol", "run_id", "nonce", "now_ms", "cases"}
            or req["protocol"] != "dcp-difffuzz/2" or type(req["now_ms"]) is not int or not isinstance(req["cases"], list)):
        bad_request("envelope")
    results = []
    for c in req["cases"]:
        if not isinstance(c, dict) or set(c) != {"id", "policy", "bundle_b64"} or not isinstance(c["id"], str) \
                or not isinstance(c["policy"], dict) or not isinstance(c["bundle_b64"], str):
            bad_request("case fields")
        try:
            data = base64.b64decode(c["bundle_b64"], validate=True)
        except ValueError:
            bad_request(f"case {c['id']}: bundle_b64 is not base64")
        if base64.b64encode(data).decode("ascii") != c["bundle_b64"]:
            bad_request(f"case {c['id']}: bundle_b64 is not canonical base64")
        try:
            doc = json.loads(data.decode("utf-8"))
        except ValueError as exc:  # UnicodeDecodeError and JSONDecodeError are ValueErrors
            results.append({"id": c["id"], "status": "parse_rejected", "message": str(exc)[:500]})
            continue
        try:
            r = await verify_signed_bundle_v2(doc, registry, c["policy"], now_ms=req["now_ms"])
            if not isinstance(r.get("verified"), bool):
                raise TypeError(f"verified is {type(r.get('verified')).__name__}, not a bool")
            results.append({"id": c["id"], "status": "verdict", "verified": r["verified"], "errors": r["errors"]})
        except Exception as exc:  # noqa: BLE001 - any SDK exception is reported, never a verdict
            results.append({"id": c["id"], "status": "error", "message": f"{type(exc).__name__}: {exc}"[:500]})
    sys.stdout.write(json.dumps({"protocol": req["protocol"], "run_id": req["run_id"], "nonce": req["nonce"], "results": results}) + "\n")


if "--batch" in args:
    asyncio.run(batch())
elif loop:
    for line in sys.stdin:
        if not line.strip():
            continue
        sys.stdout.write(verdict(line) + "\n")
        sys.stdout.flush()
else:
    sys.stdout.write(verdict(sys.stdin.read()) + "\n")
