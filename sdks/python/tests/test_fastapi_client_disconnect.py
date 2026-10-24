"""
DCPVerifyMiddleware(cancel_on_disconnect=True) (docs/reviews/client-disconnect-plan.md 1.1): the
receive channel with one reader at a time, through scripted ASGI clients (which can leave at a
chosen moment, and like uvicorn send http.disconnect once a response is complete) and through a
real uvicorn server on loopback with sockets that close. A client that leaves during admission
cancels its supervised invocation, whose slot stays taken until the source really ends, and gets
nothing; a healthy request is untouched, its body exact. Every scenario runs in one event loop
under a watchdog that releases its sources and servers.

    DCP_NEGATIVE_CONTROL=1 pytest tests/test_fastapi_client_disconnect.py   # must fail once
"""

from __future__ import annotations

import asyncio
import copy
import functools
import gc
import hashlib
import json
import logging
import os
import socket
import threading
import time
import warnings
from pathlib import Path

import pytest
import starlette
import uvicorn
from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware

from dcp_ai.fastapi import DCPVerifyMiddleware, SourceSupervisor, _ReceiveChannel
from dcp_ai.v2 import AdmissionConfigError, DenyListWorkers, deny_list_revocation_source
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms

REPO_ROOT = Path(__file__).resolve().parents[3]
VECTORS = json.loads((REPO_ROOT / "tests" / "interop" / "v2" / "admission_vectors.json").read_text())
CASE_A = next(c for c in VECTORS["cases"] if c["name"] == "A_known_principal_strict")
NOW = rfc3339_epoch_ms(CASE_A["now"])
STRICT = VECTORS["profiles"]["strict"]
TRUST = VECTORS["trust_sets"]["principal"]
NEGATIVE_CONTROL = os.environ.get("DCP_NEGATIVE_CONTROL") == "1"
DEADLINE = 20.0
GRACE = 5.0
BODY = json.dumps({"signed_bundle": VECTORS["signed_bundles"]["base"]}).encode()
TRUST_UNAVAILABLE = {"verified": False, "admitted": False, "errors": ["The principal trust set is unavailable"]}


def snapshot() -> dict:
    return copy.deepcopy(CASE_A["revocation"])


# ── Harness ──

_HELD: list = []
_SERVERS: list = []
_LISTS: list = []


def _release_fixtures() -> None:
    for held in _HELD:
        held.release()
    for hung in _LISTS:
        hung.answer()
    for server in _SERVERS:
        server.should_exit = True


def run(scenario, deadline: float = DEADLINE):
    """One scenario in a fresh event loop. A watchdog releases every Held source and asks every
    uvicorn server to exit once `deadline` passes, so a stuck scenario ends and fails with an
    assertion; they are released at the end in any case."""
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
            _HELD.clear()
            _SERVERS.clear()
            for hung in _LISTS:
                hung.close()
            _LISTS.clear()
            await asyncio.sleep(0.01)

    started = time.monotonic()
    try:
        return asyncio.run(guarded())
    finally:
        elapsed = time.monotonic() - started
        assert not expired and elapsed <= deadline, f"the scenario ran past its {deadline} s deadline ({elapsed:.2f} s)"


async def until(check, limit: float = 5.0):
    end = time.monotonic() + limit
    while not check():
        assert time.monotonic() < end, "condition not met in time"
        await asyncio.sleep(0.005)


class Held:
    """A source that waits for release(), ignoring cancellation, then returns `value`."""

    def __init__(self, value):
        self.release_event = asyncio.Event()
        self.value = value
        self.calls = 0
        self.cancelled = 0
        _HELD.append(self)

    async def __call__(self, *args):
        self.calls += 1
        while True:
            try:
                await self.release_event.wait()
                break
            except asyncio.CancelledError:
                self.cancelled += 1
        return self.value

    def release(self):
        self.release_event.set()


class Client:
    """A scripted ASGI client: the body in `chunks`, then http.disconnect once it leaves or, as
    uvicorn does, once the response is complete. It records every message it hands over, every
    message it is sent, and how many receive() calls overlapped."""

    def __init__(self, chunks: list[bytes] | None = None, *, tenant: str = "", headers: list | None = None):
        chunks = [BODY] if chunks is None else chunks
        self.messages = [{"type": "http.request", "body": c, "more_body": i < len(chunks) - 1} for i, c in enumerate(chunks)]
        size = sum(len(c) for c in chunks)
        self.headers = headers if headers is not None else [(b"content-type", b"application/json"), (b"content-length", str(size).encode())]
        self.headers = self.headers + [(b"x-tenant", tenant.encode())]
        self.wake = asyncio.Event()
        self.gone = False
        self.delivered: list = []
        self.sent: list = []
        self.active = 0
        self.overlap = 0

    def scope(self) -> dict:
        return {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "scheme": "http",
                "path": "/action", "raw_path": b"/action", "query_string": b"", "root_path": "", "headers": self.headers,
                "client": ("127.0.0.1", 1), "server": ("127.0.0.1", 80)}

    async def receive(self):
        self.active += 1
        self.overlap = max(self.overlap, self.active)
        try:
            if self.messages:
                message = self.messages.pop(0)
            else:
                await self.wake.wait()
                message = {"type": "http.disconnect"}
            self.delivered.append(message)
            return message
        finally:
            self.active -= 1

    async def send(self, message):
        self.sent.append(message)
        if message["type"] == "http.response.body" and not message.get("more_body", False):
            self.wake.set()

    def leave(self):
        self.gone = True
        self.wake.set()

    def status(self):
        starts = [m for m in self.sent if m["type"] == "http.response.start"]
        return starts[0]["status"] if starts else None

    def json(self):
        return json.loads(b"".join(m.get("body", b"") for m in self.sent if m["type"] == "http.response.body"))


def build(*, trust=TRUST, supervisor=None, supervise=None, reached=None, **extra) -> FastAPI:
    app = FastAPI()
    options = {"require_bundle": True, "clock": lambda: NOW, "trusted_principals": trust, "max_body_bytes": 1 << 20,
               "tenant": lambda request: request.headers.get("x-tenant", ""), "cancel_on_disconnect": True, **extra}
    if supervisor is not None:
        options.update(source_supervisor=supervisor, supervise=supervise or {"trust_timeout": 5})
    app.add_middleware(DCPVerifyMiddleware, **options)

    @app.post("/action")
    async def action(request: Request):
        body = await request.body()
        if reached is not None:
            reached.append({"sha256": hashlib.sha256(body).hexdigest(), "disconnected": await request.is_disconnected()})
        return {"reached": True}

    return app


def call(app, client: Client) -> asyncio.Task:
    return asyncio.ensure_future(app(client.scope(), client.receive, client.send))


# ── The channel ──


class Raw:
    """A raw receive: hands out queued messages, waits otherwise; can be made to fail."""

    def __init__(self, messages):
        self.messages = list(messages)
        self.ready = asyncio.Event()
        self.calls = 0
        self.active = 0
        self.overlap = 0
        self.fail_next = False

    async def __call__(self):
        self.calls += 1
        self.active += 1
        self.overlap = max(self.overlap, self.active)
        try:
            while not self.messages:
                await self.ready.wait()
                self.ready.clear()
            if self.fail_next:
                self.fail_next = False
                raise RuntimeError("receive failed")
            return self.messages.pop(0)
        finally:
            self.active -= 1

    def push(self, message):
        self.messages.append(message)
        self.ready.set()


def test_two_readers_take_one_read_each_in_order():
    async def scenario():
        raw = Raw([])
        channel = _ReceiveChannel(raw)
        first, second = asyncio.ensure_future(channel()), asyncio.ensure_future(channel())
        await asyncio.sleep(0.01)
        raw.push({"n": 1})
        raw.push({"n": 2})
        assert [await first, await second] == [{"n": 1}, {"n": 2}]
        assert raw.calls == 2 and raw.overlap == 1
    run(scenario, deadline=5)


def test_a_reader_cancelled_with_its_message_ready_leaves_it_to_the_next_reader():
    async def scenario():
        raw = Raw([])
        channel = _ReceiveChannel(raw)
        reader = asyncio.ensure_future(channel())
        await asyncio.sleep(0.01)
        raw.push({"n": 1})
        reader.cancel()  # in the same turn as the message arrives, before the reader can resume
        with pytest.raises(asyncio.CancelledError):
            await reader
        assert await channel() == {"n": 1}
        raw.push({"n": 2})
        assert await channel() == {"n": 2}
        assert raw.calls == 2
    run(scenario, deadline=5)


def test_a_failed_receive_reaches_one_reader_once_and_the_next_read_is_fresh():
    async def scenario():
        raw = Raw([])
        raw.fail_next = True
        channel = _ReceiveChannel(raw)
        first, second = asyncio.ensure_future(channel()), asyncio.ensure_future(channel())
        await asyncio.sleep(0.01)
        raw.push({"n": 1})
        with pytest.raises(RuntimeError, match="receive failed"):
            await first
        raw.push({"n": 2})
        assert await second in ({"n": 1}, {"n": 2})
        assert raw.calls == 2
    run(scenario, deadline=5)


def test_watch_observes_the_read_the_next_reader_takes_and_close_cleans_up(caplog):
    async def scenario():
        raw = Raw([])
        channel = _ReceiveChannel(raw)
        watched = channel.watch()
        raw.push({"n": 1})
        await asyncio.sleep(0.01)
        assert watched.done() and raw.calls == 1
        assert await channel() == {"n": 1}  # the same read, handed over
        pending = channel.watch()  # a read nobody takes
        channel.close()
        await asyncio.sleep(0.01)
        assert pending.cancelled()
        late = Raw([])
        late_channel = _ReceiveChannel(late)
        never = late_channel.watch()
        late_channel.close()
        await asyncio.sleep(0.01)
        assert never.cancelled()

    with caplog.at_level(logging.ERROR):
        run(scenario, deadline=5)
        gc.collect()
    assert not [r for r in caplog.records if "never retrieved" in r.getMessage() or "destroyed" in r.getMessage()]


# ── Healthy requests ──


def test_a_healthy_request_reaches_the_route_with_its_exact_body_and_no_false_disconnect():
    async def scenario():
        reached: list = []
        held = SourceSupervisor(max_in_flight=1)
        app = build(trust=_async_trust, supervisor=held, reached=reached)
        chunks = [BODY[:100], BODY[100:5000], BODY[5000:]]
        client = Client(chunks)
        await call(app, client)
        assert (client.status() == 200) is not NEGATIVE_CONTROL  # the negative control inverts this expectation
        assert reached == [{"sha256": hashlib.sha256(BODY).hexdigest(), "disconnected": False}]
        bodies = [m for m in client.delivered if m["type"] == "http.request"]
        assert [m["body"] for m in bodies] == chunks  # each chunk read once, in order
        assert client.overlap == 1
        assert held.stats()["in_flight"] == 0
    run(scenario)


async def _async_trust(tenant):
    return TRUST


def test_the_disconnect_a_server_sends_after_the_response_is_not_a_client_that_left(caplog):
    async def scenario():
        reached: list = []
        app = build(trust=_async_trust, supervisor=SourceSupervisor(max_in_flight=1), reached=reached)
        client = Client()
        await call(app, client)
        assert client.status() == 200 and len(reached) == 1
        await asyncio.sleep(0.01)
        assert [t for t in asyncio.all_tasks() if t is not asyncio.current_task()] == []

    with caplog.at_level(logging.WARNING):
        run(scenario)
        gc.collect()
    assert caplog.records == []


# ── A client that leaves ──


def test_a_client_that_leaves_during_the_trust_source_gets_nothing_and_its_slot_stays_taken():
    async def scenario():
        held = Held(TRUST)
        supervisor = SourceSupervisor(max_in_flight=1)
        reached: list = []
        app = build(trust=held, supervisor=supervisor, reached=reached)
        client = Client()
        request = call(app, client)
        await until(lambda: held.calls == 1)
        client.leave()
        await asyncio.wait_for(request, 5)
        assert client.sent == [] and reached == []
        assert held.cancelled >= 1 and supervisor.stats()["in_flight"] == 1
        other = Client()
        await call(app, other)
        assert other.status() == 503 and other.json() == TRUST_UNAVAILABLE and held.calls == 1
        held.release()
        await until(lambda: supervisor.stats()["in_flight"] == 0)
        after = Client()
        await call(app, after)
        assert after.status() == 200
    run(scenario)


def test_another_tenant_is_admitted_while_the_slot_is_held():
    async def scenario():
        held = Held(TRUST)

        async def trust(tenant):
            return await held() if tenant == "a" else TRUST

        supervisor = SourceSupervisor(max_in_flight=2, max_in_flight_per_tenant=1)
        app = build(trust=trust, supervisor=supervisor)
        client = Client(tenant="a")
        request = call(app, client)
        await until(lambda: held.calls == 1)
        client.leave()
        await asyncio.wait_for(request, 5)
        again, other = Client(tenant="a"), Client(tenant="b")
        await call(app, again)
        await call(app, other)
        assert (again.status(), other.status()) == (503, 200)
        held.release()
        await until(lambda: supervisor.stats()["in_flight"] == 0)
    run(scenario)


def test_a_client_that_leaves_during_the_revocation_source_gets_nothing():
    async def scenario():
        held = Held(snapshot())
        supervisor = SourceSupervisor(max_in_flight=1)
        app = build(supervisor=supervisor, supervise={"revocation": True}, profile=STRICT, revocation_source=held,
                    revocation_timeout=5)
        client = Client()
        request = call(app, client)
        await until(lambda: held.calls == 1)
        client.leave()
        await asyncio.wait_for(request, 5)
        assert client.sent == [] and supervisor.stats()["in_flight"] == 1
        other = Client()
        await call(app, other)
        assert other.status() == 403 and other.json()["codes"] == ["REVOCATION_UNAVAILABLE"]
        held.release()
        await until(lambda: supervisor.stats()["in_flight"] == 0)
        after = Client()
        await call(app, after)
        assert after.status() == 200
    run(scenario)


def test_a_client_already_gone_after_its_body_starts_nothing():
    async def scenario():
        held = Held(TRUST)
        supervisor = SourceSupervisor(max_in_flight=1)
        app = build(trust=held, supervisor=supervisor)
        client = Client()
        client.leave()  # its disconnect is there as soon as the body is read
        await call(app, client)
        assert client.sent == [] and held.calls == 0
        assert supervisor.stats() == {"open": True, "in_flight": 0, "tenants": 0, "timeouts": 0, "saturated": 0, "closed": 0,
                                      "wrong_loop": 0, "late_results": 0, "late_errors": 0}
    run(scenario)


def test_admission_that_ends_as_the_client_leaves_reaches_no_route():
    async def scenario():
        reached: list = []
        clients: list = []

        async def trust(tenant):
            clients[0].leave()  # the client leaves while its trust set is being returned
            return TRUST

        app = build(trust=trust, supervisor=SourceSupervisor(max_in_flight=1), reached=reached)
        client = Client()
        clients.append(client)
        await call(app, client)
        assert client.sent == [] and reached == []
    run(scenario)


def test_nothing_is_left_behind_after_a_client_that_left(caplog):
    async def scenario():
        held = Held(TRUST)
        app = build(trust=held, supervisor=SourceSupervisor(max_in_flight=1))
        client = Client()
        request = call(app, client)
        await until(lambda: held.calls == 1)
        client.leave()
        await asyncio.wait_for(request, 5)
        held.release()
        await asyncio.sleep(0.02)
        assert [t for t in asyncio.all_tasks() if t is not asyncio.current_task()] == []

    with caplog.at_level(logging.WARNING):
        run(scenario)
        gc.collect()
    assert caplog.records == []


# ── Nothing crosses BaseHTTPMiddleware's task group ──

_ESCAPED: list = []


class _Recording(DCPVerifyMiddleware):
    """Records any exception that would leave dispatch: BaseHTTPMiddleware runs dispatch in a task
    group, which in some Starlette versions (0.28) wraps it in an ExceptionGroup."""

    async def dispatch(self, request, call_next):
        try:
            return await super().dispatch(request, call_next)
        except BaseException as exc:
            _ESCAPED.append(type(exc).__name__)
            raise


def _recording_app(**extra) -> FastAPI:
    app = FastAPI()
    app.add_middleware(_Recording, require_bundle=True, clock=lambda: NOW, trusted_principals=_async_trust, max_body_bytes=1 << 20,
                       source_supervisor=SourceSupervisor(max_in_flight=1), supervise={"trust_timeout": 5}, cancel_on_disconnect=True,
                       **extra)

    @app.post("/action")
    async def action(request: Request):
        return {"reached": True}

    return app


@pytest.mark.parametrize("case", ["healthy", "gone_before_the_source", "gone_mid_body"])
def test_a_client_that_left_is_answered_by_dispatch_itself_no_exception_crosses_the_task_group(case):
    async def scenario():
        _ESCAPED.clear()
        app = _recording_app()
        if case == "gone_mid_body":
            client = Client([BODY[:100]])
            client.messages[0]["more_body"] = True
        else:
            client = Client()
        if case != "healthy":
            client.leave()
        await call(app, client)
        assert _ESCAPED == []
        if case == "healthy":
            assert client.status() == 200  # the positive control: the same path answers a client that stays
        else:
            assert client.sent == []
    run(scenario)


# ── Other BaseHTTPMiddleware layers ──


class _Passthrough(BaseHTTPMiddleware):
    """An operator's BaseHTTPMiddleware: passes every request on, or fails for x-fail."""

    async def dispatch(self, request, call_next):
        if request.headers.get("x-fail"):
            raise RuntimeError("the operator's layer failed")
        return await call_next(request)


def _layered(dcp_outermost: bool) -> tuple:
    held = Held(TRUST)
    supervisor = SourceSupervisor(max_in_flight=2)
    app = FastAPI()
    options = {"require_bundle": True, "clock": lambda: NOW, "trusted_principals": held, "max_body_bytes": 1 << 20,
               "tenant": lambda request: "", "source_supervisor": supervisor, "supervise": {"trust_timeout": 5}, "cancel_on_disconnect": True}
    # add_middleware puts each new layer outside the previous ones: the last one added runs first.
    if dcp_outermost:
        app.add_middleware(_Passthrough)
        app.add_middleware(DCPVerifyMiddleware, **options)
    else:
        app.add_middleware(DCPVerifyMiddleware, **options)
        app.add_middleware(_Passthrough)

    @app.post("/action")
    async def action():
        return {"reached": True}

    return app, held, supervisor


def test_with_dcp_outside_the_other_base_http_middlewares_a_client_that_leaves_gets_nothing():
    async def scenario():
        app, held, supervisor = _layered(dcp_outermost=True)
        held.release()
        healthy = Client()
        await call(app, healthy)
        assert healthy.status() == 200
        held.release_event.clear()
        gone = Client()
        request = call(app, gone)
        await until(lambda: held.calls == 2)
        gone.leave()
        await asyncio.wait_for(request, 5)
        assert gone.sent == [] and supervisor.stats()["in_flight"] == 1
        held.release()
        await until(lambda: supervisor.stats()["in_flight"] == 0)
    run(scenario)


def test_with_dcp_outside_a_genuine_error_of_an_inner_layer_still_propagates():
    async def scenario():
        app, held, _ = _layered(dcp_outermost=True)
        held.release()
        client = Client(headers=[(b"content-type", b"application/json"), (b"content-length", str(len(BODY)).encode()), (b"x-fail", b"1")])
        with pytest.raises(RuntimeError, match="the operator's layer failed"):
            await call(app, client)
        assert client.status() == 500  # Starlette's own error handling, as without the option
    run(scenario)


def test_a_base_http_middleware_outside_dcp_is_the_documented_limit():
    # The documented order requirement: an outer BaseHTTPMiddleware needs a response start from the
    # layers inside it, and DCP sends nothing to a client that left. It fails there (Starlette's
    # "No response returned."); nothing is answered by DCP and the slot is still held.
    async def scenario():
        app, held, supervisor = _layered(dcp_outermost=False)
        gone = Client()
        request = call(app, gone)
        await until(lambda: held.calls == 1)
        gone.leave()
        with pytest.raises(RuntimeError, match="No response returned"):
            await asyncio.wait_for(request, 5)
        assert supervisor.stats()["in_flight"] == 1
        held.release()
        await until(lambda: supervisor.stats()["in_flight"] == 0)
        healthy = Client()
        await call(app, healthy)
        assert healthy.status() == 200  # a client that stays is unaffected by the order
    run(scenario)


# ── The body budget with the option ──


def test_the_413_and_an_invalid_content_length_are_unchanged():
    async def scenario():
        app = build(trust=_async_trust, supervisor=SourceSupervisor(max_in_flight=1), max_body_bytes=100)
        big = Client()
        await call(app, big)
        assert (big.status(), big.json()) == (413, {"verified": False, "errors": ["Request body exceeds max_body_bytes"]})
        bad = Client(headers=[(b"content-type", b"application/json"), (b"content-length", b"12x")])
        await call(app, bad)
        assert (bad.status(), bad.json()) == (400, {"verified": False, "errors": ["Invalid Content-Length"]})
    run(scenario)


@pytest.mark.parametrize("option", [True, False])
def test_a_client_that_leaves_in_the_middle_of_its_body(option):
    async def scenario():
        app = build(trust=_async_trust, supervisor=SourceSupervisor(max_in_flight=1), cancel_on_disconnect=option)
        client = Client([BODY[:100], BODY[100:]])
        client.messages = client.messages[:1]
        client.messages[0]["more_body"] = True
        client.leave()
        await call(app, client)
        if option:
            assert client.sent == []  # nothing to send to a client that left
        else:
            assert (client.status(), client.json()) == (400, {"verified": False, "errors": ["Request body could not be read"]})
    run(scenario)


# ── The tenant callable ──


def test_a_synchronous_tenant_that_returns_an_awaitable_is_refused_without_waiting(caplog):
    async def tenant_value(request):
        return ""

    def sneaky(request):
        return tenant_value(request)

    async def scenario():
        app = build(trust=_async_trust, supervisor=SourceSupervisor(max_in_flight=1), tenant=sneaky)
        client = Client()
        await call(app, client)
        assert (client.status(), client.json()) == (503, TRUST_UNAVAILABLE)

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        run(scenario)
        gc.collect()
    assert not [w for w in caught if "never awaited" in str(w.message)]


def test_without_the_option_an_async_tenant_still_works():
    async def tenant(request):
        return ""

    async def scenario():
        app = build(trust=_async_trust, supervisor=SourceSupervisor(max_in_flight=1), tenant=tenant, cancel_on_disconnect=False)
        client = Client()
        await call(app, client)
        assert client.status() == 200
    run(scenario)


# ── Configuration ──


async def _async_tenant(request):
    return ""


class _AsyncTenant:
    async def __call__(self, request):
        return ""


async def _revocation(subjects, tenant):
    return snapshot()


@pytest.mark.parametrize(
    "kwargs,code",
    [
        ({"max_body_bytes": None}, "CONFIG_PROFILE_CONTRADICTION"),
        ({"source_supervisor": None, "supervise": None}, "CONFIG_PROFILE_CONTRADICTION"),
        ({"trusted_principals": TRUST, "supervise": {"trust_timeout": 5}}, "CONFIG_PROFILE_CONTRADICTION"),  # static: nothing supervised
        ({"profile": STRICT, "revocation_source": _revocation}, "CONFIG_PROFILE_CONTRADICTION"),  # revocation unsupervised
        ({"trusted_principals": _async_trust, "profile": STRICT, "revocation_source": _revocation, "supervise": {"revocation": True}},
         "CONFIG_PROFILE_CONTRADICTION"),  # trust unsupervised
        ({"tenant": _async_tenant}, "CONFIG_PROFILE_CONTRADICTION"),
        ({"tenant": functools.partial(_async_tenant)}, "CONFIG_PROFILE_CONTRADICTION"),
        ({"tenant": _AsyncTenant()}, "CONFIG_PROFILE_CONTRADICTION"),
        ({"cancel_on_disconnect": "yes"}, "CONFIG_INVALID_VALUE"),
        ({"cancel_on_disconnect": 1}, "CONFIG_INVALID_VALUE"),
    ],
)
def test_invalid_cancel_on_disconnect_raises_at_construction(kwargs, code):
    base = {"require_bundle": True, "trusted_principals": _async_trust, "max_body_bytes": 1 << 20,
            "source_supervisor": SourceSupervisor(max_in_flight=1), "supervise": {"trust_timeout": 5}, "cancel_on_disconnect": True}
    with pytest.raises(AdmissionConfigError) as caught:
        DCPVerifyMiddleware(FastAPI(), **{**base, **kwargs})
    assert caught.value.code == code


def test_an_incompatible_starlette_is_refused_with_the_option(monkeypatch):
    monkeypatch.setattr(starlette, "__version__", "0.27.0")
    with pytest.raises(AdmissionConfigError) as caught:
        DCPVerifyMiddleware(FastAPI(), require_bundle=True, trusted_principals=_async_trust, max_body_bytes=1 << 20,
                            source_supervisor=SourceSupervisor(max_in_flight=1), supervise={"trust_timeout": 5}, cancel_on_disconnect=True)
    assert caught.value.code == "CONFIG_INVALID_VALUE"


def test_valid_cancel_on_disconnect_is_accepted():
    for kwargs in (
        {"trusted_principals": _async_trust, "supervise": {"trust_timeout": 5}},
        {"trusted_principals": _async_trust, "supervise": {"trust_timeout": 5}, "tenant": lambda request: ""},
        {"trusted_principals": TRUST, "profile": STRICT, "revocation_source": _revocation, "supervise": {"revocation": True}},
    ):
        DCPVerifyMiddleware(FastAPI(), require_bundle=True, max_body_bytes=1 << 20, source_supervisor=SourceSupervisor(max_in_flight=1),
                            cancel_on_disconnect=True, **kwargs)


# ── A real uvicorn server ──


async def serve(app) -> tuple:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(app, lifespan="off", http="h11", log_config=None, access_log=False))
    _SERVERS.append(server)
    task = asyncio.ensure_future(server.serve(sockets=[sock]))
    await until(lambda: server.started)
    return server, task, sock.getsockname()[1]


async def stop(server, task) -> None:
    server.should_exit = True
    await asyncio.wait_for(task, 10)


async def http(port: int, body: bytes = BODY, *, headers: str = "", close_after_send: bool = False):
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    head = (f"POST /action HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n"
            f"Connection: close\r\n{headers}\r\n").encode()
    writer.write(head + body)
    await writer.drain()
    if close_after_send:
        return reader, writer
    data = await asyncio.wait_for(reader.read(), 10)
    writer.close()
    status = int(data.split(b" ", 2)[1])
    return status, json.loads(data.split(b"\r\n\r\n", 1)[1])


def test_uvicorn_a_healthy_request_with_its_exact_body(caplog):
    async def scenario():
        reached: list = []
        app = build(trust=_async_trust, supervisor=SourceSupervisor(max_in_flight=1), reached=reached)
        server, task, port = await serve(app)
        try:
            status, body = await http(port)
            assert (status, body) == (200, {"reached": True})
            assert reached == [{"sha256": hashlib.sha256(BODY).hexdigest(), "disconnected": False}]
        finally:
            await stop(server, task)

    with caplog.at_level(logging.WARNING):
        run(scenario)
    assert not [r for r in caplog.records if r.name.startswith("uvicorn") and r.levelno >= logging.ERROR]


def test_uvicorn_a_socket_closed_during_admission_gets_nothing_and_its_slot_stays_taken(caplog):
    async def scenario():
        held = Held(TRUST)
        supervisor = SourceSupervisor(max_in_flight=1)
        reached: list = []
        app = build(trust=held, supervisor=supervisor, reached=reached)
        server, task, port = await serve(app)
        try:
            reader, writer = await http(port, close_after_send=True)
            await until(lambda: held.calls == 1)
            writer.transport.abort()
            await until(lambda: held.cancelled >= 1)
            await asyncio.sleep(0.05)
            assert reached == [] and supervisor.stats()["in_flight"] == 1
            status, body = await http(port)
            assert (status, body) == (503, TRUST_UNAVAILABLE)
            held.release()
            await until(lambda: supervisor.stats()["in_flight"] == 0)
            assert (await http(port))[0] == 200
            assert len(reached) == 1
        finally:
            await stop(server, task)

    with caplog.at_level(logging.WARNING):
        run(scenario)
    messages = [r.getMessage() for r in caplog.records if r.name.startswith("uvicorn")]
    assert not [m for m in messages if "ASGI callable returned" in m or "Exception in ASGI application" in m]


class HungList:
    """A deny-list server that holds each request until answer(), then answers it, and every later
    one, with an empty deny list (nothing revoked)."""

    def __init__(self) -> None:
        self.sock = socket.create_server(("127.0.0.1", 0))
        self.sock.settimeout(0.05)
        self.url = f"http://127.0.0.1:{self.sock.getsockname()[1]}/.well-known/dcp-revocations.json"
        self.lock = threading.Lock()
        self.held: list = []
        self.connections = 0
        self.answering = False
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()
        _LISTS.append(self)

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
                if not self.answering:
                    self.held.append(conn)
                    continue
            self._send(conn)

    @staticmethod
    def _send(conn) -> None:
        body = json.dumps({"dcp_version": "2.0", "updated_at": CASE_A["revocation"]["checked_at"], "revocations": [], "kid_revocations": []}).encode()
        try:
            conn.sendall(f"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode() + body)
        except OSError:
            pass
        finally:
            conn.close()

    def answer(self) -> None:
        with self.lock:
            self.answering = True
            held, self.held = self.held, []
        for conn in held:
            self._send(conn)

    def close(self) -> None:
        self.answer()
        self.stop.set()
        self.sock.close()
        self.thread.join(2)


def test_uvicorn_a_client_that_leaves_during_a_native_deny_list_download_keeps_the_worker_counted():
    # The supervisor's Task ends with the request; the DenyListWorkers thread does not, and keeps its slot.
    async def scenario():
        hung = HungList()
        workers = DenyListWorkers(max_workers=1)
        supervisor = SourceSupervisor(max_in_flight=4)
        reached: list = []
        app = build(supervisor=supervisor, supervise={"revocation": True}, profile=STRICT, revocation_timeout=5, reached=reached,
                    revocation_source=deny_list_revocation_source(hung.url, timeout=30, workers=workers))  # its socket timeout is far
        server, task, port = await serve(app)
        try:
            reader, writer = await http(port, close_after_send=True)
            await until(lambda: hung.connections == 1)
            writer.transport.abort()
            await until(lambda: supervisor.stats()["in_flight"] == 0)  # the supervised Task has ended
            assert workers.stats()["in_flight"] == 1 and reached == []  # the thread still downloads
            status, body = await http(port)
            assert status == 403 and body["codes"] == ["REVOCATION_UNAVAILABLE"]  # no free worker, no new download
            assert hung.connections == 1 and workers.stats()["saturated"] == 1
            hung.answer()  # released by the test, long before the download's own 30 s socket timeout
            await until(lambda: workers.stats()["in_flight"] == 0)
            assert (await http(port))[0] == 200
            assert len(reached) == 1  # only the last request reached the route
        finally:
            await stop(server, task)
    run(scenario)


def test_uvicorn_the_413_and_an_invalid_content_length_are_unchanged():
    async def scenario():
        app = build(trust=_async_trust, supervisor=SourceSupervisor(max_in_flight=1), max_body_bytes=100)
        server, task, port = await serve(app)
        try:
            assert await http(port) == (413, {"verified": False, "errors": ["Request body exceeds max_body_bytes"]})
        finally:
            await stop(server, task)
    run(scenario)
