import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatasetCatalogPage } from "@/pages/DatasetCatalogPage";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderCatalog(initialEntry = "/datasets") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route path="/datasets" element={<DatasetCatalogPage />} />
        <Route path="/datasets/:datasetId" element={<p>dataset detail destination</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.stubEnv("VITE_USE_REAL_BUILDER", "false"));
afterEach(() => vi.unstubAllEnvs());

describe("Table Catalog P0 (#253)", () => {
  it("searches dataset/provider and preserves q in the URL", async () => {
    renderCatalog();
    await screen.findByText("대기질 통합 데이터");
    fireEvent.change(screen.getByLabelText("소스 데이터셋 / Provider 검색"), { target: { value: "population" } });
    expect(screen.getByText("행정구역별 인구")).toBeInTheDocument();
    expect(screen.queryByText("대기질 통합 데이터")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("?q=population");
  });

  it("filters by any provider in a multi-source dataset", async () => {
    renderCatalog();
    await screen.findByText("대기질 통합 데이터");
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "kma" } });
    expect(screen.getByText("대기질 통합 데이터")).toBeInTheDocument();
    expect(screen.queryByText("행정구역별 인구")).not.toBeInTheDocument();
    expect(screen.getByText("data.go.kr, kma")).toBeInTheDocument();
  });

  it("summarizes mixed/failed stages without expanding source details and filters by raw Builder status", async () => {
    renderCatalog();
    const air = await screen.findByRole("link", { name: "대기질 통합 데이터 상세 열기" });
    expect(within(air).getByText("Mixed / Failed")).toBeInTheDocument();
    expect(within(air).queryByText("datago__air")).not.toBeInTheDocument();
    expect(within(air).queryByText("not_run")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Stage 상태"), { target: { value: "unavailable" } });
    expect(screen.getByText("행정구역별 인구")).toBeInTheDocument();
    expect(screen.queryByText("대기질 통합 데이터")).not.toBeInTheDocument();
  });

  it("offers Create Table as the Tables page's own action (#423)", async () => {
    renderCatalog();
    expect(await screen.findByRole("link", { name: "테이블 만들기" })).toHaveAttribute("href", "/add");
  });

  it("uses the prototype five-column catalog hierarchy", async () => {
    renderCatalog();
    await screen.findByText("대기질 통합 데이터");
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Table", "Provider", "Stage", "Validation", "Updated",
    ]);
    expect(screen.queryByRole("columnheader", { name: "Row count" })).not.toBeInTheDocument();
  });

  it("restores URL filters and treats no quality as N/A", async () => {
    renderCatalog("/datasets?provider=kosis&stage=unavailable&validation=N%2FA");
    const row = await screen.findByRole("link", { name: "행정구역별 인구 상세 열기" });
    expect(within(row).getByText("N/A")).toBeInTheDocument();
    expect(screen.getByLabelText("Provider")).toHaveValue("kosis");
    expect(screen.getByLabelText("Stage 상태")).toHaveValue("unavailable");
    expect(screen.getByLabelText("Validation")).toHaveValue("N/A");
  });

  it("navigates to Dataset Detail when a row is clicked", async () => {
    renderCatalog();
    fireEvent.click(await screen.findByRole("link", { name: "대기질 통합 데이터 상세 열기" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/datasets/air-quality"));
    expect(screen.getByText("dataset detail destination")).toBeInTheDocument();
  });
});
