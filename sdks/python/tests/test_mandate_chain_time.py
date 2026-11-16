"""DCP-09 §3.5.2 chain time rules (Python SDK): the shared signed vectors every SDK must
agree on (tests/interop/v2/mandate_chain_time_vectors.json) and the verification time as
this SDK takes it: floored to the millisecond, also before the Unix epoch, a naive
datetime read as UTC as before, and refused without an exception when it is not a
datetime."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider
from dcp_ai.v2 import AlgorithmRegistry, CompositeKeyInfo, create_delegation_mandate, generate_session_nonce, verify_mandate_chain
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms

VECTORS_PATH = Path(__file__).resolve().parent.parent.parent.parent / "tests" / "interop" / "v2" / "mandate_chain_time_vectors.json"
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def V():
    with open(VECTORS_PATH) as f:
        return json.load(f)


@pytest.fixture(scope="module")
def registry() -> AlgorithmRegistry:
    r = AlgorithmRegistry()
    r.register_signer(Ed25519Provider())
    r.register_signer(MlDsa65Provider())
    return r


def time_of(V, case) -> datetime:
    ms = rfc3339_epoch_ms(case.get("verification_time", V["verification_time"]))
    assert ms is not None, case["name"]
    return EPOCH + timedelta(milliseconds=ms)


def by_name(V, name):
    return next(c for c in V["must_accept"] if c["name"] == name)


class TestVectors:
    def test_names_are_unique(self, V):
        names = [c["name"] for c in V["must_accept"] + V["must_reject"]]
        assert len(set(names)) == len(names)

    @pytest.mark.asyncio
    async def test_must_accept(self, V, registry):
        assert len(V["must_accept"]) == 9
        for case in V["must_accept"]:
            result = await verify_mandate_chain(registry, case["chain"], set(case["revoked_mandate_ids"]), case.get("keys", V["keys"]), now=time_of(V, case))
            assert result["errors"] == [], case["name"]
            assert result["valid"] is True, case["name"]
            assert {"depth": result["depth"], "effective_tier": result["effective_tier"]} == case["expected"], case["name"]

    @pytest.mark.asyncio
    async def test_must_reject(self, V, registry):
        assert len(V["must_reject"]) == 13
        for case in V["must_reject"]:
            result = await verify_mandate_chain(registry, case["chain"], set(case["revoked_mandate_ids"]), case.get("keys", V["keys"]), now=time_of(V, case))
            assert result["valid"] is False, case["name"]
            assert case["error_contains"] in "\n".join(result["errors"]).lower(), case["name"]


class TestVerificationTime:
    @pytest.mark.asyncio
    async def test_floored_to_the_millisecond_the_keys_expire_at(self, V, registry):
        case = by_name(V, "every_signer_key_expires_at_the_verification_time")
        at = time_of(V, case)
        within = await verify_mandate_chain(registry, case["chain"], set(), case["keys"], now=at + timedelta(microseconds=999))
        assert within["valid"] is True, within["errors"]
        later = await verify_mandate_chain(registry, case["chain"], set(), case["keys"], now=at + timedelta(milliseconds=1))
        assert later["valid"] is False and "has expired or has an invalid expires_at" in "\n".join(later["errors"])

    @pytest.mark.asyncio
    async def test_naive_is_read_as_utc_as_before(self, V, registry):
        case = by_name(V, "every_signer_key_expires_at_the_verification_time")
        at = time_of(V, case)
        naive = await verify_mandate_chain(registry, case["chain"], set(), case["keys"], now=at.replace(tzinfo=None))
        assert naive["valid"] is True, naive["errors"]
        late = await verify_mandate_chain(registry, case["chain"], set(), case["keys"], now=(at + timedelta(milliseconds=1)).replace(tzinfo=None))
        assert late["valid"] is False

    @pytest.mark.asyncio
    async def test_any_offset_and_the_extreme_datetimes(self, V, registry):
        case = by_name(V, "windows_from_year_0000_to_year_9999_offsets_crossing_both")
        # Year 1 at +23:59 is an instant of year 0, inside the window that starts in year -1 (sub: year 0000).
        first = datetime(1, 1, 1, tzinfo=timezone(timedelta(hours=23, minutes=59)))
        assert (await verify_mandate_chain(registry, case["chain"], set(), V["keys"], now=first))["valid"] is True
        # Year 9999 at -23:59 is an instant of year 10000, after the sub-mandate's window.
        last = datetime(9999, 12, 31, 23, 59, 59, 999999, tzinfo=timezone(-timedelta(hours=23, minutes=59)))
        result = await verify_mandate_chain(registry, case["chain"], set(), V["keys"], now=last)
        assert result["valid"] is False and "mandate[1]: expired at the verification time" in result["errors"]

    @pytest.mark.asyncio
    async def test_floor_before_the_unix_epoch(self, registry):
        ed = await registry.get_signer("ed25519").generate_keypair()
        pq = await registry.get_signer("ml-dsa-65").generate_keypair()
        ck = CompositeKeyInfo(kid=ed["kid"], alg="ed25519", secret_key_b64=ed["secret_key_b64"], public_key_b64=ed["public_key_b64"])
        pqk = CompositeKeyInfo(kid=pq["kid"], alg="ml-dsa-65", secret_key_b64=pq["secret_key_b64"], public_key_b64=pq["public_key_b64"])
        root = await create_delegation_mandate(
            registry, ck, pqk, mandate_id="mandate:before-epoch", session_nonce=generate_session_nonce(), human_id="human:alice",
            agent_id="agent:a", authority_scope=[{"domain": "email", "actions_permitted": ["read"]}],
            valid_from="1969-01-01T00:00:00Z", valid_until="1970-12-31T00:00:00Z", revocable=True,
        )
        keys = {
            "human_keys": [
                {"kid": k.kid, "alg": k.alg, "public_key_b64": k.public_key_b64, "created_at": "1969-01-01T00:00:00Z", "expires_at": "1969-12-31T23:59:59.999Z", "status": "active"}
                for k in (ck, pqk)
            ],
            "agent_keys": {},
        }
        # -500 µs is the millisecond -1, the keys' expiry; truncating toward zero would make it 0, after it.
        half = await verify_mandate_chain(registry, [root], set(), keys, now=EPOCH - timedelta(microseconds=500))
        assert half["errors"] == []
        at_epoch = await verify_mandate_chain(registry, [root], set(), keys, now=EPOCH)
        assert at_epoch["valid"] is False and "has expired or has an invalid expires_at" in "\n".join(at_epoch["errors"])

    @pytest.mark.asyncio
    @pytest.mark.parametrize("now", [0, 1.5, "2026-10-22T12:00:00Z", date(2026, 10, 22), True, object()], ids=["int", "float", "str", "date", "bool", "object"])
    async def test_a_time_that_is_not_a_datetime_is_refused(self, V, registry, now):
        case = V["must_accept"][0]
        result = await verify_mandate_chain(registry, case["chain"], set(), V["keys"], now=now)
        assert result == {"valid": False, "errors": ["verification time is not an instant"], "depth": 0, "effective_tier": None}
