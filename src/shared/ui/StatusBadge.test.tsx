import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "./StatusBadge";

function mark(): Element {
  const found = document.querySelector("[data-status]");
  if (!found) throw new Error("no status mark");
  return found;
}

describe("StatusBadge renders the four meanings differently (#524)", () => {
  it("a known normal status is plain text", () => {
    render(<StatusBadge status="succeeded" />);
    expect(screen.getByText("성공")).toBeInTheDocument();
    expect(mark()).toHaveAttribute("data-status", "normal");
  });

  it("a known actionable status is a badge with its word", () => {
    render(<StatusBadge status="failed" />);
    expect(mark()).toHaveAttribute("data-status", "actionable");
    expect(mark()).toHaveAttribute("data-tone", "failure");
    expect(mark()).toHaveTextContent("실패");
  });

  it("an explicit unknown is the word, not a dash", () => {
    render(<StatusBadge status="unknown" />);
    expect(mark()).toHaveAttribute("data-status", "unknown");
    expect(mark()).toHaveTextContent("알 수 없음");
  });

  it("an absent status is a dash with the reason", () => {
    render(<StatusBadge status={undefined} />);
    expect(mark()).toHaveAttribute("data-status", "missing");
    expect(mark()).toHaveAttribute("title", "KPubData Builder가 이 값을 제공하지 않았습니다");
    expect(mark()).toHaveTextContent("—");
  });

  it("a value Studio has no mapping for is shown as-is, not as unknown or missing", () => {
    render(<StatusBadge status="archived" />);
    expect(screen.getByText("archived")).toBeInTheDocument();
    expect(mark()).toHaveAttribute("data-status", "normal");
  });
});
