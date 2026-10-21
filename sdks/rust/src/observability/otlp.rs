//! OTLP bridge — forwards `TelemetryEvent` values to OpenTelemetry traces &
//! metrics. Enabled via the `otlp` Cargo feature.
//!
//! Spans go through the SDK's batch span processor and metrics through a
//! periodic reader. Both run on their own background threads and export over
//! OTLP/HTTP (protobuf) with the blocking `reqwest` client, so the bridge works
//! with or without an async runtime.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use opentelemetry::{
    global,
    metrics::{Counter, Histogram, Meter, MeterProvider as _},
    trace::{Tracer, TracerProvider as _},
    KeyValue,
};
use opentelemetry_otlp::{MetricExporter, SpanExporter, WithExportConfig};
use opentelemetry_sdk::{
    metrics::{PeriodicReader, SdkMeterProvider},
    trace::{Sampler, SdkTracer, SdkTracerProvider},
    Resource,
};

use super::{TelemetryEvent, DCP_SDK_VERSION};

#[derive(Clone)]
pub struct OtlpHandles {
    pub tracer_provider: SdkTracerProvider,
    pub meter_provider: SdkMeterProvider,
    pub tracer: SdkTracer,
    pub histograms: Arc<Histograms>,
    pub counters: Arc<Counters>,
}

pub struct Histograms {
    pub sign: Histogram<f64>,
    pub verify: Histogram<f64>,
    pub kem: Histogram<f64>,
    pub checkpoint: Histogram<f64>,
    pub bundle_verify: Histogram<f64>,
}

pub struct Counters {
    pub signatures_created: Counter<u64>,
    pub signatures_verified: Counter<u64>,
    pub bundles_verified: Counter<u64>,
    pub a2a_sessions: Counter<u64>,
    pub a2a_messages: Counter<u64>,
    pub errors: Counter<u64>,
}

pub fn init_bridge(service_name: &str, endpoint: Option<&str>) -> Result<OtlpHandles, String> {
    let endpoint = endpoint.unwrap_or("http://localhost:4318");

    // `builder_empty` keeps the resource to exactly these attributes (no SDK or
    // environment resource detectors), matching the previous `Resource::new`.
    let resource = Resource::builder_empty()
        .with_attributes([
            KeyValue::new("service.name", service_name.to_string()),
            KeyValue::new("service.version", DCP_SDK_VERSION.to_string()),
            KeyValue::new("sdk.language", "rust"),
        ])
        .build();

    let trace_endpoint = format!("{}/v1/traces", endpoint.trim_end_matches('/'));
    let metric_endpoint = format!("{}/v1/metrics", endpoint.trim_end_matches('/'));

    // Build both exporters before installing anything globally, so a bad
    // endpoint fails cleanly without leaving a half-initialised pipeline.
    let span_exporter = SpanExporter::builder()
        .with_http()
        .with_endpoint(trace_endpoint)
        .build()
        .map_err(|e| format!("trace exporter: {}", e))?;
    let metric_exporter = MetricExporter::builder()
        .with_http()
        .with_endpoint(metric_endpoint)
        .build()
        .map_err(|e| format!("metric exporter: {}", e))?;

    // Traces
    let tracer_provider = SdkTracerProvider::builder()
        .with_batch_exporter(span_exporter)
        .with_sampler(Sampler::AlwaysOn)
        .with_resource(resource.clone())
        .build();
    global::set_tracer_provider(tracer_provider.clone());
    let tracer = tracer_provider.tracer("dcp-ai");

    // Metrics
    let reader = PeriodicReader::builder(metric_exporter).build();
    let meter_provider = SdkMeterProvider::builder()
        .with_reader(reader)
        .with_resource(resource)
        .build();
    global::set_meter_provider(meter_provider.clone());
    let meter: Meter = meter_provider.meter("dcp-ai");

    let histograms = Arc::new(Histograms {
        sign: meter.f64_histogram("dcp.sign.latency_ms").build(),
        verify: meter.f64_histogram("dcp.verify.latency_ms").build(),
        kem: meter.f64_histogram("dcp.kem.latency_ms").build(),
        checkpoint: meter.f64_histogram("dcp.checkpoint.latency_ms").build(),
        bundle_verify: meter.f64_histogram("dcp.bundle_verify.latency_ms").build(),
    });
    let counters = Arc::new(Counters {
        signatures_created: meter.u64_counter("dcp.signatures.created").build(),
        signatures_verified: meter.u64_counter("dcp.signatures.verified").build(),
        bundles_verified: meter.u64_counter("dcp.bundles.verified").build(),
        a2a_sessions: meter.u64_counter("dcp.a2a.sessions").build(),
        a2a_messages: meter.u64_counter("dcp.a2a.messages").build(),
        errors: meter.u64_counter("dcp.errors").build(),
    });

    Ok(OtlpHandles {
        tracer_provider,
        meter_provider,
        tracer,
        histograms,
        counters,
    })
}

fn to_kv(labels: &HashMap<String, String>) -> Vec<KeyValue> {
    labels
        .iter()
        .map(|(k, v)| KeyValue::new(k.clone(), v.clone()))
        .collect()
}

pub fn forward(handles: &OtlpHandles, event: &TelemetryEvent) {
    match event {
        TelemetryEvent::Metric { name, value, labels, .. } => {
            let kv = to_kv(labels);
            match name.as_str() {
                "sign_latency_ms" => handles.histograms.sign.record(*value, &kv),
                "verify_latency_ms" => handles.histograms.verify.record(*value, &kv),
                "kem_latency_ms" => handles.histograms.kem.record(*value, &kv),
                "checkpoint_latency_ms" => handles.histograms.checkpoint.record(*value, &kv),
                "bundle_verify_ms" => handles.histograms.bundle_verify.record(*value, &kv),
                _ => {}
            }
        }
        TelemetryEvent::Counter { name, labels, .. } => {
            let kv = to_kv(labels);
            match name.as_str() {
                "signatures_created" => handles.counters.signatures_created.add(1, &kv),
                "signatures_verified" => handles.counters.signatures_verified.add(1, &kv),
                "bundles_verified" => handles.counters.bundles_verified.add(1, &kv),
                "a2a_sessions" => handles.counters.a2a_sessions.add(1, &kv),
                "a2a_messages" => handles.counters.a2a_messages.add(1, &kv),
                _ => {}
            }
        }
        TelemetryEvent::Error { operation, .. } => {
            handles
                .counters
                .errors
                .add(1, &[KeyValue::new("operation", operation.clone())]);
        }
        TelemetryEvent::Span { span, .. } => {
            use opentelemetry::trace::{Span, SpanKind, Status};
            let mut s = handles
                .tracer
                .span_builder(span.name.clone())
                .with_kind(SpanKind::Internal)
                .with_start_time(system_time_from_ms(span.start_time_ms))
                .start(&handles.tracer);
            for (k, v) in span.attributes.0.iter() {
                use super::AttrValue::*;
                let key = k.clone();
                let kv = match v {
                    Str(s) => KeyValue::new(key, s.clone()),
                    Int(i) => KeyValue::new(key, *i),
                    Float(f) => KeyValue::new(key, *f),
                    Bool(b) => KeyValue::new(key, *b),
                };
                s.set_attribute(kv);
            }
            if span.status == super::SpanStatus::Error {
                s.set_status(Status::error(span.error.clone().unwrap_or_default()));
            } else {
                s.set_status(Status::Ok);
            }
            if let Some(end_ms) = span.end_time_ms {
                s.end_with_timestamp(system_time_from_ms(end_ms));
            } else {
                s.end();
            }
        }
        TelemetryEvent::Init { .. } => {}
    }
}

fn system_time_from_ms(ms: u64) -> SystemTime {
    UNIX_EPOCH + std::time::Duration::from_millis(ms)
}

pub fn shutdown(handles: OtlpHandles) {
    let _ = handles.tracer_provider.shutdown();
    let _ = handles.meter_provider.shutdown();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::observability::{attrs, DcpTelemetry, ExporterType, TelemetryConfig};
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::Mutex;
    use std::time::Duration;

    /// Minimal OTLP/HTTP collector: records "<METHOD> <path>" for every request
    /// and answers `200 OK` with an empty body (a full success in OTLP terms).
    fn spawn_collector() -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind collector");
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen_by_server = seen.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let Ok(read_half) = stream.try_clone() else {
                    continue;
                };
                let mut reader = BufReader::new(read_half);
                let mut request_line = String::new();
                if reader.read_line(&mut request_line).is_err() {
                    continue;
                }
                let mut content_length = 0usize;
                loop {
                    let mut header = String::new();
                    if reader.read_line(&mut header).unwrap_or(0) == 0 || header == "\r\n" {
                        break;
                    }
                    if let Some((name, value)) = header.split_once(':') {
                        if name.eq_ignore_ascii_case("content-length") {
                            content_length = value.trim().parse().unwrap_or(0);
                        }
                    }
                }
                let mut body = vec![0u8; content_length];
                let _ = reader.read_exact(&mut body);
                let method_and_path: Vec<&str> = request_line.split_whitespace().take(2).collect();
                seen_by_server
                    .lock()
                    .unwrap()
                    .push(method_and_path.join(" "));
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/x-protobuf\r\n\
                      Content-Length: 0\r\nConnection: close\r\n\r\n",
                );
            }
        });
        (endpoint, seen)
    }

    #[test]
    fn exports_spans_and_metrics_over_http_without_async_runtime() {
        let (endpoint, seen) = spawn_collector();

        let telemetry = DcpTelemetry::new();
        let init_errors = Arc::new(Mutex::new(Vec::<String>::new()));
        let init_errors_sink = init_errors.clone();
        let _unsubscribe = telemetry.on_event(move |event| {
            if let TelemetryEvent::Error {
                operation, error, ..
            } = event
            {
                if operation == "otlp_init" {
                    init_errors_sink.lock().unwrap().push(error.clone());
                }
            }
        });

        telemetry.init(TelemetryConfig {
            enabled: true,
            service_name: "dcp-otlp-bridge-test".into(),
            exporter_type: ExporterType::Otlp,
            otlp_endpoint: Some(format!("{}/", endpoint)),
            ..Default::default()
        });
        assert!(
            init_errors.lock().unwrap().is_empty(),
            "{:?}",
            init_errors.lock().unwrap()
        );

        telemetry.record_sign_latency(1.5, "ed25519");
        telemetry.record_a2a_session();
        telemetry.record_error("verify", "boom");
        let span_id = telemetry.start_span("dcp.otlp.test", attrs([("n", 1i64)]));
        telemetry.end_span(&span_id);

        // Shutdown flushes the batch span processor and runs a final metrics
        // collection, both synchronously.
        telemetry.shutdown();

        let seen = seen.lock().unwrap();
        assert!(
            seen.iter().any(|r| r == "POST /v1/traces"),
            "requests: {:?}",
            seen
        );
        assert!(
            seen.iter().any(|r| r == "POST /v1/metrics"),
            "requests: {:?}",
            seen
        );
    }

    #[test]
    fn init_bridge_rejects_invalid_endpoint() {
        let err = init_bridge("dcp-otlp-bridge-test", Some("not a valid uri"))
            .err()
            .expect("an invalid endpoint must be rejected");
        assert!(
            err.starts_with("trace exporter:"),
            "unexpected error: {}",
            err
        );
    }
}
