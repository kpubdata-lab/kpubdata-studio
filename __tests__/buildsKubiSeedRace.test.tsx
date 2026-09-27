/**
 * C1 regression — Builds "이 Run 분석" seed vs. normalizeBuildContextSearch race (#255 §2 / #256 stale guard).
 *
 * 버그: spec/stages 응답이 아직 loading인 상태에서 "이 Run 분석"을 즉시 누르면 `Ask KPubDataRunAnalysis`가
 * mount되며 pending seed를 소비해 `ask()`가 그 순간의 `liveContext`(= `?run=` 하나뿐, dataset/
 * stage/source 없음)를 그대로 turn.context로 고정한다. 잠시 뒤 `normalizeBuildContextSearch`가
 * `?dataset=`을 URL에 채우면 `contextsMatch`가 깨져 방금 만든 turn이 stale로 분류되고,
 * `Ask KPubDataRunAnalysis`의 turn 선택 memo(`!isStale`만 통과)가 답변을 버리고 "분석 준비 중…"으로
 * 되돌아간다.
 *
 * 수정: 클릭은 즉시 카드를 열되, URL이 normalizeBuildContextSearch의 고정점(canonical)이 될
 * 때까지 seed를 보류하고, canonical해진 뒤 정확히 한 번 seed한다. 아래 두 테스트는 수정 전
 * fail / 수정 후 pass 해야 한다.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as datasetsApi from "@/features/datasets/api";
import * as runsApi from "@/features/runs/api";
import * as runDetailApi from "@/features/runs/api/runDetail";
import { useAssistConfig } from "@/features/assistant/config";
import { createProvider } from "@/features/assistant/provider";
import { useAsk KPubDataStore } from "@/features/kubi/useAsk KPubDataSession";
import { BuildsPage } from "@/pages/BuildsPage";
import type { BuildListItem } from "@/shared/lib/types";
import type {
  BuildQualityResponse,
  BuildSpecSnapshotResponse,
  RunStagesResponse,
} from "@/shared/lib/builderApi";

vi.mock("@/features/assistant/provider", () => ({ createProvider: vi.fn() }));

const RUN_ID = "seed-race-run";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const ANSWER = "테스트 분석 답변입니다.";
const OK_JSON = JSON.stringify({ answer: ANSWER, evidenceRefs: [], generatedSql: null, suggestedActions: [] });

let streamCalls = 0;
function mockStream(text: string) {
  streamCalls = 0;
  vi.mocked(createProvider).mockReturnValue({
    isConfigured: true,
    stream: () => {
      streamCalls += 1;
      return (async function* () {
        yield "```json\n" + text + "\n```";
      })();
    },
  } as unknown as ReturnType<typeof createProvider>);
}

/** 호출 순서대로 "throw"(LLM 오류) 또는 "ok"(정상 응답)로 동작하는 stream mock. */
function mockStreamSequence(...behaviors: ("throw" | "ok")[]) {
  streamCalls = 0;
  vi.mocked(createProvider).mockReturnValue({
    isConfigured: true,
    stream: () => {
      const behavior = behaviors[streamCalls] ?? "ok";
      streamCalls += 1;
      return (async function* () {
        if (behavior === "throw") throw new Error("LLM 일시 오류");
        yield "```json\n" + OK_JSON + "\n```";
      })();
    },
  } as unknown as ReturnType<typeof createProvider>);
}

const listItem: BuildListItem = {
  id: RUN_ID,
  title: "Seed Race Run",
  status: "failed",
  startedAt: "2026-08-20T00:00:00Z",
  finishedAt: "2026-08-20T00:05:00Z",
};

const quality: BuildQualityResponse = {
  run_id: RUN_ID,
  availability: "unavailable",
  evaluated_checks: 0,
  quality_results: {},
  schema_drift: {},
};

/** 단일 소스, silver가 failed인 stage 응답 → normalizeBuildContextSearch가 ?stage=silver&source= 를 채운다. */
const stagesResponse: RunStagesResponse = {
  run_id: RUN_ID,
  sources: [
    {
      source_key: "datago__air",
      bronze: { status: "completed", available: true },
      silver: { status: "failed", available: false },
      gold: { status: "not_run", available: false },
    },
  ],
};

const specSnapshot: BuildSpecSnapshotResponse = {
  run_id: RUN_ID,
  spec: "dataset_id: air-quality\n",
  spec_digest: "sha256:" + "0".repeat(64),
};

function renderBuilds() {
  return render(
    <MemoryRouter initialEntries={[`/builds?run=${RUN_ID}`]}>
      <BuildsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAsk KPubDataStore.setState({ turns: [], onboarded: false, pendingSeed: null });
  act(() => {
    useAssistConfig.getState().setConfig({ apiKey: "sk-test-key", model: "gpt-4o-mini", baseUrl: "" });
  });
  mockStream(JSON.stringify({ answer: "테스트 분석 답변입니다.", evidenceRefs: [], generatedSql: null, suggestedActions: [] }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("C1 — Builds Ask KPubData seed vs. context back-fill race", () => {
  it("closing the inline card discards a pending analysis before context becomes canonical", async () => {
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([listItem]);
    vi.spyOn(datasetsApi, "getBuildQuality").mockResolvedValue(quality);
    const spec = deferred<BuildSpecSnapshotResponse>();
    const stages = deferred<RunStagesResponse>();
    vi.spyOn(runDetailApi, "getBuildSpecSnapshot").mockReturnValue(spec.promise);
    vi.spyOn(datasetsApi, "listBuildStages").mockReturnValue(stages.promise);

    renderBuilds();
    fireEvent.click(await screen.findByRole("button", { name: /분석/ }));
    fireEvent.click(await screen.findByRole("button", { name: "닫기" }));
    await act(async () => {
      spec.resolve(specSnapshot);
      stages.resolve(stagesResponse);
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(useAsk KPubDataStore.getState().turns).toHaveLength(0);
    expect(useAsk KPubDataStore.getState().pendingSeed).toBeNull();
    expect(streamCalls).toBe(0);
  });

  it("defers the seed until the URL context is canonical, so the fresh turn is not stale-flipped away (spec+stages deferred)", async () => {
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([listItem]);
    vi.spyOn(datasetsApi, "getBuildQuality").mockResolvedValue(quality);

    // spec/stages를 의도적으로 지연시킨다 — 클릭 시점에 아직 loading.
    const spec = deferred<BuildSpecSnapshotResponse>();
    const stages = deferred<RunStagesResponse>();
    vi.spyOn(runDetailApi, "getBuildSpecSnapshot").mockReturnValue(spec.promise);
    vi.spyOn(datasetsApi, "listBuildStages").mockReturnValue(stages.promise);

    renderBuilds();

    const analyzeButton = await screen.findByRole("button", { name: "이 Run 분석" });
    fireEvent.click(analyzeButton);

    // 카드는 즉시 열린다.
    expect(await screen.findByRole("heading", { name: "Run 분석" })).toBeInTheDocument();
    // 아직 context가 canonical하지 않으므로 seed하지 않는다 — turn이 생기지 않는다.
    expect(useAsk KPubDataStore.getState().turns).toHaveLength(0);
    expect(screen.getByText("분석 준비 중…")).toBeInTheDocument();

    // spec/stages가 도착하고, BuildsPage의 normalizeBuildContextSearch가 URL을 정규화한다.
    await act(async () => {
      spec.resolve(specSnapshot);
      stages.resolve(stagesResponse);
    });

    // 이제 canonical context로 seed가 정확히 한 번 실행되고 답변이 뜬다.
    expect(await screen.findByText("테스트 분석 답변입니다.")).toBeInTheDocument();

    // turn.context는 정규화된 canonical 값(dataset/stage/source)을 담고 있어야 한다.
    const turn = useAsk KPubDataStore.getState().turns[0];
    expect(useAsk KPubDataStore.getState().turns).toHaveLength(1);
    expect(turn.context.datasetId).toBe("air-quality");
    expect(turn.context.stage).toBe("silver");
    expect(turn.context.source).toBe("datago__air");

    // 회귀 가드: 뒤늦은 URL 정규화로 turn이 stale로 사라지지 않는다.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("테스트 분석 답변입니다.")).toBeInTheDocument();
    expect(screen.queryByText("분석 준비 중…")).not.toBeInTheDocument();
    expect(screen.queryByText("이전 화면 기준")).not.toBeInTheDocument();
    // 중복 LLM 요청 없음.
    expect(streamCalls).toBe(1);
  });

  it("still defers when spec is already loaded but stages settle a beat later and add ?stage=/?source= (click right before normalization)", async () => {
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([listItem]);
    vi.spyOn(datasetsApi, "getBuildQuality").mockResolvedValue(quality);

    // spec은 즉시 로드(→ ?dataset= 정규화가 곧 일어남), stages만 지연.
    vi.spyOn(runDetailApi, "getBuildSpecSnapshot").mockResolvedValue(specSnapshot);
    const stages = deferred<RunStagesResponse>();
    vi.spyOn(datasetsApi, "listBuildStages").mockReturnValue(stages.promise);

    renderBuilds();

    const analyzeButton = await screen.findByRole("button", { name: "이 Run 분석" });
    // spec 정규화(?dataset=)가 방금 반영됐어도 stages는 아직 pending → context는 canonical 아님.
    await waitFor(() => expect(datasetsApi.listBuildStages).toHaveBeenCalled());
    fireEvent.click(analyzeButton);

    expect(await screen.findByRole("heading", { name: "Run 분석" })).toBeInTheDocument();
    expect(useAsk KPubDataStore.getState().turns).toHaveLength(0);

    // stages 도착 → normalizeBuildContextSearch가 ?stage=silver&source=datago__air 추가.
    await act(async () => {
      stages.resolve(stagesResponse);
    });

    expect(await screen.findByText("테스트 분석 답변입니다.")).toBeInTheDocument();
    const turn = useAsk KPubDataStore.getState().turns[0];
    expect(turn.context.stage).toBe("silver");
    expect(turn.context.source).toBe("datago__air");

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("테스트 분석 답변입니다.")).toBeInTheDocument();
    expect(screen.queryByText("분석 준비 중…")).not.toBeInTheDocument();
    expect(streamCalls).toBe(1);
  });

  it("discards a pending analyze intent when the selected run changes before it seeds", async () => {
    const otherItem: BuildListItem = { ...listItem, id: "other-run", title: "Other Run" };
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([listItem, otherItem]);
    vi.spyOn(datasetsApi, "getBuildQuality").mockResolvedValue(quality);

    // 두 run 모두 spec/stages를 영구 pending으로 둔다 → context가 절대 canonical해지지 않는다.
    vi.spyOn(runDetailApi, "getBuildSpecSnapshot").mockReturnValue(deferred<BuildSpecSnapshotResponse>().promise);
    vi.spyOn(datasetsApi, "listBuildStages").mockReturnValue(deferred<RunStagesResponse>().promise);

    renderBuilds();

    fireEvent.click(await screen.findByRole("button", { name: "이 Run 분석" }));
    expect(await screen.findByRole("heading", { name: "Run 분석" }));
    expect(useAsk KPubDataStore.getState().turns).toHaveLength(0);

    // 다른 run 선택 → 이전 pending analyze 의도가 폐기돼야 한다.
    fireEvent.click(screen.getByText("Other Run"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Other Run" })).toBeInTheDocument());

    await new Promise((r) => setTimeout(r, 50));
    // 이전 run의 pending seed가 뒤늦게 실행되지 않는다.
    expect(useAsk KPubDataStore.getState().turns).toHaveLength(0);
    expect(useAsk KPubDataStore.getState().pendingSeed).toBeNull();
  });

  it("re-clicking '이 Run 분석' on the same run re-analyzes (retry after an errored analysis is not blocked)", async () => {
    // C1 보류 로직이 "run 수명 동안 1회"가 아니라 "클릭 1회당 seed 1회"여야 한다 —
    // 인라인 분석이 LLM 오류로 실패했을 때 재시도할 다른 affordance가 없으므로(ErrorNotice에
    // inline retry 없음) "이 Run 분석" 재클릭이 유일한 재시도 경로다.
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([listItem]);
    vi.spyOn(datasetsApi, "getBuildQuality").mockResolvedValue(quality);
    vi.spyOn(runDetailApi, "getBuildSpecSnapshot").mockResolvedValue(specSnapshot);
    vi.spyOn(datasetsApi, "listBuildStages").mockResolvedValue(stagesResponse);
    mockStreamSequence("throw", "ok");

    renderBuilds();

    const analyzeButton = await screen.findByRole("button", { name: "이 Run 분석" });
    fireEvent.click(analyzeButton);

    // 1차: LLM 오류로 실패한 turn이 인라인 카드에 표시된다.
    expect(await screen.findByText("LLM 일시 오류")).toBeInTheDocument();
    expect(useAsk KPubDataStore.getState().turns).toHaveLength(1);
    expect(streamCalls).toBe(1);

    // 재클릭 → 새 분석이 시작되고 이번엔 성공한다.
    fireEvent.click(analyzeButton);

    expect(await screen.findByText(ANSWER)).toBeInTheDocument();
    await waitFor(() => expect(useAsk KPubDataStore.getState().turns).toHaveLength(2));
    expect(useAsk KPubDataStore.getState().turns[1].status).toBe("ok");
    expect(streamCalls).toBe(2);
  });

  it("adds exactly one new turn per re-click after a successful analysis (no duplicate seed/LLM request)", async () => {
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([listItem]);
    vi.spyOn(datasetsApi, "getBuildQuality").mockResolvedValue(quality);
    vi.spyOn(runDetailApi, "getBuildSpecSnapshot").mockResolvedValue(specSnapshot);
    vi.spyOn(datasetsApi, "listBuildStages").mockResolvedValue(stagesResponse);

    renderBuilds();
    const analyzeButton = await screen.findByRole("button", { name: "이 Run 분석" });

    fireEvent.click(analyzeButton);
    expect(await screen.findByText(ANSWER)).toBeInTheDocument();
    await waitFor(() => expect(useAsk KPubDataStore.getState().turns).toHaveLength(1));
    expect(streamCalls).toBe(1);

    fireEvent.click(analyzeButton);
    await waitFor(() => expect(useAsk KPubDataStore.getState().turns).toHaveLength(2));
    // 재클릭 후 여유를 둬도 3번째 turn/LLM 호출이 새어 나오지 않는다.
    await new Promise((r) => setTimeout(r, 50));
    expect(useAsk KPubDataStore.getState().turns).toHaveLength(2);
    expect(streamCalls).toBe(2);
  });

  it("coalesces rapid clicks fired before the context is canonical into a single seed", async () => {
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([listItem]);
    vi.spyOn(datasetsApi, "getBuildQuality").mockResolvedValue(quality);
    // pending window를 확보하려고 spec/stages를 지연시킨다.
    const spec = deferred<BuildSpecSnapshotResponse>();
    const stages = deferred<RunStagesResponse>();
    vi.spyOn(runDetailApi, "getBuildSpecSnapshot").mockReturnValue(spec.promise);
    vi.spyOn(datasetsApi, "listBuildStages").mockReturnValue(stages.promise);

    renderBuilds();
    const analyzeButton = await screen.findByRole("button", { name: "이 Run 분석" });

    // context가 canonical해지기 전에 여러 번 클릭 = 한 의도로 합쳐진다(analyzePending은 boolean).
    fireEvent.click(analyzeButton);
    fireEvent.click(analyzeButton);
    fireEvent.click(analyzeButton);
    expect(useAsk KPubDataStore.getState().turns).toHaveLength(0);

    await act(async () => {
      spec.resolve(specSnapshot);
      stages.resolve(stagesResponse);
    });

    expect(await screen.findByText(ANSWER)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(useAsk KPubDataStore.getState().turns).toHaveLength(1);
    expect(streamCalls).toBe(1);
  });

  it("does not auto-seed the newly selected run after a discarded pending intent (no late seed)", async () => {
    const otherItem: BuildListItem = { ...listItem, id: "other-run", title: "Other Run" };
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([listItem, otherItem]);
    vi.spyOn(datasetsApi, "getBuildQuality").mockResolvedValue(quality);
    // run A: spec/stages 영구 pending → 클릭해도 canonical 안 됨(analyzePending만 true).
    // run B(other-run): spec/stages 즉시 resolve → B의 URL은 곧 canonical해진다.
    vi.spyOn(runDetailApi, "getBuildSpecSnapshot").mockImplementation((runId: string) =>
      runId === "other-run" ? Promise.resolve({ ...specSnapshot, run_id: "other-run" }) : deferred<BuildSpecSnapshotResponse>().promise,
    );
    vi.spyOn(datasetsApi, "listBuildStages").mockImplementation((runId: string) =>
      runId === "other-run" ? Promise.resolve({ ...stagesResponse, run_id: "other-run" }) : deferred<RunStagesResponse>().promise,
    );

    renderBuilds();

    fireEvent.click(await screen.findByRole("button", { name: "이 Run 분석" }));
    expect(await screen.findByRole("heading", { name: "Run 분석" }));
    expect(useAsk KPubDataStore.getState().turns).toHaveLength(0);

    // run 변경 → 이전 pending 폐기. B의 context가 canonical해져도 클릭 없이 자동 분석하지 않는다.
    fireEvent.click(screen.getByText("Other Run"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Other Run" })).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 50));

    expect(useAsk KPubDataStore.getState().turns).toHaveLength(0);
    expect(useAsk KPubDataStore.getState().pendingSeed).toBeNull();
  });

  it("does not stay pending forever when the BuildSpec snapshot request errors (spec error is 'settled')", async () => {
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([listItem]);
    vi.spyOn(datasetsApi, "getBuildQuality").mockResolvedValue(quality);
    // spec은 error(legacy run 등), stages는 정상.
    vi.spyOn(runDetailApi, "getBuildSpecSnapshot").mockRejectedValue(new Error("no snapshot for legacy run"));
    vi.spyOn(datasetsApi, "listBuildStages").mockResolvedValue(stagesResponse);

    renderBuilds();
    fireEvent.click(await screen.findByRole("button", { name: "이 Run 분석" }));

    // spec error도 settled로 취급되므로 seed가 실행되고 분석이 진행된다.
    expect(await screen.findByText(ANSWER)).toBeInTheDocument();
    expect(useAsk KPubDataStore.getState().turns).toHaveLength(1);
    // dataset은 spec이 없어 못 채우지만 stage/source는 stages에서 canonical하게 채워진다.
    expect(useAsk KPubDataStore.getState().turns[0].context.stage).toBe("silver");
    expect(useAsk KPubDataStore.getState().turns[0].context.datasetId).toBeUndefined();
  });
});
