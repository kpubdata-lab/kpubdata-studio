import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

describe("grouped sidebar navigation (#247)", () => {
  beforeEach(() => {
    // jsdom에는 matchMedia가 없으므로 system 테마 분기를 피하도록 light로 고정한다.
    act(() =>
      useUIStore.setState({
        theme: "light",
        isMobileSidebarOpen: false,
        isDesktopSidebarCollapsed: false,
        isAssistantDrawerOpen: false,
      }),
    );
  });

  it("groups the menu as DATA / ANALYZE / OPERATE, with no AI group (#421, #423)", () => {
    renderLayoutAt("/");

    const nav = screen.getByRole("navigation", { name: "주 메뉴" });
    // Group headings are the upper-case labels; exactly these three, in this order.
    const headings = within(nav).getAllByText(/^[A-Z]+$/).map((node) => node.textContent);
    expect(headings).toEqual(["DATA", "ANALYZE", "OPERATE"]);
  });

  it("has no build-console destinations: creating a table is an action, not a menu item (#423)", () => {
    renderLayoutAt("/");
    const nav = screen.getByRole("navigation", { name: "주 메뉴" });

    expect(within(nav).queryByRole("link", { name: "데이터 추가" })).not.toBeInTheDocument();
    for (const link of within(nav).getAllByRole("link")) {
      expect(link.getAttribute("href")).not.toMatch(/^\/(add|builds\/new)$/);
    }
  });

  it("tells assistive tech whether the mobile sidebar is open and which element it controls (#485)", () => {
    renderLayoutAt("/");
    const toggle = screen.getByRole("button", { name: "사이드바 열기/닫기" });
    expect(toggle).toHaveAttribute("aria-controls", "app-sidebar");
    expect(document.getElementById("app-sidebar")).not.toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("opens Ask KPubData from the topbar, not from a sidebar destination (#421)", () => {
    renderLayoutAt("/");
    const nav = screen.getByRole("navigation", { name: "주 메뉴" });

    expect(within(nav).queryByRole("link", { name: "Ask KPubData" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ask KPubData 열기" }));
    expect(useUIStore.getState().isAssistantDrawerOpen).toBe(true);
  });

  it("exposes every IA route as a sidebar link", () => {
    renderLayoutAt("/");
    const nav = screen.getByRole("navigation", { name: "주 메뉴" });

    const expectedLinks: Record<string, string> = {
      "홈": "/",
      "카탈로그": "/discover",
      "테이블": "/tables",
      "작업대": "/workspace",
      "리포트": "/reports",
      "갱신 작업": "/refresh-jobs",
      "품질": "/quality",
      "모니터링": "/monitoring",
      "연결": "/connections",
      "설정": "/settings",
    };

    for (const [label, href] of Object.entries(expectedLinks)) {
      expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("marks the current route as active via aria-current", () => {
    renderLayoutAt("/quality");
    const nav = screen.getByRole("navigation", { name: "주 메뉴" });

    expect(within(nav).getByRole("link", { name: "품질" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "홈" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks only Home active at the root path (end match)", () => {
    renderLayoutAt("/");
    const nav = screen.getByRole("navigation", { name: "주 메뉴" });

    expect(within(nav).getByRole("link", { name: "홈" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("closes the mobile sidebar when a nav link is clicked", () => {
    renderLayoutAt("/");
    act(() => useUIStore.setState({ isMobileSidebarOpen: true }));
    expect(useUIStore.getState().isMobileSidebarOpen).toBe(true);

    const nav = screen.getByRole("navigation", { name: "주 메뉴" });
    fireEvent.click(within(nav).getByRole("link", { name: "카탈로그" }));

    expect(useUIStore.getState().isMobileSidebarOpen).toBe(false);
  });

  it("opens and closes the mobile sidebar overlay", () => {
    renderLayoutAt("/");
    expect(screen.queryByRole("button", { name: "내비게이션 닫기" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "사이드바 열기/닫기" }));
    expect(useUIStore.getState().isMobileSidebarOpen).toBe(true);
    expect(screen.getByRole("button", { name: "내비게이션 닫기" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "내비게이션 닫기" }));
    expect(useUIStore.getState().isMobileSidebarOpen).toBe(false);
  });

  it("keeps every IA route link accessible while the desktop sidebar is collapsed (#247)", () => {
    act(() => useUIStore.setState({ isDesktopSidebarCollapsed: true }));
    renderLayoutAt("/");
    const nav = screen.getByRole("navigation", { name: "주 메뉴" });

    expect(within(nav).getByRole("link", { name: "홈" })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: "품질" })).toHaveAttribute(
      "href",
      "/quality",
    );
  });
});
