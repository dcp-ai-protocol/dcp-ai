"""
Source supervision for DCPVerifyMiddleware (docs/reviews/admission-source-supervision-plan.md,
steps 1 and 2): a deadline and a capacity for an asynchronous trusted_principals and
revocation_source.

A SourceSupervisor is an object the operator creates and shares between middlewares of one event
loop: its capacity is per object, and it binds to the first event loop that uses it, so a worker
process, or an event loop, needs its own. It counts each source call it starts as a Task it owns,
from before the Task starts until the Task really finishes: a source that ignores cancellation
keeps its slot, and there is no queue and no reset. The deadline is measured with loop.time() and
checked when a result arrives, not only when the timer runs; nothing that arrives after it is
used. It asks a late source to stop (Task.cancel) without waiting for it, so it does not stop work
that ignores cancellation, isolate CPU, or bound work a source starts on its own; and a server or
asyncio.run shutting down may still wait for such a Task.
"""

from __future__ import annotations

import asyncio
import inspect
import math
import threading
from typing import Any, Awaitable, Callable

from dcp_ai.v2.admission import AdmissionConfigError

MAX_SAFE_INTEGER = 2**53 - 1
#: The longest deadline or drain accepted, in seconds: the TypeScript adapters' 2147483647 ms.
MAX_SECONDS = 2147483.647

_COUNTERS = ("timeouts", "saturated", "closed", "wrong_loop", "late_results", "late_errors")


def _count(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= MAX_SAFE_INTEGER


def seconds(value: Any, name: str, *, minimum_inclusive: bool) -> float:
    """A finite number of seconds, above 0 (or 0 itself when minimum_inclusive), up to MAX_SECONDS."""
    ok = isinstance(value, (int, float)) and not isinstance(value, bool)
    if ok:
        try:
            number = float(value)
        except OverflowError:  # an int too large for a float
            ok = False
        else:
            ok = math.isfinite(number) and (number >= 0 if minimum_inclusive else number > 0) and number <= MAX_SECONDS
    if not ok:
        bound = "0" if minimum_inclusive else "more than 0"
        raise AdmissionConfigError("CONFIG_INVALID_VALUE", f"{name} must be a number of seconds from {bound} to {MAX_SECONDS}")
    return number


def saturating_increment(value: int) -> int:
    """value + 1, stopping at 2**53 - 1."""
    return value + 1 if value < MAX_SAFE_INTEGER else MAX_SAFE_INTEGER


class _Invocation:
    __slots__ = ("tenant", "deadline", "decision", "timer", "task", "cancel_requested")

    def __init__(self, tenant: str, deadline: float, decision: asyncio.Future) -> None:
        self.tenant = tenant
        self.deadline = deadline
        self.decision = decision
        self.timer: asyncio.TimerHandle | None = None
        self.task: asyncio.Task | None = None
        # A cancellation asked for before the Task exists: an eager source can reach close() or its
        # deadline inside create_task. Applied as soon as the Task is registered.
        self.cancel_requested = False


class SourceSupervisor:
    """
    A deadline and a capacity for DCPVerifyMiddleware's asynchronous trusted_principals, given with
    ``supervise={"trust_timeout": seconds}``, and revocation_source, with ``{"revocation": True}``.
    Both share its capacity.

    ``max_in_flight`` source calls run at once, across tenants; ``max_in_flight_per_tenant`` caps
    one tenant, and without it one tenant can take the whole capacity. Both are positive integers
    up to 2**53 - 1. A call that finds no free slot is refused at once: there is no queue.
    """

    def __init__(self, *, max_in_flight: int, max_in_flight_per_tenant: int | None = None) -> None:
        if not _count(max_in_flight):
            raise AdmissionConfigError("CONFIG_INVALID_VALUE", "max_in_flight must be a positive integer up to 2**53 - 1")
        if max_in_flight_per_tenant is not None and not _count(max_in_flight_per_tenant):
            raise AdmissionConfigError("CONFIG_INVALID_VALUE", "max_in_flight_per_tenant must be a positive integer up to 2**53 - 1")
        self._max = max_in_flight
        self._max_per_tenant = max_in_flight_per_tenant
        # Guards the binding, the reservation and the counters only: no await, logging or source
        # code runs while it is held.
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._open = True
        self._in_flight = 0
        self._tenants: dict[str, int] = {}
        self._counts = dict.fromkeys(_COUNTERS, 0)
        self._undecided: set[_Invocation] = set()
        self._tasks: set[asyncio.Task] = set()  # strong references until each Task is done
        self._drains: set[asyncio.Future] = set()

    def stats(self) -> dict[str, Any]:
        """Counters, with no tenant and nothing a source returned."""
        with self._lock:
            return {"open": self._open, "in_flight": self._in_flight, "tenants": len(self._tenants), **self._counts}

    def _bump(self, name: str) -> None:
        self._counts[name] = saturating_increment(self._counts[name])

    async def close(self, drain_timeout: float = 0) -> dict[str, int]:
        """
        Refuses new calls, answers pending ones with a failure, asks every source Task to cancel and
        waits at most ``drain_timeout`` seconds (default 0) for them to finish. Returns how many are
        still in flight: their slots stay taken until they finish. Must run on the supervisor's
        event loop; there is no reopening.
        """
        drain = seconds(drain_timeout, "drain_timeout", minimum_inclusive=True)
        loop = asyncio.get_running_loop()
        with self._lock:
            if self._loop is None:
                self._loop = loop
            # Checked before anything changes: a refused close() leaves the owner's work alone.
            if self._loop is not loop:
                raise RuntimeError("SourceSupervisor.close() must run on the event loop the supervisor is bound to")
            self._open = False
            pending = list(self._undecided)
            tasks = list(self._tasks)
        for invocation in pending:
            self._decide(invocation, ("closed", None), counter="closed")
            if invocation.task is None:
                invocation.cancel_requested = True
        for task in tasks:
            task.cancel()
        waiter: asyncio.Future | None = None
        with self._lock:
            if self._in_flight > 0 and drain > 0:
                waiter = loop.create_future()
                self._drains.add(waiter)
        if waiter is not None:
            try:
                await asyncio.wait({waiter}, timeout=drain)
            finally:
                with self._lock:
                    self._drains.discard(waiter)
        with self._lock:
            return {"in_flight": self._in_flight}

    async def _run(self, tenant: str, timeout: float, call: Callable[[], Awaitable[Any]]) -> tuple[str, Any]:
        """
        Runs ``call`` as a Task under this supervisor. Returns ("ok", value), ("failed", error) or
        (reason, None) with reason "timeout", "saturated", "closed" or "wrong_loop". A refusal
        returns without suspending. A cancelled caller is cancelled; its source Task is asked to
        cancel and keeps its slot until it finishes.
        """
        loop = asyncio.get_running_loop()
        with self._lock:
            if self._loop is None:
                self._loop = loop
            if self._loop is not loop:
                self._bump("wrong_loop")
                return ("wrong_loop", None)
            if not self._open:
                self._bump("closed")
                return ("closed", None)
            held = self._tenants.get(tenant, 0)
            if self._in_flight >= self._max or (self._max_per_tenant is not None and held >= self._max_per_tenant):
                self._bump("saturated")
                return ("saturated", None)
            self._in_flight += 1
            self._tenants[tenant] = held + 1
        # Everything the Task's completion relies on exists before the Task: with an eager task
        # factory (Python 3.12+) it may run, even finish, inside create_task.
        invocation = _Invocation(tenant, loop.time() + timeout, loop.create_future())
        invocation.timer = loop.call_later(timeout, self._expire, invocation)
        with self._lock:
            self._undecided.add(invocation)
        coroutine = self._invoke(loop, call)
        try:
            task = loop.create_task(coroutine)
        except BaseException as exc:  # a task factory that fails: nothing started, nothing held
            coroutine.close()
            invocation.timer.cancel()
            with self._lock:
                self._undecided.discard(invocation)
            self._release(invocation.tenant)
            if not isinstance(exc, Exception):
                raise
            return ("failed", exc)
        invocation.task = task
        with self._lock:
            self._tasks.add(task)
        task.add_done_callback(lambda done: self._finished(invocation, done))
        if invocation.cancel_requested:
            task.cancel()
        try:
            outcome = await invocation.decision
        except asyncio.CancelledError:
            # The caller was cancelled: ask the source to stop, keep its slot until it finishes.
            invocation.timer.cancel()
            with self._lock:
                self._undecided.discard(invocation)
            task.cancel()
            raise
        if outcome[0] == "ok" and loop.time() > invocation.deadline:
            # Decided in time, but resumed after the deadline (a blocked loop): not used.
            with self._lock:
                self._bump("timeouts")
                self._bump("late_results")
            return ("timeout", None)
        return outcome

    @staticmethod
    async def _invoke(loop: asyncio.AbstractEventLoop, call: Callable[[], Any]) -> tuple[str, Any, float]:
        try:
            result = call()
            if inspect.isawaitable(result):
                result = await result
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            return ("failed", exc, loop.time())
        return ("ok", result, loop.time())

    def _decide(self, invocation: _Invocation, outcome: tuple[str, Any], *, counter: str | None = None) -> bool:
        with self._lock:
            if invocation not in self._undecided:
                return False
            self._undecided.discard(invocation)
            if counter:
                self._bump(counter)
        if invocation.timer is not None:
            invocation.timer.cancel()
        if not invocation.decision.done():
            invocation.decision.set_result(outcome)
        return True

    def _expire(self, invocation: _Invocation) -> None:
        if self._decide(invocation, ("timeout", None), counter="timeouts"):
            # Asks; never waits for the source to cooperate.
            if invocation.task is not None:
                invocation.task.cancel()
            else:
                invocation.cancel_requested = True

    def _finished(self, invocation: _Invocation, task: asyncio.Task) -> None:
        # Read the outcome first, so no exception is left unretrieved.
        if task.cancelled():
            outcome: tuple[str, Any] = ("failed", asyncio.CancelledError("the source was cancelled"))
            arrived = task.get_loop().time()
        else:
            error = task.exception()
            if error is not None:  # not an Exception (those are caught in _invoke)
                outcome, arrived = ("failed", error), task.get_loop().time()
            else:
                status, value, arrived = task.result()
                outcome = (status, value)
        with self._lock:
            self._tasks.discard(task)
        self._release(invocation.tenant)
        # In time both when it arrived and now, when it is decided: a callback can run late.
        if arrived <= invocation.deadline and task.get_loop().time() <= invocation.deadline and self._decide(invocation, outcome):
            return
        # Late (or answered already by a timeout, close() or a cancelled caller): never used.
        if self._decide(invocation, ("timeout", None), counter="timeouts"):
            pass  # arrived after the deadline, before the timer ran
        with self._lock:
            self._bump("late_results" if outcome[0] == "ok" else "late_errors")

    def _release(self, tenant: str) -> None:
        with self._lock:
            self._in_flight -= 1
            left = self._tenants.get(tenant, 1) - 1
            if left <= 0:
                self._tenants.pop(tenant, None)
            else:
                self._tenants[tenant] = left
            drains = list(self._drains) if self._in_flight == 0 else []
        for waiter in drains:
            if not waiter.done():
                waiter.set_result(None)
