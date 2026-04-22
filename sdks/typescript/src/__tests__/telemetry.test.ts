import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  dcpTelemetry,
  type TelemetryEvent,
  type DcpMetrics,
} from '../observability/telemetry.js';

describe('DcpTelemetry', () => {
  beforeEach(() => {
    dcpTelemetry.reset();
    dcpTelemetry.init({ enabled: false, exporterType: 'none' });
  });

  describe('disabled by default', () => {
    it('should not be enabled initially', () => {
      dcpTelemetry.reset();
      dcpTelemetry.init({ enabled: false });
      expect(dcpTelemetry.isEnabled).toBe(false);
    });

    it('should no-op all recording methods when disabled', () => {
      dcpTelemetry.init({ enabled: false });

      dcpTelemetry.recordSignLatency(10, 'ed25519');
      dcpTelemetry.recordVerifyLatency(5, 'ed25519');
      dcpTelemetry.recordKemLatency(20, 'encapsulate');
      dcpTelemetry.recordCheckpointLatency(15, 'routine');
      dcpTelemetry.recordBundleVerify(30, true, 'standard');
      dcpTelemetry.recordCacheHit();
      dcpTelemetry.recordCacheMiss();
      dcpTelemetry.recordA2ASession();
      dcpTelemetry.recordA2AMessage();
      dcpTelemetry.recordError('sign', 'fail');

      const metrics = dcpTelemetry.getMetrics();
      expect(metrics.signLatencyMs).toHaveLength(0);
      expect(metrics.verifyLatencyMs).toHaveLength(0);
      expect(metrics.kemLatencyMs).toHaveLength(0);
      expect(metrics.checkpointLatencyMs).toHaveLength(0);
      expect(metrics.bundleVerifyLatencyMs).toHaveLength(0);
      expect(metrics.cacheHits).toBe(0);
      expect(metrics.cacheMisses).toBe(0);
      expect(metrics.signaturesCreated).toBe(0);
      expect(metrics.signaturesVerified).toBe(0);
      expect(metrics.bundlesVerified).toBe(0);
      expect(metrics.a2aSessions).toBe(0);
      expect(metrics.a2aMessages).toBe(0);
      expect(metrics.errorsTotal).toBe(0);
    });

    it('should return empty span id when disabled', () => {
      dcpTelemetry.init({ enabled: false });
      const spanId = dcpTelemetry.startSpan('test-op');
      expect(spanId).toBe('');
    });

    it('should return 0 duration when ending span while disabled', () => {
      dcpTelemetry.init({ enabled: false });
      const duration = dcpTelemetry.endSpan('nonexistent');
      expect(duration).toBe(0);
    });
  });

  describe('init', () => {
    it('should enable telemetry with config', () => {
      dcpTelemetry.init({ serviceName: 'test-agent', enabled: true });
      expect(dcpTelemetry.isEnabled).toBe(true);
    });

    it('should emit init event when enabled', () => {
      const events: TelemetryEvent[] = [];
      dcpTelemetry.init({ enabled: true, serviceName: 'init-test' });
      dcpTelemetry.onEvent((e) => events.push(e));

      dcpTelemetry.reset();
      dcpTelemetry.init({ enabled: true, serviceName: 'init-test-2' });

      expect(events.some(e => e.type === 'init' && e.serviceName === 'init-test-2')).toBe(true);
    });

    it('should merge partial config with defaults', () => {
      dcpTelemetry.init({ enabled: true });
      expect(dcpTelemetry.isEnabled).toBe(true);
    });
  });

  describe('span lifecycle', () => {
    beforeEach(() => {
      dcpTelemetry.init({ enabled: true, serviceName: 'span-test' });
    });

    it('should create a span and return a non-empty id', () => {
      const spanId = dcpTelemetry.startSpan('crypto.sign', { algorithm: 'ed25519' });
      expect(spanId).toBeTruthy();
      expect(spanId.startsWith('crypto.sign-')).toBe(true);
    });

    it('should end a span and return positive duration', () => {
      const spanId = dcpTelemetry.startSpan('crypto.verify');
      const duration = dcpTelemetry.endSpan(spanId);
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('should set error status on span', () => {
      const events: TelemetryEvent[] = [];
      dcpTelemetry.onEvent((e) => events.push(e));

      const spanId = dcpTelemetry.startSpan('failing-op');
      dcpTelemetry.endSpan(spanId, 'error', 'signature mismatch');

      const spanEvent = events.find(e => e.type === 'span');
      expect(spanEvent).toBeDefined();
      const span = (spanEvent as TelemetryEvent & { span: { status: string; error: string } }).span;
      expect(span.status).toBe('error');
      expect(span.error).toBe('signature mismatch');
    });

    it('should return 0 for unknown span id', () => {
      const duration = dcpTelemetry.endSpan('nonexistent-span-id');
      expect(duration).toBe(0);
    });

    it('should include service name in span attributes', () => {
      const events: TelemetryEvent[] = [];
      dcpTelemetry.onEvent((e) => events.push(e));

      const spanId = dcpTelemetry.startSpan('test-op');
      dcpTelemetry.endSpan(spanId);

      const spanEvent = events.find(e => e.type === 'span');
      const span = (spanEvent as TelemetryEvent & { span: { attributes: Record<string, unknown> } }).span;
      expect(span.attributes['dcp.service']).toBe('span-test');
    });
  });

  describe('metric recording', () => {
    beforeEach(() => {
      dcpTelemetry.init({ enabled: true, serviceName: 'metrics-test' });
    });

    it('should record sign latency', () => {
      dcpTelemetry.recordSignLatency(1.5, 'ed25519');
      dcpTelemetry.recordSignLatency(2.3, 'ml-dsa-65');
      const metrics = dcpTelemetry.getMetrics();
      expect(metrics.signLatencyMs).toEqual([1.5, 2.3]);
      expect(metrics.signaturesCreated).toBe(2);
    });

    it('should record verify latency', () => {
      dcpTelemetry.recordVerifyLatency(0.8, 'ed25519');
      const metrics = dcpTelemetry.getMetrics();
      expect(metrics.verifyLatencyMs).toEqual([0.8]);
      expect(metrics.signaturesVerified).toBe(1);
    });

    it('should record KEM latency', () => {
      dcpTelemetry.recordKemLatency(5.0, 'encapsulate');
      dcpTelemetry.recordKemLatency(4.2, 'decapsulate');
      const metrics = dcpTelemetry.getMetrics();
      expect(metrics.kemLatencyMs).toEqual([5.0, 4.2]);
    });

    it('should record checkpoint latency', () => {
      dcpTelemetry.recordCheckpointLatency(12.0, 'elevated');
      const metrics = dcpTelemetry.getMetrics();
      expect(metrics.checkpointLatencyMs).toEqual([12.0]);
    });

    it('should record bundle verify with tier distribution', () => {
      dcpTelemetry.recordBundleVerify(8.0, true, 'routine');
      dcpTelemetry.recordBundleVerify(15.0, true, 'standard');
      dcpTelemetry.recordBundleVerify(25.0, false, 'elevated');

      const metrics = dcpTelemetry.getMetrics();
      expect(metrics.bundleVerifyLatencyMs).toEqual([8.0, 15.0, 25.0]);
      expect(metrics.bundlesVerified).toBe(3);
      expect(metrics.tierDistribution['routine']).toBe(1);
      expect(metrics.tierDistribution['standard']).toBe(1);
      expect(metrics.tierDistribution['elevated']).toBe(1);
      expect(metrics.errorsTotal).toBe(1);
    });
  });

  describe('cache tracking', () => {
    beforeEach(() => {
      dcpTelemetry.init({ enabled: true, serviceName: 'cache-test' });
    });

    it('should track cache hits', () => {
      dcpTelemetry.recordCacheHit();
      dcpTelemetry.recordCacheHit();
      dcpTelemetry.recordCacheHit();
      expect(dcpTelemetry.getMetrics().cacheHits).toBe(3);
    });

    it('should track cache misses', () => {
      dcpTelemetry.recordCacheMiss();
      expect(dcpTelemetry.getMetrics().cacheMisses).toBe(1);
    });

    it('should compute cache hit rate in summary', () => {
      dcpTelemetry.recordCacheHit();
      dcpTelemetry.recordCacheHit();
      dcpTelemetry.recordCacheHit();
      dcpTelemetry.recordCacheMiss();

      const summary = dcpTelemetry.getMetricsSummary();
      expect(summary.cacheHitRate).toBe(0.75);
    });

    it('should return 0 cache hit rate when no cache operations', () => {
      const summary = dcpTelemetry.getMetricsSummary();
      expect(summary.cacheHitRate).toBe(0);
    });
  });

  describe('metrics summary with percentiles', () => {
    beforeEach(() => {
      dcpTelemetry.init({ enabled: true, serviceName: 'summary-test' });
    });

    it('should compute percentiles for recorded latencies', () => {
      for (let i = 1; i <= 100; i++) {
        dcpTelemetry.recordSignLatency(i, 'ed25519');
      }

      const summary = dcpTelemetry.getMetricsSummary();
      expect(summary.sign.count).toBe(100);
      expect(summary.sign.min).toBe(1);
      expect(summary.sign.max).toBe(100);
      expect(summary.sign.p50).toBe(51);
      expect(summary.sign.p95).toBe(96);
      expect(summary.sign.p99).toBe(100);
      expect(summary.sign.mean).toBeCloseTo(50.5);
    });

    it('should return zeroed stats for empty latency arrays', () => {
      const summary = dcpTelemetry.getMetricsSummary();
      expect(summary.sign).toEqual({
        count: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0, mean: 0,
      });
      expect(summary.verify).toEqual({
        count: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0, mean: 0,
      });
    });

    it('should include totals in summary', () => {
      dcpTelemetry.recordSignLatency(1, 'ed25519');
      dcpTelemetry.recordVerifyLatency(2, 'ed25519');
      dcpTelemetry.recordBundleVerify(3, true, 'routine');
      dcpTelemetry.recordError('sign', 'bad key');
      dcpTelemetry.recordA2ASession();
      dcpTelemetry.recordA2AMessage();

      const summary = dcpTelemetry.getMetricsSummary();
      expect(summary.totals.signaturesCreated).toBe(1);
      expect(summary.totals.signaturesVerified).toBe(1);
      expect(summary.totals.bundlesVerified).toBe(1);
      expect(summary.totals.errors).toBe(1);
      expect(summary.totals.a2aSessions).toBe(1);
      expect(summary.totals.a2aMessages).toBe(1);
    });

    it('should include tier distribution in summary', () => {
      dcpTelemetry.recordBundleVerify(5, true, 'routine');
      dcpTelemetry.recordBundleVerify(10, true, 'routine');
      dcpTelemetry.recordBundleVerify(15, true, 'maximum');

      const summary = dcpTelemetry.getMetricsSummary();
      expect(summary.tierDistribution['routine']).toBe(2);
      expect(summary.tierDistribution['maximum']).toBe(1);
    });
  });

  describe('event listeners', () => {
    beforeEach(() => {
      dcpTelemetry.init({ enabled: true, serviceName: 'listener-test' });
    });

    it('should register and receive events', () => {
      const events: TelemetryEvent[] = [];
      dcpTelemetry.onEvent((e) => events.push(e));

      dcpTelemetry.recordSignLatency(1.0, 'ed25519');

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('metric');
      expect(events[0].name).toBe('sign_latency_ms');
    });

    it('should allow unsubscribing from events', () => {
      const events: TelemetryEvent[] = [];
      const unsub = dcpTelemetry.onEvent((e) => events.push(e));

      dcpTelemetry.recordSignLatency(1.0, 'ed25519');
      expect(events).toHaveLength(1);

      unsub();
      dcpTelemetry.recordSignLatency(2.0, 'ed25519');
      expect(events).toHaveLength(1);
    });

    it('should not break if a listener throws', () => {
      dcpTelemetry.onEvent(() => { throw new Error('boom'); });
      const events: TelemetryEvent[] = [];
      dcpTelemetry.onEvent((e) => events.push(e));

      dcpTelemetry.recordSignLatency(1.0, 'ed25519');
      expect(events).toHaveLength(1);
    });

    it('should emit span events', () => {
      const events: TelemetryEvent[] = [];
      dcpTelemetry.onEvent((e) => events.push(e));

      const spanId = dcpTelemetry.startSpan('test');
      dcpTelemetry.endSpan(spanId);

      expect(events.some(e => e.type === 'span')).toBe(true);
    });
  });

  describe('error recording', () => {
    beforeEach(() => {
      dcpTelemetry.init({ enabled: true, serviceName: 'error-test' });
    });

    it('should increment error count', () => {
      dcpTelemetry.recordError('verify', 'invalid signature');
      dcpTelemetry.recordError('sign', 'key expired');

      expect(dcpTelemetry.getMetrics().errorsTotal).toBe(2);
    });

    it('should emit error events', () => {
      const events: TelemetryEvent[] = [];
      dcpTelemetry.onEvent((e) => events.push(e));

      dcpTelemetry.recordError('verify', 'bad hash');

      const errorEvent = events.find(e => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.operation).toBe('verify');
      expect(errorEvent!.error).toBe('bad hash');
    });
  });

  describe('reset', () => {
    it('should clear all metrics and spans', () => {
      dcpTelemetry.init({ enabled: true, serviceName: 'reset-test' });

      dcpTelemetry.recordSignLatency(1.0, 'ed25519');
      dcpTelemetry.recordVerifyLatency(2.0, 'ed25519');
      dcpTelemetry.recordCacheHit();
      dcpTelemetry.recordA2ASession();
      dcpTelemetry.startSpan('active-span');

      dcpTelemetry.reset();

      const metrics = dcpTelemetry.getMetrics();
      expect(metrics.signLatencyMs).toHaveLength(0);
      expect(metrics.verifyLatencyMs).toHaveLength(0);
      expect(metrics.cacheHits).toBe(0);
      expect(metrics.a2aSessions).toBe(0);
      expect(metrics.signaturesCreated).toBe(0);
      expect(metrics.signaturesVerified).toBe(0);
    });
  });

  describe('A2A session and message recording', () => {
    beforeEach(() => {
      dcpTelemetry.init({ enabled: true, serviceName: 'a2a-test' });
    });

    it('should track A2A sessions', () => {
      dcpTelemetry.recordA2ASession();
      dcpTelemetry.recordA2ASession();
      expect(dcpTelemetry.getMetrics().a2aSessions).toBe(2);
    });

    it('should track A2A messages', () => {
      dcpTelemetry.recordA2AMessage();
      dcpTelemetry.recordA2AMessage();
      dcpTelemetry.recordA2AMessage();
      expect(dcpTelemetry.getMetrics().a2aMessages).toBe(3);
    });

    it('should emit event for A2A sessions', () => {
      const events: TelemetryEvent[] = [];
      dcpTelemetry.onEvent((e) => events.push(e));

      dcpTelemetry.recordA2ASession();

      const sessionEvent = events.find(e => e.name === 'a2a_sessions_total');
      expect(sessionEvent).toBeDefined();
      expect(sessionEvent!.value).toBe(1);
    });
  });

  describe('console exporter', () => {
    it('should log to console when exporterType is console', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      dcpTelemetry.init({ enabled: true, serviceName: 'console-test', exporterType: 'console' });
      dcpTelemetry.recordSignLatency(1.0, 'ed25519');

      expect(consoleSpy).toHaveBeenCalled();
      const lastCall = consoleSpy.mock.calls.at(-1)?.[0] as string;
      expect(lastCall).toContain('[DCP-AI Telemetry]');
      expect(lastCall).toContain('sign_latency_ms');

      consoleSpy.mockRestore();
    });

    it('should not log to console when exporterType is none', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      dcpTelemetry.init({ enabled: true, serviceName: 'silent-test', exporterType: 'none' });
      dcpTelemetry.recordSignLatency(1.0, 'ed25519');

      const dcpCalls = consoleSpy.mock.calls.filter(
        c => typeof c[0] === 'string' && c[0].includes('[DCP-AI Telemetry]'),
      );
      expect(dcpCalls).toHaveLength(0);

      consoleSpy.mockRestore();
    });
  });

  describe('OTLP exporter', () => {
    it('surfaces a helpful init error when OTel packages are missing', async () => {
      // The test env does not have @opentelemetry/* installed as real deps, so
      // initOtlpBridge() should fail, emit a telemetry error event, and leave
      // the exporter in a safe no-op state.
      dcpTelemetry.reset();
      const events: TelemetryEvent[] = [];
      const unsubscribe = dcpTelemetry.onEvent(e => events.push(e));

      const result = dcpTelemetry.init({
        enabled: true,
        serviceName: 'otlp-missing-deps',
        exporterType: 'otlp',
        otlpEndpoint: 'http://localhost:4318',
      });
      // init() returns a promise when exporterType === 'otlp'
      expect(result).toBeInstanceOf(Promise);
      await result;

      const errorEvents = events.filter(e => e.type === 'error');
      expect(errorEvents.length).toBeGreaterThan(0);
      const firstError = errorEvents[0] as unknown as { error?: string };
      expect(String(firstError.error ?? '')).toMatch(/opentelemetry/i);

      // And the app keeps working — listener-based telemetry still fires.
      dcpTelemetry.recordSignLatency(3.5, 'ed25519');
      const metricEvents = events.filter(e => e.type === 'metric');
      expect(metricEvents.length).toBeGreaterThan(0);

      unsubscribe();
    });

    it('does not attempt OTLP init when exporterType is console', () => {
      dcpTelemetry.reset();
      const result = dcpTelemetry.init({
        enabled: true,
        serviceName: 'console-only',
        exporterType: 'console',
      });
      // Synchronous for non-OTLP
      expect(result).toBeUndefined();
    });
  });
});
