import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { silverStageDetailResponseSchema } from "@/shared/lib/builderApi.schema";

import { StageSampleEmpty } from "./StageSampleEmpty";

// A Silver stage detail whose sample Builder withheld (builder#688 / #900): `sample` is
// empty on purpose and `sample_withheld` says why (#642).
const withheldDetail = {
  run_id: "r1",
  stage: "silver",
  source_key: "datago__air",
  status: "completed",
  available: true,
  row_count: 120,
  schema: [],
  statistics: null,
  validation: null,
  sample_withheld: "redistribution_forbidden",
  sample: [],
};

describe("silverStageDetailResponseSchema sample_withheld (#642)", () => {
  it("keeps both withheld reasons the contract declares", () => {
    expect(silverStageDetailResponseSchema.parse(withheldDetail).sample_withheld).toBe("redistribution_forbidden");
    expect(
      silverStageDetailResponseSchema.parse({ ...withheldDetail, sample_withheld: "pii_declaration_unavailable" }).sample_withheld,
    ).toBe("pii_declaration_unavailable");
  });

  it("leaves it absent for a sample that was not withheld", () => {
    const { sample_withheld: _omitted, ...plain } = withheldDetail;
    expect(silverStageDetailResponseSchema.parse(plain).sample_withheld).toBeUndefined();
  });
});

describe("StageSampleEmpty tells a withheld sample from an empty table (#642)", () => {
  it("shows the empty state when nothing was withheld", () => {
    render(<StageSampleEmpty stage="silver" />);
    expect(screen.getByText("미리보기 없음/지원되지 않음")).toBeInTheDocument();
    expect(document.querySelector("[data-sample-withheld]")).toBeNull();
  });

  it("explains a sample withheld by the redistribution terms instead of 'no preview'", () => {
    render(<StageSampleEmpty stage="silver" withheld="redistribution_forbidden" />);
    const notice = screen.getByRole("status");
    expect(notice).toHaveAttribute("data-sample-withheld", "redistribution_forbidden");
    expect(notice).toHaveTextContent("샘플을 정책에 따라 표시하지 않습니다");
    expect(notice).toHaveTextContent("재배포를 금지");
    expect(notice).toHaveTextContent("스키마 탭");
    expect(screen.queryByText("미리보기 없음/지원되지 않음")).toBeNull();
  });

  it("explains a sample withheld because the PII declaration could not be read", () => {
    render(<StageSampleEmpty stage="silver" withheld="pii_declaration_unavailable" />);
    const notice = screen.getByRole("status");
    expect(notice).toHaveAttribute("data-sample-withheld", "pii_declaration_unavailable");
    expect(notice).toHaveTextContent("개인정보(PII) 선언을 읽을 수 없어");
    expect(notice).toHaveTextContent("잠시 후 다시");
    // A policy notice, not a failure: plain text per StatusState (#524).
    expect(notice.querySelector("[data-status]")).toHaveAttribute("data-status", "normal");
    expect(screen.queryByText("미리보기 없음/지원되지 않음")).toBeNull();
  });
});
