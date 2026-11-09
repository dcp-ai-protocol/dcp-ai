"""Operator sources as the application reads them, and the installed-SDK check (TEST ONLY).

Mirrors node/sources.mjs. A list that cannot be read or parsed gives no snapshot (None), which the SDK reports as
REVOCATION_UNAVAILABLE: a failure never becomes "not revoked". Run only from a staged kit with the consumer's
interpreter and -I (no PYTHONPATH, no user site).
"""

from __future__ import annotations

import json
import re
import sys
import sysconfig
from datetime import datetime
from pathlib import Path
from typing import Any

KIT = Path(__file__).resolve().parents[1]
TENANT = re.compile(r"[A-Za-z0-9_-]{1,32}")
RFC3339 = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})")


def read_json(path: Any) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_contract() -> dict:
    return read_json(KIT / "contract" / "rehearsal-contract.json")


def assert_installed_sdk() -> str:
    """Refuses to run unless isolated, staged, and dcp_ai resolves inside this interpreter's site-packages."""
    import dcp_ai

    package = Path(dcp_ai.__file__).resolve()
    purelib = Path(sysconfig.get_paths()["purelib"]).resolve()
    if not sys.flags.isolated:
        raise RuntimeError("run with python -I")
    if purelib not in package.parents:
        raise RuntimeError(f"dcp_ai resolved outside {purelib}: {package}")
    if not (KIT / "STAGED.json").is_file():
        raise RuntimeError("run the staged kit, not the checkout")
    return str(package)


def check_staged() -> int:
    """Re-hashes every staged file against STAGED.json (the installed packages are verify.py's job)."""
    import hashlib

    staged = read_json(KIT / "STAGED.json")
    for rel, digest in staged["files"].items():
        f = KIT / rel
        if f.is_symlink() or hashlib.sha256(f.read_bytes()).hexdigest() != digest:
            raise RuntimeError(f"staged file changed: {rel}")
    return len(staged["files"])


def assert_verified(record_path: Any, consumer: Any) -> dict:
    """The launcher's record of verify.py for this consumer must say it passed."""
    record = read_json(record_path)
    if record.get("verify_format") != "dcp-ai-mp05-verify-run-v1" or record.get("exit_code") != 0:
        raise RuntimeError(f"{record_path}: verify.py did not pass")
    if Path(record["consumer"]).resolve() != Path(consumer).resolve():
        raise RuntimeError(f"{record_path}: verified another consumer")
    return record


def tenant_config(state: Any, tenant: str) -> dict:
    if not isinstance(tenant, str) or TENANT.fullmatch(tenant) is None:
        raise ValueError("invalid tenant")
    d = Path(state) / "operator" / "tenants" / tenant
    trust = d / "trust.json"
    return {"policy": read_json(d / "policy.json"), "trust": read_json(trust) if trust.is_file() else None}


def read_list(path: Any) -> Any:
    try:
        return read_json(path)
    except (OSError, ValueError):
        return None


def composition_subjects(*values: Any) -> dict:
    """A superset of the revocation subjects of a composition: every agent_id and kid anywhere in the evidence."""
    agent_ids: set[str] = set()
    kids: set[str] = set()

    def walk(v: Any) -> None:
        if isinstance(v, list):
            for x in v:
                walk(x)
        elif isinstance(v, dict):
            for k, x in v.items():
                if k == "agent_id" and isinstance(x, str):
                    agent_ids.add(x)
                if k == "kid" and isinstance(x, str):
                    kids.add(x)
                walk(x)

    for v in values:
        walk(v)
    return {"agent_ids": sorted(agent_ids), "kids": sorted(kids)}


def agent_key_snapshot(deny_list: Any, subjects: dict) -> dict | None:
    if deny_list is None:
        return None
    from dcp_ai.v2 import revocation_snapshot_from_deny_list

    try:
        return revocation_snapshot_from_deny_list(deny_list, subjects)
    except Exception:  # noqa: BLE001 - an unreadable list gives no snapshot
        return None


def _rfc3339(value: Any) -> bool:
    if not isinstance(value, str) or RFC3339.fullmatch(value) is None:
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def mandate_snapshot(lst: Any, chain: Any) -> dict | None:
    """{checked_at, mandates} for every mandate id of the chain, from {updated_at, revoked_mandates: [{mandate_id}]}."""
    if not (
        isinstance(lst, dict)
        and _rfc3339(lst.get("updated_at"))
        and isinstance(lst.get("revoked_mandates"), list)
        and all(isinstance(r, dict) and isinstance(r.get("mandate_id"), str) for r in lst["revoked_mandates"])
    ):
        return None
    revoked = {r["mandate_id"] for r in lst["revoked_mandates"]}
    mandates = {}
    for m in chain if isinstance(chain, list) else []:
        if isinstance(m, dict) and isinstance(m.get("mandate_id"), str):
            mandates[m["mandate_id"]] = "revoked" if m["mandate_id"] in revoked else "not_revoked"
    return {"checked_at": lst["updated_at"], "mandates": mandates}
