/**
 * Build-result preview API entry point (#93).
 *
 * Asks the client in force (`./client`) for Builder's `/preview` response — a
 * Builder's when one is configured (`VITE_USE_REAL_BUILDER=true`), the demo's
 * otherwise — and converts the per-source sample rows and schema into the UI-ready
 * `{ rows, schema }` shape. Which of the two answers is decided there and nowhere in
 * this file (#794).
 */
import { i18n } from "@/shared/i18n";
import type { PreviewResponse } from "@/shared/lib/builderApi";
import type { BuildSpec } from "@/shared/lib/types";
import { previewClient, type PreviewOptions } from "./client";

export interface PreviewSourceFailure {
  sourceKey: string;
  error: string;
}

export class PreviewSourceFailureError extends Error {
  constructor(readonly failures: PreviewSourceFailure[]) {
    super(i18n.t("preview.allSourcesFailed", { failures: formatFailures(failures) }));
    this.name = "PreviewSourceFailureError";
  }
}

/** Preview result (sample row array and a column-name→type schema map). */
export interface PreviewResult {
  rows: Record<string, unknown>[];
  schema: Record<string, string>;
  warnings: PreviewSourceFailure[];
}

function formatFailures(failures: readonly PreviewSourceFailure[]): string {
  return failures.map((failure) => `${failure.sourceKey}: ${failure.error}`).join("; ");
}

function sourceFailure(source: PreviewResponse["previews"][number]): PreviewSourceFailure {
  return {
    sourceKey: source.source_key,
    error: source.error ?? i18n.t("preview.unknownSourceError"),
  };
}

/**
 * Converts the Builder /preview response into the UI's `{ rows, schema }`.
 *
 * /preview returns a per-source array (`previews`). The preview screen shows
 * a single table, so the first successful source is the representative
 * (empty result when there is none).
 *
 * @param response - Builder /preview response.
 * @returns Sample rows and column-name→type schema of the representative source.
 */
function transformPreviewResponse(response: PreviewResponse): PreviewResult {
  const source = response.previews.find((preview) => preview.status === "ok");
  if (!source) {
    const failures = response.previews.map(sourceFailure);
    if (failures.length > 0) throw new PreviewSourceFailureError(failures);
    return { rows: [], schema: {}, warnings: [] };
  }

  const warnings = response.previews
    .filter((preview) => preview.status === "failed")
    .map(sourceFailure);

  const schema: Record<string, string> = {};
  for (const column of source.schema) {
    schema[column.name] = column.dtype;
  }
  return { rows: source.sample, schema, warnings };
}

/**
 * Requests preview data for the current build spec.
 *
 * @param spec - Build spec to preview.
 * @param signal - Optional AbortSignal for cancellation.
 * @returns Sample row array and column schema map.
 */
export async function previewBuild(spec: BuildSpec, signal?: AbortSignal): Promise<PreviewResult> {
  return transformPreviewResponse(await previewClient().preview(spec, undefined, signal));
}

/**
 * Requests the full Builder `/preview` response for the current build spec
 * (per-source statistics/quality_results/diff included) (#497, #250).
 * `previewBuild` flattens a single representative source into `{rows,schema}`
 * but the Add Data Workbench's Preview & Validation/Diff screens need the
 * entire per-source response verbatim (diff_available/sample_mode/
 * quality_results etc.), so this is separate.
 *
 * @param spec - Build spec to preview.
 * @param options - limit (1..1000, default 5)/sample_mode (first|random)/seed.
 * @param signal - Optional AbortSignal for cancellation.
 * @returns The (Zod-validated) raw Builder `/preview` response.
 */
export async function previewBuildDetailed(
  spec: BuildSpec,
  options?: PreviewOptions,
  signal?: AbortSignal,
): Promise<PreviewResponse> {
  return previewClient().preview(spec, options, signal);
}
