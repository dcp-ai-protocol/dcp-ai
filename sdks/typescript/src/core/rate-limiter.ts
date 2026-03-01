export interface RateLimiterConfig {
  windowMs: number;
  maxRequests: number;
  keyExtractor?: (context: RateLimitContext) => string;
}

export interface RateLimitContext {
  agent_id?: string;
  ip?: string;
  risk_score?: number;
  action_type?: string;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export class RateLimiter {
  private entries = new Map<string, RateLimitEntry>();
  private config: RateLimiterConfig;

  constructor(config: RateLimiterConfig) {
    this.config = config;
  }

  check(context: RateLimitContext): { allowed: boolean; remaining: number; resetMs: number } {
    const key = this.config.keyExtractor
      ? this.config.keyExtractor(context)
      : context.agent_id || context.ip || 'global';

    const now = Date.now();
    let entry = this.entries.get(key);

    if (!entry || now - entry.windowStart >= this.config.windowMs) {
      entry = { count: 0, windowStart: now };
      this.entries.set(key, entry);
    }

    entry.count++;
    const remaining = Math.max(0, this.config.maxRequests - entry.count);
    const resetMs = this.config.windowMs - (now - entry.windowStart);

    return {
      allowed: entry.count <= this.config.maxRequests,
      remaining,
      resetMs,
    };
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.windowStart >= this.config.windowMs) {
        this.entries.delete(key);
      }
    }
  }
}

export class AdaptiveRateLimiter {
  private limiters: Map<string, RateLimiter> = new Map();
  private tierConfigs: Record<string, RateLimiterConfig> = {
    routine: { windowMs: 60000, maxRequests: 1000 },
    standard: { windowMs: 60000, maxRequests: 500 },
    elevated: { windowMs: 60000, maxRequests: 100 },
    maximum: { windowMs: 60000, maxRequests: 50 },
  };

  constructor(customConfigs?: Record<string, RateLimiterConfig>) {
    if (customConfigs) {
      this.tierConfigs = { ...this.tierConfigs, ...customConfigs };
    }
  }

  check(context: RateLimitContext, tier: string): { allowed: boolean; remaining: number; resetMs: number } {
    const config = this.tierConfigs[tier] || this.tierConfigs.standard;
    const key = `${tier}:${context.agent_id || context.ip || 'global'}`;

    if (!this.limiters.has(key)) {
      this.limiters.set(key, new RateLimiter(config));
    }

    return this.limiters.get(key)!.check(context);
  }

  cleanup(): void {
    for (const limiter of this.limiters.values()) {
      limiter.cleanup();
    }
  }
}
