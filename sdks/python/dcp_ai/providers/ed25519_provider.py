"""
Ed25519 signature provider using PyNaCl.
"""

from __future__ import annotations

import base64

import nacl.encoding
import nacl.exceptions
import nacl.signing

from dcp_ai.v2.crypto_provider import CryptoProvider, derive_kid


class Ed25519Provider(CryptoProvider):
    alg = "ed25519"
    key_size = 32
    sig_size = 64
    is_constant_time = True

    async def generate_keypair(self) -> dict[str, str]:
        signing_key = nacl.signing.SigningKey.generate()
        verify_key = signing_key.verify_key
        pk_bytes = verify_key.encode()
        kid = derive_kid(self.alg, pk_bytes)
        return {
            "kid": kid,
            "public_key_b64": base64.b64encode(pk_bytes).decode("ascii"),
            "secret_key_b64": base64.b64encode(
                signing_key.encode() + pk_bytes
            ).decode("ascii"),
        }

    async def sign(self, message: bytes, secret_key_b64: str) -> bytes:
        sk_bytes = base64.b64decode(secret_key_b64)
        signing_key = nacl.signing.SigningKey(sk_bytes[:32])
        signed = signing_key.sign(message)
        return signed.signature

    async def verify(self, message: bytes, signature: bytes, public_key_b64: str) -> bool:
        pk_bytes = base64.b64decode(public_key_b64)
        verify_key = nacl.signing.VerifyKey(pk_bytes)
        try:
            verify_key.verify(message, signature)
            return True
        except nacl.exceptions.BadSignatureError:
            return False
