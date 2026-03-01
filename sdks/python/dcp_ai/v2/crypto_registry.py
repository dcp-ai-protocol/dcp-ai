"""
Algorithm registry for pluggable cryptographic providers.
"""

from __future__ import annotations

import threading

from dcp_ai.v2.crypto_provider import CryptoProvider, KemProvider


class AlgorithmRegistry:
    """Thread-safe registry mapping algorithm names to provider instances."""

    def __init__(self) -> None:
        self._signers: dict[str, CryptoProvider] = {}
        self._kems: dict[str, KemProvider] = {}

    def register_signer(self, provider: CryptoProvider) -> None:
        self._signers[provider.alg] = provider

    def register_kem(self, provider: KemProvider) -> None:
        self._kems[provider.alg] = provider

    def get_signer(self, alg: str) -> CryptoProvider:
        try:
            return self._signers[alg]
        except KeyError:
            raise KeyError(f"No signer registered for algorithm: {alg}")

    def get_kem(self, alg: str) -> KemProvider:
        try:
            return self._kems[alg]
        except KeyError:
            raise KeyError(f"No KEM registered for algorithm: {alg}")

    def has_signer(self, alg: str) -> bool:
        return alg in self._signers

    def has_kem(self, alg: str) -> bool:
        return alg in self._kems

    def list_signers(self) -> list[str]:
        return list(self._signers.keys())

    def list_kems(self) -> list[str]:
        return list(self._kems.keys())


_default_registry: AlgorithmRegistry | None = None
_registry_lock = threading.Lock()


def get_default_registry() -> AlgorithmRegistry:
    """Return the module-level singleton AlgorithmRegistry, creating it on first access."""
    global _default_registry
    if _default_registry is None:
        with _registry_lock:
            if _default_registry is None:
                _default_registry = AlgorithmRegistry()
    return _default_registry
