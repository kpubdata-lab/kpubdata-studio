import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { silverStageDetailResponseSchema } from "@/shared/lib/builderApi.schema";

import { PreviewTab } from "./DatasetDetailPage";

// The preview tab reads `sample_withheld` off the Silver stage detail (#642): a withheld
// sample is a policy notice, a really empty one stays "no preview".
function detail(extra: Record<string, unknown>) {
  return silverStageDetailResponseSchema.parse({
    run_id: "r1",
    stage: "silver",
    source_key: "datago__air",
    status: "completed",
    available: true,
    row_count: 120,
    schema: [],
    statistics: null,
    validation: null,
    sample: [],
    ...extra,
  });
}

function renderPreview(data: ReturnType<typeof detail>) {
  render(
    <PreviewTab
      state={{ status: "loaded", data }}
      qualityState={{ status: "idle" }}
      qualityStatus="N/A"
      qualityResults={[]}
      onOpenQuality={() => {}}
    />,
  );
}

describe("DatasetDetailPage preview tab (#642)", () => {
  it("shows why the Silver sample was withheld", () => {
    renderPreview(detail({ sample_withheld: "pii_declaration_unavailable" }));
    expect(screen.getByRole("status")).toHaveAttribute("data-sample-withheld", "pii_declaration_unavailable");
    expect(document.querySelector("[data-sample-empty]")).toBeNull();
  });

  it("says 0 rows for a Silver table Builder counted no rows in", () => {
    renderPreview(detail({ row_count: 0 }));
    // Silver does keep a sample, so an empty one is a count, not "not supported" (#844).
    expect(screen.getByText("행이 없습니다 (0행)")).toBeInTheDocument();
    expect(screen.queryByText(/지원하지 않습니다/)).toBeNull();
    expect(document.querySelector("[data-sample-withheld]")).toBeNull();
  });

  it("says the sample is missing, not that there are no rows, for a Silver table with rows", () => {
    // 120 rows counted and no sample stored: "0 rows" would be wrong.
    renderPreview(detail({}));
    expect(screen.getByText("저장된 표본이 없습니다")).toBeInTheDocument();
    expect(screen.queryByText(/0행/)).toBeNull();
    expect(document.querySelector("[data-sample-withheld]")).toBeNull();
  });
});
