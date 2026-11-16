"""
DenyListWorkers: a budget of real worker threads
for deny_list_revocation_source(..., workers=...), against local HTTP servers: the same answers as
without it, a slot reserved before a thread starts and held until the download really ends, no
queue, a monotonic deadline checked when the result is used, close(), closed event loops, start
failures, process exit and fork, and the FastAPI supervisor of C3. Every scenario runs in one event
loop under a watchdog that releases the servers it created, so no download outlives it, and every
child process runs under an external limit.

    DCP_NEGATIVE_CONTROL=1 pytest tests/test_deny_list_workers.py   # must fail once
"""

from __future__ import annotations

import asyncio
import copy
import gc
import json
import logging
import os
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

import dcp_ai.v2._deny_list_workers as workers_module
from dcp_ai.fastapi import DCPVerifyMiddleware, SourceSupervisor
from dcp_ai.v2 import DenyListWorkers, deny_list_revocation_source
from dcp_ai.v2.revocation_source import RevocationSourceError
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms

PACKAGE = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
VECTORS = json.loads((REPO_ROOT / "tests" / "interop" / "v2" / "admission_vectors.json").read_text())
CASE_A = next(c for c in VECTORS["cases"] if c["name"] == "A_known_principal_strict")
NOW = rfc3339_epoch_ms(CASE_A["now"])
CHECKED_AT = CASE_A["revocation"]["checked_at"]
STRICT = VECTORS["profiles"]["strict"]
TRUST = VECTORS["trust_sets"]["principal"]
SUBJECTS = {"agent_ids": list(CASE_A["revocation"]["agents"]), "kids": list(CASE_A["revocation"]["keys"])}
NEGATIVE_CONTROL = os.environ.get("DCP_NEGATIVE_CONTROL") == "1"
DEADLINE = 20.0
GRACE = 5.0
CHILD_LIMIT = 20
UNAVAILABLE = {
    "verified": True,
    "admitted": False,
    "principal_trust": "trusted",
    "profile": "strict-v1",
    "profile_compliance": "non_compliant",
    "codes": ["REVOCATION_UNAVAILABLE"],
    "errors": ["REVOCATION_UNAVAILABLE: no revocation status could be obtained"],
}


def deny_list(agents=(), kids=()) -> dict:
    return {
        "dcp_version": "2.0",
        "updated_at": CHECKED_AT,
        "revocations": [{"agent_id": a, "reason": "test"} for a in agents],
        "kid_revocations": [{"revoked_kid": k, "agent_id": "agent:acme-bot"} for k in kids],
    }


# ── Servers ──


class _ListHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 (http.server's name)
        self.server.requests += 1
        routes = {
            "/ok": (200, deny_list()),
            "/revoked": (200, deny_list(agents=SUBJECTS["agent_ids"], kids=SUBJECTS["kids"][:1])),
            "/error": (500, {"error": "unavailable"}),
            "/malformed": (200, b"<html>not json</html>"),
            "/wrong-shape": (200, {"updated_at": CHECKED_AT, "revocations": "none", "kid_revocations": []}),
            "/no-updated-at": (200, {"revocations": [], "kid_revocations": []}),
        }
        if self.path == "/big":
            self._send(200, b" " * (16 * 1024 * 1024 + 1))  # built only for this path
        elif self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/ok")
            self.end_headers()
        elif self.path == "/authenticated":
            ok = self.headers.get("Authorization") == "Bearer test-only"
            self._send(*((200, deny_list()) if ok else (401, {"error": "unauthorized"})))
        else:
            self._send(*routes.get(self.path, (404, {})))

    def _send(self, status, body):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except OSError:
            pass

    def log_message(self, *args):
        pass


@pytest.fixture(scope="module")
def list_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _ListHandler)
    server.daemon_threads = True
    server.requests = 0
    server.url = f"http://127.0.0.1:{server.server_address[1]}"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()
    server.server_close()


_SERVERS: list = []
_PARTIAL_HEAD = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 4096\r\n\r\n{\"updated_at\":"


class HungServer:
    """Reads each request and answers nothing until answer(): then "ok", "malformed" or "close", for
    the held connections and every later one. With `partial`, a held connection first gets a 200
    whose body stops halfway; with `trickle`, a status line that never ends, one byte every 20 ms, so
    no socket read times out."""

    def __init__(self, *, partial: bool = False, trickle: bool = False, register: bool = True) -> None:
        self.sock = socket.create_server(("127.0.0.1", 0))
        self.sock.settimeout(0.05)
        self.url = f"http://127.0.0.1:{self.sock.getsockname()[1]}/.well-known/dcp-revocations.json"
        self.partial = partial
        self.trickle = trickle
        self.lock = threading.Lock()
        self.held: list[socket.socket] = []
        self.connections = 0
        self.mode: str | None = None
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()
        if register:
            _SERVERS.append(self)

    def _serve(self) -> None:
        while not self.stop.is_set():
            try:
                conn, _ = self.sock.accept()
            except (TimeoutError, socket.timeout):
                continue
            except OSError:
                return
            conn.settimeout(2)
            data = b""
            try:
                while b"\r\n\r\n" not in data:
                    chunk = conn.recv(4096)
                    if not chunk:
                        break
                    data += chunk
            except OSError:
                conn.close()
                continue
            with self.lock:
                self.connections += 1
                mode = self.mode
                if mode is None:
                    if self.partial:
                        try:
                            conn.sendall(_PARTIAL_HEAD)
                        except OSError:
                            pass
                    self.held.append(conn)
                    if self.trickle:
                        threading.Thread(target=self._drip, args=(conn,), daemon=True).start()
                    continue
            self._answer(conn, mode, partial=False)

    def _drip(self, conn: socket.socket) -> None:
        while True:
            with self.lock:
                if conn not in self.held:
                    return
            try:
                conn.sendall(b"H")
            except OSError:
                return
            time.sleep(0.02)

    def answer(self, mode: str = "close") -> None:
        with self.lock:
            self.mode = mode
            held, self.held = self.held, []
        for conn in held:
            self._answer(conn, mode, partial=self.partial or self.trickle)

    @staticmethod
    def _answer(conn: socket.socket, mode: str, *, partial: bool) -> None:
        try:
            if not partial and mode in ("ok", "malformed"):
                body = json.dumps(deny_list()).encode() if mode == "ok" else b"<html>"
                head = f"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n"
                conn.sendall(head.encode() + body)
        except OSError:
            pass
        finally:
            conn.close()

    def close(self) -> None:
        self.answer("close")
        self.stop.set()
        self.sock.close()
        self.thread.join(2)


def _release_servers() -> None:
    for server in _SERVERS:
        server.answer("close")


def _live_workers() -> list[threading.Thread]:
    return [t for t in threading.enumerate() if t.name == "dcp-deny-list" and t.is_alive()]


@pytest.fixture(autouse=True)
def _no_download_outlives_a_test():
    yield
    for server in _SERVERS:
        server.close()
    _SERVERS.clear()
    for thread in _live_workers():
        thread.join(5)
    assert not _live_workers(), "a deny-list worker thread outlived its test"


# ── Harness ──


def run(scenario, deadline: float = DEADLINE):
    """
    Runs one scenario in a fresh event loop. A watchdog, a loop callback independent of the
    scenario, answers "close" on every server it registered once `deadline` passes, so a scenario
    stuck behind a download ends and the run fails with an assertion; the servers are released at
    the end in any case. The clock is checked again on return; a loop blocked by CPU delays the
    watchdog too.
    """
    expired = False

    def expire():
        nonlocal expired
        expired = True
        _release_servers()

    async def guarded():
        watchdog = asyncio.get_running_loop().call_later(deadline, expire)
        try:
            return await asyncio.wait_for(scenario(), deadline + GRACE)
        finally:
            watchdog.cancel()
            _release_servers()
            await asyncio.sleep(0.01)

    started = time.monotonic()
    try:
        return asyncio.run(guarded())
    finally:
        elapsed = time.monotonic() - started
        assert not expired and elapsed <= deadline, (
            f"the scenario ran past its {deadline} s deadline ({elapsed:.2f} s); the watchdog released its servers"
        )


async def until(check, limit: float = 5.0):
    end = time.monotonic() + limit
    while not check():
        assert time.monotonic() < end, "condition not met in time"
        await asyncio.sleep(0.005)


def wait_until(check, limit: float = 5.0):
    end = time.monotonic() + limit
    while not check():
        assert time.monotonic() < end, "condition not met in time"
        time.sleep(0.005)


async def abandoned(source, server, tenant: str = "", connections: int = 1) -> None:
    """Starts a download and cancels its call once the server holds it, as C3's supervisor does at its
    deadline: the download then runs on (its own timeout is long) and keeps its slot."""
    task = asyncio.ensure_future(source(SUBJECTS, tenant))
    await until(lambda: server.connections == connections)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


async def outcome(source, tenant: str = ""):
    try:
        return ("ok", await source(SUBJECTS, tenant))
    except RevocationSourceError as exc:
        return ("error", exc.code, str(exc))


# ── The same answers ──


def test_a_download_under_workers_answers_and_frees_its_slot(list_server):
    workers = DenyListWorkers(max_workers=1)
    with_workers = run(lambda: outcome(deny_list_revocation_source(f"{list_server.url}/ok", workers=workers)))
    without = run(lambda: outcome(deny_list_revocation_source(f"{list_server.url}/ok")))
    assert (with_workers == without) is not NEGATIVE_CONTROL  # the negative control inverts this expectation
    assert with_workers[0] == "ok"
    assert {k: workers.stats()[k] for k in ("in_flight", "tenants")} == {"in_flight": 0, "tenants": 0}


@pytest.mark.parametrize(
    "path,code",
    [("/ok", None), ("/revoked", None), ("/error", "REVOCATION_UNAVAILABLE"), ("/missing", "REVOCATION_UNAVAILABLE"),
     ("/redirect", "REVOCATION_UNAVAILABLE"), ("/authenticated", "REVOCATION_UNAVAILABLE"), ("/malformed", "REVOCATION_INVALID"),
     ("/wrong-shape", "REVOCATION_INVALID"), ("/no-updated-at", "REVOCATION_INVALID"), ("/big", "REVOCATION_INVALID")],
)
def test_the_same_answer_with_and_without_workers(list_server, path, code):
    workers = DenyListWorkers(max_workers=1)
    with_workers = run(lambda: outcome(deny_list_revocation_source(f"{list_server.url}{path}", workers=workers)))
    without = run(lambda: outcome(deny_list_revocation_source(f"{list_server.url}{path}")))
    assert with_workers == without
    assert (with_workers[1] if with_workers[0] == "error" else None) == code
    assert workers.stats()["in_flight"] == 0


def test_headers_proxy_settings_and_tls_behave_the_same(list_server, monkeypatch):
    for name in ("HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"):
        monkeypatch.setenv(name, "http://127.0.0.1:9")  # a proxy from the environment is never used
    for name in ("NO_PROXY", "no_proxy"):
        monkeypatch.delenv(name, raising=False)
    port = list_server.url.rsplit(":", 1)[1]
    cases = [
        (f"{list_server.url}/authenticated", {"Authorization": "Bearer test-only"}),
        (f"{list_server.url}/ok", None),
        (f"https://127.0.0.1:{port}/ok", None),  # TLS to a server without it
    ]
    for url, headers in cases:
        workers = DenyListWorkers(max_workers=1)
        with_workers = run(lambda: outcome(deny_list_revocation_source(url, headers=headers, workers=workers)))
        without = run(lambda: outcome(deny_list_revocation_source(url, headers=headers)))
        assert with_workers == without
    assert with_workers[:2] == ("error", "REVOCATION_UNAVAILABLE")


def test_without_workers_the_download_still_runs_in_asyncio_to_thread(list_server, monkeypatch):
    real = asyncio.to_thread
    calls = []

    async def spy(fn, *args, **kwargs):
        calls.append(fn)
        return await real(fn, *args, **kwargs)

    monkeypatch.setattr(asyncio, "to_thread", spy)
    assert run(lambda: outcome(deny_list_revocation_source(f"{list_server.url}/ok")))[0] == "ok"
    assert len(calls) == 1
    assert run(lambda: outcome(deny_list_revocation_source(f"{list_server.url}/ok", workers=DenyListWorkers(max_workers=1))))[0] == "ok"
    assert len(calls) == 1  # with workers, never the loop's default executor


@pytest.mark.parametrize(
    "args,kwargs,error",
    [
        (("http://revocations.example/list",), {}, ValueError),
        (("https://revocations.example/list",), {"timeout": 0}, ValueError),
        (("https://revocations.example/list",), {"headers": {"Authorization": 1}}, TypeError),
    ],
)
def test_configuration_refusals_are_unchanged_with_workers(args, kwargs, error):
    with pytest.raises(error) as without:
        deny_list_revocation_source(*args, **kwargs)
    with pytest.raises(error) as with_workers:
        deny_list_revocation_source(*args, **kwargs, workers=DenyListWorkers(max_workers=1))
    assert str(with_workers.value) == str(without.value)


@pytest.mark.parametrize("workers", ["4", 4, object(), {"max_workers": 4}])
def test_workers_must_be_a_budget(workers):
    with pytest.raises(TypeError):
        deny_list_revocation_source("https://revocations.example/list", workers=workers)


@pytest.mark.parametrize(
    "kwargs,error",
    [({"max_workers": 0}, ValueError), ({"max_workers": 65}, ValueError), ({"max_workers": True}, TypeError),
     ({"max_workers": 1.5}, TypeError), ({"max_workers": "2"}, TypeError), ({}, TypeError),
     ({"max_workers": 2, "max_workers_per_tenant": 3}, ValueError), ({"max_workers": 2, "max_workers_per_tenant": 0}, ValueError),
     ({"max_workers": 2, "max_workers_per_tenant": False}, TypeError)],
)
def test_invalid_budgets_are_refused(kwargs, error):
    with pytest.raises(error):
        DenyListWorkers(**kwargs)


def test_the_limits_accepted():
    for kwargs in ({"max_workers": 1}, {"max_workers": 64}, {"max_workers": 64, "max_workers_per_tenant": 64}):
        assert DenyListWorkers(**kwargs).stats()["open"] is True


# ── Capacity ──


def test_call_n_plus_1_is_refused_at_once_without_a_connection():
    async def scenario():
        server = HungServer()
        workers = DenyListWorkers(max_workers=2)
        source = deny_list_revocation_source(server.url, timeout=5, workers=workers)
        await abandoned(source, server)
        await abandoned(source, server, connections=2)
        assert workers.stats()["in_flight"] == 2  # both calls are gone; both downloads still run
        refused = await outcome(source)
        assert refused[:2] == ("error", "REVOCATION_UNAVAILABLE") and "no free worker" in refused[2]
        await asyncio.sleep(0.05)
        assert server.connections == 2 and workers.stats()["saturated"] == 1
        server.answer("ok")
        # A thread frees its slot before its result reaches the loop, where it is counted as late:
        # wait for both, bounded by until().
        await until(lambda: workers.stats()["in_flight"] == 0 and workers.stats()["late_results"] == 2)
        assert workers.stats()["late_results"] == 2
        assert (await outcome(source))[0] == "ok"
    run(scenario)


def test_per_tenant_limit_and_one_budget_shared_by_two_sources(list_server):
    async def scenario():
        server = HungServer()
        workers = DenyListWorkers(max_workers=3, max_workers_per_tenant=1)
        hung = deny_list_revocation_source(server.url, timeout=5, workers=workers)
        ok = deny_list_revocation_source(f"{list_server.url}/ok", workers=workers)
        first = asyncio.ensure_future(outcome(hung, "tenant-a"))
        await until(lambda: server.connections == 1)
        refused = await outcome(ok, "tenant-a")
        assert refused[:2] == ("error", "REVOCATION_UNAVAILABLE") and "no free worker" in refused[2]
        assert (await outcome(ok, "tenant-b"))[0] == "ok"
        server.answer("ok")
        assert (await first)[0] == "ok"
        assert {k: workers.stats()[k] for k in ("in_flight", "tenants", "saturated")} == {"in_flight": 0, "tenants": 0, "saturated": 1}
    run(scenario)


def test_the_same_thread_stays_counted_after_its_task_is_cancelled():
    async def scenario():
        server = HungServer()
        workers = DenyListWorkers(max_workers=1)
        task = asyncio.ensure_future(deny_list_revocation_source(server.url, timeout=5, workers=workers)(SUBJECTS, "t"))
        await until(lambda: server.connections == 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        threads = _live_workers()
        assert len(threads) == 1 and threads[0].daemon is False
        assert workers.stats()["in_flight"] == 1
        server.answer("close")
        await until(lambda: not threads[0].is_alive())
        assert workers.stats()["in_flight"] == 0
    run(scenario)


def test_a_body_that_stops_halfway_keeps_its_slot_until_the_connection_ends():
    async def scenario():
        server = HungServer(partial=True)
        workers = DenyListWorkers(max_workers=1)
        await abandoned(deny_list_revocation_source(server.url, timeout=5, workers=workers), server)
        assert workers.stats()["in_flight"] == 1
        server.answer("close")
        await until(lambda: workers.stats()["in_flight"] == 0)
    run(scenario)


def test_a_status_line_that_trickles_in_keeps_a_worker_past_its_timeout_and_its_slot_with_it():
    # The documented limit: `timeout` bounds each socket read, not a status line that never ends.
    async def scenario():
        server = HungServer(trickle=True)
        workers = DenyListWorkers(max_workers=1)
        result = await outcome(deny_list_revocation_source(server.url, timeout=0.2, workers=workers))
        assert result[:2] == ("error", "REVOCATION_UNAVAILABLE") and "timed out" in result[2]
        await asyncio.sleep(0.5)  # well past the timeout: the worker still reads, and is still counted
        assert workers.stats()["in_flight"] == 1 and len(_live_workers()) == 1
        refused = await outcome(deny_list_revocation_source(server.url, timeout=0.2, workers=workers))
        assert "no free worker" in refused[2] and server.connections == 1
        server.answer("close")
        await until(lambda: workers.stats()["in_flight"] == 0)
    run(scenario)


# ── The deadline ──


@pytest.mark.parametrize("path", ["/ok", "/malformed", "/error"])
def test_a_result_used_after_the_deadline_is_refused(list_server, path):
    async def scenario():
        workers = DenyListWorkers(max_workers=1)
        original = workers._settle

        def settle_then_block(waiter, result):
            original(waiter, result)
            time.sleep(0.3)  # the result arrived in time; the loop is then blocked before the call uses it

        workers._settle = settle_then_block
        result = await outcome(deny_list_revocation_source(f"{list_server.url}{path}", timeout=0.2, workers=workers))
        assert result[:2] == ("error", "REVOCATION_UNAVAILABLE") and "timed out" in result[2]
        assert workers.stats()["late_results"] == 1 and workers.stats()["in_flight"] == 0
    run(scenario)


def test_a_result_that_arrives_while_the_loop_is_blocked_is_refused(list_server):
    async def scenario():
        workers = DenyListWorkers(max_workers=1)
        task = asyncio.ensure_future(outcome(deny_list_revocation_source(f"{list_server.url}/ok", timeout=0.1, workers=workers)))
        await asyncio.sleep(0)  # the call reserves and starts its thread
        time.sleep(0.3)  # the download ends while the loop is blocked past the deadline
        assert (await task)[:2] == ("error", "REVOCATION_UNAVAILABLE")
        assert workers.stats()["in_flight"] == 0
    run(scenario)


# ── Starting, preparing, closing ──


@pytest.mark.parametrize("stage", ["init", "start"])
def test_a_thread_that_cannot_be_created_or_started_holds_and_runs_nothing(list_server, monkeypatch, stage):
    real_init, real_start = threading.Thread.__init__, threading.Thread.start

    def failing_init(self, *args, **kwargs):
        if kwargs.get("name") == "dcp-deny-list":
            raise RuntimeError("cannot create a thread")
        real_init(self, *args, **kwargs)

    def failing_start(self):
        if self.name == "dcp-deny-list":
            raise RuntimeError("can't start new thread")
        return real_start(self)

    monkeypatch.setattr(threading.Thread, "__init__" if stage == "init" else "start", failing_init if stage == "init" else failing_start)
    workers = DenyListWorkers(max_workers=1)
    before = list_server.requests
    result = run(lambda: outcome(deny_list_revocation_source(f"{list_server.url}/ok", workers=workers)))
    assert result[:2] == ("error", "REVOCATION_UNAVAILABLE") and "worker not started" in result[2]
    assert {k: workers.stats()[k] for k in ("in_flight", "tenants", "start_failed")} == {"in_flight": 0, "tenants": 0, "start_failed": 1}
    assert list_server.requests == before
    monkeypatch.undo()
    assert run(lambda: outcome(deny_list_revocation_source(f"{list_server.url}/ok", workers=workers)))[0] == "ok"


def test_a_start_that_raises_after_the_thread_began_frees_the_slot_once(monkeypatch):
    server = HungServer()
    real_start = threading.Thread.start

    def started_then_raises(self):
        real_start(self)
        if self.name == "dcp-deny-list":
            wait_until(lambda: server.connections == 1)  # the thread owns its slot: its download has begun
            raise RuntimeError("interrupted after the thread started")

    monkeypatch.setattr(threading.Thread, "start", started_then_raises)
    workers = DenyListWorkers(max_workers=1)

    async def scenario():
        result = await outcome(deny_list_revocation_source(server.url, timeout=5, workers=workers))
        assert result[:2] == ("error", "REVOCATION_UNAVAILABLE") and "worker not started" in result[2]
        assert {k: workers.stats()[k] for k in ("in_flight", "start_failed")} == {"in_flight": 1, "start_failed": 1}
        server.answer("close")
        await until(lambda: not _live_workers())
        assert workers.stats()["in_flight"] == 0 and server.connections == 1
    run(scenario)


def test_a_thread_that_starts_after_its_call_gave_up_runs_nothing():
    async def scenario():
        workers = DenyListWorkers(max_workers=1)
        slot = workers_module._Slot("t")
        slot.abandoned = True
        calls = []
        loop = asyncio.get_running_loop()
        workers._work(slot, lambda: calls.append(1) or b"", loop, loop.create_future())
        assert calls == [] and slot.released is False and workers.stats()["in_flight"] == 0
    run(scenario)


def test_a_reservation_that_fails_while_it_is_prepared_holds_nothing_and_the_budget_recovers(list_server, monkeypatch):
    workers = DenyListWorkers(max_workers=1)
    source = deny_list_revocation_source(f"{list_server.url}/ok", workers=workers)

    def no_slot(tenant):
        raise RuntimeError("no slot")

    monkeypatch.setattr(workers_module, "_Slot", no_slot)
    assert run(lambda: outcome(source))[:2] == ("error", "REVOCATION_UNAVAILABLE")
    assert {k: workers.stats()[k] for k in ("in_flight", "tenants")} == {"in_flight": 0, "tenants": 0}
    monkeypatch.undo()

    class FailsOnce(dict):
        failed = False

        def __setitem__(self, key, value):
            if not FailsOnce.failed:
                FailsOnce.failed = True
                raise MemoryError("tenant map")
            super().__setitem__(key, value)

    workers._tenants = FailsOnce()
    # An Exception like any other there: the source maps it to REVOCATION_UNAVAILABLE, as it always has.
    result = run(lambda: outcome(source, "t"))
    assert result[:2] == ("error", "REVOCATION_UNAVAILABLE") and "MemoryError" in result[2]
    assert {k: workers.stats()[k] for k in ("in_flight", "tenants")} == {"in_flight": 0, "tenants": 0}
    assert run(lambda: outcome(source))[0] == "ok"
    assert workers.stats()["in_flight"] == 0


def test_close_refuses_new_downloads_and_neither_waits_for_nor_stops_running_ones(list_server):
    async def scenario():
        server = HungServer()
        workers = DenyListWorkers(max_workers=2)
        running = asyncio.ensure_future(outcome(deny_list_revocation_source(server.url, timeout=5, workers=workers)))
        await until(lambda: server.connections == 1)
        assert workers.close() == {"in_flight": 1}
        assert not running.done()  # close() returned without waiting for it, and did not stop it
        before = list_server.requests
        refused = await outcome(deny_list_revocation_source(f"{list_server.url}/ok", workers=workers))
        assert refused[:2] == ("error", "REVOCATION_UNAVAILABLE") and "workers closed" in refused[2]
        assert list_server.requests == before
        server.answer("ok")
        assert (await running)[0] == "ok"
        assert {k: workers.stats()[k] for k in ("open", "in_flight", "closed")} == {"open": False, "in_flight": 0, "closed": 1}
        assert workers.close() == {"in_flight": 0}
    run(scenario)


# ── Event loops ──


@pytest.mark.parametrize("answer", ["ok", "close"], ids=["late_success", "late_failure"])
def test_a_download_that_ends_after_its_loop_closed_is_dropped_quietly(monkeypatch, caplog, answer):
    hooks = []
    monkeypatch.setattr(threading, "excepthook", hooks.append)
    server = HungServer(register=False)
    workers = DenyListWorkers(max_workers=1)
    try:
        with caplog.at_level(logging.WARNING):
            run(lambda: abandoned(deny_list_revocation_source(server.url, timeout=5, workers=workers), server))
            assert workers.stats()["in_flight"] == 1  # its loop is closed now; the download still runs
            server.answer(answer)
            wait_until(lambda: workers.stats()["in_flight"] == 0 and workers.stats()["dropped"] == 1)
            for thread in _live_workers():
                thread.join(5)
            gc.collect()
    finally:
        server.close()
    assert hooks == [] and caplog.records == []


def test_a_loop_that_closes_between_the_check_and_the_call_counts_as_dropped(monkeypatch):
    hooks = []
    monkeypatch.setattr(threading, "excepthook", hooks.append)

    async def scenario():
        loop = asyncio.get_running_loop()
        server = HungServer()
        workers = DenyListWorkers(max_workers=1)
        await abandoned(deny_list_revocation_source(server.url, timeout=5, workers=workers), server)

        def closed(*args, **kwargs):
            raise RuntimeError("Event loop is closed")

        loop.call_soon_threadsafe = closed  # as if the loop closed right after is_closed() said no
        try:
            server.answer("ok")
            await until(lambda: workers.stats()["dropped"] == 1)
        finally:
            del loop.call_soon_threadsafe
        assert workers.stats()["in_flight"] == 0
    run(scenario)
    assert hooks == []


@pytest.mark.parametrize("answer", ["ok", "close"], ids=["result", "failure"])
def test_a_call_cancelled_right_after_its_result_arrives_leaves_nothing_unretrieved(caplog, answer):
    async def scenario():
        server = HungServer()
        workers = DenyListWorkers(max_workers=1)
        task = asyncio.ensure_future(deny_list_revocation_source(server.url, timeout=5, workers=workers)(SUBJECTS, ""))
        original = workers._settle

        def settle_then_cancel(waiter, result):
            original(waiter, result)
            task.cancel()  # after the result is set, before the call uses it

        workers._settle = settle_then_cancel
        await until(lambda: server.connections == 1)
        server.answer(answer)
        with pytest.raises(asyncio.CancelledError):
            await task
        assert workers.stats()["in_flight"] == 0

    with caplog.at_level(logging.ERROR):
        run(scenario)
        gc.collect()
    assert not [r for r in caplog.records if "never retrieved" in r.getMessage()]


def test_a_failure_whose_result_is_never_used_leaves_no_exception_unretrieved(caplog):
    # The loop stops right after the result is handed over and never runs again, so the call never
    # wakes to read it: only a result set as a value (never set_exception) leaves nothing unretrieved.
    server = HungServer(register=False)
    workers = DenyListWorkers(max_workers=1)
    loop = asyncio.new_event_loop()
    try:
        task = loop.create_task(deny_list_revocation_source(server.url, timeout=5, workers=workers)(SUBJECTS, ""))
        original = workers._settle

        def settle_then_stop(waiter, result):
            original(waiter, result)
            loop.stop()

        def answer_once_connected():
            if server.connections:
                server.answer("close")  # the download fails
            else:
                loop.call_later(0.01, answer_once_connected)

        workers._settle = settle_then_stop
        loop.call_soon(answer_once_connected)
        watchdog = loop.call_later(DEADLINE, loop.stop)
        loop.run_forever()
        watchdog.cancel()
        assert workers.stats()["in_flight"] == 0 and not task.done()
    finally:
        server.close()
        with caplog.at_level(logging.ERROR):
            loop.close()
            del task
            gc.collect()
    assert not [r for r in caplog.records if "never retrieved" in r.getMessage()]


# ── With the FastAPI supervisor (C3) ──


async def post(app: FastAPI):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.post("/action", json={"signed_bundle": copy.deepcopy(VECTORS["signed_bundles"]["base"])})
        return response.status_code, response.json()


def test_under_the_fastapi_supervisor_the_worker_keeps_its_slot_after_the_task_ends():
    async def scenario():
        server = HungServer()
        workers = DenyListWorkers(max_workers=1)
        supervisor = SourceSupervisor(max_in_flight=4)
        app = FastAPI()
        app.add_middleware(DCPVerifyMiddleware, require_bundle=True, clock=lambda: NOW, trusted_principals=TRUST, profile=STRICT,
                           revocation_source=deny_list_revocation_source(server.url, timeout=5, workers=workers),
                           revocation_timeout=0.2, source_supervisor=supervisor, supervise={"revocation": True})

        @app.post("/action")
        async def action():
            return {"reached": True}

        assert await post(app) == (403, UNAVAILABLE)
        await until(lambda: supervisor.stats()["in_flight"] == 0)  # the supervisor's Task has ended
        assert workers.stats()["in_flight"] == 1 and len(_live_workers()) == 1  # its thread is still counted
        assert await post(app) == (403, UNAVAILABLE)  # no free worker: refused without a connection
        assert server.connections == 1 and workers.stats()["saturated"] == 1
        server.answer("ok")
        await until(lambda: workers.stats()["in_flight"] == 0)
        assert (await post(app))[0] == 200
    run(scenario)


# ── Processes ──

_EXIT_CHILD = """
import asyncio, sys
from dcp_ai.v2 import DenyListWorkers, deny_list_revocation_source
workers = DenyListWorkers(max_workers=1)
source = deny_list_revocation_source(sys.argv[1], timeout=30, workers=workers)
try:
    # The call gives up after 0.1 s; the download, with its own 30 s timeout, runs on.
    asyncio.run(asyncio.wait_for(source({"agent_ids": [], "kids": []}, ""), 0.1))
except BaseException as exc:
    print("call", type(exc).__name__, flush=True)
print("closed", workers.close()["in_flight"], flush=True)
# main ends here: the interpreter now waits for the download's thread
"""


def test_process_exit_waits_for_a_download_still_running():
    server = HungServer(register=False)
    child = subprocess.Popen([sys.executable, "-c", _EXIT_CHILD, server.url], cwd=PACKAGE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
    lines: list[str] = []
    reader = threading.Thread(target=lambda: lines.extend(child.stdout.readline().strip() for _ in range(2)), daemon=True)
    try:
        reader.start()
        reader.join(CHILD_LIMIT)
        assert lines == ["call TimeoutError", "closed 1"], child.stderr.read() if child.poll() is not None else lines
        time.sleep(0.3)
        assert child.poll() is None  # still alive: its non-daemon worker holds the exit
        server.answer("close")
        try:
            assert child.wait(timeout=CHILD_LIMIT) == 0
        except subprocess.TimeoutExpired:
            pytest.fail(f"CHILD_TIMEOUT: the child did not exit within {CHILD_LIMIT} s after its download ended")
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
        server.close()


_FORK_CHILD = """
import asyncio, json, os, signal, sys, threading
from dcp_ai.v2 import DenyListWorkers, deny_list_revocation_source
workers = DenyListWorkers(max_workers=1)
held, release = threading.Event(), threading.Event()

def hold():
    with workers._lock:  # the parent's lock is taken when the process forks
        held.set()
        release.wait(30)

holder = threading.Thread(target=hold)
holder.start()
held.wait(5)
read, write = os.pipe()
pid = os.fork()
if pid == 0:
    signal.alarm(8)  # a child stuck on the inherited lock dies instead of hanging
    out = {}
    for name in ("stats", "close"):
        try:
            getattr(workers, name)()
            out[name] = "returned"
        except RuntimeError as exc:
            out[name] = str(exc)
    source = deny_list_revocation_source("http://127.0.0.1:9/list", timeout=1, workers=workers)
    try:
        asyncio.run(source({"agent_ids": [], "kids": []}, ""))
        out["source"] = "returned"
    except Exception as exc:
        out["source"] = getattr(exc, "code", type(exc).__name__)
    os.write(write, json.dumps(out).encode())
    os._exit(0)
os.close(write)
_, status = os.waitpid(pid, 0)
child = os.read(read, 65536).decode()
release.set()
holder.join()
print(json.dumps({"status": status, "child": json.loads(child) if child else None, "parent": workers.stats()}))
"""


@pytest.mark.skipif(not hasattr(os, "fork"), reason="needs os.fork")
def test_a_forked_child_never_takes_the_parents_lock():
    try:
        done = subprocess.run([sys.executable, "-c", _FORK_CHILD], cwd=PACKAGE, capture_output=True, text=True, timeout=CHILD_LIMIT)
    except subprocess.TimeoutExpired:
        pytest.fail(f"CHILD_TIMEOUT: the fork check did not end within {CHILD_LIMIT} s")
    assert done.returncode == 0, done.stderr
    report = json.loads(done.stdout.strip().splitlines()[-1])
    message = "this DenyListWorkers was created in another process: create one in each process"
    assert report["status"] == 0
    assert report["child"] == {"stats": message, "close": message, "source": "REVOCATION_UNAVAILABLE"}
    assert report["parent"]["open"] is True and report["parent"]["in_flight"] == 0  # the child changed nothing here


def test_another_process_is_refused_without_the_lock_or_a_counter(monkeypatch):
    workers = DenyListWorkers(max_workers=1)
    monkeypatch.setattr(workers_module.os, "getpid", lambda: -1)
    for method in (workers.stats, workers.close):
        with pytest.raises(RuntimeError, match="created in another process"):
            method()
    result = run(lambda: outcome(deny_list_revocation_source("http://127.0.0.1:9/list", timeout=1, workers=workers)))
    assert result[:2] == ("error", "REVOCATION_UNAVAILABLE") and "another process" in result[2]
    monkeypatch.undo()
    assert workers.stats() == {"open": True, "in_flight": 0, "tenants": 0, "saturated": 0, "closed": 0,
                               "start_failed": 0, "late_results": 0, "dropped": 0}


# ── What is reported ──


def test_counters_messages_and_logs_carry_no_url_tenant_or_header(caplog):
    async def scenario():
        server = HungServer(trickle=True)
        workers = DenyListWorkers(max_workers=1)
        url = server.url.replace("/.well-known/", "/PATH-MARKER/")
        options = {"headers": {"Authorization": "Bearer HEADER-MARKER"}, "workers": workers}
        source = deny_list_revocation_source(url, timeout=0.05, **options)
        seen = [await outcome(source, "TENANT-MARKER"), await outcome(source, "TENANT-MARKER")]  # its worker trickles on
        workers.close()
        seen.append(await outcome(source, "TENANT-MARKER"))
        seen.append(workers.stats())
        server.answer("close")
        await until(lambda: workers.stats()["in_flight"] == 0)
        return seen

    with caplog.at_level(logging.DEBUG):
        seen = run(scenario)
    text = json.dumps(seen) + " ".join(r.getMessage() for r in caplog.records)
    assert [s[2].split("(")[1] for s in seen[:3]] == ["timed out)", "no free worker)", "workers closed)"]
    for marker in ("PATH-MARKER", "HEADER-MARKER", "TENANT-MARKER", "127.0.0.1"):
        assert marker not in text


# ── The harness ──

_STUCK = """
import asyncio, importlib.util, json, sys
spec = importlib.util.spec_from_file_location("suite", sys.argv[1])
suite = importlib.util.module_from_spec(spec)
spec.loader.exec_module(suite)
server = suite.HungServer()
workers = suite.DenyListWorkers(max_workers=1)

async def scenario():
    await suite.deny_list_revocation_source(server.url, timeout=60, workers=workers)({"agent_ids": [], "kids": []}, "")

try:
    suite.run(scenario, deadline=0.5)
    outcome = {"error": None, "message": ""}
except AssertionError as exc:
    outcome = {"error": "AssertionError", "message": str(exc)}
outcome["in_flight"] = workers.stats()["in_flight"]
for server in suite._SERVERS:
    server.close()
print(json.dumps(outcome))
"""


def test_the_watchdog_ends_a_scenario_stuck_behind_a_download():
    # In a child process under an external limit: without the watchdog it would never end.
    try:
        child = subprocess.run([sys.executable, "-c", _STUCK, __file__], cwd=PACKAGE, capture_output=True, text=True, timeout=CHILD_LIMIT)
    except subprocess.TimeoutExpired:
        pytest.fail(f"HARNESS_TIMEOUT: the stuck scenario did not end within {CHILD_LIMIT} s: run() has no working watchdog")
    assert child.returncode == 0, child.stderr
    result = json.loads(child.stdout.strip().splitlines()[-1])
    assert result["error"] == "AssertionError" and "ran past its 0.5 s deadline" in result["message"]
    assert result["in_flight"] == 0
