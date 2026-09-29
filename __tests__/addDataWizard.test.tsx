/**
 * Add Data Workbench 통합 테스트 (#250).
 *
 * Source → Configure → Preview & Validate → Review & Build 전체 흐름을 mock 모드
 * (네트워크 없이 각 feature module의 결정적 mock 분기)로, 그리고 amendment
 * 1/3(제출 spec == Review 표시 spec, 실제 run_id 사용)은 real 모드 + MSW로 검증한다.
 *
 * #250 최종 마감(amendment 2)에서는 테이블 ID/제목/설명을 매번 수동 입력하지 않고
 * provider/dataset 선택·파일 업로드·URL 입력으로부터 자동 생성되는 흐름을 정본으로
 * 삼는다 — `fillIdentity()`는 "고급 설정에서 자동 생성값을 수정하는" 시나리오에서만
 * 쓰고, 기본 happy path는 자동 생성값 그대로 다음 단계까지 진행 가능함을 검증한다.
 */
import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddDataPage } from "@/pages/AddDataPage";
import { API_BASE } from "@/shared/config/env";
import { mswServer } from "../vitest.setup";

function BuildDetailStub() {
  const { buildId } = useParams();
  return <div>Build 상세: run={buildId}</div>;
}

function renderWizard(initialEntries: string[] = ["/add"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/add" element={<AddDataPage />} />
        <Route path="/builds/:buildId" element={<BuildDetailStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * 실제 진입점(`src/main.tsx`)처럼 StrictMode로 감싼다 — setState updater가 두 번
 * 호출되는 조건에서도 회귀하지 않는지 검증하기 위함(#S-stale-params).
 */
function renderWizardStrict(initialEntries: string[] = ["/add"]) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/add" element={<AddDataPage />} />
          <Route path="/builds/:buildId" element={<BuildDetailStub />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

function next() {
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
}

/** 고급 설정 collapsible을 열고 테이블 ID/제목/설명을 직접 덮어쓴다("touched" 시나리오 전용). */
async function overrideIdentityInAdvancedSettings(values: { datasetId?: string; title?: string; description?: string }) {
  if (values.datasetId !== undefined) {
    fireEvent.change(screen.getByLabelText(/테이블 ID/), { target: { value: values.datasetId } });
  }
  if (values.title !== undefined) {
    fireEvent.change(screen.getByLabelText(/^제목/), { target: { value: values.title } });
  }
  if (values.description !== undefined) {
    fireEvent.change(screen.getByLabelText(/설명/), { target: { value: values.description } });
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe("Add Data Workbench — Source 선택 (#250)", () => {
  it("Source를 선택하지 않으면 다음 단계로 넘어가지 않는다", () => {
    renderWizard();
    expect(screen.getByRole("heading", { name: "데이터 선택" })).toBeInTheDocument();
    next();
    expect(screen.getByRole("heading", { name: "데이터 선택" })).toBeInTheDocument();
  });
});

describe("Add Data Workbench — Public API happy path (mock 모드, #250 amendment 2)", () => {
  it("테이블 ID/제목/설명을 직접 입력하지 않아도 Provider→소스 데이터셋 선택만으로 Build까지 진행된다", async () => {
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: /Public API/ }));
    next();
    await screen.findByText("API 사용 준비");

    // mock catalog는 provider "datago" / dataset "apt_trade"를 제공한다(features/add-data/api.ts).
    fireEvent.change(screen.getByLabelText(/제공자 \(Provider\)/), { target: { value: "datago" } });
    await waitFor(() => expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "apt_trade" } });

    // 자동 생성된 identity가 요약 카드에 반영된다 — 별도 입력 없이 진행 가능.
    await screen.findByText("아파트 실거래가");
    expect(screen.getByText(/ID: datago-apt-trade/)).toBeInTheDocument();

    next();
    await screen.findByRole("heading", { name: "Preview · 검증" });
    fireEvent.click(screen.getByRole("button", { name: "Preview 새로고침" }));
    await waitFor(() => expect(screen.getAllByText(/./).length).toBeGreaterThan(0));

    next();
    await screen.findByRole("heading", { name: "검토 · 테이블 만들기" });
    expect(screen.getByText(/실제 제출될 canonical BuildSpec/)).toBeInTheDocument();
    expect(screen.getByText(/"dataset_id": "datago-apt-trade"/)).toBeInTheDocument();
    expect(screen.getByText(/"title": "아파트 실거래가"/)).toBeInTheDocument();

    const buildButton = await screen.findByRole("button", { name: "테이블 만들기" });
    await waitFor(() => expect(buildButton).toBeEnabled());
    fireEvent.click(buildButton);

    await screen.findByText("Build 상세: run=mock-run");
  });

  it("dataset 선택을 바꾸면 자동 생성된 metadata도 함께 갱신된다", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Public API/ }));
    next();
    await screen.findByText("API 사용 준비");

    fireEvent.change(screen.getByLabelText(/제공자 \(Provider\)/), { target: { value: "datago" } });
    await waitFor(() => expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "apt_trade" } });
    await screen.findByText(/ID: datago-apt-trade/);

    // 다른 provider/dataset 조합이 없는 mock catalog이므로 동일 선택을 다시 하고,
    // provider를 비웠다 다시 고르는 경로로 재생성이 일어나는지 확인한다.
    fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "apt_trade" } });
    await screen.findByText(/ID: datago-apt-trade/);
  });

  it("고급 설정에서 자동 생성값을 수정하면 그 값이 실제 제출에 반영된다", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Public API/ }));
    next();
    await screen.findByText("API 사용 준비");
    fireEvent.change(screen.getByLabelText(/제공자 \(Provider\)/), { target: { value: "datago" } });
    await waitFor(() => expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "apt_trade" } });
    await screen.findByText(/ID: datago-apt-trade/);

    await overrideIdentityInAdvancedSettings({ datasetId: "custom-id", title: "커스텀 제목" });

    next();
    await screen.findByRole("heading", { name: "Preview · 검증" });
    fireEvent.click(screen.getByRole("button", { name: "Preview 새로고침" }));
    await waitFor(() => expect(screen.getAllByText(/./).length).toBeGreaterThan(0));
    next();
    await screen.findByRole("heading", { name: "검토 · 테이블 만들기" });
    expect(screen.getByText(/"dataset_id": "custom-id"/)).toBeInTheDocument();
    expect(screen.getByText(/"title": "커스텀 제목"/)).toBeInTheDocument();
  });
});

describe("Add Data Workbench — touched metadata 정책 (#250 최종 검증 §1)", () => {
  it("metadata 수동 수정 후 query params만 바꾸면 수정값이 유지된다(같은 dataset의 세부 설정 변경)", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Public API/ }));
    next();
    await screen.findByText("API 사용 준비");
    fireEvent.change(screen.getByLabelText(/제공자 \(Provider\)/), { target: { value: "datago" } });
    await waitFor(() => expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "apt_trade" } });
    await screen.findByText(/ID: datago-apt-trade/);

    await overrideIdentityInAdvancedSettings({ datasetId: "custom-id", title: "커스텀 제목" });
    fireEvent.change(screen.getByLabelText(/요청 파라미터/), { target: { value: '{"region":"busan"}' } });

    // dataset 자체는 그대로이므로 수동 수정값이 유지되어야 한다.
    expect(screen.getByText(/ID: custom-id/)).toBeInTheDocument();
    expect(screen.getByText("커스텀 제목")).toBeInTheDocument();
  });

  it("metadata 수동 수정 후 dataset을 바꾸면 touched가 reset되고 새 dataset metadata가 적용된다", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Public API/ }));
    next();
    await screen.findByText("API 사용 준비");
    // catalog option이 실제 DOM에 나타날 때까지 기다린 뒤에 provider를 선택한다
    // (Node 20 CI에서 catalog fetch가 아직 준비되지 않아 dataset select가 disabled로
    // 남아 timeout하던 문제 수정, #283 CI #342 §8) — 같은 파일의 mixed preview
    // 테스트에 이미 쓰인 패턴을 그대로 재사용한다.
    await screen.findByRole("option", { name: "datago" });
    fireEvent.change(screen.getByLabelText(/제공자 \(Provider\)/), { target: { value: "datago" } });
    await waitFor(() => expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "apt_trade" } });
    await screen.findByText(/ID: datago-apt-trade/);

    await overrideIdentityInAdvancedSettings({ datasetId: "custom-id", title: "커스텀 제목" });
    expect(screen.getByText(/ID: custom-id/)).toBeInTheDocument();

    // 다른 dataset(air_quality)으로 교체 — 이전 custom metadata가 잔존하면 안 된다.
    fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "air_quality" } });
    await screen.findByText(/ID: datago-air-quality/);
    expect(screen.getByText("대기오염 측정망")).toBeInTheDocument();
    expect(screen.queryByText(/ID: custom-id/)).not.toBeInTheDocument();
    expect(screen.queryByText("커스텀 제목")).not.toBeInTheDocument();
  });

  it("파일을 다른 파일로 교체하면 touched가 reset되고 새 filename identity가 적용된다", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /File Upload/ }));
    next();
    await screen.findByText("파일 업로드");
    fireEvent.change(screen.getByLabelText(/Format/), { target: { value: "csv" } });

    const first = new File(["a,b\n1,2"], "first-file.csv", { type: "text/csv" });
    const input = screen.getByLabelText(/파일/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [first] } });
    await screen.findByText(/ID: first-file/);

    await overrideIdentityInAdvancedSettings({ datasetId: "custom-id", title: "커스텀 제목" });
    expect(screen.getByText(/ID: custom-id/)).toBeInTheDocument();

    const replacement = new File(["c,d\n3,4"], "second-file.csv", { type: "text/csv" });
    fireEvent.change(input, { target: { files: [replacement] } });
    await screen.findByText(/ID: second-file/);
    expect(screen.queryByText(/ID: custom-id/)).not.toBeInTheDocument();
    expect(screen.queryByText("커스텀 제목")).not.toBeInTheDocument();
  });

  it("URL endpoint의 hostname/path가 바뀌면(다른 endpoint로 교체) touched가 reset되고 새 identity가 적용된다", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /URL \/ REST API/ }));
    next();
    await screen.findByText("URL / REST API");

    fireEvent.change(screen.getByLabelText(/Endpoint/), { target: { value: "https://api.example.org/v1/air-quality" } });
    await screen.findByText(/ID: api-example-org-v1-air-quality/);

    await overrideIdentityInAdvancedSettings({ datasetId: "custom-id", title: "커스텀 제목" });
    expect(screen.getByText(/ID: custom-id/)).toBeInTheDocument();

    // 같은 endpoint의 query string만 바꾸면(같은 hostname/path) 수정값이 유지된다.
    fireEvent.change(screen.getByLabelText(/Endpoint/), {
      target: { value: "https://api.example.org/v1/air-quality?region=busan" },
    });
    expect(screen.getByText(/ID: custom-id/)).toBeInTheDocument();

    // hostname/path 자체가 바뀌면(다른 endpoint로 교체) touched가 reset된다.
    fireEvent.change(screen.getByLabelText(/Endpoint/), { target: { value: "https://api.example.org/v2/weather" } });
    await screen.findByText(/ID: api-example-org-v2-weather/);
    expect(screen.queryByText(/ID: custom-id/)).not.toBeInTheDocument();
    expect(screen.queryByText("커스텀 제목")).not.toBeInTheDocument();
  });

  it("source kind를 바꾸면 이전 source의 metadata가 잔존하지 않는다", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Public API/ }));
    next();
    await screen.findByText("API 사용 준비");
    fireEvent.change(screen.getByLabelText(/제공자 \(Provider\)/), { target: { value: "datago" } });
    await waitFor(() => expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "apt_trade" } });
    await screen.findByText(/ID: datago-apt-trade/);
    await overrideIdentityInAdvancedSettings({ datasetId: "custom-id", title: "커스텀 제목" });

    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    fireEvent.click(screen.getByRole("button", { name: /URL \/ REST API/ }));
    next();
    await screen.findByText("URL / REST API");

    expect(screen.queryByText(/ID: custom-id/)).not.toBeInTheDocument();
    expect(screen.queryByText("커스텀 제목")).not.toBeInTheDocument();
    expect(screen.getByText(/Endpoint를 입력하면 테이블 ID\/제목이 자동으로 채워집니다\./)).toBeInTheDocument();
  });
});

describe("Add Data Workbench — Dataset 변경 시 요청 파라미터 초기화", () => {
  const paramsField = () => screen.getByLabelText(/요청 파라미터/) as HTMLTextAreaElement;

  async function gotoConfigurePublicApi(renderFn: typeof renderWizard = renderWizard) {
    const result = renderFn();
    fireEvent.click(screen.getByRole("button", { name: /Public API/ }));
    next();
    await screen.findByText("API 사용 준비");
    await screen.findByRole("option", { name: "datago" });
    fireEvent.change(screen.getByLabelText(/제공자 \(Provider\)/), { target: { value: "datago" } });
    await waitFor(() => expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).not.toBeDisabled());
    return result;
  }

  function selectDataset(name: string) {
    fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: name } });
  }

  function selectProvider(name: string) {
    fireEvent.change(screen.getByLabelText(/제공자 \(Provider\)/), { target: { value: name } });
  }

  async function pickAirQualityWithExample() {
    selectDataset("air_quality");
    await screen.findByText(/ID: datago-air-quality/);
    fireEvent.click(screen.getByRole("button", { name: "예시값 적용" }));
    await waitFor(() => expect(paramsField().value).toContain("sidoName"));
    expect(paramsField().value).toContain("서울");
    expect(screen.getByText("이 소스 데이터셋의 요청 파라미터")).toBeInTheDocument();
  }

  it("Case 1 — 다른 Dataset을 고르면 이전 Dataset 전용 요청 파라미터가 `{}`로 초기화된다", async () => {
    await gotoConfigurePublicApi();
    await pickAirQualityWithExample();

    // 다른 Dataset(apt_trade)으로 교체 — canonical Dataset selection 변경.
    selectDataset("apt_trade");
    await screen.findByText(/ID: datago-apt-trade/);

    expect(paramsField().value).toBe("{}");
    expect(screen.queryByText(/sidoName/)).not.toBeInTheDocument();
    expect(screen.queryByText(/서울/)).not.toBeInTheDocument();
    // air_quality 전용 required-param 안내도 사라진다(apt_trade는 metadata 없음).
    expect(screen.queryByText("이 소스 데이터셋의 요청 파라미터")).not.toBeInTheDocument();
  });

  it("Case 1b — 실제 진입점처럼 StrictMode로 감싸도 요청 파라미터가 `{}`로 초기화된다", async () => {
    // 이전 수정(identity useEffect의 sourceChanged 분기에서 reset)이 브라우저에서
    // 실패한 조건 재현: StrictMode에서 setDraft updater가 두 번 호출되면, ref를
    // mutate하는 effect updater는 두 번째 호출에서 sourceChanged=false가 되어
    // reset 결과가 버려졌다. select onChange의 atomic reset은 여기서도 성립한다.
    await gotoConfigurePublicApi(renderWizardStrict);
    await pickAirQualityWithExample();

    selectDataset("apt_trade");
    await screen.findByText(/ID: datago-apt-trade/);

    expect(paramsField().value).toBe("{}");
    expect(screen.queryByText(/서울/)).not.toBeInTheDocument();
  });

  it("Case 1c — Provider를 실제로 바꾸면 dataset과 요청 파라미터가 같은 update에서 비워진다", async () => {
    await gotoConfigurePublicApi();
    await pickAirQualityWithExample();

    // Provider selection을 실제로 바꾼다(datago -> 미선택). dataset도 무효가 되므로
    // sourceParams가 같은 update에서 "{}"로 비워져야 한다.
    selectProvider("");
    expect(paramsField().value).toBe("{}");
    expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).toHaveValue("");

    // 다시 datago -> air_quality를 골라도 이전 "서울" 값이 되살아나지 않는다.
    selectProvider("datago");
    await waitFor(() => expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).not.toBeDisabled());
    selectDataset("air_quality");
    await screen.findByText(/ID: datago-air-quality/);
    expect(paramsField().value).toBe("{}");
  });

  it("Case 2 — 같은 Dataset에서 Preview로 갔다 Configure로 돌아오면 요청 파라미터가 유지된다", async () => {
    await gotoConfigurePublicApi();

    selectDataset("air_quality");
    await screen.findByText(/ID: datago-air-quality/);
    fireEvent.change(paramsField(), { target: { value: '{"sidoName":"부산"}' } });

    next(); // Configure -> Preview
    await screen.findByRole("heading", { name: "Preview · 검증" });
    fireEvent.click(screen.getByRole("button", { name: "이전" })); // Preview -> Configure
    await screen.findByText("API 사용 준비");

    expect(paramsField().value).toBe('{"sidoName":"부산"}');
  });

  it("Case 3 — 초안 저장/복원으로 같은 Dataset이 되돌아오면 요청 파라미터가 유지된다", async () => {
    const first = await gotoConfigurePublicApi();
    selectDataset("air_quality");
    await screen.findByText(/ID: datago-air-quality/);
    fireEvent.change(paramsField(), { target: { value: '{"sidoName":"부산"}' } });
    fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));
    first.unmount();

    renderWizard();
    fireEvent.click(await screen.findByRole("button", { name: "불러오기" }));
    fireEvent.click(screen.getByRole("button", { name: /Public API/ }));
    next();
    await screen.findByText("API 사용 준비");
    await screen.findByText(/ID: datago-air-quality/);

    expect(paramsField().value).toBe('{"sidoName":"부산"}');
    expect(screen.getByText("이 소스 데이터셋의 요청 파라미터")).toBeInTheDocument();
  });

  it("Case 4 — 새 Dataset도 metadata가 있으면 초기화된 값 위에 새 Dataset metadata가 렌더된다", async () => {
    await gotoConfigurePublicApi();

    // apt_trade(요청 파라미터 metadata 없음) → air_quality(sidoName 필수).
    selectDataset("apt_trade");
    await screen.findByText(/ID: datago-apt-trade/);
    fireEvent.change(paramsField(), { target: { value: '{"legacyParam":"stale"}' } });

    selectDataset("air_quality");
    await screen.findByText(/ID: datago-air-quality/);

    expect(paramsField().value).toBe("{}");
    expect(screen.queryByText(/legacyParam/)).not.toBeInTheDocument();
    // 새 Dataset(air_quality)의 metadata가 표시된다.
    expect(screen.getByText("이 소스 데이터셋의 요청 파라미터")).toBeInTheDocument();
    expect(screen.getByText("sidoName")).toBeInTheDocument();
    expect(screen.getByText('예: {"sidoName":"서울"}')).toBeInTheDocument();
  });
});

describe("Add Data Workbench — YAML Apply explicit metadata (#283 후속 리뷰 §6)", () => {
  it("YAML Apply로 넣은 custom dataset_id/title/description이 identity effect에 덮이지 않고, 그 뒤 실제 GUI dataset 선택에서는 touched가 reset된다", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Public API/ }));
    next();
    await screen.findByText("API 사용 준비");
    await screen.findByRole("option", { name: "datago" });
    fireEvent.change(screen.getByLabelText(/제공자 \(Provider\)/), { target: { value: "datago" } });
    await waitFor(() => expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "apt_trade" } });
    // lastIdentitySourceRef가 "public_api:datago:apt_trade"로 세팅된 상태를 만든다.
    await screen.findByText(/ID: datago-apt-trade/);

    // Canonical BuildSpec 패널을 열고 YAML 모드로 전환한다.
    fireEvent.click(screen.getByText("Canonical BuildSpec (GUI ↔ YAML)"));
    fireEvent.click(screen.getByRole("button", { name: "YAML" }));

    // dataset 자체를 air_quality로 바꾸면서(=provider/dataset 변경) custom metadata를
    // 명시적으로 지정한다 — lastIdentitySourceRef 동기화가 없으면 sourceChanged 경로가
    // 타서 이 custom metadata를 catalog identity로 즉시 덮어써 버린다.
    const customSpec = {
      dataset_id: "custom-id",
      title: "Custom title",
      description: "Custom description",
      sources: [{ provider: "datago", dataset: "air_quality" }],
      exports: [{ kind: "jsonl", output_path: "artifacts/builds/custom-id/data.jsonl" }],
      metadata: {},
    };
    const applyButton = screen.getByRole("button", { name: "YAML 적용" });
    const yamlPanel = applyButton.closest("div")!;
    const textarea = within(yamlPanel).getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: JSON.stringify(customSpec) } });
    fireEvent.click(applyButton);

    // React effect가 모두 반영된 뒤에도 custom metadata가 그대로 유지되어야 한다.
    await screen.findByText(/ID: custom-id/);
    expect(screen.getByText("Custom title")).toBeInTheDocument();
    expect(screen.queryByText(/ID: datago-air-quality/)).not.toBeInTheDocument();

    // 폼 모드로 돌아가 실제 GUI에서 다른 dataset을 선택하면 touched가 reset되고 새
    // catalog identity가 적용되어야 한다(기존 touched 정책 회귀 없음).
    fireEvent.click(screen.getByRole("button", { name: "Form" }));
    fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "apt_trade" } });
    await screen.findByText(/ID: datago-apt-trade/);
    expect(screen.getByText("아파트 실거래가")).toBeInTheDocument();
    expect(screen.queryByText(/ID: custom-id/)).not.toBeInTheDocument();
    expect(screen.queryByText("Custom title")).not.toBeInTheDocument();
  });
});

describe("Add Data Workbench — stale preview (#250 §2/§6)", () => {
  it("Preview 이후 source 설정이 바뀌면 Review에서 Build가 막힌다", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Public API/ }));
    next();
    await screen.findByText("API 사용 준비");
    fireEvent.change(screen.getByLabelText(/제공자 \(Provider\)/), { target: { value: "datago" } });
    await waitFor(() => expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "apt_trade" } });
    next();
    await screen.findByRole("heading", { name: "Preview · 검증" });
    fireEvent.click(screen.getByRole("button", { name: "Preview 새로고침" }));
    next();
    await screen.findByRole("heading", { name: "검토 · 테이블 만들기" });
    await waitFor(() => expect(screen.getByRole("button", { name: "테이블 만들기" })).toBeEnabled());

    // Configure로 돌아가 파라미터를 바꾼다 — 이전 Preview/Validation은 stale이어야 한다.
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    await screen.findByText("API 사용 준비");
    fireEvent.change(screen.getByLabelText(/요청 파라미터/), { target: { value: '{"region":"busan"}' } });
    next();
    next();
    await screen.findByRole("heading", { name: "검토 · 테이블 만들기" });

    expect(screen.getByRole("button", { name: "테이블 만들기" })).toBeDisabled();
    expect(screen.getByText(/이전 Preview·Validation 결과를 재사용할 수 없습니다/)).toBeInTheDocument();
  });
});

describe("Add Data Workbench — File source (#250, #498, amendment 2)", () => {
  it("파일 업로드 성공만으로 dataset identity가 자동 생성되고 별도 입력 없이 Build까지 진행된다", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /File Upload/ }));
    next();
    await screen.findByText("파일 업로드");

    fireEvent.change(screen.getByLabelText(/Format/), { target: { value: "csv" } });
    const file = new File(["a,b\n1,2"], "2026 Apt Trades.csv", { type: "text/csv" });
    const input = screen.getByLabelText(/파일/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await screen.findByText(/업로드 완료/);
    // filename 기반 deterministic dataset_id/title이 자동 반영된다.
    await screen.findByText(/ID: 2026-apt-trades/);
    expect(screen.getByText("2026 Apt Trades")).toBeInTheDocument();

    next();
    await screen.findByRole("heading", { name: "Preview · 검증" });
    next();
    await screen.findByRole("heading", { name: "검토 · 테이블 만들기" });
    expect(screen.getByText(/"kind": "file"/)).toBeInTheDocument();
    expect(screen.getByText(/"dataset_id": "2026-apt-trades"/)).toBeInTheDocument();
  });
});

describe("Add Data Workbench — URL source (#250, #498, Auth=None, amendment 2)", () => {
  it("https endpoint 입력만으로 dataset identity가 자동 생성되고 query string은 identity에 포함되지 않는다", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /URL \/ REST API/ }));
    next();
    await screen.findByText("URL / REST API");

    expect(screen.getByLabelText(/인증 \(Auth\)/)).toHaveValue("없음 (Auth=None)");
    expect(screen.getByLabelText(/인증 \(Auth\)/)).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Endpoint/), {
      target: { value: "https://api.example.org/v1/air-quality?region=busan" },
    });

    const summaryId = await screen.findByText(/ID: api-example-org-v1-air-quality/);
    // dataset identity(ID/제목)에는 query string이 새어 들어가지 않는다 — endpoint 필드
    // 자체에는 물론 그대로 남는다(Builder SourceRef.endpoint는 원문을 그대로 받는다).
    expect(within(summaryId.closest("div")!).queryByText(/busan/i)).not.toBeInTheDocument();

    next();
    await screen.findByRole("heading", { name: "Preview · 검증" });
    next();
    await screen.findByRole("heading", { name: "검토 · 테이블 만들기" });
    expect(screen.getByText(/"kind": "url"/)).toBeInTheDocument();
    // 비민감 query parameter는 canonical BuildSpec preview에 그대로 보인다.
    expect(screen.getByText(/"endpoint": "https:\/\/api\.example\.org\/v1\/air-quality\?region=busan"/)).toBeInTheDocument();
    expect(screen.getByText(/"dataset_id": "api-example-org-v1-air-quality"/)).toBeInTheDocument();
  });

  it("secret query parameter는 Review DOM(canonical BuildSpec preview 포함)에서 가려진다 (#283 리뷰 대응, Epic #246)", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /URL \/ REST API/ }));
    next();
    await screen.findByText("URL / REST API");

    fireEvent.change(screen.getByLabelText(/Endpoint/), {
      target: { value: "https://api.example.org/v1/air-quality?token=SECRETVALUE1234567890" },
    });

    await screen.findByText(/ID: api-example-org-v1-air-quality/);

    next();
    await screen.findByRole("heading", { name: "Preview · 검증" });
    next();
    await screen.findByRole("heading", { name: "검토 · 테이블 만들기" });

    // 원문 secret은 화면 어디에도(Source summary/canonical BuildSpec preview) 나타나지 않는다.
    expect(document.body.textContent ?? "").not.toContain("SECRETVALUE1234567890");
    expect(
      screen.getByText(/"endpoint": "https:\/\/api\.example\.org\/v1\/air-quality\?token=__KPD_URL_SECRET_REDACTED__"/),
    ).toBeInTheDocument();
  });
});

describe("Add Data Workbench — mixed/partial preview (#250 §3)", () => {
  it("previews.length > 1일 때 첫 source만 표시하고 나머지를 버리지 않으며, mixed 상태를 명확히 표시한다", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    mswServer.use(
      http.post(`${API_BASE}/preview`, () => {
        return HttpResponse.json({
          dataset_id: "mixed-dataset",
          previews: [
            {
              source_key: "ok-source",
              status: "ok",
              error: null,
              schema: [{ name: "region", dtype: "string", nullable: false, unique_count: 1 }],
              sample: [{ region: "서울" }],
              total_rows: 1,
              statistics: { row_count: 1, null_counts: { region: 0 }, duplicate_rate: 0 },
              quality_results: [
                {
                  source_key: "ok-source",
                  category: "missing",
                  rule: "max_null_ratio",
                  column: null,
                  status: "pass",
                  actual: 0,
                  threshold: null,
                  affected_rows: null,
                  evaluated_rows: null,
                  detail: null,
                },
              ],
              source_sample: [{ region: "서울" }],
              sample_mode: "first",
              diff_available: false,
              diffs: [],
              transform_summary: null,
              diff_truncated: false,
            },
            {
              source_key: "failed-source",
              status: "failed",
              error: "provider timeout",
              schema: [],
              sample: [],
              total_rows: 0,
              statistics: { row_count: 0, null_counts: {}, duplicate_rate: 0 },
              quality_results: [],
              source_sample: [],
              sample_mode: "first",
              diff_available: false,
              diffs: [],
              transform_summary: null,
              diff_truncated: false,
            },
          ],
        });
      }),
    );

    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Public API/ }));
    next();
    await screen.findByText("API 사용 준비");
    // "제공자 연결" 텍스트 렌더는 catalog loaded를 보장하지 않는다 — catalog option이
    // 실제 DOM에 나타날 때까지 기다린 뒤에 provider를 선택한다(test race 수정).
    await screen.findByRole("option", { name: "datago" });
    fireEvent.change(screen.getByLabelText(/제공자 \(Provider\)/), { target: { value: "datago" } });
    await waitFor(() => expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "air_quality" } });

    next();
    await screen.findByRole("heading", { name: "Preview · 검증" });
    fireEvent.click(screen.getByRole("button", { name: "Preview 새로고침" }));

    // 두 source 모두 tab으로 보인다 — 첫 source만 남기고 버리지 않는다.
    const okTab = await screen.findByRole("tab", { name: /ok-source/ });
    const failedTab = await screen.findByRole("tab", { name: /failed-source/ });
    expect(okTab).toBeInTheDocument();
    expect(failedTab).toBeInTheDocument();
    expect(screen.getByText(/Mixed 결과/)).toBeInTheDocument();

    // 실패 source를 선택하면 실패 상태가 보이고(0-row와 다른 문구), 성공 source의
    // sample이 조용히 대체 표시되지 않는다.
    fireEvent.click(failedTab);
    expect(screen.getByText(/소스 조회에 실패했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/provider timeout/)).toBeInTheDocument();

    fireEvent.click(okTab);
    expect(screen.getByText("서울")).toBeInTheDocument();

    next();
    await screen.findByRole("heading", { name: "검토 · 테이블 만들기" });
    // Review에도 source별 상태가 남아 있다 — 하나의 PASS로 뭉개지지 않는다.
    const reviewSection = screen.getByText("Source별 Preview/Validation").closest("div")!;
    expect(within(reviewSection).getByText("ok-source")).toBeInTheDocument();
    expect(within(reviewSection).getByText("failed-source")).toBeInTheDocument();
    expect(screen.getAllByText(/Mixed/).length).toBeGreaterThan(0);
  });
});

describe("Add Data Workbench — Review == submission, 실제 run_id 사용 (real 모드, amendment 1·3)", () => {
  it("Review에 표시된 BuildSpec과 실제 Builder에 제출되는 spec이 동일하고, 성공 시 서버가 반환한 run_id로 이동한다(client가 만든 후보 id가 아님)", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");

    let capturedSpec: unknown = null;
    mswServer.use(
      http.post(`${API_BASE}/builds`, async ({ request }) => {
        const body = (await request.json()) as { spec: string };
        capturedSpec = JSON.parse(body.spec);
        // Builder가 클라이언트 후보 run_id와 다른 진짜 run_id를 돌려주는 상황을 흉내낸다.
        return HttpResponse.json(
          {
            run_id: "server-assigned-run-id",
            status: "succeeded",
            created_at: "2026-08-17T00:00:00Z",
            updated_at: "2026-08-17T00:00:01Z",
            response: {
              status: "ok",
              run_id: "server-assigned-run-id",
              outcomes: [],
              manifest: "output/server-assigned-run-id/manifest.json",
              api_version: "1.16.0",
            },
          },
          { status: 202 },
        );
      }),
    );

    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Public API/ }));
    next();
    await screen.findByText("API 사용 준비");
    fireEvent.change(screen.getByLabelText(/제공자 \(Provider\)/), { target: { value: "datago" } });
    await waitFor(() => expect(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/)).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText(/소스 데이터셋 \(Source Dataset\)/), { target: { value: "air_quality" } });
    await screen.findByText(/ID: datago-air-quality/);
    next();
    await screen.findByRole("heading", { name: "Preview · 검증" });
    fireEvent.click(screen.getByRole("button", { name: "Preview 새로고침" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "다음" })).toBeEnabled());
    next();
    await screen.findByRole("heading", { name: "검토 · 테이블 만들기" });

    const reviewedSpecText = screen.getByText(/"dataset_id": "datago-air-quality"/).closest("pre")!.textContent!;
    const reviewedSpec = JSON.parse(reviewedSpecText);

    await waitFor(() => expect(screen.getByRole("button", { name: "테이블 만들기" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "테이블 만들기" }));

    await screen.findByText("Build 상세: run=server-assigned-run-id");

    expect(capturedSpec).toEqual(reviewedSpec);
  });
});
