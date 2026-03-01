"""
DCP-AI v2.0 Conformance Tests (Python)

1. V1 bundles verify through the V2-era verifier
2. Golden canonical vectors match across all SDKs
3. Dual-hash chain (SHA-256 + SHA3-256) produces expected results
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from dcp_ai.crypto import canonicalize, verify_object
from dcp_ai.merkle import hash_object, merkle_root_from_hex_leaves, intent_hash
from dcp_ai.verify import verify_signed_bundle
from dcp_ai.v2.canonicalize import canonicalize_v2, assert_no_floats
from dcp_ai.v2.dual_hash import (
    sha256_hex,
    sha3_256_hex,
    dual_hash,
    dual_hash_canonical,
    dual_merkle_root,
)

FIXTURES_DIR = Path(__file__).resolve().parent.parent.parent.parent / "tests" / "conformance"
VECTORS_PATH = FIXTURES_DIR / "v2" / "golden_vectors.json"
SIGNED_BUNDLE_PATH = FIXTURES_DIR / "examples" / "citizenship_bundle.signed.json"


@pytest.fixture(scope="module")
def vectors() -> dict:
    return json.loads(VECTORS_PATH.read_text())


@pytest.fixture(scope="module")
def signed_bundle() -> dict:
    return json.loads(SIGNED_BUNDLE_PATH.read_text())


# ---------------------------------------------------------------------------
# 1. V1 Bundle Verification (backward compatibility)
# ---------------------------------------------------------------------------


class TestV1BundleVerification:
    def test_verifies_with_embedded_key(self, signed_bundle: dict) -> None:
        result = verify_signed_bundle(signed_bundle)
        assert result["verified"] is True

    def test_verifies_with_explicit_key(self, signed_bundle: dict, vectors: dict) -> None:
        pk = vectors["v1_bundle_verification"]["public_key_b64"]
        result = verify_signed_bundle(signed_bundle, public_key_b64=pk)
        assert result["verified"] is True

    def test_rejects_wrong_key(self, signed_bundle: dict) -> None:
        result = verify_signed_bundle(
            signed_bundle,
            public_key_b64="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        )
        assert result["verified"] is False

    def test_rejects_tampered_audit(self, signed_bundle: dict) -> None:
        import copy

        tampered = copy.deepcopy(signed_bundle)
        tampered["bundle"]["audit_entries"][0]["outcome"] = "tampered_outcome"
        result = verify_signed_bundle(tampered)
        assert result["verified"] is False

    def test_rejects_tampered_intent(self, signed_bundle: dict) -> None:
        import copy

        tampered = copy.deepcopy(signed_bundle)
        tampered["bundle"]["intent"]["action_type"] = "execute_code"
        result = verify_signed_bundle(tampered)
        assert result["verified"] is False

    def test_bundle_hash_matches(self, signed_bundle: dict, vectors: dict) -> None:
        expected = vectors["v1_bundle_verification"]["expected_bundle_hash"]
        canon = canonicalize(signed_bundle["bundle"])
        computed = "sha256:" + hashlib.sha256(canon.encode("utf-8")).hexdigest()
        assert computed == expected

    def test_merkle_root_matches(self, signed_bundle: dict, vectors: dict) -> None:
        expected = vectors["v1_bundle_verification"]["expected_merkle_root"]
        entries = signed_bundle["bundle"]["audit_entries"]
        leaves = [hash_object(e) for e in entries]
        root = merkle_root_from_hex_leaves(leaves)
        assert f"sha256:{root}" == expected

    def test_intent_hash_matches(self, signed_bundle: dict, vectors: dict) -> None:
        expected = vectors["v1_bundle_verification"]["intent_hash"]
        computed = intent_hash(signed_bundle["bundle"]["intent"])
        assert computed == expected

    def test_prev_hash_chain(self, signed_bundle: dict, vectors: dict) -> None:
        expected_chain = vectors["v1_bundle_verification"]["prev_hash_chain"]
        entries = signed_bundle["bundle"]["audit_entries"]
        prev = "GENESIS"
        assert prev == expected_chain[0]

        for i, entry in enumerate(entries):
            assert entry["prev_hash"] == prev, f"prev_hash mismatch at entry {i}"
            prev = hash_object(entry)
            assert prev == expected_chain[i + 1], f"hash mismatch at entry {i}"


# ---------------------------------------------------------------------------
# 2. Golden Canonical Vectors
# ---------------------------------------------------------------------------


class TestGoldenCanonicalVectors:
    def test_simple_sorted_keys(self, vectors: dict) -> None:
        case = vectors["canonicalization"]["simple_sorted_keys"]
        assert canonicalize(case["input"]) == case["expected_canonical"]

    def test_nested_objects(self, vectors: dict) -> None:
        case = vectors["canonicalization"]["nested_objects"]
        assert canonicalize(case["input"]) == case["expected_canonical"]

    def test_mixed_types(self, vectors: dict) -> None:
        case = vectors["canonicalization"]["mixed_types"]
        assert canonicalize(case["input"]) == case["expected_canonical"]

    def test_with_null(self, vectors: dict) -> None:
        case = vectors["canonicalization"]["with_null"]
        assert canonicalize(case["input"]) == case["expected_canonical"]

    def test_unicode(self, vectors: dict) -> None:
        case = vectors["canonicalization"]["unicode"]
        assert canonicalize(case["input"]) == case["expected_canonical"]


class TestV2Canonicalization:
    def test_integer_only(self, vectors: dict) -> None:
        case = vectors["v2_canonicalization"]["integer_only"]
        assert canonicalize_v2(case["input"]) == case["expected_canonical"]

    def test_rejects_floats(self) -> None:
        with pytest.raises(TypeError):
            canonicalize_v2({"score": 0.5})

    def test_rejects_nested_floats(self) -> None:
        with pytest.raises(TypeError):
            canonicalize_v2({"outer": {"inner": 3.14}})

    def test_assert_no_floats_passes_integers(self) -> None:
        assert_no_floats({"a": 1, "b": [2, 3]})

    def test_assert_no_floats_rejects(self) -> None:
        with pytest.raises(TypeError):
            assert_no_floats({"a": 1.5})


class TestHashVectors:
    def test_sha256_hello(self, vectors: dict) -> None:
        expected = vectors["hash_vectors"]["sha256_hello"]["expected_hex"]
        assert sha256_hex(b"hello") == expected

    def test_sha256_empty(self, vectors: dict) -> None:
        expected = vectors["hash_vectors"]["sha256_empty"]["expected_hex"]
        assert sha256_hex(b"") == expected

    def test_sha3_256_hello(self, vectors: dict) -> None:
        expected = vectors["hash_vectors"]["sha3_256_hello"]["expected_hex"]
        assert sha3_256_hex(b"hello") == expected

    def test_sha3_256_empty(self, vectors: dict) -> None:
        expected = vectors["hash_vectors"]["sha3_256_empty"]["expected_hex"]
        assert sha3_256_hex(b"") == expected


class TestObjectHashing:
    def test_audit_entry_hashes(self, signed_bundle: dict, vectors: dict) -> None:
        expected = vectors["v1_bundle_verification"]["audit_entry_hashes"]
        entries = signed_bundle["bundle"]["audit_entries"]
        for i, entry in enumerate(entries):
            assert hash_object(entry) == expected[i], f"hash mismatch at entry {i}"

    def test_intent_hash(self, signed_bundle: dict, vectors: dict) -> None:
        expected = vectors["dual_hash_vectors"]["intent_canonical"]["sha256"]
        assert hash_object(signed_bundle["bundle"]["intent"]) == expected


class TestMerkleRoot:
    def test_from_audit_entry_hashes(self, vectors: dict) -> None:
        leaves = vectors["v1_bundle_verification"]["audit_entry_hashes"]
        expected = vectors["dual_hash_vectors"]["dual_merkle_roots"]["sha256"]
        assert merkle_root_from_hex_leaves(leaves) == expected

    def test_empty_returns_none(self) -> None:
        assert merkle_root_from_hex_leaves([]) is None


# ---------------------------------------------------------------------------
# 3. Dual-Hash Chain Tests
# ---------------------------------------------------------------------------


class TestDualHash:
    def test_raw_matches_golden(self, vectors: dict) -> None:
        dv = vectors["dual_hash_vectors"]["raw_dual_hash"]
        result = dual_hash(dv["input_utf8"].encode("utf-8"))
        assert result["sha256"] == dv["sha256"]
        assert result["sha3_256"] == dv["sha3_256"]

    def test_sha256_sha3_differ(self) -> None:
        result = dual_hash(b"test data")
        assert result["sha256"] != result["sha3_256"]


class TestDualHashCanonical:
    def test_intent_canonical(self, vectors: dict) -> None:
        dv = vectors["dual_hash_vectors"]["intent_canonical"]
        result = dual_hash_canonical(dv["canonical_json"])
        assert result["sha256"] == dv["sha256"]
        assert result["sha3_256"] == dv["sha3_256"]

    def test_audit_entries(self, signed_bundle: dict, vectors: dict) -> None:
        expected_dual = vectors["dual_hash_vectors"]["audit_entry_dual_hashes"]
        entries = signed_bundle["bundle"]["audit_entries"]
        for i, entry in enumerate(entries):
            canon = canonicalize(entry)
            result = dual_hash_canonical(canon)
            assert result["sha256"] == expected_dual[i]["sha256"], f"SHA-256 at {i}"
            assert result["sha3_256"] == expected_dual[i]["sha3_256"], f"SHA3-256 at {i}"


class TestDualMerkleRoot:
    def test_matches_golden(self, vectors: dict) -> None:
        leaves = vectors["dual_hash_vectors"]["audit_entry_dual_hashes"]
        expected = vectors["dual_hash_vectors"]["dual_merkle_roots"]
        result = dual_merkle_root(leaves)
        assert result is not None
        assert result["sha256"] == expected["sha256"]
        assert result["sha3_256"] == expected["sha3_256"]

    def test_sha256_matches_v1_merkle(self, vectors: dict) -> None:
        leaves = vectors["dual_hash_vectors"]["audit_entry_dual_hashes"]
        result = dual_merkle_root(leaves)
        v1_root = vectors["v1_bundle_verification"]["expected_merkle_root"]
        assert result is not None
        assert result["sha256"] == v1_root[len("sha256:"):]

    def test_empty_returns_none(self) -> None:
        assert dual_merkle_root([]) is None


class TestDualHashChainIntegrity:
    def test_chain_integrity(self, signed_bundle: dict, vectors: dict) -> None:
        expected_chain = vectors["v1_bundle_verification"]["prev_hash_chain"]
        dual_hashes = vectors["dual_hash_vectors"]["audit_entry_dual_hashes"]
        entries = signed_bundle["bundle"]["audit_entries"]

        prev_sha256 = "GENESIS"
        prev_sha3 = "GENESIS"

        for i, entry in enumerate(entries):
            assert entry["prev_hash"] == prev_sha256
            canon = canonicalize(entry)
            dh = dual_hash_canonical(canon)
            prev_sha256 = dh["sha256"]
            prev_sha3 = dh["sha3_256"]
            assert prev_sha256 == expected_chain[i + 1]
            assert prev_sha3 == dual_hashes[i]["sha3_256"]
