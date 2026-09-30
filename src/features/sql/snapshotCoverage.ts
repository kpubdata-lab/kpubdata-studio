/**
 * A snapshot's fetch coverage in one word, and never "complete" by default (#417).
 *
 * Builder records, per snapshot, whether the fetch collected what the provider reported
 * (builder#816). A snapshot without that record — committed before it existed, or from a
 * source with no fetch record — is unknown. So is any status this Studio does not know.
 * Only an explicit `complete` reads as complete; a `partial` snapshot always says so.
 */
import type { WarehouseSnapshot } from "@/shared/lib/builderApi";

export type CoverageWord = "complete" | "partial" | "unknown";

export function coverageOf(snapshot: Pick<WarehouseSnapshot, "coverage">): CoverageWord {
  const status = snapshot.coverage?.status;
  return status === "complete" || status === "partial" ? status : "unknown";
}

/** "fetched / reported" when both are known, for the detail line. */
export function coverageCounts(snapshot: Pick<WarehouseSnapshot, "coverage">): { fetched: number; reported: number } | null {
  const coverage = snapshot.coverage;
  const reported = coverage?.source_reported_total.value;
  if (!coverage || coverage.fetched_row_count === null || reported === null || reported === undefined) return null;
  return { fetched: coverage.fetched_row_count, reported };
}
