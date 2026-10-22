"""
ML-KEM-768 KEM provider using pqcrypto.

FIPS 203, NIST Level 3. Primary post-quantum KEM (DCP-04 A2A session keys).
Public key: 1184 B, Secret key: 2400 B, Ciphertext: 1088 B, Shared secret: 32 B.
Malformed keys or ciphertexts raise ValueError (FIPS 203 input checks).
"""

from __future__ import annotations

import base64
from typing import Any

from pqcrypto.kem.ml_kem_768 import decaps, encaps, keygen

from dcp_ai.v2.crypto_provider import KemProvider, derive_kid


class MlKem768Provider(KemProvider):
    alg = "ml-kem-768"

    async def generate_keypair(self) -> dict[str, str]:
        pk_bytes, sk_bytes = keygen()
        return {
            "kid": derive_kid(self.alg, pk_bytes),
            "public_key_b64": base64.b64encode(pk_bytes).decode("ascii"),
            "secret_key_b64": base64.b64encode(sk_bytes).decode("ascii"),
        }

    async def encapsulate(self, public_key_b64: str) -> dict[str, Any]:
        ciphertext, shared_secret = encaps(base64.b64decode(public_key_b64))
        return {
            "shared_secret": shared_secret,
            "ciphertext_b64": base64.b64encode(ciphertext).decode("ascii"),
        }

    async def decapsulate(self, ciphertext_b64: str, secret_key_b64: str) -> bytes:
        return decaps(base64.b64decode(secret_key_b64), base64.b64decode(ciphertext_b64))
