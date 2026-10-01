/**
 * Why a column profile could not be shown (`GET /warehouse/tables/{name}/profile`, builder#817).
 *
 * Each answer that is not a fault of the request gets its own words and its own next step:
 *
 * - 504 `query_timeout` (builder#896): profiling ran past its 60-second limit. Builder
 *   remembers it for this snapshot for 5 minutes and answers 504 at once until then, so a
 *   retry before that only repeats the refusal.
 * - 429 `query_busy`: every query slot is taken; a retry shortly after may succeed.
 * - 409 `snapshot_unavailable`: the snapshot cannot be read; another snapshot can.
 * - 403 `redistribution_forbidden` (builder#688): the source terms forbid the data leaving
 *   Builder, profile statistics included; `redistribution.sources` names why.
 * - 503 `pii_declaration_unavailable` (builder#900): the source's kpubdata PII declaration
 *   could not be read, so Builder fails closed rather than profile possibly personal data.
 *
 * Only names are read from the body — source keys, a dataset key — never a value.
 */
import { forbiddenSources } from "@/features/artifacts/downloadRefusal";
import { ApiError } from "@/shared/lib/builderApi";

/** How long Builder keeps answering 504 for a snapshot whose profiling timed out (builder#896). */
export const PROFILE_TIMEOUT_MEMORY_MS = 5 * 60 * 1000;

export type ProfileRefusal =
  | { code: "query_timeout" }
  | { code: "query_busy" }
  | { code: "snapshot_unavailable" }
  | { code: "redistribution_forbidden"; sources: string[] }
  | { code: "pii_declaration_unavailable"; dataset: string | null };

/**
 * Reads a refusal out of a failed profile request.
 *
 * @param cause - What `getWarehouseTableProfile` threw.
 * @returns The refusal, or null for any other failure (shown as a plain error).
 */
export function profileRefusal(cause: unknown): ProfileRefusal | null {
  if (!(cause instanceof ApiError)) return null;
  const record = cause.details && typeof cause.details === "object" ? (cause.details as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : null;
  if (cause.status === 504 && (code === "query_timeout" || code === null)) return { code: "query_timeout" };
  if (cause.status === 429 && (code === "query_busy" || code === null)) return { code: "query_busy" };
  if (cause.status === 409 && code === "snapshot_unavailable") return { code: "snapshot_unavailable" };
  if (cause.status === 403 && code === "redistribution_forbidden") {
    return { code: "redistribution_forbidden", sources: forbiddenSources(record.redistribution) };
  }
  if (cause.status === 503 && code === "pii_declaration_unavailable") {
    return { code: "pii_declaration_unavailable", dataset: typeof record.dataset === "string" && record.dataset.length > 0 ? record.dataset : null };
  }
  return null;
}
