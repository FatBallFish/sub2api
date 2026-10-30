import type { UsageLog } from "../types/usage";

// 与运维 Token 请求统计一致：使用完整耗时（含首字等待），输出 Token 可能包含推理 Token。
// 图片请求与非标准请求类型的 TPS 无对比意义，直接显示占位符。
const OUTPUT_RATE_REQUEST_TYPES = ["sync", "stream", "ws_v2", "cyber"];

export function outputRateDisplay(
  log: Pick<UsageLog,
    | "output_tokens"
    | "duration_ms"
    | "image_count"
    | "image_output_tokens"
    | "billing_mode"
    | "request_type"
  >,
): string | null {
  const outputTokens = log.output_tokens;
  const durationMs = log.duration_ms ?? null;
  if (
    (log.image_count ?? 0) > 0 ||
    (log.image_output_tokens ?? 0) > 0 ||
    log.billing_mode === "image" ||
    (log.request_type && !OUTPUT_RATE_REQUEST_TYPES.includes(log.request_type)) ||
    !Number.isFinite(outputTokens) ||
    outputTokens <= 0 ||
    durationMs == null ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    return null;
  }
  return `${((outputTokens * 1000) / durationMs).toFixed(1)}`;
}

// 缓存命中率按输入侧口径计算（与老前端 TokenUsageTrend 一致）：
// 命中读取占（输入 + 命中读取 + 缓存创建）的比例，输出 Token 不参与分母。
export function cacheHitRatePercent(
  log: Pick<UsageLog, "input_tokens" | "cache_read_tokens" | "cache_creation_tokens">,
): number | null {
  const denominator =
    log.input_tokens + log.cache_read_tokens + log.cache_creation_tokens;
  if (denominator <= 0) return null;
  return Math.round((log.cache_read_tokens / denominator) * 100);
}
