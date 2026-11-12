import { describe, expect, it, vi } from "vitest";
import { createDeterministicSupplierAdapterFixture } from "./supplierAdapterConformance";
import { runSupplierAdapterQueue } from "./supplierAdapterRuntime";

const ok = (value: string) => ({ status: "ok" as const, value });
const unavailable = (code: "rate_limited" | "authorization_required", retryable: boolean, retryAfterMs?: number) => ({
  status: "unavailable" as const,
  failure: { code, retryable, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) },
});

describe("supplier adapter runtime", () => {
  it("retries a retryable rate limit with bounded Retry-After and returns attempts", async () => {
    const fixture = createDeterministicSupplierAdapterFixture("rate_limited_once");
    const operation = vi.fn((signal?: AbortSignal) => fixture.searchCatalog({ query: "fixture" }, signal));
    const sleep = vi.fn(async () => undefined);
    const [outcome] = await runSupplierAdapterQueue([{ providerId: "supplier-a", run: operation }], {
      maxRetries: 2,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      minIntervalMs: 0,
      sleep,
    });

    expect(outcome).toMatchObject({ attempts: 2, result: { status: "ok" } });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250, undefined);
  });

  it("does not retry authorization failures or exceed the retry bound", async () => {
    const forbidden = vi.fn(async () => unavailable("authorization_required", false));
    const transient = vi.fn(async () => unavailable("rate_limited", true, 50));
    const results = await runSupplierAdapterQueue([
      { providerId: "a", run: forbidden },
      { providerId: "b", run: transient },
    ], { maxRetries: 1, baseDelayMs: 10, minIntervalMs: 0, maxDelayMs: 100, sleep: async () => undefined });

    expect(results.map(({ attempts }) => attempts)).toEqual([1, 2]);
    expect(forbidden).toHaveBeenCalledTimes(1);
    expect(transient).toHaveBeenCalledTimes(2);
  });

  it("caps supplier Retry-After and spaces starts for the same provider", async () => {
    let time = 0;
    const waits: number[] = [];
    const sleep = async (milliseconds: number) => {
      waits.push(milliseconds);
      time += milliseconds;
    };
    const limited = vi.fn(async () => {
      time += 3;
      return unavailable("rate_limited", true, 10_000);
    });
    const next = vi.fn(async () => {
      time += 3;
      return ok("next");
    });

    await runSupplierAdapterQueue([
      { providerId: "supplier-a", run: limited },
      { providerId: "supplier-a", run: next },
    ], { maxRetries: 1, baseDelayMs: 50, maxDelayMs: 100, minIntervalMs: 20, sleep, now: () => time });

    expect(waits).toEqual([100, 17]);
    expect(limited).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledOnce();
  });

  it("serializes a provider, continues after its failed task, and isolates another provider", async () => {
    let activeA = 0;
    let maximumA = 0;
    const firstA = vi.fn(async () => {
      activeA += 1;
      maximumA = Math.max(maximumA, activeA);
      await Promise.resolve();
      activeA -= 1;
      return unavailable("authorization_required", false);
    });
    const secondA = vi.fn(async () => ok("continued"));
    const providerB = vi.fn(async () => ok("independent"));
    const results = await runSupplierAdapterQueue([
      { providerId: "a", run: firstA },
      { providerId: "a", run: secondA },
      { providerId: "b", run: providerB },
    ], { minIntervalMs: 0 });

    expect(results.map(({ result }) => result)).toEqual([
      unavailable("authorization_required", false), ok("continued"), ok("independent"),
    ]);
    expect(maximumA).toBe(1);
    expect(secondA).toHaveBeenCalledOnce();
    expect(providerB).toHaveBeenCalledOnce();
  });

  it("cancels during backoff and does not start later provider work", async () => {
    const controller = new AbortController();
    const first = vi.fn(async () => unavailable("rate_limited", true, 20));
    const second = vi.fn(async () => ok("must not run"));
    const sleep = vi.fn(async (_ms: number, signal?: AbortSignal) => {
      controller.abort();
      expect(signal?.aborted).toBe(true);
    });
    const results = await runSupplierAdapterQueue([
      { providerId: "a", run: first },
      { providerId: "a", run: second },
    ], { minIntervalMs: 0, sleep }, controller.signal);

    expect(results[0]).toMatchObject({ attempts: 1, result: { status: "unavailable", failure: { code: "cancelled" } } });
    expect(results[1]).toMatchObject({ attempts: 0, result: { status: "unavailable", failure: { code: "cancelled" } } });
    expect(second).not.toHaveBeenCalled();
  });

  it("sanitizes unexpected exceptions and continues with later tasks", async () => {
    const throws = vi.fn(async () => { throw new Error("secret=do-not-leak"); });
    const next = vi.fn(async () => ok("next"));
    const results = await runSupplierAdapterQueue([
      { providerId: "a", run: throws },
      { providerId: "a", run: next },
    ], { minIntervalMs: 0 });

    expect(results[0]).toMatchObject({ attempts: 1, result: { status: "unavailable", failure: { code: "network_error", retryable: false } } });
    expect(JSON.stringify(results)).not.toContain("do-not-leak");
    expect(next).toHaveBeenCalledOnce();
  });
});
