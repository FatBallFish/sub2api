import { describe, expect, it } from "vitest";
import { cacheHitRatePercent, outputRateDisplay } from "./usageRate";
import type { UsageLog } from "../types/usage";

type RateRow = Pick<UsageLog,
  "output_tokens" | "duration_ms" | "image_count" | "image_output_tokens" | "billing_mode" | "request_type"
>;

function rateRow(overrides: Partial<RateRow>): RateRow {
  return {
    output_tokens: 1000,
    duration_ms: 4000,
    image_count: 0,
    image_output_tokens: 0,
    billing_mode: "token",
    request_type: "stream",
    ...overrides,
  };
}

describe("outputRateDisplay", () => {
  it("computes tokens per second from full duration", () => {
    expect(outputRateDisplay(rateRow({}))).toBe("250.0");
  });

  it("keeps one decimal place", () => {
    expect(outputRateDisplay(rateRow({ output_tokens: 333, duration_ms: 1000 }))).toBe("333.0");
  });

  it("returns null for image requests and image billing", () => {
    expect(outputRateDisplay(rateRow({ image_count: 2 }))).toBeNull();
    expect(outputRateDisplay(rateRow({ image_output_tokens: 10 }))).toBeNull();
    expect(outputRateDisplay(rateRow({ billing_mode: "image" }))).toBeNull();
  });

  it("returns null for non-standard request types", () => {
    expect(outputRateDisplay(rateRow({ request_type: "batch" }))).toBeNull();
    expect(outputRateDisplay(rateRow({ request_type: "ws_v2" }))).not.toBeNull();
    expect(outputRateDisplay(rateRow({ request_type: "cyber" }))).not.toBeNull();
  });

  it("returns null when output or duration is missing or non-positive", () => {
    expect(outputRateDisplay(rateRow({ output_tokens: 0 }))).toBeNull();
    expect(outputRateDisplay(rateRow({ duration_ms: null }))).toBeNull();
    expect(outputRateDisplay(rateRow({ duration_ms: 0 }))).toBeNull();
  });
});

describe("cacheHitRatePercent", () => {
  it("uses the prompt-side denominator excluding output tokens", () => {
    // 50 read / (100 input + 50 read + 50 creation) = 25%
    expect(
      cacheHitRatePercent({ input_tokens: 100, cache_read_tokens: 50, cache_creation_tokens: 50 }),
    ).toBe(25);
  });

  it("returns null when the prompt side has no tokens", () => {
    expect(
      cacheHitRatePercent({ input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 }),
    ).toBeNull();
    // 输出 Token 不参与分母：只有输出时同样无法计算命中率
    expect(
      cacheHitRatePercent({ input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 }),
    ).toBeNull();
  });
});
