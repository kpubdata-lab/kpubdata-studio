import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewBuildPage } from "@/pages/NewBuildPage";
import { API_BASE } from "@/shared/config/env";
import { mswServer } from "../vitest.setup";

const { previewBuildMock } = vi.hoisted(() => ({
  previewBuildMock: vi.fn(),
}));

vi.mock("@/features/preview/api", () => ({
  previewBuild: previewBuildMock,
}));

function renderWizard() {
  return render(
    <MemoryRouter>
      <NewBuildPage />
    </MemoryRouter>,
  );
}

// 마법사는 템플릿 단계에서 시작한다(#11). 식별 단계로 넘어가는 헬퍼.
function skipTemplateStep() {
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
}

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
  renderWizard();
  skipTemplateStep();
  fireEvent.change(screen.getByLabelText(/데이터셋 ID/), { target: { value: "kma-daily" } });
  fireEvent.change(screen.getByLabelText(/제목/), { target: { value: "기상청 일별" } });
  fireEvent.change(screen.getByLabelText(/설명/), { target: { value: "일별 관측 데이터" } });
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
});

describe("New Build Wizard", () => {
  it("starts on the template step", () => {
    renderWizard();
    expect(screen.getByRole("heading", { name: "템플릿 선택" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /대기오염 정보/ })).toBeInTheDocument();
  });

  it("selecting a catalog-backed template prefills the current Builder dataset id", async () => {
    useCatalogFixture();
    renderWizard();
    await waitFor(() => expect(screen.getByRole("button", { name: /대기오염 정보/ })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /대기오염 정보/ }));

    expect(screen.getByRole("heading", { name: "기본 정보" })).toBeInTheDocument();
    expect(screen.getByLabelText(/데이터셋 ID/)).toHaveValue("datago-air-quality");
    skipTemplateStep();
    await screen.findByRole("heading", { name: "데이터 소스" });
    expect(screen.getByLabelText(/데이터셋 \(Dataset\)/)).toHaveValue("air_quality");
  });

  it("marks templates missing from Builder catalog unavailable", async () => {
    useCatalogFixture();
    renderWizard();

    await waitFor(() => expect(screen.getByRole("button", { name: /인구 통계/ })).toBeDisabled());
    expect(screen.getByRole("button", { name: /대기오염 정보/ })).toBeEnabled();
    expect(screen.getByText(/현재 Engine catalog에 없는 source/)).toBeInTheDocument();
  });

  it("uses Builder catalog providers and datasets in the source selector", async () => {
    useCatalogFixture();
    renderWizard();
    skipTemplateStep();
    fireEvent.change(screen.getByLabelText(/데이터셋 ID/), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText(/제목/), { target: { value: "Custom" } });
    fireEvent.change(screen.getByLabelText(/설명/), { target: { value: "Custom dataset" } });
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    await screen.findByRole("heading", { name: "데이터 소스" });
    fireEvent.change(screen.getByLabelText(/제공자/), { target: { value: "datago" } });

    await waitFor(() => expect(screen.getByLabelText(/데이터셋 \(Dataset\)/)).toHaveValue("air_quality"));
    expect(screen.getByRole("option", { name: /대기오염/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /population/ })).not.toBeInTheDocument();
  });

  it("blocks advancing while required fields are empty", async () => {
    renderWizard();
    skipTemplateStep(); // 템플릿 → 기본 정보
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    expect(await screen.findByText(/데이터셋 ID를 입력해주세요/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "기본 정보" })).toBeInTheDocument();
  });

  it("advances to the source step once identity fields are filled", async () => {
    renderWizard();
    skipTemplateStep();
    fireEvent.change(screen.getByLabelText(/데이터셋 ID/), { target: { value: "kma-daily" } });
    fireEvent.change(screen.getByLabelText(/제목/), { target: { value: "기상청 일별" } });
    fireEvent.change(screen.getByLabelText(/설명/), { target: { value: "일별 관측 데이터" } });

    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(await screen.findByRole("heading", { name: "데이터 소스" })).toBeInTheDocument();
    expect(screen.getByLabelText(/제공자/)).toBeInTheDocument();
  });

  it("blocks the params step when the JSON is invalid", async () => {
    renderWizard();
    skipTemplateStep();
    fireEvent.change(screen.getByLabelText(/데이터셋 ID/), { target: { value: "kma-daily" } });
    fireEvent.change(screen.getByLabelText(/제목/), { target: { value: "기상청 일별" } });
    fireEvent.change(screen.getByLabelText(/설명/), { target: { value: "일별 관측" } });
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    await screen.findByRole("heading", { name: "데이터 소스" });
    fireEvent.change(screen.getByLabelText(/제공자/), { target: { value: "datago" } });
    fireEvent.change(screen.getByLabelText(/데이터셋 \(Dataset\)/), { target: { value: "air_quality" } });
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
