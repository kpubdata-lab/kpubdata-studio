/**
 * No global CTA, a breadcrumb instead (#423).
 *
 * The topbar used to carry "New Build" on every screen. In the warehouse IA creating
 * a table is an action of Catalog and Tables, and the topbar says where the user is.
 */
import { act, render, screen, within } from "@testing-library/react";
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

function breadcrumb() {
  return within(screen.getByRole("navigation", { name: "현재 위치" }));
}

describe("Layout topbar (#423)", () => {
  beforeEach(() => {
    // jsdom has no matchMedia, so pin the theme to avoid the system branch.
    act(() =>
      useUIStore.setState({
        theme: "light",
        isMobileSidebarOpen: false,
        isAssistantDrawerOpen: false,
      }),
    );
  });

  it("has no global Create Table link on any screen", () => {
    for (const path of ["/", "/refresh-jobs", "/refresh-jobs/new", "/refresh-jobs/run-1/run"]) {
      const { unmount } = renderLayoutAt(path);
      expect(within(screen.getByRole("banner")).queryByRole("link", { name: "테이블 만들기" })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("names the current place instead of the product", () => {
    renderLayoutAt("/refresh-jobs/run-1/artifacts");
    expect(breadcrumb().getByRole("link", { name: "갱신 작업" })).toHaveAttribute("href", "/refresh-jobs");
    expect(breadcrumb().getByRole("link", { name: "run-1" })).toHaveAttribute("href", "/refresh-jobs/run-1");
    expect(breadcrumb().getByText("스냅샷 파일")).toHaveAttribute("aria-current", "page");
    expect(within(screen.getByRole("banner")).queryByText("KPubData Studio")).not.toBeInTheDocument();
  });
});
