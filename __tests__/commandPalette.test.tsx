/**
 * The ⌘K palette finds tables and sources, not only pages (#533).
 *
 * Mock mode feeds it the same fixtures the Tables and Catalog pages show. Ask KPubData is
 * offered only as the last option and is never the one Enter picks by default, so
 * searching never starts a conversation by accident.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { Layout } from "@/app/Layout";
import { useAuthStore } from "@/features/auth/store";
import { useAssistantStore } from "@/features/assistant/useAssistantSession";
import { useUIStore } from "@/shared/hooks/useUIStore";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Layout />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  act(() =>
    useUIStore.setState({
      theme: "light",
      isMobileSidebarOpen: false,
      isDesktopSidebarCollapsed: false,
      isAssistantDrawerOpen: false,
    }),
  );
  act(() => useAuthStore.getState().clear());
  act(() => useAssistantStore.setState({ pendingSeed: null, turns: [] }));
});

async function openAndType(query: string, shortcut: { ctrlKey?: boolean; metaKey?: boolean } = { ctrlKey: true }) {
  renderLayout();
  fireEvent.keyDown(document, { key: "k", ...shortcut });
  const dialog = screen.getByRole("dialog", { name: "검색" });
  const input = within(dialog).getByRole("combobox");
  fireEvent.change(input, { target: { value: query } });
  // Tables and sources arrive asynchronously; wait for the table hit.
  await within(dialog).findByRole("option", { name: /대기질 통합 데이터/ });
  return { dialog, input };
}

describe("command palette (#533)", () => {
  it("opens with ⌘K as well as Ctrl+K", () => {
    renderLayout();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog", { name: "검색" })).toBeInTheDocument();
  });

  it("lists matching tables before sources, and picks the first table by default", async () => {
    const { dialog, input } = await openAndType("대기");

    const options = within(dialog).getAllByRole("option");
    expect(options[0]).toHaveTextContent("대기질 통합 데이터");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByRole("group", { name: "테이블" })).toBeInTheDocument();
    expect(within(within(dialog).getByRole("group", { name: "소스" })).getByRole("option", { name: /대기오염 정보/ })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("location")).toHaveTextContent("/tables/air-quality");
    expect(useUIStore.getState().isAssistantDrawerOpen).toBe(false);
  });

  it("opens a source in the Catalog with the keyboard alone", async () => {
    const { dialog, input } = await openAndType("대기");

    const sourceIndex = within(dialog)
      .getAllByRole("option")
      .findIndex((option) => option.textContent?.includes("대기오염 정보"));
    for (let step = 0; step < sourceIndex; step += 1) fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByTestId("location")).toHaveTextContent("/discover?provider=datago&q=air_quality");
  });

  it("offers Ask KPubData only as the last option, never selected by default", async () => {
    const { dialog, input } = await openAndType("대기");

    const options = within(dialog).getAllByRole("option");
    const ask = options[options.length - 1];
    expect(ask).toHaveTextContent("Ask KPubData: “대기”");
    expect(ask).toHaveAttribute("aria-selected", "false");

    for (let step = 1; step < options.length; step += 1) fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(ask).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useUIStore.getState().isAssistantDrawerOpen).toBe(true);
    expect(screen.queryByRole("dialog", { name: "검색" })).not.toBeInTheDocument();
  });

  it("keeps the Tables and Catalog filters ahead of Ask KPubData when nothing matches", async () => {
    renderLayout();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const dialog = screen.getByRole("dialog", { name: "검색" });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "zzzz" } });
    await act(async () => {});

    const options = within(dialog).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining("테이블에서 “zzzz” 검색"),
      expect.stringContaining("카탈로그에서 “zzzz” 검색"),
      expect.stringContaining("Ask KPubData: “zzzz”"),
    ]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[2]).toHaveAttribute("aria-selected", "false");
  });
});
