"""Python SDK shim for the differential fuzzer.

Usage: python verify.py [mode] [--loop]
  stdin: one signed bundle (JSON document); with --loop, one compact JSON
         document per line.
  stdout: one line per document: {"valid": bool, "errors": [string]}
  mode: empty for DEFAULT_VERIFIER_POLICY, or a verification mode applied to
        default_mode and to every risk tier (as the interop tests do).
Exit code 0 for a verdict; anything else is a crash of the verifier.

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


if loop:
    for line in sys.stdin:
        if not line.strip():
            continue
        sys.stdout.write(verdict(line) + "\n")
        sys.stdout.flush()
else:
    sys.stdout.write(verdict(sys.stdin.read()) + "\n")
