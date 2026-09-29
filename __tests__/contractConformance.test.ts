/**
 * Builder API 계약 적합성 테스트 (#36).
 *
 * Studio가 호출하는 Builder operation 집합과, 통합 표면이 요구하는 **최소** Builder
 * API 버전을 고정한다. 이 값은 "Builder main의 최신 api_version과 exact-equality"가
 * 아니다 — Builder ADR 0013(#521)에 따라 Studio는 같은 major·server >= 최소값이면
 * 호환으로 간주하고 더 높은 additive minor/patch(1.19~1.21 등)를 허용한다.
 *
 * 현재 최소값은 1.18.0이다: cooperative cancel(POST /builds/{id}/cancel)과 manifest
 * status/partial 필드가 1.18.0에서 도입됐고 Studio가 둘 다 실제로 사용한다. provider
 * credential / monitoring / async build job operation은 이미 연동돼 EXPECTED_OPERATIONS에
 * 포함돼 있다.
 */
import { describe, expect, it } from "vitest";
import {
  isBuilderApiCompatible,
  MIN_BUILDER_API_VERSION,
  builderApi,
} from "@/shared/lib/builderApi";

// Studio 클라이언트가 호출하는 Builder service 오퍼레이션(현재 구현 기준).
const EXPECTED_OPERATIONS = [
  "version",
  "validate",
  "preview",
  "build",
  "submitBuild",
  "getBuildJob",
  "cancelBuildJob",
  "artifacts",
  "getBuildManifest",
  "listBuilds",
  "catalog",
  "listDatasets",
  "getDataset",
  "listDatasetRuns",
  "getDatasetRun",
  "listBuildStages",
  "getBuildStageDetail",
  "getBuildQuality",
  "getPublishReadiness",
  "publishBuild",
  "getDatasetQualityHistory",
  "query",
  "getBuildSpecSnapshot",
  "getBuildEvents",
  "getMonitoringSummary",
  "getMonitoringBuilds",
  "getQualitySummary",
  "listProviders",
  "testProviderConnection",
  "getProviderStatus",
  "getProviderCredential",
  "putProviderCredential",
  "deleteProviderCredential",
  "uploadFile",
  "downloadArtifactFile",
  "adminConfig",
  "adminRuns",
  "listWarehouseTables",
  "getWarehouseTable",
  "warehouseQuery",
  "listAnalyses",
  "createAnalysis",
  "runAnalysis",
  "deleteAnalysis",
] as const;

describe("Builder API contract conformance (#36)", () => {
  it("declares 1.18.0 as the minimum required Builder API version for the integrated surface", () => {
    expect(MIN_BUILDER_API_VERSION).toBe("1.18.0");
  });

  it("exposes exactly the expected client operations", () => {
    expect(Object.keys(builderApi).sort()).toEqual([...EXPECTED_OPERATIONS].sort());
  });

  it("each operation is callable", () => {
    for (const op of EXPECTED_OPERATIONS) {
      expect(typeof builderApi[op]).toBe("function");
    }
  });
});

describe("isBuilderApiCompatible — SemVer policy (ADR 0013)", () => {
  it("accepts the exact minimum version", () => {
    expect(isBuilderApiCompatible("1.18.0")).toBe(true);
  });

  it("accepts higher additive minor/patch within the same major", () => {
    expect(isBuilderApiCompatible("1.18.4")).toBe(true);
    expect(isBuilderApiCompatible("1.21.0")).toBe(true);
  });

  it("rejects versions below the minimum within the same major", () => {
    expect(isBuilderApiCompatible("1.17.0")).toBe(false);
    expect(isBuilderApiCompatible("1.17.9")).toBe(false);
  });

  it("rejects a different (higher) major", () => {
    expect(isBuilderApiCompatible("2.0.0")).toBe(false);
  });

  it("fails closed on malformed / missing versions", () => {
    expect(isBuilderApiCompatible("")).toBe(false);
    expect(isBuilderApiCompatible("1.18")).toBe(false);
    expect(isBuilderApiCompatible("v1.18.0")).toBe(false);
    expect(isBuilderApiCompatible(undefined)).toBe(false);
  });
});
