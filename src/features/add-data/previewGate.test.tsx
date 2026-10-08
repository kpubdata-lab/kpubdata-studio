/**
 * The table is not built on a preview that failed or was never run (#842).
 *
 * The review step enabled "Create table" on a valid spec alone: after a failed preview it
 * said "validation passed" over "sample of 0 rows", and the build failed for the reason
 * the preview already had.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PreviewState } from "@/features/add-data/components/PreviewValidationStep";
import { ReviewBuildStep } from "@/features/add-data/components/ReviewBuildStep";
import { buildSpecFromDraft, INITIAL_DRAFT, type AddDataDraft } from "@/features/add-data/model";
import { previewSourceSchema } from "@/shared/lib/builderApi.schema";
import type { PreviewSource } from "@/shared/lib/builderApi";
import { previewProblem, type PreviewProblem } from "./previewGate";

/** A source as Builder's preview answers for it — read through the schema, not cast. */
function source(overrides: Record<string, unknown> = {}): PreviewSource {
  return previewSourceSchema.parse({
    source_key: "datago.air_station",
    status: "ok",
    error: null,
    schema: [],
    sample: [{ station: "A" }],
    total_rows: 22,
    statistics: { row_count: 22, null_counts: {}, duplicate_rate: 0 },
    quality_results: [],
    source_sample: [],
    sample_mode: "first",
    diff_available: false,
    diffs: [],
    transform_summary: null,
    diff_truncated: false,
    ...overrides,
  });
}

function loaded(...previews: PreviewSource[]): PreviewState {
  return { status: "loaded", response: { dataset_id: "d", previews } };
}

const FAILED = source({ source_key: "datago.broken", status: "failed", error: "provider refused: SERVICE_KEY_IS_NOT_REGISTERED", total_rows: 0, sample: [] });

describe("previewProblem", () => {
  it("is nothing when every source of the preview came back", () => {
    expect(previewProblem(loaded(source()))).toBeNull();
    expect(previewProblem(loaded(source(), source({ source_key: "second" })))).toBeNull();
  });

  it("is nothing for a source that came back with no rows: an empty answer is an answer", () => {
    expect(previewProblem(loaded(source({ total_rows: 0, sample: [] })))).toBeNull();
  });

  it.each<PreviewState>([{ status: "idle" }, { status: "loading" }, loaded()])(
    "says no preview was run for $status",
    (preview) => {
      expect(previewProblem(preview)).toStrictEqual({ kind: "not_run" });
    },
  );

  it("carries the reason of a preview request that failed", () => {
    expect(previewProblem({ status: "error", error: "Missing required parameter: station" })).toStrictEqual({
      kind: "request_failed",
      error: "Missing required parameter: station",
    });
  });

  it("names the sources that failed, and only those", () => {
    expect(previewProblem(loaded(source(), FAILED))).toStrictEqual({
      kind: "sources_failed",
      sources: [{ sourceKey: "datago.broken", error: "provider refused: SERVICE_KEY_IS_NOT_REGISTERED" }],
    });
  });
});

const DRAFT: AddDataDraft = {
  ...INITIAL_DRAFT,
  sourceKind: "public_api",
  publicApi: { provider: "datago", dataset: "air_station", sourceParams: JSON.stringify({ station: "A" }) },
  datasetId: "datago-air-station",
  title: "Air stations",
  description: "Measuring stations",
};

/** The review step with a valid spec — ready to build but for what the preview says. */
function renderReview(problem: PreviewProblem | null, previews: PreviewSource[] = [], isStale = false) {
  const handlers = { onBackToPreview: vi.fn(), onBuild: vi.fn() };
  render(
    <ReviewBuildStep
      draft={DRAFT}
      spec={buildSpecFromDraft(DRAFT).spec}
      validation={{ status: "validated", valid: true, errors: [] }}
      previewSources={previews}
      previewLimit={5}
      previewSampleMode="first"
      isStale={isStale}
      previewProblem={problem}
      onBackToPreview={handlers.onBackToPreview}
      jobStatus="idle"
      onBuild={handlers.onBuild}
      onCancel={vi.fn()}
    />,
  );
  return handlers;
}

function buildButton(): HTMLElement {
  return screen.getByRole("button", { name: "테이블 만들기" });
}

describe("ReviewBuildStep, by what the preview says", () => {
  it("builds when the preview came back", () => {
    renderReview(null, [source()]);

    expect(buildButton()).toBeEnabled();
    expect(document.querySelector("[data-preview-problem]")).toBeNull();
  });

  it("holds the build on a preview request that failed, with its reason and the way back", () => {
    const handlers = renderReview({ kind: "request_failed", error: "Missing required parameter: station" });

    expect(buildButton()).toBeDisabled();
    const notice = document.querySelector<HTMLElement>('[data-preview-problem="request_failed"]');
    expect(notice?.textContent).toContain("Missing required parameter: station");
    expect(notice?.textContent).toContain("같은 이유로 실패합니다");
    // Not "sample of 0 rows", nor "not run": it was run, and failed.
    // In the summary card and in the plan.
    expect(screen.getAllByText("Preview 실패")).toHaveLength(2);
    expect(screen.queryByText(/중 표본/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview 단계로 돌아가기" }));
    expect(handlers.onBackToPreview).toHaveBeenCalledTimes(1);
    expect(handlers.onBuild).not.toHaveBeenCalled();
  });

  it("holds the build when a source of the preview failed, and names it", () => {
    renderReview(previewProblem(loaded(FAILED)), [FAILED]);

    expect(buildButton()).toBeDisabled();
    const notice = document.querySelector<HTMLElement>('[data-preview-problem="sources_failed"]');
    expect(notice?.textContent).toContain("datago.broken");
    expect(notice?.textContent).toContain("SERVICE_KEY_IS_NOT_REGISTERED");
    expect(screen.queryByText(/0건 중 표본/)).toBeNull();
    expect(screen.getAllByText("Preview 실패").length).toBeGreaterThan(0);
  });

  it("holds the build until a preview has been run", () => {
    renderReview({ kind: "not_run" });

    expect(buildButton()).toBeDisabled();
    expect(document.querySelector('[data-preview-problem="not_run"]')?.textContent).toContain("아직 실행하지 않았습니다");
  });

  it("leaves a stale preview to the notice that is about it", () => {
    // The settings changed after the preview: what it said, good or bad, is of other settings.
    renderReview({ kind: "request_failed", error: "an old failure" }, [], true);

    expect(buildButton()).toBeDisabled();
    expect(document.querySelector("[data-preview-problem]")).toBeNull();
    expect(screen.queryByText("an old failure")).toBeNull();
  });
});
