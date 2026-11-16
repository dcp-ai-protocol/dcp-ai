"""Experimental candidate ingress (phase 1): the public corpus cases that test one unit from its bytes,
and focused examples. Bundle cases (selection, policy, configuration, migration, historical parsers)
and transport envelopes, the obsolete depth rule among them, belong to later phases: they are counted
here, not run.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from dcp_ai.v2.canonicalize import canonicalize_v2
from dcp_ai.v2.experimental_candidate_ingress import (
    CandidateIngressAccept,
    CandidateIngressReject,
    ExperimentalCandidateInternalError,
    experimental_candidate_ingress,
)

CORPUS_DIR = Path(__file__).resolve().parents[3] / "docs" / "proposals" / "canonicalization-candidate"
BASELINE = json.loads((CORPUS_DIR / "baseline-corpus.json").read_text())["cases"]
DESIGN = json.loads((CORPUS_DIR / "corpus.json").read_text())["cases"]
DOCUMENT = [c for c in DESIGN if c["mode"] == "document" and c["transport"] == "bare" and "options" not in c]


def input_of(case: dict) -> bytes:
    return bytes.fromhex(case["input_hex"]) if "input_hex" in case else case["input_json"].encode("utf-8")


def ingest(text) -> object:
    return experimental_candidate_ingress(text.encode("utf-8") if isinstance(text, str) else text)


def rejected(cls: str, offset: int) -> CandidateIngressReject:
    return CandidateIngressReject(cls, offset)


def test_runs_the_unit_cases_and_only_excludes_later_phases():
    assert len(BASELINE) == 87
    assert len(DOCUMENT) == 81
    excluded = [c for c in DESIGN if c not in DOCUMENT]
    assert len([c for c in excluded if c["mode"] == "bundle"]) == 77
    assert len([c for c in excluded if c["mode"] == "document" and c["transport"] == "envelope"]) == 29
    assert len(excluded) == 106
    for case in BASELINE + DOCUMENT:
        assert hashlib.sha256(input_of(case)).hexdigest() == case["input_sha256"], case["id"]


@pytest.mark.parametrize("case", BASELINE, ids=[c["id"] for c in BASELINE])
def test_baseline(case):
    result = experimental_candidate_ingress(input_of(case))
    if case["expected"] == "accept":
        assert isinstance(result, CandidateIngressAccept)
        assert result.canonical.decode("utf-8") == case["canonical"]
        assert result.canonical_sha256 == case["canonical_sha256"]
        assert canonicalize_v2(result.value) == result.canonical.decode("utf-8")
    else:
        assert isinstance(result, CandidateIngressReject)
        assert result.reject_class == case["reject_class"]


@pytest.mark.parametrize("case", DOCUMENT, ids=[c["id"] for c in DOCUMENT])
def test_design_document(case):
    result = experimental_candidate_ingress(input_of(case))
    expected = case["expected"]
    if expected["result"] == "accept":
        assert isinstance(result, CandidateIngressAccept)
        assert result.canonical_sha256 == expected["canonical_sha256"]
        assert hashlib.sha256(result.canonical).hexdigest() == result.canonical_sha256
        assert canonicalize_v2(result.value) == result.canonical.decode("utf-8")
    else:
        assert result == rejected(expected["class"], expected["offset"])


def test_ill_formed_utf8_at_the_first_byte_of_the_subsequence():
    for bad in (b"\xc0\x80", b"\xe0\x80\x80", b"\xed\xa0\x80", b"\xf4\x90\x80\x80", b"\xf5", b"\x80", b"\xe2\x82"):
        assert ingest(b'{"s":"' + bad + b'"}') == rejected("UTF8_INVALID", 6), bad
    assert ingest(b'[,"\xff"]') == rejected("UTF8_INVALID", 3)  # the encoding layer wins over grammar


def test_bom_rejected_at_the_start_kept_inside_a_string():
    assert ingest(b'\xef\xbb\xbf{"a":1}') == rejected("BOM", 0)
    assert ingest(b'\xef\xbb\xbf["\xff"]') == rejected("BOM", 0)
    assert ingest(b'["\xef\xbb\xbfx"]').canonical == b'["\xef\xbb\xbfx"]'


def test_keys_compared_after_unescaping_without_normalization():
    assert ingest('{"a":1,"\\u0061":2}') == rejected("DUPLICATE_KEY", 7)
    assert ingest('{"\\u00e9":1,"é":2}') == rejected("DUPLICATE_KEY", 12)
    assert ingest('{"\\ud83d\\ude00":1,"😀":2}') == rejected("DUPLICATE_KEY", 18)
    assert isinstance(ingest('{"é":1,"e\\u0301":2}'), CandidateIngressAccept)
    assert ingest('{"\\ud800":1,"\\ud800":2}') == rejected("SURROGATE_UNPAIRED", 2)


def test_proto_is_data():
    result = ingest('{"__proto__":{"x":1},"y":[]}')
    assert result.value == {"__proto__": {"x": 1}, "y": []}
    assert result.canonical == b'{"__proto__":{"x":1},"y":[]}'
    assert ingest('{"__proto__":1,"__proto__":2}') == rejected("DUPLICATE_KEY", 15)


def test_numbers_decided_on_the_exact_literal_with_saturated_exponents():
    def canonical(text):
        result = ingest(text)
        return result.canonical.decode() if isinstance(result, CandidateIngressAccept) else result

    assert canonical("[9007199254740991,-9007199254740991,-0,-0.0e-0,0e99999999999999999999999]") == (
        "[9007199254740991,-9007199254740991,0,0,0]"
    )
    assert canonical("[100000000000000000000e-5,1.5e1,100e-2,1E+2]") == "[1000000000000000,15,1,100]"
    assert canonical("[1" + "0" * 100000 + "e-100000]") == "[1]"
    assert canonical("[0." + "0" * 50000 + "1e50001]") == "[1]"
    for text, cls in (
        ("[9007199254740992]", "NUMBER_OUT_OF_RANGE"),
        ("[1e21]", "NUMBER_OUT_OF_RANGE"),
        ("[1e99999999999999999999999]", "NUMBER_OUT_OF_RANGE"),
        ("[1e-99999999999999999999999]", "NUMBER_NOT_INTEGER"),
        ("[1.0000000000000001]", "NUMBER_NOT_INTEGER"),
        ("[4503599627370497.5e40]", "NUMBER_OUT_OF_RANGE"),
        ("[0.5e-400000000000]", "NUMBER_NOT_INTEGER"),
    ):
        assert ingest(text) == rejected(cls, 1), text


def test_surrogate_pairs_and_scalar_output():
    assert ingest('["\\ud83d\\ude00"]').canonical == '["😀"]'.encode("utf-8")
    for text in ('["\\ud83d"]', '["\\ude00"]', '["\\ud83d\\u0041"]', '["\\ud83d\\ud83d\\ude00"]', '["\\ud83dx"]'):
        assert ingest(text) == rejected("SURROGATE_UNPAIRED", 2), text
    assert ingest('["\\ud83d\\uZZZZ"]') == rejected("SYNTAX", 10)


def test_dcp_jcs_v1_escapes_and_literal_rest():
    result = ingest('["\\u0000\\u001f\\b\\t\\n\\f\\r\\"\\\\\\/\\u007f\\u2028"]')
    assert result.canonical.decode("utf-8") == '["\\u0000\\u001f\\b\\t\\n\\f\\r\\"\\\\/\x7f "]'


def test_depth_from_the_unit_root_and_grammar_past_level_64():
    assert isinstance(ingest("[" * 64 + "]" * 64), CandidateIngressAccept)
    assert ingest("[" * 65 + "]" * 65) == rejected("DEPTH_EXCEEDED", 64)
    assert ingest("[" * 65 + "1.5" + "]" * 65) == rejected("DEPTH_EXCEEDED", 64)
    assert ingest("[" * 20000 + "]" * 20000) == rejected("DEPTH_EXCEEDED", 64)
    assert ingest("[" * 20000 + "]" * 19999) == rejected("SYNTAX", 39999)
    assert ingest("[" * 20000 + "]" * 19999 + "}") == rejected("SYNTAX", 39999)
    assert ingest('{"a":1,"a":2,}') == rejected("SYNTAX", 13)  # grammar wins over a value-level defect


def test_wrong_argument_is_not_a_rejection():
    for wrong in ("{}", [0x7B, 0x7D], None):
        with pytest.raises(TypeError):
            experimental_candidate_ingress(wrong)
    assert issubclass(ExperimentalCandidateInternalError, Exception)
    assert isinstance(experimental_candidate_ingress(bytearray(b"{}")), CandidateIngressAccept)
