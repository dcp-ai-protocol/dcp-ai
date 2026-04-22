"""
OTLP bridge for ``dcp_telemetry`` — Python counterpart of
``sdks/typescript/src/observability/otlp.ts``.

All ``opentelemetry.*`` imports live inside ``init_otlp`` so a stock
``pip install dcp-ai`` never touches the OTel dependency tree. The extras
are declared under the ``[otlp]`` optional extra in ``pyproject.toml``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Callable, Dict

from dcp_ai.observability.telemetry import DcpTelemetryConfig, TelemetryEvent


@dataclass
class OtlpHandles:
    handle_event: Callable[[TelemetryEvent], None]
    shutdown: Callable[[], None]


def init_otlp(config: DcpTelemetryConfig, sdk_version: str) -> OtlpHandles:
    """Wire the OTel SDK and return a small adapter that maps DCP telemetry
    events to OTel spans and histograms / counters.

    Raises:
        RuntimeError: if any of the optional OpenTelemetry packages are missing.
            The message names the exact ``pip`` command to fix it.
    """
    try:
        from opentelemetry import metrics as otel_metrics
        from opentelemetry import trace as otel_trace
        from opentelemetry.exporter.otlp.proto.http.metric_exporter import (
            OTLPMetricExporter,
        )
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.trace import SpanKind, Status, StatusCode
    except ImportError as err:
        raise RuntimeError(
            "[DCP-AI Telemetry] OTLP exporter requires the optional OpenTelemetry "
            "packages. Install them with:\n"
            "  pip install 'dcp-ai[otlp]'\n"
            f"Underlying error: {err}"
        ) from err

    endpoint = (
        config.otlp_endpoint
        or os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
        or "http://localhost:4318"
    ).rstrip("/")
    trace_url = f"{endpoint}/v1/traces"
    metrics_url = f"{endpoint}/v1/metrics"

    resource = Resource.create({
        "service.name": config.service_name,
        "service.version": sdk_version,
    })

    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=trace_url))
    )
    otel_trace.set_tracer_provider(tracer_provider)

    metric_reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=metrics_url),
        export_interval_millis=config.metrics_interval_ms,
    )
    meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader])
    otel_metrics.set_meter_provider(meter_provider)

    tracer = otel_trace.get_tracer("dcp-ai", sdk_version)
    meter = otel_metrics.get_meter("dcp-ai", sdk_version)

    histograms: Dict[str, Any] = {}
    counters: Dict[str, Any] = {}

    def histogram(name: str, unit: str = "ms") -> Any:
        h = histograms.get(name)
        if h is None:
            h = meter.create_histogram(name, unit=unit, description=f"DCP-AI {name}")
            histograms[name] = h
        return h

    def counter(name: str) -> Any:
        c = counters.get(name)
        if c is None:
            c = meter.create_counter(name, description=f"DCP-AI {name}")
            counters[name] = c
        return c

    def handle_event(event: TelemetryEvent) -> None:
        try:
            etype = event.get("type")
            if etype == "span":
                span_data = event.get("span", {}) or {}
                duration_ms = float(event.get("duration_ms") or 0.0)
                with tracer.start_as_current_span(
                    str(span_data.get("name", "dcp.span")),
                    kind=SpanKind.INTERNAL,
                    attributes={
                        **{k: v for k, v in (span_data.get("attributes") or {}).items()},
                        "dcp.duration_ms": duration_ms,
                    },
                ) as otel_span:
                    if span_data.get("status") == "error":
                        otel_span.set_status(Status(StatusCode.ERROR, span_data.get("error") or "error"))
                    else:
                        otel_span.set_status(Status(StatusCode.OK))
                return

            if etype == "metric":
                name = str(event.get("name"))
                value = float(event.get("value") or 0.0)
                labels = {str(k): str(v) for k, v in (event.get("labels") or {}).items()}
                if name == "sign_latency_ms":
                    histogram("dcp.sign.latency_ms").record(value, labels)
                    counter("dcp.signatures.created").add(1, labels)
                elif name == "verify_latency_ms":
                    histogram("dcp.verify.latency_ms").record(value, labels)
                    counter("dcp.signatures.verified").add(1, labels)
                elif name == "kem_latency_ms":
                    histogram("dcp.kem.latency_ms").record(value, labels)
                elif name == "checkpoint_latency_ms":
                    histogram("dcp.checkpoint.latency_ms").record(value, labels)
                elif name == "bundle_verify_ms":
                    histogram("dcp.bundle_verify.latency_ms").record(value, labels)
                    counter("dcp.bundles.verified").add(1, labels)
                elif name == "a2a_sessions_total":
                    counter("dcp.a2a.sessions").add(1, labels)
                else:
                    histogram("dcp.metric").record(value, {**labels, "name": name})
                return

            if etype == "error":
                counter("dcp.errors").add(1, {"operation": str(event.get("operation", "unknown"))})
                return
            # 'init' and unknown: no-op
        except Exception:  # noqa: BLE001 — never let telemetry break the app
            pass

    def shutdown() -> None:
        try:
            metric_reader.shutdown()
        except Exception:  # noqa: BLE001
            pass
        try:
            tracer_provider.shutdown()
        except Exception:  # noqa: BLE001
            pass

    return OtlpHandles(handle_event=handle_event, shutdown=shutdown)
