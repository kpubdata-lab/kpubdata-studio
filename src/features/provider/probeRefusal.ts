/**
 * Builder refusing a key probe because it was asked too soon (kpubdata-builder#1059,
 * contract 1.88.0).
 *
 * 429 `probe_rate_limited`: this user has a probe still running, or probed the same
 * provider a moment ago. Builder called nothing at the provider. `retry_after_seconds`
 * says how long to wait, at least.
 */
import { ApiError } from "@/shared/lib/builderApi";

export interface ProbeRateLimited {
  /** Seconds to wait before asking again; null when Builder did not say. */
  retryAfterSeconds: number | null;
}

export function probeRateLimited(cause: unknown): ProbeRateLimited | null {
  if (!(cause instanceof ApiError) || cause.status !== 429) return null;
  const details = cause.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const record = details as { code?: unknown; retry_after_seconds?: unknown };
  if (record.code !== "probe_rate_limited") return null;
  const seconds = record.retry_after_seconds;
  return {
    retryAfterSeconds: typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null,
  };
}
