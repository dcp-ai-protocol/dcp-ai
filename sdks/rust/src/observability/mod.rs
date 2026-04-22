//! DCP-AI Observability — thread-safe telemetry for the Rust SDK.
//!
//! Mirrors the TypeScript and Python SDKs: disabled-by-default singleton,
//! event-bus fan-out, recorder methods for sign/verify/KEM/checkpoint/bundle
//! latencies, cache hits, A2A sessions, and errors. Wire an OTLP exporter via
//! the optional `otlp` feature.
//!
//! ```no_run
//! use dcp_ai::observability::{TelemetryConfig, dcp_telemetry};
//!
//! dcp_telemetry().init(TelemetryConfig {
//!     enabled: true,
//!     service_name: "my-agent".into(),
//!     ..Default::default()
//! });
//! ```

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[cfg(feature = "otlp")]
pub mod otlp;

/// SDK version surfaced to OTel as `service.version`.
pub const DCP_SDK_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone)]
pub struct TelemetryConfig {
    pub service_name: String,
    pub enabled: bool,
    pub exporter_type: ExporterType,
    pub otlp_endpoint: Option<String>,
    pub metrics_interval_ms: u64,
}

impl Default for TelemetryConfig {
    fn default() -> Self {
        Self {
            service_name: "dcp-ai-sdk".into(),
            enabled: false,
            exporter_type: ExporterType::None,
            otlp_endpoint: None,
            metrics_interval_ms: 60_000,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExporterType {
    None,
    Console,
    Otlp,
}

#[derive(Debug, Clone, Default)]
pub struct SpanAttributes(pub HashMap<String, AttrValue>);

#[derive(Debug, Clone)]
pub enum AttrValue {
    Str(String),
    Int(i64),
    Float(f64),
    Bool(bool),
}

impl From<&str> for AttrValue {
    fn from(v: &str) -> Self { AttrValue::Str(v.to_string()) }
}
impl From<String> for AttrValue {
    fn from(v: String) -> Self { AttrValue::Str(v) }
}
impl From<i64> for AttrValue {
    fn from(v: i64) -> Self { AttrValue::Int(v) }
}
impl From<u64> for AttrValue {
    fn from(v: u64) -> Self { AttrValue::Int(v as i64) }
}
impl From<f64> for AttrValue {
    fn from(v: f64) -> Self { AttrValue::Float(v) }
}
impl From<bool> for AttrValue {
    fn from(v: bool) -> Self { AttrValue::Bool(v) }
}

#[derive(Debug, Clone)]
pub struct DcpSpan {
    pub id: String,
    pub name: String,
    pub attributes: SpanAttributes,
    pub start_time_ms: u64,
    pub end_time_ms: Option<u64>,
    pub status: SpanStatus,
    pub error: Option<String>,
    start_instant: Instant,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpanStatus {
    Ok,
    Error,
}

/// Telemetry event emitted on the event bus.
#[derive(Debug, Clone)]
pub enum TelemetryEvent {
    Init { service_name: String, timestamp_ms: u64 },
    Metric { name: String, value: f64, labels: HashMap<String, String>, timestamp_ms: u64 },
    Counter { name: String, labels: HashMap<String, String>, timestamp_ms: u64 },
    Span { span: DcpSpan, timestamp_ms: u64 },
    Error { operation: String, error: String, timestamp_ms: u64 },
}

pub type Listener = Arc<dyn Fn(&TelemetryEvent) + Send + Sync>;

#[derive(Debug, Clone, Default)]
pub struct PercentileStats {
    pub count: usize,
    pub min: f64,
    pub max: f64,
    pub mean: f64,
    pub p50: f64,
    pub p95: f64,
    pub p99: f64,
}

#[derive(Debug, Clone, Default)]
pub struct Totals {
    pub signatures_created: u64,
    pub signatures_verified: u64,
    pub bundles_verified: u64,
    pub errors: u64,
    pub a2a_sessions: u64,
    pub a2a_messages: u64,
}

#[derive(Debug, Clone, Default)]
pub struct MetricsSummary {
    pub sign: PercentileStats,
    pub verify: PercentileStats,
    pub kem: PercentileStats,
    pub checkpoint: PercentileStats,
    pub bundle_verify: PercentileStats,
    pub cache_hit_rate: f64,
    pub tier_distribution: HashMap<String, u64>,
    pub totals: Totals,
}

#[derive(Default)]
struct Metrics {
    sign_latency_ms: Vec<f64>,
    verify_latency_ms: Vec<f64>,
    kem_latency_ms: Vec<f64>,
    checkpoint_latency_ms: Vec<f64>,
    bundle_verify_latency_ms: Vec<f64>,
    cache_hits: u64,
    cache_misses: u64,
    tier_distribution: HashMap<String, u64>,
    errors_total: u64,
    signatures_created: u64,
    signatures_verified: u64,
    bundles_verified: u64,
    a2a_sessions: u64,
    a2a_messages: u64,
}

impl Metrics {
    fn new() -> Self {
        let mut tier = HashMap::new();
        for t in ["routine", "standard", "elevated", "maximum"] {
            tier.insert(t.to_string(), 0u64);
        }
        Self {
            tier_distribution: tier,
            ..Default::default()
        }
    }
}

struct Inner {
    config: TelemetryConfig,
    metrics: Metrics,
    spans: HashMap<String, DcpSpan>,
    listeners: Vec<(u64, Listener)>,
    next_listener_id: u64,
    next_span_id: u64,
    #[cfg(feature = "otlp")]
    otlp_handles: Option<otlp::OtlpHandles>,
}

impl Inner {
    fn new() -> Self {
        Self {
            config: TelemetryConfig::default(),
            metrics: Metrics::new(),
            spans: HashMap::new(),
            listeners: Vec::new(),
            next_listener_id: 1,
            next_span_id: 1,
            #[cfg(feature = "otlp")]
            otlp_handles: None,
        }
    }
}

/// Thread-safe telemetry singleton.
pub struct DcpTelemetry {
    inner: Mutex<Inner>,
}

impl DcpTelemetry {
    pub fn new() -> Self {
        Self { inner: Mutex::new(Inner::new()) }
    }

    pub fn init(&self, config: TelemetryConfig) {
        let (enabled, service_name, exporter, endpoint) = {
            let mut g = self.inner.lock().unwrap();
            g.config = config.clone();
            (
                g.config.enabled,
                g.config.service_name.clone(),
                g.config.exporter_type,
                g.config.otlp_endpoint.clone(),
            )
        };
        if !enabled {
            return;
        }
        self.emit(TelemetryEvent::Init {
            service_name: service_name.clone(),
            timestamp_ms: now_ms(),
        });

        #[cfg(feature = "otlp")]
        if exporter == ExporterType::Otlp {
            match otlp::init_bridge(&service_name, endpoint.as_deref()) {
                Ok(handles) => {
                    self.inner.lock().unwrap().otlp_handles = Some(handles);
                }
                Err(e) => {
                    self.emit(TelemetryEvent::Error {
                        operation: "otlp_init".into(),
                        error: e,
                        timestamp_ms: now_ms(),
                    });
                }
            }
        }
        #[cfg(not(feature = "otlp"))]
        if exporter == ExporterType::Otlp {
            self.emit(TelemetryEvent::Error {
                operation: "otlp_init".into(),
                error: "otlp feature not enabled; rebuild dcp-ai with --features otlp".into(),
                timestamp_ms: now_ms(),
            });
            let _ = endpoint;
        }
    }

    pub fn shutdown(&self) {
        #[cfg(feature = "otlp")]
        {
            let handles = self.inner.lock().unwrap().otlp_handles.take();
            if let Some(h) = handles {
                otlp::shutdown(h);
            }
        }
        let mut g = self.inner.lock().unwrap();
        g.config = TelemetryConfig::default();
        g.metrics = Metrics::new();
        g.spans.clear();
    }

    pub fn reset(&self) {
        self.shutdown();
    }

    pub fn is_enabled(&self) -> bool {
        self.inner.lock().unwrap().config.enabled
    }

    pub fn on_event<F>(&self, listener: F) -> Unsubscribe
    where
        F: Fn(&TelemetryEvent) + Send + Sync + 'static,
    {
        let mut g = self.inner.lock().unwrap();
        let id = g.next_listener_id;
        g.next_listener_id += 1;
        g.listeners.push((id, Arc::new(listener)));
        Unsubscribe { telemetry: self as *const _ as usize, id }
    }

    fn remove_listener(&self, id: u64) {
        let mut g = self.inner.lock().unwrap();
        g.listeners.retain(|(lid, _)| *lid != id);
    }

    fn emit(&self, event: TelemetryEvent) {
        let listeners: Vec<Listener> = {
            let g = self.inner.lock().unwrap();
            if !g.config.enabled && !matches!(event, TelemetryEvent::Init { .. }) {
                return;
            }
            g.listeners.iter().map(|(_, l)| l.clone()).collect()
        };

        #[cfg(feature = "otlp")]
        {
            let handles = self.inner.lock().unwrap().otlp_handles.clone();
            if let Some(h) = handles {
                otlp::forward(&h, &event);
            }
        }

        for l in listeners {
            // Swallow listener panics so one buggy subscriber can't break others.
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| l(&event)));
        }
    }

    pub fn start_span(&self, name: &str, attrs: SpanAttributes) -> String {
        let (enabled, id) = {
            let mut g = self.inner.lock().unwrap();
            if !g.config.enabled {
                return String::new();
            }
            let id = format!("span-{}-{}", g.next_span_id, now_ms());
            g.next_span_id += 1;
            let span = DcpSpan {
                id: id.clone(),
                name: name.to_string(),
                attributes: attrs,
                start_time_ms: now_ms(),
                end_time_ms: None,
                status: SpanStatus::Ok,
                error: None,
                start_instant: Instant::now(),
            };
            g.spans.insert(id.clone(), span);
            (true, id)
        };
        let _ = enabled;
        id
    }

    pub fn end_span(&self, span_id: &str) -> f64 {
        self.end_span_with(span_id, SpanStatus::Ok, None)
    }

    pub fn end_span_with(&self, span_id: &str, status: SpanStatus, error: Option<String>) -> f64 {
        if span_id.is_empty() {
            return 0.0;
        }
        let span = {
            let mut g = self.inner.lock().unwrap();
            let mut span = match g.spans.remove(span_id) {
                Some(s) => s,
                None => return 0.0,
            };
            span.end_time_ms = Some(now_ms());
            span.status = status;
            span.error = error;
            span
        };
        let duration_ms = span.start_instant.elapsed().as_secs_f64() * 1000.0;
        self.emit(TelemetryEvent::Span { span, timestamp_ms: now_ms() });
        duration_ms
    }

    // ── Recorders ──

    pub fn record_sign_latency(&self, ms: f64, algorithm: &str) {
        {
            let mut g = self.inner.lock().unwrap();
            if !g.config.enabled { return; }
            g.metrics.sign_latency_ms.push(ms);
            g.metrics.signatures_created += 1;
        }
        self.emit_metric("sign_latency_ms", ms, &[("algorithm", algorithm)]);
        self.emit_counter("signatures_created", &[("algorithm", algorithm)]);
    }

    pub fn record_verify_latency(&self, ms: f64, algorithm: &str) {
        {
            let mut g = self.inner.lock().unwrap();
            if !g.config.enabled { return; }
            g.metrics.verify_latency_ms.push(ms);
            g.metrics.signatures_verified += 1;
        }
        self.emit_metric("verify_latency_ms", ms, &[("algorithm", algorithm)]);
        self.emit_counter("signatures_verified", &[("algorithm", algorithm)]);
    }

    pub fn record_kem_latency(&self, ms: f64, operation: &str) {
        {
            let mut g = self.inner.lock().unwrap();
            if !g.config.enabled { return; }
            g.metrics.kem_latency_ms.push(ms);
        }
        self.emit_metric("kem_latency_ms", ms, &[("operation", operation)]);
    }

    pub fn record_checkpoint_latency(&self, ms: f64, checkpoint_type: &str) {
        {
            let mut g = self.inner.lock().unwrap();
            if !g.config.enabled { return; }
            g.metrics.checkpoint_latency_ms.push(ms);
        }
        self.emit_metric("checkpoint_latency_ms", ms, &[("type", checkpoint_type)]);
    }

    pub fn record_bundle_verify(&self, ms: f64, success: bool, tier: &str) {
        {
            let mut g = self.inner.lock().unwrap();
            if !g.config.enabled { return; }
            g.metrics.bundle_verify_latency_ms.push(ms);
            if success {
                g.metrics.bundles_verified += 1;
            }
            *g.metrics.tier_distribution.entry(tier.to_string()).or_insert(0) += 1;
        }
        self.emit_metric(
            "bundle_verify_ms",
            ms,
            &[("success", if success { "true" } else { "false" }), ("tier", tier)],
        );
        if success {
            self.emit_counter("bundles_verified", &[("tier", tier)]);
        }
    }

    pub fn record_cache_hit(&self) {
        let mut g = self.inner.lock().unwrap();
        if !g.config.enabled { return; }
        g.metrics.cache_hits += 1;
    }

    pub fn record_cache_miss(&self) {
        let mut g = self.inner.lock().unwrap();
        if !g.config.enabled { return; }
        g.metrics.cache_misses += 1;
    }

    pub fn record_a2a_session(&self) {
        {
            let mut g = self.inner.lock().unwrap();
            if !g.config.enabled { return; }
            g.metrics.a2a_sessions += 1;
        }
        self.emit_counter("a2a_sessions", &[]);
    }

    pub fn record_a2a_message(&self) {
        {
            let mut g = self.inner.lock().unwrap();
            if !g.config.enabled { return; }
            g.metrics.a2a_messages += 1;
        }
        self.emit_counter("a2a_messages", &[]);
    }

    pub fn record_error(&self, operation: &str, error: &str) {
        {
            let mut g = self.inner.lock().unwrap();
            if !g.config.enabled { return; }
            g.metrics.errors_total += 1;
        }
        self.emit(TelemetryEvent::Error {
            operation: operation.to_string(),
            error: error.to_string(),
            timestamp_ms: now_ms(),
        });
    }

    pub fn get_metrics_summary(&self) -> MetricsSummary {
        let g = self.inner.lock().unwrap();
        let m = &g.metrics;
        let total_cache = m.cache_hits + m.cache_misses;
        MetricsSummary {
            sign: compute_percentiles(&m.sign_latency_ms),
            verify: compute_percentiles(&m.verify_latency_ms),
            kem: compute_percentiles(&m.kem_latency_ms),
            checkpoint: compute_percentiles(&m.checkpoint_latency_ms),
            bundle_verify: compute_percentiles(&m.bundle_verify_latency_ms),
            cache_hit_rate: if total_cache == 0 {
                0.0
            } else {
                m.cache_hits as f64 / total_cache as f64
            },
            tier_distribution: m.tier_distribution.clone(),
            totals: Totals {
                signatures_created: m.signatures_created,
                signatures_verified: m.signatures_verified,
                bundles_verified: m.bundles_verified,
                errors: m.errors_total,
                a2a_sessions: m.a2a_sessions,
                a2a_messages: m.a2a_messages,
            },
        }
    }

    fn emit_metric(&self, name: &str, value: f64, labels: &[(&str, &str)]) {
        let mut m = HashMap::new();
        for (k, v) in labels {
            m.insert(k.to_string(), v.to_string());
        }
        self.emit(TelemetryEvent::Metric {
            name: name.to_string(),
            value,
            labels: m,
            timestamp_ms: now_ms(),
        });
    }

    fn emit_counter(&self, name: &str, labels: &[(&str, &str)]) {
        let mut m = HashMap::new();
        for (k, v) in labels {
            m.insert(k.to_string(), v.to_string());
        }
        self.emit(TelemetryEvent::Counter {
            name: name.to_string(),
            labels: m,
            timestamp_ms: now_ms(),
        });
    }
}

impl Default for DcpTelemetry {
    fn default() -> Self {
        Self::new()
    }
}

/// Unsubscribe handle returned by `on_event`.
pub struct Unsubscribe {
    telemetry: usize,
    id: u64,
}

impl Unsubscribe {
    pub fn call(self) {
        unsafe {
            let tel = &*(self.telemetry as *const DcpTelemetry);
            tel.remove_listener(self.id);
        }
    }
}

pub(crate) fn compute_percentiles(values: &[f64]) -> PercentileStats {
    if values.is_empty() {
        return PercentileStats::default();
    }
    let mut sorted: Vec<f64> = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = sorted.len();
    let sum: f64 = sorted.iter().sum();
    PercentileStats {
        count: n,
        min: sorted[0],
        max: sorted[n - 1],
        mean: sum / n as f64,
        p50: sorted[(n as f64 * 0.5) as usize],
        p95: sorted[(n as f64 * 0.95) as usize],
        p99: sorted[(n as f64 * 0.99) as usize],
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

static GLOBAL: OnceLock<DcpTelemetry> = OnceLock::new();

/// Process-wide telemetry singleton.
pub fn dcp_telemetry() -> &'static DcpTelemetry {
    GLOBAL.get_or_init(DcpTelemetry::new)
}

/// Convenience: build `SpanAttributes` from a slice of `(&str, AttrValue)`.
pub fn attrs<I, V>(entries: I) -> SpanAttributes
where
    I: IntoIterator<Item = (&'static str, V)>,
    V: Into<AttrValue>,
{
    let mut m = HashMap::new();
    for (k, v) in entries {
        m.insert(k.to_string(), v.into());
    }
    SpanAttributes(m)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> DcpTelemetry {
        DcpTelemetry::new()
    }

    #[test]
    fn disabled_by_default() {
        let t = fresh();
        assert!(!t.is_enabled());
        t.record_sign_latency(10.0, "ed25519");
        let s = t.get_metrics_summary();
        assert_eq!(s.sign.count, 0);
        assert_eq!(s.totals.signatures_created, 0);
    }

    #[test]
    fn emits_init_event() {
        let t = fresh();
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let seen_clone = seen.clone();
        let _u = t.on_event(move |ev| {
            if let TelemetryEvent::Init { service_name, .. } = ev {
                seen_clone.lock().unwrap().push(service_name.clone());
            }
        });
        t.init(TelemetryConfig { enabled: true, service_name: "svc".into(), ..Default::default() });
        assert_eq!(seen.lock().unwrap().as_slice(), &["svc".to_string()]);
    }

    #[test]
    fn records_sign_verify_and_aggregates() {
        let t = fresh();
        t.init(TelemetryConfig { enabled: true, ..Default::default() });
        for v in 1..=10 {
            t.record_sign_latency(v as f64, "ed25519");
        }
        t.record_verify_latency(3.0, "ed25519");
        let s = t.get_metrics_summary();
        assert_eq!(s.sign.count, 10);
        assert_eq!(s.sign.min, 1.0);
        assert_eq!(s.sign.max, 10.0);
        assert_eq!(s.sign.mean, 5.5);
        assert_eq!(s.sign.p50, 6.0);
        assert_eq!(s.totals.signatures_created, 10);
        assert_eq!(s.totals.signatures_verified, 1);
    }

    #[test]
    fn tier_distribution_grows() {
        let t = fresh();
        t.init(TelemetryConfig { enabled: true, ..Default::default() });
        t.record_bundle_verify(1.0, true, "routine");
        t.record_bundle_verify(1.0, true, "routine");
        t.record_bundle_verify(1.0, true, "elevated");
        let s = t.get_metrics_summary();
        assert_eq!(s.tier_distribution.get("routine").copied().unwrap_or(0), 2);
        assert_eq!(s.tier_distribution.get("elevated").copied().unwrap_or(0), 1);
        assert_eq!(s.tier_distribution.get("maximum").copied().unwrap_or(0), 0);
    }

    #[test]
    fn span_lifecycle_records_duration() {
        let t = fresh();
        t.init(TelemetryConfig { enabled: true, ..Default::default() });
        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let ec = events.clone();
        let _u = t.on_event(move |ev| {
            if let TelemetryEvent::Span { span, .. } = ev {
                ec.lock().unwrap().push(span.name.clone());
            }
        });
        let sid = t.start_span("dcp.test", attrs([("n", 1i64)]));
        assert!(!sid.is_empty());
        let d = t.end_span(&sid);
        assert!(d >= 0.0);
        assert_eq!(events.lock().unwrap().as_slice(), &["dcp.test".to_string()]);
    }

    #[test]
    fn end_unknown_span_is_noop() {
        let t = fresh();
        t.init(TelemetryConfig { enabled: true, ..Default::default() });
        assert_eq!(t.end_span("nope"), 0.0);
    }

    #[test]
    fn percentiles_empty_and_single() {
        let empty = compute_percentiles(&[]);
        assert_eq!(empty.count, 0);
        let one = compute_percentiles(&[42.0]);
        assert_eq!(one.count, 1);
        assert_eq!(one.min, 42.0);
        assert_eq!(one.max, 42.0);
        assert_eq!(one.p50, 42.0);
    }

    #[test]
    fn listener_panic_does_not_break_emit() {
        let t = fresh();
        t.init(TelemetryConfig { enabled: true, ..Default::default() });
        let _u = t.on_event(|_| panic!("boom"));
        // Must not propagate.
        t.record_sign_latency(1.0, "ed25519");
    }

    #[test]
    fn cache_hit_rate() {
        let t = fresh();
        t.init(TelemetryConfig { enabled: true, ..Default::default() });
        t.record_cache_hit();
        t.record_cache_hit();
        t.record_cache_hit();
        t.record_cache_miss();
        let s = t.get_metrics_summary();
        assert_eq!(s.cache_hit_rate, 0.75);
    }

    #[test]
    fn error_increments_totals_and_emits() {
        let t = fresh();
        t.init(TelemetryConfig { enabled: true, ..Default::default() });
        let got = Arc::new(Mutex::new(false));
        let g = got.clone();
        let _u = t.on_event(move |ev| {
            if let TelemetryEvent::Error { operation, .. } = ev {
                if operation == "sign" { *g.lock().unwrap() = true; }
            }
        });
        t.record_error("sign", "boom");
        assert!(*got.lock().unwrap());
        assert_eq!(t.get_metrics_summary().totals.errors, 1);
    }
}
