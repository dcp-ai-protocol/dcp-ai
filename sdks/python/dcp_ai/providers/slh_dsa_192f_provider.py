"""
SLH-DSA-SHA2-192f signature provider using pqcrypto.

FIPS 205, NIST Level 3. Backup PQ signature (hash-based, conservative).
Public key: 48 B, Signature: 35664 B.
Mathematically independent from lattice-based ML-DSA.

Pure SLH-DSA with an empty context string, i.e. the signature covers
0x00 || 0x00 || message, as in the TypeScript (@noble/post-quantum), Go (circl)
and Rust (fips205) SDKs. Up to 2.8.x this provider used PQClean's pre-standard
SPHINCS+, which signs the bare message, so its signatures did not verify in the
other SDKs (and theirs not here).
"""

from __future__ import annotations

import base64

from pqcrypto.sign.slh_dsa_sha2_192f import keygen, sign as pqc_sign, verify as pqc_verify

from dcp_ai.v2.crypto_provider import CryptoProvider, derive_kid


class SlhDsa192fProvider(CryptoProvider):
    alg = "slh-dsa-192f"
    key_size = 48
    sig_size = 35664
    is_constant_time = True

    async def generate_keypair(self) -> dict[str, str]:
        pk_bytes, sk_bytes = keygen()
        kid = derive_kid(self.alg, pk_bytes)
        return {
            "kid": kid,
            "public_key_b64": base64.b64encode(pk_bytes).decode("ascii"),
            "secret_key_b64": base64.b64encode(sk_bytes).decode("ascii"),
        }

    async def sign(self, message: bytes, secret_key_b64: str) -> bytes:
        return pqc_sign(base64.b64decode(secret_key_b64), bytes(message))

    async def verify(self, message: bytes, signature: bytes, public_key_b64: str) -> bool:
        pk_bytes = base64.b64decode(public_key_b64)
        try:
            pqc_verify(pk_bytes, bytes(message), bytes(signature))
            return True
        except ValueError:  # pqcrypto.InvalidSignatureError subclasses ValueError
            return False
