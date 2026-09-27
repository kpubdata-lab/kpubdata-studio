/**
 * Run provenance 통합 회귀 (독립 리뷰 blocker).
 *
 * 단위 테스트 두 개(evidence.test.ts / crossCheck.test.ts)만으로는 실제 흐름
 *   loadKubiEvidence → 반환된 knownRefs → crossCheckKubiResponse
 * 에서 "확인되지 않은 route runId 가 known 으로 새는" 회귀를 막지 못한다. 세 케이스를
 * 결합 흐름으로 고정한다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveBuildSpec } from "@/features/build-spec/specStore";
import * as runDetailApi from "@/features/runs/api/runDetail";
import type { BuildSpec } from "@/shared/lib/types";
import { loadKubiEvidence } from "./evidence";
import { crossCheckKubiResponse } from "./crossCheck";
import type { KubiContext, KubiStructuredResponse } from "./types";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function response(overrides: Partial<KubiStructuredResponse> = {}): KubiStructuredResponse {
  return {
    answer: "요약 답변입니다.",
    evidenceRefs: [],
    generatedSql: null,
    suggestedActions: [],
    ...overrides,
  };
}

describe("run provenance — loadKubiEvidence → crossCheckKubiResponse", () => {
  it("Case A — 확인되지 않은 route run 은 evidenceRef/OPEN_BUILD/OPEN_QUALITY(runId)/PATCH_BUILDSPEC 에서 모두 reject 된다", async () => {
    const unverified = "unverified-private-run-1788004513063";
    // dataset 자체는 존재하지만 이 runId 는 dataset/runs 에 없고 quality/stage 요청도 404.
    const context: KubiContext = { page: "build-detail", datasetId: "air-quality", runId: unverified };
    const { evidence, knownRefs, safeRunIds } = await loadKubiEvidence(context);

    expect(knownRefs.runIds.has(unverified)).toBe(false);
    expect(safeRunIds.has(unverified)).toBe(false);

    const checked = crossCheckKubiResponse(
      response({
        evidenceRefs: [{ kind: "run", id: unverified, label: "빌드 실행" }],
        suggestedActions: [
          { type: "OPEN_BUILD", runId: unverified, reason: "확인해보세요" },
          { type: "OPEN_QUALITY", datasetId: "air-quality", runId: unverified, reason: "품질을 보세요" },
          {
            type: "PATCH_BUILDSPEC",
            runId: unverified,
            patch: [{ op: "replace", path: "/title", value: "x" }],
            reason: "고쳐보세요",
          },
        ],
      }),
      evidence,
      knownRefs,
    );

    expect(checked.response.evidenceRefs).toHaveLength(0);
    expect(checked.response.suggestedActions).toHaveLength(0);
    expect(checked.rejectedActions.some((r) => r.startsWith("OPEN_BUILD"))).toBe(true);
    expect(checked.rejectedActions.some((r) => r.startsWith("OPEN_QUALITY"))).toBe(true);
    expect(checked.rejectedActions.some((r) => r.startsWith("PATCH_BUILDSPEC"))).toBe(true);
  });

  it("Case B — Builder 가 확인한 context run 은 evidenceRef/OPEN_BUILD/OPEN_QUALITY/PATCH_BUILDSPEC 가 유지된다", async () => {
    const actualRunId = "air-2026-08-14";
    const spec: BuildSpec = {
      datasetId: "air-quality",
      title: "대기질",
      description: "설명",
      sources: [{ provider: "datago", dataset: "air", params: { region: "서울" } }],
      exports: [{ format: "jsonl" }],
      metadata: {},
    };
    saveBuildSpec(actualRunId, spec);

    const context: KubiContext = { page: "build-detail", datasetId: "air-quality", runId: actualRunId };
    const { evidence, knownRefs, safeRunIds } = await loadKubiEvidence(context);

    expect(knownRefs.runIds.has(actualRunId)).toBe(true);
    expect(safeRunIds.has(actualRunId)).toBe(true);

    const checked = crossCheckKubiResponse(
      response({
        evidenceRefs: [{ kind: "run", id: actualRunId, label: "빌드 실행" }],
        suggestedActions: [
          { type: "OPEN_BUILD", runId: actualRunId, reason: "확인" },
          { type: "OPEN_QUALITY", datasetId: "air-quality", runId: actualRunId, reason: "품질" },
          {
            type: "PATCH_BUILDSPEC",
            runId: actualRunId,
            patch: [{ op: "replace", path: "/title", value: "x" }],
            reason: "수정",
          },
        ],
      }),
      evidence,
      knownRefs,
    );

    expect(checked.response.evidenceRefs).toHaveLength(1);
    expect(checked.response.suggestedActions).toHaveLength(3);
    expect(checked.rejectedActions).toHaveLength(0);
  });

  it("Case C — context.runId 와 Builder 가 확인한 run 이 다르면, context 쪽만 known/safe 에서 빠진다", async () => {
    const mismatch = "context-only-run-1788004513099";
    const context: KubiContext = { page: "build-detail", datasetId: "air-quality", runId: mismatch };
    const { evidence, knownRefs, safeRunIds } = await loadKubiEvidence(context);

    // Builder 가 확인한 run(air-quality dataset/runs).
    expect(knownRefs.runIds.has("air-2026-08-14")).toBe(true);
    expect(safeRunIds.has("air-2026-08-14")).toBe(true);
    // context 에서만 온 run.
    expect(knownRefs.runIds.has(mismatch)).toBe(false);
    expect(safeRunIds.has(mismatch)).toBe(false);

    const rejected = crossCheckKubiResponse(
      response({ suggestedActions: [{ type: "OPEN_BUILD", runId: mismatch, reason: "context" }] }),
      evidence,
      knownRefs,
    );
    expect(rejected.response.suggestedActions).toHaveLength(0);

    const accepted = crossCheckKubiResponse(
      response({ suggestedActions: [{ type: "OPEN_BUILD", runId: "air-2026-08-14", reason: "builder" }] }),
      evidence,
      knownRefs,
    );
    expect(accepted.response.suggestedActions).toHaveLength(1);
  });

  it("Case D — 다른 dataset 소속으로 확인된 run의 OPEN_QUALITY를 거부한다", async () => {
    const context: KubiContext = {
      page: "quality",
      datasetId: "air-quality",
      runId: "population-2026-08-13",
    };
    const { evidence, knownRefs } = await loadKubiEvidence(context);

    // dataset과 run은 각각 Builder 응답으로 존재가 확인된다. 다만 run은 population 소속이다.
    expect(knownRefs.datasetIds.has("air-quality")).toBe(true);
    expect(knownRefs.runIds.has("population-2026-08-13")).toBe(true);

    const checked = crossCheckKubiResponse(
      response({
        suggestedActions: [
          {
            type: "OPEN_QUALITY",
            datasetId: "air-quality",
            runId: "population-2026-08-13",
            reason: "품질을 확인하세요",
          },
        ],
      }),
      evidence,
      knownRefs,
    );

    expect(checked.response.suggestedActions).toHaveLength(0);
    expect(checked.rejectedActions[0]).toContain("소속");
  });

  it("Case E — recent 10/latest 밖의 old run도 spec snapshot dataset_id가 일치하면 OPEN_QUALITY를 유지한다", async () => {
    const oldRunId = "old-air-run-outside-recent-window";
    vi.spyOn(runDetailApi, "getBuildSpecSnapshot").mockResolvedValue({
      run_id: oldRunId,
      spec: "dataset_id: air-quality\n",
      spec_digest: `sha256:${"0".repeat(64)}`,
    });

    const { evidence, knownRefs } = await loadKubiEvidence({
      page: "build-detail",
      datasetId: "air-quality",
      runId: oldRunId,
    });
    expect(evidence.recentRuns?.some((run) => run.runId === oldRunId)).toBe(false);
    expect(evidence.dataset?.latestRunId).not.toBe(oldRunId);

    const checked = crossCheckKubiResponse(
      response({
        suggestedActions: [{ type: "OPEN_QUALITY", datasetId: "air-quality", runId: oldRunId, reason: "품질" }],
      }),
      evidence,
      knownRefs,
    );

    expect(checked.response.suggestedActions).toHaveLength(1);
  });

  it("Case F — old run spec snapshot의 dataset_id가 다르면 OPEN_QUALITY를 거부한다", async () => {
    const oldRunId = "old-population-run-outside-recent-window";
    vi.spyOn(runDetailApi, "getBuildSpecSnapshot").mockResolvedValue({
      run_id: oldRunId,
      spec: "dataset_id: population\n",
      spec_digest: `sha256:${"1".repeat(64)}`,
    });

    const { evidence, knownRefs } = await loadKubiEvidence({
      page: "build-detail",
      datasetId: "air-quality",
      runId: oldRunId,
    });
    const checked = crossCheckKubiResponse(
      response({
        suggestedActions: [{ type: "OPEN_QUALITY", datasetId: "air-quality", runId: oldRunId, reason: "품질" }],
      }),
      evidence,
      knownRefs,
    );

    expect(checked.response.suggestedActions).toHaveLength(0);
    expect(checked.rejectedActions[0]).toContain("소속");
  });

  it("Case G — old run spec lookup 실패이고 다른 membership 근거도 없으면 fail-closed한다", async () => {
    const oldRunId = "old-run-without-membership-evidence";
    vi.spyOn(runDetailApi, "getBuildSpecSnapshot").mockRejectedValue(new Error("snapshot unavailable"));

    const { evidence, knownRefs } = await loadKubiEvidence({
      page: "build-detail",
      datasetId: "air-quality",
      runId: oldRunId,
    });
    const checked = crossCheckKubiResponse(
      response({
        suggestedActions: [{ type: "OPEN_QUALITY", datasetId: "air-quality", runId: oldRunId, reason: "품질" }],
      }),
      evidence,
      knownRefs,
    );

    expect(checked.response.suggestedActions).toHaveLength(0);
  });
});
