"""P2a unit tests of the Python helpers (TEST ONLY): authorization, ledger, and the two-process race.

Run from the staged kit with the consumer's interpreter (never from the checkout):

    <consumer>/python/bin/python -I -m unittest discover -s <consumer>/node/rehearsal/python -p 'test_*.py' -v

Expectations come from contract/rehearsal-contract.json and design v0.2 § 2.6-2.7 with the P2a corrections. The SDK
material checks run from node/test/p2a.test.mjs, which calls python/cross_check.py.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

import rehearsal_sources as sources

sources.assert_installed_sdk()

from rehearsal_authz import args_sha256, authorize, route_path  # noqa: E402
from rehearsal_ledger import LedgerError, action_key, append_effect, read_effects, reservations, reserve  # noqa: E402

CONTRACT = sources.load_contract()
KEY_VECTOR = "4410142dba477671129838632ffb5511bcfe3ea5f69669d10aab9134a71588da"
DOMAIN = CONTRACT["domain"]
POLICY = {
    "domain": DOMAIN,
    "direct_agents": {"agent:a0": ["quote", "order"]},
    "delegated_principals": {"human:p": ["quote", "order"]},
    "max_amount": {"quote": 10000, "order": 10000},
}
CC, FD = "company_confidential", "financial_data"


def args(**over):
    return {"sku": "SKU-1", "amount": 100, "currency": "EUR", **over}


def intent(action, a, route="delegated", **over):
    spec = CONTRACT["actions"][action]
    target = {
        "channel": spec["channel"],
        "domain": DOMAIN,
        "url": route_path(CONTRACT, route, action),
        "x_rehearsal": {"action": action, "args_sha256": args_sha256(a)},
    }
    return {"action_type": spec["action_type"], "target": target, "data_classes": list(spec["data_classes"]), **over}


def entry(actions=("quote", "order"), classes=(CC, FD), max_amount=5000, domain=DOMAIN, **over):
    return {"domain": domain, "actions_permitted": list(actions), "data_classes": list(classes), "limits": {"max_amount": max_amount}, **over}


def without(d, key):
    return {k: v for k, v in d.items() if k != key}


ROOT = {"authority_scope": [entry(("quote", "order", "refund"), max_amount=10000)]}


def leaf(*entries):
    return {"authority_scope": list(entries)}


def outcome(action="order", a=None, route="delegated", i=None, chain=None, agent="agent:a0", principal="human:p"):
    a = args() if a is None else a
    i = intent(action, a, route) if i is None else i
    if chain is None and route == "delegated":
        chain = [ROOT, leaf(entry())]
    r = authorize(CONTRACT, POLICY, route, action, a, i, agent_id=agent, principal_id=principal, chain=chain)
    return "OK" if r["ok"] else r["code"]


class Args(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(outcome(), "OK")

    def test_invalid(self):
        bound = intent("order", args())
        bad = [
            args(amount=True),
            args(amount=-1),
            args(amount=0),
            args(amount="100"),
            args(amount=100.0),
            args(amount=1.5),
            args(amount=2**53),
            args(currency="USD"),
            args(sku="bad sku"),
            args(sku="ABC\n"),
            args(sku="ABC\r"),
            args(sku="A" * 65),
            {**args(), "note": "x"},
            without(args(), "currency"),
            ["SKU-1", 100, "EUR"],
        ]
        for a in bad:
            with self.subTest(args=a):
                self.assertEqual(outcome(a=a, i=bound), "APP_ARGS_INVALID")


class Intent(unittest.TestCase):
    def test_mismatch(self):
        a = args()
        base = intent("order", a)
        t = base["target"]
        cases = {
            "action_type": {**base, "action_type": "initiate_payment"},
            "target member": {**base, "target": {**t, "to": None}},
            "channel": {**base, "target": {**t, "channel": "payments"}},
            "domain": {**base, "target": {**t, "domain": "billing.example.com"}},
            "route": {**base, "target": {**t, "url": route_path(CONTRACT, "direct", "order")}},
            "binding action": {**base, "target": {**t, "x_rehearsal": {"action": "quote", "args_sha256": args_sha256(a)}}},
            "binding args": {**base, "target": {**t, "x_rehearsal": {"action": "order", "args_sha256": args_sha256(args(amount=200))}}},
            "binding member": {**base, "target": {**t, "x_rehearsal": {**t["x_rehearsal"], "nonce": "1"}}},
            "extra class": {**base, "data_classes": [FD, "pii"]},
            "other class": {**base, "data_classes": [CC]},
            "repeated class": {**base, "data_classes": [FD, FD]},
            "no classes": without(base, "data_classes"),
        }
        for name, i in cases.items():
            with self.subTest(name):
                self.assertEqual(outcome(a=a, i=i), "APP_INTENT_MISMATCH")


class Policy(unittest.TestCase):
    def test_operator(self):
        wide = [ROOT, leaf(entry(("quote", "order", "refund")))]
        self.assertEqual(outcome("refund", chain=wide), "APP_ACTION_NOT_AUTHORIZED")
        self.assertEqual(outcome("quote", route="direct"), "OK")
        self.assertEqual(outcome("quote", route="direct", agent="agent:other"), "APP_ACTION_NOT_AUTHORIZED")
        self.assertEqual(outcome("order", principal="human:other"), "APP_ACTION_NOT_AUTHORIZED")
        self.assertEqual(outcome("order", a=args(amount=10000), route="direct"), "OK")
        self.assertEqual(outcome("order", a=args(amount=10001), route="direct"), "APP_ARGS_OUT_OF_SCOPE")
        self.assertEqual(outcome("delete", i=intent("order", args())), "APP_ACTION_NOT_AUTHORIZED")


class Scope(unittest.TestCase):
    def test_cases(self):
        cases = {
            "domain missing": ([ROOT, leaf(entry(domain="billing.example.com"))], args(), "APP_DOMAIN_OUT_OF_SCOPE"),
            "domain twice": ([ROOT, leaf(entry(), entry())], args(), "APP_DOMAIN_OUT_OF_SCOPE"),
            "action": ([ROOT, leaf(entry(("quote",)))], args(), "APP_ACTION_OUT_OF_SCOPE"),
            "data class": ([ROOT, leaf(entry(classes=(CC,)))], args(), "APP_DATA_CLASS_OUT_OF_SCOPE"),
            "no data_classes": ([ROOT, leaf(without(entry(), "data_classes"))], args(), "APP_DATA_CLASS_OUT_OF_SCOPE"),
            "leaf limit equal": ([ROOT, leaf(entry())], args(amount=5000), "OK"),
            "leaf limit exceeded": ([ROOT, leaf(entry())], args(amount=5001), "APP_ARGS_OUT_OF_SCOPE"),
            "root limit lower": ([leaf(entry(max_amount=3000)), leaf(entry())], args(amount=4000), "APP_ARGS_OUT_OF_SCOPE"),
            "no max_amount": ([ROOT, leaf(entry(limits={}))], args(amount=9000), "OK"),
            "no limits": ([ROOT, leaf(without(entry(), "limits"))], args(amount=9000), "OK"),
            "max_amount string": ([ROOT, leaf(entry(limits={"max_amount": "5000"}))], args(), "APP_ARGS_OUT_OF_SCOPE"),
            "max_amount boolean": ([ROOT, leaf(entry(limits={"max_amount": True}))], args(), "APP_ARGS_OUT_OF_SCOPE"),
            "max_amount float": ([ROOT, leaf(entry(limits={"max_amount": 5000.0}))], args(), "APP_ARGS_OUT_OF_SCOPE"),
            "limits not an object": ([ROOT, leaf(entry(limits=[5000]))], args(), "APP_ARGS_OUT_OF_SCOPE"),
            "empty chain": ([], args(), "APP_DELEGATION_NOT_ACTIVE"),
        }
        for name, (chain, a, want) in cases.items():
            with self.subTest(name):
                self.assertEqual(outcome(a=a, chain=chain), want)


def short(fd, data):
    return os.write(fd, data[:-5])


class Ledger(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix="mp05-ledger-py-")
        self.addCleanup(tmp.cleanup)
        self.dir = tmp.name

    def test_key(self):
        self.assertEqual(action_key("T1", "sha256:" + "0" * 64), KEY_VECTOR)
        self.assertNotEqual(action_key("T2", "sha256:" + "0" * 64), KEY_VECTOR)
        for tenant, h in [("T 1", "sha256:" + "0" * 64), ("T1", "sha256:XYZ"), ("T1", "0" * 64), (1, "sha256:" + "0" * 64)]:
            with self.subTest(tenant=tenant, h=h), self.assertRaises(LedgerError):
                action_key(tenant, h)

    def test_reserve_once(self):
        self.assertTrue(reserve(self.dir, "T1", KEY_VECTOR))
        self.assertFalse(reserve(self.dir, "T1", KEY_VECTOR))
        self.assertEqual(reservations(self.dir, "T1"), [KEY_VECTOR])
        self.assertTrue(reserve(self.dir, "T2", KEY_VECTOR))
        self.assertEqual(os.stat(Path(self.dir) / "T1").st_mode & 0o777, 0o700)

    def test_short_write(self):
        k = action_key("T1", "sha256:" + "1" * 64)
        with self.assertRaisesRegex(LedgerError, "short write"):
            reserve(self.dir, "T1", k, write=short)
        self.assertFalse(reserve(self.dir, "T1", k), "a failed reservation stays consumed: at most one attempt")
        f = Path(self.dir) / "executions.jsonl"
        append_effect(f, {"key": "a"})
        append_effect(f, {"key": "b"})
        self.assertEqual([r["key"] for r in read_effects(f)], ["a", "b"])
        with self.assertRaisesRegex(LedgerError, "short write"):
            append_effect(f, {"key": "c"}, write=short)
        with self.assertRaises(LedgerError):
            read_effects(f)

    def test_two_python_processes(self):
        keys = [action_key("T1", "sha256:" + str(i).rjust(64, "0")) for i in range(200)]
        keys_file = Path(self.dir) / "keys.json"
        keys_file.write_text(json.dumps(keys), encoding="utf-8")
        child = str(Path(__file__).resolve().parent / "ledger_race_child.py")
        start_at = str(int(time.time() * 1000) + 1500)
        procs = []
        results = []
        try:
            for _ in range(2):
                cmd = [sys.executable, "-I", child, self.dir, "T1", start_at, str(keys_file)]
                procs.append(subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True))
            for p in procs:
                out, err = p.communicate(timeout=60)
                self.assertEqual(p.returncode, 0, err)
                results.append(json.loads(out))
        finally:
            for p in procs:
                if p.poll() is None:
                    p.kill()
                    p.wait(timeout=10)
                for stream in (p.stdout, p.stderr):
                    if stream:
                        stream.close()
        # The property is exactly one reservation per key; how the scheduler splits them between processes is not.
        self.assertEqual(len({r["pid"] for r in results}), 2, "distinct processes")
        self.assertTrue(all(r["attempted"] == len(keys) for r in results), "each process tried every key")
        won = [k for r in results for k in r["won"]]
        self.assertEqual(len(won), len(keys), "no key reserved twice")
        self.assertEqual(sorted(won), sorted(keys))
        self.assertEqual(reservations(self.dir, "T1"), sorted(keys))


if __name__ == "__main__":
    unittest.main()
