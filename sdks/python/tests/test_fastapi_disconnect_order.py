"""
cancel_on_disconnect whatever the order of the middlewares: DCPVerifyMiddleware outside, inside or
between other BaseHTTPMiddleware layers and pure ASGI layers. A client that leaves during admission
gets the end of its ASGI response as an empty 499 (Content-Length: 0, Cache-Control: no-store),
which a BaseHTTPMiddleware outside needs (it waits for http.response.start), so nothing fails there;
no route runs, nothing the admission published stays in request.state, and the slot stays taken
until the source really ends. A client that stays is untouched, and genuine errors of any layer
still propagate. Through scripted ASGI clients and a real uvicorn server on loopback; every
scenario runs in one event loop under a watchdog that releases its sources and servers.

    DCP_NEGATIVE_CONTROL=1 pytest tests/test_fastapi_disconnect_order.py   # must fail once
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import logging
import os
import socket
import threading
import time
from pathlib import Path

import pytest
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from starlette.middleware.base import BaseHTTPMiddleware

from dcp_ai.fastapi import DCPVerifyMiddleware, SourceSupervisor, _ClientGoneResponse
from dcp_ai.v2 import DenyListWorkers, deny_list_revocation_source
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms

REPO_ROOT = Path(__file__).resolve().parents[3]
VECTORS = json.loads((REPO_ROOT / "tests" / "interop" / "v2" / "admission_vectors.json").read_text())
CASE_A = next(c for c in VECTORS["cases"] if c["name"] == "A_known_principal_strict")
NOW = rfc3339_epoch_ms(CASE_A["now"])
STRICT = VECTORS["profiles"]["strict"]
TRUST = VECTORS["trust_sets"]["principal"]
EMPTY = VECTORS["trust_sets"]["empty"]
NEGATIVE_CONTROL = os.environ.get("DCP_NEGATIVE_CONTROL") == "1"
DEADLINE = 20.0
GRACE = 5.0
BODY = json.dumps({"signed_bundle": VECTORS["signed_bundles"]["base"]}).encode()
ORDERS = ["dcp_outermost", "dcp_innermost", "interleaved"]
OPERATOR = object()


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
    """One scenario in a fresh event loop. A watchdog releases every source, deny-list server and
    uvicorn server once `deadline` passes, so a stuck scenario ends and fails with an assertion."""
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

    def __init__(self, value, *, before_return=None):
        self.release_event = asyncio.Event()
        self.value = value
        self.before_return = before_return
        self.calls = 0
        _HELD.append(self)

    async def __call__(self, *args):
        self.calls += 1
        while True:
            try:
                await self.release_event.wait()
                break
            except asyncio.CancelledError:
                pass
        if self.before_return is not None:
            self.before_return()
        return self.value

    def release(self):
        self.release_event.set()


class Client:
    """A scripted ASGI client: the body in `chunks`, then http.disconnect once it leaves or, as
    uvicorn does, once a response is complete. `state` is the scope's state, inspectable after."""

    def __init__(self, chunks=None, *, headers=None, state=None):
        chunks = [BODY] if chunks is None else chunks
        self.messages = [{"type": "http.request", "body": c, "more_body": i < len(chunks) - 1} for i, c in enumerate(chunks)]
        size = sum(len(c) for c in chunks)
        self.headers = headers if headers is not None else [(b"content-type", b"application/json"), (b"content-length", str(size).encode())]
        self.state = {} if state is None else state
        self.wake = asyncio.Event()
        self.sent: list = []
        self.active = 0
        self.overlap = 0

    def scope(self, path: str = "/action") -> dict:
        return {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "scheme": "http",
                "path": path, "raw_path": path.encode(), "query_string": b"", "root_path": "", "headers": self.headers,
                "client": ("127.0.0.1", 1), "server": ("127.0.0.1", 80), "state": self.state}

    async def receive(self):
        self.active += 1
        self.overlap = max(self.overlap, self.active)
        try:
            if self.messages:
                return self.messages.pop(0)
            await self.wake.wait()
            return {"type": "http.disconnect"}
        finally:
            self.active -= 1

    async def send(self, message):
        self.sent.append(message)
        if message["type"] == "http.response.body" and not message.get("more_body", False):
            self.wake.set()

    def leave(self):
        self.wake.set()

    def status(self):
        starts = [m for m in self.sent if m["type"] == "http.response.start"]
        return starts[0]["status"] if starts else None

    def body(self) -> bytes:
        return b"".join(m.get("body", b"") for m in self.sent if m["type"] == "http.response.body")


def terminated(client: Client) -> bool:
    """499, empty, no-store, in exactly two messages: the end of the response of a client that left."""
    starts = [m for m in client.sent if m["type"] == "http.response.start"]
    return (len(client.sent) == 2 and len(starts) == 1 and starts[0]["status"] == 499
            and {k.lower(): v for k, v in starts[0]["headers"]} == {b"cache-control": b"no-store", b"content-length": b"0"}
            and client.body() == b"" and not any(m.get("more_body") for m in client.sent if m["type"] == "http.response.body"))


async def through(app, client: Client, path: str = "/action"):
    """Runs one request; whatever escapes the application comes back as text, to be asserted on."""
    try:
        await app(client.scope(path), client.receive, client.send)
        return None
    except Exception as exc:  # recorded, never hidden: every test asserts on it
        return f"{type(exc).__name__}: {exc}"


# ── The layers ──

SEEN: list = []


class Seeing(BaseHTTPMiddleware):
    """An operator's BaseHTTPMiddleware: passes every request on and records the status it saw; for
    x-fail: <name>-before or <name>-after, fails before or after call_next."""

    def __init__(self, app, name: str):
        super().__init__(app)
        self.name = name

    async def dispatch(self, request, call_next):
        if request.headers.get("x-fail") == f"{self.name}-before":
            raise RuntimeError(f"{self.name} failed before")
        response = await call_next(request)
        SEEN.append((self.name, response.status_code, response.headers.get("cache-control")))
        if request.headers.get("x-fail") == f"{self.name}-after":
            raise RuntimeError(f"{self.name} failed after")
        return response


class Pure:
    """A pure ASGI layer that records the status it passes on; with `operator`, it sets
    request.state.dcp_agent (scope state) itself before the application runs."""

    def __init__(self, app, name: str, operator: bool = False):
        self.app, self.name, self.operator = app, name, operator

    async def __call__(self, scope, receive, send):
        if self.operator and scope["type"] == "http":
            scope.setdefault("state", {})["dcp_agent"] = OPERATOR

        async def sending(message):
            if message["type"] == "http.response.start":
                headers = {k.lower(): v for k, v in message.get("headers", [])}
                SEEN.append((self.name, message["status"], (headers.get(b"cache-control") or b"").decode() or None))
            await send(message)

        await self.app(scope, receive, sending)


def compose(order: str, *, trust=None, supervisor=None, supervise=None, reached=None, operator=False, **extra) -> FastAPI:
    app = FastAPI()
    options = {"require_bundle": True, "clock": lambda: NOW, "trusted_principals": TRUST if trust is None else trust,
               "max_body_bytes": 1 << 20, "tenant": lambda request: request.headers.get("x-tenant", ""),
               "source_supervisor": supervisor or SourceSupervisor(max_in_flight=4),
               "supervise": supervise or {"trust_timeout": 5}, "cancel_on_disconnect": True, **extra}
    # add_middleware puts each new layer outside the previous ones: the last one added runs first.
    if order == "dcp_outermost":
        app.add_middleware(Seeing, name="inner-1")
        app.add_middleware(Seeing, name="inner-2")
        app.add_middleware(DCPVerifyMiddleware, **options)
    elif order == "dcp_innermost":
        app.add_middleware(DCPVerifyMiddleware, **options)
        app.add_middleware(Seeing, name="outer-1")
        app.add_middleware(Seeing, name="outer-2")
    else:
        app.add_middleware(Pure, name="pure-in")
        app.add_middleware(Seeing, name="bhm-in")
        app.add_middleware(DCPVerifyMiddleware, **options)
        app.add_middleware(Seeing, name="bhm-out")
        app.add_middleware(Pure, name="pure-out", operator=operator)

    @app.post("/action")
    async def action(request: Request):
        body = await request.body()
        if reached is not None:
            reached.append(hashlib.sha256(body).hexdigest())
        return {"reached": True}

    @app.post("/stream")
    async def stream(request: Request):
        body = await request.body()

        async def chunks():
            for i in range(0, len(body), 4096):
                yield body[i:i + 4096]

        return StreamingResponse(chunks(), media_type="application/octet-stream")

    @app.post("/boom")
    async def boom():
        raise RuntimeError("the route failed")

    return app


OUTSIDE = {"dcp_outermost": [], "dcp_innermost": ["outer-1", "outer-2"], "interleaved": ["bhm-out", "pure-out"]}


async def _async_trust(tenant):
    return TRUST


# ── The termination itself ──


def test_the_termination_is_an_empty_499_with_no_store_in_two_messages():
    async def scenario():
        response = _ClientGoneResponse()
        assert response.status_code == 499 and response.body == b""
        assert {k: v for k, v in response.raw_headers} == {b"cache-control": b"no-store", b"content-length": b"0"}
        sent: list = []

        async def receive():
            return {"type": "http.disconnect"}

        async def send(message):
            sent.append(message)

        await response({"type": "http"}, receive, send)
        assert [m["type"] for m in sent] == ["http.response.start", "http.response.body"]
        assert sent[0]["status"] == 499 and sent[1].get("body") == b"" and not sent[1].get("more_body", False)
    run(scenario)


# ── Healthy clients, in every order ──


@pytest.mark.parametrize("order", ORDERS)
def test_a_client_that_stays_is_answered_as_usual_with_its_exact_body(order):
    async def scenario():
        SEEN.clear()
        reached: list = []
        app = compose(order, trust=_async_trust, reached=reached)
        client = Client([BODY[:100], BODY[100:7000], BODY[7000:]])
        assert await through(app, client) is None
        # The negative control inverts this expectation, in one order only: exactly one case fails.
        assert (client.status() == 200) is not (NEGATIVE_CONTROL and order == "dcp_innermost")
        assert reached == [hashlib.sha256(BODY).hexdigest()] and client.overlap == 1
        assert all(status == 200 for _, status, _ in SEEN)
        streamed = Client()
        assert await through(app, streamed, "/stream") is None
        assert streamed.status() == 200 and streamed.body() == BODY
    run(scenario)


# ── A client that leaves, in every order ──


@pytest.mark.parametrize("order", ORDERS)
def test_a_client_that_leaves_during_the_trust_source_ends_with_the_499_and_its_slot_stays(order):
    async def scenario():
        SEEN.clear()
        held = Held(TRUST)
        supervisor = SourceSupervisor(max_in_flight=1)
        reached: list = []
        app = compose(order, trust=held, supervisor=supervisor, reached=reached)
        gone = Client()
        request = asyncio.ensure_future(through(app, gone))
        await until(lambda: held.calls == 1)
        gone.leave()
        assert await asyncio.wait_for(request, 5) is None  # nothing fails in any layer
        assert terminated(gone) and reached == []
        assert sorted(name for name, _, _ in SEEN) == sorted(OUTSIDE[order])
        assert all((status, cache) == (499, "no-store") for _, status, cache in SEEN)
        assert supervisor.stats()["in_flight"] == 1
        other = Client()
        assert await through(app, other) is None and other.status() == 503  # the same supervisor, no free slot
        held.release()
        await until(lambda: supervisor.stats()["in_flight"] == 0)
        after = Client()
        assert await through(app, after) is None and after.status() == 200
    run(scenario)


@pytest.mark.parametrize("order", ORDERS)
def test_a_client_that_leaves_during_the_revocation_source_ends_with_the_499(order):
    async def scenario():
        held = Held(snapshot())
        supervisor = SourceSupervisor(max_in_flight=1)
        app = compose(order, supervisor=supervisor, supervise={"revocation": True}, profile=STRICT, revocation_source=held,
                      revocation_timeout=5)
        gone = Client()
        request = asyncio.ensure_future(through(app, gone))
        await until(lambda: held.calls == 1)
        gone.leave()
        assert await asyncio.wait_for(request, 5) is None
        assert terminated(gone) and supervisor.stats()["in_flight"] == 1
        other = Client()
        assert await through(app, other) is None
        assert other.status() == 403 and json.loads(other.body())["codes"] == ["REVOCATION_UNAVAILABLE"]
        held.release()
        await until(lambda: supervisor.stats()["in_flight"] == 0)
        after = Client()
        assert await through(app, after) is None and after.status() == 200
    run(scenario)


@pytest.mark.parametrize("order", ORDERS)
def test_a_client_that_leaves_mid_body_or_before_the_source_ends_with_the_499(order):
    async def scenario():
        held = Held(TRUST)
        supervisor = SourceSupervisor(max_in_flight=1)
        app = compose(order, trust=held, supervisor=supervisor)
        mid = Client([BODY[:100]])
        mid.messages[0]["more_body"] = True
        mid.leave()
        assert await through(app, mid) is None and terminated(mid)
        early = Client()
        early.leave()  # its disconnect is there as soon as the body is read
        assert await through(app, early) is None and terminated(early)
        if order == "dcp_outermost":
            assert held.calls == 0  # DCP reads the disconnect at once: no stage starts
        else:
            # Through outer layers' receive it reaches DCP a few loop turns later: DCP skips only the
            # stages that start after it has seen it, so the source may have started. It is then
            # cancelled and keeps its slot until it ends.
            assert held.calls in (0, 1) and supervisor.stats()["in_flight"] == held.calls
        held.release()
        await until(lambda: supervisor.stats()["in_flight"] == 0)
    run(scenario)


# ── Nothing of the admission stays published ──


def test_revocation_returning_as_the_client_leaves_leaves_no_admitted_state():
    async def scenario():
        clients: list = []
        held = Held(snapshot(), before_return=lambda: clients[0].leave())
        app = compose("interleaved", supervise={"revocation": True}, profile=STRICT, revocation_source=held, revocation_timeout=5)
        gone = Client()
        clients.append(gone)
        request = asyncio.ensure_future(through(app, gone))
        await until(lambda: held.calls == 1)
        held.release()  # it marks the client gone, then returns a valid snapshot
        assert await asyncio.wait_for(request, 5) is None
        assert terminated(gone)
        assert "dcp_agent" not in gone.state
    run(scenario)


def test_a_dcp_agent_the_operator_sets_while_the_source_is_pending_is_left_alone():
    async def scenario():
        clients: list = []
        later = object()
        held = Held(snapshot(), before_return=lambda: clients[0].leave())
        app = compose("interleaved", supervise={"revocation": True}, profile=STRICT, revocation_source=held, revocation_timeout=5)
        gone = Client()
        clients.append(gone)
        request = asyncio.ensure_future(through(app, gone))
        await until(lambda: held.calls == 1)
        gone.state["dcp_agent"] = later  # the operator's own code, while the source is pending
        held.release()
        assert await asyncio.wait_for(request, 5) is None
        assert terminated(gone) and gone.state["dcp_agent"] is later
    run(scenario)


def test_an_earlier_dcp_agent_of_the_operator_is_kept_on_the_499_and_replaced_for_a_client_that_stays():
    async def scenario():
        clients: list = []
        held = Held(snapshot(), before_return=lambda: clients[0].leave())
        app = compose("interleaved", operator=True, supervise={"revocation": True}, profile=STRICT, revocation_source=held,
                      revocation_timeout=5)
        gone = Client()
        clients.append(gone)
        request = asyncio.ensure_future(through(app, gone))
        await until(lambda: held.calls == 1)
        held.release()
        assert await asyncio.wait_for(request, 5) is None
        assert terminated(gone) and gone.state["dcp_agent"] is OPERATOR
        clients[0] = Client()  # this one stays: the source marks a client nobody uses
        stays = Client()
        assert await through(app, stays) is None and stays.status() == 200
        assert stays.state["dcp_agent"] is not OPERATOR and stays.state["dcp_agent"].admitted is True
    run(scenario)


def test_a_client_that_leaves_once_the_route_runs_gets_the_route_answer_untouched():
    async def scenario():
        clients: list = []
        app = FastAPI()
        app.add_middleware(DCPVerifyMiddleware, require_bundle=True, clock=lambda: NOW, trusted_principals=_async_trust,
                           max_body_bytes=1 << 20, source_supervisor=SourceSupervisor(max_in_flight=1),
                           supervise={"trust_timeout": 5}, cancel_on_disconnect=True)
        app.add_middleware(Seeing, name="outer")

        @app.post("/action")
        async def action():
            clients[0].leave()  # the read DCP watched was handed over: not taken as a client that left
            return {"reached": True}

        client = Client()
        clients.append(client)
        assert await through(app, client) is None
        assert client.status() == 200
    run(scenario)


# ── A client that stays: refusals and genuine errors ──


@pytest.mark.parametrize("order", ORDERS)
def test_refusals_to_a_client_that_stays_are_unchanged(order):
    async def scenario():
        async def nothing(tenant):
            return None  # no trust set: the 503 of a source that cannot answer

        refused = Client()
        assert await through(compose(order, trust=nothing), refused) is None
        assert refused.status() == 503
        untrusted = Client()

        async def empty(tenant):
            return EMPTY

        assert await through(compose(order, trust=empty), untrusted) is None
        assert untrusted.status() == 403 and json.loads(untrusted.body())["codes"] == ["TRUST_PRINCIPAL_UNKNOWN"]
        big = Client()
        assert await through(compose(order, trust=_async_trust, max_body_bytes=100), big) is None
        assert (big.status(), json.loads(big.body())) == (413, {"verified": False, "errors": ["Request body exceeds max_body_bytes"]})
        bad = Client(headers=[(b"content-type", b"application/json"), (b"content-length", b"12x")])
        assert await through(compose(order, trust=_async_trust), bad) is None
        assert (bad.status(), json.loads(bad.body())) == (400, {"verified": False, "errors": ["Invalid Content-Length"]})
    run(scenario)


@pytest.mark.parametrize(
    "order,fail",
    [("dcp_innermost", "outer-1-before"), ("dcp_innermost", "outer-2-after"), ("dcp_outermost", "inner-1-before"),
     ("dcp_outermost", "inner-2-after"), ("interleaved", "bhm-out-before"), ("interleaved", "bhm-in-after")],
)
def test_a_genuine_error_of_a_layer_still_propagates(order, fail):
    async def scenario():
        app = compose(order, trust=_async_trust)
        client = Client(headers=[(b"content-type", b"application/json"), (b"content-length", str(len(BODY)).encode()), (b"x-fail", fail.encode())])
        escaped = await through(app, client)
        name, when = fail.rsplit("-", 1)
        assert escaped == f"RuntimeError: {name} failed {when}"
        assert client.status() == 500  # Starlette's own error handling, as without the option
    run(scenario)


@pytest.mark.parametrize("order", ORDERS)
def test_a_genuine_error_of_the_route_still_propagates(order):
    async def scenario():
        client = Client()
        escaped = await through(compose(order, trust=_async_trust), client, "/boom")
        assert escaped == "RuntimeError: the route failed" and client.status() == 500
    run(scenario)


def test_an_outer_layer_that_fails_after_the_499_is_not_hidden():
    async def scenario():
        held = Held(TRUST)
        app = compose("dcp_innermost", trust=held)
        gone = Client(headers=[(b"content-type", b"application/json"), (b"content-length", str(len(BODY)).encode()), (b"x-fail", b"outer-1-after")])
        request = asyncio.ensure_future(through(app, gone))
        await until(lambda: held.calls == 1)
        gone.leave()
        assert await asyncio.wait_for(request, 5) == "RuntimeError: outer-1 failed after"
    run(scenario)


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


def dechunk(data: bytes) -> bytes:
    """The payload of an HTTP/1.1 chunked body."""
    out, rest = b"", data
    while True:
        size_line, rest = rest.split(b"\r\n", 1)
        size = int(size_line, 16)
        if size == 0:
            return out
        out, rest = out + rest[:size], rest[size + 2:]


async def http(port: int, body: bytes = BODY, *, path: str = "/action", close_after_send: bool = False):
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    head = (f"POST {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n"
            "Connection: close\r\n\r\n").encode()
    writer.write(head + body)
    await writer.drain()
    if close_after_send:
        return reader, writer
    data = await asyncio.wait_for(reader.read(), 10)
    writer.close()
    return int(data.split(b" ", 2)[1]), data.split(b"\r\n\r\n", 1)[1]


def _server_errors(caplog) -> list:
    return [r.getMessage() for r in caplog.records
            if "No response returned" in r.getMessage() or "Exception in ASGI application" in r.getMessage()
            or "ASGI callable returned" in r.getMessage() or (r.levelno >= logging.ERROR and r.name.startswith(("uvicorn", "starlette")))]


@pytest.mark.parametrize("order", ["dcp_innermost", "interleaved"])
def test_uvicorn_a_socket_closed_during_admission_logs_no_error_and_keeps_the_slot(order, caplog):
    async def scenario():
        SEEN.clear()
        held = Held(TRUST)
        supervisor = SourceSupervisor(max_in_flight=1)
        reached: list = []
        app = compose(order, trust=held, supervisor=supervisor, reached=reached)
        server, task, port = await serve(app)
        try:
            reader, writer = await http(port, close_after_send=True)
            await until(lambda: held.calls == 1 and supervisor.stats()["in_flight"] == 1)
            writer.transport.abort()
            await until(lambda: any(status == 499 for _, status, _ in SEEN))
            assert reached == [] and supervisor.stats()["in_flight"] == 1
            status, _ = await http(port)
            assert status == 503
            held.release()
            await until(lambda: supervisor.stats()["in_flight"] == 0)
            status, _ = await http(port)
            assert status == 200 and len(reached) == 1
        finally:
            await stop(server, task)

    with caplog.at_level(logging.WARNING):
        run(scenario)
    assert _server_errors(caplog) == []


@pytest.mark.parametrize("order", ["dcp_innermost", "interleaved"])
def test_uvicorn_a_client_that_stays_gets_its_exact_body_back_streamed(order, caplog):
    async def scenario():
        app = compose(order, trust=_async_trust)
        server, task, port = await serve(app)
        try:
            status, body = await http(port, path="/stream")
            assert status == 200 and dechunk(body) == BODY
        finally:
            await stop(server, task)

    with caplog.at_level(logging.WARNING):
        run(scenario)
    assert _server_errors(caplog) == []


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


def test_uvicorn_a_native_deny_list_worker_stays_counted_behind_an_outer_layer(caplog):
    async def scenario():
        hung = HungList()
        workers = DenyListWorkers(max_workers=1)
        supervisor = SourceSupervisor(max_in_flight=4)
        reached: list = []
        app = compose("dcp_innermost", supervisor=supervisor, supervise={"revocation": True}, profile=STRICT, revocation_timeout=5,
                      reached=reached, revocation_source=deny_list_revocation_source(hung.url, timeout=30, workers=workers))
        server, task, port = await serve(app)
        try:
            reader, writer = await http(port, close_after_send=True)
            await until(lambda: hung.connections == 1)
            writer.transport.abort()
            await until(lambda: supervisor.stats()["in_flight"] == 0)  # the supervised Task has ended
            assert workers.stats()["in_flight"] == 1 and reached == []  # its thread still downloads
            status, body = await http(port)
            assert status == 403 and json.loads(body)["codes"] == ["REVOCATION_UNAVAILABLE"] and hung.connections == 1
            hung.answer()  # released by the test, long before the download's own 30 s socket timeout
            await until(lambda: workers.stats()["in_flight"] == 0)
            assert (await http(port))[0] == 200 and len(reached) == 1
        finally:
            await stop(server, task)

    with caplog.at_level(logging.WARNING):
        run(scenario)
    assert _server_errors(caplog) == []
