"""
Python telemetry surface, shape-for-shape equivalent to the TypeScript SDK's
``dcpTelemetry`` singleton.

Design contract (matches ``@dcp-ai/sdk``):

* Instrumentation recorders are **no-ops when disabled**. The default is
  disabled; nothing is recorded until ``init(enabled=True)`` is called.
* All listener and exporter calls are wrapped so a misbehaving subscriber or a
  broken OTLP endpoint can never break the host application.
* Console exporter prints one JSON line per event, like the TypeScript version.
* OTLP exporter is loaded lazily from ``dcp_ai.observability.otlp``; the OTel
  packages are declared under the ``dcp-ai[otlp]`` install extra so baseline
  installs stay thin.
"""

from __future__ import annotations

import json
import statistics
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Dict, List, Literal, Optional, Union

SpanAttributes = Dict[str, Union[str, int, float, bool]]
ExporterType = Literal["none", "console", "otlp"]


@dataclass
class DcpSpan:
    name: str
    attributes: SpanAttributes
    start_time: float  # seconds since perf_counter origin
    end_time: Optional[float] = None
    status: Literal["ok", "error"] = "ok"
    error: Optional[str] = None

    def duration_ms(self) -> float:
        if self.end_time is None:
            return 0.0
        return (self.end_time - self.start_time) * 1000.0


@dataclass
class DcpTelemetryConfig:
    service_name: str = "dcp-ai"
    enabled: bool = False
    exporter_type: ExporterType = "none"
    otlp_endpoint: Optional[str] = None
    metrics_interval_ms: int = 15_000


@dataclass
class PercentileStats:
    count: int = 0
    min: float = 0.0
    max: float = 0.0
    p50: float = 0.0
    p95: float = 0.0
    p99: float = 0.0
    mean: float = 0.0


@dataclass
class MetricsSummary:
    sign: PercentileStats
    verify: PercentileStats
    kem: PercentileStats
    checkpoint: PercentileStats
    bundle_verify: PercentileStats
    cache_hit_rate: float
    tier_distribution: Dict[str, int]
    totals: Dict[str, int]


TelemetryEvent = Dict[str, Any]


def _percentile(sorted_values: List[float], q: float) -> float:
    if not sorted_values:
        return 0.0
    idx = int(len(sorted_values) * q)
    if idx >= len(sorted_values):
        idx = len(sorted_values) - 1
    return sorted_values[idx]


def _compute_percentiles(values: List[float]) -> PercentileStats:
    if not values:
        return PercentileStats()
    sorted_values = sorted(values)
    return PercentileStats(
        count=len(sorted_values),
        min=sorted_values[0],
        max=sorted_values[-1],
        p50=_percentile(sorted_values, 0.5),
        p95=_percentile(sorted_values, 0.95),
        p99=_percentile(sorted_values, 0.99),
        mean=statistics.fmean(sorted_values),
    )


class DcpTelemetry:
    """Singleton-style telemetry controller. Use ``dcp_telemetry`` (the module-level instance)."""

    def __init__(self) -> None:
        self._config = DcpTelemetryConfig()
        self._active_spans: Dict[str, DcpSpan] = {}
        self._finished_spans: List[DcpSpan] = []
        self._sign_latency_ms: List[float] = []
        self._verify_latency_ms: List[float] = []
        self._kem_latency_ms: List[float] = []
        self._checkpoint_latency_ms: List[float] = []
        self._bundle_verify_latency_ms: List[float] = []
        self._cache_hits = 0
        self._cache_misses = 0
        self._tier_distribution: Dict[str, int] = {
            "routine": 0,
            "standard": 0,
            "elevated": 0,
            "maximum": 0,
        }
        self._errors_total = 0
        self._signatures_created = 0
        self._signatures_verified = 0
        self._bundles_verified = 0
        self._a2a_sessions = 0
        self._a2a_messages = 0
        self._listeners: List[Callable[[TelemetryEvent], None]] = []
        self._otlp: Any = None  # OtlpHandles or None

    # --------------------------------------------------------------------- init

    def init(
        self,
        *,
        service_name: Optional[str] = None,
        enabled: Optional[bool] = None,
        exporter_type: Optional[ExporterType] = None,
        otlp_endpoint: Optional[str] = None,
        metrics_interval_ms: Optional[int] = None,
    ) -> None:
        """Configure telemetry. Safe to call more than once — last call wins."""
        if service_name is not None:
            self._config.service_name = service_name
        if enabled is not None:
            self._config.enabled = enabled
        if exporter_type is not None:
            self._config.exporter_type = exporter_type
        if otlp_endpoint is not None:
            self._config.otlp_endpoint = otlp_endpoint
        if metrics_interval_ms is not None:
            self._config.metrics_interval_ms = metrics_interval_ms

        if not self._config.enabled:
            return

        self._emit({
            "type": "init",
            "service_name": self._config.service_name,
            "timestamp": time.time(),
        })

        if self._config.exporter_type == "otlp":
            self._init_otlp_bridge()

    def _init_otlp_bridge(self) -> None:
        try:
            # Lazy import so the OTel dependency tree is only loaded when OTLP
            # is actually requested.
            from dcp_ai.observability.otlp import init_otlp  # noqa: WPS433 (lazy import on purpose)

            self._otlp = init_otlp(self._config, _sdk_version())
        except Exception as exc:  # noqa: BLE001 — we intentionally report *any* failure
            self._otlp = None
            self._emit({
                "type": "error",
                "operation": "telemetry.init_otlp",
                "error": str(exc),
                "timestamp": time.time(),
            })

    def shutdown(self) -> None:
        """Flush + close the OTLP exporter if it is active."""
        if self._otlp is not None:
            try:
                self._otlp.shutdown()
            except Exception:  # noqa: BLE001
                pass
            self._otlp = None

    # --------------------------------------------------------------- properties

    @property
    def is_enabled(self) -> bool:
        return self._config.enabled

    @property
    def config(self) -> DcpTelemetryConfig:
        return self._config

    # -------------------------------------------------------------------- spans

    def start_span(self, name: str, attributes: Optional[SpanAttributes] = None) -> str:
        if not self._config.enabled:
            return ""
        span_id = f"{name}-{uuid.uuid4().hex[:8]}"
        attrs: SpanAttributes = dict(attributes or {})
        attrs["dcp.service"] = self._config.service_name
        self._active_spans[span_id] = DcpSpan(
            name=name,
            attributes=attrs,
            start_time=time.perf_counter(),
        )
        return span_id

    def end_span(
        self,
        span_id: str,
        status: Literal["ok", "error"] = "ok",
        error: Optional[str] = None,
    ) -> float:
        if not self._config.enabled or not span_id:
            return 0.0
        span = self._active_spans.pop(span_id, None)
        if span is None:
            return 0.0
        span.end_time = time.perf_counter()
        span.status = status
        if error is not None:
            span.error = error
        duration_ms = span.duration_ms()
        self._finished_spans.append(span)
        self._emit({
            "type": "span",
            "span": {
                "name": span.name,
                "attributes": span.attributes,
                "status": span.status,
                "error": span.error,
            },
            "duration_ms": duration_ms,
            "timestamp": time.time(),
        })
        return duration_ms

    # ---------------------------------------------------------------- recorders

    def record_sign_latency(self, duration_ms: float, algorithm: str) -> None:
        if not self._config.enabled:
            return
        self._sign_latency_ms.append(duration_ms)
        self._signatures_created += 1
        self._emit({
            "type": "metric",
            "name": "sign_latency_ms",
            "value": duration_ms,
            "labels": {"algorithm": algorithm},
            "timestamp": time.time(),
        })

    def record_verify_latency(self, duration_ms: float, algorithm: str) -> None:
        if not self._config.enabled:
            return
        self._verify_latency_ms.append(duration_ms)
        self._signatures_verified += 1
        self._emit({
            "type": "metric",
            "name": "verify_latency_ms",
            "value": duration_ms,
            "labels": {"algorithm": algorithm},
            "timestamp": time.time(),
        })

    def record_kem_latency(self, duration_ms: float, operation: Literal["encapsulate", "decapsulate"]) -> None:
        if not self._config.enabled:
            return
        self._kem_latency_ms.append(duration_ms)
        self._emit({
            "type": "metric",
            "name": "kem_latency_ms",
            "value": duration_ms,
            "labels": {"operation": operation},
            "timestamp": time.time(),
        })

    def record_checkpoint_latency(self, duration_ms: float, tier: str) -> None:
        if not self._config.enabled:
            return
        self._checkpoint_latency_ms.append(duration_ms)
        self._emit({
            "type": "metric",
            "name": "checkpoint_latency_ms",
            "value": duration_ms,
            "labels": {"tier": tier},
            "timestamp": time.time(),
        })

    def record_bundle_verify(self, duration_ms: float, success: bool, tier: str) -> None:
        if not self._config.enabled:
            return
        self._bundle_verify_latency_ms.append(duration_ms)
        self._bundles_verified += 1
        self._tier_distribution[tier] = self._tier_distribution.get(tier, 0) + 1
        if not success:
            self._errors_total += 1
        self._emit({
            "type": "metric",
            "name": "bundle_verify_ms",
            "value": duration_ms,
            "labels": {"success": str(success).lower(), "tier": tier},
            "timestamp": time.time(),
        })

    def record_cache_hit(self) -> None:
        if not self._config.enabled:
            return
        self._cache_hits += 1

    def record_cache_miss(self) -> None:
        if not self._config.enabled:
            return
        self._cache_misses += 1

    def record_a2a_session(self) -> None:
        if not self._config.enabled:
            return
        self._a2a_sessions += 1
        self._emit({
            "type": "metric",
            "name": "a2a_sessions_total",
            "value": self._a2a_sessions,
            "labels": {},
            "timestamp": time.time(),
        })

    def record_a2a_message(self) -> None:
        if not self._config.enabled:
            return
        self._a2a_messages += 1

    def record_error(self, operation: str, error: str) -> None:
        if not self._config.enabled:
            return
        self._errors_total += 1
        self._emit({
            "type": "error",
            "operation": operation,
            "error": error,
            "timestamp": time.time(),
        })

    # ------------------------------------------------------------------ summary

    def get_metrics_summary(self) -> MetricsSummary:
        cache_total = self._cache_hits + self._cache_misses
        cache_hit_rate = self._cache_hits / cache_total if cache_total else 0.0
        return MetricsSummary(
            sign=_compute_percentiles(self._sign_latency_ms),
            verify=_compute_percentiles(self._verify_latency_ms),
            kem=_compute_percentiles(self._kem_latency_ms),
            checkpoint=_compute_percentiles(self._checkpoint_latency_ms),
            bundle_verify=_compute_percentiles(self._bundle_verify_latency_ms),
            cache_hit_rate=cache_hit_rate,
            tier_distribution=dict(self._tier_distribution),
            totals={
                "signatures_created": self._signatures_created,
                "signatures_verified": self._signatures_verified,
                "bundles_verified": self._bundles_verified,
                "errors": self._errors_total,
                "a2a_sessions": self._a2a_sessions,
                "a2a_messages": self._a2a_messages,
            },
        )

    # --------------------------------------------------------------- event bus

    def on_event(self, listener: Callable[[TelemetryEvent], None]) -> Callable[[], None]:
        """Subscribe to raw telemetry events. Returns an unsubscribe function."""
        self._listeners.append(listener)

        def unsubscribe() -> None:
            try:
                self._listeners.remove(listener)
            except ValueError:
                pass

        return unsubscribe

    def reset(self) -> None:
        """Discard all accumulated spans and metrics. Intended for tests."""
        self._active_spans.clear()
        self._finished_spans.clear()
        self._sign_latency_ms.clear()
        self._verify_latency_ms.clear()
        self._kem_latency_ms.clear()
        self._checkpoint_latency_ms.clear()
        self._bundle_verify_latency_ms.clear()
        self._cache_hits = 0
        self._cache_misses = 0
        for tier in list(self._tier_distribution.keys()):
            self._tier_distribution[tier] = 0
        self._errors_total = 0
        self._signatures_created = 0
        self._signatures_verified = 0
        self._bundles_verified = 0
        self._a2a_sessions = 0
        self._a2a_messages = 0

    # --------------------------------------------------------------- internals

    def _emit(self, event: TelemetryEvent) -> None:
        if self._config.exporter_type == "console":
            try:
                print(f"[DCP-AI Telemetry] {json.dumps(event, default=str)}")
            except Exception:  # noqa: BLE001 — never break the app
                pass
        if self._otlp is not None:
            try:
                self._otlp.handle_event(event)
            except Exception:  # noqa: BLE001
                pass
        for listener in list(self._listeners):
            try:
                listener(event)
            except Exception:  # noqa: BLE001
                pass


def _sdk_version() -> str:
    """Best-effort read of the installed package version. Falls back to 'unknown'."""
    try:
        from importlib.metadata import version as _pkg_version

        return _pkg_version("dcp-ai")
    except Exception:  # noqa: BLE001
        return "unknown"


# Module-level singleton. Import and use as ``from dcp_ai import dcp_telemetry``.
dcp_telemetry = DcpTelemetry()
