import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusAxes, toneOf } from "./StatusAxes";

describe("StatusAxes (#422)", () => {
  it("shows five separate axes, each with its name and its word, unknown included", () => {
    render(
      <StatusAxes
        axes={{ refresh: "failed", completeness: "partial", health: "unknown", access: "application_required", maturity: "beta" }}
      />,
    );
    const list = screen.getByRole("list", { name: "테이블 상태" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-axis"))).toEqual(["health", "completeness", "refresh", "access", "maturity"]);
    expect(items.map((item) => item.textContent)).toEqual([
      "상태알 수 없음",
      "완전성부분",
      "갱신실패",
      "접근활용신청 필요",
      "성숙도Beta",
    ]);
  });

  it("never paints partial as complete, and keeps maturity and unknown neutral", () => {
    expect(toneOf("completeness", "partial")).toBe("warning");
    expect(toneOf("completeness", "complete")).toBe("success");
    expect(toneOf("health", "unknown")).toBe("neutral");
    expect(toneOf("maturity", "stable")).toBe("neutral");
    expect(toneOf("access", "retired")).toBe("failure");
  });

  it("renders nothing for an Builder that sends no axes", () => {
    const { container } = render(<StatusAxes axes={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
