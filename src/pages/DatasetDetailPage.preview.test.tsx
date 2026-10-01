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
    expect(screen.queryByText("미리보기 없음/지원되지 않음")).toBeNull();
  });

  it("keeps 'no preview' for a Silver sample that is really empty", () => {
    renderPreview(detail({}));
    expect(screen.getByText("미리보기 없음/지원되지 않음")).toBeInTheDocument();
    expect(document.querySelector("[data-sample-withheld]")).toBeNull();
  });
});
