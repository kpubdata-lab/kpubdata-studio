import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StageBadge } from "./StageBadge";

function mark(): Element {
  const found = document.querySelector("[data-status]");
  if (!found) throw new Error("no status mark");
  return found;
}

describe("StageBadge renders the four meanings differently (#524)", () => {
  it.each([
    ["completed", "normal"],
    ["failed", "actionable"],
    ["unavailable", "unknown"],
    ["not_run", "not-evaluated"],
  ] as const)("%s is %s", (status, kind) => {
    render(<StageBadge status={status} />);
    expect(mark()).toHaveAttribute("data-status", kind);
  });

  it("keeps Builder's word on every known state", () => {
    const { unmount } = render(<StageBadge status="failed" />);
    expect(mark()).toHaveTextContent("failed");
    unmount();
    render(<StageBadge status="not_run" />);
    expect(mark()).toHaveTextContent("not_run");
  });

  it("an absent stage status is a dash, not unavailable", () => {
    render(<StageBadge status={undefined} />);
    expect(mark()).toHaveAttribute("data-status", "missing");
    expect(mark()).toHaveTextContent("—");
    expect(mark()).not.toHaveTextContent("unavailable");
  });
});
