"""
Composite signature type definitions for DCP v2 hybrid classical/PQ signing.
"""

from __future__ import annotations

from typing import Literal, TypedDict


class SignatureEntry(TypedDict):
    alg: str
    kid: str
    sig_b64: str


class CompositeSignature(TypedDict):
    classical: SignatureEntry
    pq: SignatureEntry | None
    binding: Literal["pq_over_classical", "classical_only"]
