"""
DCPVerifyMiddleware admission (spec/profiles/admission § 6): trusted principals, the
strict-v1 profile and a revocation source, through the real middleware, with the
admission vectors' bundles and a fixed clock. A refused request never reaches the
route. Also deny_list_revocation_source against a local HTTP server.
"""

from __future__ import annotations

import asyncio
import copy
import json
import runpy
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware

from dcp_ai.fastapi import DCPVerifyMiddleware
from dcp_ai.v2 import (
    AdmissionConfigError,
    RevocationSourceError,
    deny_list_revocation_source,
)
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms

REPO_ROOT = Path(__file__).resolve().parents[3]
VECTORS = json.loads((REPO_ROOT / "tests" / "interop" / "v2" / "admission_vectors.json").read_text())
BUNDLE_VECTORS = json.loads((REPO_ROOT / "tests" / "interop" / "v2" / "bundle_vectors.json").read_text())

CASE_A = next(c for c in VECTORS["cases"] if c["name"] == "A_known_principal_strict")
NOW = rfc3339_epoch_ms(CASE_A["now"])
CHECKED_AT = CASE_A["revocation"]["checked_at"]  # 30 s before NOW
STRICT = VECTORS["profiles"]["strict"]
TRUST = VECTORS["trust_sets"]["principal"]
SUBJECTS = {"agent_ids": ["agent:acme-bot"], "kids": sorted(CASE_A["revocation"]["keys"])}


def _bundle(name: str = "base") -> dict:
    return copy.deepcopy(VECTORS["signed_bundles"][name])


def _snapshot(subjects: dict, *, checked_at: str = CHECKED_AT, revoked: tuple[str, ...] = ()) -> dict:
    def status(subject: str) -> str:
        return "revoked" if subject in revoked else "not_revoked"

    return {
        "checked_at": checked_at,
        "agents": {a: status(a) for a in subjects["agent_ids"]},
        "keys": {k: status(k) for k in subjects["kids"]},
    }


def _fresh_source(subjects: dict, tenant: str) -> dict:
    return _snapshot(subjects)


class _OperatorAuth(BaseHTTPMiddleware):
    """The operator's own authentication: the tenant of an authenticated caller, on request.state."""

    TOKENS = {"Bearer token-a": "tenant-a", "Bearer token-b": "tenant-b"}

    async def dispatch(self, request, call_next):
        request.state.tenant = self.TOKENS.get(request.headers.get("authorization", ""), "")
        return await call_next(request)


def _client(reached: list, *, operator_auth: bool = False, **middleware) -> TestClient:
    app = FastAPI()
    middleware.setdefault("require_bundle", True)
    middleware.setdefault("clock", lambda: NOW)
    app.add_middleware(DCPVerifyMiddleware, **middleware)
    if operator_auth:
        app.add_middleware(_OperatorAuth)  # outermost: runs first

    @app.post("/action")
    async def action(request: Request):
        agent = getattr(request.state, "dcp_agent", None)
        reached.append(agent)
        return {"reached": True}

    return TestClient(app)


def _post(client: TestClient, signed_bundle, **kwargs):
    return client.post("/action", json={"signed_bundle": signed_bundle}, **kwargs)


def _strict(**overrides) -> dict:
    return {"profile": STRICT, "trusted_principals": TRUST, "revocation_source": _fresh_source, **overrides}


# ── Admitted ──


def test_an_admitted_request_reaches_the_route_with_the_admission_result():
    reached: list = []
    calls: list = []

    def source(subjects, tenant):
        calls.append((subjects, tenant))
        return _snapshot(subjects)

    response = _post(_client(reached, **_strict(revocation_source=source)), _bundle())
    assert response.status_code == 200, response.json()
    (agent,) = reached
    assert (agent.dcp_version, agent.agent_id, agent.human_id) == ("2.0", "agent:acme-bot", "human:acme-ops")
    assert agent.admitted is True
    assert agent.principal_trust == "trusted"
    assert agent.profile == "strict-v1"
    assert agent.profile_compliance == "compliant"
    assert agent.recorded_decision == "approve"
    assert agent.trust_set_version == TRUST["trust_set_version"]
    assert agent.action_authorized is False
    assert agent.composite_sig_valid is True and agent.session_nonce
    assert calls == [(SUBJECTS, "")]


def test_an_async_revocation_source_and_trust_callable_are_awaited():
    reached: list = []

    async def source(subjects, tenant):
        return _snapshot(subjects)

    async def trust(tenant):
        return TRUST

    response = _post(_client(reached, **_strict(revocation_source=source, trusted_principals=trust)), _bundle())
    assert response.status_code == 200, response.json()
    assert reached[0].admitted is True


def test_trusted_principals_without_a_profile():
    reached: list = []
    response = _post(_client(reached, trusted_principals=TRUST), _bundle())
    assert response.status_code == 200, response.json()
    (agent,) = reached
    assert (agent.admitted, agent.principal_trust, agent.profile, agent.profile_compliance) == (
        True, "trusted", None, "not_evaluated",
    )


# ── Refused ──


def test_an_unknown_principal_is_refused():
    reached: list = []
    response = _post(_client(reached, **_strict()), _bundle("unknown_principal"))
    assert response.status_code == 403
    body = response.json()
    assert body["codes"] == ["TRUST_PRINCIPAL_UNKNOWN"]
    assert (body["verified"], body["admitted"], body["principal_trust"]) == (True, False, "untrusted")
    assert (body["profile"], body["profile_compliance"]) == ("strict-v1", "compliant")
    assert body["errors"][0].startswith("TRUST_PRINCIPAL_UNKNOWN: ")
    assert reached == []


def test_an_attacker_using_a_known_human_id_is_refused():
    reached: list = []
    response = _post(_client(reached, trusted_principals=TRUST), _bundle("attacker_claims_known_human_id"))
    assert response.status_code == 403
    assert response.json()["codes"] == ["TRUST_KEY_NOT_ANCHORED"]
    assert reached == []


def test_a_trust_set_change_refuses_the_same_bundle_on_the_next_request():
    reached: list = []
    current = {"set": TRUST}
    client = _client(reached, **_strict(trusted_principals=lambda tenant: current["set"]))

    assert _post(client, _bundle()).status_code == 200
    assert len(reached) == 1

    current["set"] = VECTORS["trust_sets"]["empty"]  # the principal is dropped
    response = _post(client, _bundle())
    assert response.status_code == 403 and response.json()["codes"] == ["TRUST_PRINCIPAL_UNKNOWN"]

    current["set"] = VECTORS["trust_sets"]["classical_revoked"]  # a key is revoked in the trust set
    response = _post(client, _bundle())
    assert response.status_code == 403 and response.json()["codes"] == ["TRUST_KEY_REVOKED"]

    current["set"] = TRUST
    assert _post(client, _bundle()).status_code == 200
    assert len(reached) == 2


class _InvalidSource(Exception):
    code = "REVOCATION_INVALID"


_BLOCK = threading.Event()


def _blocking_source(subjects, tenant):
    # Answers after the middleware's 0.1 s timeout (the test client then waits for the
    # worker thread, so keep this short).
    _BLOCK.wait(0.4)
    return _snapshot(subjects)


async def _hanging_source(subjects, tenant):
    await asyncio.Event().wait()


def _raise(exc):
    def source(subjects, tenant):
        raise exc

    return source


@pytest.mark.parametrize(
    "source,code",
    [
        (lambda s, t: _snapshot(s, revoked=("agent:acme-bot",)), "REVOCATION_REVOKED"),
        (lambda s, t: _snapshot(s, revoked=(s["kids"][0],)), "REVOCATION_REVOKED"),
        (lambda s, t: None, "REVOCATION_UNAVAILABLE"),
        (_raise(RuntimeError("source down")), "REVOCATION_UNAVAILABLE"),
        (_raise(RevocationSourceError("REVOCATION_UNAVAILABLE", "down")), "REVOCATION_UNAVAILABLE"),
        (_raise(_InvalidSource()), "REVOCATION_INVALID"),
        (_raise(RevocationSourceError("REVOCATION_INVALID", "not a deny list")), "REVOCATION_INVALID"),
        (lambda s, t: "not_revoked", "REVOCATION_INVALID"),
        (_hanging_source, "REVOCATION_UNAVAILABLE"),
        (_blocking_source, "REVOCATION_UNAVAILABLE"),
        (lambda s, t: _snapshot(s, checked_at="2026-11-02T09:55:59.999Z"), "REVOCATION_STALE"),
        (lambda s, t: {**_snapshot(s), "keys": {}}, "REVOCATION_UNKNOWN"),
    ],
    ids=[
        "agent_revoked", "key_revoked", "none", "raises", "raises_unavailable", "raises_invalid_code",
        "raises_invalid", "not_a_snapshot", "async_timeout", "sync_timeout", "stale", "subject_missing",
    ],
)
def test_the_revocation_source_never_fails_open(source, code):
    reached: list = []
    _BLOCK.clear()
    try:
        response = _post(_client(reached, **_strict(revocation_source=source, revocation_timeout=0.1)), _bundle())
    finally:
        _BLOCK.set()
    assert response.status_code == 403
    body = response.json()
    assert body["codes"] == [code]
    assert (body["verified"], body["principal_trust"], body["profile_compliance"]) == (True, "trusted", "non_compliant")
    assert reached == []


def test_the_revocation_source_is_not_asked_about_a_bundle_that_does_not_verify():
    reached: list = []
    calls: list = []
    client = _client(reached, **_strict(revocation_source=lambda s, t: calls.append(s) or _snapshot(s)))
    response = _post(client, _bundle("other_intended_verifier"))
    assert response.status_code == 403
    assert response.json()["codes"] == ["PROFILE_AUDIENCE_MISMATCH", "VERIFICATION_FAILED"]
    assert calls == [] and reached == []


# ── Tenants ──


def test_tenant_isolation():
    reached: list = []
    trust_calls: list = []
    revocation_calls: list = []
    stranger_only = copy.deepcopy(VECTORS["trust_sets"]["stranger_trusted_too"])
    stranger_only["principals"] = [p for p in stranger_only["principals"] if p["human_id"] != "human:acme-ops"]
    assert stranger_only["principals"]
    sets = {"tenant-a": TRUST, "tenant-b": stranger_only}

    def trust(tenant):
        trust_calls.append(tenant)
        return sets.get(tenant, VECTORS["trust_sets"]["empty"])

    def source(subjects, tenant):
        revocation_calls.append(tenant)
        return _snapshot(subjects)

    client = _client(
        reached,
        operator_auth=True,
        **_strict(trusted_principals=trust, revocation_source=source, tenant=lambda request: request.state.tenant),
    )
    assert _post(client, _bundle(), headers={"Authorization": "Bearer token-a"}).status_code == 200
    assert len(reached) == 1

    # Tenant B's trust set lacks this principal: refused, however the request names a tenant.
    attempts = [
        {"headers": {"Authorization": "Bearer token-b"}},
        {"headers": {"Authorization": "Bearer token-b", "X-Tenant": "tenant-a", "X-DCP-Tenant": "tenant-a",
                     "Tenant": "tenant-a"}},
        {"headers": {"Authorization": "Bearer token-b"}, "params": {"tenant": "tenant-a"}},
        {"headers": {"X-Tenant": "tenant-a"}},  # unauthenticated: the operator's tenant is ""
    ]
    for attempt in attempts:
        response = _post(client, _bundle(), **attempt)
        assert response.status_code == 403, attempt
        assert response.json()["codes"] == ["TRUST_PRINCIPAL_UNKNOWN"]
    response = client.post(
        "/action",
        json={"signed_bundle": _bundle(), "tenant": "tenant-a"},
        headers={"Authorization": "Bearer token-b"},
    )
    assert response.status_code == 403
    assert len(reached) == 1
    assert trust_calls == ["tenant-a", "tenant-b", "tenant-b", "tenant-b", "", "tenant-b"]
    assert revocation_calls == ["tenant-a", "tenant-b", "tenant-b", "tenant-b", "", "tenant-b"]


def test_an_unavailable_trust_set_or_tenant_fails_closed():
    reached: list = []

    def broken(tenant):
        raise ConnectionError("trust store down")

    for kwargs in (
        {"trusted_principals": broken},
        {"trusted_principals": lambda tenant: {"trust_set_version": "x", "principals": "nope"}},
        {"trusted_principals": TRUST, "tenant": lambda request: None},
        {"trusted_principals": TRUST, "tenant": lambda request: request.state.missing},
    ):
        response = _post(_client(reached, **kwargs), _bundle())
        assert response.status_code == 503, kwargs
        assert response.json()["admitted"] is False
    assert reached == []


# ── V1, no bundle, unchanged behaviour ──


def test_v1_bundles_are_refused_with_trusted_principals():
    reached: list = []
    lenient = {"allow_v1_bundles": True, "default_mode": "classical_only"}
    v1 = _bundle("v1_bundle")

    response = _post(_client(reached, trusted_principals=TRUST, verifier_policy=lenient), v1)
    assert response.status_code == 403
    assert response.json()["codes"] == ["VERIFICATION_FAILED"]

    calls: list = []
    response = _post(_client(reached, **_strict(revocation_source=lambda s, t: calls.append(s))), v1)
    assert response.status_code == 403
    assert response.json()["codes"] == ["PROFILE_V2_REQUIRED"]
    assert reached == [] and calls == []


@pytest.mark.parametrize("admission", [_strict(), {"trusted_principals": TRUST}], ids=["profile", "trust_only"])
def test_a_request_without_a_bundle_never_reaches_the_route(admission):
    reached: list = []
    client = _client(reached, **admission)
    assert client.post("/action", json={}).status_code == 403
    assert client.post("/action", json={"signed_bundle": {}}).status_code == 403
    assert client.post("/action").status_code == 403
    assert reached == []


def test_without_the_new_arguments_the_middleware_behaves_as_before():
    reached: list = []
    app = FastAPI()
    app.add_middleware(DCPVerifyMiddleware, require_bundle=True)

    @app.post("/action")
    async def action(request: Request):
        reached.append(request.state.dcp_agent)
        return {}

    client = TestClient(app)
    response = client.post("/action", json={"signed_bundle": copy.deepcopy(BUNDLE_VECTORS["signed_bundle"])})
    assert response.status_code == 200, response.json()
    (agent,) = reached
    assert agent.dcp_version == "2.0" and agent.composite_sig_valid
    assert (agent.admitted, agent.principal_trust, agent.profile, agent.trust_set_version) == (
        False, "not_evaluated", None, None,
    )
    # A refusal keeps its former shape.
    unknown = _bundle("unknown_principal")
    unknown["bundle"]["manifest"]["audit_count"] = 99
    body = client.post("/action", json={"signed_bundle": unknown}).json()
    assert set(body) == {"verified", "dcp_version", "errors", "warnings"}
    assert len(reached) == 1


def test_the_clock_applies_without_admission_too():
    reached: list = []
    # The base bundle's session runs from 10:00 to 10:05 on 2 November 2026.
    assert _post(_client(reached), _bundle()).status_code == 200
    late = _client(reached, clock=lambda: NOW + 3_600_000)
    assert _post(late, _bundle()).status_code == 403
    assert len(reached) == 1


def test_refusals_are_bounded_and_carry_no_key_material():
    reached: list = []
    huge = _bundle()
    huge["bundle"]["responsible_principal_record"]["payload"]["human_id"] = "x‮" * 50_000
    response = _post(_client(reached, trusted_principals=TRUST), huge)
    assert response.status_code == 403
    body = response.json()
    assert body["codes"] == ["VERIFICATION_FAILED"]
    for message in body["errors"]:
        assert len(message) <= 600 and "‮" not in message
    for key in TRUST["principals"][0]["keys"]:
        assert key["public_key_b64"] not in response.text
    assert reached == []


# ── Configuration ──


def _fixed(subjects, tenant):
    return None


@pytest.mark.parametrize(
    "kwargs,code",
    [
        ({"profile": STRICT, "revocation_source": _fixed, "require_bundle": True}, "CONFIG_PROFILE_CONTRADICTION"),
        ({"profile": STRICT, "trusted_principals": TRUST, "require_bundle": True}, "CONFIG_PROFILE_CONTRADICTION"),
        ({**_strict(), "require_bundle": True, "verifier_policy": {"default_mode": "hybrid_required"}},
         "CONFIG_PROFILE_CONTRADICTION"),
        ({**_strict(), "require_bundle": False}, "CONFIG_PROFILE_CONTRADICTION"),
        (_strict(), "CONFIG_PROFILE_CONTRADICTION"),  # require_bundle defaults to False
        ({**_strict(), "require_bundle": True, "profile": {**STRICT, "verifier_policy": {"allow_v1_bundles": True}}},
         "CONFIG_PROFILE_CONTRADICTION"),
        ({**_strict(), "require_bundle": True, "profile": {**STRICT, "fail_open": True}}, "CONFIG_UNKNOWN_FIELD"),
        ({**_strict(), "require_bundle": True, "trusted_principals": {"trust_set_version": "", "principals": []}},
         "CONFIG_INVALID_VALUE"),
        ({"trusted_principals": 42}, "CONFIG_INVALID_VALUE"),
        ({"trusted_principals": [TRUST]}, "CONFIG_INVALID_VALUE"),
        ({**_strict(), "require_bundle": True, "revocation_source": "https://revocations.example"},
         "CONFIG_INVALID_VALUE"),
        ({**_strict(), "require_bundle": True, "revocation_timeout": 0}, "CONFIG_INVALID_VALUE"),
        ({**_strict(), "require_bundle": True, "revocation_timeout": True}, "CONFIG_INVALID_VALUE"),
        ({**_strict(), "require_bundle": True, "revocation_timeout": float("inf")}, "CONFIG_INVALID_VALUE"),
        ({"trusted_principals": TRUST, "require_bundle": True, "tenant": "tenant-a"}, "CONFIG_INVALID_VALUE"),
        ({"trusted_principals": TRUST, "require_bundle": True, "clock": 0}, "CONFIG_INVALID_VALUE"),
        ({"trusted_principals": TRUST, "require_bundle": True, "revocation_source": _fixed}, "CONFIG_INVALID_VALUE"),
        ({"trusted_principals": TRUST}, "CONFIG_PROFILE_CONTRADICTION"),  # require_bundle defaults to False
        ({"trusted_principals": TRUST, "require_bundle": False}, "CONFIG_PROFILE_CONTRADICTION"),
        ({"trusted_principals": lambda tenant: TRUST, "require_bundle": False}, "CONFIG_PROFILE_CONTRADICTION"),
    ],
    ids=[
        "profile_without_trust", "profile_without_revocation_source", "profile_with_verifier_policy",
        "profile_with_require_bundle_false", "profile_with_default_require_bundle", "profile_weakened",
        "profile_unknown_field", "trust_set_invalid", "trust_not_a_set", "trust_a_list", "source_not_callable",
        "timeout_zero", "timeout_bool", "timeout_infinite", "tenant_not_callable", "clock_not_callable",
        "revocation_source_without_profile", "trust_with_default_require_bundle", "trust_with_require_bundle_false",
        "trust_callable_with_require_bundle_false",
    ],
)
def test_contradictions_and_wrong_types_raise_at_construction(kwargs, code):
    with pytest.raises(AdmissionConfigError) as caught:
        DCPVerifyMiddleware(FastAPI(), **kwargs)
    assert caught.value.code == code


def test_unknown_arguments_raise_at_construction():
    with pytest.raises(TypeError):
        DCPVerifyMiddleware(FastAPI(), trusted_principals=TRUST, trust_header="x-tenant")


def test_the_integration_example_runs(capsys):
    runpy.run_path(str(REPO_ROOT / "integrations" / "fastapi" / "examples" / "strict_v1.py"), run_name="__main__")
    lines = capsys.readouterr().out.splitlines()
    assert [line.split(" ", 2)[:2] for line in lines] == [
        ["base:", "200"], ["unknown_principal:", "403"], ["other_intended_verifier:", "403"],
    ]
    assert '"action_authorized": false' in lines[0] and "TRUST_PRINCIPAL_UNKNOWN" in lines[1]


# ── deny_list_revocation_source ──

KID = SUBJECTS["kids"][0]
_SLOW = threading.Event()


def _deny_list(agents=(), kids=()) -> dict:
    return {
        "dcp_version": "2.0",
        "updated_at": CHECKED_AT,
        "revocations": [{"agent_id": a, "reason": "test"} for a in agents],
        "kid_revocations": [{"revoked_kid": k, "agent_id": "agent:acme-bot"} for k in kids],
    }


class _DenyListHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 (http.server's name)
        if self.path == "/ok":
            self._send(200, _deny_list())
        elif self.path == "/revoked":
            self._send(200, _deny_list(agents=["agent:acme-bot"], kids=[KID]))
        elif self.path == "/other-revoked":
            self._send(200, _deny_list(agents=["agent:other"], kids=["0" * 32]))
        elif self.path == "/error":
            self._send(500, {"error": "unavailable"})
        elif self.path == "/malformed":
            self._send(200, b"<html>not json</html>")
        elif self.path == "/wrong-shape":
            self._send(200, {"updated_at": CHECKED_AT, "revocations": "none", "kid_revocations": []})
        elif self.path == "/no-updated-at":
            self._send(200, {"revocations": [], "kid_revocations": []})
        elif self.path == "/slow":
            _SLOW.wait(5)
            self._send(200, _deny_list())
        elif self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/ok")
            self.end_headers()
        elif self.path == "/authenticated":
            if self.headers.get("Authorization") == "Bearer test-only":
                self._send(200, _deny_list())
            else:
                self._send(401, {"error": "unauthorized"})
        else:
            self._send(404, {})

    def _send(self, status, body):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except OSError:  # the client gave up (the timeout cases)
            pass

    def log_message(self, *args):
        pass


@pytest.fixture(scope="module")
def deny_list_url():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _DenyListHandler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    _SLOW.set()
    server.shutdown()
    server.server_close()


@pytest.mark.asyncio
async def test_deny_list_source_answers_for_every_subject(deny_list_url):
    snapshot = await deny_list_revocation_source(f"{deny_list_url}/ok")(SUBJECTS, "")
    assert snapshot == _snapshot(SUBJECTS)
    snapshot = await deny_list_revocation_source(f"{deny_list_url}/revoked")(SUBJECTS, "")
    assert snapshot == _snapshot(SUBJECTS, revoked=("agent:acme-bot", KID))
    snapshot = await deny_list_revocation_source(f"{deny_list_url}/other-revoked")(SUBJECTS, "")
    assert snapshot == _snapshot(SUBJECTS)
    source = deny_list_revocation_source(f"{deny_list_url}/authenticated", headers={"Authorization": "Bearer test-only"})
    assert (await source(SUBJECTS, ""))["checked_at"] == CHECKED_AT


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path,code",
    [
        ("/error", "REVOCATION_UNAVAILABLE"),
        ("/missing", "REVOCATION_UNAVAILABLE"),
        ("/redirect", "REVOCATION_UNAVAILABLE"),
        ("/authenticated", "REVOCATION_UNAVAILABLE"),
        ("/slow", "REVOCATION_UNAVAILABLE"),
        ("/malformed", "REVOCATION_INVALID"),
        ("/wrong-shape", "REVOCATION_INVALID"),
        ("/no-updated-at", "REVOCATION_INVALID"),
    ],
)
async def test_deny_list_source_failures(deny_list_url, path, code):
    _SLOW.clear()
    source = deny_list_revocation_source(f"{deny_list_url}{path}", timeout=0.2)
    try:
        with pytest.raises(RevocationSourceError) as caught:
            await source(SUBJECTS, "")
    finally:
        _SLOW.set()
    assert caught.value.code == code


@pytest.mark.asyncio
async def test_deny_list_source_unreachable():
    # Nothing listens on port 9 (discard) of this host.
    with pytest.raises(RevocationSourceError) as caught:
        await deny_list_revocation_source("http://127.0.0.1:9/list", timeout=1)(SUBJECTS, "")
    assert caught.value.code == "REVOCATION_UNAVAILABLE"


@pytest.mark.parametrize(
    "args,kwargs,error",
    [
        (("file:///etc/hosts",), {}, ValueError),
        (("ftp://example.test/list",), {}, ValueError),
        (("https://",), {}, ValueError),
        ((42,), {}, TypeError),
        (("https://revocations.example/list",), {"timeout": 0}, ValueError),
        (("https://revocations.example/list",), {"timeout": True}, ValueError),
        (("https://revocations.example/list",), {"headers": {"Authorization": 1}}, TypeError),
        # Without TLS only to a loopback host.
        (("http://revocations.example/list",), {}, ValueError),
        (("http://10.0.0.5/list",), {}, ValueError),
    ],
)
def test_deny_list_source_configuration(args, kwargs, error):
    with pytest.raises(error):
        deny_list_revocation_source(*args, **kwargs)


@pytest.mark.parametrize("url", ["https://revocations.example/list", "http://localhost:3003/list", "http://127.0.0.1/list", "http://[::1]/list"])
def test_deny_list_source_accepts_https_and_loopback_http(url):
    deny_list_revocation_source(url)


@pytest.mark.parametrize(
    "path,status,codes",
    [
        ("/ok", 200, None),
        ("/revoked", 403, ["REVOCATION_REVOKED"]),
        ("/error", 403, ["REVOCATION_UNAVAILABLE"]),
        ("/malformed", 403, ["REVOCATION_INVALID"]),
        ("/slow", 403, ["REVOCATION_UNAVAILABLE"]),
    ],
)
def test_the_middleware_with_a_deny_list_source(deny_list_url, path, status, codes):
    reached: list = []
    _SLOW.clear()
    source = deny_list_revocation_source(f"{deny_list_url}{path}", timeout=0.2)
    try:
        response = _post(_client(reached, **_strict(revocation_source=source, require_bundle=True)), _bundle())
    finally:
        _SLOW.set()
    assert response.status_code == status, response.json()
    if codes is None:
        assert reached[0].admitted is True
    else:
        assert response.json()["codes"] == codes
        assert reached == []
