import { afterEach, describe, expect, it, vi } from "vitest";
import { saveBuildSpec } from "@/features/build-spec/specStore";
import * as datasetsApi from "@/features/datasets/api";
import type { BuildSpec } from "@/shared/lib/types";
import { loadKubiEvidence } from "./evidence";
import type { KubiContext } from "./types";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("loadKubiEvidence (#256)", () => {
  it("builds dataset/run/quality evidence with deep links and known refs for a valid dataset", async () => {
    const context: KubiContext = { page: "dataset-detail", datasetId: "air-quality", runId: "air-2026-08-14" };
    const { evidence, knownRefs } = await loadKubiEvidence(context);

    expect(evidence.dataset?.datasetId).toBe("air-quality");
    expect(evidence.deepLinks.datasetDetail).toBe("/datasets/air-quality");
    expect(evidence.quality?.results.some((r) => r.rule === "required_column")).toBe(true);
    expect(knownRefs.datasetIds.has("air-quality")).toBe(true);
    expect(knownRefs.runIds.has("air-2026-08-14")).toBe(true);
    expect(knownRefs.qualityResultIds.size).toBeGreaterThan(0);
    // catalog는 전역 MSW 핸들러가 항상 응답하므로 성공해야 한다.
    expect(evidence.catalog?.providers).toContain("datago");
  });

  it("marks evidence partial and lists what failed when the dataset doesn't exist", async () => {
    const context: KubiContext = { page: "dataset-detail", datasetId: "does-not-exist" };
    const { evidence } = await loadKubiEvidence(context);

    expect(evidence.partial).toBe(true);
    expect(evidence.unavailable).toContain("dataset");
    expect(evidence.dataset).toBeUndefined();
  });

  it("keeps quality unavailability distinct from PASS (population run has availability=unavailable)", async () => {
    const context: KubiContext = { page: "dataset-detail", datasetId: "population", runId: "population-2026-08-13" };
    const { evidence } = await loadKubiEvidence(context);

    expect(evidence.quality?.availability).toBe("unavailable");
    expect(evidence.quality?.evaluatedChecks).toBe(0);
  });

  it("does not fetch stage evidence when the context has no stage (no guessed source)", async () => {
    const context: KubiContext = { page: "dataset-detail", datasetId: "air-quality", runId: "air-2026-08-14" };
    const { evidence } = await loadKubiEvidence(context);
    expect(evidence.stage).toBeUndefined();
  });

  it("includes stage evidence (status/rowCount only, no raw sample rows) for the context source_key", async () => {
    // air-2026-08-14는 multi-source(datago__air + kma__weather)라 어느 소스인지 명시해야 한다.
    const context: KubiContext = {
      page: "dataset-detail",
      datasetId: "air-quality",
      runId: "air-2026-08-14",
      stage: "silver",
      source: "datago__air",
    };
    const { evidence, knownRefs, safeEvidenceIds } = await loadKubiEvidence(context);
    expect(evidence.stage?.stage).toBe("silver");
    expect(evidence.stage?.source).toBe("datago__air");
    expect(evidence.stage?.refId).toBe("air-2026-08-14::datago__air::silver");
    expect(knownRefs.stageIds.has(evidence.stage!.refId)).toBe(true);
    expect(safeEvidenceIds.has(evidence.stage!.refId)).toBe(true);
    // 원본 sample row는 evidence 타입 자체에 존재하지 않는다 — 최소 데이터 원칙(#256 리뷰 §3).
    expect(evidence.stage).not.toHaveProperty("sample");
  });

  it("fails closed (stage unavailable) for a multi-source run when the context has no source_key", async () => {
    const context: KubiContext = {
      page: "quality",
      datasetId: "air-quality",
      runId: "air-2026-08-14",
      stage: "silver",
    };
    const { evidence } = await loadKubiEvidence(context);
    // 임의로 첫 source를 고르지 않는다 — 어느 소스인지 모호하면 stage를 unavailable로 둔다.
    expect(evidence.stage).toBeUndefined();
    expect(evidence.unavailable).toContain("stage");
  });

  it("falls back to the sole source_key for a single-source run when the context has no source_key", async () => {
    const context: KubiContext = {
      page: "quality",
      datasetId: "population",
      runId: "population-2026-08-13",
      stage: "silver",
    };
    const { evidence } = await loadKubiEvidence(context);
    expect(evidence.stage?.stage).toBe("silver");
    expect(evidence.stage?.source).toBe("kosis__population");
  });

  it("requests stage detail with a positive limit (real Builder rejects limit=0 with 400 → stage always unavailable)", async () => {
    // 실 Builder `/builds/{run}/stages/{stage}` 는 limit 을 "1..1000 양의 정수" 로만 받는다.
    // limit=0 이면 400 → settle 실패 → stage 가 항상 unavailable 로 빠지던 실 runtime 버그.
    const spy = vi.spyOn(datasetsApi, "getBuildStageDetail");
    const context: KubiContext = {
      page: "quality",
      datasetId: "population",
      runId: "population-2026-08-13",
      stage: "silver",
    };
    await loadKubiEvidence(context);
    expect(spy).toHaveBeenCalled();
    for (const call of spy.mock.calls) {
      const limit = call[3];
      expect(typeof limit).toBe("number");
      expect(limit as number).toBeGreaterThanOrEqual(1);
    }
  });

  it("exposes exact stage column names + dtypes from the Builder silver stage detail (SQL authoring evidence)", async () => {
    // 실 Builder Gold 시나리오 재현: 실제 컬럼은 `pm10Value`(String)이고 `pm10`은 없다.
    // LLM이 컬럼명을 추측하지 않도록 Builder가 반환한 schema를 그대로 노출해야 한다.
    vi.spyOn(datasetsApi, "getBuildStageDetail").mockResolvedValue({
      run_id: "population-2026-08-13",
      stage: "silver",
      source_key: "kosis__population",
      status: "completed",
      available: true,
      row_count: 40,
      schema: [
        { name: "stationName", dtype: "String", nullable: false, unique_count: 40 },
        { name: "pm10Value", dtype: "String", nullable: true, unique_count: 33 },
      ],
      statistics: null,
      validation: null,
      sample: [{ stationName: "종로구", pm10Value: "-" }],
    });

    const context: KubiContext = {
      page: "quality",
      datasetId: "population",
      runId: "population-2026-08-13",
      stage: "silver",
    };
    const { evidence } = await loadKubiEvidence(context);

    expect(evidence.stage?.columns).toEqual(["stationName", "pm10Value"]);
    expect(evidence.stage?.schema).toContainEqual({ name: "pm10Value", dtype: "String" });
    // 존재하지 않는 축약 컬럼명은 evidence에 등장하지 않는다.
    expect(evidence.stage?.columns).not.toContain("pm10");
    // 최소 데이터 원칙: raw sample row는 여전히 evidence에 새어 나가지 않는다.
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("종로구");
    expect(evidence.stage).not.toHaveProperty("sample");
  });

  it("exposes gold stage column names (contract has no dtype) without inventing a schema", async () => {
    vi.spyOn(datasetsApi, "getBuildStageDetail").mockResolvedValue({
      run_id: "population-2026-08-13",
      stage: "gold",
      source_key: "kosis__population",
      status: "completed",
      available: true,
      row_count: 40,
      columns: ["stationName", "pm10Value"],
      splits: null,
      exports: [{ kind: "parquet" }],
      sample: null,
      sample_available: false,
    });

    const context: KubiContext = {
      page: "quality",
      datasetId: "population",
      runId: "population-2026-08-13",
      stage: "gold",
    };
    const { evidence } = await loadKubiEvidence(context);

    expect(evidence.stage?.columns).toEqual(["stationName", "pm10Value"]);
    // gold stage detail은 dtype을 주지 않는다 — 지어내지 않고 schema는 생략한다.
    expect(evidence.stage?.schema).toBeUndefined();
  });

  it("never includes source param values (only param key names) in the BuildSpec summary", async () => {
    const SECRET_VALUE = "super-secret-service-key-0123456789abcdef";
    const spec: BuildSpec = {
      datasetId: "air-quality",
      title: "대기질",
      description: "설명",
      sources: [{ provider: "datago", dataset: "air", params: { serviceKey: SECRET_VALUE, region: "서울" } }],
      exports: [{ format: "jsonl" }],
      metadata: {},
    };
    saveBuildSpec("air-2026-08-14", spec);

    const context: KubiContext = { page: "build-detail", runId: "air-2026-08-14" };
    const { evidence } = await loadKubiEvidence(context);

    expect(evidence.buildSpecSummary?.sources[0].paramKeys).toEqual(["serviceKey", "region"]);
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain(SECRET_VALUE);
    expect(serialized).not.toContain("서울"); // param 값은 키 이름 외에는 전혀 포함되지 않는다.
  });

  it("scrubs any residual secret-shaped values as a defense-in-depth pass", async () => {
    const context: KubiContext = { page: "dataset-detail", datasetId: "air-quality", runId: "air-2026-08-14" };
    const { evidence } = await loadKubiEvidence(context);
    expect(JSON.stringify(evidence)).not.toContain("__SCRUBBED_");
  });

  it("keeps deterministic quality/schema-drift evidence ids out of entropy redaction (safeEvidenceIds provenance)", async () => {
    const context: KubiContext = { page: "quality", datasetId: "air-quality", runId: "air-2026-08-14" };
    const { evidence, knownRefs, safeEvidenceIds } = await loadKubiEvidence(context);

    const results = evidence.quality?.results ?? [];
    expect(results.length).toBeGreaterThan(0);
    // canonical source_key는 secret이 아니다 — 필드명이 `source`라 redactSecrets의 `*key$`
    // secret-named 휴리스틱에 걸리지 않고, crossCheck의 stage/그룹 대조에 그대로 쓸 수 있어야 한다.
    for (const result of results) expect(result.source).not.toBe("[REDACTED]");
    const ids = results.map((result) => result.id);
    for (const id of ids) {
      // valid quality id는 secret scrubber의 엔트로피 오탐으로 `[REDACTED]`되면 안 된다.
      expect(id).not.toBe("[REDACTED]");
      // 그리고 crossCheck 대조용 knownRefs와 egress 면제용 safeEvidenceIds 양쪽에 동일 값으로 들어간다.
      expect(knownRefs.qualityResultIds.has(id)).toBe(true);
      expect(safeEvidenceIds.has(id)).toBe(true);
    }
    for (const finding of evidence.quality?.schemaDrift ?? []) {
      const driftId = `${finding.kind}::${finding.column ?? "_"}`;
      expect(safeEvidenceIds.has(driftId)).toBe(true);
    }
    // safeEvidenceIds는 run id가 아니라 evidence identifier만 담는다 — run id는 safeRunIds 소관.
    expect(safeEvidenceIds.has("air-2026-08-14")).toBe(false);
  });

  it("omits stage/buildSpecSummary/quality when the context has no runId at all", async () => {
    const context: KubiContext = { page: "quality" };
    const { evidence, knownRefs } = await loadKubiEvidence(context);
    expect(evidence.quality).toBeUndefined();
    expect(evidence.buildSpecSummary).toBeUndefined();
    expect(knownRefs.runIds.size).toBe(0);
  });
});

/**
 * Run provenance — knownRefs.runIds 와 safeRunIds 는 역할이 다르지만 provenance 계약은 같다
 * (#284 + 독립 리뷰 blocker).
 *
 * 두 Set 모두 "이번 evidence 로딩에서 Builder 응답으로 실제 존재가 확인된 run id" 만 담는다.
 * route/context.runId 는 evidence.context / deepLink 에는 남을 수 있어도, 존재가 확인되기
 * 전에는 knownRefs.runIds / safeRunIds 어디에도 들어가지 않는다.
 */
describe("loadKubiEvidence — run provenance (knownRefs.runIds / safeRunIds)", () => {
  it("Builder 응답(getDataset.latest_run_id / listDatasetRuns)이 확인한 run id 는 safeRunIds 에 들어간다", async () => {
    const context: KubiContext = { page: "dataset-detail", datasetId: "air-quality", runId: "air-2026-08-14" };
    const { knownRefs, safeRunIds } = await loadKubiEvidence(context);

    expect(safeRunIds.has("air-2026-08-14")).toBe(true);
    // listDatasetRuns 로 확인된 과거 run 도 포함.
    expect(safeRunIds.has("air-2026-08-13")).toBe(true);
    // safeRunIds ⊆ knownRefs.runIds (분리했지만 확인된 값은 양쪽 모두에 있다).
    for (const id of safeRunIds) expect(knownRefs.runIds.has(id)).toBe(true);
  });

  it("Builder 어느 응답에서도 확인되지 않은 route runId 는 knownRefs.runIds / safeRunIds 어디에도 없다", async () => {
    // datasetId 없음 → getDataset/listDatasetRuns 호출 안 함. quality/stage 는 이 run id 로 404.
    const unverified = "service-secret-production-abcdef-1788004513062";
    const context: KubiContext = { page: "build-detail", runId: unverified };
    const { knownRefs, safeRunIds } = await loadKubiEvidence(context);

    expect(safeRunIds.has(unverified)).toBe(false);
    expect(safeRunIds.size).toBe(0);
    // 독립 리뷰 blocker: route 값만으로는 knownRefs.runIds 에도 들어가지 않는다.
    expect(knownRefs.runIds.has(unverified)).toBe(false);
    expect(knownRefs.runIds.size).toBe(0);
  });

  it("확인되지 않은 저엔트로피 route runId 는 evidence.context/deepLink 에는 남지만 trust set 에는 안 들어간다", async () => {
    // 저엔트로피라 redactSecrets 가 마스킹하지 않으므로 context 잔존을 직접 확인할 수 있다.
    const unverified = "fake-run";
    const context: KubiContext = { page: "build-detail", runId: unverified };
    const { evidence, knownRefs, safeRunIds } = await loadKubiEvidence(context);

    expect(evidence.context.runId).toBe("fake-run");
    expect(evidence.deepLinks.buildDetail).toContain("fake-run");
    expect(knownRefs.runIds.has(unverified)).toBe(false);
    expect(safeRunIds.has(unverified)).toBe(false);
  });

  it("확인되지 않은 고엔트로피 route runId 는 evidence 에서 redact 된다(safeRunIds 로 면제하지 않으므로)", async () => {
    const unverified = "service-secret-production-abcdef-1788004513062";
    const context: KubiContext = { page: "build-detail", runId: unverified };
    const { evidence } = await loadKubiEvidence(context);

    // safeRunIds 가 비어 있으므로 이 고엔트로피 값은 엔트로피 오탐 면제를 받지 못하고 마스킹된다.
    expect(evidence.context.runId).toBe("[REDACTED]");
  });

  it("확인된(safe) 저엔트로피 run id 는 evidence 에 그대로 남는다", async () => {
    const context: KubiContext = { page: "dataset-detail", datasetId: "air-quality", runId: "air-2026-08-14" };
    const { evidence } = await loadKubiEvidence(context);
    expect(evidence.context.runId).toBe("air-2026-08-14");
    expect(evidence.deepLinks.buildDetail).toContain("air-2026-08-14");
  });

  it("getBuildQuality 가 이 run id 로 정상 응답하면 knownRefs/safeRunIds 양쪽에 추가한다(datasetId 없이도)", async () => {
    const context: KubiContext = { page: "build-detail", runId: "air-2026-08-14" };
    const { knownRefs, safeRunIds } = await loadKubiEvidence(context);
    expect(safeRunIds.has("air-2026-08-14")).toBe(true);
    expect(knownRefs.runIds.has("air-2026-08-14")).toBe(true);
  });
});
