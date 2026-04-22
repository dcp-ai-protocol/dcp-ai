//! OTLP bridge — forwards `TelemetryEvent` values to OpenTelemetry traces &
//! metrics. Enabled via the `otlp` Cargo feature.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use opentelemetry::{
    global,
    metrics::{Counter, Histogram, Meter, MeterProvider as _},
    trace::{Tracer, TracerProvider as _},
    KeyValue,
};
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{
    metrics::{PeriodicReader, SdkMeterProvider},
    runtime,
    trace::{Sampler, TracerProvider},
    Resource,
};

use super::{TelemetryEvent, DCP_SDK_VERSION};

#[derive(Clone)]
pub struct OtlpHandles {
    pub tracer_provider: TracerProvider,
    pub meter_provider: SdkMeterProvider,
    pub tracer: opentelemetry_sdk::trace::Tracer,
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

    let resource = Resource::new(vec![
        KeyValue::new("service.name", service_name.to_string()),
        KeyValue::new("service.version", DCP_SDK_VERSION.to_string()),
        KeyValue::new("sdk.language", "rust"),
    ]);

    let trace_endpoint = format!("{}/v1/traces", endpoint.trim_end_matches('/'));
    let metric_endpoint = format!("{}/v1/metrics", endpoint.trim_end_matches('/'));

    // Traces
    let tracer_provider = opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(
            opentelemetry_otlp::new_exporter()
                .http()
                .with_endpoint(trace_endpoint),
        )
        .with_trace_config(
            opentelemetry_sdk::trace::Config::default()
                .with_sampler(Sampler::AlwaysOn)
                .with_resource(resource.clone()),
        )
        .install_batch(runtime::Tokio)
        .map_err(|e| format!("tracer install: {}", e))?;

    global::set_tracer_provider(tracer_provider.clone());
    let tracer = tracer_provider.tracer("dcp-ai");

    // Metrics
    let metric_exporter = opentelemetry_otlp::new_exporter()
        .http()
        .with_endpoint(metric_endpoint)
        .build_metrics_exporter(
            Box::new(opentelemetry_sdk::metrics::reader::DefaultAggregationSelector::new()),
            Box::new(opentelemetry_sdk::metrics::reader::DefaultTemporalitySelector::new()),
        )
        .map_err(|e| format!("metric exporter: {}", e))?;

    let reader = PeriodicReader::builder(metric_exporter, runtime::Tokio).build();
    let meter_provider = SdkMeterProvider::builder()
        .with_reader(reader)
        .with_resource(resource)
        .build();
    global::set_meter_provider(meter_provider.clone());
    let meter: Meter = meter_provider.meter("dcp-ai");

    let histograms = Arc::new(Histograms {
        sign: meter.f64_histogram("dcp.sign.latency_ms").init(),
        verify: meter.f64_histogram("dcp.verify.latency_ms").init(),
        kem: meter.f64_histogram("dcp.kem.latency_ms").init(),
        checkpoint: meter.f64_histogram("dcp.checkpoint.latency_ms").init(),
        bundle_verify: meter.f64_histogram("dcp.bundle_verify.latency_ms").init(),
    });
    let counters = Arc::new(Counters {
        signatures_created: meter.u64_counter("dcp.signatures.created").init(),
        signatures_verified: meter.u64_counter("dcp.signatures.verified").init(),
        bundles_verified: meter.u64_counter("dcp.bundles.verified").init(),
        a2a_sessions: meter.u64_counter("dcp.a2a.sessions").init(),
        a2a_messages: meter.u64_counter("dcp.a2a.messages").init(),
        errors: meter.u64_counter("dcp.errors").init(),
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
