"""Single-use ledger and effects of the MP-05 rehearsal (TEST ONLY). Mirrors node/ledger.mjs; same files and keys.

A reservation is a file created with O_CREAT|O_EXCL under ledger/<tenant>/, then fsync of the file and its directory:
at most one attempt per signed intent, never exactly-once execution and no transaction with external systems. A short
write fails closed and is never retried. On macOS fsync does not flush the disk cache (F_FULLFSYNC), so no durability
across a machine crash is claimed. Standard library only.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

TENANT = re.compile(r"[A-Za-z0-9_-]{1,32}")
PAYLOAD_HASH = re.compile(r"sha256:[0-9a-f]{64}")
KEY = re.compile(r"[0-9a-f]{64}")


class LedgerError(Exception):
    pass


def action_key(tenant: Any, payload_hash: Any) -> str:
    if not isinstance(tenant, str) or TENANT.fullmatch(tenant) is None:
        raise LedgerError("invalid tenant")
    if not isinstance(payload_hash, str) or PAYLOAD_HASH.fullmatch(payload_hash) is None:
        raise LedgerError("invalid payload_hash")
    return hashlib.sha256(tenant.encode("utf-8") + b"\x00" + payload_hash.encode("utf-8")).hexdigest()


def _fsync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _write_exactly(fd: int, data: bytes, write: Callable[[int, bytes], int]) -> None:
    n = write(fd, data)
    if n != len(data):
        raise LedgerError(f"short write: {n} of {len(data)} bytes")


def reserve(root: Any, tenant: str, key: str, *, write: Callable[[int, bytes], int] = os.write) -> bool:
    """True if this call reserved the key; False if it was already reserved. Any other failure raises."""
    if not isinstance(tenant, str) or TENANT.fullmatch(tenant) is None:
        raise LedgerError("invalid tenant")
    if not isinstance(key, str) or KEY.fullmatch(key) is None:
        raise LedgerError("invalid key")
    d = Path(root) / tenant
    d.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        fd = os.open(d / key, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_CLOEXEC, 0o600)
    except FileExistsError:
        return False
    try:
        record = {"key": key, "tenant": tenant, "reserved_at": datetime.now(timezone.utc).isoformat()}
        _write_exactly(fd, (json.dumps(record, separators=(",", ":")) + "\n").encode("utf-8"), write)
        os.fsync(fd)
    finally:
        os.close(fd)
    _fsync_dir(d)
    return True


def reservations(root: Any, tenant: str) -> list[str]:
    d = Path(root) / tenant
    return sorted(p.name for p in d.iterdir() if KEY.fullmatch(p.name)) if d.is_dir() else []


def append_effect(path: Any, record: dict, *, write: Callable[[int, bytes], int] = os.write) -> None:
    """Appends one effect record as a JSON line; raises on a short write without retrying."""
    data = (json.dumps(record, separators=(",", ":")) + "\n").encode("utf-8")
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_CLOEXEC, 0o600)
    try:
        _write_exactly(fd, data, write)
        os.fsync(fd)
    finally:
        os.close(fd)
    _fsync_dir(Path(path).parent)


def read_effects(path: Any) -> list:
    """Every effect record; raises on a line that is not complete JSON, such as the remains of a short write."""
    p = Path(path)
    if not p.exists():
        return []
    text = p.read_text(encoding="utf-8")
    if text and not text.endswith("\n"):
        raise LedgerError("incomplete last line")
    out = []
    for i, line in enumerate(text.splitlines(), 1):
        try:
            out.append(json.loads(line))
        except ValueError as e:
            raise LedgerError(f"line {i} is not JSON") from e
    return out
