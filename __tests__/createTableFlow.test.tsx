/**
 * One table creation flow (#534): Configure → Preview & Validate → Create.
 *
 * `/add` used to have four steps and `/refresh-jobs/new` a second, seven-step wizard. The
 * creation path is now `/add` alone; the old URL redirects there with its query, so a
 * Workspace link (`?savedSpecId=`) and an Ask KPubData draft still arrive. Editing an
 * existing table's spec keeps its own page (`/refresh-jobs/:id/edit`, #496).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { CreateTableRedirect } from "@/app/createTableRedirect";
import { saveDraft } from "@/features/build-spec/draftStorage";
import { createSavedSpec } from "@/features/workspace/savedSpecs";
import { AddDataPage } from "@/pages/AddDataPage";
import { NewBuildPage } from "@/pages/NewBuildPage";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/add" element={<AddDataPage />} />
        <Route path="/refresh-jobs/new" element={<CreateTableRedirect />} />
        <Route path="/refresh-jobs/:buildId/edit" element={<NewBuildPage />} />
        <Route path="/edit-without-id" element={<NewBuildPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function next() {
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
}

afterEach(() => localStorage.clear());

describe("one table creation flow (#534)", () => {
  it("has three steps: Configure, Preview & Validate, Create", () => {
    renderAt("/add");
    const steps = within(screen.getByRole("list", { name: "테이블 만들기 단계" })).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual([
      expect.stringContaining("구성"),
      expect.stringContaining("미리보기·검증"),
      expect.stringContaining("만들기"),
    ]);
  });

  it("configures the source in the first step, without a separate source step", async () => {
    renderAt("/add");
    fireEvent.click(screen.getByRole("button", { name: /Public API/ }));

    // Provider and dataset appear in the same step as the source choice.
    expect(await screen.findByLabelText(/제공자 \(Provider\)/)).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("구성");
  });

  it("previews the logical table name from Builder's source key before creating", async () => {
    renderAt("/add");
    fireEvent.click(screen.getByRole("button", { name: /Public API/ }));
    fireEvent.change(await screen.findByLabelText(/제공자 \(Provider\)/), { target: { value: "datago" } });
    await waitFor(() => expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "apt_trade" } });
    await screen.findByText("아파트 실거래가");

    next();
    await screen.findByRole("heading", { name: "Preview · 검증" });
    fireEvent.click(screen.getByRole("button", { name: "Preview 새로고침" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "다음" })).toBeEnabled());
    next();

    const name = await screen.findByRole("group", { name: "만들어질 테이블 이름" });
    expect(within(name).getByText("datago-apt-trade.apt_trade")).toBeInTheDocument();
  });

  it("redirects /refresh-jobs/new to /add with its query", () => {
    renderAt("/refresh-jobs/new?savedSpecId=missing");
    expect(screen.getByTestId("location")).toHaveTextContent("/add?savedSpecId=missing");
  });

  it("opens a Workspace saved spec in the creation flow", async () => {
    const { entry } = createSavedSpec({
      name: "저장된 인구 스펙",
      spec: {
        datasetId: "kosis-population",
        title: "인구 통계",
        description: "설명",
        sources: [{ provider: "kosis", dataset: "population_stat", params: {} }],
        exports: [{ format: "jsonl" }],
        metadata: { outputPath: "artifacts/builds/population" },
      },
      validation: { status: "validated_pass", errors: [] },
    });

    renderAt(`/refresh-jobs/new?savedSpecId=${entry.id}`);

    expect(await screen.findByText(/저장된 인구 스펙/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Public API/ })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("인구 통계")).toBeInTheDocument();
  });

  it("opens a saved spec with a file source as a file source, not a public API one", async () => {
    const { entry } = createSavedSpec({
      name: "파일 스펙",
      spec: {
        datasetId: "uploaded",
        title: "업로드 표",
        description: "설명",
        sources: [{ kind: "file", params: {}, uploadId: "upload-1", format: "csv" }],
        exports: [{ format: "jsonl" }],
        metadata: { outputPath: "artifacts/builds/uploaded" },
      },
      validation: { status: "not_validated", errors: [] },
    });

    renderAt(`/add?savedSpecId=${entry.id}`);

    expect(await screen.findByText(/파일 스펙/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /File Upload/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Public API/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("offers an Ask KPubData draft on /add", async () => {
    saveDraft({
      datasetId: "air-draft",
      title: "대기 초안",
      description: "초안 설명",
      provider: "datago",
      sourceDataset: "air_quality",
      sourceParams: "{}",
      outputPath: "artifacts/builds/air-draft",
      exportFormats: ["jsonl"],
    });

    renderAt("/add");
    fireEvent.click(await screen.findByRole("button", { name: "불러오기" }));

    expect(screen.getByRole("button", { name: /Public API/ })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("대기 초안")).toBeInTheDocument();
  });

  it("sends the edit page without a table to the creation flow", () => {
    renderAt("/edit-without-id");
    expect(screen.getByTestId("location")).toHaveTextContent("/add");
  });
});
