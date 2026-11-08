"""Compare full and reduced SHA-512 challenges on the frozen policy fixtures.

This is independent affine Edwards arithmetic for review, not production crypto.
No fixture is changed. It records both equations instead of assigning a policy.
Usage: python3 tools/ed25519-review/check_equations_independent.py OUT.json
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
P = 2**255 - 19
L = 2**252 + 27742317777372353535851937790883648493
D = -121665 * pow(121666, -1, P) % P
IDENTITY = (0, 1)


def point(raw):
    n = int.from_bytes(raw, "little")
    y, sign = (n & (2**255 - 1)) % P, n >> 255
    x2 = (y*y-1) * pow(D*y*y+1, -1, P) % P
    x = pow(x2, (P+3)//8, P)
    if x*x % P != x2:
        x = x * pow(2, (P-1)//4, P) % P
    assert x*x % P == x2
    return ((P-x) % P if x % 2 != sign else x, y)


def plus(a, b):
    x, y = a
    u, v = b
    z = D*x*u*y*v % P
    return ((x*v+y*u)*pow(1+z, -1, P) % P,
            (y*v+x*u)*pow(1-z, -1, P) % P)


def times(n, a):
    result = IDENTITY
    for bit in bin(n)[2:]:
        result = plus(result, result)
        if bit == "1":
            result = plus(result, a)
    return result


B = point(bytes.fromhex("5866666666666666666666666666666666666666666666666666666666666666"))
corpus_file = ROOT / "tools/ed25519-review/corpus.json"
rows = []
for c in json.loads(corpus_file.read_text())["cases"]:
    if c["category"] not in ("positive", "policy"):
        continue
    pk, sig, msg = (bytes.fromhex(c[k]) for k in ("public_key_hex", "signature_hex", "message_hex"))
    A, R = point(pk), point(sig[:32])
    s = int.from_bytes(sig[32:], "little")
    challenge = int.from_bytes(hashlib.sha512(sig[:32] + pk + msg).digest(), "little")
    lhs = times(s, B)
    full_rhs = plus(R, times(challenge, A))
    reduced_rhs = plus(R, times(challenge % L, A))
    full, reduced = lhs == full_rhs, lhs == reduced_rhs
    full8 = times(8, lhs) == times(8, full_rhs)
    reduced8 = times(8, lhs) == times(8, reduced_rhs)
    assert full8 == reduced8
    if c["category"] == "positive":
        assert full and reduced and full8
    rows.append({"id": c["id"], "full_challenge_mod8": challenge % 8,
                 "reduced_challenge_mod8": challenge % L % 8,
                 "full_challenge_cofactorless": full,
                 "reduced_challenge_cofactorless": reduced,
                 "cofactored_both": full8,
                 "generator_cofactorless_label": c["reference"].get("cofactorless_equation_holds", c["reference"].get("cofactorless_reduced_challenge_holds"))})

report = {
    "scope": "Independent review arithmetic; RFC8032 5.1.7 defines the unreduced SHA-512 challenge. Mod L preserves the cofactored equation, but can change the cofactorless equation for torsion keys.",
    "sources_sha256": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
                       for p in [corpus_file, Path(__file__).resolve()]},
    "results": rows,
}
Path(sys.argv[1]).write_text(json.dumps(report, indent=2) + "\n")
for r in rows:
    if r["full_challenge_cofactorless"] != r["reduced_challenge_cofactorless"]:
        print(r)
