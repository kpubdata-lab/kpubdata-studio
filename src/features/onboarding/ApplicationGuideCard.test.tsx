import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApplicationGuideCard } from "./ApplicationGuideCard";

describe("ApplicationGuideCard (#412, mock catalog)", () => {
  it("links each application and shows an unstated quota as unknown, not zero", async () => {
    render(<ApplicationGuideCard />);
    const region = await screen.findByRole("region", { name: "활용신청 안내" });
    const link = await within(region).findByRole("link", { name: "신청하기 ↗" });
    expect(link).toHaveAttribute("href", "https://www.data.go.kr/data/15073861/openapi.do");
    expect(link).toHaveAttribute("target", "_blank");
    expect(within(region).getByText("개발계정 일 10,000건")).toBeInTheDocument();
    expect(within(region).queryByText(/^0$/)).not.toBeInTheDocument();
    expect(within(region).getByText(/소스 데이터셋 3개는 활용신청 필요 여부를 알 수 없습니다/)).toBeInTheDocument();
  });
});
