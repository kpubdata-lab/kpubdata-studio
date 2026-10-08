import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { silverStageDetailResponseSchema } from "@/shared/lib/builderApi.schema";

import { StageSampleEmpty, stageSampleEmptyReason } from "./StageSampleEmpty";

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
  it("says a stage with a sample has no rows when it has none (#844)", () => {
    render(<StageSampleEmpty empty="zero_rows" stage="silver" />);
    expect(screen.getByText("행이 없습니다 (0행)")).toBeInTheDocument();
    expect(document.querySelector("[data-sample-empty]")).toHaveAttribute("data-sample-empty", "zero_rows");
    // Not "not supported": the stage does keep a sample, and this one is empty.
    expect(screen.queryByText(/지원하지 않습니다/)).toBeNull();
    expect(document.querySelector("[data-sample-withheld]")).toBeNull();
  });

  it("says a sample is missing, not that there are no rows, when rows were counted or not counted at all (#844)", () => {
    render(<StageSampleEmpty empty="no_sample" stage="silver" />);
    expect(screen.getByText("저장된 표본이 없습니다")).toBeInTheDocument();
    expect(screen.getByText(/행이 없다는 뜻은 아닙니다/)).toBeInTheDocument();
    expect(screen.queryByText(/0행|지원하지 않습니다/)).toBeNull();
  });

  it.each([
    [{ stage: "silver", row_count: 0, statistics: null }, "zero_rows"],
    [{ stage: "silver", row_count: null, statistics: { row_count: 0 } }, "zero_rows"],
    // Rows were counted and the sample is empty: the sample is what is missing.
    [{ stage: "silver", row_count: 22, statistics: { row_count: 22 } }, "no_sample"],
    // Nothing was counted: "0 rows" would be a guess.
    [{ stage: "silver", row_count: null, statistics: null }, "no_sample"],
    [{ stage: "gold" }, "unsupported"],
    [{ stage: "bronze", row_count: 0 }, "unsupported"],
  ] as const)("reads %j as %s", (detail, reason) => {
    expect(stageSampleEmptyReason(detail)).toBe(reason);
  });

  it("says a stage that keeps no sample does not support a preview (#844)", () => {
    render(<StageSampleEmpty empty="unsupported" stage="gold" />);
    expect(screen.getByText("이 단계는 미리보기를 지원하지 않습니다")).toBeInTheDocument();
    expect(document.querySelector("[data-sample-empty]")).toHaveAttribute("data-sample-empty", "unsupported");
    // Not "0 rows": nothing is known of how many rows it has.
    expect(screen.queryByText(/0행/)).toBeNull();
  });

  it("explains a sample withheld by the redistribution terms instead of 'no preview'", () => {
    render(<StageSampleEmpty empty="zero_rows" stage="silver" withheld="redistribution_forbidden" />);
    const notice = screen.getByRole("status");
    expect(notice).toHaveAttribute("data-sample-withheld", "redistribution_forbidden");
    expect(notice).toHaveTextContent("샘플을 정책에 따라 표시하지 않습니다");
    expect(notice).toHaveTextContent("재배포를 금지");
    expect(notice).toHaveTextContent("스키마 탭");
    expect(document.querySelector("[data-sample-empty]")).toBeNull();
    expect(screen.queryByText(/0행|지원하지 않습니다/)).toBeNull();
  });

  it("explains a sample withheld because the PII declaration could not be read", () => {
    render(<StageSampleEmpty empty="zero_rows" stage="silver" withheld="pii_declaration_unavailable" />);
    const notice = screen.getByRole("status");
    expect(notice).toHaveAttribute("data-sample-withheld", "pii_declaration_unavailable");
    expect(notice).toHaveTextContent("개인정보(PII) 선언을 읽을 수 없어");
    expect(notice).toHaveTextContent("잠시 후 다시");
    // A policy notice, not a failure: plain text per StatusState (#524).
    expect(notice.querySelector("[data-status]")).toHaveAttribute("data-status", "normal");
    expect(document.querySelector("[data-sample-empty]")).toBeNull();
    expect(screen.queryByText(/0행|지원하지 않습니다/)).toBeNull();
  });
});
