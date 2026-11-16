"""The mandate validity helper (DCP-09 §3.5.2 rule 4, §3.6): the shared vectors every
SDK must agree on (tests/interop/v2/mandate_validity_vectors.json), the injected and
default clocks, and wrong types that must give a result, never an exception."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from dcp_ai.v2 import revoke_delegation, verify_mandate_validity
from dcp_ai.v2.session_nonce import rfc3339_epoch_ms

VECTORS_PATH = Path(__file__).resolve().parent.parent.parent.parent / "tests" / "interop" / "v2" / "mandate_validity_vectors.json"
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
ID = "mandate-validity-0001"
NOW = datetime(2026, 6, 15, 12, 0, tzinfo=timezone.utc)
END = datetime(2026, 7, 1, tzinfo=timezone.utc)


def at(text: str) -> datetime:
    return EPOCH + timedelta(milliseconds=rfc3339_epoch_ms(text))


def mandate(**fields):
    return {"mandate_id": ID, "valid_from": "2026-06-01T00:00:00Z", "valid_until": "2026-07-01T00:00:00Z", **fields}


@pytest.fixture(scope="module")
def V():
    with open(VECTORS_PATH) as f:
        return json.load(f)


class TestVectors:
    def test_every_case(self, V):
        assert len(V["cases"]) == 94
        wrong = []
        for c in V["cases"]:
            got = verify_mandate_validity(c["mandate"], set(c["revoked_mandate_ids"]), now=at(c.get("now", V["verification_time"])))
            if got != c["expect"]:
                wrong.append(f"{c['name']}: got {got}, want {c['expect']}")
        assert wrong == []

    def test_every_reason_and_group(self, V):
        reasons = {c["expect"]["reason"] for c in V["cases"] if not c["expect"]["valid"]}
        assert reasons == set(V["reasons"].values())
        assert {c["group"] for c in V["cases"]} == {"controls", "offsets", "limits", "inverted", "format", "types", "hostile"}


class TestClock:
    def test_without_now_it_uses_the_current_time(self):
        def iso(d):
            return d.strftime("%Y-%m-%dT%H:%M:%S.000Z")

        current = datetime.now(timezone.utc)
        hour = timedelta(hours=1)
        assert verify_mandate_validity(mandate(valid_from=iso(current - hour), valid_until=iso(current + hour)), set()) == {"valid": True}
        assert verify_mandate_validity(mandate(valid_from=iso(current - 2 * hour), valid_until=iso(current - hour)), set()) == {"valid": False, "reason": "Mandate has expired"}
        assert verify_mandate_validity(mandate(valid_from=iso(current + hour), valid_until=iso(current + 2 * hour)), set()) == {"valid": False, "reason": "Mandate is not yet valid"}
        assert verify_mandate_validity(mandate(valid_from=iso(current - hour), valid_until=iso(current + hour)), set(), now=None) == {"valid": True}

    def test_any_offset_names_the_same_instant(self):
        plus_two = timezone(timedelta(hours=2))
        for utc in (END - timedelta(milliseconds=1), END, END + timedelta(milliseconds=1)):
            assert verify_mandate_validity(mandate(), set(), now=utc.astimezone(plus_two)) == verify_mandate_validity(mandate(), set(), now=utc)

    def test_now_is_truncated_to_milliseconds(self):
        assert verify_mandate_validity(mandate(), set(), now=END + timedelta(microseconds=999)) == {"valid": True}
        assert verify_mandate_validity(mandate(), set(), now=END + timedelta(milliseconds=1)) == {"valid": False, "reason": "Mandate has expired"}

    @pytest.mark.parametrize(
        "now",
        [datetime(2026, 6, 15, 12, 0), "2026-06-15T12:00:00Z", 1781524800000, 1781524800.0, date(2026, 6, 15), True, object()],
        ids=["naive_datetime", "string", "int", "float", "date", "bool", "object"],
    )
    def test_a_time_that_is_not_an_instant_is_refused(self, now):
        assert verify_mandate_validity(mandate(), set(), now=now) == {"valid": False, "reason": "Verification time is not an instant"}


class TestInputs:
    @pytest.mark.parametrize("revoked", [[ID], ID, None, {ID: True}, (ID,), 1], ids=["list", "str", "none", "dict", "tuple", "int"])
    def test_revoked_ids_that_are_not_a_set_are_refused(self, revoked):
        assert verify_mandate_validity(mandate(), revoked, now=NOW) == {"valid": False, "reason": "Revoked mandate IDs are not a set"}

    def test_set_like_revoked_ids(self):
        for revoked in (frozenset({ID}), {ID: True}.keys(), {ID}):
            assert verify_mandate_validity(mandate(), revoked, now=NOW) == {"valid": False, "reason": "Mandate has been revoked"}

    def test_a_dict_subclass_is_read_as_its_data(self):
        class Shadow(dict):
            def get(self, key, default=None):
                return "2026-06-01T00:00:00Z" if key != "mandate_id" else ID

        assert verify_mandate_validity(Shadow(mandate_id=ID), set(), now=NOW) == {"valid": False, "reason": "Mandate valid_from is missing or invalid"}

    def test_wrong_types_give_a_result_never_an_exception(self):
        values = [None, 0, -1, 1.5, float("nan"), float("inf"), "", True, [], {}, [ID], b"x", 10**400, NOW, object()]
        for v in values:
            for m in (v, mandate(mandate_id=v), mandate(valid_from=v), mandate(valid_until=v)):
                got = verify_mandate_validity(m, set(), now=NOW)
                assert got["valid"] is False and isinstance(got["reason"], str)

    def test_existing_reasons_and_revoke_delegation(self):
        revoked: set[str] = set()
        assert revoke_delegation({**mandate(), "revocable": True}, revoked)["revoked"] is True
        assert verify_mandate_validity(mandate(), revoked, now=NOW) == {"valid": False, "reason": "Mandate has been revoked"}
