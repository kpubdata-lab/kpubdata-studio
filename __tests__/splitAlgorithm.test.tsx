/**
 * Which algorithm made a run's ratio splits (#671, builder#871, contract 1.70.0).
 *
 * The manifest's `split_algorithm` is shown as sent — a known value, or one Studio does
 * not know. Absent, it is `shuffle-v1` only when the run's BuildSpec declares a ratio
 * split (Builder's reading); a key split has no algorithm, and when nothing can be read
 * the detail says it cannot tell. A run whose previous run split differently says so.
 */
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mswServer } from "../vitest.setup";
import * as datasetsApi from "@/features/datasets/api";
import * as runsApi from "@/features/runs/api";
import { resolveSplitAlgorithm, splitAlgorithmsDiffer, splitModeOf } from "@/features/runs/splitAlgorithm";
import { BuildsPage } from "@/pages/BuildsPage";
import { API_BASE } from "@/shared/config/env";
import { buildManifestResponseSchema } from "@/shared/lib/builderApi.schema";

const MANIFEST = { build_id: "x", started_at: "2026-10-01T00:00:00Z", finished_at: "2026-10-01T00:01:00Z", schema_version: "1" };
const RATIO_SPEC = "dataset_id: air\nsplits:\n  mode: ratio\n  ratios: {train: 0.8, test: 0.2}\n  seed: 7\n";
const KEY_SPEC = "dataset_id: air\nsplits:\n  mode: key\n  key: station\n";
const NO_SPLIT_SPEC = "dataset_id: air\n";

describe("split algorithm model (#671)", () => {
  it("parses split_algorithm from a manifest, and a manifest without it", () => {
    expect(buildManifestResponseSchema.parse({ ...MANIFEST, split_algorithm: "hash-sort-v2" }).split_algorithm).toBe("hash-sort-v2");
    expect(buildManifestResponseSchema.parse(MANIFEST).split_algorithm).toBeUndefined();
    // Declared, not merely passed through: a non-string is a contract violation.
    expect(buildManifestResponseSchema.safeParse({ ...MANIFEST, split_algorithm: 2 }).success).toBe(false);
  });

  it("reads the BuildSpec's split mode", () => {
    expect(splitModeOf(RATIO_SPEC)).toBe("ratio");
    expect(splitModeOf(KEY_SPEC)).toBe("key");
    expect(splitModeOf(NO_SPLIT_SPEC)).toBe("none");
    expect(splitModeOf("splits: [")).toBe("unknown");
  });

  it("value present: shown as recorded, known or not", () => {
    expect(resolveSplitAlgorithm("hash-sort-v2", "ratio")).toEqual({ kind: "recorded", algorithm: "hash-sort-v2", known: true });
    expect(resolveSplitAlgorithm("hash-sort-v3", "unknown")).toEqual({ kind: "recorded", algorithm: "hash-sort-v3", known: false });
  });

  it("value absent: shuffle-v1 only for a ratio split; otherwise what the BuildSpec says, or unknown", () => {
    expect(resolveSplitAlgorithm(undefined, "ratio")).toEqual({ kind: "legacy", algorithm: "shuffle-v1" });
    expect(resolveSplitAlgorithm(undefined, "key")).toEqual({ kind: "key" });
    expect(resolveSplitAlgorithm(undefined, "none")).toEqual({ kind: "none" });
    expect(resolveSplitAlgorithm(undefined, "unknown")).toEqual({ kind: "unknown" });
    // An unread manifest is not an older one.
    expect(resolveSplitAlgorithm(null, "ratio")).toEqual({ kind: "unknown" });
  });

  it("two runs differ only when both algorithms are named and not equal", () => {
    const v2 = resolveSplitAlgorithm("hash-sort-v2", "ratio");
    const v1 = resolveSplitAlgorithm(undefined, "ratio");
    expect(splitAlgorithmsDiffer(v2, v1)).toBe(true);
    expect(splitAlgorithmsDiffer(v2, v2)).toBe(false);
    expect(splitAlgorithmsDiffer(v2, { kind: "unknown" })).toBe(false);
  });
});

describe("run detail split section (#671)", () => {
  let manifests: Record<string, Record<string, unknown> | number>;
  let specs: Record<string, string>;
  let history: string[];

  function renderDetail(runId: string) {
    return render(
      <MemoryRouter initialEntries={[`/refresh-jobs/${runId}`]}>
        <Routes>
          <Route path="/refresh-jobs/:buildId" element={<BuildsPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    manifests = {};
    specs = {};
    history = [];
    vi.spyOn(runsApi, "listBuilds").mockResolvedValue([]);
    vi.spyOn(datasetsApi, "listBuildStages").mockImplementation(async (runId) => ({ run_id: runId, sources: [] }));
    vi.spyOn(datasetsApi, "getBuildQuality").mockImplementation(async (runId) => ({
      run_id: runId,
      availability: "unavailable",
      evaluated_checks: 0,
      quality_results: {},
      schema_drift: {},
    }));
    mswServer.use(
      http.get(`${API_BASE}/builds/:run`, () => HttpResponse.json({ error: "not in registry" }, { status: 404 })),
      http.get(`${API_BASE}/builds/:run/events`, () => HttpResponse.json({ error: "none" }, { status: 404 })),
      http.get(`${API_BASE}/builds/:run/manifest`, ({ params }) => {
        const body = manifests[String(params.run)];
        if (body === undefined || typeof body === "number") return HttpResponse.json({ error: "no manifest" }, { status: typeof body === "number" ? body : 404 });
        return HttpResponse.json({ ...MANIFEST, build_id: params.run, ...body });
      }),
      http.get(`${API_BASE}/builds/:run/spec`, ({ params }) => {
        const spec = specs[String(params.run)];
        if (spec === undefined) return HttpResponse.json({ error: "no spec" }, { status: 404 });
        return HttpResponse.json({ run_id: params.run, spec, spec_digest: `sha256:${"0".repeat(64)}` });
      }),
      http.get(`${API_BASE}/datasets/air/runs`, () =>
        HttpResponse.json({
          dataset_id: "air",
          runs: history.map((run_id) => ({ run_id, status: "ok", started_at: null, finished_at: null, spec_digest: null, created_by: null })),
        }),
      ),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("value present: shows hash-sort-v2", async () => {
    manifests["run-new"] = { split_algorithm: "hash-sort-v2" };
    specs["run-new"] = RATIO_SPEC;
    renderDetail("run-new");

    expect(await screen.findByRole("heading", { name: "분할 방식" })).toBeInTheDocument();
    expect(await screen.findByText("hash-sort-v2")).toBeInTheDocument();
  });

  it("value absent with a ratio split: shows shuffle-v1 as Builder reads it", async () => {
    manifests["run-old"] = {};
    specs["run-old"] = RATIO_SPEC;
    renderDetail("run-old");

    expect(await screen.findByText("shuffle-v1")).toBeInTheDocument();
    expect(screen.getByText(/매니페스트에 기록되지 않았습니다/)).toBeInTheDocument();
  });

  it("unknown value: shown as sent, with a note", async () => {
    manifests["run-future"] = { split_algorithm: "hash-sort-v9" };
    specs["run-future"] = RATIO_SPEC;
    renderDetail("run-future");

    expect(await screen.findByText("hash-sort-v9")).toBeInTheDocument();
    expect(screen.getByText(/Studio 가 모르는 알고리즘입니다/)).toBeInTheDocument();
  });

  it("no split declared: no section", async () => {
    manifests["run-plain"] = {};
    specs["run-plain"] = NO_SPLIT_SPEC;
    renderDetail("run-plain");

    await screen.findByRole("heading", { name: "파이프라인 / 단계 진행" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("heading", { name: "분할 방식" })).not.toBeInTheDocument();
  });

  it("ratio split but the manifest cannot be read: says it cannot tell, never guesses shuffle-v1", async () => {
    manifests["run-hidden"] = 500;
    specs["run-hidden"] = RATIO_SPEC;
    renderDetail("run-hidden");

    expect(await screen.findByRole("heading", { name: "분할 방식" })).toBeInTheDocument();
    expect(screen.getAllByText(/매니페스트나 BuildSpec 을 읽지 못했습니다/).length).toBeGreaterThan(0);
    expect(screen.queryByText("shuffle-v1")).not.toBeInTheDocument();
  });

  it("says the split method differs from the previous run's", async () => {
    history = ["run-new", "run-old"];
    manifests["run-new"] = { split_algorithm: "hash-sort-v2" };
    specs["run-new"] = RATIO_SPEC;
    manifests["run-old"] = {};
    specs["run-old"] = RATIO_SPEC;
    renderDetail("run-new");

    expect(await screen.findByTestId("split-algorithm-differs")).toHaveTextContent(
      "이전 실행 run-old은(는) shuffle-v1(으)로 분할했습니다. split 방식이 달라",
    );
  });

  it("says nothing when the previous run used the same algorithm", async () => {
    history = ["run-new", "run-prev"];
    manifests["run-new"] = { split_algorithm: "hash-sort-v2" };
    specs["run-new"] = RATIO_SPEC;
    manifests["run-prev"] = { split_algorithm: "hash-sort-v2" };
    specs["run-prev"] = RATIO_SPEC;
    renderDetail("run-new");

    await screen.findByText("hash-sort-v2");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId("split-algorithm-differs")).not.toBeInTheDocument();
  });
});
