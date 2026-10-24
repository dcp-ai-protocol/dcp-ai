"""
A revocation source over a deny list (spec/profiles/admission § 2.4).

deny_list_revocation_source(url) fetches a deny list in the format of the reference
revocation service's /.well-known/dcp-revocations.json (services/revocation) and
turns it into a revocation snapshot for a bundle's subjects with
revocation_snapshot_from_deny_list: checked_at is updated_at, a listed agent or kid
is "revoked" and every other subject "not_revoked" (the list is complete). It never
turns a failure into "not_revoked": a network error, a timeout or a non-2xx answer
raises RevocationSourceError with code REVOCATION_UNAVAILABLE, and a body that is
not JSON or not that shape raises it with code REVOCATION_INVALID.

Standard library only (urllib in a worker thread). Redirects are not followed, so
the operator's headers never go to another URL; HTTPS needs TLS 1.2 or later.
"""

from __future__ import annotations

import asyncio
import json
import math
import ssl
import urllib.parse
import urllib.request
from typing import Any, Awaitable, Callable

from dcp_ai.v2.admission import (  # noqa: F401 (RevocationListError re-exported)
    RevocationListError,
    RevocationSourceError,
    revocation_snapshot_from_deny_list,
)

# The largest deny list read, in bytes.
_MAX_BODY = 16 * 1024 * 1024


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect is a non-2xx answer: the request and its headers go nowhere else."""

    def redirect_request(self, req: Any, fp: Any, code: Any, msg: Any, headers: Any, newurl: Any) -> None:
        return None


def deny_list_revocation_source(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: float = 5.0,
) -> Callable[..., Awaitable[dict[str, Any]]]:
    """An async revocation source, `source(subjects, tenant="")`, over the deny list at `url`.

    `url` (http or https) and `headers` (for instance an Authorization header) come from
    the operator; `timeout` bounds the whole fetch, in seconds. Each call fetches the
    list again. Raises ValueError or TypeError here for an invalid configuration, and
    RevocationSourceError (code REVOCATION_UNAVAILABLE or REVOCATION_INVALID) from the
    source.
    """
    if not isinstance(url, str):
        raise TypeError("url must be a string")
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError("url must be an http or https URL")
    if headers is not None and not (
        isinstance(headers, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in headers.items())
    ):
        raise TypeError("headers must be a dict of strings")
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("timeout must be a positive number of seconds")

    request_headers = {"Accept": "application/json", **(headers or {})}
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    opener = urllib.request.build_opener(_NoRedirect(), urllib.request.HTTPSHandler(context=context))

    def fetch() -> bytes:
        request = urllib.request.Request(url, headers=request_headers, method="GET")
        # A non-2xx answer (redirects included) raises urllib.error.HTTPError.
        with opener.open(request, timeout=timeout) as response:
            return response.read(_MAX_BODY + 1)

    async def source(subjects: Any, tenant: str = "") -> dict[str, Any]:
        try:
            body = await asyncio.wait_for(asyncio.to_thread(fetch), timeout)
        except Exception as exc:  # unreachable, timed out, non-2xx, connection reset, ...
            raise RevocationSourceError(
                "REVOCATION_UNAVAILABLE", f"the deny list could not be fetched ({type(exc).__name__})"
            ) from None
        if len(body) > _MAX_BODY:
            raise RevocationListError("the deny list is larger than 16 MiB")
        try:
            document = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError, RecursionError):
            raise RevocationListError("the deny list is not JSON") from None
        return revocation_snapshot_from_deny_list(document, subjects)

    return source
