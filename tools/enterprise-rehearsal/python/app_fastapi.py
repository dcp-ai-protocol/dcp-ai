"""Python lane of the MP-05 rehearsal (TEST ONLY).

Direct route: a mounted sub-application with the installed dcp_ai.fastapi DCPVerifyMiddleware, which admits the bundle
under strict-v1 with the sample configuration of docs/OPERATIONAL_LIMITS.md. Delegated route: another sub-application,
where the application composes and activates the chain with the public SDK (evaluate_delegation_activation_v2) and its
own bounded sources; the middleware has no part in it. On both routes the application then authorizes the action
(operator policy and, delegated, every mandate) and reserves single-use actions in the ledger. action_authorized from
DCP is always false; application_authorized is this application's.

Order of a request (the outer ASGI layer, before any DCP work): X-DCP-Bundle refused (the middleware would prefer that
header to the body) -> JSON content type -> bearer token (the only source of the tenant) -> body read with the route
budget, counted while it arrives -> ingress policy (../ingress_python.py) -> envelope. The body is then handed on
unchanged.

    <consumer>/python/bin/python -I python/app_fastapi.py CONFIG.json     (spawned by the runner)
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import re
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent)]

from rehearsal_authz import authorize  # noqa: E402
from rehearsal_ledger import action_key, append_effect, reserve  # noqa: E402
from rehearsal_sources import (  # noqa: E402
    assert_installed_sdk,
    assert_verified,
    check_staged,
    composition_subjects,
    load_contract,
    mandate_snapshot,
    read_json,
)

import uvicorn  # noqa: E402
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from ingress_python import IngressError, parse_request  # noqa: E402

from dcp_ai.fastapi import DCPVerifyMiddleware, SourceSupervisor  # noqa: E402
from dcp_ai.providers import Ed25519Provider, MlDsa65Provider  # noqa: E402
from dcp_ai.v2 import (  # noqa: E402
    AlgorithmRegistry,
    DenyListWorkers,
    create_principal_trust_store,
    deny_list_revocation_source,
    evaluate_delegation_activation_v2,
    revocation_snapshot_from_deny_list,
)

CONFIG = read_json(sys.argv[1])
assert_installed_sdk()
check_staged()
assert_verified(CONFIG["verify_report"], CONFIG["consumer"])
CONTRACT = load_contract()
STATE = Path(CONFIG["state"])
RUN = Path(CONFIG["run"])
LEDGER = RUN / "ledger"
LEDGER.mkdir(mode=0o700, parents=True, exist_ok=True)
EFFECTS = RUN / "executions.jsonl"
OBSERVATIONS = RUN / "observations.jsonl"
LOG = RUN / "app.log"
TOKENS = read_json(STATE / "operator" / "tokens.json")
PROFILE = {"profile": "strict-v1", "verifier_id": CONTRACT["verifier_id"]}
BUDGET = {"direct": CONTRACT["routes"]["direct"]["max_body_bytes"], "delegated": CONTRACT["routes"]["delegated"]["max_body_bytes"]}
LIMITS = {"mandate_chain": 4, "delegator_bundles": 3, "acknowledgments": 4, "awareness_thresholds": 4}
SOURCE_TIMEOUT, SOURCE_MAX_BYTES = 1.5, 1024 * 1024
ROUTE = re.compile(r"/v1/(direct|delegated)/actions/([^/]{1,64})")
REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")
COUNTERS = {"trust_calls": 0, "list_fetches": {"deny_list": 0, "mandates": 0}, "requests": 0}
REGISTRY = AlgorithmRegistry()
REGISTRY.register_signer(Ed25519Provider())
REGISTRY.register_signer(MlDsa65Provider())


def loopback(url: str) -> tuple[int, str]:
    u = urlsplit(url)
    if u.scheme != "http" or u.hostname != "127.0.0.1" or u.username or u.password or not u.port:
        raise ValueError(f"not a loopback URL: {url}")
    return u.port, u.path


DENY_URL, MANDATES_URL = CONFIG["revocation"]["deny_list_url"], CONFIG["revocation"]["mandates_url"]
loopback(DENY_URL)
loopback(MANDATES_URL)


def log(message: str) -> None:
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"{datetime.now(timezone.utc).isoformat()} {message}\n")


def token_owner(authorization: str | None, hashes: dict) -> str | None:
    m = re.fullmatch(r"Bearer ([0-9a-f]{64})", authorization or "")
    if not m:
        return None
    presented = hashlib.sha256(m.group(1).encode()).hexdigest()
    owner = None
    for name, digest in hashes.items():
        if hmac.compare_digest(presented, str(digest)):
            owner = name
    return owner


def exact(o, keys) -> bool:
    return isinstance(o, dict) and len(o) == len(keys) and all(k in o for k in keys)


def envelope_is_valid(route: str, body) -> bool:
    if route == "direct":
        return exact(body, ["signed_bundle", "args"]) and isinstance(body["signed_bundle"], dict)
    if not exact(body, ["evidence", "args"]):
        return False
    e = body["evidence"]
    return (
        exact(e, ["signed_bundle", *LIMITS])
        and isinstance(e["signed_bundle"], dict)
        and all(isinstance(e[k], list) and len(e[k]) <= m for k, m in LIMITS.items())
    )


def tenant_file(tenant: str, name: str) -> Path:
    return STATE / "operator" / "tenants" / tenant / name


async def read_trust(tenant: str):
    """The operator's trust set for the tenant, read at every admission: withdrawal and rotation need no restart."""
    COUNTERS["trust_calls"] += 1
    return json.loads(tenant_file(tenant, "trust.json").read_text(encoding="utf-8"))


async def fetch_list(url: str, name: str):
    """GET a JSON list from the loopback source: one deadline for the whole exchange, a response budget, no redirects
    (anything but 200 fails). None when the source cannot answer: never "not revoked"."""
    COUNTERS["list_fetches"][name] += 1
    port, target = loopback(url)

    async def exchange():
        reader, writer = await asyncio.open_connection("127.0.0.1", port, limit=SOURCE_MAX_BYTES)
        try:
            writer.write(f"GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n".encode())
            await writer.drain()
            head = (await reader.readuntil(b"\r\n\r\n")).decode("latin-1").split("\r\n")
            if head[0].split(" ")[1] != "200":
                raise ValueError(head[0])
            headers = {line.split(":", 1)[0].strip().lower(): line.split(":", 1)[1].strip() for line in head[1:] if ":" in line}
            length = int(headers["content-length"])
            if length > SOURCE_MAX_BYTES:
                raise ValueError("source response over budget")
            return json.loads(await reader.readexactly(length))
        finally:
            writer.close()

    try:
        return await asyncio.wait_for(exchange(), SOURCE_TIMEOUT)
    except Exception:  # noqa: BLE001 - any failure of the source is "unavailable"
        return None


def refuse(request: Request, status: int, code: str, **extra) -> JSONResponse:
    request.state.code = code
    return JSONResponse(status_code=status, content={"ok": False, "code": code, **extra})


def finish(request: Request, decision: dict, payload_hash: str, route: str, dcp: dict) -> JSONResponse:
    """dcp: the real DCP outcome (admitted, delegation_active on the delegated route, action_authorized)."""
    if not decision["ok"]:
        return refuse(request, 403, decision["code"], detail=decision["detail"], dcp=dcp)
    tenant = request.state.tenant
    key = None
    if decision["single_use"]:
        key = action_key(tenant, payload_hash)
        if not reserve(LEDGER, tenant, key):
            return refuse(request, 409, "APP_ALREADY_CONSUMED", dcp=dcp)
    append_effect(
        EFFECTS,
        {
            "lane": CONFIG["lane"],
            "tenant": tenant,
            "route": route,
            "action": decision["action"],
            "amount": decision["amount"],
            "key": key,
            "request_id": request.state.request_id,
            "at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return JSONResponse(
        status_code=200,
        content={"ok": True, "action": decision["action"], "single_use": decision["single_use"], "application_authorized": True, "dcp": dcp},
    )


direct_app = FastAPI()
direct_app.add_middleware(
    DCPVerifyMiddleware,
    require_bundle=True,
    trusted_principals=read_trust,
    profile=PROFILE,
    revocation_source=deny_list_revocation_source(DENY_URL, timeout=SOURCE_TIMEOUT, workers=DenyListWorkers(max_workers=8, max_workers_per_tenant=2)),
    revocation_timeout=2.0,
    tenant=lambda request: request.state.tenant,
    max_body_bytes=BUDGET["direct"],
    source_supervisor=SourceSupervisor(max_in_flight=32, max_in_flight_per_tenant=8),
    supervise={"trust_timeout": 2.0, "revocation": True},
    cancel_on_disconnect=True,
)


@direct_app.post("/actions/{action}")
async def direct(action: str, request: Request):
    bundle = request.state.envelope["signed_bundle"]["bundle"]
    agent = request.state.dcp_agent
    # The middleware admitted body["signed_bundle"] (X-DCP-Bundle was refused before it): the same evidence is authorized.
    if agent.agent_id != bundle["agent_passport"]["payload"]["agent_id"]:
        raise RuntimeError("admitted agent differs from the body")
    # The middleware's real result: admitted, and DCP never authorizes the action. Anything else is an infrastructure
    # fault (500, no effect), never a response that hides the value.
    if agent.admitted is not True or agent.action_authorized is not False:
        raise RuntimeError("admission invariant violated")
    dcp = {"admitted": agent.admitted, "action_authorized": agent.action_authorized}
    decision = authorize(
        CONTRACT,
        read_json(tenant_file(request.state.tenant, "policy.json")),
        "direct",
        action,
        request.state.envelope["args"],
        bundle["intent"]["payload"],
        agent_id=agent.agent_id,
        principal_id=bundle["responsible_principal_record"]["payload"]["human_id"],
    )
    return finish(request, decision, bundle["intent"]["payload_hash"], "direct", dcp)


delegated_app = FastAPI()


@delegated_app.post("/actions/{action}")
async def delegated(action: str, request: Request):
    e = request.state.envelope["evidence"]
    try:
        trust = await read_trust(request.state.tenant)
        create_principal_trust_store(trust)
    except Exception:  # noqa: BLE001 - no trust set for the tenant
        return refuse(request, 503, "APP_TRUST_UNAVAILABLE")
    deny_list, mandate_list = await asyncio.gather(fetch_list(DENY_URL, "deny_list"), fetch_list(MANDATES_URL, "mandates"))
    evidence = {
        "signed_bundle": e["signed_bundle"],
        "mandate_chain": e["mandate_chain"],
        "delegator_bundles": e["delegator_bundles"],
        "acknowledgments": e["acknowledgments"],
        "awareness_thresholds": e["awareness_thresholds"],
    }
    revocation = None
    if deny_list is not None:
        try:
            revocation = revocation_snapshot_from_deny_list(deny_list, composition_subjects(evidence))
        except Exception:  # noqa: BLE001 - an unreadable list gives no snapshot
            revocation = None
    r = await evaluate_delegation_activation_v2(
        evidence,
        REGISTRY,
        {
            "trust": trust,
            "profile": PROFILE,
            "revocation": revocation,
            "mandate_revocation": mandate_snapshot(mandate_list, e["mandate_chain"]),
            "now_ms": int(datetime.now(timezone.utc).timestamp() * 1000),
        },
    )
    # The SDK's real result. DCP never authorizes the action, and an active delegation needs an admitted composition;
    # anything else is an infrastructure fault (500, no effect).
    if r["action_authorized"] is not False or r["composition"]["action_authorized"] is not False:
        raise RuntimeError("action_authorized invariant violated")
    if r["delegation_active"] is True and r["composition"]["admitted"] is not True:
        raise RuntimeError("activation invariant violated")
    dcp = {"admitted": r["composition"]["admitted"], "delegation_active": r["delegation_active"], "action_authorized": r["action_authorized"]}
    if not r["composition"]["admitted"]:
        codes = sorted({x["code"] for x in r["composition"]["errors"]})
        return JSONResponse(status_code=403, content={"ok": False, "codes": codes, "dcp": dcp})
    if not r["delegation_active"]:
        return refuse(request, 403, "APP_DELEGATION_NOT_ACTIVE", activation_codes=[x["code"] for x in r["errors"]], dcp=dcp)
    bundle = e["signed_bundle"]["bundle"]
    decision = authorize(
        CONTRACT,
        read_json(tenant_file(request.state.tenant, "policy.json")),
        "delegated",
        action,
        request.state.envelope["args"],
        bundle["intent"]["payload"],
        agent_id=bundle["agent_passport"]["payload"]["agent_id"],
        principal_id=bundle["responsible_principal_record"]["payload"]["human_id"],
        chain=e["mandate_chain"],
    )
    return finish(request, decision, bundle["intent"]["payload_hash"], "delegated", dcp)


routes = FastAPI()
routes.mount("/v1/direct", direct_app)
routes.mount("/v1/delegated", delegated_app)


class Front:
    """Outer ASGI layer: everything before DCP work, the operator's state endpoint, and one observation per request."""

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.inner(scope, receive, send)
        headers: dict[str, str] = {}
        for k, v in scope["headers"]:
            name = k.decode("latin-1").lower()
            headers[name] = f"{headers[name]},{v.decode('latin-1')}" if name in headers else v.decode("latin-1")
        state = scope.setdefault("state", {})
        rid = headers.get("x-request-id", "")
        state["request_id"] = rid if REQUEST_ID.fullmatch(rid) else None
        observation = {"lane": CONFIG["lane"], "request_id": state["request_id"], "route": None, "tenant": None, "code": None}
        status = {}

        async def sending(message):
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
            await send(message)

        async def respond(code_status: int, body: dict):
            payload = json.dumps(body).encode()
            await sending({"type": "http.response.start", "status": code_status, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode()), (b"connection", b"close")]})
            await sending({"type": "http.response.body", "body": payload})

        async def refusal(code_status: int, code: str, **extra):
            observation["code"] = code
            await respond(code_status, {"ok": False, "code": code, **extra})

        try:
            if scope["path"] == "/v1/operator/state" and scope["method"] == "GET":
                if token_owner(headers.get("authorization"), {"operator": TOKENS["operator"]}) != "operator":
                    return await respond(401, {"ok": False, "code": "APP_UNAUTHENTICATED"})
                return await respond(200, {"ok": True, "lane": CONFIG["lane"], **COUNTERS})
            m = ROUTE.fullmatch(scope["path"])
            if not m or scope["method"] != "POST":
                return await respond(404, {"ok": False, "code": "APP_NOT_FOUND"})
            route = m.group(1)
            observation["route"] = route
            COUNTERS["requests"] += 1
            if "x-dcp-bundle" in headers:
                return await refusal(400, "APP_BUNDLE_HEADER_REJECTED")
            if not re.fullmatch(r"application/json\s*(;\s*charset=utf-8\s*)?", headers.get("content-type", ""), re.I):
                return await refusal(415, "APP_CONTENT_TYPE_REJECTED")
            tenant = token_owner(headers.get("authorization"), TOKENS["tenants"])
            if tenant is None:
                return await refusal(401, "APP_UNAUTHENTICATED")
            state["tenant"] = observation["tenant"] = tenant
            budget = BUDGET[route]
            declared = headers.get("content-length")
            if declared is not None and (not declared.isdigit() or int(declared) > budget):
                return await refusal(413, "APP_INGRESS_TOO_LARGE")
            chunks, size = [], 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                part = message.get("body", b"")
                size += len(part)
                if size > budget:
                    return await refusal(413, "APP_INGRESS_TOO_LARGE")
                chunks.append(part)
                if not message.get("more_body", False):
                    break
            body = b"".join(chunks)
            try:
                parsed = parse_request(body, budget)
            except IngressError as e:
                return await refusal(e.status, e.code, reason=e.reason)
            if not envelope_is_valid(route, parsed):
                return await refusal(400, "APP_ENVELOPE_INVALID")
            state["envelope"] = parsed
            handed = False

            async def replay():
                nonlocal handed
                if not handed:
                    handed = True
                    return {"type": "http.request", "body": body, "more_body": False}
                return await receive()

            await self.inner(scope, replay, sending)
            observation["code"] = observation["code"] or state.get("code")
        except Exception as exc:  # noqa: BLE001 - an infrastructure fault: 500, never a refusal
            log(f"error {scope.get('path')}: {exc!r}")
            observation["code"] = "APP_INTERNAL_ERROR"
            if "code" not in status:
                await respond(500, {"ok": False, "code": "APP_INTERNAL_ERROR"})
        finally:
            if observation["route"] is not None:
                append_effect(OBSERVATIONS, {**observation, "status": status.get("code")})


def announce(event: dict) -> None:
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


async def main() -> None:
    server = uvicorn.Server(uvicorn.Config(Front(routes), host="127.0.0.1", port=0, log_config=None, access_log=False, lifespan="off"))
    serving = asyncio.create_task(server.serve())
    while not server.started:
        if serving.done():
            await serving
            raise RuntimeError("server did not start")
        await asyncio.sleep(0.01)
    announce({"ev": "ready", "port": server.servers[0].sockets[0].getsockname()[1]})
    loop = asyncio.get_running_loop()
    quit_requested = asyncio.Event()

    def watch_stdin():
        for line in sys.stdin:
            try:
                if json.loads(line).get("cmd") == "quit":
                    break
            except ValueError:
                continue
        loop.call_soon_threadsafe(quit_requested.set)

    threading.Thread(target=watch_stdin, daemon=True).start()
    await quit_requested.wait()
    server.should_exit = True
    await serving
    announce({"ev": "stopped"})


if __name__ == "__main__":
    asyncio.run(main())
