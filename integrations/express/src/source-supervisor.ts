/**
 * Source supervision (docs/reviews/admission-source-supervision-plan.md, step 1): a deadline and a
 * capacity for the operator's trustedPrincipals function.
 *
 * A supervisor is an object the operator creates and shares: its capacity is per object, not per
 * process. It counts each invocation the adapter starts until that invocation really settles, so a
 * source that ignores its deadline keeps its slot; there is no queue and no reset. It does not stop
 * a source's work, isolate CPU, or bound work a source starts on its own. The deadline is measured
 * on a monotonic clock and checked when a result arrives, not only when the timer runs.
 *
 * This file is identical in @dcp-ai/express and @dcp-ai/openclaw. A supervisor created by either
 * package, in its ESM or CJS build, works with both: they reach it through a Symbol.for key, not
 * instanceof.
 */

const PROTOCOL = Symbol.for('dcp-ai.source-supervisor.v1');
/** The largest delay setTimeout honours. */
export const MAX_TIMER_MS = 2_147_483_647;

export type SupervisedSource = 'trust';
export type SourceEventReason = 'timeout' | 'saturated' | 'closed' | 'late_result' | 'late_error';

/** What a supervisor reports: a fixed reason and a count, never a tenant or a source's content. */
export interface SourceEvent {
  readonly source: SupervisedSource;
  readonly reason: SourceEventReason;
  readonly inFlight: number;
}

export interface SourceSupervisorOptions {
  /** Invocations in flight at once, across every tenant: a positive safe integer. */
  maxInFlight: number;
  /** Invocations in flight at once for one tenant. Without it, one tenant can take the whole capacity. */
  maxInFlightPerTenant?: number;
  /**
   * Called with each event. It must be fast: it runs on the same event loop. One call at a time:
   * while one is queued or its returned promise is pending, further events are dropped and counted
   * (droppedEvents). Its exceptions and rejections are swallowed.
   */
  onSourceEvent?: (event: SourceEvent) => unknown;
}

export interface SourceSupervisorStats {
  open: boolean;
  inFlight: number;
  /** Tenants with an invocation in flight. */
  tenants: number;
  timeouts: number;
  saturated: number;
  closed: number;
  lateResults: number;
  lateErrors: number;
  droppedEvents: number;
}

export interface SourceSupervisor {
  stats(): SourceSupervisorStats;
  /**
   * Refuses new invocations, answers pending ones with a failure, aborts every signal and waits at
   * most `drainMs` (default 0) for invocations in flight to settle. Resolves with how many are
   * still in flight: their slots stay taken until they settle. It does not stop their work.
   */
  close(options?: { drainMs?: number }): Promise<{ inFlight: number }>;
}

export type SupervisedOutcome<T> =
  | { status: 'ok'; value: T }
  | { status: 'failed'; error: unknown }
  | { status: 'timeout' | 'saturated' | 'closed' };

interface SupervisorProtocol {
  readonly version: 1;
  run<T>(source: SupervisedSource, tenant: string, timeoutMs: number, call: (signal: AbortSignal) => T | PromiseLike<T>): Promise<SupervisedOutcome<T>>;
}

const OPTION_KEYS = ['maxInFlight', 'maxInFlightPerTenant', 'onSourceEvent'];

/** n + 1, stopping at Number.MAX_SAFE_INTEGER: a counter stays an exact integer. */
export function saturatingIncrement(n: number): number {
  return n < Number.MAX_SAFE_INTEGER ? n + 1 : Number.MAX_SAFE_INTEGER;
}
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1;

/** An integer delay from `min` to the largest setTimeout honours. */
export function isTimerMs(value: unknown, min: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= MAX_TIMER_MS;
}

export function createSourceSupervisor(options: SourceSupervisorOptions): SourceSupervisor {
  if (typeof options !== 'object' || options === null) throw new TypeError('createSourceSupervisor options must be an object');
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.includes(key)) throw new TypeError(`Unknown createSourceSupervisor option: ${key}`);
  }
  const { maxInFlight, maxInFlightPerTenant, onSourceEvent } = options;
  if (!isCount(maxInFlight)) throw new TypeError('maxInFlight must be a positive safe integer');
  if (maxInFlightPerTenant !== undefined && !isCount(maxInFlightPerTenant)) {
    throw new TypeError('maxInFlightPerTenant must be a positive safe integer');
  }
  if (onSourceEvent !== undefined && typeof onSourceEvent !== 'function') throw new TypeError('onSourceEvent must be a function');

  const tenants = new Map<string, number>();
  const controllers = new Set<AbortController>();
  const undecided = new Set<() => void>();
  const drainWaiters = new Set<() => void>();
  const counts = { timeouts: 0, saturated: 0, closed: 0, lateResults: 0, lateErrors: 0, droppedEvents: 0 };
  const count = (name: keyof typeof counts) => {
    counts[name] = saturatingIncrement(counts[name]);
  };
  let inFlight = 0;
  let open = true;
  let observerBusy = false;

  const emit = (source: SupervisedSource, reason: SourceEventReason) => {
    if (!onSourceEvent) return;
    if (observerBusy) {
      count('droppedEvents');
      return;
    }
    // Busy before queueMicrotask, so a burst of events queues one call at most.
    observerBusy = true;
    const event: SourceEvent = Object.freeze({ source, reason, inFlight });
    queueMicrotask(() => {
      // One delivery, finished once: a callback this delivery handed out cannot free a later one.
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        observerBusy = false;
      };
      let result: unknown;
      try {
        result = onSourceEvent(event);
      } catch {
        return done();
      }
      // Standard assimilation: a thenable resolves once, and one resolved with a pending promise
      // stays pending. The rejection handler also consumes an async observer's failure. Promises a
      // thenable starts and does not return are out of reach.
      Promise.resolve(result).then(done, done);
    });
  };

  const release = (tenant: string, controller: AbortController) => {
    inFlight--;
    const left = (tenants.get(tenant) ?? 1) - 1;
    if (left === 0) tenants.delete(tenant);
    else tenants.set(tenant, left);
    controllers.delete(controller);
    if (inFlight === 0) for (const wake of [...drainWaiters]) wake();
  };

  const run = <T>(
    source: SupervisedSource,
    tenant: string,
    timeoutMs: number,
    call: (signal: AbortSignal) => T | PromiseLike<T>,
  ): Promise<SupervisedOutcome<T>> => {
    if (typeof tenant !== 'string' || !isTimerMs(timeoutMs, 1) || typeof call !== 'function') {
      throw new TypeError('invalid supervised invocation');
    }
    if (!open) {
      count('closed');
      emit(source, 'closed');
      return Promise.resolve({ status: 'closed' });
    }
    const tenantInFlight = tenants.get(tenant) ?? 0;
    if (inFlight >= maxInFlight || (maxInFlightPerTenant !== undefined && tenantInFlight >= maxInFlightPerTenant)) {
      count('saturated');
      emit(source, 'saturated');
      return Promise.resolve({ status: 'saturated' });
    }
    inFlight++;
    tenants.set(tenant, tenantInFlight + 1);
    const controller = new AbortController();
    controllers.add(controller);
    const deadline = performance.now() + timeoutMs;

    return new Promise<SupervisedOutcome<T>>((resolve) => {
      let decided = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const decide = (outcome: SupervisedOutcome<T>) => {
        decided = true;
        clearTimeout(timer);
        undecided.delete(closeNow);
        resolve(outcome);
      };
      const timeOut = () => {
        count('timeouts');
        controller.abort();
        emit(source, 'timeout');
        decide({ status: 'timeout' });
      };
      const closeNow = () => {
        count('closed');
        emit(source, 'closed');
        decide({ status: 'closed' });
      };
      undecided.add(closeNow);
      // Kept referenced: in a process with nothing else pending, it is what keeps the process alive
      // until the deadline can be answered. Cleared as soon as the invocation is decided.
      timer = setTimeout(() => {
        if (!decided) timeOut();
      }, timeoutMs);

      const settle = (late: 'late_result' | 'late_error', outcome: SupervisedOutcome<T>) => {
        release(tenant, controller);
        if (!decided && performance.now() <= deadline) return decide(outcome);
        // After the deadline, even if the timer has not run yet (a busy event loop): not used.
        if (!decided) timeOut();
        if (late === 'late_result') count('lateResults');
        else count('lateErrors');
        emit(source, late);
      };
      let work: T | PromiseLike<T>;
      try {
        work = call(controller.signal);
      } catch (error) {
        return settle('late_error', { status: 'failed', error });
      }
      Promise.resolve(work).then(
        (value) => settle('late_result', { status: 'ok', value }),
        (error) => settle('late_error', { status: 'failed', error }),
      );
    });
  };

  const supervisor: SourceSupervisor = {
    stats: () => ({ open, inFlight, tenants: tenants.size, ...counts }),
    close: async (closeOptions: { drainMs?: number } = {}) => {
      if (typeof closeOptions !== 'object' || closeOptions === null) throw new TypeError('close options must be an object');
      const { drainMs = 0 } = closeOptions;
      if (!isTimerMs(drainMs, 0)) throw new TypeError(`drainMs must be an integer from 0 to ${MAX_TIMER_MS}`);
      if (open) {
        open = false;
        for (const closeNow of [...undecided]) closeNow();
        for (const controller of controllers) controller.abort();
      }
      if (inFlight > 0 && drainMs > 0) {
        await new Promise<void>((resolve) => {
          const wake = () => {
            clearTimeout(timer);
            drainWaiters.delete(wake);
            resolve();
          };
          const timer = setTimeout(wake, drainMs);
          drainWaiters.add(wake);
        });
      }
      return { inFlight };
    },
  };
  const protocol: SupervisorProtocol = Object.freeze({ version: 1 as const, run });
  Object.defineProperty(supervisor, PROTOCOL, { value: protocol });
  return Object.freeze(supervisor);
}

function protocolOf(value: unknown): SupervisorProtocol | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    const protocol = (value as Record<symbol, unknown>)[PROTOCOL] as SupervisorProtocol | undefined;
    return protocol?.version === 1 && typeof protocol.run === 'function' ? protocol : undefined;
  } catch {
    return undefined;
  }
}

/** Whether `value` is a supervisor from createSourceSupervisor, made by either DCP adapter. */
export function isSourceSupervisor(value: unknown): value is SourceSupervisor {
  return protocolOf(value) !== undefined && typeof (value as SourceSupervisor).stats === 'function';
}

/** Runs `call` under `supervisor`'s capacity and a `timeoutMs` deadline. */
export function supervise<T>(
  supervisor: SourceSupervisor,
  source: SupervisedSource,
  tenant: string,
  timeoutMs: number,
  call: (signal: AbortSignal) => T | PromiseLike<T>,
): Promise<SupervisedOutcome<T>> {
  const protocol = protocolOf(supervisor);
  if (!protocol) throw new TypeError('not a source supervisor');
  return protocol.run(source, tenant, timeoutMs, call);
}
