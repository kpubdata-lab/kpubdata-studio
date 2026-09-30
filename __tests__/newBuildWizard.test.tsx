import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearBuildSpecs, saveBuildSpec } from "@/features/build-spec/specStore";
import { NewBuildPage } from "@/pages/NewBuildPage";
import { API_BASE } from "@/shared/config/env";
import { mswServer } from "../vitest.setup";

const { previewBuildMock } = vi.hoisted(() => ({
  previewBuildMock: vi.fn(),
}));

vi.mock("@/features/preview/api", () => ({
  previewBuild: previewBuildMock,
}));

const RUN_ID = "kma-daily-edit-run";

/**
 * The wizard edits an existing table's spec (#534 — creating one is /add). It opens on
 * the identity step once the spec has loaded.
 */
async function renderWizard() {
  const view = render(
    <MemoryRouter initialEntries={[`/refresh-jobs/${RUN_ID}/edit`]}>
      <Routes>
        <Route path="/refresh-jobs/:buildId/edit" element={<NewBuildPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "기본 정보" }, { timeout: 8000 });
  return view;
}

beforeEach(() => {
  clearBuildSpecs();
  saveBuildSpec(RUN_ID, {
    datasetId: "kma-daily",
    title: "기상청 일별",
    description: "일별 관측 데이터",
    sources: [{ provider: "datago", dataset: "air_quality", params: {} }],
    exports: [{ format: "jsonl" }],
    metadata: { outputPath: "artifacts/builds/kma-daily" },
  });
});

/** #490로 CatalogDataset에 추가된 필수 탐색 metadata의 최소 기본값(fixture 축약용). */
function catalogDataset(name: string, title: string, requiresServiceKey: boolean) {
  return {
    name,
    title,
    description: null,
    tags: [],
    source_url: null,
    representation: "api_json" as const,
    operations: [],
    query_support: null,
    requires_service_key: requiresServiceKey,
  };
}

function useCatalogFixture() {
  mswServer.use(
    http.get(`${API_BASE}/catalog`, () =>
      HttpResponse.json({
        providers: [
          {
            name: "datago",
            datasets: [catalogDataset("air_quality", "대기오염", true)],
          },
          {
            name: "bok",
            datasets: [catalogDataset("base_rate", "기준금리", false)],
          },
        ],
      }),
    ),
  );
}

async function goToPreviewStep() {
  await renderWizard();
  fireEvent.click(screen.getByRole("button", { name: "다음" }));

  await screen.findByRole("heading", { name: "데이터 소스" });
  fireEvent.change(screen.getByLabelText(/제공자/), { target: { value: "datago" } });
  fireEvent.change(screen.getByLabelText(/데이터셋/), { target: { value: "air-quality" } });
  fireEvent.click(screen.getByRole("button", { name: "다음" }));

  await screen.findByRole("heading", { name: "파라미터" });
  fireEvent.click(screen.getByRole("button", { name: "다음" }));

  await screen.findByRole("heading", { name: "미리보기" });
}

afterEach(() => {
  previewBuildMock.mockReset();
  clearBuildSpecs();
});

describe("Spec edit wizard", () => {
  it("opens on the identity step, with no template step (#534)", async () => {
    await renderWizard();
    expect(screen.queryByRole("heading", { name: "템플릿 선택" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/테이블 ID/)).toHaveValue("kma-daily");
    expect(screen.queryByText("템플릿")).not.toBeInTheDocument();
  });

  it("uses Builder catalog providers and datasets in the source selector", async () => {
    useCatalogFixture();
    await renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    await screen.findByRole("heading", { name: "데이터 소스" });
    fireEvent.change(screen.getByLabelText(/제공자/), { target: { value: "datago" } });

    await waitFor(() => expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).toHaveValue("air_quality"));
    expect(screen.getByRole("option", { name: /대기오염/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /population/ })).not.toBeInTheDocument();
  });

  it("blocks advancing while required fields are empty", async () => {
    await renderWizard();
    fireEvent.change(screen.getByLabelText(/테이블 ID/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    expect(await screen.findByText(/테이블 ID를 입력해주세요/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "기본 정보" })).toBeInTheDocument();
  });

  it("advances to the source step once identity fields are filled", async () => {
    await renderWizard();

    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(await screen.findByRole("heading", { name: "데이터 소스" })).toBeInTheDocument();
    expect(screen.getByLabelText(/제공자/)).toBeInTheDocument();
  });

  it("blocks the params step when the JSON is invalid", async () => {
    await renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    await screen.findByRole("heading", { name: "데이터 소스" });
    fireEvent.change(screen.getByLabelText(/제공자/), { target: { value: "datago" } });
    fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "air_quality" } });
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    await screen.findByRole("heading", { name: "파라미터" });
    fireEvent.change(screen.getByLabelText(/요청 파라미터/), { target: { value: "{not json" } });
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(await screen.findByText(/올바른 JSON이 아닙니다/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "파라미터" })).toBeInTheDocument();
  });

  it("shows source failure warnings beside successful preview rows (#235)", async () => {
    previewBuildMock.mockResolvedValue({
      rows: [{ id: "x" }],
      schema: { id: "string" },
      warnings: [{ sourceKey: "datago.air", error: "인증 실패" }],
    });

    await goToPreviewStep();
    fireEvent.click(screen.getByRole("button", { name: "미리보기 새로고침" }));

    expect(await screen.findByText("1개 샘플 행 · 1개 컬럼")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("datago.air: 인증 실패");
    expect(screen.queryByText("조건에 맞는 데이터가 없습니다")).not.toBeInTheDocument();
  });
});
