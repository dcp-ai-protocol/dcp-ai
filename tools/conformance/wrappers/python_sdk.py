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

import base64
import binascii
import importlib.metadata
import json
import os
import platform
import re
import sys

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


def run_case(c: dict) -> dict:
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
    if not exact_keys(request, ["contract", "run_id", "nonce", "cases"]) or request["contract"] != CONTRACT or not isinstance(request["cases"], list):
        fail("the request needs exactly contract dcp-ai-conformance-external/1, run_id, nonce and cases")
    results = []
    for c in request["cases"]:
        try:
            results.append(run_case(c))
        except Exception as e:  # an unexpected exception is the implementation's error, never a rejection
            results.append({"id": c.get("id") if isinstance(c, dict) else None, "status": "error", "message": f"{type(e).__name__}: {e}"[:500]})
    response = {
        "contract": CONTRACT,
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
