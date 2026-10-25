"""EXPERIMENTAL, opt-in (candidate ``dcp-jcs-v2``, phase 3): verification of the original bytes of a
signed bundle. The bytes are routed once by the phase 2 router, and then at most one verifier runs:

- ``reject``: none.
- ``v1_path``: today's verify_signed_bundle_v2, on the value the historical adapter decoded, which is
  what a current caller would hand it. When the adapter refused the data there is no such value, and
  nothing runs.
- ``candidate``: today's verifier, accepting exactly ``dcp-jcs-v2``, on the exact value of the bytes.

There is no second attempt under another profile. ``verified`` means the signatures and commitments
verified; it grants no trust or admission and authorizes nothing.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Literal, Optional, Union

from dcp_ai.v2.crypto_registry import AlgorithmRegistry
from dcp_ai.v2.experimental_candidate_ingress import ExperimentalCandidateInternalError
from dcp_ai.v2.experimental_candidate_router import (
    RouteCandidate,
    RouteReject,
    RouteV1Path,
    create_router,
)
from dcp_ai.v2.verify import _verify_signed_bundle_v2_with_profile, verify_signed_bundle_v2


@dataclass(frozen=True)
class CandidateVerifyResult:
    """The route, the verifier it entered (at most one) and that verifier's result as is."""

    route: Union[RouteReject, RouteV1Path, RouteCandidate]
    entered: Literal["none", "dcp-jcs-v1", "dcp-jcs-v2"]
    verification: Optional[dict[str, Any]]


def _own(value: Any, key: str) -> Any:
    return value.get(key) if isinstance(value, dict) else None


async def _finish(route: Any, registry: AlgorithmRegistry, policy: Any, now_ms: Any) -> CandidateVerifyResult:
    # Module attributes, read at call time: the tests count the entries by replacing them.
    if isinstance(route, RouteReject):
        return CandidateVerifyResult(route, "none", None)
    if isinstance(route, RouteV1Path):
        # The discriminant is ok, never the value: a decoded None is data and is delegated.
        if not route.historical.ok:
            return CandidateVerifyResult(route, "none", None)
        verification = await verify_signed_bundle_v2(route.historical.decoded, registry, policy, now_ms=now_ms)
        return CandidateVerifyResult(route, "dcp-jcs-v1", verification)
    if isinstance(route, RouteCandidate):
        if _own(_own(_own(route.value, "bundle"), "manifest"), "canonicalization_profile") != "dcp-jcs-v2":
            raise ExperimentalCandidateInternalError("a candidate route whose value does not name dcp-jcs-v2")
        verification = await _verify_signed_bundle_v2_with_profile(route.value, registry, policy, now_ms, "dcp-jcs-v2")
        return CandidateVerifyResult(route, "dcp-jcs-v2", verification)
    raise ExperimentalCandidateInternalError(f"unknown route {type(route).__name__}")


class ExperimentalCandidateVerifier:
    """A verifier of original bytes over a router (create_verifier)."""

    __slots__ = ("_router",)

    def verify(
        self,
        data: Union[bytes, bytearray, memoryview],
        registry: AlgorithmRegistry,
        policy: Any = None,
        *,
        now_ms: Optional[int] = None,
    ) -> Awaitable[CandidateVerifyResult]:
        """EXPERIMENTAL, opt-in (candidate ``dcp-jcs-v2``, phase 3): route the bytes now, on a private
        copy, and return the awaitable verification. ``policy`` and ``now_ms`` are those of
        verify_signed_bundle_v2, with the same defaults."""
        return _finish(self._router.route(data), registry, policy, now_ms)

    @property
    def configuration(self) -> dict:
        """A fresh copy of the effective configuration; changing it changes nothing."""
        return self._router.configuration


def create_verifier(*, transport: Any = None, accepted_profiles: Any = None, historical: Any = None) -> ExperimentalCandidateVerifier:
    """EXPERIMENTAL, opt-in (candidate ``dcp-jcs-v2``, phase 3): a verifier of original bytes over a
    router created from the configuration (create_router: validated before any input, no default
    profile)."""
    verifier = object.__new__(ExperimentalCandidateVerifier)
    verifier._router = create_router(transport=transport, accepted_profiles=accepted_profiles, historical=historical)
    return verifier
