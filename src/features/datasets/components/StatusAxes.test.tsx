import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusAxes, kindOf } from "./StatusAxes";

function item(axis: string): HTMLElement {
  const list = screen.getByRole("list", { name: "테이블 상태" });
  const found = within(list).getAllByRole("listitem").find((li) => li.getAttribute("data-axis") === axis);
  if (!found) throw new Error(`no ${axis} axis`);
  return found;
}

function kind(axis: string): string | null {
  return item(axis).querySelector("[data-status]")?.getAttribute("data-status") ?? null;
}

describe("StatusAxes (#422)", () => {
  it("shows five separate axes, each with its name and its word, unknown included", () => {
    render(
      <StatusAxes
        axes={{ refresh: "failed", completeness: "partial", health: "unknown", access: "application_required", maturity: "beta" }}
      />,
    );
    const list = screen.getByRole("list", { name: "테이블 상태" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-axis"))).toEqual(["health", "completeness", "refresh", "access", "maturity"]);
    expect(items.map((li) => li.textContent)).toEqual([
      "상태알 수 없음",
      "완전성부분",
      "갱신실패",
      "접근활용신청 필요",
      "성숙도베타",
    ]);
  });
});

describe("StatusAxes renders the four meanings differently (#524)", () => {
  it("known normal is plain text, not a badge", () => {
    render(<StatusAxes axes={{ refresh: "succeeded", completeness: "complete", health: "healthy", access: "available", maturity: "stable" }} />);
    for (const axis of ["health", "completeness", "refresh", "access", "maturity"]) expect(kind(axis)).toBe("normal");
    expect(screen.queryAllByText((_, el) => el?.getAttribute("data-status") === "actionable")).toHaveLength(0);
  });

  it("known actionable is a badge that carries both the axis and the word", () => {
    render(<StatusAxes axes={{ refresh: "failed", completeness: "partial", health: "stale", access: "application_required", maturity: "beta" }} />);
    for (const axis of ["health", "completeness", "refresh", "access"]) expect(kind(axis)).toBe("actionable");
    const badge = item("health").querySelector("[data-status='actionable']");
    expect(badge).toHaveTextContent("상태오래됨");
    expect(item("completeness").querySelector("[data-status='actionable']")).toHaveTextContent("완전성부분");
    // Maturity is a grade, not a condition: never a badge.
    expect(kind("maturity")).toBe("normal");
  });

  it("explicit unknown is a readable word, not a dash", () => {
    render(<StatusAxes axes={{ refresh: "unknown", completeness: "unknown", health: "unknown", access: "unknown", maturity: "unknown" }} />);
    for (const axis of ["health", "completeness", "refresh", "access", "maturity"]) {
      expect(kind(axis)).toBe("unknown");
      expect(item(axis)).toHaveTextContent("알 수 없음");
      expect(item(axis)).not.toHaveTextContent("—");
    }
  });

  it("an axis Builder did not send is a dash with the reason, not unknown", () => {
    render(<StatusAxes axes={{ refresh: "succeeded", completeness: "complete", health: "healthy", access: "available" }} />);
    expect(kind("maturity")).toBe("missing");
    const missing = item("maturity").querySelector("[data-status='missing']");
    expect(missing).toHaveAttribute("title", "KPubData Builder가 이 값을 제공하지 않았습니다");
    expect(missing).toHaveTextContent("—");
    expect(item("maturity")).not.toHaveTextContent("알 수 없음");
  });

  it("no status_axes at all is one dash with the reason, not an empty space", () => {
    render(<StatusAxes axes={undefined} />);
    const missing = screen.getByTitle("KPubData Builder가 이 값을 제공하지 않았습니다");
    expect(missing).toHaveAttribute("data-status", "missing");
    expect(missing).toHaveTextContent("—");
    expect(screen.getByText("테이블 상태: KPubData Builder가 제공하지 않았습니다")).toBeInTheDocument();
  });

  it("classifies every axis value", () => {
    expect(kindOf("completeness", "partial")).toEqual({ kind: "actionable", tone: "warning" });
    expect(kindOf("completeness", "complete")).toEqual({ kind: "normal" });
    expect(kindOf("health", "unknown")).toEqual({ kind: "unknown" });
    expect(kindOf("health", undefined)).toEqual({ kind: "missing" });
    expect(kindOf("maturity", "experimental")).toEqual({ kind: "normal" });
    expect(kindOf("access", "retired")).toEqual({ kind: "actionable", tone: "failure" });
    expect(kindOf("refresh", "running")).toEqual({ kind: "normal" });
    expect(kindOf("refresh", "cancelled")).toEqual({ kind: "actionable", tone: "warning" });
  });
});
