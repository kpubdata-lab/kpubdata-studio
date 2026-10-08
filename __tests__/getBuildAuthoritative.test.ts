// @vitest-environment jsdom
/**
 * getBuild() real-mode authoritative data 회귀 (F02).
 *
 * - BuildSpec은 GET /builds/{run_id}/spec snapshot이 정본이다(localStorage 없이도 편집 가능).
 * - snapshot 404(legacy)일 때만 로컬 specStore로 fallback한다.
 * - run status를 절대 임의로 succeeded로 합성하지 않는다:
 *   GET /builds 목록 > authoritative manifest.status > 명시적 오류.
 * - Builder snapshot의 redaction marker는 복원 시에도 유지된다(S07 fail-closed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBuild } from "@/features/runs/api/getBuild";
import { clearBuildSpecs, saveBuildSpec } from "@/features/build-spec/specStore";
import { ApiError, builderApi } from "@/shared/lib/builderApi";
import type { BuildSpec } from "@/shared/lib/types";

const SNAPSHOT_YAML = [
  "dataset_id: air-quality",
  "title: 대기오염",
  "description: 설명",
  "sources:",
  "  - provider: datago",
  "    dataset: air",
  "    params:",
  "      sidoName: 서울",
  "      serviceKey: A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB4uH8",
  "exports:",
  "  - kind: jsonl",
  "    output_path: artifacts/builds/air/data.jsonl",
  "metadata: {}",
  "",
].join("\n");

const LOCAL_SPEC: BuildSpec = {
  datasetId: "legacy-ds",
  title: "레거시",
  description: "로컬 보관 스펙",
  sources: [{ provider: "datago", dataset: "legacy", params: { region: "부산" } }],
  exports: [{ format: "jsonl" }],
  metadata: {},
};

const SNAPSHOT_DIGEST = `sha256:${"a".repeat(64)}`;

function notFound() {
  return new ApiError(404, "no snapshot for legacy run");
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  clearBuildSpecs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  clearBuildSpecs();
});

describe("getBuild real mode — authoritative spec + status (F02)", () => {
  it("loads the edit spec from the Builder snapshot even with no localStorage spec", async () => {
    vi.spyOn(builderApi, "getBuildSpecSnapshot").mockResolvedValue({
      run_id: "remote-run",
      spec: SNAPSHOT_YAML,
      spec_digest: SNAPSHOT_DIGEST,
    });
    vi.spyOn(builderApi, "listBuilds").mockResolvedValue({
      builds: [{ run_id: "remote-run", status: "ok", started_at: null, finished_at: null }],
    });

    const build = await getBuild("remote-run");
    expect(build.spec.datasetId).toBe("air-quality");
    expect(build.status).toBe("succeeded");
  });

  it("keeps the Builder snapshot's redacted credential redacted (S07 fail-closed)", async () => {
    vi.spyOn(builderApi, "getBuildSpecSnapshot").mockResolvedValue({
      run_id: "remote-run",
      spec: SNAPSHOT_YAML,
      spec_digest: SNAPSHOT_DIGEST,
    });
    vi.spyOn(builderApi, "listBuilds").mockResolvedValue({
      builds: [{ run_id: "remote-run", status: "ok", started_at: null, finished_at: null }],
    });

    const build = await getBuild("remote-run");
    const params = build.spec.sources[0].params as Record<string, unknown>;
    expect(params.serviceKey).toBe("[REDACTED]");
    expect(JSON.stringify(build.spec)).not.toContain("A7vK2mQ9xP4rT8yW3nC6dF1hJ5sL0zB4uH8");
  });

  it("falls back to the local specStore only when the snapshot is a 404 (legacy run)", async () => {
    saveBuildSpec("legacy-run", LOCAL_SPEC);
    vi.spyOn(builderApi, "getBuildSpecSnapshot").mockRejectedValue(notFound());
    vi.spyOn(builderApi, "listBuilds").mockResolvedValue({
      builds: [{ run_id: "legacy-run", status: "failed", started_at: null, finished_at: null }],
    });

    const build = await getBuild("legacy-run");
    expect(build.spec.datasetId).toBe("legacy-ds");
    expect(build.status).toBe("failed");
  });

  it("uses the GET /builds terminal summary status when the run is in the list (never re-guesses)", async () => {
    vi.spyOn(builderApi, "getBuildSpecSnapshot").mockResolvedValue({
      run_id: "r",
      spec: SNAPSHOT_YAML,
      spec_digest: SNAPSHOT_DIGEST,
    });
    vi.spyOn(builderApi, "listBuilds").mockResolvedValue({
      builds: [{ run_id: "r", status: "cancelled", started_at: null, finished_at: null }],
    });
    const manifestSpy = vi.spyOn(builderApi, "getBuildManifest");

    const build = await getBuild("r");
    expect(build.status).toBe("cancelled");
    expect(manifestSpy).not.toHaveBeenCalled();
  });

  it("uses authoritative manifest.status when the run is outside the GET /builds list", async () => {
    vi.spyOn(builderApi, "getBuildSpecSnapshot").mockResolvedValue({
      run_id: "r",
      spec: SNAPSHOT_YAML,
      spec_digest: SNAPSHOT_DIGEST,
    });
    vi.spyOn(builderApi, "listBuilds").mockResolvedValue({ builds: [] });
    vi.spyOn(builderApi, "getBuildManifest").mockResolvedValue({
      build_id: "r",
      started_at: "2026-08-31T00:00:00Z",
      finished_at: "2026-08-31T00:01:00Z",
      schema_version: "1.0.0",
      status: "cancelled",
    });

    const build = await getBuild("r");
    expect(build.status).toBe("cancelled");
  });

  it("does NOT synthesize succeeded when there is no authoritative status basis", async () => {
    saveBuildSpec("orphan-run", LOCAL_SPEC);
    vi.spyOn(builderApi, "getBuildSpecSnapshot").mockRejectedValue(notFound());
    vi.spyOn(builderApi, "listBuilds").mockResolvedValue({ builds: [] });
    vi.spyOn(builderApi, "getBuildManifest").mockResolvedValue({
      build_id: "orphan-run",
      started_at: "2026-08-31T00:00:00Z",
      finished_at: "2026-08-31T00:01:00Z",
      schema_version: "1.0.0",
      // status 필드 없음 — legacy/partial manifest
    });

    await expect(getBuild("orphan-run")).rejects.toThrow(/상태를 확인할 수 없습니다/);
  });

  it("surfaces a non-404 snapshot error instead of silently falling back", async () => {
    saveBuildSpec("perm-run", LOCAL_SPEC);
    vi.spyOn(builderApi, "getBuildSpecSnapshot").mockRejectedValue(
      new ApiError(403, "forbidden"),
    );
    const listSpy = vi.spyOn(builderApi, "listBuilds");

    await expect(getBuild("perm-run")).rejects.toThrow(/forbidden/);
    expect(listSpy).not.toHaveBeenCalled();
  });
});
