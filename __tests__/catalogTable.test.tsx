/**
 * Catalog compares sources in a table (#529).
 *
 * Every cell comes from a Builder contract field — `CatalogDataset` for the source,
 * `DatasetSummary.sources` for the tables made from it. The UI never makes up an
 * institution name or licence terms (공공누리), and what the contract leaves out reads
 * as unknown, not as "no".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { DiscoverPage } from "@/pages/DiscoverPage";
import * as discoverApi from "@/features/discover/api";
import type { CatalogDataset, DatasetSummary } from "@/shared/lib/builderApi";

function renderDiscover(url = "/discover") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <DiscoverPage />
    </MemoryRouter>,
  );
}

const table = (dataset_id: string, sources: DatasetSummary["sources"]) =>
  ({ dataset_id, title: dataset_id, sources }) as unknown as DatasetSummary;

afterEach(() => vi.restoreAllMocks());

async function rowOf(title: string) {
  const cell = await screen.findByText(title);
  return cell.closest("tr") as HTMLElement;
}

describe("Catalog comparison table (#529)", () => {
  it("lays the sources out as rows under contract-only columns", async () => {
    renderDiscover();
    const grid = await screen.findByRole("table", { name: /소스 데이터셋 비교/ });
    const headers = within(grid)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual(["소스", "제공자", "형식", "지원 작업", "접근", "성숙도", "만든 테이블", "일일 호출 한도", "시작"]);
  });

  it("says what the contract says about access and quota, and unknown where it says nothing", async () => {
    renderDiscover();

    const air = await rowOf("대기오염 정보");
    expect(within(air).getByText("datago.air_quality")).toBeInTheDocument();
    expect(within(air).getByText("서비스 키 필요")).toBeInTheDocument();
    expect(within(air).getByRole("link", { name: /활용신청 필요/ })).toHaveAttribute(
      "href",
      "https://www.data.go.kr/data/15073861/openapi.do",
    );
    expect(within(air).getByText("개발계정 일 10,000건")).toBeInTheDocument();

    // No `application` and no `quota`: unknown — never "not needed" or 0.
    const apt = await rowOf("아파트 실거래가");
    expect(within(apt).getByText("활용신청 알 수 없음")).toBeInTheDocument();
    expect(within(apt).queryByText(/활용신청 불필요/)).not.toBeInTheDocument();
    expect(within(apt).getByTitle("Builder 카탈로그가 호출 한도를 알려 주지 않았습니다")).toHaveTextContent("—");

    const dur = await rowOf("DUR 품목정보");
    expect(within(dur).getByText("서비스 키 불필요")).toBeInTheDocument();
    expect(within(dur).getByText("활용신청 불필요")).toBeInTheDocument();

    // The catalog sends no maturity grade.
    expect(within(dur).getByText("알 수 없음")).toBeInTheDocument();
  });

  it("does not make up an institution name or licence terms", async () => {
    renderDiscover();
    await screen.findByText("대기오염 정보");
    const page = document.body.textContent ?? "";
    for (const invented of ["한국환경공단", "국토교통부", "기상청", "공공누리", "KOGL"]) {
      expect(page).not.toContain(invented);
    }
  });

  it("lists the tables made from a source, and says unknown when the list may be incomplete", async () => {
    vi.spyOn(discoverApi, "loadCreatedTables").mockResolvedValue({
      tables: [table("air-quality", [{ provider: "datago", dataset: "air_quality", alias: "air" }])],
      complete: false,
    });
    renderDiscover();

    const air = await rowOf("대기오염 정보");
    expect(await within(air).findByText("air-quality")).toBeInTheDocument();
    // Not found in a list that may be cut: unknown, not "none".
    const dur = await rowOf("DUR 품목정보");
    expect(within(dur).getByTitle("테이블 목록이 전부가 아니라 확인할 수 없습니다")).toHaveTextContent("—");
  });

  it("says none when the full list has no table from the source", async () => {
    vi.spyOn(discoverApi, "loadCreatedTables").mockResolvedValue({ tables: [], complete: true });
    renderDiscover();
    const dur = await rowOf("DUR 품목정보");
    expect(await within(dur).findByText("없음")).toBeInTheDocument();
  });

  it("filters to sources whose application is required", async () => {
    renderDiscover();
    await screen.findByText("대기오염 정보");
    fireEvent.click(screen.getByLabelText(/활용신청 필요만/));
    await waitFor(() => expect(screen.queryByText("DUR 품목정보")).not.toBeInTheDocument());
    expect(screen.queryByText("아파트 실거래가")).not.toBeInTheDocument();
    expect(screen.getByText("대기오염 정보")).toBeInTheDocument();
  });

  it("the wide table scrolls inside a focusable region, not the page", async () => {
    renderDiscover();
    const region = await screen.findByRole("region", { name: /소스 데이터셋 비교/ });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(within(region).getByRole("table")).toBeInTheDocument();
  });
});

describe("a source's format and supported operations (#670)", () => {
  const catalogWith = (representation: CatalogDataset["representation"], operations: CatalogDataset["operations"]) => ({
    providers: [
      {
        name: "datago",
        datasets: [
          {
            name: "probe",
            title: "형식 확인용 소스",
            description: null,
            tags: [],
            source_url: null,
            representation,
            operations,
            query_support: null,
            requires_service_key: false,
          },
        ],
      },
    ],
  });

  it("shows the representation and each supported operation from the catalog response", async () => {
    vi.spyOn(discoverApi, "loadCatalog").mockResolvedValue(catalogWith("file_csv", ["list", "schema", "download"]));
    renderDiscover();

    const row = await rowOf("형식 확인용 소스");
    const cells = within(row).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("CSV 파일");
    expect(within(cells[2]).getByTitle("file_csv")).toBeInTheDocument();
    const operations = within(cells[3]).getAllByRole("listitem").map((item) => item.textContent);
    expect(operations).toEqual(["목록 조회", "스키마", "파일 다운로드"]);
  });

  it("reads an empty operations list as no information, never as nothing supported", async () => {
    vi.spyOn(discoverApi, "loadCatalog").mockResolvedValue(catalogWith("api_xml", []));
    renderDiscover();

    const row = await rowOf("형식 확인용 소스");
    const cells = within(row).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("API 응답 (XML)");
    const none = within(cells[3]).getByText("지원 작업 정보 없음");
    expect(none).toHaveAttribute("data-status", "unknown");
    expect(within(cells[3]).queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("reads an unmapped representation (`other`) as unknown", async () => {
    vi.spyOn(discoverApi, "loadCatalog").mockResolvedValue(catalogWith("other", ["raw"]));
    renderDiscover();

    const row = await rowOf("형식 확인용 소스");
    const cells = within(row).getAllByRole("cell");
    expect(within(cells[2]).getByText("분류되지 않은 형식")).toHaveAttribute("data-status", "unknown");
    expect(within(cells[3]).getByText("원본 응답")).toBeInTheDocument();
  });
});
