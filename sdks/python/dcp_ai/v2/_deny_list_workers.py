"""
DenyListWorkers: a budget of real worker threads for deny_list_revocation_source(..., workers=...)
See integrations/fastapi/README.md, "Bounding deny-list downloads".

Each admitted download runs fetch() in a thread of its own, started only after a slot is reserved,
and that thread frees the slot when the download has really ended, whatever happened to the call
that waited for it (a timeout, a cancellation, a closed event loop). A call that finds no free slot
is refused at once: there is no queue. The threads are not daemon threads, so the interpreter waits
for a download still running when the process exits, as it already does for asyncio.to_thread.
Nothing here stops DNS, TLS or urllib: cancelling a call only stops waiting for it.
"""

from __future__ import annotations

import asyncio
import os
import threading
import time
from typing import Any, Callable

from dcp_ai.v2.admission import RevocationSourceError

#: The largest max_workers accepted.
MAX_WORKERS = 64

_MAX_SAFE_INTEGER = 2**53 - 1
_COUNTERS = ("saturated", "closed", "start_failed", "late_results", "dropped")
_OTHER_PROCESS = "this DenyListWorkers was created in another process: create one in each process"


def _unavailable(reason: str) -> RevocationSourceError:
    return RevocationSourceError("REVOCATION_UNAVAILABLE", f"the deny list could not be fetched ({reason})")


class _Slot:
    """One reservation. Who frees it is decided under the lock: the thread once it has started,
    else whoever gives up starting it."""

    __slots__ = ("tenant", "started", "abandoned", "released")

    def __init__(self, tenant: str) -> None:
        self.tenant = tenant
        self.started = False
        self.abandoned = False
        self.released = False


class DenyListWorkers:
    """
    At most ``max_workers`` deny-list downloads at once, from 1 to 64, and at most
    ``max_workers_per_tenant`` for one tenant (without it one tenant can take them all). Give the
    same object to every deny_list_revocation_source that should share the budget; create one in
    each process, after any fork.
    """

    def __init__(self, *, max_workers: int, max_workers_per_tenant: int | None = None) -> None:
        if isinstance(max_workers, bool) or not isinstance(max_workers, int):
            raise TypeError("max_workers must be an integer")
        if not 1 <= max_workers <= MAX_WORKERS:
            raise ValueError(f"max_workers must be from 1 to {MAX_WORKERS}")
        if max_workers_per_tenant is not None:
            if isinstance(max_workers_per_tenant, bool) or not isinstance(max_workers_per_tenant, int):
                raise TypeError("max_workers_per_tenant must be an integer")
            if not 1 <= max_workers_per_tenant <= max_workers:
                raise ValueError("max_workers_per_tenant must be from 1 to max_workers")
        self._max = max_workers
        self._max_per_tenant = max_workers_per_tenant
        self._pid = os.getpid()
        # Guards the reservations and the counters only: no I/O and no await while it is held.
        self._lock = threading.Lock()
        self._open = True
        self._in_flight = 0
        self._tenants: dict[str, int] = {}
        self._counts = dict.fromkeys(_COUNTERS, 0)

    def _same_process(self) -> bool:
        # Checked before the lock: after a fork the child's copy of the lock may be held forever.
        return os.getpid() == self._pid

    def stats(self) -> dict[str, Any]:
        """Counters, with no tenant, URL or header."""
        if not self._same_process():
            raise RuntimeError(_OTHER_PROCESS)
        with self._lock:
            return {"open": self._open, "in_flight": self._in_flight, "tenants": len(self._tenants), **self._counts}

    def close(self) -> dict[str, int]:
        """Refuses new downloads. It neither waits for nor stops the ones running, whose slots stay
        taken until they end. There is no reopening."""
        if not self._same_process():
            raise RuntimeError(_OTHER_PROCESS)
        with self._lock:
            self._open = False
            return {"in_flight": self._in_flight}

    def _bump(self, name: str) -> None:  # with the lock held
        self._counts[name] = min(self._counts[name] + 1, _MAX_SAFE_INTEGER)

    def _release(self, slot: _Slot) -> None:  # with the lock held; once per slot
        if slot.released:
            return
        slot.released = True
        self._in_flight -= 1
        left = self._tenants.get(slot.tenant, 1) - 1
        if left <= 0:
            self._tenants.pop(slot.tenant, None)
        else:
            self._tenants[slot.tenant] = left

    def _abandon(self, slot: _Slot) -> None:
        """Starting the thread failed: free the slot unless the thread already runs (it then frees
        it itself); a thread that starts after this sees `abandoned` and does nothing."""
        with self._lock:
            self._bump("start_failed")
            if not slot.started:
                slot.abandoned = True
                self._release(slot)

    async def _download(self, fetch: Callable[[], bytes], tenant: str, timeout: float) -> bytes:
        """fetch() in a thread of this budget: its bytes when they arrive and are used in time."""
        if not self._same_process():
            raise _unavailable("workers of another process")
        deadline = time.monotonic() + timeout
        slot = _Slot(tenant)  # before any counter changes: nothing is left reserved if this fails
        with self._lock:
            refused = None
            if not self._open:
                self._bump("closed")
                refused = "workers closed"
            else:
                held = self._tenants.get(tenant, 0)
                if self._in_flight >= self._max or (self._max_per_tenant is not None and held >= self._max_per_tenant):
                    self._bump("saturated")
                    refused = "no free worker"
                else:
                    # The tenant first: if writing it fails, the global count has not moved.
                    self._tenants[tenant] = held + 1
                    self._in_flight += 1
        if refused is not None:
            raise _unavailable(refused)
        try:
            loop = asyncio.get_running_loop()
            waiter = loop.create_future()
            # daemon=False on purpose: a Thread inherits daemon from the thread that creates it.
            worker = threading.Thread(target=self._work, args=(slot, fetch, loop, waiter), name="dcp-deny-list", daemon=False)
            worker.start()
        except BaseException as exc:
            self._abandon(slot)
            if isinstance(exc, Exception):
                raise _unavailable("worker not started") from None
            raise
        try:
            status, value, arrived = await asyncio.wait_for(waiter, max(deadline - time.monotonic(), 0))
        except asyncio.TimeoutError:
            raise _unavailable("timed out") from None
        if arrived > deadline or time.monotonic() > deadline:
            # Arrived, or used, after the deadline (a busy loop): never used, an error neither.
            with self._lock:
                self._bump("late_results")
            raise _unavailable("timed out")
        if status == "failed":
            raise value
        return value

    def _work(self, slot: _Slot, fetch: Callable[[], bytes], loop: asyncio.AbstractEventLoop, waiter: asyncio.Future) -> None:
        with self._lock:
            if slot.abandoned:
                return
            slot.started = True
        try:
            outcome = ("ok", fetch(), time.monotonic())
        except BaseException as exc:  # read here: never left to threading.excepthook
            outcome = ("failed", exc, time.monotonic())
        finally:
            with self._lock:
                self._release(slot)  # the download has really ended
        try:
            if loop.is_closed():
                raise RuntimeError("the event loop is closed")
            loop.call_soon_threadsafe(self._settle, waiter, outcome)
        except Exception:  # the loop closed, also between the check and the call
            with self._lock:
                self._bump("dropped")

    def _settle(self, waiter: asyncio.Future, outcome: tuple[str, Any, float]) -> None:
        if waiter.done():  # its call stopped waiting
            with self._lock:
                self._bump("late_results")
            return
        # A result, never set_exception: nothing is left unretrieved if the call is cancelled now.
        waiter.set_result(outcome)
