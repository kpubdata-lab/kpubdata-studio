import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { QualityBadge, QualityStateBadge } from "./QualityBadge";

function mark(): Element {
  const found = document.querySelector("[data-status]");
  if (!found) throw new Error("no status mark");
  return found;
}

describe("QualityBadge renders the four meanings differently (#524)", () => {
  it("PASS is plain text", () => {
    render(<QualityBadge status="PASS" />);
    expect(mark()).toHaveAttribute("data-status", "normal");
    expect(mark()).toHaveTextContent("PASS");
  });

  it("WARN and FAIL are badges with their word", () => {
    const { unmount } = render(<QualityBadge status="WARN" />);
    expect(mark()).toHaveAttribute("data-status", "actionable");
    expect(mark()).toHaveAttribute("data-tone", "warning");
    expect(mark()).toHaveTextContent("WARN");
    unmount();
    render(<QualityBadge status="FAIL" />);
    expect(mark()).toHaveAttribute("data-tone", "failure");
    expect(mark()).toHaveTextContent("FAIL");
  });

  it("N/A means not evaluated, and says so on hover and to screen readers", () => {
    render(<QualityBadge status="N/A" />);
    expect(mark()).toHaveAttribute("data-status", "not-evaluated");
    expect(mark()).toHaveTextContent("N/A");
    expect(screen.getByTitle("평가 안 됨")).toBe(mark());
  });

  it("an absent status is a dash, not N/A", () => {
    render(<QualityBadge status={undefined} />);
    expect(mark()).toHaveAttribute("data-status", "missing");
    expect(mark()).not.toHaveTextContent("N/A");
  });
});

describe("QualityStateBadge keeps not-evaluated and unavailable apart (#254, #524)", () => {
  it("NOT_EVALUATED is not-evaluated, UNAVAILABLE is Builder's explicit unknown", () => {
    const { unmount } = render(<QualityStateBadge state="NOT_EVALUATED" />);
    expect(mark()).toHaveAttribute("data-status", "not-evaluated");
    expect(mark()).toHaveTextContent("평가 없음");
    unmount();
    render(<QualityStateBadge state="UNAVAILABLE" />);
    expect(mark()).toHaveAttribute("data-status", "unknown");
    expect(mark()).toHaveTextContent("결과 없음(unavailable)");
  });

  it("PASS is plain text and FAIL a badge", () => {
    const { unmount } = render(<QualityStateBadge state="PASS" />);
    expect(mark()).toHaveAttribute("data-status", "normal");
    unmount();
    render(<QualityStateBadge state="FAIL" />);
    expect(mark()).toHaveAttribute("data-status", "actionable");
  });
});
