"""Generate tests/conformance/v2/merkle_vectors.json: exact dual Merkle roots from leaves.

Independent reference: Python standard library only (hashlib), written from spec/VERIFICATION.md V2-11 and its
erratum, never with an SDK. Leaves are 32-byte digests given as lowercase hex; a node is the hash of the two raw
digests concatenated (left then right); an odd layer duplicates its last node; one leaf is its own root. The
2-leaf golden case must reproduce golden_vectors.json#dual_hash_vectors.dual_merkle_roots (the anchor).

    python3 tests/conformance/v2/generate-merkle-vectors.py           # rewrite the file
    python3 tests/conformance/v2/generate-merkle-vectors.py --check   # exit 1 if the committed file differs
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "merkle_vectors.json"
ALGS = {"sha256": hashlib.sha256, "sha3_256": hashlib.sha3_256}


def root(hex_leaves: list[str], alg: str) -> str:
    layer = [bytes.fromhex(h) for h in hex_leaves]
    assert layer and all(len(b) == 32 for b in layer)
    while len(layer) > 1:
        if len(layer) % 2:
            layer.append(layer[-1])
        layer = [ALGS[alg](layer[i] + layer[i + 1]).digest() for i in range(0, len(layer), 2)]
    return layer[0].hex()


def leaf(text: str) -> dict[str, str]:
    data = text.encode("ascii")
    return {alg: fn(data).hexdigest() for alg, fn in ALGS.items()}


def case(name: str, leaves: list[dict[str, str]]) -> dict:
    return {"name": name, "leaves": leaves,
            "expected": {alg: root([l[alg] for l in leaves], alg) for alg in ALGS}}


def build() -> dict:
    golden = json.loads((HERE / "golden_vectors.json").read_text(encoding="utf-8"))["dual_hash_vectors"]
    g = [{"sha256": l["sha256"], "sha3_256": l["sha3_256"]} for l in golden["audit_entry_dual_hashes"]]
    inputs = [f"dcp-ai merkle leaf {i}" for i in range(5)]
    l = [leaf(t) for t in inputs]
    cases = [
        case("one_leaf", [l[0]]),
        case("two_leaves_golden", g),
        case("two_leaves_golden_reordered", [g[1], g[0]]),
        case("three_leaves", l[:3]),
        case("three_leaves_reordered", [l[2], l[1], l[0]]),
        case("five_leaves", l[:5]),
    ]
    anchor = next(c for c in cases if c["name"] == "two_leaves_golden")["expected"]
    if anchor != {"sha256": golden["dual_merkle_roots"]["sha256"], "sha3_256": golden["dual_merkle_roots"]["sha3_256"]}:
        raise SystemExit("anchor mismatch: the 2-leaf golden roots are not reproduced")
    return {
        "_description": (
            "Exact dual Merkle roots from leaves (spec/VERIFICATION.md V2-11 and its erratum): leaves are 32-byte "
            "digests in lowercase hex; a node is H(left || right) over the raw digests; an odd layer duplicates its "
            "last node; one leaf is its own root; order matters. An empty list has no root here (the manifest rule "
            "for an empty trail is 64 zeros). two_leaves_golden reproduces golden_vectors.json#dual_hash_vectors."
        ),
        "_generator": "tests/conformance/v2/generate-merkle-vectors.py (Python standard library only; no SDK)",
        "leaf_inputs": {f"leaf_{i}": {"ascii": t, **l[i]} for i, t in enumerate(inputs)},
        "cases": cases,
    }


def main() -> int:
    text = json.dumps(build(), indent=2) + "\n"
    if sys.argv[1:] == ["--check"]:
        if OUT.read_text(encoding="utf-8") != text:
            print(f"{OUT} differs from the generator output", file=sys.stderr)
            return 1
        print(f"{OUT}: up to date")
        return 0
    if sys.argv[1:]:
        print("usage: generate-merkle-vectors.py [--check]", file=sys.stderr)
        return 2
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
