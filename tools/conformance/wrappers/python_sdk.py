"""External conformance wrapper for the installed ``dcp_ai`` Python package.

Contract ``dcp-ai-conformance-external/1`` (tools/conformance/README.md): one request on stdin, one
response on stdout. Run it with the interpreter whose ``dcp_ai`` you want to test, in isolated mode so
the checkout is not imported by accident::

    /path/to/python -I tools/conformance/wrappers/python_sdk.py

canonicalize: strict UTF-8 decoding and ``json.loads`` with NaN/Infinity refused (a failure is
rejected/parse), then ONE call to ``canonicalize_v2``. Only the documented rejection (a ``TypeError``
whose message starts "Non-integer number at" or "Non-finite number at"; the SDK has no stable error
code) is reported as rejected/profile; any other exception is an error. digest: ``sha256_hex`` /
``sha3_256_hex`` of the decoded bytes.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import importlib.metadata
import json
import os
import platform
import re
import sys
from datetime import datetime

import dcp_ai
from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.dual_hash import sha256_hex, sha3_256_hex

CONTRACT = "dcp-ai-conformance-external/1"
DOCUMENTED_REJECTION = re.compile(r"^Non-(integer|finite) number at ")


def fail(message: str) -> None:
    sys.stderr.write(f"python_sdk wrapper: {message}\n")
    sys.exit(2)


def exact_keys(obj: object, keys: list[str]) -> bool:
    return isinstance(obj, dict) and set(obj) == set(keys)


def decode_base64_strict(s: object) -> bytes | None:
    if not isinstance(s, str) or len(s) % 4 or not re.fullmatch(r"[A-Za-z0-9+/]*={0,2}", s):
        return None
    try:
        raw = base64.b64decode(s, validate=True)
    except binascii.Error:
        return None
    return raw if base64.b64encode(raw).decode("ascii") == s else None


def refuse_constant(name: str) -> None:
    raise ValueError(f"{name} is not JSON")


def installed_version() -> str:
    # The version of the dcp-ai distribution, only when the imported module is that distribution's file.
    try:
        dist = importlib.metadata.distribution("dcp-ai")
        if os.path.realpath(str(dist.locate_file("dcp_ai/__init__.py"))) == os.path.realpath(dcp_ai.__file__):
            return dist.version
    except importlib.metadata.PackageNotFoundError:
        pass
    return "unknown (the imported dcp_ai is not the installed dcp-ai distribution)"


CONTRACT_V2 = "dcp-ai-conformance-external/2"
EVIDENCE = {
    "dual_merkle_root": ["id", "op", "leaves"],
    "composite_verify": ["id", "op", "context", "payload_b64", "composite_sig", "classical_public_key_b64", "pq_public_key_b64"],
    "verify_signed_bundle_v2": ["id", "op", "bundle_b64", "policy", "verification_time"],
}
HEX64 = re.compile(r"[0-9a-f]{64}")
# The kit's contract: RFC 3339 with an explicit zone (Z or +-HH:MM); fromisoformat alone accepts other forms.
RFC3339 = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})")
_registry = None


def registry():
    # Imported only for contract /2, so /1 keeps its imports. The Ed25519 and ML-DSA-65 providers are
    # registered as the SDK's interop tests do.
    global _registry
    if _registry is None:
        from dcp_ai.v2.crypto_registry import AlgorithmRegistry
        from dcp_ai.providers.ed25519_provider import Ed25519Provider
        from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider
        _registry = AlgorithmRegistry()
        _registry.register_signer(Ed25519Provider())
        _registry.register_signer(MlDsa65Provider())
    return _registry


def run_evidence_case(c: dict) -> dict:
    """Contract /2 (opt-in evidence): one call per case to dual_merkle_root, composite_verify or verify_signed_bundle_v2."""
    if not exact_keys(c, EVIDENCE[c["op"]]):
        fail(f"case fields do not match op {c['op']}")
    if c["op"] == "dual_merkle_root":
        from dcp_ai.v2.dual_hash import dual_merkle_root
        leaves = c["leaves"]
        if not isinstance(leaves, list) or not leaves or not all(
                exact_keys(l, ["sha256", "sha3_256"]) and all(isinstance(v, str) and HEX64.fullmatch(v) for v in l.values()) for l in leaves):
            fail(f"case {c['id']}: leaves must be a non-empty array of {{sha256, sha3_256}} lowercase 64-hex strings")
        root = dual_merkle_root(leaves)
        if root is None:
            return {"id": c["id"], "status": "error", "message": "dual_merkle_root returned no root"}
        return {"id": c["id"], "status": "ok", "sha256": root["sha256"], "sha3_256": root["sha3_256"]}
    if c["op"] == "composite_verify":
        payload = decode_base64_strict(c["payload_b64"])
        if (not isinstance(c["context"], str) or payload is None or not isinstance(c["composite_sig"], dict)
                or not isinstance(c["classical_public_key_b64"], str) or not (c["pq_public_key_b64"] is None or isinstance(c["pq_public_key_b64"], str))):
            fail(f"case {c['id']}: composite_verify fields have the wrong types")
        from dcp_ai.v2.composite_ops import composite_verify
        r = asyncio.run(composite_verify(registry(), c["context"], payload, c["composite_sig"], c["classical_public_key_b64"], c["pq_public_key_b64"]))
        return {"id": c["id"], "status": "ok", "valid": r.valid, "classical_valid": r.classical_valid, "pq_valid": r.pq_valid}
    data = decode_base64_strict(c["bundle_b64"])
    try:
        t = c["verification_time"]
        now_ms = round(datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp() * 1000) if isinstance(t, str) and RFC3339.fullmatch(t) else None
    except ValueError:
        now_ms = None
    if data is None or not isinstance(c["policy"], dict) or now_ms is None:
        fail(f"case {c['id']}: verify_signed_bundle_v2 fields have the wrong types")
    try:
        signed = json.loads(data.decode("utf-8"), parse_constant=refuse_constant)
    except (UnicodeDecodeError, ValueError):
        return {"id": c["id"], "status": "rejected", "code": "parse"}
    from dcp_ai.v2.verify import verify_signed_bundle_v2
    r = asyncio.run(verify_signed_bundle_v2(signed, registry(), c["policy"], now_ms=now_ms))
    return {"id": c["id"], "status": "ok", "verified": r["verified"], "errors": r["errors"]}


def run_case(c: dict, v2: bool = False) -> dict:
    if v2 and isinstance(c, dict) and isinstance(c.get("id"), str) and c.get("op") in EVIDENCE:
        return run_evidence_case(c)
    op = c.get("op") if isinstance(c, dict) else None
    known = {"canonicalize": ["id", "op", "profile", "input_b64"], "digest": ["id", "op", "alg", "input_b64"]}.get(op)
    if known is None:
        if isinstance(c, dict) and isinstance(c.get("id"), str):
            return {"id": c["id"], "status": "unsupported"}
        fail("a case needs an id")
    if not exact_keys(c, known) or not isinstance(c["id"], str):
        fail(f"case fields do not match op {op}")
    data = decode_base64_strict(c["input_b64"])
    if data is None:
        fail(f"case {c['id']}: input_b64 is not canonical base64")
    if op == "digest":
        if c["alg"] == "sha256":
            return {"id": c["id"], "status": "ok", "hex": sha256_hex(data)}
        if c["alg"] == "sha3-256":
            return {"id": c["id"], "status": "ok", "hex": sha3_256_hex(data)}
        return {"id": c["id"], "status": "unsupported"}
    if c["profile"] != "dcp-jcs-v1":
        return {"id": c["id"], "status": "unsupported"}
    try:
        value = json.loads(data.decode("utf-8"), parse_constant=refuse_constant)
    except (UnicodeDecodeError, ValueError):
        return {"id": c["id"], "status": "rejected", "code": "parse"}
    try:
        out = canonicalize_v2(value)
    except TypeError as e:
        if type(e) is TypeError and DOCUMENTED_REJECTION.match(str(e)):
            return {"id": c["id"], "status": "rejected", "code": "profile"}
        raise
    return {"id": c["id"], "status": "ok", "output_b64": base64.b64encode(out.encode("utf-8")).decode("ascii")}


def main() -> None:
    try:
        request = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as e:
        fail(f"the request is not UTF-8 JSON ({e})")
    if (not exact_keys(request, ["contract", "run_id", "nonce", "cases"]) or request["contract"] not in (CONTRACT, CONTRACT_V2)
            or not isinstance(request["run_id"], str) or not isinstance(request["nonce"], str) or not isinstance(request["cases"], list)):
        fail("the request needs exactly contract dcp-ai-conformance-external/1, run_id, nonce and cases")
    results = []
    for c in request["cases"]:
        try:
            results.append(run_case(c, request["contract"] == CONTRACT_V2))
        except Exception as e:  # an unexpected exception is the implementation's error, never a rejection
            results.append({"id": c.get("id") if isinstance(c, dict) else None, "status": "error", "message": f"{type(e).__name__}: {e}"[:500]})
    response = {
        "contract": request["contract"],
        "run_id": request["run_id"],
        "nonce": request["nonce"],
        "implementation": {
            "name": "dcp-ai (Python SDK) via tools/conformance/wrappers/python_sdk.py",
            "version": installed_version(),
            "resolved_from": dcp_ai.__file__,
            "runtime": f"{platform.python_implementation()} {platform.python_version()}",
        },
        "results": results,
    }
    sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
