/**
 * Build-result preview API entry point (#93).
 *
 * Real mode (`VITE_USE_REAL_BUILDER=true`) calls Builder `/preview`; otherwise
 * returns deterministic mock data for UI development/verification. Converts
 * the per-source sample rows and schema Builder returns into the
 * UI-ready `{ rows, schema }` shape (same real-mode branch pattern as
 * runs/api).
 */
import { i18n } from "@/shared/i18n";
import { serializeSpec } from "@/features/build-spec/specMapping";
import {
  builderApi,
  isRealBuilderEnabled,
  type PreviewResponse,
} from "@/shared/lib/builderApi";
import type { BuildSpec } from "@/shared/lib/types";

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

/** Deterministic sample rows for mock mode. */
const MOCK_ROWS: Record<string, unknown>[] = [
  { region: "서울", value: 42, measured_at: "2026-06-21T09:00:00Z" },
  { region: "부산", value: 37, measured_at: "2026-06-21T09:00:00Z" },
  { region: "대구", value: 51, measured_at: "2026-06-21T09:00:00Z" },
];

/** Deterministic column schema for mock mode. */
const MOCK_SCHEMA: Record<string, string> = {
  region: "string",
  value: "int64",
  measured_at: "string",
};

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
  if (!isRealBuilderEnabled()) {
    return { rows: MOCK_ROWS, schema: MOCK_SCHEMA, warnings: [] };
  }

  const response = await builderApi.preview(serializeSpec(spec), undefined, signal);
  return transformPreviewResponse(response);
}

/**
 * Requests the full Builder `/preview` response for the current build spec
 * (per-source statistics/quality_results/diff included) (#497, #250).
 * `previewBuild` flattens a single representative source into `{rows,schema}`
 * but the Add Data Workbench's Preview & Validation/Diff screens need the
 * entire per-source response verbatim (diff_available/sample_mode/
 * quality_results etc.), so this is separate.
 *
 * Mock mode returns a deterministic mock response without touching the network.
 *
 * @param spec - Build spec to preview.
 * @param options - limit (1..1000, default 5)/sample_mode (first|random)/seed.
 * @param signal - Optional AbortSignal for cancellation.
 * @returns The (Zod-validated) raw Builder `/preview` response.
 */
export async function previewBuildDetailed(
  spec: BuildSpec,
  options?: { limit?: number; sample_mode?: "first" | "random"; seed?: number },
  signal?: AbortSignal,
): Promise<PreviewResponse> {
  if (!isRealBuilderEnabled()) {
    return {
      dataset_id: spec.datasetId,
      previews: [
        {
          source_key: spec.sources[0]?.alias || spec.sources[0]?.dataset || "source",
          status: "ok",
          error: null,
          schema: [
            { name: "region", dtype: "string", nullable: false, unique_count: 3 },
            { name: "value", dtype: "int64", nullable: true, unique_count: 3 },
          ],
          sample: MOCK_ROWS,
          total_rows: MOCK_ROWS.length,
          statistics: { row_count: MOCK_ROWS.length, null_counts: { region: 0, value: 0 }, duplicate_rate: 0 },
          quality_results: [],
          source_sample: MOCK_ROWS,
          sample_mode: options?.sample_mode ?? "first",
          diff_available: false,
          diffs: [],
          transform_summary: null,
          diff_truncated: false,
        },
      ],
    };
  }

  return builderApi.preview(serializeSpec(spec), options, signal);
}
