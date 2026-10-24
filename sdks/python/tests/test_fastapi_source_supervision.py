"""
DCPVerifyMiddleware source supervision (docs/reviews/admission-source-supervision-plan.md, step 1):
a deadline and a capacity for an async trusted_principals, through the real middleware over ASGI
(httpx.ASGITransport) and through SourceSupervisor directly. Every scenario runs in one event loop
under an external deadline and lets every source it started finish before it returns.

    DCP_NEGATIVE_CONTROL=1 pytest tests/test_fastapi_source_supervision.py   # must fail once
"""

from __future__ import annotations

import asyncio
import copy
import functools
import gc
import json
import math
import os
import threading
import time
import warnings
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI, Request

from dcp_ai.fastapi import DCPVerifyMiddleware, SourceSupervisor
from dcp_ai.fastapi._source_supervisor import MAX_SAFE_INTEGER, saturating_increment
from dcp_ai.v2 import AdmissionConfigError
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms

REPO_ROOT = Path(__file__).resolve().parents[3]
VECTORS = json.loads((REPO_ROOT / "tests" / "interop" / "v2" / "admission_vectors.json").read_text())
CASE_A = next(c for c in VECTORS["cases"] if c["name"] == "A_known_principal_strict")
NOW = rfc3339_epoch_ms(CASE_A["now"])
STRICT = VECTORS["profiles"]["strict"]
TRUST = VECTORS["trust_sets"]["principal"]
EMPTY = VECTORS["trust_sets"]["empty"]
NEGATIVE_CONTROL = os.environ.get("DCP_NEGATIVE_CONTROL") == "1"
UNAVAILABLE = {"verified": False, "admitted": False, "errors": ["The principal trust set is unavailable"]}
DEADLINE = 20.0


def _bundle(name: str = "base") -> dict:
    return copy.deepcopy(VECTORS["signed_bundles"][name])


def _snapshot(subjects: dict, revoked: tuple[str, ...] = ()) -> dict:
    status = lambda s: "revoked" if s in revoked else "not_revoked"  # noqa: E731
    return {
        "checked_at": CASE_A["revocation"]["checked_at"],
        "agents": {a: status(a) for a in subjects["agent_ids"]},
        "keys": {k: status(k) for k in subjects["kids"]},
    }


_HELD: list = []


def run(scenario):
    """Runs one scenario in a fresh event loop, under an external deadline. Every Held source it
    created is released at the end, also when it fails, so no source outlives the loop."""

    async def guarded():
        try:
            return await asyncio.wait_for(scenario(), DEADLINE)
        finally:
            for held in _HELD:
                held.release()
            _HELD.clear()
            await asyncio.sleep(0.01)

    return asyncio.run(guarded())


async def until(check, limit: float = 5.0):
    end = time.monotonic() + limit
    while not check():
        assert time.monotonic() < end, "condition not met in time"
        await asyncio.sleep(0.005)


async def async_trust(tenant):
    return TRUST


def _app(supervisor=None, trust=async_trust, *, timeout=0.1, reached=None, **extra) -> FastAPI:
    app = FastAPI()
    options = {"require_bundle": True, "clock": lambda: NOW, "trusted_principals": trust,
               "tenant": lambda request: request.headers.get("x-tenant", ""), **extra}
    if supervisor is not None:
        options.update(source_supervisor=supervisor, supervise={"trust_timeout": timeout})
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
        started = asyncio.get_running_loop().time()
        response = await client.post("/action", json={"signed_bundle": bundle or _bundle(), **(body or {})},
                                     headers={"x-tenant": tenant, **(headers or {})})
        return response.status_code, response.json(), asyncio.get_running_loop().time() - started


class Held:
    """A source that waits for release(), ignoring cancellation, then returns `value` (or raises)."""

    def __init__(self, value=TRUST, *, raise_after=False, reraise=False):
        self.release_event = asyncio.Event()
        self.value, self.raise_after, self.reraise = value, raise_after, reraise
        self.calls = 0
        self.cancelled = 0
        _HELD.append(self)

    async def __call__(self, tenant):
        self.calls += 1
        while True:
            try:
                await self.release_event.wait()
                break
            except asyncio.CancelledError:
                self.cancelled += 1
                if self.reraise:
                    await self.release_event.wait()
                    raise
        if self.raise_after:
            raise RuntimeError("late failure")
        return self.value

    def release(self):
        self.release_event.set()


# ── Admitted and refused as before ──


def test_a_supervised_async_source_admits_as_before():
    async def scenario():
        s = SourceSupervisor(max_in_flight=2)
        reached: list = []
        status, body, _ = await post(_app(s, reached=reached))
        assert status == (403 if NEGATIVE_CONTROL else 200), body  # the negative control inverts this
        assert reached[0].admitted is True and reached[0].action_authorized is False
        assert s.stats()["in_flight"] == 0
    run(scenario)


def test_strict_v1_audience_and_revocation_answer_as_without_supervision():
    async def scenario():
        async def fresh(subjects, tenant):
            return _snapshot(subjects)

        async def revoked(subjects, tenant):
            return _snapshot(subjects, revoked=("agent:acme-bot",))

        for bundle, source, expected in [("base", fresh, 200), ("other_intended_verifier", fresh, 403), ("base", revoked, 403)]:
            results = []
            for supervisor in (None, SourceSupervisor(max_in_flight=1)):
                results.append(await post(_app(supervisor, profile=STRICT, revocation_source=source), _bundle(bundle)))
            assert results[0][:2] == results[1][:2]
            assert results[1][0] == expected
        assert results[1][1]["codes"] == ["REVOCATION_REVOKED"]
    run(scenario)


def test_without_the_options_sync_and_async_sources_work_as_before():
    async def scenario():
        seen = []
        sync_source = lambda tenant: (seen.append(tenant), TRUST)[1]  # noqa: E731
        for trust in (sync_source, async_trust):
            status, _, _ = await post(_app(None, trust), tenant="tenant-a")
            assert status == 200
        assert seen == ["tenant-a"]
    run(scenario)


# ── Deadline ──


@pytest.mark.parametrize("mode", ["late_value", "late_error", "slow_cleanup"])
def test_a_source_that_ignores_cancellation_is_refused_at_the_deadline_and_keeps_its_slot(mode):
    async def scenario():
        s = SourceSupervisor(max_in_flight=2)
        held = Held(raise_after=mode == "late_error", reraise=mode == "slow_cleanup")
        status, body, elapsed = await post(_app(s, held))
        failing = await post(_app(None, lambda tenant: (_ for _ in ()).throw(RuntimeError("down"))))
        assert (status, body) == (503, UNAVAILABLE) == failing[:2]
        assert 0.1 <= elapsed < 0.1 + 2.0  # an outer guard: the deadline answered, not the source
        assert held.cancelled == 1
        assert s.stats() == {**s.stats(), "in_flight": 1, "tenants": 1, "timeouts": 1}  # the slot after the answer
        held.release()
        await until(lambda: s.stats()["in_flight"] == 0)
        late = "late_results" if mode == "late_value" else "late_errors"
        assert s.stats()[late] == 1 and s.stats()["tenants"] == 0
    run(scenario)


def test_a_value_returned_while_the_loop_was_blocked_past_the_deadline_is_refused():
    async def scenario():
        s = SourceSupervisor(max_in_flight=1)

        async def blocking(tenant):
            time.sleep(0.3)  # blocks the event loop past the 0.1 s deadline, then answers
            return TRUST

        status, body, _ = await post(_app(s, blocking))
        assert (status, body) == (503, UNAVAILABLE)
        assert s.stats()["timeouts"] == 1 and s.stats()["late_results"] == 1 and s.stats()["in_flight"] == 0
    run(scenario)


def test_a_late_trust_set_is_never_used_withdrawal_then_restoration():
    async def scenario():
        s = SourceSupervisor(max_in_flight=2)
        late = Held()
        answers = iter([late, lambda t: EMPTY, lambda t: TRUST])

        async def trust(tenant):
            answer = next(answers)
            result = answer(tenant)
            return await result if asyncio.iscoroutine(result) else result

        app = _app(s, trust)
        assert (await post(app))[:2] == (503, UNAVAILABLE)
        late.release()
        await until(lambda: s.stats()["late_results"] == 1)
        status, body, _ = await post(app)
        assert status == 403 and body["codes"] == ["TRUST_PRINCIPAL_UNKNOWN"]
        assert (await post(app))[0] == 200
    run(scenario)


@pytest.mark.parametrize("answer", [None, {}, {"trust_set_version": "", "principals": []}])
def test_a_source_that_answers_no_valid_trust_set_gets_the_same_503(answer):
    async def scenario():
        async def source(tenant):
            return answer

        assert (await post(_app(SourceSupervisor(max_in_flight=1), source)))[:2] == (503, UNAVAILABLE)
        assert (await post(_app(None, source)))[:2] == (503, UNAVAILABLE)
    run(scenario)


def test_a_source_that_cancels_itself_gets_503_not_a_cancelled_request():
    async def scenario():
        s = SourceSupervisor(max_in_flight=1)

        async def source(tenant):
            raise asyncio.CancelledError()

        assert (await post(_app(s, source)))[:2] == (503, UNAVAILABLE)
        assert s.stats()["in_flight"] == 0
    run(scenario)


# ── Capacity ──


def test_capacity_is_held_after_the_answer_and_call_n_plus_1_is_refused_without_calling_the_source():
    async def scenario():
        s = SourceSupervisor(max_in_flight=1)
        held = Held()
        app = _app(s, held)
        assert (await post(app))[:2] == (503, UNAVAILABLE)
        assert (await post(app))[:2] == (503, UNAVAILABLE)  # saturated
        assert held.calls == 1
        assert {k: s.stats()[k] for k in ("in_flight", "timeouts", "saturated")} == {"in_flight": 1, "timeouts": 1, "saturated": 1}
        held.release()
        await until(lambda: s.stats()["in_flight"] == 0)
        assert (await post(_app(s))) [0] == 200
    run(scenario)


def test_call_n_plus_1_is_decided_without_suspending_no_waiter_no_timer():
    async def scenario():
        s = SourceSupervisor(max_in_flight=1)
        held = Held()
        first = asyncio.ensure_future(s._run("t", 5, lambda: held("t")))
        await until(lambda: held.calls == 1)
        second = s._run("t", 5, lambda: held("t"))
        with pytest.raises(StopIteration) as stop:
            second.send(None)  # finishes on the first step: it never awaits anything
        assert stop.value.value == ("saturated", None)
        assert held.calls == 1 and s.stats()["saturated"] == 1 and s.stats()["in_flight"] == 1
        held.release()
        assert await first == ("ok", TRUST)
        assert s.stats()["in_flight"] == 0
    run(scenario)


def test_per_tenant_limit_and_one_supervisor_shared_by_two_middlewares():
    async def scenario():
        s = SourceSupervisor(max_in_flight=3, max_in_flight_per_tenant=1)
        held = Held()
        a, b = _app(s, held, timeout=5), _app(s, timeout=5)
        pending = asyncio.ensure_future(post(a, tenant="tenant-a"))
        await until(lambda: held.calls == 1)
        assert (await post(b, tenant="tenant-a"))[:2] == (503, UNAVAILABLE)  # another middleware, same tenant
        assert (await post(b, tenant="tenant-b"))[0] == 200
        held.release()
        assert (await pending)[0] == 200
        shared = SourceSupervisor(max_in_flight=1)
        held = Held()
        pending = asyncio.ensure_future(post(_app(shared, held, timeout=5), tenant="x"))
        await until(lambda: held.calls == 1)
        assert (await post(_app(shared, timeout=5), tenant="y"))[:2] == (503, UNAVAILABLE)  # no tenant limit
        held.release()
        assert (await pending)[0] == 200
        assert shared.stats()["tenants"] == 0
    run(scenario)


# ── Cancellation, close() ──


def test_a_cancelled_caller_is_cancelled_and_its_source_keeps_the_slot_until_it_finishes():
    async def scenario():
        s = SourceSupervisor(max_in_flight=1)
        held = Held()
        caller = asyncio.ensure_future(s._run("t", 5, lambda: held("t")))
        await until(lambda: held.calls == 1)
        caller.cancel()
        with pytest.raises(asyncio.CancelledError):
            await caller
        await until(lambda: held.cancelled == 1)
        assert s.stats()["in_flight"] == 1
        held.release()
        await until(lambda: s.stats()["in_flight"] == 0)
        assert s.stats()["late_results"] == 1
    run(scenario)


def test_close_answers_pending_calls_refuses_new_ones_and_keeps_slots_until_sources_finish():
    async def scenario():
        s = SourceSupervisor(max_in_flight=2)
        held = Held()
        app = _app(s, held, timeout=5)
        pending = asyncio.ensure_future(post(app))
        await until(lambda: held.calls == 1)
        assert await s.close(drain_timeout=0.05) == {"in_flight": 1}
        assert (await pending)[:2] == (503, UNAVAILABLE)
        assert (await post(app))[:2] == (503, UNAVAILABLE)
        assert held.calls == 1 and held.cancelled == 1
        assert {k: s.stats()[k] for k in ("open", "in_flight", "closed")} == {"open": False, "in_flight": 1, "closed": 2}
        held.release()
        await until(lambda: s.stats()["in_flight"] == 0)
        assert await s.close() == {"in_flight": 0}

        cooperative = SourceSupervisor(max_in_flight=1)

        async def stops(tenant):
            await asyncio.sleep(10)

        task = asyncio.ensure_future(cooperative._run("t", 5, lambda: stops("t")))
        await until(lambda: cooperative.stats()["in_flight"] == 1)
        started = asyncio.get_running_loop().time()
        assert await cooperative.close(drain_timeout=5) == {"in_flight": 0}
        assert asyncio.get_running_loop().time() - started < 1
        assert await task == ("closed", None)
    run(scenario)


# ── Event loops and threads ──


def test_a_supervisor_used_from_another_event_loop_or_thread_fails_closed():
    s = SourceSupervisor(max_in_flight=1)
    run(lambda: post(_app(s)))
    status, body, _ = run(lambda: post(_app(s)))  # another asyncio.run, another loop
    assert (status, body) == (503, UNAVAILABLE)
    assert s.stats()["wrong_loop"] == 1

    racing = SourceSupervisor(max_in_flight=2)
    barrier = threading.Barrier(2)
    outcomes: list = []

    def first_use():
        async def go():
            barrier.wait()
            return await racing._run("t", 5, lambda: async_trust("t"))
        outcomes.append(asyncio.run(go()))

    threads = [threading.Thread(target=first_use) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert sorted(o[0] for o in outcomes) == ["ok", "wrong_loop"]
    assert racing.stats()["in_flight"] == 0


def test_a_failing_task_factory_holds_nothing_and_leaves_no_coroutine_unawaited():
    async def scenario():
        s = SourceSupervisor(max_in_flight=1)
        loop = asyncio.get_running_loop()

        def broken(loop, coro, **kwargs):
            raise RuntimeError("no tasks")

        loop.set_task_factory(broken)
        try:
            outcome = await s._run("t", 5, lambda: async_trust("t"))
        finally:
            loop.set_task_factory(None)
        assert outcome[0] == "failed" and isinstance(outcome[1], RuntimeError)
        assert s.stats()["in_flight"] == 0 and s.stats()["tenants"] == 0

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        run(scenario)
        gc.collect()
    assert not [w for w in caught if "never awaited" in str(w.message)]


@pytest.mark.skipif(not hasattr(asyncio, "eager_task_factory"), reason="eager tasks are Python 3.12+")
def test_an_eager_task_factory_keeps_the_same_accounting():
    async def scenario():
        asyncio.get_running_loop().set_task_factory(asyncio.eager_task_factory)
        s = SourceSupervisor(max_in_flight=1)
        assert await s._run("t", 5, lambda: async_trust("t")) == ("ok", TRUST)  # finishes inside create_task
        held = Held()
        first = asyncio.ensure_future(s._run("t", 5, lambda: held("t")))
        await until(lambda: held.calls == 1)
        assert await s._run("t", 5, lambda: async_trust("t")) == ("saturated", None)
        held.release()
        assert await first == ("ok", TRUST)
        assert s.stats()["in_flight"] == 0
    run(scenario)


# ── Body budget, request fields ──


def test_a_body_over_max_body_bytes_gets_413_before_the_source():
    async def scenario():
        held = Held()
        status, _, _ = await post(_app(SourceSupervisor(max_in_flight=1), held, max_body_bytes=100))
        assert status == 413 and held.calls == 0
    run(scenario)


def test_request_fields_cannot_change_the_supervision():
    async def scenario():
        s = SourceSupervisor(max_in_flight=1)
        held = Held()
        status, body, elapsed = await post(_app(s, held), body={"supervise": {"trust_timeout": 60}, "source_supervisor": None},
                                           headers={"x-dcp-supervise": '{"trust_timeout": 60}'})
        assert (status, body) == (503, UNAVAILABLE) and elapsed < 0.1 + 2.0
        held.release()
        await until(lambda: s.stats()["in_flight"] == 0)
    run(scenario)


# ── Configuration ──


class _AsyncCallable:
    async def __call__(self, tenant):
        return TRUST


@pytest.mark.parametrize(
    "kwargs,code",
    [
        ({"supervise": None}, "CONFIG_PROFILE_CONTRADICTION"),  # a supervisor without supervise
        ({"source_supervisor": None}, "CONFIG_PROFILE_CONTRADICTION"),  # supervise without a supervisor
        ({"trusted_principals": TRUST}, "CONFIG_PROFILE_CONTRADICTION"),
        ({"trusted_principals": lambda tenant: TRUST}, "CONFIG_INVALID_VALUE"),
        ({"supervise": {"trust_timeout": 1, "revocation": True}}, "CONFIG_PROFILE_CONTRADICTION"),  # no revocation_source
        ({"supervise": {"trust_timeout": 1, "revocation": None}}, "CONFIG_INVALID_VALUE"),
        ({"supervise": {"trust_timeout": 1, "queue": 5}}, "CONFIG_UNKNOWN_FIELD"),
        ({"supervise": {}}, "CONFIG_INVALID_VALUE"),
        ({"supervise": [("trust_timeout", 1)]}, "CONFIG_INVALID_VALUE"),
        ({"source_supervisor": object()}, "CONFIG_INVALID_VALUE"),
        *[({"supervise": {"trust_timeout": t}}, "CONFIG_INVALID_VALUE")
          for t in (True, 0, -1, math.nan, math.inf, "1", 10**400, 2147483.648)],
    ],
)
def test_invalid_supervision_raises_at_construction(kwargs, code):
    base = {"require_bundle": True, "trusted_principals": async_trust, "source_supervisor": SourceSupervisor(max_in_flight=1),
            "supervise": {"trust_timeout": 1}}
    with pytest.raises(AdmissionConfigError) as caught:
        DCPVerifyMiddleware(FastAPI(), **{**base, **kwargs})
    assert caught.value.code == code


@pytest.mark.parametrize(
    "trust", [async_trust, functools.partial(async_trust), _AsyncCallable(), functools.partial(_AsyncCallable())]
)
def test_async_sources_in_their_usual_forms_are_accepted(trust):
    DCPVerifyMiddleware(FastAPI(), require_bundle=True, trusted_principals=trust,
                        source_supervisor=SourceSupervisor(max_in_flight=1), supervise={"trust_timeout": 2147483.647})


@pytest.mark.parametrize("kwargs", [{"max_in_flight": 0}, {"max_in_flight": True}, {"max_in_flight": 1.5}, {"max_in_flight": 2**53},
                                    {"max_in_flight": "2"}, {"max_in_flight": 1, "max_in_flight_per_tenant": 0}])
def test_invalid_capacity_raises(kwargs):
    with pytest.raises(AdmissionConfigError) as caught:
        SourceSupervisor(**kwargs)
    assert caught.value.code == "CONFIG_INVALID_VALUE"


@pytest.mark.parametrize("drain", [-1, True, math.nan, math.inf, "1", 10**400])
def test_invalid_drain_raises(drain):
    async def scenario():
        with pytest.raises(AdmissionConfigError):
            await SourceSupervisor(max_in_flight=1).close(drain_timeout=drain)
    run(scenario)


def test_counters_stop_at_2_53_minus_1():
    assert saturating_increment(0) == 1
    assert saturating_increment(MAX_SAFE_INTEGER - 1) == MAX_SAFE_INTEGER
    assert saturating_increment(MAX_SAFE_INTEGER) == MAX_SAFE_INTEGER


def test_a_value_that_arrives_in_time_but_is_decided_after_a_late_callback_is_refused():
    async def scenario():
        s = SourceSupervisor(max_in_flight=1)

        async def answers_then_blocks(tenant):
            asyncio.get_running_loop().call_soon(time.sleep, 0.06)  # runs before the done callback
            return TRUST  # in time: the block comes after it

        assert await s._run("t", 0.015, lambda: answers_then_blocks("t")) == ("timeout", None)
        assert s.stats()["timeouts"] == 1 and s.stats()["late_results"] == 1 and s.stats()["in_flight"] == 0
    run(scenario)


def test_close_from_another_event_loop_is_refused_and_changes_nothing():
    s = SourceSupervisor(max_in_flight=1)
    owner = asyncio.new_event_loop()
    try:
        assert owner.run_until_complete(s._run("t", 5, lambda: async_trust("t"))) == ("ok", TRUST)
        with pytest.raises(RuntimeError):
            asyncio.run(s.close())
        assert s.stats()["open"] is True
        assert owner.run_until_complete(s._run("t", 5, lambda: async_trust("t"))) == ("ok", TRUST)
        assert owner.run_until_complete(s.close()) == {"in_flight": 0}
        assert s.stats()["open"] is False
    finally:
        owner.close()


@pytest.mark.skipif(not hasattr(asyncio, "eager_task_factory"), reason="eager tasks are Python 3.12+")
def test_close_reached_by_an_eager_source_inside_create_task_still_cancels_its_task():
    async def scenario():
        asyncio.get_running_loop().set_task_factory(asyncio.eager_task_factory)
        s = SourceSupervisor(max_in_flight=1)
        release = asyncio.Event()
        cancelled = []

        async def source(tenant):
            await s.close()  # runs inside create_task, before the Task is registered
            try:
                await release.wait()
            except asyncio.CancelledError:
                cancelled.append(True)
                raise
            finally:
                release.set()

        assert await s._run("t", 5, lambda: source("t")) == ("closed", None)
        assert s.stats()["in_flight"] == 1  # held until the source really finishes
        await until(lambda: cancelled == [True])
        await until(lambda: s.stats()["in_flight"] == 0)
    run(scenario)
