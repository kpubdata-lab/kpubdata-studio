import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { Layout } from "@/app/Layout";
import { useUIStore } from "@/shared/hooks/useUIStore";

function renderLayoutAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Layout />
    </MemoryRouter>,
  );
}

describe("Layout header CTA (#49)", () => {
  beforeEach(() => {
    // jsdom에 matchMedia가 없으므로 system 분기를 피하도록 light로 고정한다.
    act(() =>
      useUIStore.setState({
        theme: "light",
        isMobileSidebarOpen: false,
        isAssistantDrawerOpen: false,
      }),
    );
  });

  it("links to Create Table from the dashboard", () => {
    renderLayoutAt("/");
    expect(screen.getByRole("link", { name: "테이블 만들기" })).toHaveAttribute(
      "href",
      "/builds/new",
    );
  });

  it("switches the CTA to the builds list while on the Create Table page", () => {
    renderLayoutAt("/builds/new");
    const cta = screen.getByRole("link", { name: "실행 목록" });
    expect(cta).toHaveAttribute("href", "/builds");
    expect(screen.queryByRole("link", { name: "테이블 만들기" })).not.toBeInTheDocument();
  });

  it("offers '결과물 보기' from a run page", () => {
    renderLayoutAt("/builds/run-1/run");
    expect(screen.getByRole("link", { name: "스냅샷 파일 보기" })).toHaveAttribute(
      "href",
      "/builds/run-1/artifacts",
    );
  });
});
