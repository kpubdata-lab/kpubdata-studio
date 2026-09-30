/**
 * The topbar is breadcrumb + search + Ask KPubData + account (#523).
 *
 * Before this the topbar carried an AI search box, an AI button with a hard-coded
 * label, a language toggle and an avatar link, and the sidebar carried a theme select.
 * AI took two of the four slots. These tests pin the new shape by behaviour: one AI
 * entry point, a search that navigates and never opens the assistant, and language and
 * theme reachable from the account menu.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Layout } from "@/app/Layout";
import { useAuthStore } from "@/features/auth/store";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { i18n } from "@/shared/i18n";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderLayoutAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Layout />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // jsdom has no matchMedia, so pin the theme away from "system".
  act(() =>
    useUIStore.setState({
      theme: "light",
      isMobileSidebarOpen: false,
      isDesktopSidebarCollapsed: false,
      isAssistantDrawerOpen: false,
    }),
  );
  act(() => useAuthStore.getState().clear());
});

afterEach(() => {
  act(() => {
    void i18n.changeLanguage("ko");
  });
});

describe("topbar (#523)", () => {
  it("has one AI entry point, Ask KPubData, and no AI search box", () => {
    renderLayoutAt("/");
    const header = screen.getByRole("banner");

    expect(within(header).getAllByRole("button", { name: /Ask KPubData/ })).toHaveLength(1);
    expect(within(header).queryByRole("search")).not.toBeInTheDocument();
    expect(within(header).queryByRole("searchbox")).not.toBeInTheDocument();
    // The button's visible label is translated, not the hard-coded retired label.
    // stale-ui-ignore: asserts the retired label is gone (#531).
    expect(within(header).queryByText("Assistant")).not.toBeInTheDocument();
    expect(within(header).getByText("Ask KPubData")).toBeInTheDocument();
  });

  it("puts nothing but the breadcrumb, search, Ask KPubData and the account menu in the topbar", () => {
    renderLayoutAt("/");
    const header = screen.getByRole("banner");
    const names = within(header)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));

    expect(names).toEqual(["사이드바 열기/닫기", "테이블·소스·페이지 검색", "Ask KPubData 열기", "계정 메뉴"]);
    expect(within(header).getByRole("navigation", { name: "현재 위치" })).toBeInTheDocument();
  });

  it("opens search with Ctrl+K and navigates to a page without opening the assistant", () => {
    renderLayoutAt("/");

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const dialog = screen.getByRole("dialog", { name: "검색" });
    const input = within(dialog).getByRole("combobox", { name: "테이블·소스·페이지 검색" });
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: "SQL" } });
    expect(within(dialog).getAllByRole("option")[0]).toHaveTextContent("SQL Workspace");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByTestId("location")).toHaveTextContent("/sql");
    expect(screen.queryByRole("dialog", { name: "검색" })).not.toBeInTheDocument();
    expect(useUIStore.getState().isAssistantDrawerOpen).toBe(false);
  });

  it("searches tables by name through the Tables list filter", () => {
    renderLayoutAt("/");

    fireEvent.click(screen.getByRole("button", { name: "테이블·소스·페이지 검색" }));
    const dialog = screen.getByRole("dialog", { name: "검색" });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "대기질" } });
    fireEvent.click(within(dialog).getByRole("option", { name: /테이블에서 “대기질” 검색/ }));

    expect(screen.getByTestId("location")).toHaveTextContent("/tables?q=%EB%8C%80%EA%B8%B0%EC%A7%88");
    expect(useUIStore.getState().isAssistantDrawerOpen).toBe(false);
  });

  it("closes search with Escape and returns focus to the button", () => {
    renderLayoutAt("/");
    const trigger = screen.getByRole("button", { name: "테이블·소스·페이지 검색" });

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "검색" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("account menu (#523)", () => {
  it("changes the theme from the account menu", () => {
    renderLayoutAt("/");

    fireEvent.click(screen.getByRole("button", { name: "계정 메뉴" }));
    const menu = screen.getByRole("dialog", { name: "계정" });
    fireEvent.change(within(menu).getByLabelText("테마"), { target: { value: "dark" } });

    expect(useUIStore.getState().theme).toBe("dark");
  });

  it("changes the language from the account menu", () => {
    renderLayoutAt("/");

    fireEvent.click(screen.getByRole("button", { name: "계정 메뉴" }));
    const menu = screen.getByRole("dialog", { name: "계정" });
    act(() => {
      fireEvent.change(within(menu).getByLabelText("언어"), { target: { value: "en" } });
    });

    expect(i18n.language).toBe("en");
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
  });

  it("links to help and signs the person out", () => {
    act(() => useAuthStore.setState({ email: "user@example.com", token: "t" }));
    renderLayoutAt("/");

    fireEvent.click(screen.getByRole("button", { name: "user@example.com 계정 메뉴" }));
    const menu = screen.getByRole("dialog", { name: "계정" });
    expect(within(menu).getByText("user@example.com")).toBeInTheDocument();
    expect(within(menu).getByRole("link", { name: "도움말 (문서)" })).toHaveAttribute("href", "https://yeongseon.github.io/kpubdata-studio/docs/");

    fireEvent.click(within(menu).getByRole("button", { name: "로그아웃" }));
    expect(useAuthStore.getState().email).toBeNull();
    expect(screen.queryByRole("dialog", { name: "계정" })).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the avatar", () => {
    renderLayoutAt("/");
    const avatar = screen.getByRole("button", { name: "계정 메뉴" });

    fireEvent.click(avatar);
    expect(avatar).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "계정" })).not.toBeInTheDocument();
    expect(avatar).toHaveFocus();
  });
});

describe("sidebar (#523)", () => {
  it("has no theme control — theme lives in the account menu", () => {
    renderLayoutAt("/");
    const aside = document.getElementById("app-sidebar")!;

    expect(within(aside).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(aside).queryByText("테마")).not.toBeInTheDocument();
  });
});
