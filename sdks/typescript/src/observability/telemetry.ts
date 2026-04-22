/**
 * DCP-AI Observability — OpenTelemetry instrumentation for the SDK.
 *
 * Provides tracing, metrics, and logging for cryptographic operations,
 * verification pipelines, and A2A sessions.
 *
 * Usage:
 *   import { dcpTelemetry } from '@dcp-ai/sdk';
 *   dcpTelemetry.init({ serviceName: 'my-agent', enabled: true });
 */

export interface DcpTelemetryConfig {
  serviceName: string;
  enabled: boolean;
  exporterType?: 'console' | 'otlp' | 'none';
  otlpEndpoint?: string;
  metricsInterval?: number;
}

export interface SpanAttributes {
  [key: string]: string | number | boolean;
}

export interface DcpSpan {
  name: string;
  attributes: SpanAttributes;
  startTime: number;
  endTime?: number;
  status: 'ok' | 'error';
  error?: string;
}

export interface DcpMetrics {
  signLatencyMs: number[];
  verifyLatencyMs: number[];
  kemLatencyMs: number[];
  checkpointLatencyMs: number[];
  bundleVerifyLatencyMs: number[];
  cacheHits: number;
  cacheMisses: number;
  tierDistribution: Record<string, number>;
  errorsTotal: number;
  signaturesCreated: number;
  signaturesVerified: number;
  bundlesVerified: number;
  a2aSessions: number;
  a2aMessages: number;
}

function createDefaultMetrics(): DcpMetrics {
  return {
    signLatencyMs: [],
    verifyLatencyMs: [],
    kemLatencyMs: [],
    checkpointLatencyMs: [],
    bundleVerifyLatencyMs: [],
    cacheHits: 0,
    cacheMisses: 0,
    tierDistribution: { routine: 0, standard: 0, elevated: 0, maximum: 0 },
    errorsTotal: 0,
    signaturesCreated: 0,
    signaturesVerified: 0,
    bundlesVerified: 0,
    a2aSessions: 0,
    a2aMessages: 0,
  };
}

export interface TelemetryEvent {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface PercentileStats {
  count: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
}

export interface MetricsSummary {
  sign: PercentileStats;
  verify: PercentileStats;
  kem: PercentileStats;
  checkpoint: PercentileStats;
  bundleVerify: PercentileStats;
  cacheHitRate: number;
  tierDistribution: Record<string, number>;
  totals: {
    signaturesCreated: number;
    signaturesVerified: number;
    bundlesVerified: number;
    errors: number;
    a2aSessions: number;
    a2aMessages: number;
  };
}

function computePercentiles(values: number[]): PercentileStats {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0, mean: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
    mean: sum / sorted.length,
  };
}

// SDK version reported to OTel as `service.version`. Read at build time by
// tsup (via the `define` mechanism) or at runtime from package.json in a dev
// checkout. Falls back to a constant string if neither is available.
declare const __DCP_SDK_VERSION__: string | undefined;
function resolveSdkVersion(): string {
  try {
    if (typeof __DCP_SDK_VERSION__ === 'string' && __DCP_SDK_VERSION__.length > 0) {
      return __DCP_SDK_VERSION__;
    }
  } catch {
    /* `__DCP_SDK_VERSION__` not defined — fine outside the bundled build. */
  }
  return 'unknown';
}

interface OtlpHandlesLike {
  handleEvent(event: TelemetryEvent): void;
  shutdown(): Promise<void>;
}

class DcpTelemetry {
  private config: DcpTelemetryConfig = {
    serviceName: 'dcp-ai',
    enabled: false,
    exporterType: 'none',
  };

  private spans: DcpSpan[] = [];
  private metrics: DcpMetrics = createDefaultMetrics();
  private activeSpans: Map<string, DcpSpan> = new Map();
  private listeners: Array<(event: TelemetryEvent) => void> = [];
  private otlp: OtlpHandlesLike | null = null;

  /**
   * Initialise telemetry. Safe to call more than once; the last call wins.
   *
   * When `exporterType` is `'otlp'`, this method becomes asynchronous under the
   * hood: it kicks off a dynamic import of the OpenTelemetry SDK. The returned
   * Promise resolves once the OTel stack is wired. Callers who do not `await`
   * it will still get correct behaviour — events emitted before the OTLP
   * exporter is ready are kept in the listener fan-out and in the in-memory
   * metrics, they just aren't forwarded to OTel. Once ready, future events go
   * through.
   */
  init(config: Partial<DcpTelemetryConfig>): void | Promise<void> {
    this.config = { ...this.config, ...config };
    if (!this.config.enabled) return;
    this.emit({ type: 'init', serviceName: this.config.serviceName, timestamp: Date.now() });
    if (this.config.exporterType === 'otlp') {
      return this.initOtlpBridge();
    }
  }

  private async initOtlpBridge(): Promise<void> {
    try {
      const { initOtlp } = await import('./otlp.js');
      this.otlp = await initOtlp(this.config, resolveSdkVersion());
    } catch (err) {
      // Surface the install-hint error message from initOtlp() through the
      // listener channel so adopters can see it without crashing the app.
      this.otlp = null;
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'error', operation: 'telemetry.init_otlp', error: message, timestamp: Date.now() });
    }
  }

  async shutdown(): Promise<void> {
    if (this.otlp) {
      await this.otlp.shutdown();
      this.otlp = null;
    }
  }

  get isEnabled(): boolean {
    return this.config.enabled;
  }

  startSpan(name: string, attributes: SpanAttributes = {}): string {
    if (!this.config.enabled) return '';
    const spanId = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const span: DcpSpan = {
      name,
      attributes: { ...attributes, 'dcp.service': this.config.serviceName },
      startTime: performance.now(),
      status: 'ok',
    };
    this.activeSpans.set(spanId, span);
    return spanId;
  }

  endSpan(spanId: string, status: 'ok' | 'error' = 'ok', error?: string): number {
    if (!this.config.enabled || !spanId) return 0;
    const span = this.activeSpans.get(spanId);
    if (!span) return 0;
    span.endTime = performance.now();
    span.status = status;
    if (error) span.error = error;
    this.activeSpans.delete(spanId);
    this.spans.push(span);
    const durationMs = span.endTime - span.startTime;
    this.emit({ type: 'span', span, durationMs, timestamp: Date.now() });
    return durationMs;
  }

  recordSignLatency(durationMs: number, algorithm: string): void {
    if (!this.config.enabled) return;
    this.metrics.signLatencyMs.push(durationMs);
    this.metrics.signaturesCreated++;
    this.emit({ type: 'metric', name: 'sign_latency_ms', value: durationMs, labels: { algorithm }, timestamp: Date.now() });
  }

  recordVerifyLatency(durationMs: number, algorithm: string): void {
    if (!this.config.enabled) return;
    this.metrics.verifyLatencyMs.push(durationMs);
    this.metrics.signaturesVerified++;
    this.emit({ type: 'metric', name: 'verify_latency_ms', value: durationMs, labels: { algorithm }, timestamp: Date.now() });
  }

  recordKemLatency(durationMs: number, operation: 'encapsulate' | 'decapsulate'): void {
    if (!this.config.enabled) return;
    this.metrics.kemLatencyMs.push(durationMs);
    this.emit({ type: 'metric', name: 'kem_latency_ms', value: durationMs, labels: { operation }, timestamp: Date.now() });
  }

  recordCheckpointLatency(durationMs: number, tier: string): void {
    if (!this.config.enabled) return;
    this.metrics.checkpointLatencyMs.push(durationMs);
    this.emit({ type: 'metric', name: 'checkpoint_latency_ms', value: durationMs, labels: { tier }, timestamp: Date.now() });
  }

  recordBundleVerify(durationMs: number, success: boolean, tier: string): void {
    if (!this.config.enabled) return;
    this.metrics.bundleVerifyLatencyMs.push(durationMs);
    this.metrics.bundlesVerified++;
    this.metrics.tierDistribution[tier] = (this.metrics.tierDistribution[tier] || 0) + 1;
    if (!success) this.metrics.errorsTotal++;
    this.emit({ type: 'metric', name: 'bundle_verify_ms', value: durationMs, labels: { success: String(success), tier }, timestamp: Date.now() });
  }

  recordCacheHit(): void {
    if (!this.config.enabled) return;
    this.metrics.cacheHits++;
  }

  recordCacheMiss(): void {
    if (!this.config.enabled) return;
    this.metrics.cacheMisses++;
  }

  recordA2ASession(): void {
    if (!this.config.enabled) return;
    this.metrics.a2aSessions++;
    this.emit({ type: 'metric', name: 'a2a_sessions_total', value: this.metrics.a2aSessions, labels: {}, timestamp: Date.now() });
  }

  recordA2AMessage(): void {
    if (!this.config.enabled) return;
    this.metrics.a2aMessages++;
  }

  recordError(operation: string, error: string): void {
    if (!this.config.enabled) return;
    this.metrics.errorsTotal++;
    this.emit({ type: 'error', operation, error, timestamp: Date.now() });
  }

  getMetrics(): Readonly<DcpMetrics> {
    return { ...this.metrics };
  }

  getMetricsSummary(): MetricsSummary {
    return {
      sign: computePercentiles(this.metrics.signLatencyMs),
      verify: computePercentiles(this.metrics.verifyLatencyMs),
      kem: computePercentiles(this.metrics.kemLatencyMs),
      checkpoint: computePercentiles(this.metrics.checkpointLatencyMs),
      bundleVerify: computePercentiles(this.metrics.bundleVerifyLatencyMs),
      cacheHitRate: this.metrics.cacheHits + this.metrics.cacheMisses > 0
        ? this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses)
        : 0,
      tierDistribution: { ...this.metrics.tierDistribution },
      totals: {
        signaturesCreated: this.metrics.signaturesCreated,
        signaturesVerified: this.metrics.signaturesVerified,
        bundlesVerified: this.metrics.bundlesVerified,
        errors: this.metrics.errorsTotal,
        a2aSessions: this.metrics.a2aSessions,
        a2aMessages: this.metrics.a2aMessages,
      },
    };
  }

  onEvent(listener: (event: TelemetryEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  reset(): void {
    this.spans = [];
    this.metrics = createDefaultMetrics();
    this.activeSpans.clear();
  }

  private emit(event: TelemetryEvent): void {
    if (this.config.exporterType === 'console') {
      console.log(`[DCP-AI Telemetry] ${JSON.stringify(event)}`);
    }
    if (this.otlp) {
      try { this.otlp.handleEvent(event); } catch { /* never break the app */ }
    }
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* telemetry must not break application */ }
    }
  }
}

export const dcpTelemetry = new DcpTelemetry();
