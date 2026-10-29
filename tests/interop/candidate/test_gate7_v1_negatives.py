"""Negative controls of the gate 7 checker (gate7-v1-negatives.py): each defect, written into a temporary copy of
the fixture, must make the check fail closed with a message naming it. Standard library only:

    python3 -I tests/interop/candidate/test_gate7_v1_negatives.py
"""

from __future__ import annotations

import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("gate7_checker", HERE / "gate7-v1-negatives.py")
checker = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(checker)
DOC = json.loads((HERE / "gate7-v1-negatives.json").read_text(encoding="utf-8"))


class Gate7CheckerTest(unittest.TestCase):
    def run_check(self, doc=None, text=None):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "fixture.json"
            path.write_text(text if text is not None else json.dumps(doc), encoding="utf-8")
            return checker.check(path, checker.REPO)

    def fails(self, mutate, expect):
        doc = copy.deepcopy(DOC)
        mutate(doc)
        problems = self.run_check(doc)
        self.assertTrue(problems, f"the check passed; expected a failure about {expect!r}")
        self.assertTrue(any(expect in p for p in problems), f"no problem mentions {expect!r}: {problems[:5]}")

    def case(self, doc, cid):
        return next(c for c in doc["cases"] if c["id"] == cid)

    def test_committed_fixture_passes(self):
        self.assertEqual(self.run_check(DOC), [])

    def test_missing_case(self):
        self.fails(lambda d: d["cases"].pop(), "missing")

    def test_duplicate_case(self):
        self.fails(lambda d: d["cases"].append(copy.deepcopy(d["cases"][0])), "duplicated")

    def test_unknown_case(self):
        def m(d):
            d["cases"][5]["id"] = "G7-V1-M99"
        self.fails(m, "unknown")

    def test_empty_cases(self):
        self.fails(lambda d: d.__setitem__("cases", []), "non-empty")

    def test_stale_input_hash(self):
        def m(d):
            d["cases"][3]["input_sha256"] = "0" * 64
        self.fails(m, "input_sha256 is stale")

    def test_stale_base_hash(self):
        def m(d):
            d["bases"]["B-v1"]["input_sha256"] = "0" * 64
        self.fails(m, "base B-v1: input_sha256 is stale")

    def test_stale_phase3_file(self):
        def m(d):
            d["bases_source"]["sha256"] = "0" * 64
        self.fails(m, "bases_source.sha256 is stale")

    def test_stale_boundary_hash(self):
        def m(d):
            d["boundary"]["cases"][0]["input_sha256"] = "0" * 64
        self.fails(m, "boundary G7E-1: input_sha256 is stale")

    def test_duplicate_json_key(self):
        text = json.dumps(DOC).replace('"schema": ', '"schema": "x", "schema": ', 1)
        problems = self.run_check(text=text)
        self.assertTrue(any("duplicate JSON key" in p for p in problems), problems)

    def test_now_ms_not_now(self):
        def m(d):
            d["now_ms"] += 1
        self.fails(m, "now")

    def test_unknown_configuration(self):
        def m(d):
            e = self.case(d, "G7-V1-M01")["expected"]
            e["ts.other"] = e.pop("ts.bufferUtf8JsonParse")
        self.fails(m, "exactly the 10 configurations")

    def test_missing_configuration(self):
        self.fails(lambda d: self.case(d, "G7-AB-M12")["expected"].pop("go.encoding_json"), "exactly the 10 configurations")

    def test_unknown_shape(self):
        def m(d):
            self.case(d, "G7-V1-M10")["expected"]["ts.textDecoderJsonParse"]["verification"] = "ts.nothing"
        self.fails(m, "unknown verification shape")

    def test_shape_of_another_family(self):
        def m(d):
            self.case(d, "G7-V1-C00")["expected"]["ts.textDecoderJsonParse"]["verification"] = "go.ok"
        self.fails(m, "is not of family ts")

    def test_unused_shape(self):
        def m(d):
            d["verification_shapes"]["ts.spare"] = copy.deepcopy(d["verification_shapes"]["ts.ok"])
        self.fails(m, "unused verification shapes")

    def test_wrong_mutation_class(self):
        def m(d):
            d["mutations"]["M12"]["class"] = "NUMBER_OUT_OF_RANGE"
        self.fails(m, "mutation M12: class must be NUMBER_NOT_INTEGER")

    def test_anchor_not_unique(self):
        def m(d):
            d["mutations"]["M12"]["edits"] = [{"replace_once": '"', "with": "'"}]
        self.fails(m, "not exactly once")

    def test_edit_that_changes_nothing(self):
        def m(d):
            d["mutations"]["M12"]["edits"] = [{"replace_once": '"risk_score":450', "with": '"risk_score":450'}]
        self.fails(m, "leave the base unchanged")

    def test_extra_field(self):
        def m(d):
            self.case(d, "G7-V1-M03")["expected"]["go.encoding_json"]["note"] = "x"
        self.fails(m, "fields must be exactly")

    def test_verifier_entered_without_verification(self):
        def m(d):
            self.case(d, "G7-V1-C00")["expected"]["rust.serde_json_from_slice"]["verification"] = None
        self.fails(m, "a verification exactly when a verifier was entered")

    def test_host_decode_error_with_a_verifier(self):
        def m(d):
            e = self.case(d, "G7-V1-M04")["expected"]["ts.textDecoderJsonParse"]
            e["route"] = {"outcome": "v1_path", "profile_source": "historical", "warning_classes": ["SYNTAX"], "historical": "decoded"}
            e["entered"], e["verification"] = "dcp-jcs-v1", "ts.ok"
        self.fails(m, "a host decoder refusal leaves nothing to verify")

    def test_in_band_outside_go_and_wasm(self):
        def m(d):
            self.case(d, "G7-V1-M04")["expected"]["py.json_loads_bytes"]["today"] = {"outcome": "in_band_parse_error", "kind": "JSON parse error"}
        self.fails(m, "only Go and the WASM binding parse in band")

    def test_warning_of_another_class(self):
        def m(d):
            self.case(d, "G7-V1-M08")["expected"]["ts.textDecoderJsonParse"]["route"]["warning_classes"] = ["SYNTAX"]
        self.fails(m, "the warning must be the injected class DUPLICATE_KEY")

    def test_walkable_class_rejected(self):
        def m(d):
            e = self.case(d, "G7-V1-M12")["expected"]["ts.textDecoderJsonParse"]
            e["route"] = {"outcome": "reject", "class": "NUMBER_NOT_INTEGER", "offset": 1}
            e["entered"], e["verification"], e["today"] = "none", None, {"outcome": "host_decode_error", "kind": "SyntaxError"}
        self.fails(m, "is walkable")

    def test_control_not_clean(self):
        def m(d):
            self.case(d, "G7-AB-C00")["expected"]["go.encoding_json"]["route"]["warning_classes"] = ["BOM"]
        self.fails(m, "a control is a clean delegation")

    def test_verified_shape_with_errors(self):
        def m(d):
            d["verification_shapes"]["ts.ok"]["error_count"] = 1
        self.fails(m, "a verified shape has no error")

    def test_boundary_positive_must_verify(self):
        def m(d):
            d["boundary"]["cases"][0]["expected"]["ts.textDecoderJsonParse"]["verification"] = "ts.intent_mismatch"
        self.fails(m, "G7E-1 must verify")

    def test_boundary_reject_must_not_enter(self):
        def m(d):
            e = d["boundary"]["cases"][1]["expected"]["wasm.w2BufferUtf8"]
            e["adapter_calls"] = 1
        self.fails(m, "must not reach a verifier or a decoder")

    def test_missing_boundary_case(self):
        self.fails(lambda d: d["boundary"]["cases"].pop(), "boundary case IDs")

    # The five false passes found in Codex's first independent review of the checker
    # (docs/reviews/canonicalization-gate7-checker-independent-first-results.json).

    def test_position_changed(self):
        def m(d):
            d["mutations"]["M12"]["position"] = "unsigned"
        self.fails(m, "mutation M12: position must be")

    def test_adapter_calls_float(self):
        def m(d):
            self.case(d, "G7-V1-C00")["expected"]["ts.textDecoderJsonParse"]["adapter_calls"] = 1.0
        self.fails(m, "adapter_calls must be the integer 0 or 1")

    def test_adapter_calls_bool(self):
        def m(d):
            self.case(d, "G7-V1-C00")["expected"]["ts.textDecoderJsonParse"]["adapter_calls"] = True
        self.fails(m, "adapter_calls must be the integer 0 or 1")

    def test_invented_decoder_error(self):
        def m(d):
            self.case(d, "G7-V1-M04")["expected"]["ts.textDecoderJsonParse"]["today"]["kind"] = "InventedFailure"
        self.fails(m, "is not a host_decode_error of ts.textDecoderJsonParse")

    def test_decoder_error_of_another_layer(self):
        def m(d):  # a Rust serde category on a TypeScript decoder
            self.case(d, "G7-V1-M04")["expected"]["ts.textDecoderJsonParse"]["today"]["kind"] = "Syntax"
        self.fails(m, "is not a host_decode_error of ts.textDecoderJsonParse")

    def test_host_decode_error_on_go(self):
        def m(d):  # Go has no host decoder before its verifier
            self.case(d, "G7-V1-M04")["expected"]["go.encoding_json"]["today"] = {"outcome": "host_decode_error", "kind": "JSON parse error"}
        self.fails(m, "is not a host_decode_error of go.encoding_json")

    def test_invented_mode(self):
        def m(d):
            d["verification_shapes"]["go.ok"]["fields"]["verification_mode"] = "invented-mode"
        self.fails(m, "verification_mode must be one of")

    def test_invented_tier(self):
        def m(d):
            d["verification_shapes"]["go.ok"]["fields"]["resolved_tier"] = "invented-tier"
        self.fails(m, "resolved_tier must be one of")

    def test_error_count_float(self):
        def m(d):
            d["verification_shapes"]["go.audit_float"]["error_count"] = 1.0
        self.fails(m, "error_count is a non-negative integer")

    # Scope drift: a mutation that changes meaning while keeping its ID, class and rehashed cases.

    def test_signed_and_unsigned_swapped_with_rehash(self):
        def m(d):
            d["mutations"]["M02"]["edits"], d["mutations"]["M03"]["edits"] = d["mutations"]["M03"]["edits"], d["mutations"]["M02"]["edits"]
            for line in checker.hashes(self.tmp_fixture(d), checker.REPO):
                cid, digest = line.split()
                for c in d["cases"]:
                    if c["id"] == cid:
                        c["input_sha256"] = digest
        doc = copy.deepcopy(DOC)
        m(doc)
        problems = self.run_check(doc)
        self.assertFalse(any("input_sha256 is stale" in p for p in problems), "the cases were rehashed")
        self.assertTrue(any("mutation M02: its class, position and edits are not the approved ones" in p for p in problems), problems)
        self.assertTrue(any("mutation M03: its class, position and edits are not the approved ones" in p for p in problems), problems)

    def test_boundary_edits_changed(self):
        def m(d):
            d["boundary"]["cases"][1]["edits"][1] = {"append": ',"signed_bundle":{}}'}
        self.fails(m, "boundary G7E-2: its edits are not the approved ones")

    def tmp_fixture(self, doc):
        d = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(d, ignore_errors=True))
        path = Path(d) / "fixture.json"
        path.write_text(json.dumps(doc), encoding="utf-8")
        return path


if __name__ == "__main__":
    unittest.main()
