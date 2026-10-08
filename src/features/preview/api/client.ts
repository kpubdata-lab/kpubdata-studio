/**
 * The preview client: one interface, and the two things that implement it (#794).
 *
 * As in `features/datasets/api/client.ts`: the screens ask `previewClient()` and do not
 * know whether a Builder or the demo answers. `client.contract.test.ts` holds the two to
 * the same expectations.
 *
 * One method. The two things the screens ask — a flat table of one source, and the whole
 * per-source response — are both read from Builder's `/preview` response, so the demo
 * answers with that response too and what is made of it (`./index`) is one piece of code
 * for both.
 */
import { serializeSpec } from "@/features/build-spec/specMapping";
import { builderApi, isRealBuilderEnabled, type PreviewResponse } from "@/shared/lib/builderApi";
import type { BuildSpec } from "@/shared/lib/types";

export type PreviewOptions = { limit?: number; sample_mode?: "first" | "random"; seed?: number };

/**
 * What the preview screens ask for: Builder's `/preview` response for a spec, as the
 * contract shapes it. Rejects, without an answer, when `signal` is already aborted.
 */
export interface PreviewClient {
  preview(spec: BuildSpec, options?: PreviewOptions, signal?: AbortSignal): Promise<PreviewResponse>;
}

export const realPreviewClient: PreviewClient = {
  preview: async (spec, options, signal) => builderApi.preview(serializeSpec(spec), options, signal),
};

/** How many rows Builder's `/preview` samples when the request does not say. */
const DEFAULT_PREVIEW_LIMIT = 5;

/** Deterministic sample rows the demo previews every spec with. */
const DEMO_ROWS: Record<string, unknown>[] = [
  { region: "서울", value: 42, measured_at: "2026-06-21T09:00:00Z" },
  { region: "부산", value: 37, measured_at: "2026-06-21T09:00:00Z" },
  { region: "대구", value: 51, measured_at: "2026-06-21T09:00:00Z" },
];

export const demoPreviewClient: PreviewClient = {
  async preview(spec, options, signal) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    // As many rows as were asked for (Builder's default is 5), each a copy: a caller
    // that changed one would otherwise change the demo for everyone after it.
    const sample = DEMO_ROWS.slice(0, options?.limit ?? DEFAULT_PREVIEW_LIMIT).map((row) => ({ ...row }));
    return {
      dataset_id: spec.datasetId,
      previews: [
        {
          source_key: spec.sources[0]?.alias || spec.sources[0]?.dataset || "source",
          status: "ok",
          error: null,
          // Every column of the rows: `measured_at` was in the rows and missing here.
          schema: [
            { name: "region", dtype: "string", nullable: false, unique_count: 3 },
            { name: "value", dtype: "int64", nullable: true, unique_count: 3 },
            { name: "measured_at", dtype: "string", nullable: false, unique_count: 1 },
          ],
          sample,
          total_rows: DEMO_ROWS.length,
          statistics: {
            row_count: DEMO_ROWS.length,
            null_counts: { region: 0, value: 0, measured_at: 0 },
            duplicate_rate: 0,
          },
          quality_results: [],
          source_sample: sample.map((row) => ({ ...row })),
          sample_mode: options?.sample_mode ?? "first",
          diff_available: false,
          diffs: [],
          transform_summary: null,
          diff_truncated: false,
        },
      ],
    };
  },
};

/** The client in force: Builder's when one is configured, the demo's otherwise. */
export function previewClient(): PreviewClient {
  return isRealBuilderEnabled() ? realPreviewClient : demoPreviewClient;
}
