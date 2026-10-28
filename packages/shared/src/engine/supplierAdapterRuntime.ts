import type { SupplierAdapterFailure, SupplierAdapterResult } from "./supplierAdapterConformance";

/** One logical supplier operation. Tasks for the same provider run serially;
 * different providers progress independently. */
export interface SupplierAdapterRuntimeTask<T> {
  providerId: string;
  run(signal?: AbortSignal): Promise<SupplierAdapterResult<T>>;
}

export interface SupplierAdapterRuntimeOutcome<T> {
  providerId: string;
  attempts: number;
  result: SupplierAdapterResult<T>;
}

export interface SupplierAdapterRuntimeOptions {
  /** Retries after the initial attempt. */
  maxRetries?: number;
  /** Delay before the first retry, then doubles for each retry. */
  baseDelayMs?: number;
  /** Per-provider minimum spacing between operation starts. */
  minIntervalMs?: number;
  /** Maximum wait, including a supplier-provided retryAfterMs. */
  maxDelayMs?: number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

const DEFAULTS = { maxRetries: 2, baseDelayMs: 250, minIntervalMs: 100, maxDelayMs: 5_000 } as const;

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
    if (signal?.aborted) done();
  });
}

function cancelled<T>(): SupplierAdapterResult<T> {
  return { status: "unavailable", failure: { code: "cancelled", retryable: false } };
}

function safeUnexpectedFailure<T>(): SupplierAdapterResult<T> {
  // Thrown exceptions are not retried: a download may already have committed
  // an immutable receipt before a caller failed, and exception text can hold secrets.
  const failure: SupplierAdapterFailure = { code: "network_error", retryable: false };
  return { status: "unavailable", failure };
}

/**
 * Runs supplier operations with bounded, retryable-only backoff. A provider's
 * tasks are serialized and rate-spaced, while separate providers run in
 * parallel. A terminal failure affects only that task; later tasks continue.
 * The helper is in-memory and leaves persistence/checkpoint authority to the
 * existing acquisition-job workflow.
 */
export async function runSupplierAdapterQueue<T>(
  tasks: readonly SupplierAdapterRuntimeTask<T>[],
  options: SupplierAdapterRuntimeOptions = {},
  signal?: AbortSignal,
): Promise<SupplierAdapterRuntimeOutcome<T>[]> {
  const maxRetries = nonNegativeInteger(options.maxRetries, DEFAULTS.maxRetries);
  const baseDelayMs = nonNegativeInteger(options.baseDelayMs, DEFAULTS.baseDelayMs);
  const minIntervalMs = nonNegativeInteger(options.minIntervalMs, DEFAULTS.minIntervalMs);
  const maxDelayMs = nonNegativeInteger(options.maxDelayMs, DEFAULTS.maxDelayMs);
  const sleep = options.sleep ?? abortableSleep;
  const now = options.now ?? Date.now;
  const outcomes = new Array<SupplierAdapterRuntimeOutcome<T>>(tasks.length);
  const providerGroups = new Map<string, number[]>();

  tasks.forEach((task, index) => {
    const indexes = providerGroups.get(task.providerId) ?? [];
    indexes.push(index);
    providerGroups.set(task.providerId, indexes);
  });

  await Promise.all([...providerGroups.entries()].map(async ([providerId, indexes]) => {
    let lastStartedAt: number | undefined;
    for (const index of indexes) {
      const task = tasks[index]!;
      let attempts = 0;
      let result: SupplierAdapterResult<T> = cancelled<T>();

      for (;;) {
        if (signal?.aborted) {
          result = cancelled<T>();
          break;
        }
        const spacing = lastStartedAt === undefined ? 0 : Math.max(0, minIntervalMs - (now() - lastStartedAt));
        if (spacing > 0) await sleep(spacing, signal);
        if (signal?.aborted) {
          result = cancelled<T>();
          break;
        }

        attempts += 1;
        lastStartedAt = now();
        try {
          result = await task.run(signal);
        } catch {
          result = safeUnexpectedFailure<T>();
        }

        if (signal?.aborted) {
          result = cancelled<T>();
          break;
        }
        if (result.status !== "unavailable" || !result.failure.retryable || attempts > maxRetries) break;

        const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempts - 1)));
        const requested = result.failure.retryAfterMs;
        const retryDelay = Math.min(maxDelayMs, Math.max(exponential, Number.isFinite(requested) ? Math.max(0, requested!) : 0));
        if (retryDelay > 0) await sleep(retryDelay, signal);
        if (signal?.aborted) {
          result = cancelled<T>();
          break;
        }
      }
      outcomes[index] = { providerId, attempts, result };
    }
  }));

  return outcomes;
}
