"""
DCP-AI observability module.

Mirrors the TypeScript SDK's ``dcpTelemetry`` singleton in a Pythonic way:
spans, metric recorders, an in-process event bus, and optional export to any
OpenTelemetry-compatible backend via OTLP.

Usage::

    from dcp_ai import dcp_telemetry

    dcp_telemetry.init(
        service_name="my-agent",
        enabled=True,
        exporter_type="console",   # or "otlp" or "none"
    )

OTLP requires the optional ``dcp-ai[otlp]`` install extra.
"""

from dcp_ai.observability.telemetry import (
    DcpSpan,
    DcpTelemetry,
    MetricsSummary,
    PercentileStats,
    SpanAttributes,
    TelemetryEvent,
    dcp_telemetry,
)

__all__ = [
    "DcpSpan",
    "DcpTelemetry",
    "MetricsSummary",
    "PercentileStats",
    "SpanAttributes",
    "TelemetryEvent",
    "dcp_telemetry",
]
