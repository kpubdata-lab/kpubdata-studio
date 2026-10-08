/**
 * Whether the preview lets the table be built (#842).
 *
 * The review step enabled "Create table" on a valid spec alone. A preview that had failed —
 * the provider refused, a parameter was missing, a source returned an error — left the
 * step saying "validation passed" over "sample of 0 rows", and the build then failed for
 * the reason the preview already had. The build is held until a preview of this spec has
 * answered and every source in it came back; what stopped it is said, with the way back.
 *
 * A source with no rows is not a failure here: an empty answer is an answer.
 */
import type { PreviewState } from "@/features/add-data/components/PreviewValidationStep";

export type PreviewProblem =
  /** No preview has been run, or one is still on its way. */
  | { kind: "not_run" }
  /** The preview request itself failed: nothing came back to look at. */
  | { kind: "request_failed"; error: string }
  /** The preview answered, and these sources in it failed. */
  | { kind: "sources_failed"; sources: Array<{ sourceKey: string; error: string | null }> };

/** What of `preview` stops the build, or `null` when nothing does. */
export function previewProblem(preview: PreviewState): PreviewProblem | null {
  if (preview.status === "idle" || preview.status === "loading") return { kind: "not_run" };
  if (preview.status === "error") return { kind: "request_failed", error: preview.error };
  const sources = preview.response.previews;
  // An answer with no source in it showed nothing to build from.
  if (sources.length === 0) return { kind: "not_run" };
  const failed = sources
    .filter((source) => source.status === "failed")
    .map((source) => ({ sourceKey: source.source_key, error: source.error }));
  return failed.length > 0 ? { kind: "sources_failed", sources: failed } : null;
}
