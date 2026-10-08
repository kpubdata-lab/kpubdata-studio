/**
 * How much of a source a preview read (#847).
 *
 * Since contract 1.109.0 (kpubdata-builder#1185) a preview reads a `public_api` source up
 * to `limit` records or three pages, not to its end. `total_rows`, the statistics and the
 * quality results then count the records fetched — a preview of 5 rows of a
 * 2,000,000-row source has `total_rows: 5`. Builder says so with `fetch_complete: false`,
 * and gives the provider's own count in `source_reported_total` when one call stated it.
 *
 * A Builder before 1.109.0 sends neither field and read the source to its end, so its
 * `total_rows` is the source's size: it reads here as `whole`, as does `fetch_complete:
 * true`. A source that failed is not a sample of anything; its error is what is shown.
 */
import { i18n } from "@/shared/i18n";
import type { PreviewSource } from "@/shared/lib/builderApi";

export type PreviewCoverage =
  /** The rows read are the source: `total_rows` is its size. */
  | { kind: "whole"; rows: number }
  /** The preview stopped while the source had more: `fetched` rows of `reported`, when known. */
  | { kind: "sample"; fetched: number; reported: number | null };

export function previewCoverage(
  source: Pick<PreviewSource, "status" | "total_rows" | "fetch_complete" | "source_reported_total">,
): PreviewCoverage {
  if (source.fetch_complete !== false || source.status === "failed") return { kind: "whole", rows: source.total_rows };
  return { kind: "sample", fetched: source.total_rows, reported: source.source_reported_total ?? null };
}

/** "first N rows of about M", or "first N rows" when the provider stated no count. */
export function sampleExtentText(coverage: Extract<PreviewCoverage, { kind: "sample" }>): string {
  // Grouped digits, as the table screens write counts: a source's size can be millions.
  const fetched = coverage.fetched.toLocaleString("ko-KR");
  return coverage.reported === null
    ? i18n.t("addData.preview.extentFirst", { fetched })
    : i18n.t("addData.preview.extentFirstOf", { fetched, reported: coverage.reported.toLocaleString("ko-KR") });
}
