"""
Abstract base classes for pluggable cryptographic providers (signing and KEM).
"""

from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod


def derive_kid(alg: str, public_key_bytes: bytes) -> str:
    """Derive a key ID from algorithm name and raw public key bytes.

    kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key_bytes))[0:32]
    """
    digest = hashlib.sha256(alg.encode("utf-8") + b"\x00" + public_key_bytes).digest()
    return digest[:16].hex()


class CryptoProvider(ABC):
    """Abstract signature provider supporting classical and post-quantum algorithms."""

    alg: str
    key_size: int
    sig_size: int
    is_constant_time: bool

    @abstractmethod
    async def generate_keypair(self) -> dict[str, str]:
        """Generate a keypair. Returns dict with kid, public_key_b64, secret_key_b64."""
        ...

    @abstractmethod
    async def sign(self, message: bytes, secret_key_b64: str) -> bytes:
        """Sign a message. Returns raw signature bytes."""
        ...

    @abstractmethod
    async def verify(self, message: bytes, signature: bytes, public_key_b64: str) -> bool:
        """Verify a detached signature on a message."""
        ...


class KemProvider(ABC):
    """Abstract key encapsulation mechanism provider."""

    alg: str

    @abstractmethod
    async def generate_keypair(self) -> dict[str, str]:
        """Generate a KEM keypair. Returns dict with public_key_b64, secret_key_b64."""
        ...

    @abstractmethod
    async def encapsulate(self, public_key_b64: str) -> dict[str, str]:
        """Encapsulate against a public key. Returns dict with shared_secret, ciphertext_b64."""
        ...

    @abstractmethod
    async def decapsulate(self, ciphertext_b64: str, secret_key_b64: str) -> bytes:
        """Decapsulate a ciphertext using the secret key. Returns shared secret bytes."""
        ...
