"""
DCPVerifyMiddleware supervision of the strict-v1 revocation_source
(docs/reviews/admission-source-supervision-plan.md, step 2), through the real middleware over ASGI
(httpx.ASGITransport): the same responses with and without {"revocation": True}, a deadline that
does not wait for a source ignoring cancellation, one capacity shared with the trust source and
held until a source's Task really finishes, close(), event loops, configuration, the unchanged
legacy path, and the known limit of deny_list_revocation_source's worker thread. Every scenario
runs in one event loop under a watchdog and lets every source it started finish before it
returns. Deadlines are measured from the source's call to its cancellation, never through the
bundle's verification.

    DCP_NEGATIVE_CONTROL=1 pytest tests/test_fastapi_revocation_supervision.py   # must fail once
"""

from __future__ import annotations

import asyncio
import copy
import functools
import json
import logging
import math
import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI, Request

from dcp_ai.fastapi import DCPVerifyMiddleware, SourceSupervisor, deny_list_revocation_source
from dcp_ai.v2 import AdmissionConfigError
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms

REPO_ROOT = Path(__file__).resolve().parents[3]
VECTORS = json.loads((REPO_ROOT / "tests" / "interop" / "v2" / "admission_vectors.json").read_text())
CASES = {c["name"]: c for c in VECTORS["cases"]}
NOW = rfc3339_epoch_ms(CASES["A_known_principal_strict"]["now"])  # every 13_* case's clock too
STRICT = VECTORS["profiles"]["strict"]
TRUST = VECTORS["trust_sets"]["principal"]
NEGATIVE_CONTROL = os.environ.get("DCP_NEGATIVE_CONTROL") == "1"
TRUST_UNAVAILABLE = {"verified": False, "admitted": False, "errors": ["The principal trust set is unavailable"]}
UNAVAILABLE = {
    "verified": True,
    "admitted": False,
    "principal_trust": "trusted",
    "profile": "strict-v1",
    "profile_compliance": "non_compliant",
    "codes": ["REVOCATION_UNAVAILABLE"],
    "errors": ["REVOCATION_UNAVAILABLE: no revocation status could be obtained"],
}
SUBJECTS = {"agent_ids": [], "kids": []}
DEADLINE = 20.0
GRACE = 5.0


def _bundle(name: str = "base") -> dict:
    return copy.deepcopy(VECTORS["signed_bundles"][name])


def snapshot(case: str = "A_known_principal_strict") -> dict:
    return copy.deepcopy(CASES[case]["revocation"])


class Invalid(Exception):
    code = "REVOCATION_INVALID"


_HELD: list = []
_SERVERS: list = []


def _release_fixtures():
    for held in _HELD:
        held.release()
    _HELD.clear()
    for server in _SERVERS:
        server.close()
    _SERVERS.clear()


def run(scenario, deadline: float = DEADLINE):
    """
    Runs one scenario in a fresh event loop. A watchdog, a loop callback independent of the
    scenario, releases every Held source and hung server it created once `deadline` passes: a
    scenario stuck behind a source that ignores cancellation (asyncio.wait_for waiting for it, a
    finally that would never run) then ends, and the run fails with an assertion. They are released
    at the end in any case, so none outlives the loop. The clock is checked again on return; a loop
    blocked by CPU delays the watchdog too, so there is no hard deadline for that.
    """
    expired = False

    def expire():
        nonlocal expired
        expired = True
        _release_fixtures()

    async def guarded():
        watchdog = asyncio.get_running_loop().call_later(deadline, expire)
        try:
            return await asyncio.wait_for(scenario(), deadline + GRACE)
        finally:
            watchdog.cancel()
            _release_fixtures()
            await asyncio.sleep(0.01)

    started = time.monotonic()
    try:
        return asyncio.run(guarded())
    finally:
        elapsed = time.monotonic() - started
        assert not expired and elapsed <= deadline, (
            f"the scenario ran past its {deadline} s deadline ({elapsed:.2f} s); the watchdog released its sources"
        )


async def until(check, limit: float = 5.0):
    end = time.monotonic() + limit
    while not check():
        assert time.monotonic() < end, "condition not met in time"
        await asyncio.sleep(0.005)


async def async_trust(tenant):
    return TRUST


async def clear(subjects, tenant):
    return snapshot()


class Held:
    """A revocation source that waits for release(), ignoring cancellation, then returns `value`
    (or raises `error`); with `reraise` it re-raises the cancellation once released."""

    def __init__(self, value=None, *, error=None, reraise=False):
        self.release_event = asyncio.Event()
        self.value = snapshot() if value is None else value
        self.error, self.reraise = error, reraise
        self.calls = 0
        self.cancelled = 0
        self.called_at = self.cancelled_at = None
        _HELD.append(self)

    async def __call__(self, subjects, tenant):
        self.calls += 1
        self.called_at = asyncio.get_running_loop().time()
        while True:
            try:
                await self.release_event.wait()
                break
            except asyncio.CancelledError:
                self.cancelled += 1
                self.cancelled_at = self.cancelled_at or asyncio.get_running_loop().time()
                if self.reraise:
                    await self.release_event.wait()
                    raise
        if self.error is not None:
            raise self.error
        return self.value

    def release(self):
        self.release_event.set()


def _app(revocation_source, supervisor=None, *, timeout=0.1, trust=TRUST, supervise=None, reached=None, **extra) -> FastAPI:
    """strict-v1 with `trust` (a static trust set by default); revocation supervised by `supervisor`."""
    app = FastAPI()
    options = {"require_bundle": True, "clock": lambda: NOW, "trusted_principals": trust, "profile": STRICT,
               "revocation_source": revocation_source, "revocation_timeout": timeout,
               "tenant": lambda request: request.headers.get("x-tenant", ""), **extra}
    if supervisor is not None:
        options.update(source_supervisor=supervisor, supervise=supervise or {"revocation": True})
    app.add_middleware(DCPVerifyMiddleware, **options)

    @app.post("/action")
    async def action(request: Request):
        if reached is not None:
            reached.append(getattr(request.state, "dcp_agent", None))
        return {"reached": True}

    return app


async def post(app: FastAPI, bundle: dict | None = None, *, tenant: str = "", body: dict | None = None, headers: dict | None = None):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post("/action", json={"signed_bundle": bundle or _bundle(), **(body or {})},
                                     headers={"x-tenant": tenant, **(headers or {})})
        return response.status_code, response.json()


# ── Responses ──


def test_a_supervised_revocation_source_that_answers_in_time_admits_as_before():
    async def scenario():
        s = SourceSupervisor(max_in_flight=2)
        calls: list = []

        async def source(subjects, tenant):
            calls.append(tenant)
            return snapshot()

        reached: list = []
        status, _ = await post(_app(source, s, reached=reached), tenant="tenant-a")
        assert status == (403 if NEGATIVE_CONTROL else 200)  # the negative control inverts this expectation
        assert calls == ["tenant-a"] and len(reached) == 1
        assert {k: s.stats()[k] for k in ("in_flight", "tenants", "timeouts")} == {"in_flight": 0, "tenants": 0, "timeouts": 0}
    run(scenario)


async def _raises_down(subjects, tenant):
    raise RuntimeError("down")


async def _raises_invalid(subjects, tenant):
    raise Invalid("unreadable")


async def _returns_none(subjects, tenant):
    return None


async def _cancels_itself(subjects, tenant):
    raise asyncio.CancelledError()


class _AsyncRevocation:
    def __init__(self, case):
        self.case = case

    async def __call__(self, subjects, tenant):
        return snapshot(self.case)


def _of(case):
    async def source(subjects, tenant):
        return snapshot(case)
    return source


@pytest.mark.parametrize(
    "source,status,codes",
    [
        (_of("A_known_principal_strict"), 200, None),
        (_of("13_agent_revoked"), 403, ["REVOCATION_REVOKED"]),
        (_of("13_agent_key_revoked"), 403, ["REVOCATION_REVOKED"]),
        (_of("13_stale_by_1_ms"), 403, ["REVOCATION_STALE"]),
        (_of("13_status_unknown"), 403, ["REVOCATION_UNKNOWN"]),
        (_of("13_extra_field"), 403, ["REVOCATION_INVALID"]),
        (_returns_none, 403, ["REVOCATION_UNAVAILABLE"]),
        (_raises_down, 403, ["REVOCATION_UNAVAILABLE"]),
        (_raises_invalid, 403, ["REVOCATION_INVALID"]),
        (functools.partial(_of("13_agent_revoked")), 403, ["REVOCATION_REVOKED"]),
        (_AsyncRevocation("A_known_principal_strict"), 200, None),
        (functools.partial(_AsyncRevocation("13_agent_revoked")), 403, ["REVOCATION_REVOKED"]),
    ],
)
def test_each_answer_gets_the_same_response_with_and_without_supervision(source, status, codes):
    async def scenario():
        legacy = await post(_app(source))
        revocation_only = await post(_app(source, SourceSupervisor(max_in_flight=1)))
        both = await post(_app(source, SourceSupervisor(max_in_flight=1), trust=async_trust,
                               supervise={"trust_timeout": 2, "revocation": True}))
        assert legacy[0] == status and legacy[1].get("codes") == codes
        assert revocation_only == legacy
        assert both == legacy
    run(scenario)


def test_a_source_that_cancels_itself_gets_revocation_unavailable_not_a_cancelled_request():
    async def scenario():
        s = SourceSupervisor(max_in_flight=1)
        assert await post(_app(_cancels_itself, s)) == (403, UNAVAILABLE)
        assert s.stats()["in_flight"] == 0
    run(scenario)


def test_the_source_is_not_asked_for_a_bundle_that_is_not_verified():
    async def scenario():
        held = Held()
        s = SourceSupervisor(max_in_flight=1)
        app = _app(held, s)
        assert (await post(app, _bundle("other_intended_verifier")))[1]["codes"] == ["PROFILE_AUDIENCE_MISMATCH", "VERIFICATION_FAILED"]
        assert (await post(app, _bundle("pq_signature_invalid")))[1]["codes"] == ["VERIFICATION_FAILED"]
        assert held.calls == 0 and s.stats()["in_flight"] == 0
    run(scenario)


# ── Deadlines ──


@pytest.mark.parametrize("reraise", [False, True], ids=["suppresses_cancel", "slow_cleanup"])
def test_a_source_that_ignores_cancellation_gets_unavailable_at_the_deadline_and_keeps_its_slot(reraise):
    async def scenario():
        s = SourceSupervisor(max_in_flight=2)
        held = Held(reraise=reraise)
        reached: list = []
        assert await post(_app(held, s, timeout=0.1, reached=reached)) == (403, UNAVAILABLE)
        assert 0.098 <= held.cancelled_at - held.called_at < 0.1 + 0.25
        assert reached == []
        assert {k: s.stats()[k] for k in ("in_flight", "tenants", "timeouts")} == {"in_flight": 1, "tenants": 1, "timeouts": 1}
        held.release()  # a late not_revoked (or its cancellation): counted, never used
        await until(lambda: s.stats()["in_flight"] == 0)
        assert s.stats()["late_errors" if reraise else "late_results"] == 1
    run(scenario)


def test_without_supervision_the_legacy_path_is_unchanged_and_still_waits_for_such_a_source():
    # The reason for the opt-in: asyncio.wait_for waits for the source's cancellation, and a source
    # that suppresses it hands in its late snapshot. Kept as before without {"revocation": True}.
    async def scenario():
        held = Held()
        asyncio.get_running_loop().call_later(0.2, held.release)
        status, _ = await post(_app(held, timeout=0.05))
        assert status == 200 and held.cancelled == 1
    run(scenario)


def test_a_late_revocation_invalid_error_is_unavailable_not_invalid():
    async def scenario():
        s = SourceSupervisor(max_in_flight=1)
        held = Held(error=Invalid("unreadable"))
        assert await post(_app(held, s, timeout=0.05)) == (403, UNAVAILABLE)
        held.release()
        await until(lambda: s.stats()["in_flight"] == 0)
        assert s.stats()["late_errors"] == 1
    run(scenario)


def test_a_snapshot_returned_while_the_loop_was_blocked_past_the_deadline_is_refused():
    async def scenario():
        s = SourceSupervisor(max_in_flight=1)

        async def blocking(subjects, tenant):
            time.sleep(0.15)  # blocks the loop past the 50 ms deadline, then answers
            return snapshot()

        assert await post(_app(blocking, s, timeout=0.05)) == (403, UNAVAILABLE)
        assert {k: s.stats()[k] for k in ("timeouts", "late_results", "in_flight")} == {"timeouts": 1, "late_results": 1, "in_flight": 0}
    run(scenario)


def test_a_late_snapshot_is_never_used_nor_kept_for_the_next_request():
    async def scenario():
        s = SourceSupervisor(max_in_flight=2)
        late = Held()
        answers = [late, _of("13_agent_revoked"), clear]
        calls = []

        async def source(subjects, tenant):
            calls.append(tenant)
            return await answers.pop(0)(subjects, tenant)

        app = _app(source, s, timeout=0.05)
        assert await post(app) == (403, UNAVAILABLE)
        late.release()
        await until(lambda: s.stats()["late_results"] == 1)
        assert (await post(app))[1]["codes"] == ["REVOCATION_REVOKED"]
        assert (await post(app))[0] == 200
        assert len(calls) == 3
    run(scenario)


# ── Capacity ──


def test_call_n_plus_1_is_refused_without_calling_the_source_and_slots_free_only_when_tasks_finish():
    async def scenario():
        s = SourceSupervisor(max_in_flight=1)
        held = Held()
        calls = []

        async def source(subjects, tenant):
            calls.append(tenant)
            return await (held if len(calls) == 1 else clear)(subjects, tenant)

        app = _app(source, s, timeout=0.05)
        assert await post(app) == (403, UNAVAILABLE)
        assert await post(app) == (403, UNAVAILABLE)
        assert len(calls) == 1
        assert {k: s.stats()[k] for k in ("in_flight", "timeouts", "saturated")} == {"in_flight": 1, "timeouts": 1, "saturated": 1}
        held.release()
        await until(lambda: s.stats()["in_flight"] == 0)
        assert (await post(app))[0] == 200
    run(scenario)


def test_trust_and_revocation_sources_share_one_capacity_both_ways():
    async def scenario():
        s = SourceSupervisor(max_in_flight=1)
        # A revocation source that timed out and still runs holds the slot: the trust source is refused.
        revocation_held = Held()
        trust_calls = []

        async def trust(tenant):
            trust_calls.append(tenant)
            return TRUST

        both = _app(revocation_held, s, timeout=0.05, trust=trust, supervise={"trust_timeout": 1, "revocation": True})
        assert await post(both) == (403, UNAVAILABLE)
        assert await post(both) == (503, TRUST_UNAVAILABLE)
        assert len(trust_calls) == 1
        revocation_held.release()
        await until(lambda: s.stats()["in_flight"] == 0)
        # A trust source still running holds it: another middleware's revocation is refused, not called.
        trust_held = Held(value=TRUST)

        async def held_trust(tenant):
            return await trust_held(None, tenant)

        trust_only = _app(clear, s, trust=held_trust, timeout=0.05, supervise={"trust_timeout": 0.05})
        assert await post(trust_only) == (503, TRUST_UNAVAILABLE)
        revocation = Held()
        assert await post(_app(revocation, s)) == (403, UNAVAILABLE)
        assert revocation.calls == 0
        assert s.stats()["saturated"] == 2
        trust_held.release()
        await until(lambda: s.stats()["in_flight"] == 0)
    run(scenario)


def test_per_tenant_limit_on_revocation():
    async def scenario():
        s = SourceSupervisor(max_in_flight=3, max_in_flight_per_tenant=1)
        held = Held()

        async def source(subjects, tenant):
            return await (held if tenant == "tenant-a" else clear)(subjects, tenant)

        app = _app(source, s, timeout=5)
        first = asyncio.ensure_future(post(app, tenant="tenant-a"))
        await until(lambda: held.calls == 1)
        assert await post(app, tenant="tenant-a") == (403, UNAVAILABLE)
        assert (await post(app, tenant="tenant-b"))[0] == 200
        held.release()
        assert (await first)[0] == 200
        assert {k: s.stats()[k] for k in ("in_flight", "tenants", "saturated")} == {"in_flight": 0, "tenants": 0, "saturated": 1}
    run(scenario)


# ── Cancellation, close(), event loops ──


def test_a_cancelled_caller_is_cancelled_and_its_revocation_source_keeps_the_slot():
    async def scenario():
        s = SourceSupervisor(max_in_flight=1)
        held = Held()
        middleware = DCPVerifyMiddleware(FastAPI(), require_bundle=True, trusted_principals=TRUST, profile=STRICT,
                                         revocation_source=held, revocation_timeout=5, source_supervisor=s,
                                         supervise={"revocation": True})
        caller = asyncio.ensure_future(middleware._revocation_snapshot(SUBJECTS, "t"))
        await until(lambda: held.calls == 1)
        caller.cancel()
        with pytest.raises(asyncio.CancelledError):
            await caller
        await until(lambda: held.cancelled == 1)
        assert s.stats()["in_flight"] == 1
        held.release()
        await until(lambda: s.stats()["in_flight"] == 0)
    run(scenario)


def test_close_answers_a_pending_revocation_refuses_new_ones_and_keeps_slots():
    async def scenario():
        s = SourceSupervisor(max_in_flight=2)
        held = Held()
        app = _app(held, s, timeout=5)
        pending = asyncio.ensure_future(post(app))
        await until(lambda: held.calls == 1)
        assert await s.close(drain_timeout=0.05) == {"in_flight": 1}
        assert await pending == (403, UNAVAILABLE)
        assert await post(app) == (403, UNAVAILABLE)
        assert held.calls == 1 and held.cancelled == 1
        held.release()
        await until(lambda: s.stats()["in_flight"] == 0)
    run(scenario)


def test_a_supervisor_bound_to_another_event_loop_gives_unavailable_without_calling_the_source():
    s = SourceSupervisor(max_in_flight=1)
    run(lambda: s._run("t", 5, lambda: async_trust("t")))  # binds it to that loop
    held_calls = []

    async def source(subjects, tenant):
        held_calls.append(tenant)
        return snapshot()

    assert run(lambda: post(_app(source, s))) == (403, UNAVAILABLE)
    assert held_calls == [] and s.stats()["wrong_loop"] == 1


@pytest.mark.skipif(not hasattr(asyncio, "eager_task_factory"), reason="eager tasks are Python 3.12+")
def test_an_eager_task_factory_keeps_the_same_answers_and_accounting():
    async def scenario():
        asyncio.get_running_loop().set_task_factory(asyncio.eager_task_factory)
        s = SourceSupervisor(max_in_flight=1)
        assert (await post(_app(clear, s)))[0] == 200  # the source finishes inside create_task
        assert (await post(_app(_raises_invalid, s)))[1]["codes"] == ["REVOCATION_INVALID"]
        assert s.stats()["in_flight"] == 0
    run(scenario)


# ── The legacy path, request fields, logs ──


def test_without_the_opt_in_a_synchronous_source_still_runs_in_a_worker_thread():
    async def scenario():
        main = threading.get_ident()
        threads = []

        def sync_source(subjects, tenant):
            threads.append(threading.get_ident())
            return snapshot()

        assert (await post(_app(sync_source)))[0] == 200
        # Also next to a supervised trust source: the revocation keeps its legacy path.
        both = _app(sync_source, SourceSupervisor(max_in_flight=1), trust=async_trust, supervise={"trust_timeout": 1})
        assert (await post(both))[0] == 200
        assert len(threads) == 2 and main not in threads
    run(scenario)


def test_request_fields_cannot_change_the_supervision():
    async def scenario():
        held = Held()
        status_body = await post(_app(held, SourceSupervisor(max_in_flight=1), timeout=0.05),
                                 body={"supervise": {"revocation": False}, "revocation_timeout": 60},
                                 headers={"x-dcp-supervise": '{"revocation": false}', "x-revocation-timeout": "60"})
        assert status_body == (403, UNAVAILABLE)
        assert held.cancelled_at - held.called_at < 0.05 + 0.25
    run(scenario)


class _PrivateFailure(Exception):
    code = "PRIVATE_TENANT_MARKER_42"


async def _raises_private(subjects, tenant):
    raise _PrivateFailure("private message PRIVATE_MESSAGE_MARKER_43")


def test_the_log_names_a_fixed_reason_never_the_tenant_or_what_the_source_raised(caplog):
    async def scenario():
        held = Held()
        timed_out = await post(_app(held, SourceSupervisor(max_in_flight=1), timeout=0.05), tenant="tenant-secret-42")
        failed = await post(_app(_raises_private, SourceSupervisor(max_in_flight=1)), tenant="tenant-secret-42")
        return timed_out, failed
    with caplog.at_level(logging.WARNING, logger="dcp_ai.fastapi"):
        timed_out, failed = run(scenario)
    assert timed_out == failed == (403, UNAVAILABLE)
    messages = [r.getMessage() for r in caplog.records]
    assert "DCP admission: the revocation source did not answer (timeout)" in messages
    assert "DCP admission: the revocation source did not answer (failed)" in messages
    for marker in ("tenant-secret-42", "PRIVATE_TENANT_MARKER_42", "PRIVATE_MESSAGE_MARKER_43", "_PrivateFailure"):
        assert not any(marker in m for m in messages)


# ── deny_list_revocation_source ──


class HungServer:
    """A TCP server that reads each HTTP request and never answers until close()."""

    def __init__(self):
        self.sock = socket.create_server(("127.0.0.1", 0))
        self.sock.settimeout(0.05)
        self.url = f"http://127.0.0.1:{self.sock.getsockname()[1]}/.well-known/dcp-revocations.json"
        self.conns: list[socket.socket] = []
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()
        _SERVERS.append(self)

    def _serve(self):
        while not self.stop.is_set():
            try:
                conn, _ = self.sock.accept()
            except (TimeoutError, socket.timeout):
                continue
            except OSError:
                return
            conn.settimeout(2)
            data = b""
            while b"\r\n\r\n" not in data:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                data += chunk
            self.conns.append(conn)

    def open_connections(self) -> int:
        """Connections whose client has not closed them (the request was read: EOF means closed)."""
        alive = 0
        for conn in self.conns:
            try:
                conn.setblocking(False)
                if conn.recv(1, socket.MSG_PEEK) != b"":
                    alive += 1
            except BlockingIOError:
                alive += 1
            except OSError:
                pass
        return alive

    def close(self):
        self.stop.set()
        for conn in self.conns:
            conn.close()
        self.sock.close()
        self.thread.join(2)


def test_deny_list_under_supervision_answers_at_the_deadline_but_its_worker_thread_is_not_bounded():
    # The documented limit: deny_list_revocation_source fetches in asyncio.to_thread. Cancelling its
    # Task ends the Task, and frees the slot, while the worker thread still holds the connection
    # until its own socket timeout or the server closes it.
    async def scenario():
        server = HungServer()
        s = SourceSupervisor(max_in_flight=1)
        source = deny_list_revocation_source(server.url, timeout=5)
        assert await post(_app(source, s, timeout=0.2)) == (403, UNAVAILABLE)
        await until(lambda: s.stats()["in_flight"] == 0)
        assert server.open_connections() == 1
        server.close()  # lets the worker thread finish before the loop shuts its executor down
    run(scenario)


# ── The harness ──

HARNESS_LIMIT = 15
# Imports this file, runs one scenario stuck behind asyncio.wait_for and a Held that suppresses
# CancelledError, and prints how run() ended.
_STUCK_SCENARIO = """
import asyncio, importlib.util, json, sys
spec = importlib.util.spec_from_file_location("suite", sys.argv[1])
suite = importlib.util.module_from_spec(spec)
spec.loader.exec_module(suite)
seen = {}

async def scenario():
    held = seen["held"] = suite.Held()
    await asyncio.wait_for(held(None, ""), 0.05)  # held suppresses the cancellation: wait_for waits for it

try:
    suite.run(scenario, deadline=0.5)
    outcome = {"error": None, "message": ""}
except AssertionError as exc:
    outcome = {"error": "AssertionError", "message": str(exc)}
outcome.update(released=seen["held"].release_event.is_set(), left=len(suite._HELD))
print(json.dumps(outcome))
"""


def test_the_watchdog_ends_a_scenario_stuck_behind_a_source_that_ignores_cancellation():
    # In a child process under an external limit: without the watchdog it would never end.
    try:
        child = subprocess.run([sys.executable, "-c", _STUCK_SCENARIO, __file__], capture_output=True, text=True,
                               timeout=HARNESS_LIMIT, cwd=Path(__file__).resolve().parents[1])
    except subprocess.TimeoutExpired:
        pytest.fail(f"HARNESS_TIMEOUT: the stuck scenario did not end within {HARNESS_LIMIT} s: run() has no working watchdog")
    assert child.returncode == 0, child.stderr
    outcome = json.loads(child.stdout.strip().splitlines()[-1])
    assert outcome["error"] == "AssertionError" and "ran past its 0.5 s deadline" in outcome["message"]
    assert outcome["released"] is True and outcome["left"] == 0


# ── Configuration ──


def _sync_source(subjects, tenant):
    return snapshot()


@pytest.mark.parametrize(
    "kwargs,code",
    [
        ({"supervise": {"revocation": "yes"}}, "CONFIG_INVALID_VALUE"),
        ({"supervise": {"revocation": None}}, "CONFIG_INVALID_VALUE"),
        ({"supervise": {"revocation": 1}}, "CONFIG_INVALID_VALUE"),
        ({"supervise": {}}, "CONFIG_INVALID_VALUE"),
        ({"supervise": {"revocation": False}}, "CONFIG_INVALID_VALUE"),
        ({"supervise": {"revocation": True, "queue": 1}}, "CONFIG_UNKNOWN_FIELD"),
        ({"revocation_source": None, "profile": None}, "CONFIG_PROFILE_CONTRADICTION"),  # nothing to supervise
        ({"revocation_source": _sync_source}, "CONFIG_INVALID_VALUE"),
        ({"revocation_source": functools.partial(_sync_source)}, "CONFIG_INVALID_VALUE"),
        ({"supervise": {"trust_timeout": 1, "revocation": True}}, "CONFIG_PROFILE_CONTRADICTION"),  # static trust set
        ({"source_supervisor": None}, "CONFIG_PROFILE_CONTRADICTION"),
        *[({"revocation_timeout": t}, "CONFIG_INVALID_VALUE") for t in (True, 0, -1, math.nan, math.inf, "1", 10**400, 2147483.648)],
    ],
)
def test_invalid_revocation_supervision_raises_at_construction(kwargs, code):
    base = {"require_bundle": True, "trusted_principals": TRUST, "profile": STRICT, "revocation_source": clear,
            "source_supervisor": SourceSupervisor(max_in_flight=1), "supervise": {"revocation": True}}
    with pytest.raises(AdmissionConfigError) as caught:
        DCPVerifyMiddleware(FastAPI(), **{**base, **kwargs})
    assert caught.value.code == code


@pytest.mark.parametrize(
    "kwargs",
    [
        {},  # revocation alone, with a static trust set
        {"trusted_principals": async_trust},  # revocation alone, the trust source not supervised
        {"trusted_principals": async_trust, "supervise": {"trust_timeout": 1, "revocation": True}},
        {"revocation_source": functools.partial(clear)},
        {"revocation_source": _AsyncRevocation("A_known_principal_strict")},
        {"revocation_source": functools.partial(_AsyncRevocation("A_known_principal_strict"))},
        {"revocation_source": deny_list_revocation_source("http://127.0.0.1:9/list.json")},
        {"revocation_timeout": 2147483.647},
    ],
)
def test_valid_revocation_supervision_is_accepted(kwargs):
    base = {"require_bundle": True, "trusted_principals": TRUST, "profile": STRICT, "revocation_source": clear,
            "source_supervisor": SourceSupervisor(max_in_flight=1), "supervise": {"revocation": True}}
    DCPVerifyMiddleware(FastAPI(), **{**base, **kwargs})


def test_without_the_opt_in_revocation_timeout_and_sync_sources_keep_their_rules():
    DCPVerifyMiddleware(FastAPI(), require_bundle=True, trusted_principals=TRUST, profile=STRICT,
                        revocation_source=_sync_source, revocation_timeout=10**9)
    DCPVerifyMiddleware(FastAPI(), require_bundle=True, trusted_principals=async_trust, profile=STRICT,
                        revocation_source=_sync_source, revocation_timeout=10**9,
                        source_supervisor=SourceSupervisor(max_in_flight=1), supervise={"trust_timeout": 1})
