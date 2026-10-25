"""
DCPVerifyMiddleware max_body_bytes: an opt-in budget on the request body bytes the middleware
receives. Each request is driven through the ASGI interface in process, with the body split into
the messages given and an external deadline, and counts what ran: body messages delivered, JSON
parses, tenant, trust set, verifier, revocation source and route. With the budget unset the
middleware behaves as before.

    DCP_NEGATIVE_CONTROL=1 pytest tests/test_fastapi_body_budget.py   # must fail once
"""

from __future__ import annotations

import asyncio
import copy
import json
import os
from pathlib import Path

import pytest
import starlette
from fastapi import FastAPI, Request

import dcp_ai.fastapi as dcp_fastapi
from dcp_ai.fastapi import DCPVerifyMiddleware
from dcp_ai.v2 import AdmissionConfigError
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms

REPO_ROOT = Path(__file__).resolve().parents[3]
VECTORS = json.loads((REPO_ROOT / "tests" / "interop" / "v2" / "admission_vectors.json").read_text())
CASE_A = next(c for c in VECTORS["cases"] if c["name"] == "A_known_principal_strict")
NOW = rfc3339_epoch_ms(CASE_A["now"])
STRICT = VECTORS["profiles"]["strict"]
TRUST = VECTORS["trust_sets"]["principal"]
NEGATIVE_CONTROL = os.environ.get("DCP_NEGATIVE_CONTROL") == "1"
_LOADS = json.loads  # the tests' own parse, not counted
DEADLINE = 5.0
TOO_LARGE = {"verified": False, "errors": ["Request body exceeds max_body_bytes"]}
BAD_LENGTH = {"verified": False, "errors": ["Invalid Content-Length"]}
UNREADABLE = {"verified": False, "errors": ["Request body could not be read"]}


def _bundle(name: str = "base") -> dict:
    return copy.deepcopy(VECTORS["signed_bundles"][name])


class Counters:
    """What ran for one request."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.delivered = 0  # body messages the middleware received
        self.parses = 0
        self.tenant = 0
        self.trust = 0
        self.verify = 0
        self.revocation = 0
        self.route: list = []

        loads = json.loads

        def counting_loads(*args, **kwargs):
            self.parses += 1
            return loads(*args, **kwargs)

        monkeypatch.setattr(json, "loads", counting_loads)
        for name in ("verify_signed_bundle_v2",):
            original = getattr(dcp_fastapi, name)

            async def counting_verify(*args, _original=original, **kwargs):
                self.verify += 1
                return await _original(*args, **kwargs)

            monkeypatch.setattr(dcp_fastapi, name, counting_verify)
        original_v1 = dcp_fastapi.verify_signed_bundle

        def counting_verify_v1(*args, **kwargs):
            self.verify += 1
            return original_v1(*args, **kwargs)

        monkeypatch.setattr(dcp_fastapi, "verify_signed_bundle", counting_verify_v1)

    def ran(self) -> dict:
        return {"parses": self.parses, "tenant": self.tenant, "trust": self.trust, "verify": self.verify,
                "revocation": self.revocation, "route": len(self.route)}


def _app(counters: Counters, **middleware) -> FastAPI:
    app = FastAPI()
    if "trusted_principals" in middleware:
        trust = middleware["trusted_principals"]

        def trusted(tenant):
            counters.trust += 1
            return trust

        def tenant(request):
            counters.tenant += 1
            return ""

        middleware = {**middleware, "trusted_principals": trusted, "tenant": tenant, "clock": lambda: NOW}
    if "revocation_source" in middleware:
        def source(subjects, tenant):
            counters.revocation += 1
            return {
                "checked_at": CASE_A["revocation"]["checked_at"],
                "agents": {a: "not_revoked" for a in subjects["agent_ids"]},
                "keys": {k: "not_revoked" for k in subjects["kids"]},
            }

        middleware["revocation_source"] = source
    app.add_middleware(DCPVerifyMiddleware, **middleware)

    @app.post("/action")
    async def action(request: Request):
        body = await request.body()
        streamed = b"".join([chunk async for chunk in request.stream()])
        counters.route.append({"agent": getattr(request.state, "dcp_agent", None), "body": body, "streamed": streamed})
        return {"reached": True, "bytes": len(body)}

    return app


def _request(app: FastAPI, counters: Counters, chunks: list[bytes], *, headers: list[tuple[str, str]] | None = None,
             content_length: str | None | bool = True, disconnect_after: int | None = None) -> tuple[int, dict]:
    """POST /action with the body in `chunks`, one ASGI message each; Content-Length is the real
    length (True), absent (None) or the value given. With disconnect_after the client disconnects
    after that many messages."""
    raw_headers = [(b"content-type", b"application/json")]
    if content_length is True:
        raw_headers.append((b"content-length", str(sum(map(len, chunks))).encode()))
    elif isinstance(content_length, str):
        raw_headers.append((b"content-length", content_length.encode()))
    raw_headers += [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in headers or []]
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
        "scheme": "http", "path": "/action", "raw_path": b"/action", "query_string": b"", "root_path": "",
        "headers": raw_headers, "client": ("127.0.0.1", 50000), "server": ("testserver", 80),
    }
    pending = list(chunks)
    status: list[int] = []
    body = bytearray()

    async def receive():
        if disconnect_after is not None and counters.delivered >= disconnect_after:
            return {"type": "http.disconnect"}
        if pending:
            counters.delivered += 1
            chunk = pending.pop(0)
            return {"type": "http.request", "body": chunk, "more_body": bool(pending)}
        await asyncio.Event().wait()  # like a server: nothing more until the client goes away

    async def send(message):
        if message["type"] == "http.response.start":
            status.append(message["status"])
        elif message["type"] == "http.response.body":
            body.extend(message.get("body", b""))

    async def run():
        await asyncio.wait_for(app(scope, receive, send), DEADLINE)

    asyncio.run(run())
    return status[0], _LOADS(bytes(body)) if body else {}


def _json(value) -> bytes:
    return json.dumps(value, separators=(",", ":")).encode()


def _padded(size: int) -> bytes:
    """A JSON object without a bundle, exactly `size` bytes long."""
    body = _json({"pad": ""})
    return _json({"pad": "x" * (size - len(body))})


NOTHING_RAN = {"parses": 0, "tenant": 0, "trust": 0, "verify": 0, "revocation": 0, "route": 0}


# ── Configuration ──


@pytest.mark.parametrize("value", [True, False, 0, -1, 1.0, 1.5, "100", float("inf"), [100]])
def test_an_invalid_budget_raises_at_construction(value):
    with pytest.raises(AdmissionConfigError) as caught:
        DCPVerifyMiddleware(FastAPI(), max_body_bytes=value)
    assert caught.value.code == "CONFIG_INVALID_VALUE"


@pytest.mark.parametrize("value", [None, 1, 1024, 10**9])
def test_a_valid_budget_or_none(value):
    DCPVerifyMiddleware(FastAPI(), max_body_bytes=value)


# ── Within the budget ──


@pytest.mark.parametrize("size,limit", [(64, 64), (63, 64), (64, 1_000)])
@pytest.mark.parametrize("chunked", [False, True], ids=["one_message", "8_byte_messages"])
def test_a_body_within_the_budget_reaches_the_route_exactly_once(monkeypatch, size, limit, chunked):
    counters = Counters(monkeypatch)
    body = _padded(size)
    chunks = [body[i:i + 8] for i in range(0, len(body), 8)] if chunked else [body]
    effective = limit - 1 if NEGATIVE_CONTROL and (size, limit, chunked) == (64, 64, False) else limit
    status, response = _request(_app(counters, max_body_bytes=effective), counters, chunks,
                                content_length=None if chunked else True)
    assert status == 200, response
    (reached,) = counters.route
    assert reached["body"] == body and reached["streamed"] == body
    assert counters.delivered == len(chunks)


def test_multibyte_characters_count_as_bytes(monkeypatch):
    text = json.dumps({"pad": "é" * 20}, ensure_ascii=False, separators=(",", ":")).encode()
    assert len(text.decode()) == 30 and len(text) == 50  # each é is two bytes
    counters = Counters(monkeypatch)
    status, response = _request(_app(counters, max_body_bytes=len(text.decode())), counters, [text])
    assert (status, response) == (413, TOO_LARGE)
    counters = Counters(monkeypatch)
    status, _ = _request(_app(counters, max_body_bytes=len(text)), counters, [text])
    assert status == 200


@pytest.mark.parametrize("require_bundle,status", [(False, 200), (True, 403)])
@pytest.mark.parametrize("body", [b"", b'{"signed_bundle": ', b"[]"], ids=["empty", "malformed", "not_an_object"])
def test_an_empty_or_malformed_body_keeps_its_meaning(monkeypatch, body, require_bundle, status):
    results = []
    for budget in (None, 1_000):
        counters = Counters(monkeypatch)
        results.append(_request(_app(counters, require_bundle=require_bundle, max_body_bytes=budget), counters,
                                [body]))
    assert results[0] == results[1]
    assert results[0][0] == status


# ── Over the budget: 413, nothing else runs ──


@pytest.mark.parametrize("transport", ["body", "header"])
@pytest.mark.parametrize("admission", [{}, {"require_bundle": True},
                                       {"require_bundle": True, "trusted_principals": TRUST},
                                       {"require_bundle": True, "trusted_principals": TRUST, "profile": STRICT,
                                        "revocation_source": None}],
                         ids=["optional_bundle", "required_bundle", "trust", "strict_v1"])
def test_a_content_length_over_the_budget_is_refused_before_reading(monkeypatch, transport, admission):
    counters = Counters(monkeypatch)
    payload = _json({"signed_bundle": _bundle()})
    headers = [("x-dcp-bundle", _json(_bundle()).decode())] if transport == "header" else []
    app = _app(counters, max_body_bytes=len(payload) - 1, **admission)
    status, response = _request(app, counters, [payload], headers=headers)
    assert (status, response) == (413, TOO_LARGE)
    assert counters.delivered == 0
    assert counters.ran() == NOTHING_RAN


@pytest.mark.parametrize("transport", ["body", "header"])
@pytest.mark.parametrize("content_length", [None, "10"], ids=["no_content_length", "content_length_too_small"])
def test_real_bytes_over_the_budget_stop_the_read(monkeypatch, transport, content_length):
    counters = Counters(monkeypatch)
    payload = _json({"signed_bundle": _bundle()})
    chunks = [payload[i:i + 100] for i in range(0, len(payload), 100)]
    assert len(chunks) > 5
    headers = [("x-dcp-bundle", _json(_bundle()).decode())] if transport == "header" else []
    app = _app(counters, require_bundle=True, max_body_bytes=250, **(
        {"trusted_principals": TRUST, "profile": STRICT, "revocation_source": None} if transport == "body" else {}))
    status, response = _request(app, counters, chunks, headers=headers, content_length=content_length)
    assert (status, response) == (413, TOO_LARGE)
    assert counters.delivered == 3  # 300 bytes > 250: the rest is never received
    assert counters.ran() == NOTHING_RAN


@pytest.mark.parametrize("value", ["abc", "-1", "+10", "1.5", "", " 10", "10, 10", "１０"])
def test_an_invalid_content_length_is_refused_before_reading(monkeypatch, value):
    counters = Counters(monkeypatch)
    status, response = _request(_app(counters, max_body_bytes=1_000), counters, [b"{}"], content_length=value)
    assert (status, response) == (400, BAD_LENGTH)
    assert counters.delivered == 0
    assert counters.ran() == NOTHING_RAN


def test_a_duplicate_content_length_is_refused_before_reading(monkeypatch):
    counters = Counters(monkeypatch)
    status, response = _request(_app(counters, max_body_bytes=1_000), counters, [b"{}"],
                                headers=[("content-length", "2")])
    assert (status, response) == (400, BAD_LENGTH)
    assert counters.delivered == 0
    assert counters.ran() == NOTHING_RAN


def test_a_huge_content_length_is_refused_as_too_large(monkeypatch):
    counters = Counters(monkeypatch)
    status, response = _request(_app(counters, max_body_bytes=1_000), counters, [b"{}"],
                                content_length="0" * 10 + "9" * 5000)
    assert (status, response) == (413, TOO_LARGE)
    assert counters.delivered == 0


def test_a_disconnect_while_reading_is_refused_not_passed_on(monkeypatch):
    counters = Counters(monkeypatch)
    payload = _padded(100)
    status, response = _request(_app(counters, max_body_bytes=1_000), counters, [payload[:50], payload[50:]],
                                content_length=None, disconnect_after=1)
    assert (status, response) == (400, UNREADABLE)
    assert counters.ran() == NOTHING_RAN


# ── Without the budget: as before ──


def test_without_the_budget_nothing_changes(monkeypatch):
    big = _padded(10_000)
    counters = Counters(monkeypatch)
    status, response = _request(_app(counters), counters, [big[i:i + 1000] for i in range(0, len(big), 1000)],
                                content_length="12")
    assert (status, response) == (200, {"reached": True, "bytes": len(big)})
    counters = Counters(monkeypatch)
    status, _ = _request(_app(counters), counters, [b"{}"], content_length="abc")
    assert status == 200


# ── Admission under the budget, as before ──


def test_an_admitted_strict_v1_request_under_the_budget(monkeypatch):
    counters = Counters(monkeypatch)
    payload = _json({"signed_bundle": _bundle()})
    app = _app(counters, require_bundle=True, max_body_bytes=len(payload), trusted_principals=TRUST, profile=STRICT,
               revocation_source=None)
    status, response = _request(app, counters, [payload])
    assert status == 200, response
    (reached,) = counters.route
    agent = reached["agent"]
    assert (agent.admitted, agent.profile, agent.action_authorized) == (True, "strict-v1", False)
    assert reached["body"] == payload
    assert (counters.tenant, counters.trust, counters.verify, counters.revocation) == (1, 1, 1, 1)


def test_an_unknown_principal_is_refused_as_before(monkeypatch):
    results = []
    for budget in (None, 1_000_000):
        counters = Counters(monkeypatch)
        app = _app(counters, require_bundle=True, max_body_bytes=budget, trusted_principals=TRUST, profile=STRICT,
                   revocation_source=None)
        results.append(_request(app, counters, [_json({"signed_bundle": _bundle("unknown_principal")})]))
        assert counters.route == []
    assert results[0] == results[1]
    assert results[0][0] == 403 and results[0][1]["codes"] == ["TRUST_PRINCIPAL_UNKNOWN"]


def test_a_header_bundle_under_the_budget_verifies_and_the_body_still_reaches_the_route(monkeypatch):
    counters = Counters(monkeypatch)
    body = _padded(200)
    app = _app(counters, require_bundle=True, max_body_bytes=200, trusted_principals=TRUST)
    status, response = _request(app, counters, [body], headers=[("x-dcp-bundle", _json(_bundle()).decode())])
    assert status == 200, response
    (reached,) = counters.route
    assert reached["agent"].admitted is True and reached["body"] == body


# ── Starlette runtime: the budget needs 0.28.0, which passes a body read in dispatch on ──


def _starlette_version(monkeypatch: pytest.MonkeyPatch, version: str | None) -> None:
    if version is None:
        monkeypatch.delattr(starlette, "__version__")
    else:
        monkeypatch.setattr(starlette, "__version__", version)


@pytest.mark.parametrize("version", ["0.27.0", "0.27.1", "0.26.1", "", "unknown", "x.28", None])
def test_the_budget_is_refused_on_a_starlette_that_does_not_pass_the_body_on(monkeypatch, version):
    _starlette_version(monkeypatch, version)
    with pytest.raises(AdmissionConfigError) as caught:
        DCPVerifyMiddleware(FastAPI(), max_body_bytes=1_000)
    assert caught.value.code == "CONFIG_INVALID_VALUE"
    assert "Starlette 0.28.0 or later" in str(caught.value)


@pytest.mark.parametrize("version", ["0.28.0", "0.28.0rc1", "0.37.2", "1.9.0"])
def test_the_budget_is_accepted_from_starlette_0_28(monkeypatch, version):
    _starlette_version(monkeypatch, version)
    DCPVerifyMiddleware(FastAPI(), max_body_bytes=1_000)


@pytest.mark.parametrize("version", ["0.27.0", "unknown", None])
def test_without_the_budget_the_starlette_version_is_not_checked(monkeypatch, version):
    _starlette_version(monkeypatch, version)
    counters = Counters(monkeypatch)
    status, response = _request(_app(counters), counters, [_padded(100)])
    assert (status, response) == (200, {"reached": True, "bytes": 100})
