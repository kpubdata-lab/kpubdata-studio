/**
 * DiscoverPage (#249) — 정확 검색, provider 카드/필터(런타임 계산), requires_service_key
 * 배지/필터, Add Data Workbench로의 provider/dataset 전달, 빈/에러 상태를 확인한다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DiscoverPage } from "@/pages/DiscoverPage";
import * as discoverApi from "@/features/discover/api";
import type { CatalogResponse } from "@/shared/lib/builderApi";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

function renderDiscover() {
  return render(
    <MemoryRouter>
      <DiscoverPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  navigateMock.mockClear();
});

describe("DiscoverPage", () => {
  it("loads the mock catalog and renders dataset cards with provider labels and counts", async () => {
    renderDiscover();

    expect(await screen.findByText("대기오염 정보")).toBeInTheDocument();
    // provider select에 한글 라벨과 런타임 계산된 건수가 함께 표시된다(하드코딩 아님).
    expect(screen.getByRole("option", { name: /공공데이터포털 \(data\.go\.kr\) \(\d+개\)/ })).toBeInTheDocument();
  });

  it("shows the requires_service_key badge only on datasets that need one", async () => {
    renderDiscover();
    await screen.findByText("대기오염 정보");

    // air_quality: requires_service_key=true → 배지가 있어야 한다.
    const requiresKeyCard = screen.getByText("대기오염 정보").closest("[class*='rounded-xl']") as HTMLElement;
    expect(within(requiresKeyCard).getByText("서비스 키 필요")).toBeInTheDocument();

    // dur_product_info: requires_service_key=false → 배지가 없어야 한다.
    const noKeyCard = screen.getByText("DUR 품목정보").closest("[class*='rounded-xl']") as HTMLElement;
    expect(within(noKeyCard).queryByText("서비스 키 필요")).not.toBeInTheDocument();
  });

  it("filters by exact search query on dataset name/title/provider", async () => {
    renderDiscover();
    await screen.findByText("대기오염 정보");

    fireEvent.change(screen.getByLabelText("소스 데이터셋명·기관 검색"), { target: { value: "인구총조사" } });

    await waitFor(() => {
      expect(screen.queryByText("대기오염 정보")).not.toBeInTheDocument();
    });
    expect(screen.getByText("인구총조사")).toBeInTheDocument();
  });

  it("filters by provider", async () => {
    renderDiscover();
    await screen.findByText("대기오염 정보");

    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "seoul" } });

    await waitFor(() => {
      expect(screen.queryByText("대기오염 정보")).not.toBeInTheDocument();
    });
    expect(screen.getByText("따릉이 대여 현황")).toBeInTheDocument();
  });

  it("filters to only datasets that require a service key when the checkbox is checked", async () => {
    renderDiscover();
    await screen.findByText("대기오염 정보");

    fireEvent.click(screen.getByLabelText(/서비스 키 필요만/));

    await waitFor(() => {
      expect(screen.queryByText("DUR 품목정보")).not.toBeInTheDocument();
    });
    expect(screen.getByText("대기오염 정보")).toBeInTheDocument();
  });

  it("shows an empty-results state (distinct from the empty-catalog state) when no entry matches the filters", async () => {
    renderDiscover();
    await screen.findByText("대기오염 정보");

    fireEvent.change(screen.getByLabelText("소스 데이터셋명·기관 검색"), { target: { value: "존재하지-않는-데이터셋" } });

    expect(await screen.findByText("조건에 맞는 소스 데이터셋이 없습니다")).toBeInTheDocument();
  });

  it("navigates to /add with provider and dataset query params when starting from a card", async () => {
    renderDiscover();
    await screen.findByText("대기오염 정보");

    const startButtons = screen.getAllByRole("button", { name: "이 데이터로 시작하기" });
    fireEvent.click(startButtons[0]);

    expect(navigateMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/add\?provider=datago&dataset=/),
    );
  });

  it("shows a distinct empty state when the catalog itself has no providers", async () => {
    vi.spyOn(discoverApi, "loadCatalog").mockResolvedValue({ providers: [] } satisfies CatalogResponse);
    renderDiscover();

    expect(await screen.findByText("Engine 카탈로그가 비어 있습니다")).toBeInTheDocument();
  });

  it("shows an error state with retry when the catalog fails to load", async () => {
    vi.spyOn(discoverApi, "loadCatalog").mockRejectedValue(new Error("네트워크 오류"));
    renderDiscover();

    expect(await screen.findByText("카탈로그를 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.getByText("네트워크 오류")).toBeInTheDocument();
  });

  it("clears all filters via the reset button", async () => {
    renderDiscover();
    await screen.findByText("대기오염 정보");

    fireEvent.change(screen.getByLabelText("소스 데이터셋명·기관 검색"), { target: { value: "인구총조사" } });
    fireEvent.click(await screen.findByRole("button", { name: "필터 초기화" }));

    await waitFor(() => {
      expect(screen.getByLabelText("소스 데이터셋명·기관 검색")).toHaveValue("");
    });
    expect(await screen.findByText("대기오염 정보")).toBeInTheDocument();
  });
});
