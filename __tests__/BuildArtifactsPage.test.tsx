/**
 * BuildArtifactsPage UI 테스트 - Issue #119
 *
 * undefined와 빈 배열이 서로 다른 문구로 표시되는지 검증한다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { BuildManifest } from "@/shared/lib/types";
import { BuildArtifactsPage } from "@/pages/BuildArtifactsPage";
import * as artifactsApi from "@/features/artifacts/api";

const mockGetBuildManifest = vi.spyOn(artifactsApi, "getBuildManifest");
const mockListArtifactFiles = vi.spyOn(artifactsApi, "listArtifactFiles");
const mockDownloadArtifact = vi.spyOn(artifactsApi, "downloadArtifact");
const mockSaveBlobAsFile = vi.spyOn(artifactsApi, "saveBlobAsFile").mockImplementation(() => {});

function renderWithManifest(manifest: BuildManifest, runId = "test-id", files: string[] = []) {
  mockGetBuildManifest.mockResolvedValue(manifest);
  mockListArtifactFiles.mockResolvedValue(files);
  return render(
    <MemoryRouter initialEntries={[`/refresh-jobs/${runId}/artifacts`]}>
      <Routes>
        <Route path="/refresh-jobs/:buildId/artifacts" element={<BuildArtifactsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("BuildArtifactsPage - Issue #119: undefined vs empty array", () => {
  it("canonical 파일 목록이 비면 표에 '생성된 파일이 없습니다'를 보여준다", async () => {
    const withEmpty: BuildManifest = {
      schema_version: "1.0.0",
      build_id: "test-empty",
      build_environment: null,
      inputs_fingerprint: null,
      outputs: [],
    };

    renderWithManifest(withEmpty, "test-id", []);
    await waitFor(() => expect(screen.getByText("생성된 파일이 없습니다")).toBeInTheDocument());
    expect(screen.getByText("생성된 파일이 없습니다")).toBeInTheDocument();
  });

  it("formats: undefined → '미제공', formats: [] → '출력 형식 없음'", async () => {
    const withUndefined: BuildManifest = {
      schema_version: "1.0.0",
      build_id: "test-undefined",
      build_environment: null,
      inputs_fingerprint: null,
    };

    renderWithManifest(withUndefined);
    await waitFor(() => expect(screen.getByText("출력 형식")).toBeInTheDocument());
    expect(screen.queryByText("출력 형식 없음")).not.toBeInTheDocument();
    cleanup();

    const withEmpty: BuildManifest = {
      schema_version: "1.0.0",
      build_id: "test-empty",
      build_environment: null,
      inputs_fingerprint: null,
      outputs: [],
    };

    renderWithManifest(withEmpty);
    await waitFor(() => expect(screen.getByText("출력 형식 없음")).toBeInTheDocument());
    expect(screen.getByText("출력 형식 없음")).toBeInTheDocument();
  });

  it("provenance: undefined → '미제공', provenance: [] → '소스 없음'", async () => {
    const withUndefined: BuildManifest = {
      schema_version: "1.0.0",
      build_id: "test-undefined",
      build_environment: null,
      inputs_fingerprint: null,
    };

    renderWithManifest(withUndefined);
    await waitFor(() => expect(screen.getByText("소스")).toBeInTheDocument());
    expect(screen.queryByText("소스 없음")).not.toBeInTheDocument();
    cleanup();

    const withEmpty: BuildManifest = {
      schema_version: "1.0.0",
      build_id: "test-empty",
      build_environment: null,
      inputs_fingerprint: null,
      provenance: [],
    };

    renderWithManifest(withEmpty);
    await waitFor(() => expect(screen.getByText("소스 없음")).toBeInTheDocument());
    expect(screen.getByText("소스 없음")).toBeInTheDocument();
  });

  it("값이 존재할 때 올바르게 표시됨", async () => {
    const withValues: BuildManifest = {
      schema_version: "1.0.0",
      build_id: "test-values",
      build_environment: null,
      inputs_fingerprint: null,
      outputs: ["artifacts/builds/test/data.jsonl", "artifacts/builds/test/output.parquet"],
      provenance: [
        {
          provider: "datago",
          dataset: "air-quality",
          fetched_at: "2026-06-21T00:00:00+00:00",
          record_count: 100,
          data_checksum: "sha256:abc",
          api_version: "1.0",
          params: {},
        },
      ],
      row_counts: { "datago.air-quality": 100 },
    };

    renderWithManifest(withValues);
    await waitFor(() => expect(screen.queryByText("jsonl, parquet")).toBeInTheDocument());
    expect(screen.getByText("jsonl, parquet")).toBeInTheDocument();
    expect(screen.getByText("datago.air-quality")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });
});

describe("BuildArtifactsPage - artifact 실제 다운로드", () => {
  const emptyManifest = (): BuildManifest => ({
    schema_version: "1.0.0",
    build_id: "run-dl",
    build_environment: null,
    inputs_fingerprint: null,
    outputs: [],
  });

  /** 표는 canonical `GET /artifacts/{run_id}` 목록(= listArtifactFiles)에서만 온다. */
  function renderArtifacts(files: string[], runId = "test-id") {
    return renderWithManifest(emptyManifest(), runId, files);
  }

  it("각 canonical 파일 row에 '다운로드' 버튼을 보여준다('연동 예정' 아님)", async () => {
    renderArtifacts(["silver/datago.air_quality/table.parquet", "manifest.json"]);
    await waitFor(() => expect(screen.getByText("table.parquet")).toBeInTheDocument());

    expect(screen.getAllByRole("button", { name: "다운로드" })).toHaveLength(2);
    expect(screen.queryByText(/연동 예정/)).not.toBeInTheDocument();
  });

  it("클릭 시 exact run_id + canonical run-relative 경로로 wrapper를 호출하고 Blob을 저장한다", async () => {
    const blob = new Blob(["parquet-bytes"], { type: "application/octet-stream" });
    mockDownloadArtifact.mockResolvedValue({ blob, filename: "table.parquet" });

    renderArtifacts(["silver/datago.air_quality/table.parquet"], "air-quality-20260621");
    await waitFor(() => expect(screen.getByText("table.parquet")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "다운로드" }));

    await waitFor(() => expect(mockDownloadArtifact).toHaveBeenCalledTimes(1));
    expect(mockDownloadArtifact).toHaveBeenCalledWith(
      "air-quality-20260621",
      "silver/datago.air_quality/table.parquet",
    );
    await waitFor(() => expect(mockSaveBlobAsFile).toHaveBeenCalledWith(blob, "table.parquet"));
  });

  it("output_root prefix나 '\\'가 붙은 storage 경로를 요청에 쓰지 않는다", async () => {
    mockDownloadArtifact.mockResolvedValue({ blob: new Blob(["x"]), filename: "raw_records.jsonl" });

    // canonical 목록은 run-relative POSIX 경로만 준다.
    renderArtifacts(["bronze/datago.air_quality/9f/raw_records.jsonl"], "run-x");
    await waitFor(() => expect(screen.getByText("raw_records.jsonl")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "다운로드" }));

    await waitFor(() => expect(mockDownloadArtifact).toHaveBeenCalledTimes(1));
    const [, pathArg] = mockDownloadArtifact.mock.calls[0];
    expect(pathArg).toBe("bronze/datago.air_quality/9f/raw_records.jsonl");
    expect(pathArg).not.toMatch(/\\/);
    expect(pathArg).not.toMatch(/dist-new-user-preview|output_root|^([A-Za-z]:|\/)/);
  });

  it("다운로드 중 중복 클릭을 막는다", async () => {
    let resolve!: (v: { blob: Blob; filename: string }) => void;
    mockDownloadArtifact.mockReturnValue(new Promise((r) => { resolve = r; }));

    renderArtifacts(["manifest.json"]);
    await waitFor(() => expect(screen.getByRole("button", { name: "다운로드" })).toBeInTheDocument());

    const button = screen.getByRole("button", { name: "다운로드" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(mockDownloadArtifact).toHaveBeenCalledTimes(1);
    resolve({ blob: new Blob(["x"]), filename: "manifest.json" });
  });

  it("다운로드 실패는 해당 row에만 표시하고 페이지 전체를 실패로 만들지 않는다", async () => {
    mockDownloadArtifact.mockRejectedValue(new Error("파일을 찾을 수 없습니다 (404)"));

    renderArtifacts(["silver/datago.air_quality/table.parquet"]);
    await waitFor(() => expect(screen.getByText("table.parquet")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "다운로드" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("파일을 찾을 수 없습니다 (404)");
    expect(mockSaveBlobAsFile).not.toHaveBeenCalled();
    expect(screen.getByText("Manifest 요약")).toBeInTheDocument();
    expect(screen.queryByText("스냅샷 파일을 불러오지 못했습니다")).not.toBeInTheDocument();
  });

  it("다른 Run의 artifact 경로와 섞이지 않는다", async () => {
    mockDownloadArtifact.mockResolvedValue({ blob: new Blob(["x"]), filename: "data.jsonl" });

    renderArtifacts(["gold/datago.air_quality/out/data.jsonl"], "run-A");
    await waitFor(() => expect(screen.getByText("data.jsonl")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "다운로드" }));

    await waitFor(() =>
      expect(mockDownloadArtifact).toHaveBeenCalledWith("run-A", "gold/datago.air_quality/out/data.jsonl"),
    );
    expect(mockDownloadArtifact).not.toHaveBeenCalledWith("test-id", expect.anything());
  });

  it("파일 목록 조회가 실패해도 페이지 전체는 정상이고 표에만 안내를 보여준다", async () => {
    mockGetBuildManifest.mockResolvedValue(emptyManifest());
    mockListArtifactFiles.mockRejectedValue(new Error("목록 조회 실패"));

    render(
      <MemoryRouter initialEntries={["/refresh-jobs/test-id/artifacts"]}>
        <Routes>
          <Route path="/refresh-jobs/:buildId/artifacts" element={<BuildArtifactsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("파일 목록을 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.getByText("Manifest 요약")).toBeInTheDocument();
    expect(screen.queryByText("스냅샷 파일을 불러오지 못했습니다")).not.toBeInTheDocument();
  });
});

describe("BuildArtifactsPage - manifest truthfulness (F05A)", () => {
  it("full authoritative manifest shows no stale '미연동' warning", async () => {
    const full: BuildManifest = {
      schema_version: "1.0.0",
      build_id: "run-full",
      build_environment: null,
      inputs_fingerprint: null,
      outputs: ["artifacts/builds/run-full/data.jsonl"],
      row_counts: { "datago.air-quality": 100 },
      provenance: [
        {
          provider: "datago",
          dataset: "air-quality",
          fetched_at: "2026-06-21T00:00:00+00:00",
          record_count: 100,
          data_checksum: "sha256:abc",
          api_version: "1.0",
          params: {},
        },
      ],
    };

    renderWithManifest(full);
    await waitFor(() => expect(screen.getByText("Manifest 요약")).toBeInTheDocument());
    expect(screen.queryByText(/아직 연동되지 않아/)).not.toBeInTheDocument();
    expect(screen.queryByText(/manifest가 아직 연동/)).not.toBeInTheDocument();
  });

  it("legacy/partial manifest is described factually (missing metadata, not 'API not integrated')", async () => {
    const partial: BuildManifest = {
      schema_version: "1.0.0",
      build_id: "run-partial",
      build_environment: null,
      inputs_fingerprint: null,
      outputs: ["artifacts/builds/run-partial/data.jsonl"],
      // row_counts / provenance 없음
    };

    renderWithManifest(partial);
    await waitFor(() => expect(screen.getByText("Manifest 요약")).toBeInTheDocument());
    expect(screen.getByText(/일부 메타데이터 필드/)).toBeInTheDocument();
    expect(screen.queryByText(/아직 연동되지 않아/)).not.toBeInTheDocument();
  });
});
