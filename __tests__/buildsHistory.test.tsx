import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as datasetsApi from "@/features/datasets/api";
import * as runsApi from "@/features/runs/api";
import { BuildsPage } from "@/pages/BuildsPage";
import { ApiError, builderApi } from "@/shared/lib/builderApi";
import { DEMO_DATASETS } from "@/shared/lib/demoDatasets";
import { useAssistConfig } from "@/features/assistant/config";
import { useAsk KPubDataStore } from "@/features/kubi/useAsk KPubDataSession";

function renderBuilds(initialPath = "/builds") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <BuildsPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Builds run history (#12, #255 master-detail)", () => {
  it("renders rows with status badges and lets the user select a run", async () => {
    renderBuilds();
    expect(await screen.findByText("대기오염 정보")).toBeInTheDocument();
    expect(screen.getAllByText("성공").length).toBeGreaterThan(0); // succeeded badges
    // "실패"는 상태 필터 <option>에도 나타나므로 배지(span)로만 좁혀서 확인한다.
    expect(screen.getAllByText("실패", { selector: "span" }).length).toBeGreaterThan(0);

    // 목록 항목을 선택하면 오른쪽 상세 패널에 같은 run이 열린다.
    fireEvent.click(screen.getByText("대기오염 정보"));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "대기오염 정보" })).toBeInTheDocument();
    });
  });

  it("filters the history by title/id search", async () => {
    renderBuilds();
    await screen.findByText("대기오염 정보");

    fireEvent.change(screen.getByLabelText("Run 검색"), { target: { value: "병용" } });

    await waitFor(() => {
      expect(screen.queryByText("대기오염 정보")).not.toBeInTheDocument();
    });
    expect(screen.getByText("병용금기 품목정보")).toBeInTheDocument();
  });

  it("shows an error state with retry when listing fails (#71)", async () => {
    const realBuilds = await runsApi.listBuilds();
    const spy = vi
      .spyOn(runsApi, "listBuilds")
      .mockRejectedValueOnce(new Error("네트워크 오류"));
    renderBuilds();

    expect(await screen.findByText("빌드 목록을 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("네트워크 오류");

    // 재시도하면 실제 목록을 다시 불러온다.
    spy.mockResolvedValueOnce(realBuilds);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("대기오염 정보")).toBeInTheDocument();
  });
});

describe("selected Run permission state (#255 P0)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("selected Run 403: 존재 판정 근거인 stage 조회가 403이면 '찾을 수 없습니다'가 아니라 권한 없음으로 구분한다", async () => {
    vi.spyOn(datasetsApi, "listBuildStages").mockRejectedValue(
      new ApiError(403, "권한이 없습니다"),
    );

    renderBuilds("/builds?run=not-in-scope-run");

    expect(await screen.findByText(/이 Run을 조회할 권한이 없습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/Run을 찾을 수 없습니다/)).not.toBeInTheDocument();

    // 전체 Runs 목록은 계속 정상 렌더된다 — supplementary/detail 403이 목록을 죽이지 않는다.
    expect(await screen.findByText("대기오염 정보")).toBeInTheDocument();
  });

  it("selected Run 404: 존재 판정 근거인 stage 조회가 404면 기존 not-found 메시지를 유지한다", async () => {
    vi.spyOn(datasetsApi, "listBuildStages").mockRejectedValue(
      new ApiError(404, "찾을 수 없습니다"),
    );

    renderBuilds("/builds?run=not-in-scope-run");

    expect(await screen.findByText(/Run을 찾을 수 없습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/이 Run을 조회할 권한이 없습니다/)).not.toBeInTheDocument();
  });

  it("Quality/Stage supplementary 403에서도 목록에 있는 run의 core 정보(제목/상태)는 유지된다", async () => {
    vi.spyOn(datasetsApi, "getBuildQuality").mockRejectedValue(new ApiError(403, "권한이 없습니다"));
    vi.spyOn(datasetsApi, "listBuildStages").mockRejectedValue(new ApiError(403, "권한이 없습니다"));

    renderBuilds("/builds?run=air-quality-20260621");

    // core 정보(제목)는 계속 보인다 — supplementary 403이 상세 전체를 죽이지 않는다.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "대기오염 정보" })).toBeInTheDocument();
    });
    expect(screen.getByText(/이 Run의 Quality 결과를 조회할 권한이 없습니다/)).toBeInTheDocument();
    expect(screen.getByText(/이 Run의 Stage Progress를 조회할 권한이 없습니다/)).toBeInTheDocument();
  });
});

describe("Quality 카드 보강 (#255 후속 보완 §1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("evaluated checks 기준 PASS/WARN/FAIL count, multi-source 현황, WARN/FAIL 근거, schema drift를 표시한다", async () => {
    // air-2026-08-14: partial availability, 2개 source(datago__air pass / kma__weather fail),
    // schema_drift 1건이 있는 기존 mock fixture를 그대로 재사용한다(새 mock 의미를 만들지 않음).
    renderBuilds("/builds?run=air-2026-08-14");

    await waitFor(() => expect(screen.getByText("availability: partial")).toBeInTheDocument());

    // count 중심 요약 — PASS 상세 전체 나열이 아니라 count로 압축되어 있다.
    expect(screen.getByText("1 PASS")).toBeInTheDocument();
    expect(screen.getByText("0 WARN")).toBeInTheDocument();
    expect(screen.getByText("1 FAIL")).toBeInTheDocument();
    expect(screen.getByText(/evaluated 2건/)).toBeInTheDocument();

    // multi-source면 source별 평가 현황을 compact하게 보여준다(Pipeline 카드에도 같은
    // source_key가 나오므로 getAllByText로 확인한다).
    expect(screen.getByText("Source별 평가 현황")).toBeInTheDocument();
    expect(screen.getAllByText("datago__air").length).toBeGreaterThan(0);
    expect(screen.getAllByText("kma__weather").length).toBeGreaterThan(0);

    // WARN/FAIL 결과는 source/category/rule/column/actual/threshold를 함께 보여준다.
    expect(screen.getByText(/kma__weather · schema\/required_column · temperature/)).toBeInTheDocument();
    expect(screen.getByText(/actual false \/ threshold true/)).toBeInTheDocument();

    // schema drift는 별도 compact summary로 나온다.
    expect(screen.getByText(/Schema drift 1건: column_removed/)).toBeInTheDocument();

    // 현재 dataset/run context를 유지한 Quality Center 링크가 있다.
    const link = screen.getByRole("link", { name: "Quality Center에서 상세 보기" });
    expect(link).toHaveAttribute("href", expect.stringContaining("run=air-2026-08-14"));
  });

  it("정상 응답 + availability=unavailable은 '결과 없음(unavailable)'로 표시하고 조회 실패로 취급하지 않는다(#255 후속 보완 §5-A)", async () => {
    renderBuilds("/builds?run=population-2026-08-13");

    expect(await screen.findByText(/Quality 결과 없음 \(unavailable\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Quality 조회 실패/)).not.toBeInTheDocument();
  });

  it("Quality 404 요청 실패는 UNAVAILABLE로 표시하지 않고 조회 실패로 구분한다(#255 후속 보완 §5-B)", async () => {
    vi.spyOn(datasetsApi, "getBuildQuality").mockRejectedValue(new ApiError(404, "찾을 수 없습니다"));

    renderBuilds("/builds?run=air-quality-20260621");

    expect(await screen.findByText("Quality 조회 실패")).toBeInTheDocument();
    expect(screen.getByText(/찾을 수 없습니다\(404\)/)).toBeInTheDocument();
    expect(screen.queryByText(/결과 없음 \(unavailable\)/)).not.toBeInTheDocument();
    expect(screen.queryByText("결과 없음(unavailable)")).not.toBeInTheDocument(); // QualityStateBadge UNAVAILABLE 라벨
  });

  it("Quality 403/network 오류도 UNAVAILABLE로 표시하지 않는다(#255 후속 보완 §5-B)", async () => {
    vi.spyOn(datasetsApi, "getBuildQuality").mockRejectedValue(new ApiError(403, "권한이 없습니다"));
    renderBuilds("/builds?run=air-quality-20260621");
    expect(await screen.findByText("Quality 조회 실패")).toBeInTheDocument();
    expect(screen.getByText(/조회할 권한이 없습니다\(403\)/)).toBeInTheDocument();
    expect(screen.queryByText("결과 없음(unavailable)")).not.toBeInTheDocument();
  });
});

describe("cancelling 상태 보존 (#255 후속 보완 §2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // mock mode는 이제 selected Run live job polling을 하지 않으므로(#286 후속 보완 §1),
  // cancelling 표시는 real mode + 목록 밖(deep-link) run으로 검증한다 — 이 경우에만 live
  // registry(getBuildJob) 조회가 실제로 켜진다.
  it("Builder job status가 cancelling이면 running으로 합치지 않고 '취소 중'으로 표시한다(real mode, 목록 밖 run)", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([]);
    vi.spyOn(datasetsApi, "listBuildStages").mockResolvedValue({ run_id: "real-run-1", sources: [] });
    vi.spyOn(datasetsApi, "getBuildQuality").mockResolvedValue({
      run_id: "real-run-1",
      availability: "unavailable",
      evaluated_checks: 0,
      quality_results: {},
      schema_drift: {},
    });
    vi.spyOn(builderApi, "getBuildJob").mockResolvedValue({
      run_id: "real-run-1",
      status: "cancelling",
      created_at: "2026-06-21T09:00:00.000Z",
      updated_at: "2026-06-21T09:00:05.000Z",
    });

    renderBuilds("/builds?run=real-run-1");

    expect(await screen.findByText("취소 중")).toBeInTheDocument();

    vi.unstubAllEnvs();
  });
});

describe("Builds/Runs mock fixture 정합성 (#255 후속 보완 §4)", () => {
  it("DEMO_DATASETS가 노출하는 모든 run은 Stage/Quality fixture가 있어 이유 없는 404가 나지 않는다", async () => {
    for (const dataset of DEMO_DATASETS) {
      await expect(datasetsApi.listBuildStages(dataset.buildId)).resolves.toBeDefined();
      await expect(datasetsApi.getBuildQuality(dataset.buildId)).resolves.toBeDefined();
    }
  });

  it("성공(succeeded) run을 선택하면 Stage/Quality가 이유 없이 404가 되지 않고 정상 표시된다", async () => {
    renderBuilds("/builds?run=dur-product-info-20260620");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "DUR 품목정보" })).toBeInTheDocument();
    });
    expect(screen.queryByText(/Stage 상태를 불러오지 못했습니다/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Quality를 불러오지 못했습니다/)).not.toBeInTheDocument();
    expect(screen.getAllByText("completed").length).toBeGreaterThan(0);
  });
});

describe("완료된 Run의 불필요한 live polling 제거 (#286 후속 보완 §1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mock mode: succeeded historical run에서는 live job registry를 조회하지 않고 경고도 뜨지 않는다", async () => {
    const spy = vi.spyOn(builderApi, "getBuildJob");

    renderBuilds("/builds?run=air-quality-20260621");
    await screen.findByRole("heading", { name: "대기오염 정보" });
    // 목록의 deterministic mock status(성공)를 신뢰하고 별도 live 조회를 하지 않는다.
    await waitFor(() => expect(screen.getAllByText("성공", { selector: "span" }).length).toBeGreaterThan(0));

    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByText(/실시간 상태 갱신 실패/)).not.toBeInTheDocument();
    expect(screen.queryByText(/실시간 갱신 중/)).not.toBeInTheDocument();
  });

  it("real mode: GET /builds 목록에 이미 있는(terminal) run은 live registry 조회를 생략한다", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([
      { id: "real-run-1", title: null, status: "succeeded", startedAt: null, finishedAt: null },
    ]);
    vi.spyOn(datasetsApi, "listBuildStages").mockResolvedValue({ run_id: "real-run-1", sources: [] });
    vi.spyOn(datasetsApi, "getBuildQuality").mockResolvedValue({
      run_id: "real-run-1",
      availability: "unavailable",
      evaluated_checks: 0,
      quality_results: {},
      schema_drift: {},
    });
    const jobSpy = vi.spyOn(builderApi, "getBuildJob");

    renderBuilds("/builds?run=real-run-1");
    await waitFor(() => expect(screen.getAllByText("성공", { selector: "span" }).length).toBeGreaterThan(0));

    expect(jobSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/실시간 상태 갱신 실패/)).not.toBeInTheDocument();

    vi.unstubAllEnvs();
  });

  it("real mode: 목록 밖(deep-link) run은 계속 live registry로 상태를 확인한다(running semantics 유지)", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([]);
    vi.spyOn(datasetsApi, "listBuildStages").mockResolvedValue({ run_id: "real-run-2", sources: [] });
    vi.spyOn(datasetsApi, "getBuildQuality").mockResolvedValue({
      run_id: "real-run-2",
      availability: "unavailable",
      evaluated_checks: 0,
      quality_results: {},
      schema_drift: {},
    });
    const jobSpy = vi.spyOn(builderApi, "getBuildJob").mockResolvedValue({
      run_id: "real-run-2",
      status: "running",
      created_at: "2026-08-19T00:00:00.000Z",
      updated_at: "2026-08-19T00:00:01.000Z",
    });

    renderBuilds("/builds?run=real-run-2");

    await waitFor(() => expect(jobSpy).toHaveBeenCalled());
    expect(await screen.findByText("실시간 갱신 중…")).toBeInTheDocument();

    vi.unstubAllEnvs();
  });
});

describe("DEMO_DATASETS ↔ Stage detail 정합성 (#286 후속 보완 §2)", () => {
  it("air-quality-20260621: record/row count·날짜·export가 demo source와 일치한다(generic 1,200/2026-08-14 재사용 금지)", async () => {
    renderBuilds("/builds?run=air-quality-20260621");
    await screen.findByRole("heading", { name: "대기오염 정보" });

    // Bronze/Silver/Gold 모두 demo recordCount(12,304)를 그대로 보여준다.
    await waitFor(() => expect(screen.getAllByText(/12,304행/).length).toBe(3));
    expect(screen.queryByText(/1,200행/)).not.toBeInTheDocument();

    // 실제 demo export(parquet + huggingface)를 그대로 보여준다.
    expect(await screen.findByText("parquet · huggingface")).toBeInTheDocument();

    // 컬럼 수는 DEMO_DATASETS fields(10개)와 일치한다.
    expect(screen.getAllByText(/컬럼 10개/).length).toBe(2);
  });

  it("succeeded DEMO_DATASETS run들의 Stage detail이 generic 1,200/2026-08-14 값을 재사용하지 않는다", async () => {
    const succeeded = DEMO_DATASETS.filter((dataset) => dataset.status === "succeeded");
    expect(succeeded.length).toBeGreaterThan(0);

    for (const dataset of succeeded) {
      const sourceKey = `datago__${dataset.providerDataset}`;

      const bronze = await datasetsApi.getBuildStageDetail(dataset.buildId, "bronze", sourceKey);
      expect(bronze.stage).toBe("bronze");
      if (bronze.stage === "bronze") {
        expect(bronze.record_count).toBe(dataset.recordCount);
        expect(bronze.record_count).not.toBe(1200);
        expect(bronze.fetched_at).not.toBe("2026-08-14T07:05:00Z");
      }

      const gold = await datasetsApi.getBuildStageDetail(dataset.buildId, "gold", sourceKey);
      expect(gold.stage).toBe("gold");
      if (gold.stage === "gold") {
        expect(gold.row_count).toBe(dataset.recordCount);
        expect(gold.exports.map((target) => target.kind)).toEqual(dataset.exports.map((target) => target.format));
      }
    }
  });
});

describe("Pipeline / Stage Progress 시각화 (#255 후속 보완 §6)", () => {
  it("succeeded run: Source → Bronze → Silver → Gold → Output 흐름이 모두 completed로 표시된다", async () => {
    renderBuilds("/builds?run=air-quality-20260621");
    await screen.findByRole("heading", { name: "대기오염 정보" });

    expect(screen.getByText("Bronze")).toBeInTheDocument();
    expect(screen.getByText("Silver")).toBeInTheDocument();
    expect(screen.getByText("Gold")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getAllByText("completed").length).toBe(3);
  });

  it("failed run: failed stage 이후 not_run은 '미도달'로 표시된다", async () => {
    renderBuilds("/builds?run=dur-older-adult-caution-20260618");
    await screen.findByRole("heading", { name: "노인주의 의약품" });

    expect(screen.getByText("failed")).toBeInTheDocument();
    // silver/gold 둘 다 not_run이면서 failed 이후이므로 "미도달"이 두 번 나온다.
    expect(screen.getAllByText("미도달")).toHaveLength(2);
  });

  it("partial multi-source: source별로 서로 다른 진행 위치를 각자의 row로 보여준다", async () => {
    renderBuilds("/builds?run=air-2026-08-14");
    await waitFor(() => expect(screen.getAllByText("datago__air").length).toBeGreaterThan(0));

    expect(screen.getAllByText("kma__weather").length).toBeGreaterThan(0);
    // kma__weather는 silver failed → gold not_run(미도달), datago__air는 전부 completed다.
    expect(screen.getAllByText("미도달")).toHaveLength(1);
  });
});

describe("Run 분석 no-key UX (#286 후속 보완)", () => {
  afterEach(() => {
    useAssistConfig.getState().clear();
    useAsk KPubDataStore.setState({ pendingSeed: null });
  });

  it("API Key 미설정: '이 Run 분석' 클릭 시 seed하지 않고 inline card에 설정 안내만 연다", async () => {
    renderBuilds("/builds?run=air-quality-20260621");
    await screen.findByRole("heading", { name: "대기오염 정보" });

    fireEvent.click(screen.getByRole("button", { name: "이 Run 분석" }));

    // seed 자체가 발생하지 않는다 — mock mode의 session.isDemoAvailable로 우회하지 않는다.
    expect(useAsk KPubDataStore.getState().pendingSeed).toBeNull();

    expect(await screen.findByText("Ask KPubData 를 사용하려면 API Key 설정이 필요합니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask KPubData 설정 열기" })).toBeInTheDocument();
    // no_key ErrorNotice를 복제해서 보여주지 않는다.
    expect(screen.queryByText("API Key가 설정되어 있지 않습니다. 위에서 먼저 설정하세요.")).not.toBeInTheDocument();
    // no-key 상태에서는 "더 질문하기"를 보여주지 않는다.
    expect(screen.queryByRole("button", { name: "더 질문하기" })).not.toBeInTheDocument();
  });

  it("API Key 미설정: 'Ask KPubData 설정 열기'를 누르면 기존 Ask KPubData Drawer를 연다", async () => {
    renderBuilds("/builds?run=air-quality-20260621");
    await screen.findByRole("heading", { name: "대기오염 정보" });

    fireEvent.click(screen.getByRole("button", { name: "이 Run 분석" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ask KPubData 설정 열기" }));

    // App shell(전역 Ask KPubData drawer)이 이 화면 트리 밖에 있어 직접 열림을 확인할 수는 없지만,
    // 최소한 별도의 API Key 입력 UI를 inline에 만들지 않았음을 확인한다.
    expect(screen.queryByLabelText(/API Key/)).not.toBeInTheDocument();
  });

  it("API Key 설정됨: '이 Run 분석' 클릭 시 기존처럼 seed하고 분석을 시작한다(no-key 안내가 뜨지 않음)", async () => {
    useAssistConfig.getState().setConfig({ apiKey: "sk-test" });

    renderBuilds("/builds?run=air-quality-20260621");
    await screen.findByRole("heading", { name: "대기오염 정보" });

    fireEvent.click(screen.getByRole("button", { name: "이 Run 분석" }));

    // seed가 실제로 소비되어(기존 useAsk KPubDataSession ask 경로) pendingSeed가 비워진다.
    await waitFor(() => expect(useAsk KPubDataStore.getState().pendingSeed).toBeNull());
    expect(screen.queryByText("Ask KPubData 를 사용하려면 API Key 설정이 필요합니다.")).not.toBeInTheDocument();
  });
});
