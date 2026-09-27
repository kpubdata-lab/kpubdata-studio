/**
 * PreviewValidationStep — stale result warning (audit followup 1-2).
 *
 * If dataset/params changed since last Preview (AddDataPage's isStale), the step
 * must show that "remaining results differ from current settings". Build block is
 * handled by ReviewBuildStep's existing stale guard, so here we only verify display.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
