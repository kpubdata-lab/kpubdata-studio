import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AddDataPage } from "@/pages/AddDataPage";
import { DatasetCatalogPage } from "@/pages/DatasetCatalogPage";
import { DatasetDetailPage } from "@/pages/DatasetDetailPage";
import { DiscoverPage } from "@/pages/DiscoverPage";
import { AssistantPage } from "@/pages/AssistantPage";
import { MonitoringPage } from "@/pages/MonitoringPage";
import { ProviderPage } from "@/pages/ProviderPage";
import { QualityPage } from "@/pages/QualityPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { WorkspacePage } from "@/pages/WorkspacePage";
import { hideDemoWarehouse } from "./support/noWarehouse";

function renderPage(element: ReactNode) {
  return render(<MemoryRouter>{element}</MemoryRouter>);
}

describe("새 IA placeholder 화면 (#247)", () => {
  it("Monitoring is replaced with the real system/build statistics screen (#264)", async () => {
    renderPage(<MonitoringPage />);
    expect(await screen.findByRole("heading", { name: "시스템 모니터링" })).toBeInTheDocument();
    expect(screen.queryByText("아직 준비 중인 화면입니다")).not.toBeInTheDocument();
  });

  it("Workspace is replaced with the real Recent Work/Saved BuildSpecs screen (#260)", () => {
    renderPage(<WorkspacePage />);
    expect(screen.getByRole("heading", { name: "작업대" })).toBeInTheDocument();
    expect(screen.queryByText("아직 준비 중인 화면입니다")).not.toBeInTheDocument();
  });

  it("Catalog is replaced with the real catalog search/filter screen (#249)", () => {
    renderPage(<DiscoverPage />);
    expect(screen.getByRole("heading", { name: "데이터 탐색" })).toBeInTheDocument();
    expect(screen.queryByText("아직 준비 중인 화면입니다")).not.toBeInTheDocument();
  });

  it("Provider is replaced with the real connection/credential screen (#259)", async () => {
    renderPage(<ProviderPage />);
    expect(await screen.findByRole("heading", { name: "데이터 제공 기관 연결" })).toBeInTheDocument();
    expect(screen.queryByText("아직 준비 중인 화면입니다")).not.toBeInTheDocument();
  });

  it("Reports is replaced with the real Builder evidence-based Report screen (#258)", () => {
    renderPage(<ReportsPage />);
    expect(screen.getByRole("heading", { name: "리포트" })).toBeInTheDocument();
    expect(screen.getByText("새 Report 만들기")).toBeInTheDocument();
    expect(screen.queryByText("아직 준비 중인 화면입니다")).not.toBeInTheDocument();
  });

  it("Ask KPubData is replaced with the real context-aware Ask KPubData screen (#256)", () => {
    renderPage(<AssistantPage />);
    expect(screen.getByRole("heading", { name: "Ask KPubData" })).toBeInTheDocument();
    expect(screen.queryByText("아직 준비 중인 화면입니다")).not.toBeInTheDocument();
  });

  it("Table Catalog is replaced with the built dataset P0 screen", async () => {
    renderPage(<DatasetCatalogPage />);
    expect(await screen.findByRole("heading", { name: "테이블" })).toBeInTheDocument();
    expect(screen.queryByText("아직 준비 중인 화면입니다")).not.toBeInTheDocument();
  });

  it("Quality Center is replaced with the real Builder-backed P0 screen (#254)", async () => {
    renderPage(<QualityPage />);
    expect(await screen.findByRole("heading", { name: "품질 센터" })).toBeInTheDocument();
    expect(screen.queryByText("아직 준비 중인 화면입니다")).not.toBeInTheDocument();
  });

  it("Create Table is replaced with the real Create Table Workbench (#250)", () => {
    renderPage(<AddDataPage />);
    expect(screen.getByRole("heading", { name: "테이블 만들기" })).toBeInTheDocument();
    expect(screen.queryByText("아직 준비 중인 화면입니다")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "데이터 선택" })).toBeInTheDocument();
  });

  it("Dataset Detail loads the dataset identified by the route param", async () => {
    // The run-based view: a deployment without a warehouse (#530).
    hideDemoWarehouse();
    render(
      <MemoryRouter initialEntries={["/tables/air-quality"]}>
        <Routes>
          <Route path="/tables/:datasetId" element={<DatasetDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "대기질 통합 데이터" })).toBeInTheDocument();
    expect(screen.getByLabelText("실행 선택")).toHaveValue("air-2026-08-14");
  });
});
