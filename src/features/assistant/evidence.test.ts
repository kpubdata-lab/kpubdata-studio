// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveBuildSpec } from "@/features/build-spec/specStore";
import * as datasetsApi from "@/features/datasets/api";
import type { BuildSpec } from "@/shared/lib/types";
import { loadAssistantEvidence } from "./evidence";
import type { AssistantContext } from "./types";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("loadAssistantEvidence (#256)", () => {
  it("builds dataset/run/quality evidence with deep links and known refs for a valid dataset", async () => {
    const context: AssistantContext = { page: "dataset-detail", datasetId: "air-quality", runId: "air-2026-08-14" };
    const { evidence, knownRefs } = await loadAssistantEvidence(context);

    expect(evidence.dataset?.datasetId).toBe("air-quality");
    expect(evidence.deepLinks.datasetDetail).toBe("/tables/air-quality");
    expect(evidence.quality?.results.some((r) => r.rule === "required_column")).toBe(true);
    expect(knownRefs.datasetIds.has("air-quality")).toBe(true);
    expect(knownRefs.runIds.has("air-2026-08-14")).toBe(true);
    expect(knownRefs.qualityResultIds.size).toBeGreaterThan(0);
    // The catalog must succeed — the global MSW handler always answers.
    expect(evidence.catalog?.providers).toContain("datago");
  });

  it("marks evidence partial and lists what failed when the dataset doesn't exist", async () => {
    const context: AssistantContext = { page: "dataset-detail", datasetId: "does-not-exist" };
    const { evidence } = await loadAssistantEvidence(context);

    expect(evidence.partial).toBe(true);
    expect(evidence.unavailable).toContain("dataset");
    expect(evidence.dataset).toBeUndefined();
  });

  it("keeps quality unavailability distinct from PASS (population run has availability=unavailable)", async () => {
    const context: AssistantContext = { page: "dataset-detail", datasetId: "population", runId: "population-2026-08-13" };
    const { evidence } = await loadAssistantEvidence(context);

    expect(evidence.quality?.availability).toBe("unavailable");
    expect(evidence.quality?.evaluatedChecks).toBe(0);
  });

  it("does not fetch stage evidence when the context has no stage (no guessed source)", async () => {
    const context: AssistantContext = { page: "dataset-detail", datasetId: "air-quality", runId: "air-2026-08-14" };
    const { evidence } = await loadAssistantEvidence(context);
    expect(evidence.stage).toBeUndefined();
  });

  it("includes stage evidence (status/rowCount only, no raw sample rows) for the context source_key", async () => {
    // air-2026-08-14 is multi-source (datago__air + kma__weather), so the source must be explicit.
    const context: AssistantContext = {
      page: "dataset-detail",
      datasetId: "air-quality",
      runId: "air-2026-08-14",
      stage: "silver",
      source: "datago__air",
    };
    const { evidence, knownRefs, safeEvidenceIds } = await loadAssistantEvidence(context);
    expect(evidence.stage?.stage).toBe("silver");
    expect(evidence.stage?.source).toBe("datago__air");
    expect(evidence.stage?.refId).toBe("air-2026-08-14::datago__air::silver");
    expect(knownRefs.stageIds.has(evidence.stage!.refId)).toBe(true);
    expect(safeEvidenceIds.has(evidence.stage!.refId)).toBe(true);
    // Raw sample rows do not exist on the evidence type at all — minimal-data principle (#256 review §3).
    expect(evidence.stage).not.toHaveProperty("sample");
  });

  it("fails closed (stage unavailable) for a multi-source run when the context has no source_key", async () => {
    const context: AssistantContext = {
      page: "quality",
      datasetId: "air-quality",
      runId: "air-2026-08-14",
      stage: "silver",
    };
    const { evidence } = await loadAssistantEvidence(context);
    // Never picks the first source arbitrarily — ambiguous source leaves the stage unavailable.
    expect(evidence.stage).toBeUndefined();
    expect(evidence.unavailable).toContain("stage");
  });

  it("falls back to the sole source_key for a single-source run when the context has no source_key", async () => {
    const context: AssistantContext = {
      page: "quality",
      datasetId: "population",
      runId: "population-2026-08-13",
      stage: "silver",
    };
    const { evidence } = await loadAssistantEvidence(context);
    expect(evidence.stage?.stage).toBe("silver");
    expect(evidence.stage?.source).toBe("kosis__population");
  });

  it("requests stage detail with a positive limit (real Builder rejects limit=0 with 400 → stage always unavailable)", async () => {
    // The real Builder `/builds/{run}/stages/{stage}` accepts limit only as a "positive integer 1..1000".
    // limit=0 → 400 → settle failure → a real runtime bug where the stage always fell unavailable.
    const spy = vi.spyOn(datasetsApi, "getBuildStageDetail");
    const context: AssistantContext = {
      page: "quality",
      datasetId: "population",
      runId: "population-2026-08-13",
      stage: "silver",
    };
    await loadAssistantEvidence(context);
    expect(spy).toHaveBeenCalled();
    for (const call of spy.mock.calls) {
      const limit = call[3];
      expect(typeof limit).toBe("number");
      expect(limit as number).toBeGreaterThanOrEqual(1);
    }
  });

  it("exposes exact stage column names + dtypes from the Builder silver stage detail (SQL authoring evidence)", async () => {
    // Reproduces the real Builder Gold scenario: the actual column is `pm10Value` (String); `pm10` does not exist.
    // The schema returned by Builder must be exposed as-is so the LLM never guesses column names.
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

    const context: AssistantContext = {
      page: "quality",
      datasetId: "population",
      runId: "population-2026-08-13",
      stage: "silver",
    };
    const { evidence } = await loadAssistantEvidence(context);

    expect(evidence.stage?.columns).toEqual(["stationName", "pm10Value"]);
    expect(evidence.stage?.schema).toContainEqual({ name: "pm10Value", dtype: "String" });
    // Nonexistent abbreviated column names never appear in evidence.
    expect(evidence.stage?.columns).not.toContain("pm10");
    // Minimal-data principle: raw sample rows still never leak into evidence.
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

    const context: AssistantContext = {
      page: "quality",
      datasetId: "population",
      runId: "population-2026-08-13",
      stage: "gold",
    };
    const { evidence } = await loadAssistantEvidence(context);

    expect(evidence.stage?.columns).toEqual(["stationName", "pm10Value"]);
    // Gold stage detail carries no dtype — schema is omitted rather than invented.
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

    const context: AssistantContext = { page: "build-detail", runId: "air-2026-08-14" };
    const { evidence } = await loadAssistantEvidence(context);

    expect(evidence.buildSpecSummary?.sources[0].paramKeys).toEqual(["serviceKey", "region"]);
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain(SECRET_VALUE);
    expect(serialized).not.toContain("서울"); // param values never appear at all, only key names.
  });

  it("scrubs any residual secret-shaped values as a defense-in-depth pass", async () => {
    const context: AssistantContext = { page: "dataset-detail", datasetId: "air-quality", runId: "air-2026-08-14" };
    const { evidence } = await loadAssistantEvidence(context);
    expect(JSON.stringify(evidence)).not.toContain("__SCRUBBED_");
  });

  it("keeps deterministic quality/schema-drift evidence ids out of entropy redaction (safeEvidenceIds provenance)", async () => {
    const context: AssistantContext = { page: "quality", datasetId: "air-quality", runId: "air-2026-08-14" };
    const { evidence, knownRefs, safeEvidenceIds } = await loadAssistantEvidence(context);

    const results = evidence.quality?.results ?? [];
    expect(results.length).toBeGreaterThan(0);
    // The canonical source_key is not a secret — the field name `source` does not hit redactSecrets'
    // `*key$` secret-name heuristic, and it must remain usable as-is for crossCheck stage/group matching.
    for (const result of results) expect(result.source).not.toBe("[REDACTED]");
    const ids = results.map((result) => result.id);
    for (const id of ids) {
      // A valid quality id must not be `[REDACTED]` by the secret scrubber's entropy false positive.
      expect(id).not.toBe("[REDACTED]");
      // And the same value goes into both knownRefs (crossCheck matching) and safeEvidenceIds (egress exemption).
      expect(knownRefs.qualityResultIds.has(id)).toBe(true);
      expect(safeEvidenceIds.has(id)).toBe(true);
    }
    for (const finding of evidence.quality?.schemaDrift ?? []) {
      const driftId = `${finding.kind}::${finding.column ?? "_"}`;
      expect(safeEvidenceIds.has(driftId)).toBe(true);
    }
    // safeEvidenceIds holds only evidence identifiers, not run ids — run ids belong to safeRunIds.
    expect(safeEvidenceIds.has("air-2026-08-14")).toBe(false);
  });

  it("omits stage/buildSpecSummary/quality when the context has no runId at all", async () => {
    const context: AssistantContext = { page: "quality" };
    const { evidence, knownRefs } = await loadAssistantEvidence(context);
    expect(evidence.quality).toBeUndefined();
    expect(evidence.buildSpecSummary).toBeUndefined();
    expect(knownRefs.runIds.size).toBe(0);
  });
});

/**
 * Run provenance — knownRefs.runIds and safeRunIds have different roles but
 * the same provenance contract (#284 + independent review blocker).
 *
 * Both Sets hold only "run ids whose existence was confirmed by a Builder
 * response during this evidence load". route/context.runId may remain in
 * evidence.context / deepLink, but until its existence is confirmed it
 * enters neither knownRefs.runIds nor safeRunIds.
 */
describe("loadAssistantEvidence — run provenance (knownRefs.runIds / safeRunIds)", () => {
  it("Builder 응답(getDataset.latest_run_id / listDatasetRuns)이 확인한 run id 는 safeRunIds 에 들어간다", async () => {
    const context: AssistantContext = { page: "dataset-detail", datasetId: "air-quality", runId: "air-2026-08-14" };
    const { knownRefs, safeRunIds } = await loadAssistantEvidence(context);

    expect(safeRunIds.has("air-2026-08-14")).toBe(true);
    // Past runs confirmed via listDatasetRuns are included.
    expect(safeRunIds.has("air-2026-08-13")).toBe(true);
    // safeRunIds ⊆ knownRefs.runIds (separate, but confirmed values are in both).
    for (const id of safeRunIds) expect(knownRefs.runIds.has(id)).toBe(true);
  });

  it("Builder 어느 응답에서도 확인되지 않은 route runId 는 knownRefs.runIds / safeRunIds 어디에도 없다", async () => {
    // No datasetId → getDataset/listDatasetRuns not called. quality/stage 404 for this run id.
    const unverified = "service-secret-production-abcdef-1788004513062";
    const context: AssistantContext = { page: "build-detail", runId: unverified };
    const { knownRefs, safeRunIds } = await loadAssistantEvidence(context);

    expect(safeRunIds.has(unverified)).toBe(false);
    expect(safeRunIds.size).toBe(0);
    // Independent review blocker: the route value alone does not enter knownRefs.runIds either.
    expect(knownRefs.runIds.has(unverified)).toBe(false);
    expect(knownRefs.runIds.size).toBe(0);
  });

  it("확인되지 않은 저엔트로피 route runId 는 evidence.context/deepLink 에는 남지만 trust set 에는 안 들어간다", async () => {
    // Low entropy, so redactSecrets does not mask it — context residue can be checked directly.
    const unverified = "fake-run";
    const context: AssistantContext = { page: "build-detail", runId: unverified };
    const { evidence, knownRefs, safeRunIds } = await loadAssistantEvidence(context);

    expect(evidence.context.runId).toBe("fake-run");
    expect(evidence.deepLinks.buildDetail).toContain("fake-run");
    expect(knownRefs.runIds.has(unverified)).toBe(false);
    expect(safeRunIds.has(unverified)).toBe(false);
  });

  it("확인되지 않은 고엔트로피 route runId 는 evidence 에서 redact 된다(safeRunIds 로 면제하지 않으므로)", async () => {
    const unverified = "service-secret-production-abcdef-1788004513062";
    const context: AssistantContext = { page: "build-detail", runId: unverified };
    const { evidence } = await loadAssistantEvidence(context);

    // safeRunIds is empty, so this high-entropy value gets no entropy false-positive exemption and is masked.
    expect(evidence.context.runId).toBe("[REDACTED]");
  });

  it("확인된(safe) 저엔트로피 run id 는 evidence 에 그대로 남는다", async () => {
    const context: AssistantContext = { page: "dataset-detail", datasetId: "air-quality", runId: "air-2026-08-14" };
    const { evidence } = await loadAssistantEvidence(context);
    expect(evidence.context.runId).toBe("air-2026-08-14");
    expect(evidence.deepLinks.buildDetail).toContain("air-2026-08-14");
  });

  it("getBuildQuality 가 이 run id 로 정상 응답하면 knownRefs/safeRunIds 양쪽에 추가한다(datasetId 없이도)", async () => {
    const context: AssistantContext = { page: "build-detail", runId: "air-2026-08-14" };
    const { knownRefs, safeRunIds } = await loadAssistantEvidence(context);
    expect(safeRunIds.has("air-2026-08-14")).toBe(true);
    expect(knownRefs.runIds.has("air-2026-08-14")).toBe(true);
  });
});
