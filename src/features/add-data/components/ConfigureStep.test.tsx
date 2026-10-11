/**
 * Configure step — credential prerequisite / readiness (#S-add-data,
 * #S-provider-probe) and required request parameter UX regression tests.
 *
 * The generic provider probe ("check provider connection" button) was removed as unreliable —
 * Create Table uses only authoritative prerequisite (requires credential AND
 * configured=false), and actual data availability is verified by Preview.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConfigureStep, type CatalogState } from "./ConfigureStep";
import { INITIAL_DRAFT, type AddDataDraft } from "@/features/add-data/model";
import type { CatalogProvider } from "@/shared/lib/builderApi";

const PROVIDERS: CatalogProvider[] = [
  {
    name: "datago",
    datasets: [
      {
        name: "air_quality",
        title: "대기오염",
        description: "측정망 시간자료",
        tags: [],
        source_url: null,
        representation: "api_json",
        operations: ["list"],
        query_support: null,
        requires_service_key: true,
        request_parameters: [
          { name: "sidoName", required: true, description: "조회할 시·도", example: "서울" },
          { name: "numOfRows", required: false, description: null, example: null },
        ],
        application: { required: true, url: "https://www.data.go.kr/data/15073861/openapi.do" },
      },
      {
        name: "air_station",
        title: "측정소별 대기측정",
        description: null,
        tags: [],
        source_url: null,
        representation: "api_json",
        operations: ["list"],
        query_support: null,
        requires_service_key: true,
        request_parameters: [{ name: "stationName", required: true, description: null, example: "백령도" }],
        query_parameters: [
          {
            name: "stationName",
            alias: "station",
            type: "string",
            required: true,
            enum: null,
            description: "측정소명",
            example: "백령도",
          },
          {
            name: "dataTerm",
            alias: "term",
            type: "string",
            required: true,
            enum: ["daily", "month", "3month"],
            description: "측정 기간",
            example: "daily",
          },
          { name: "base_date", alias: null, type: "date_yyyymmdd", required: false, enum: null, description: null, example: "20261012" },
          { name: "keyword", alias: null, type: null, required: false, enum: null, description: null, example: null },
        ],
      },
      {
        name: "no_definition",
        title: "정의 없음",
        description: null,
        tags: [],
        source_url: null,
        representation: "api_json",
        operations: ["list"],
        query_support: null,
        requires_service_key: true,
        request_parameters: [{ name: "sidoName", required: true, description: "조회할 시·도", example: "서울" }],
        query_parameters: null,
      },
      {
        name: "free_form",
        title: "자유입력",
        description: null,
        tags: [],
        source_url: null,
        representation: "api_json",
        operations: ["list"],
        query_support: null,
        requires_service_key: true,
        request_parameters: [],
      },
    ],
  },
];

function renderStep(overrides: {
  draft?: Partial<AddDataDraft>;
  providerConfigured?: Record<string, boolean> | null;
  updateDraft?: (patch: Partial<AddDataDraft>) => void;
  onConnectProvider?: (provider: string) => void;
}) {
  const draft: AddDataDraft = {
    ...INITIAL_DRAFT,
    sourceKind: "public_api",
    publicApi: { provider: "datago", dataset: "air_quality", sourceParams: "{}" },
    ...overrides.draft,
  };
  const catalog: CatalogState = { status: "loaded", providers: PROVIDERS };
  render(
    <ConfigureStep
      draft={draft}
      updateDraft={overrides.updateDraft ?? vi.fn()}
      catalog={catalog}
      upload={{ status: "idle" }}
      onUploadFile={vi.fn()}
      providerConfigured={overrides.providerConfigured ?? null}
      onConnectProvider={overrides.onConnectProvider ?? vi.fn()}
      yamlText=""
      onApplyYaml={vi.fn()}
    />,
  );
}

describe("ConfigureStep — remove generic provider probe", () => {
  it("No longer shows generic live probe button like 'Provider 연결 확인'", () => {
    renderStep({ providerConfigured: { datago: true } });
    expect(screen.queryByRole("button", { name: "Provider 연결 확인" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /연결 테스트/ })).not.toBeInTheDocument();
  });

  it("If provider is configured, shows auth ready status and Preview guide only", () => {
    renderStep({ providerConfigured: { datago: true } });
    expect(screen.getByText("인증 정보 준비됨")).toBeInTheDocument();
    expect(screen.getByText(/실제 데이터 인출 가능 여부는\s*다음 단계 미리보기에서 확인/)).toBeInTheDocument();
  });

  it("If configured status unknown (null), shows neither ready nor blocked", () => {
    renderStep({ providerConfigured: null });
    expect(screen.queryByText("인증 정보 준비됨")).not.toBeInTheDocument();
    expect(screen.queryByText("API 연결이 필요합니다")).not.toBeInTheDocument();
  });
});

describe("ConfigureStep — required request parameter UX", () => {
  it("Shows selected dataset metadata required params with examples", () => {
    renderStep({});
    expect(screen.getByText("이 소스 데이터셋의 요청 파라미터")).toBeInTheDocument();
    expect(screen.getByText("sidoName")).toBeInTheDocument();
    expect(screen.getByText("조회할 시·도", { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText(/예: 서울/).length).toBeGreaterThan(0);
    // Concrete example replaces generic example.
    expect(screen.getByText('예: {"sidoName":"서울"}')).toBeInTheDocument();
  });

  it("Dataset without metadata shows neutral example only, no required guide", () => {
    renderStep({
      draft: { publicApi: { provider: "datago", dataset: "free_form", sourceParams: "{}" } },
    });
    expect(screen.queryByText("이 소스 데이터셋의 요청 파라미터")).not.toBeInTheDocument();
    expect(screen.getByText('예: {"region": "seoul"}')).toBeInTheDocument();
  });

  it("Clicking example value button fills example values, doesn't overwrite existing input", () => {
    const updateDraft = vi.fn();
    renderStep({
      draft: { publicApi: { provider: "datago", dataset: "air_quality", sourceParams: '{"numOfRows":"10"}' } },
      updateDraft,
    });

    fireEvent.click(screen.getByRole("button", { name: "예시값 적용" }));

    expect(updateDraft).toHaveBeenCalledTimes(1);
    const patch = updateDraft.mock.calls[0][0] as { publicApi: { sourceParams: string } };
    const merged = JSON.parse(patch.publicApi.sourceParams) as Record<string, string>;
    expect(merged.sidoName).toBe("서울");
    expect(merged.numOfRows).toBe("10"); // Do not overwrite existing input value.
  });

  it("Dataset without example doesn't show example value apply button", () => {
    renderStep({
      draft: { publicApi: { provider: "datago", dataset: "free_form", sourceParams: "{}" } },
    });
    expect(screen.queryByRole("button", { name: "예시값 적용" })).not.toBeInTheDocument();
  });
});

describe("ConfigureStep — API connection credential prerequisite", () => {
  it("If credential required but provider not configured, blocks and guides", () => {
    const onConnectProvider = vi.fn();
    renderStep({ providerConfigured: { datago: false }, onConnectProvider });

    expect(screen.getByText("API 연결이 필요합니다")).toBeInTheDocument();
    expect(screen.getByText(/API Key가 필요한 제공자를 사용합니다/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "API 연결하기" }));
    expect(onConnectProvider).toHaveBeenCalledWith("datago");
  });

  it("If provider already configured, does not block", () => {
    renderStep({ providerConfigured: { datago: true } });
    expect(screen.queryByText("API 연결이 필요합니다")).not.toBeInTheDocument();
  });

  it("If configured status still unknown (null), does not guess and block", () => {
    renderStep({ providerConfigured: null });
    expect(screen.queryByText("API 연결이 필요합니다")).not.toBeInTheDocument();
  });
});

describe("ConfigureStep — dataset usage application guide", () => {
  it("Shows usage application guide and official page link if application.required", () => {
    renderStep({});
    expect(screen.getByText("데이터 활용신청을 확인해주세요")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /공식 페이지에서 확인/ });
    expect(link).toHaveAttribute("href", "https://www.data.go.kr/data/15073861/openapi.do");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("Dataset without application metadata doesn't show usage application guide", () => {
    renderStep({
      draft: { publicApi: { provider: "datago", dataset: "free_form", sourceParams: "{}" } },
    });
    expect(screen.queryByText("데이터 활용신청을 확인해주세요")).not.toBeInTheDocument();
  });
});

describe("ConfigureStep — parameter form from the query definition (#899)", () => {
  const station = (sourceParams: string, updateDraft = vi.fn()) => {
    renderStep({ draft: { publicApi: { provider: "datago", dataset: "air_station", sourceParams } }, updateDraft });
    return updateDraft;
  };
  const lastParams = (updateDraft: ReturnType<typeof vi.fn>) =>
    JSON.parse((updateDraft.mock.lastCall?.[0] as { publicApi: { sourceParams: string } }).publicApi.sourceParams) as Record<string, unknown>;

  it("draws an enum as a select of its values and writes the chosen one under the alias", () => {
    const updateDraft = station("{}");
    const select = screen.getByLabelText(/^term/);
    expect(select.tagName).toBe("SELECT");
    expect([...(select as HTMLSelectElement).options].map((o) => o.value)).toEqual(["", "daily", "month", "3month"]);
    fireEvent.change(select, { target: { value: "month" } });
    expect(lastParams(updateDraft)).toEqual({ term: "month" });
  });

  it("marks required fields, shows the description as help and the example as placeholder", () => {
    station("{}");
    const input = screen.getByLabelText(/^station/);
    expect(input).toHaveAttribute("placeholder", "백령도");
    expect(screen.getByText(/측정소명/)).toBeInTheDocument();
    expect(screen.getByText(/제공기관 이름: stationName/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^station/).closest("div")?.querySelector("label")).toHaveTextContent("(필수)");
    expect(screen.getByLabelText(/^keyword/).closest("div")?.querySelector("label")).not.toHaveTextContent("(필수)");
  });

  it("gives a typed parameter a matching input and flags a value in the wrong format", () => {
    station('{"base_date":"2026-10-12"}');
    const input = screen.getByLabelText(/^base_date/);
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByText(/YYYYMMDD 형식의 날짜/)).toBeInTheDocument();
  });

  it("does not invent a type for a parameter whose type is unknown", () => {
    station('{"keyword":"1-2 abc"}');
    const input = screen.getByLabelText(/^keyword/);
    expect(input).not.toHaveAttribute("inputmode");
    expect(input).toHaveValue("1-2 abc");
  });

  it("reads a saved spec's provider spelling and keeps the parameters the form does not list", () => {
    const updateDraft = station('{"stationName":"백령도","numOfRows":100}');
    const input = screen.getByLabelText(/^station/);
    expect(input).toHaveValue("백령도");
    fireEvent.change(input, { target: { value: "수내동" } });
    expect(lastParams(updateDraft)).toEqual({ station: "수내동", numOfRows: 100 });
  });

  it("keeps the JSON editor beside the fields, for parameters they do not list", () => {
    station("{}");
    expect(screen.getByLabelText("전체 요청 파라미터 (JSON)")).toBeInTheDocument();
    expect(screen.queryByText("이 소스 데이터셋의 요청 파라미터")).not.toBeInTheDocument();
  });

  it("falls back to the JSON editor and the old guidance when the definition is null", () => {
    renderStep({ draft: { publicApi: { provider: "datago", dataset: "no_definition", sourceParams: "{}" } } });
    expect(screen.queryByTestId("query-params-fields")).not.toBeInTheDocument();
    expect(screen.getByText("이 소스 데이터셋의 요청 파라미터")).toBeInTheDocument();
    expect(screen.getByLabelText("요청 파라미터 (JSON)")).toBeInTheDocument();
  });
});
