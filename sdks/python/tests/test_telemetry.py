"""Tests for dcp_ai.observability mirroring the TypeScript SDK's telemetry test suite."""

from __future__ import annotations

from typing import Any, Dict, List

import pytest

from dcp_ai import dcp_telemetry
from dcp_ai.observability.telemetry import (
    DcpTelemetry,
    MetricsSummary,
    PercentileStats,
    _compute_percentiles,
)


@pytest.fixture(autouse=True)
def _reset_singleton():
    """Isolate every test from the shared singleton state."""
    dcp_telemetry.reset()
    dcp_telemetry.init(enabled=False, exporter_type="none")
    yield
    dcp_telemetry.reset()
    dcp_telemetry.init(enabled=False, exporter_type="none")


class TestDisabledByDefault:
    def test_not_enabled_initially(self):
        assert dcp_telemetry.is_enabled is False

    def test_recorders_are_no_ops_when_disabled(self):
        dcp_telemetry.record_sign_latency(10.0, "ed25519")
        dcp_telemetry.record_verify_latency(5.0, "ed25519")
        dcp_telemetry.record_kem_latency(20.0, "encapsulate")
        dcp_telemetry.record_checkpoint_latency(15.0, "routine")
        dcp_telemetry.record_bundle_verify(30.0, True, "standard")
        dcp_telemetry.record_cache_hit()
        dcp_telemetry.record_cache_miss()
        dcp_telemetry.record_a2a_session()
        dcp_telemetry.record_a2a_message()
        dcp_telemetry.record_error("sign", "fail")

        summary = dcp_telemetry.get_metrics_summary()
        assert summary.sign.count == 0
        assert summary.verify.count == 0
        assert summary.kem.count == 0
        assert summary.checkpoint.count == 0
        assert summary.bundle_verify.count == 0
        assert summary.cache_hit_rate == 0.0
        assert summary.totals["signatures_created"] == 0
        assert summary.totals["signatures_verified"] == 0
        assert summary.totals["bundles_verified"] == 0
        assert summary.totals["errors"] == 0


class TestEnabled:
    def test_init_fires_init_event(self):
        events: List[Dict[str, Any]] = []
        unsub = dcp_telemetry.on_event(events.append)
        try:
            dcp_telemetry.init(enabled=True, service_name="test-svc", exporter_type="none")
            init_events = [e for e in events if e["type"] == "init"]
            assert len(init_events) == 1
            assert init_events[0]["service_name"] == "test-svc"
        finally:
            unsub()

    def test_event_bus_delivers_recorder_events(self):
        dcp_telemetry.init(enabled=True, exporter_type="none")
        events: List[Dict[str, Any]] = []
        unsub = dcp_telemetry.on_event(events.append)
        try:
            dcp_telemetry.record_sign_latency(2.0, "ed25519")
            dcp_telemetry.record_verify_latency(1.5, "ed25519")
            dcp_telemetry.record_bundle_verify(8.0, True, "elevated")
            dcp_telemetry.record_error("sign", "boom")

            metric_events = [e for e in events if e["type"] == "metric"]
            error_events = [e for e in events if e["type"] == "error"]
            assert any(e["name"] == "sign_latency_ms" for e in metric_events)
            assert any(e["name"] == "verify_latency_ms" for e in metric_events)
            assert any(e["name"] == "bundle_verify_ms" for e in metric_events)
            assert error_events and error_events[0]["operation"] == "sign"
        finally:
            unsub()

    def test_summary_math_matches_expected_percentiles(self):
        dcp_telemetry.init(enabled=True, exporter_type="none")
        for value in [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]:
            dcp_telemetry.record_sign_latency(float(value), "ed25519")
        summary = dcp_telemetry.get_metrics_summary()
        assert summary.sign.count == 10
        assert summary.sign.min == 1.0
        assert summary.sign.max == 10.0
        assert summary.sign.mean == 5.5
        # p50 (index 5 of 0-9 sorted): 6
        assert summary.sign.p50 == 6.0

    def test_tier_distribution_grows(self):
        dcp_telemetry.init(enabled=True, exporter_type="none")
        dcp_telemetry.record_bundle_verify(1.0, True, "routine")
        dcp_telemetry.record_bundle_verify(1.0, True, "routine")
        dcp_telemetry.record_bundle_verify(1.0, True, "elevated")
        summary = dcp_telemetry.get_metrics_summary()
        assert summary.tier_distribution["routine"] == 2
        assert summary.tier_distribution["elevated"] == 1
        assert summary.tier_distribution["maximum"] == 0

    def test_listener_exception_does_not_break_emit(self):
        dcp_telemetry.init(enabled=True, exporter_type="none")

        def bad_listener(_event):
            raise RuntimeError("listener bug")

        unsub = dcp_telemetry.on_event(bad_listener)
        try:
            # Must not raise
            dcp_telemetry.record_sign_latency(1.0, "ed25519")
        finally:
            unsub()


class TestSpans:
    def test_start_end_records_duration(self):
        dcp_telemetry.init(enabled=True, exporter_type="none")
        events: List[Dict[str, Any]] = []
        unsub = dcp_telemetry.on_event(events.append)
        try:
            sid = dcp_telemetry.start_span("dcp.test", {"n": 1})
            assert sid != ""
            duration = dcp_telemetry.end_span(sid)
            assert duration >= 0.0
            span_events = [e for e in events if e["type"] == "span"]
            assert len(span_events) == 1
            assert span_events[0]["span"]["name"] == "dcp.test"
            assert span_events[0]["span"]["attributes"]["n"] == 1
        finally:
            unsub()

    def test_end_span_unknown_id_is_noop(self):
        dcp_telemetry.init(enabled=True, exporter_type="none")
        assert dcp_telemetry.end_span("no-such-span") == 0.0


class TestSignObjectInstrumented:
    """Verify that sign_object / verify_object emit telemetry when enabled."""

    def test_sign_object_emits_metric_when_enabled(self):
        from dcp_ai import generate_keypair, sign_object

        dcp_telemetry.init(enabled=True, exporter_type="none")
        events: List[Dict[str, Any]] = []
        unsub = dcp_telemetry.on_event(events.append)
        try:
            kp = generate_keypair()
            sign_object({"x": 1}, kp["secret_key_b64"])

            sign_metrics = [
                e for e in events if e["type"] == "metric" and e["name"] == "sign_latency_ms"
            ]
            assert len(sign_metrics) == 1
            assert sign_metrics[0]["labels"] == {"algorithm": "ed25519"}

            summary = dcp_telemetry.get_metrics_summary()
            assert summary.totals["signatures_created"] == 1
            assert summary.sign.count == 1
        finally:
            unsub()

    def test_sign_object_silent_when_disabled(self):
        from dcp_ai import generate_keypair, sign_object

        events: List[Dict[str, Any]] = []
        unsub = dcp_telemetry.on_event(events.append)
        try:
            kp = generate_keypair()
            sign_object({"x": 1}, kp["secret_key_b64"])
            assert events == []
        finally:
            unsub()


class TestOtlpExporter:
    def test_surfaces_missing_deps_as_error_event(self):
        """Simulate 'opentelemetry is not installed' by monkey-patching the import."""
        import builtins

        real_import = builtins.__import__

        def fake_import(name, *args, **kwargs):
            if name.startswith("opentelemetry"):
                raise ImportError(f"No module named '{name}'")
            return real_import(name, *args, **kwargs)

        events: List[Dict[str, Any]] = []
        unsub = dcp_telemetry.on_event(events.append)
        try:
            builtins.__import__ = fake_import
            dcp_telemetry.init(
                enabled=True,
                service_name="otlp-missing",
                exporter_type="otlp",
                otlp_endpoint="http://localhost:4318",
            )
            error_events = [e for e in events if e["type"] == "error"]
            assert any(
                "opentelemetry" in str(e.get("error", "")).lower() for e in error_events
            )
        finally:
            builtins.__import__ = real_import
            unsub()


class TestPercentileHelper:
    def test_empty_returns_zero_stats(self):
        stats = _compute_percentiles([])
        assert stats.count == 0
        assert stats.mean == 0.0

    def test_single_value(self):
        stats = _compute_percentiles([42.0])
        assert stats.count == 1
        assert stats.min == 42.0
        assert stats.max == 42.0
        assert stats.p50 == 42.0

    def test_isolated_instance(self):
        # Also verify the class works outside of the shared singleton
        t = DcpTelemetry()
        t.init(enabled=True, exporter_type="none")
        t.record_sign_latency(3.0, "ed25519")
        assert t.get_metrics_summary().totals["signatures_created"] == 1
