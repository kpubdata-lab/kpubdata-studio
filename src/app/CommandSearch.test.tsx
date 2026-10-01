import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DatasetSummary } from "@/shared/lib/builderApi";
import { i18n } from "@/shared/i18n";

import { CommandSearch, type SearchDestination } from "./CommandSearch";
import { PALETTE_TABLE_CEILING, PALETTE_TABLE_LIMIT, loadTableIndex } from "./commandSearchIndex";

const listDatasetsPage = vi.fn<(limit: number, signal?: AbortSignal) => Promise<{ datasets: DatasetSummary[]; total: number | undefined }>>();
const loadCatalog = vi.fn();

vi.mock("@/features/datasets/api", () => ({
  listDatasetsPage: (limit: number, signal?: AbortSignal) => listDatasetsPage(limit, signal),
}));
vi.mock("@/features/discover/api", () => ({
  loadCatalog: () => loadCatalog(),
}));

function table(datasetId: string, title = datasetId): DatasetSummary {
  return { dataset_id: datasetId, title, sources: [] } as unknown as DatasetSummary;
}

function tables(count: number): DatasetSummary[] {
  return Array.from({ length: count }, (_, index) => table(`table-${index + 1}`));
}

const destinations: SearchDestination[] = [{ to: "/home", label: "Home", description: "Start page" }];

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{`${pathname}${search}`}</output>;
}

function renderPalette() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <a href="/outside">outside</a>
      <CommandSearch destinations={destinations} />
      <Routes>
        <Route element={<Where />} path="*" />
      </Routes>
    </MemoryRouter>,
  );
}

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
const trigger = () => screen.getByRole("button", { name: t("layout.search.open") });
const input = () => screen.getByRole("combobox", { name: t("layout.search.inputLabel") });
const dialog = () => screen.getByRole("dialog", { name: t("layout.search.dialog") });
const queryDialog = () => screen.queryByRole("dialog", { name: t("layout.search.dialog") });
const selectedLabel = () => screen.getAllByRole("option").find((option) => option.getAttribute("aria-selected") === "true")?.textContent;

function pressCtrlK(target: Element | Document = document) {
  fireEvent.keyDown(target, { key: "k", ctrlKey: true });
}

beforeEach(() => {
  listDatasetsPage.mockResolvedValue({ datasets: [table("air-quality", "대기질")], total: 1 });
  loadCatalog.mockResolvedValue({ providers: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("command palette focus (#654)", () => {
  it("keeps Tab and Shift+Tab inside the dialog", async () => {
    renderPalette();
    fireEvent.click(trigger());
    await waitFor(() => expect(input()).toHaveFocus());

    // The input is the dialog's only tabbable element, so either direction wraps back to
    // it — the browser's own move, which would leave the dialog, must be cancelled.
    expect(fireEvent.keyDown(input(), { key: "Tab" })).toBe(false);
    expect(input()).toHaveFocus();
    expect(fireEvent.keyDown(input(), { key: "Tab", shiftKey: true })).toBe(false);
    expect(input()).toHaveFocus();
  });

  it("brings focus back into the dialog when it has left", async () => {
    renderPalette();
    fireEvent.click(trigger());
    await waitFor(() => expect(input()).toHaveFocus());

    screen.getByRole("link", { name: "outside" }).focus();
    fireEvent.keyDown(document.activeElement as Element, { key: "Tab" });
    expect(input()).toHaveFocus();
  });

  it("closes on Esc when focus is elsewhere in the dialog, returning focus to the trigger", async () => {
    renderPalette();
    fireEvent.click(trigger());
    await waitFor(() => expect(input()).toHaveFocus());

    dialog().focus();
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(queryDialog()).toBeNull();
    expect(trigger()).toHaveFocus();
  });
});

describe("command palette Ctrl+K close (#656)", () => {
  it.each([
    ["the button", () => fireEvent.click(trigger())],
    ["Ctrl+K", () => pressCtrlK()],
  ])("opened with %s, closed with Ctrl+K: resets the query and selection and refocuses the trigger", async (_how, openIt) => {
    renderPalette();
    openIt();
    await waitFor(() => expect(input()).toHaveFocus());
    fireEvent.change(input(), { target: { value: "air" } });
    await screen.findByText("대기질");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selectedLabel()).not.toContain("대기질");

    pressCtrlK(input());
    expect(queryDialog()).toBeNull();
    expect(trigger()).toHaveFocus();

    pressCtrlK();
    await waitFor(() => expect(input()).toHaveFocus());
    expect(input()).toHaveValue("");
    // A fresh selection is the first result.
    expect(selectedLabel()).toBe(screen.getAllByRole("option")[0]?.textContent);
  });
});

describe("command palette selection while lists load (#657)", () => {
  it("keeps the highlighted row, and Enter opens it, when tables arrive later", async () => {
    let resolveTables: (value: { datasets: DatasetSummary[]; total: number }) => void = () => {};
    listDatasetsPage.mockReturnValue(
      new Promise((resolve) => {
        resolveTables = resolve;
      }),
    );
    renderPalette();
    fireEvent.click(trigger());
    fireEvent.change(input(), { target: { value: "air" } });

    // Before tables load: [Search tables, Search the catalog, Ask]. Pick "Search the catalog".
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    const picked = t("layout.search.inCatalog", { query: "air" });
    expect(selectedLabel()).toContain(picked);

    await act(async () => {
      resolveTables({ datasets: [table("air-quality", "대기질"), table("air-pm", "미세먼지")], total: 2 });
    });
    await screen.findByText("대기질");
    expect(selectedLabel()).toContain(picked);

    fireEvent.keyDown(input(), { key: "Enter" });
    expect(screen.getByTestId("where")).toHaveTextContent("/discover?q=air");
  });
});

describe("command palette tables (#659)", () => {
  it("reloads the tables each time the palette opens", async () => {
    renderPalette();
    fireEvent.click(trigger());
    await waitFor(() => expect(listDatasetsPage).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(input(), { key: "Escape" });

    listDatasetsPage.mockResolvedValue({ datasets: [table("air-quality", "대기질"), table("new-table", "새 테이블")], total: 2 });
    fireEvent.click(trigger());
    await waitFor(() => expect(listDatasetsPage).toHaveBeenCalledTimes(2));
    fireEvent.change(input(), { target: { value: "new-table" } });
    expect(await screen.findByText("새 테이블")).toBeInTheDocument();
  });

  it("says when it searched only some of the tables", async () => {
    listDatasetsPage.mockImplementation(async (limit) => ({ datasets: tables(Math.min(limit, PALETTE_TABLE_CEILING)), total: 1500 }));
    renderPalette();
    fireEvent.click(trigger());
    fireEvent.change(input(), { target: { value: "table" } });
    expect(
      await screen.findByText(t("layout.search.partialTables", { loaded: PALETTE_TABLE_CEILING, total: 1500 })),
    ).toBeInTheDocument();
  });

  it("says nothing about a partial search when every table loaded", async () => {
    renderPalette();
    fireEvent.click(trigger());
    fireEvent.change(input(), { target: { value: "air" } });
    await screen.findByText("대기질");
    expect(screen.queryByText(/만 검색했습니다/)).toBeNull();
  });
});

describe("loadTableIndex (#659)", () => {
  it("asks again for the rest when total shows more than the first page", async () => {
    listDatasetsPage.mockImplementation(async (limit) => ({ datasets: tables(Math.min(limit, 250)), total: 250 }));
    const index = await loadTableIndex();
    expect(listDatasetsPage.mock.calls.map(([limit]) => limit)).toEqual([PALETTE_TABLE_LIMIT, 250]);
    expect(index.entries.map((entry) => entry.datasetId)).toContain("table-101");
    expect(index.complete).toBe(true);
  });

  it("stops at the ceiling and marks the index partial", async () => {
    listDatasetsPage.mockImplementation(async (limit) => ({ datasets: tables(limit), total: 5000 }));
    const index = await loadTableIndex();
    expect(listDatasetsPage.mock.calls.map(([limit]) => limit)).toEqual([PALETTE_TABLE_LIMIT, PALETTE_TABLE_CEILING]);
    expect(index).toMatchObject({ total: 5000, complete: false });
  });

  it("asks once when the first page holds every table", async () => {
    listDatasetsPage.mockResolvedValue({ datasets: tables(3), total: 3 });
    expect(await loadTableIndex()).toMatchObject({ complete: true, total: 3 });
    expect(listDatasetsPage).toHaveBeenCalledTimes(1);
  });

  it("treats a full page without total as possibly partial", async () => {
    listDatasetsPage.mockResolvedValue({ datasets: tables(PALETTE_TABLE_LIMIT), total: undefined });
    expect(await loadTableIndex()).toMatchObject({ complete: false, total: undefined });
    expect(listDatasetsPage).toHaveBeenCalledTimes(1);
  });
});
