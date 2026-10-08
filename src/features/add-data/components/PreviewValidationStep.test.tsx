/**
 * PreviewValidationStep — stale result warning (audit followup 1-2).
 *
 * If dataset/params changed since last Preview (AddDataPage's isStale), the step
 * must show that "remaining results differ from current settings". Build block is
 * handled by ReviewBuildStep's existing stale guard, so here we only verify display.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PreviewSource } from "@/shared/lib/builderApi";
import { PreviewValidationStep, type PreviewState } from "./PreviewValidationStep";

const LOADED: PreviewState = {
  status: "loaded",
  response: { dataset_id: "dataset-1", previews: [] },
};

function renderStep(overrides: Partial<React.ComponentProps<typeof PreviewValidationStep>>) {
  return render(
    <MemoryRouter>
      <PreviewValidationStep
        preview={LOADED}
        limit={5}
        sampleMode="first"
        columns="key"
        onChangeLimit={vi.fn()}
        onChangeSampleMode={vi.fn()}
        onChangeColumns={vi.fn()}
        onRefresh={vi.fn()}
        view="sample"
        onChangeView={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe("PreviewValidationStep — stale result warning", () => {
  it("If isStale, notifies that remaining Preview results differ from current settings", () => {
    renderStep({ isStale: true });
    expect(screen.getByText(/설정이 변경되었습니다.*Preview를 다시 실행/)).toBeInTheDocument();
  });

  it("If not isStale, does not show warning", () => {
    renderStep({ isStale: false });
    expect(screen.queryByText(/설정이 변경되었습니다/)).not.toBeInTheDocument();
  });

  it("If Preview not yet run (idle), does not warn even if stale", () => {
    renderStep({ isStale: true, preview: { status: "idle" } });
    expect(screen.queryByText(/설정이 변경되었습니다/)).not.toBeInTheDocument();
  });
});

describe("PreviewValidationStep — source tabs (#795)", () => {
  const source = (source_key: string, city: string): PreviewSource => ({
    source_key,
    status: "ok",
    error: null,
    schema: [{ name: "city", dtype: "string", nullable: true }] as PreviewSource["schema"],
    sample: [{ city }],
    total_rows: 1,
    statistics: { row_count: 1, null_counts: {}, duplicate_rate: 0 },
    quality_results: [],
    source_sample: [],
    sample_mode: "first",
    diff_available: false,
    diffs: [],
    transform_summary: null,
    diff_truncated: false,
    masked_columns: [],
  });
  const TWO: PreviewState = {
    status: "loaded",
    response: { dataset_id: "d", previews: [source("datago__air", "Seoul"), source("seoul__air", "Busan")] },
  };

  it("ties each source tab to the preview panel and moves between sources with the arrow keys", () => {
    renderStep({ preview: TWO, columns: "all" });
    const [first, second] = screen.getAllByRole("tab");
    const panel = screen.getByRole("tabpanel");

    expect(first).toHaveAttribute("aria-controls", panel.id);
    expect(second).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", first.id);
    expect([first.tabIndex, second.tabIndex]).toEqual([0, -1]);
    expect(panel).toHaveTextContent("Seoul");

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(panel).toHaveAttribute("aria-labelledby", second.id);
    expect(panel).toHaveTextContent("Busan");
  });

  it("has no tab list and no tab panel role for a single source", () => {
    renderStep({ preview: { status: "loaded", response: { dataset_id: "d", previews: [source("datago__air", "Seoul")] } } });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
  });
});

describe("PreviewValidationStep — diff values (#844)", () => {
  it("shows a nested value as its JSON and a missing one as a dash, never [object Object]", () => {
    const changed: PreviewSource = {
      source_key: "datago__air",
      status: "ok",
      error: null,
      schema: [{ name: "detail", dtype: "struct", nullable: true }] as PreviewSource["schema"],
      sample: [{ detail: null }],
      total_rows: 1,
      statistics: { row_count: 1, null_counts: {}, duplicate_rate: 0 },
      quality_results: [],
      source_sample: [],
      sample_mode: "first",
      diff_available: true,
      diffs: [{ row: 0, column: "detail", before: { grade: "A", scores: [1, 2] }, after: null, transform: "drop_nested" }],
      transform_summary: { changed_cells: 1, changed_rows: 1 },
      diff_truncated: false,
    };

    renderStep({ preview: { status: "loaded", response: { dataset_id: "d", previews: [changed] } }, view: "diff" });

    expect(screen.getByText('{"grade":"A","scores":[1,2]}')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("[object Object]");
    // The missing value is a dash, not the word "null".
    const row = screen.getByText("drop_nested").closest("tr");
    expect(row?.textContent).toContain("—");
    expect(row?.textContent).not.toContain("null");
  });
});
