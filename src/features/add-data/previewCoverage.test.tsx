/**
 * A preview that read part of a source says so (#847).
 *
 * Since contract 1.109.0 a preview stops at `limit` records or three pages. `total_rows`
 * is then the rows read: 5 rows of a 2,000,000-row source read as "5 rows" in the
 * preview footer and in the review step's summary.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { INITIAL_DRAFT } from "@/features/add-data/model";
import EN from "@/shared/i18n/locales/en.json";
import { previewSourceSchema } from "@/shared/lib/builderApi.schema";
import type { PreviewSource } from "@/shared/lib/builderApi";
import { PreviewValidationStep } from "./components/PreviewValidationStep";
import { ReviewBuildStep } from "./components/ReviewBuildStep";
import { previewCoverage, sampleExtentText } from "./previewCoverage";

/** What a Builder before 1.109.0 sends: neither `fetch_complete` nor `source_reported_total`. */
const BEFORE_1_109 = {
  source_key: "datago.apt_trade",
  status: "ok",
  error: null,
  schema: [{ name: "city", dtype: "string", nullable: true, unique_count: 5, logical_type: "text", wire_encoding: "native" }],
  sample: [{ city: "Seoul" }, { city: "Busan" }],
  total_rows: 5,
  statistics: { row_count: 5, null_counts: {}, duplicate_rate: 0 },
  quality_results: [
    {
      source_key: "datago.apt_trade",
      category: "missing",
      rule: "max_null_ratio",
      column: null,
      status: "pass",
      actual: 0,
      threshold: null,
      affected_rows: null,
      evaluated_rows: null,
      detail: null,
    },
  ],
  source_sample: [],
  sample_mode: "first",
  diff_available: false,
  diffs: [],
  transform_summary: null,
  diff_truncated: false,
};

/** `body` as Studio reads a Builder's answer — through the schema, not a cast. */
function read(body: Record<string, unknown>): PreviewSource {
  return previewSourceSchema.parse(body);
}

const WHOLE = read({ ...BEFORE_1_109, fetch_complete: true, source_reported_total: 5 });
const SAMPLE_OF_KNOWN = read({ ...BEFORE_1_109, fetch_complete: false, source_reported_total: 2_000_000 });
const SAMPLE_OF_UNKNOWN = read({ ...BEFORE_1_109, fetch_complete: false, source_reported_total: null });
const OLDER = read(BEFORE_1_109);

function renderPreview(...previews: PreviewSource[]) {
  return render(
    <MemoryRouter>
      <PreviewValidationStep
        preview={{ status: "loaded", response: { dataset_id: "d", previews } }}
        limit={5}
        sampleMode="first"
        columns="all"
        onChangeLimit={vi.fn()}
        onChangeSampleMode={vi.fn()}
        onChangeColumns={vi.fn()}
        onRefresh={vi.fn()}
        view="sample"
        onChangeView={vi.fn()}
      />
    </MemoryRouter>,
  );
}

function renderReview(...previews: PreviewSource[]) {
  return render(
    <ReviewBuildStep
      draft={{ ...INITIAL_DRAFT, datasetId: "d", title: "t", description: "desc" }}
      validation={{ status: "validated", valid: true, errors: [] }}
      previewSources={previews}
      previewLimit={5}
      previewSampleMode="first"
      isStale={false}
      existing={{ status: "none" }}
      tableChoice="new"
      onChooseTable={vi.fn()}
      onRecheckExisting={vi.fn()}
      previewProblem={null}
      onBackToPreview={vi.fn()}
      jobStatus="idle"
      onBuild={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

describe("previewSourceSchema", () => {
  it("reads both fields, and a Builder that sends neither", () => {
    expect(SAMPLE_OF_KNOWN).toMatchObject({ fetch_complete: false, source_reported_total: 2_000_000 });
    expect(SAMPLE_OF_UNKNOWN).toMatchObject({ fetch_complete: false, source_reported_total: null });
    expect(OLDER.fetch_complete).toBeUndefined();
    expect(OLDER.source_reported_total).toBeUndefined();
  });

  it("does not take a count that is not one", () => {
    expect(previewSourceSchema.safeParse({ ...BEFORE_1_109, source_reported_total: -1 }).success).toBe(false);
    expect(previewSourceSchema.safeParse({ ...BEFORE_1_109, fetch_complete: "no" }).success).toBe(false);
  });
});

describe("previewCoverage", () => {
  it("is a sample when the preview stopped before the source's end", () => {
    expect(previewCoverage(SAMPLE_OF_KNOWN)).toStrictEqual({ kind: "sample", fetched: 5, reported: 2_000_000 });
    expect(previewCoverage(SAMPLE_OF_UNKNOWN)).toStrictEqual({ kind: "sample", fetched: 5, reported: null });
    // A field that is absent is not a count either.
    expect(previewCoverage(read({ ...BEFORE_1_109, fetch_complete: false }))).toStrictEqual({
      kind: "sample",
      fetched: 5,
      reported: null,
    });
  });

  it("is the whole source when Builder says so, and for a Builder that says nothing", () => {
    expect(previewCoverage(WHOLE)).toStrictEqual({ kind: "whole", rows: 5 });
    expect(previewCoverage(OLDER)).toStrictEqual({ kind: "whole", rows: 5 });
    // A count alone does not make a sample: only `fetch_complete: false` does.
    expect(previewCoverage(read({ ...BEFORE_1_109, source_reported_total: 2_000_000 }))).toStrictEqual({
      kind: "whole",
      rows: 5,
    });
  });

  it("does not call a source that failed a sample", () => {
    const failed = read({ ...BEFORE_1_109, status: "failed", error: "boom", total_rows: 0, fetch_complete: false });

    expect(previewCoverage(failed)).toStrictEqual({ kind: "whole", rows: 0 });
  });

  it("leaves a preview that read no row to the empty state", () => {
    const empty = read({ ...BEFORE_1_109, total_rows: 0, sample: [], fetch_complete: false, source_reported_total: 40 });

    expect(previewCoverage(empty)).toStrictEqual({ kind: "whole", rows: 0 });
  });

  it("words one row as one row", () => {
    expect(sampleExtentText({ kind: "sample", fetched: 1, reported: null })).toBe("처음 1건");
    expect(sampleExtentText({ kind: "sample", fetched: 1, reported: 2_000_000 })).toBe("약 2,000,000건 중 처음 1건");
    // English is where it shows: not "first 1 rows".
    expect(EN.addData.preview.extentFirstOne).toBe("first row");
    expect(EN.addData.preview.extentFirstOneOf).toBe("first row of about {{reported}}");
    expect(EN.addData.preview.extentFirst).toContain("{{fetched}} rows");
  });

  it("words the extent with the provider's count when there is one", () => {
    expect(sampleExtentText({ kind: "sample", fetched: 5, reported: 2_000_000 })).toBe("약 2,000,000건 중 처음 5건");
    expect(sampleExtentText({ kind: "sample", fetched: 7, reported: null })).toBe("처음 7건");
  });
});

describe("PreviewValidationStep, for a preview that read part of the source", () => {
  it("says the rows are a sample of about so many, in the notice and the footer", () => {
    renderPreview(SAMPLE_OF_KNOWN);

    expect(screen.getByTestId("preview-sample-notice")).toHaveTextContent("약 2,000,000건 중 처음 5건만 읽었습니다");
    // The preview step has no statistics panel to speak of.
    expect(screen.getByTestId("preview-sample-notice")).not.toHaveTextContent("통계");
    expect(screen.getByTestId("sample-footer")).toHaveTextContent("약 2,000,000건 중 처음 5건을 읽어 2건 표시 · 1개 컬럼");
    // Not as the source's size.
    expect(screen.getByTestId("sample-footer")).not.toHaveTextContent("5건 중 2건");
  });

  it("says first N rows when the provider stated no count", () => {
    renderPreview(SAMPLE_OF_UNKNOWN);

    expect(screen.getByTestId("preview-sample-notice")).toHaveTextContent("처음 5건만 읽었습니다");
    expect(screen.getByTestId("preview-sample-notice")).not.toHaveTextContent("약");
    expect(screen.getByTestId("sample-footer")).toHaveTextContent("처음 5건을 읽어 2건 표시");
  });

  it("says the checks cover the sample", () => {
    renderPreview(SAMPLE_OF_KNOWN);

    expect(screen.getByTestId("validation-sample-note")).toHaveTextContent("표본 5건에 대한 결과");
  });

  it.each([
    ["a Builder before 1.109.0", OLDER],
    ["a preview that read the whole source", WHOLE],
  ])("keeps the wording it had for %s", (_name, source) => {
    renderPreview(source);

    expect(screen.getByTestId("sample-footer")).toHaveTextContent("5건 중 2건 표시 · 1개 컬럼");
    expect(screen.queryByTestId("preview-sample-notice")).toBeNull();
    expect(screen.queryByTestId("validation-sample-note")).toBeNull();
  });

  it("says it of the source on screen, not of another", () => {
    renderPreview(read({ ...BEFORE_1_109, source_key: "whole", fetch_complete: true }), read({ ...SAMPLE_OF_KNOWN, source_key: "part" }));

    // The first source is the one shown.
    expect(screen.queryByTestId("preview-sample-notice")).toBeNull();
    expect(screen.getByTestId("sample-footer")).toHaveTextContent("5건 중 2건 표시");
  });
});

describe("ReviewBuildStep, for a preview that read part of the source", () => {
  it("states the extent where it stated a total, and that the checks cover the sample", () => {
    renderReview(SAMPLE_OF_KNOWN);

    expect(screen.getAllByText(/약 2,000,000건 중 처음 5건/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/5건 중 표본/)).toBeNull();
    expect(screen.getByTestId("review-sample-note")).toHaveTextContent("미리보기 표본에 대한 결과");
    // The plan's Validation line says so too: a row-count rule judged the sample.
    expect(screen.getByText(/^1\/1 · .+ · 표본 기준$/)).toBeInTheDocument();
    // Rows are counted in one unit down the plan, sample or not.
    expect(screen.getByText(/^5행\(first\) · 약 2,000,000건 중 처음 5건$/)).toBeInTheDocument();
  });

  it("states first N rows when the provider stated no count", () => {
    renderReview(SAMPLE_OF_UNKNOWN);

    expect(screen.getAllByText(/처음 5건/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/약 /)).toBeNull();
  });

  it.each([
    ["a Builder before 1.109.0", OLDER],
    ["a preview that read the whole source", WHOLE],
  ])("keeps the wording it had for %s", (_name, source) => {
    renderReview(source);

    expect(screen.getAllByText(/5건 중 표본/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/^5행\(first\) · 5건 중 표본$/)).toBeInTheDocument();
    expect(screen.queryByTestId("review-sample-note")).toBeNull();
    expect(screen.queryByText(/표본 기준/)).toBeNull();
  });

  it("says the checks cover a sample when any of several sources was read in part", () => {
    renderReview(read({ ...BEFORE_1_109, source_key: "whole", fetch_complete: true }), read({ ...SAMPLE_OF_KNOWN, source_key: "part" }));

    expect(screen.getByTestId("review-sample-note")).toBeInTheDocument();
  });
});
